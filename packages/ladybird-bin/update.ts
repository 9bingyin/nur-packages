#!/usr/bin/env nix
/*
#! nix shell --inputs-from . nixpkgs#bun --command bun
*/
/** Update Ladybird (aarch64-darwin) from the official release manifest. */

import { join } from 'node:path'
import process from 'node:process'

const MANIFEST_URL = 'https://download.ladybird.org/releases.json'
const PACKAGE_PATH = join(import.meta.dir, 'package.nix')
const USER_AGENT = 'nur-packages (+https://github.com/9bingyin/nur-packages)'
const VERSION_RE = /^\d+(?:\.\d+)*$/
const SHA256_RE = /^[a-f0-9]{64}$/i

type ManifestDownload = Readonly<{
  architecture?: string
  name: string
  platform: string
  sha256: string
  url: string
}>

type ManifestRelease = Readonly<{
  downloads: readonly ManifestDownload[]
  version: string
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function run(command: readonly string[], capture = false): string {
  if (command.length === 0) {
    throw new Error('Command must not be empty')
  }
  const result = Bun.spawnSync([...command], {
    stderr: 'inherit',
    stdout: capture ? 'pipe' : 'inherit',
  })
  if (result.exitCode !== 0) {
    throw new Error(
      `Command failed with exit code ${result.exitCode}: ${command.join(' ')}`,
    )
  }
  if (!capture) {
    return ''
  }
  if (result.stdout === undefined) {
    throw new Error(`Command produced no stdout: ${command.join(' ')}`)
  }
  return result.stdout.toString()
}

function compareVersionsDescending(left: string, right: string): number {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0
    const rightValue = rightParts[index] ?? 0
    if (leftValue !== rightValue) {
      return rightValue - leftValue
    }
  }
  return 0
}

function downloadUrl(version: string): string {
  return `https://download.ladybird.org/macos/${version}/ladybird-${version}-macOS-arm64.dmg`
}

function parseDownload(value: unknown): ManifestDownload {
  if (!isRecord(value)) {
    throw new Error('Ladybird release download entry is not an object')
  }
  const { architecture, name, platform, sha256, url } = value
  if (
    typeof name !== 'string' ||
    typeof platform !== 'string' ||
    typeof sha256 !== 'string' ||
    !SHA256_RE.test(sha256) ||
    typeof url !== 'string'
  ) {
    throw new Error('Ladybird release download entry is invalid')
  }
  return {
    architecture: typeof architecture === 'string' ? architecture : undefined,
    name,
    platform,
    sha256: sha256.toLowerCase(),
    url,
  }
}

function parseRelease(value: unknown): ManifestRelease {
  if (!isRecord(value)) {
    throw new Error('Ladybird release entry is not an object')
  }
  const { downloads, version } = value
  if (
    typeof version !== 'string' ||
    !VERSION_RE.test(version) ||
    !Array.isArray(downloads)
  ) {
    throw new Error('Ladybird release entry is invalid')
  }
  return {
    downloads: downloads.map(parseDownload),
    version,
  }
}

async function latestRelease(): Promise<
  Readonly<{
    sha256: string
    url: string
    version: string
  }>
> {
  const response = await fetch(MANIFEST_URL, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    throw new Error(
      `Ladybird release manifest returned HTTP ${response.status} ${response.statusText}`,
    )
  }
  const payload: unknown = await response.json()
  if (
    !isRecord(payload) ||
    payload.format !== 1 ||
    !Array.isArray(payload.releases)
  ) {
    throw new Error('Ladybird release manifest has an unexpected format')
  }
  const releases = payload.releases
    .map(parseRelease)
    .sort((left, right) =>
      compareVersionsDescending(left.version, right.version),
    )
  for (const release of releases) {
    const asset = release.downloads.find(
      (entry) =>
        entry.platform === 'macOS' &&
        entry.architecture === 'arm64' &&
        /\.dmg$/i.test(entry.name),
    )
    if (asset === undefined) {
      continue
    }
    const expectedUrl = downloadUrl(release.version)
    if (asset.url !== expectedUrl) {
      throw new Error(
        `Ladybird macOS asset was renamed or moved: ${JSON.stringify(asset.url)}`,
      )
    }
    return {
      sha256: asset.sha256,
      url: asset.url,
      version: release.version,
    }
  }
  throw new Error('No Ladybird release has a macOS arm64 DMG artifact')
}

function hexSha256ToSri(hex: string): string {
  return `sha256-${Buffer.from(hex, 'hex').toString('base64')}`
}

function prefetchSriHash(url: string, expectedSha256: string): string {
  const payload: unknown = JSON.parse(
    run(['nix', 'store', 'prefetch-file', '--json', url], true),
  )
  if (!isRecord(payload)) {
    throw new Error(
      `nix store prefetch-file returned an invalid payload for ${url}`,
    )
  }
  const hashValue = payload.hash
  if (typeof hashValue !== 'string' || !hashValue.startsWith('sha256-')) {
    throw new Error(`nix store prefetch-file returned no SRI hash for ${url}`)
  }
  const expected = hexSha256ToSri(expectedSha256)
  if (hashValue !== expected) {
    throw new Error(
      `Checksum mismatch for ${url}: expected ${expected}, got ${hashValue}`,
    )
  }
  return hashValue
}

function currentVersion(packageText: string): string {
  const match = /^ {2}version = "([^"]+)";/m.exec(packageText)
  if (match?.[1] === undefined) {
    throw new Error('Failed to read current Ladybird version')
  }
  return match[1]
}

function replaceOnce(
  text: string,
  pattern: string,
  replacement: string,
  error: string,
): string {
  const expression = new RegExp(pattern, 'm')
  if (expression.exec(text) === null) {
    throw new Error(error)
  }
  expression.lastIndex = 0
  return text.replace(expression, replacement)
}

async function main(): Promise<void> {
  const packageText = await Bun.file(PACKAGE_PATH).text()
  const release = await latestRelease()
  if (currentVersion(packageText) === release.version) {
    console.log(`ladybird-bin is already at ${release.version}`)
    return
  }

  const hash = prefetchSriHash(release.url, release.sha256)
  const updated = replaceOnce(
    replaceOnce(
      packageText,
      '^  version = "[^"]+";',
      `  version = "${release.version}";`,
      'Failed to update Ladybird version',
    ),
    '(hash = ")[^"]+(";)',
    `$1${hash}$2`,
    'Failed to update Ladybird hash',
  )
  await Bun.write(PACKAGE_PATH, updated)
}

try {
  await main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`error: ${message}`)
  process.exitCode = 1
}
