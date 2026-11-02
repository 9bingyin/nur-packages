import { describe, expect, test } from 'bun:test'
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
