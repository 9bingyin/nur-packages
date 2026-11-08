import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  commandForUpdate,
  filesAllowed,
  parseUpdateScripts,
  rewritePath,
  updateTitle,
  versionAccepted,
} from './package-update.ts'

describe('rewritePath', () => {
  test('maps flake store paths back to the worktree', () => {
    expect(
      rewritePath(
        '/nix/store/source',
        '/tmp/worktree',
        '/nix/store/source/packages/vocat/update.ts',
      ),
    ).toBe('/tmp/worktree/packages/vocat/update.ts')
  })

  test('leaves store tools untouched', () => {
    expect(
      rewritePath(
        '/nix/store/source',
        '/tmp/worktree',
        '/nix/store/nix-update/bin/nix-update',
      ),
    ).toBe('/nix/store/nix-update/bin/nix-update')
  })
})

describe('versionAccepted', () => {
  test('allows nix-update to keep the same version', () => {
    expect(versionAccepted('1.0.0', '1.0.0', [], [])).toBe(true)
  })

  test('requires a custom script to change the version', () => {
    expect(versionAccepted('1.0.0', '1.0.0', ['commit'], [])).toBe(false)
    expect(
      versionAccepted('1.0.0', '1.0.0', ['commit', 'same-version'], [null]),
    ).toBe(false)
    expect(
      versionAccepted(
        '1.0.0',
        '1.0.0',
        ['commit', 'same-version'],
        ['vocat: refresh'],
      ),
    ).toBe(true)
  })
})

describe('updateTitle', () => {
  test('prefers the script commit message', () => {
    expect(updateTitle('sparkle', '1', '2', ['sparkle: 1 -> 2'])).toBe(
      'sparkle: 1 -> 2',
    )
  })
})

describe('filesAllowed', () => {
  test('rejects files outside the package directory', () => {
    expect(
      filesAllowed('vocat', [
        {
          newMode: '100644',
          oldMode: '100644',
          path: 'flake.lock',
          status: 'M',
        },
      ]),
    ).toMatch(/outside/)
  })
})

describe('parseUpdateScripts', () => {
  test('skips packages without an update script', () => {
    expect(parseUpdateScripts({ vocat: null }).get('vocat')).toBeNull()
  })

  test('keeps the derivation context of a nix-update command', () => {
    const script = parseUpdateScripts({
      surge: {
        argv: [
          {
            drvPaths: ['/nix/store/nix-update.drv'],
            path: '/nix/store/nix-update/bin/nix-update',
          },
          { drvPaths: [], path: '--version-regex=^v(.+)$' },
        ],
        attrPath: 'surge',
        name: 'surge-0.12.4',
        oldVersion: '0.12.4',
        pname: 'surge',
        sourceRoot: '/nix/store/source',
        supportedFeatures: [],
      },
    }).get('surge')
    expect(script?.argv[0]?.drvPaths).toEqual(['/nix/store/nix-update.drv'])
    expect(script?.supportedFeatures).toEqual([])
  })
})

describe('Nix logs', () => {
  test.each([0, 9])(
    'keeps logs visible when realisation exits %i',
    (exitCode) => {
      const directory = mkdtempSync(join(tmpdir(), 'update-logs-'))
      const bin = join(directory, 'bin')
      mkdirSync(bin)
      try {
        const commands = {
          git: `#!/bin/sh
case "$*" in
  *rev-parse*) echo base ;;
  *"diff --raw"*) printf ':100644 100644 0000000 1111111 M\\0packages/test/package.nix\\0' ;;
  fetch*refs/heads/*) exit 1 ;;
esac
`,
          gh: '#!/bin/sh\necho 1\n',
          nix: `#!${process.execPath}
if (!process.argv.includes('--print-build-logs')) throw new Error('missing build logs flag')
if (process.argv.includes('--json')) {
  console.error('discovery log')
  console.log(process.env.TEST_UPDATE_SCRIPT)
} else {
  console.error('version log')
  console.log('2.0.0')
}
`,
          'nix-store': `#!/bin/sh
echo 'realisation log' >&2
exit ${exitCode}
`,
          'test-updater': '#!/bin/sh\nexit 0\n',
        }
        for (const [name, content] of Object.entries(commands)) {
          writeFileSync(join(bin, name), content, { mode: 0o755 })
        }
        const result = Bun.spawnSync(
          [process.execPath, join(import.meta.dir, 'package-update.ts')],
          {
            cwd: directory,
            env: {
              ...process.env,
              BOT_NAME: 'update[bot]',
              GH_TOKEN: 'test-token',
              GITHUB_STEP_SUMMARY: join(directory, 'summary'),
              PACKAGES: '',
              PATH: `${bin}:${process.env.PATH ?? ''}`,
              SYSTEM: 'x86_64-linux',
              TEST_UPDATE_SCRIPT: JSON.stringify({
                test: {
                  argv: [
                    { path: 'test-updater', drvPaths: ['/nix/store/test.drv'] },
                  ],
                  attrPath: 'test',
                  name: 'test-1.0.0',
                  oldVersion: '1.0.0',
                  pname: 'test',
                  sourceRoot: directory,
                  supportedFeatures: [],
                },
              }),
            },
          },
        )
        const stderr = result.stderr.toString()
        expect(result.exitCode, stderr).toBe(exitCode === 0 ? 0 : 1)
        expect(stderr).toContain('discovery log')
        expect(stderr).toContain('realisation log')
        if (exitCode === 0) {
          expect(stderr).toContain('version log')
          expect(result.stdout.toString()).toContain('test: 1.0.0 -> 2.0.0')
        } else {
          expect(stderr).toContain(
            'nix-store --realise /nix/store/test.drv failed',
          )
        }
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    },
  )
})

describe('commandForUpdate', () => {
  test('adds flake mode for nix-update 1.16', () => {
    expect(
      commandForUpdate([
        '/nix/store/nix-update/bin/nix-update',
        '--version-regex=^v(.+)$',
      ]),
    ).toEqual([
      '/nix/store/nix-update/bin/nix-update',
      '--version-regex=^v(.+)$',
      '--flake',
    ])
  })

  test('leaves an explicit flake flag in place', () => {
    expect(commandForUpdate(['nix-update', '--flake'])).toEqual([
      'nix-update',
      '--flake',
    ])
  })
})
