import { describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('update branch authors', () => {
  test.each([
    ['update[bot]', false],
    ['kodiakhq[bot]', false],
    ['Human', true],
  ] as const)('handles commits by %s', (author, foreign) => {
    const directory = mkdtempSync(join(tmpdir(), 'update-authors-'))
    const cwd = join(directory, 'repo')
    mkdirSync(cwd)
    const git = (...args: string[]): string => {
      const result = Bun.spawnSync(['git', ...args], { cwd })
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.toString())
      }
      return result.stdout.toString().trim()
    }
    try {
      git('init', '-b', 'main')
      git('config', 'user.name', 'update[bot]')
      git('config', 'user.email', 'test@example.com')
      writeFileSync(join(cwd, 'flake.lock'), 'old lock\n')
      git('add', 'flake.lock')
      git('commit', '-m', 'initial')
      const base = git('rev-parse', 'HEAD')
      git('checkout', '-b', 'update/lock')
      git(
        '-c',
        `user.name=${author}`,
        'commit',
        '--allow-empty',
        '-m',
        'update',
      )
      const result = Bun.spawnSync(
        [
          process.execPath,
          '--eval',
          `import { foreignAuthors } from ${JSON.stringify(join(import.meta.dir, 'package-update.ts'))}; console.log(foreignAuthors('HEAD', ${JSON.stringify(base)}, 'update[bot]'))`,
        ],
        { cwd },
      )
      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString().trim()).toBe(String(foreign))

      const remote = join(directory, 'remote.git')
      git('init', '--bare', remote)
      git('remote', 'add', 'origin', remote)
      git('push', 'origin', 'update/lock')
      git('checkout', 'main')
      writeFileSync(join(cwd, 'flake.lock'), 'new lock\n')
      const bin = join(directory, 'bin')
      mkdirSync(bin)
      const argsPath = join(directory, 'pr-args')
      writeFileSync(
        join(bin, 'gh'),
        '#!/bin/sh\nif [ "$1" = pr ] && [ "$2" = create ]; then\n  printf "%s\\n" "$@" > "$GH_TEST_ARGS"\nfi\n',
        { mode: 0o755 },
      )
      const lock = Bun.spawnSync(
        ['bash', join(import.meta.dir, 'lock-update.sh')],
        {
          cwd,
          env: {
            ...process.env,
            BASE_BRANCH: 'main',
            BOT_NAME: 'update[bot]',
            GH_TEST_ARGS: argsPath,
            PATH: `${bin}:${process.env.PATH ?? ''}`,
          },
        },
      )
      expect(lock.exitCode).toBe(0)
      expect(lock.stdout.toString().includes('contains manual changes')).toBe(
        foreign,
      )
      expect(git('show', 'origin/update/lock:flake.lock')).toBe(
        foreign ? 'old lock' : 'new lock',
      )
      if (!foreign) {
        expect(readFileSync(argsPath, 'utf8')).toContain(
          '--label\nDependencies\n--label\nAuto Merge\n',
        )
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
