import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diffViolation, type parseRawDiff, pathPolicy } from './diff.ts'

const file = (
  path: string,
  status: 'A' | 'D' | 'M' = 'M',
): ReturnType<typeof parseRawDiff>[number] => ({
  newMode: '100644',
  oldMode: status === 'A' ? '000000' : '100644',
  path,
  status,
})

describe('pathPolicy', () => {
  test('ignores human branches', () => {
    expect(pathPolicy('main')).toEqual({ kind: 'ignore' })
  })

  test('recognizes package and lock updates', () => {
    expect(pathPolicy('update/vocat')).toEqual({
      kind: 'package',
      name: 'vocat',
    })
    expect(pathPolicy('update/lock')).toEqual({ kind: 'lock' })
  })

  test('rejects an unsafe update branch name', () => {
    expect(pathPolicy('update/../flake.nix').kind).toBe('reject')
  })
})

describe('diff command', () => {
  test.each([false, true])(
    'checks only PR changes when the base advances (PR changes lock: %s)',
    (changesLock) => {
      const cwd = mkdtempSync(join(tmpdir(), 'update-diff-'))
      const git = (...args: string[]): string => {
        const result = Bun.spawnSync(['git', ...args], { cwd })
        if (result.exitCode !== 0) {
          throw new Error(result.stderr.toString())
        }
        return result.stdout.toString().trim()
      }
      try {
        git('init', '-b', 'main')
        git('config', 'user.name', 'Test')
        git('config', 'user.email', 'test@example.com')
        writeFileSync(join(cwd, 'flake.lock'), 'old lock\n')
        git('add', '.')
        git('commit', '-m', 'initial')
        git('checkout', '-b', 'update/vocat')
        mkdirSync(join(cwd, 'packages/vocat'), { recursive: true })
        writeFileSync(join(cwd, 'packages/vocat/package.nix'), 'new version\n')
        if (changesLock) {
          writeFileSync(join(cwd, 'flake.lock'), 'PR lock\n')
        }
        git('add', '.')
        git('commit', '-m', 'package update')
        const headSha = git('rev-parse', 'HEAD')
        git('checkout', 'main')
        writeFileSync(join(cwd, 'flake.lock'), 'base lock\n')
        git('add', '.')
        git('commit', '-m', 'lock update')
        const result = Bun.spawnSync(
          [process.execPath, join(import.meta.dir, 'diff.ts')],
          {
            cwd,
            env: {
              ...process.env,
              BASE_SHA: git('rev-parse', 'HEAD'),
              HEAD_REF: 'update/vocat',
              HEAD_SHA: headSha,
              GITHUB_STEP_SUMMARY: join(cwd, 'summary.md'),
            },
          },
        )
        expect(result.exitCode).toBe(changesLock ? 1 : 0)
        expect(result.stdout.toString()).toContain(
          changesLock
            ? 'flake.lock is outside the update branch'
            : '- Result: allowed',
        )
      } finally {
        rmSync(cwd, { recursive: true, force: true })
      }
    },
  )
})

describe('diffViolation', () => {
  test('allows a package update inside its directory', () => {
    expect(
      diffViolation(pathPolicy('update/vocat'), [
        file('packages/vocat/package.nix'),
      ]),
    ).toBeNull()
  })

  test('rejects a package update that leaves its directory', () => {
    expect(
      diffViolation(pathPolicy('update/vocat'), [file('flake.nix')]),
    ).toMatch(/outside/)
  })

  test('allows only flake.lock on the lock branch', () => {
    expect(
      diffViolation(pathPolicy('update/lock'), [file('flake.lock')]),
    ).toBeNull()
    expect(
      diffViolation(pathPolicy('update/lock'), [file('flake.nix')]),
    ).toMatch(/outside/)
  })

  test('does not restrict other branches', () => {
    expect(diffViolation(pathPolicy('feature'), [file('flake.nix')])).toBeNull()
  })
})
