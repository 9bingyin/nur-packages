#!/usr/bin/env nix
/*
#! nix shell --inputs-from . nixpkgs#bun --command bun
*/
/** Update Motty, its pinned Viva revision, and its Go vendor hash. */

import { join } from 'node:path'
import process from 'node:process'

const ROOT = join(import.meta.dir, '../..')
const PACKAGE_PATH = join(import.meta.dir, 'package.nix')
const RELEASES_URL = 'https://api.github.com/repos/t8y2/motty/releases/latest'
const USER_AGENT = 'nur-packages (+https://github.com/9bingyin/nur-packages)'
const VERSION_RE = /^\d+(?:\.\d+)+$/
const VIVA_REV_RE = /^Built against vivaui\/viva `([0-9a-f]{40})`\.$/m
const GOT_HASH_RE = /got:\s+(sha256-[A-Za-z0-9+/=]+)/
const FAKE_HASH = 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

type ReleaseInfo = Readonly<{
  tag: string
  version: string
  vivaRev: string
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function run(
  command: readonly string[],
  options: Readonly<{ allowFailure?: boolean; capture?: boolean }> = {},
): Readonly<{ exitCode: number; stderr: string; stdout: string }> {
  const result = Bun.spawnSync([...command], {
    cwd: ROOT,
    stderr: options.capture ? 'pipe' : 'inherit',
    stdout: options.capture ? 'pipe' : 'inherit',
  })
  const stdout = result.stdout?.toString() ?? ''
  const stderr = result.stderr?.toString() ?? ''
  if (!options.allowFailure && result.exitCode !== 0) {
    throw new Error(
      `Command failed with exit code ${result.exitCode}: ${command.join(' ')}\n${stderr.trim()}`,
    )
  }
  return { exitCode: result.exitCode, stderr, stdout }
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
  }
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  if (token !== undefined && token !== '') {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

async function latestRelease(): Promise<ReleaseInfo> {
  const response = await fetch(RELEASES_URL, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    throw new Error(
      `GitHub latest release request failed with HTTP ${response.status} ${response.statusText}`,
    )
  }
  const payload: unknown = await response.json()
  if (
    !isRecord(payload) ||
    typeof payload.tag_name !== 'string' ||
    typeof payload.body !== 'string'
  ) {
    throw new Error('GitHub latest release payload has an unexpected shape')
  }
  const tag = payload.tag_name
  const version = tag.replace(/^v/, '')
  if (!VERSION_RE.test(version)) {
    throw new Error(`Unexpected Motty release tag: ${JSON.stringify(tag)}`)
  }
  const vivaRev = VIVA_REV_RE.exec(payload.body)?.[1]
  if (vivaRev === undefined) {
    throw new Error(
      `Release ${tag} notes did not declare a vivaui/viva commit SHA`,
    )
  }
  return { tag, version, vivaRev }
}

function prefetchUnpackedHash(url: string): string {
  const payload: unknown = JSON.parse(
    run(['nix', 'store', 'prefetch-file', '--unpack', '--json', url], {
      capture: true,
    }).stdout,
  )
  if (
    !isRecord(payload) ||
    typeof payload.hash !== 'string' ||
    !payload.hash.startsWith('sha256-')
  ) {
    throw new Error(`nix store prefetch-file returned no SRI hash for ${url}`)
  }
  return payload.hash
}

function replaceOnce(
  text: string,
  pattern: RegExp,
  replacement: string,
  error: string,
): string {
  if (!pattern.test(text)) {
    throw new Error(error)
  }
  return text.replace(pattern, replacement)
}

function currentState(
  text: string,
): Readonly<{ version: string; vivaRev: string }> {
  const version = /^ {2}version = "([^"]+)";/m.exec(text)?.[1]
  const vivaRev = /repo = "viva";\s+rev = "([0-9a-f]{40})";/s.exec(text)?.[1]
  if (version === undefined || vivaRev === undefined) {
    throw new Error('Failed to read current Motty version or Viva revision')
  }
  return { version, vivaRev }
}

function defaultSystem(): string {
  return process.arch === 'arm64' ? 'aarch64-linux' : 'x86_64-linux'
}

function computeVendorHash(): string {
  const system = process.env.SYSTEM ?? defaultSystem()
  const result = run(
    ['nix', 'build', '--no-link', `.#packages.${system}.motty.goModules`],
    { allowFailure: true, capture: true },
  )
  const hash = GOT_HASH_RE.exec(`${result.stderr}\n${result.stdout}`)?.[1]
  if (hash === undefined) {
    throw new Error(
      `Failed to extract vendorHash from goModules build output:\n${result.stderr}`,
    )
  }
  return hash
}

async function main(): Promise<void> {
  const original = await Bun.file(PACKAGE_PATH).text()
  const current = currentState(original)
  const release = await latestRelease()
  if (
    current.version === release.version &&
    current.vivaRev === release.vivaRev
  ) {
    console.log(
      `motty is already at ${release.version} (viva ${release.vivaRev.slice(0, 12)})`,
    )
    return
  }

  const mottyHash = prefetchUnpackedHash(
    `https://github.com/t8y2/motty/archive/refs/tags/${release.tag}.tar.gz`,
  )
  const vivaHash = prefetchUnpackedHash(
    `https://github.com/vivaui/viva/archive/${release.vivaRev}.tar.gz`,
  )

  let updated = replaceOnce(
    original,
    /^ {2}version = "[^"]+";/m,
    `  version = "${release.version}";`,
    'Failed to update Motty version',
  )
  updated = replaceOnce(
    updated,
    /(repo = "motty";\s+tag = "v\$\{finalAttrs\.version\}";\s+hash = ")[^"]+(";)/s,
    `$1${mottyHash}$2`,
    'Failed to update Motty source hash',
  )
  updated = replaceOnce(
    updated,
    /(repo = "viva";\s+rev = ")[0-9a-f]{40}(";\s+hash = ")[^"]+(";)/s,
    `$1${release.vivaRev}$2${vivaHash}$3`,
    'Failed to update Viva revision and hash',
  )

  const withFakeVendor = replaceOnce(
    updated,
    /^ {2}vendorHash = "[^"]+";/m,
    `  vendorHash = "${FAKE_HASH}";`,
    'Failed to set placeholder vendorHash',
  )
  await Bun.write(PACKAGE_PATH, withFakeVendor)

  try {
    const vendorHash = computeVendorHash()
    const finalText = replaceOnce(
      updated,
      /^ {2}vendorHash = "[^"]+";/m,
      `  vendorHash = "${vendorHash}";`,
      'Failed to update vendorHash',
    )
    await Bun.write(PACKAGE_PATH, finalText)
  } catch (error) {
    await Bun.write(PACKAGE_PATH, original)
    throw error
  }
}

try {
  await main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`error: ${message}`)
  process.exitCode = 1
}
