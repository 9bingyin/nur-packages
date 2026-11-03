#!/usr/bin/env nix
/*
#! nix shell --inputs-from . nixpkgs#bun nixpkgs#nix-fast-build nixpkgs#niks3 --command bun
*/

import {
  chmodSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const TOKEN_REFRESH_INTERVAL = 180_000
const TOKEN_REFRESH_RETRY_INTERVAL = 15_000

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`${name} is required`)
  }
  return value
}

function sleep(milliseconds: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(true), milliseconds)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve(false)
      },
      { once: true },
    )
  })
}

async function fetchOidcToken(audience: string): Promise<string> {
  const requestUrl = new URL(required('ACTIONS_ID_TOKEN_REQUEST_URL'))
  requestUrl.searchParams.set('audience', audience)
  const response = await fetch(requestUrl, {
    headers: {
      Authorization: `Bearer ${required('ACTIONS_ID_TOKEN_REQUEST_TOKEN')}`,
    },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    throw new Error(`GitHub OIDC request failed with status ${response.status}`)
  }
  const payload = (await response.json()) as { value?: unknown }
  if (typeof payload.value !== 'string' || payload.value === '') {
    throw new Error('GitHub OIDC response has no token')
  }
  return payload.value
}

async function writeOidcToken(path: string, audience: string): Promise<void> {
  const temporary = `${path}.new`
  writeFileSync(temporary, await fetchOidcToken(audience), { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, path)
}

async function refreshOidcToken(
  path: string,
  audience: string,
  signal: AbortSignal,
): Promise<void> {
  while (await sleep(TOKEN_REFRESH_INTERVAL, signal)) {
    while (!signal.aborted) {
      try {
        await writeOidcToken(path, audience)
        break
      } catch (error) {
        console.warn(`Failed to refresh niks3 OIDC token: ${String(error)}`)
        await sleep(TOKEN_REFRESH_RETRY_INTERVAL, signal)
      }
    }
  }
}

async function main(): Promise<void> {
  const system = required('SYSTEM')
  const server = required('NIKS3_SERVER')
  const directory = mkdtempSync(join(tmpdir(), 'niks3-auth-'))
  const tokenPath = join(directory, 'token')
  const controller = new AbortController()
  try {
    await writeOidcToken(tokenPath, server)
    const refresh = refreshOidcToken(tokenPath, server, controller.signal)
    try {
      const child = Bun.spawn(
        [
          'nix-fast-build',
          '--flake',
          `path:${process.cwd()}#packages.${system}`,
          '--systems',
          system,
          '--skip-cached',
          '--eval-workers',
          '1',
          '--no-nom',
          '--niks3-server',
          server,
          '--result-format',
          'json',
          '--result-file',
          `cache-${system}.json`,
        ],
        {
          env: { ...process.env, NIKS3_AUTH_TOKEN_FILE: tokenPath },
          stderr: 'inherit',
          stdout: 'inherit',
        },
      )
      const exitCode = await child.exited
      if (exitCode !== 0) {
        throw new Error(`nix-fast-build failed with exit code ${exitCode}`)
      }
    } finally {
      controller.abort()
      await refresh
    }
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

if (import.meta.main) {
  await main()
}
