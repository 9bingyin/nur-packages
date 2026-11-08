import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('cache token refresh', () => {
  test.each([0, 7])(
    'refreshes during a running build and handles builder exit %i',
    async (buildExitCode) => {
      const directory = mkdtempSync(join(tmpdir(), 'cache-test-'))
      const audience = 'https://cache-test.invalid'
      let requests = 0
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch(request) {
          expect(new URL(request.url).searchParams.get('audience')).toBe(
            audience,
          )
          expect(request.headers.get('Authorization')).toBe('Bearer test-token')
          requests += 1
          return Response.json({ value: `test-oidc-${requests}` })
        },
      })
      try {
        const source = readFileSync(join(import.meta.dir, 'cache.ts'), 'utf8')
        const interval = 'const TOKEN_REFRESH_INTERVAL = 180_000'
        expect(source).toContain(interval)
        const script = join(directory, 'cache.ts')
        // Accelerate the interval without changing the process orchestration.
        writeFileSync(
          script,
          source.replace(interval, 'const TOKEN_REFRESH_INTERVAL = 20'),
        )
        const bin = join(directory, 'bin')
        mkdirSync(bin)
        const tokenPathLog = join(directory, 'token-path')
        writeFileSync(
          join(bin, 'nix-fast-build'),
          `#!${process.execPath}
import { readFileSync, writeFileSync } from 'node:fs'
if (!process.argv.includes('--no-nom') || !process.argv.includes('--no-fold')) {
  throw new Error('build logs must be visible without folding')
}
const path = process.env.NIKS3_AUTH_TOKEN_FILE
if (!path) throw new Error('missing token path')
writeFileSync(process.env.TEST_TOKEN_PATH_LOG, path)
const initial = readFileSync(path, 'utf8')
const deadline = Date.now() + 2000
while (readFileSync(path, 'utf8') === initial && Date.now() < deadline) {
  await Bun.sleep(10)
}
if (readFileSync(path, 'utf8') === initial) {
  console.error('token was not refreshed during build')
  process.exit(42)
}
process.exit(Number(process.env.TEST_BUILD_EXIT_CODE))
`,
          { mode: 0o755 },
        )
        const child = Bun.spawn([process.execPath, script], {
          cwd: directory,
          env: {
            ...process.env,
            ACTIONS_ID_TOKEN_REQUEST_URL: server.url.href,
            ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'test-token',
            NIKS3_SERVER: audience,
            PATH: `${bin}:${process.env.PATH ?? ''}`,
            SYSTEM: 'test-system',
            TEST_BUILD_EXIT_CODE: String(buildExitCode),
            TEST_TOKEN_PATH_LOG: tokenPathLog,
          },
          stdout: 'pipe',
          stderr: 'pipe',
        })
        const [exitCode, stderr] = await Promise.all([
          child.exited,
          new Response(child.stderr).text(),
        ])
        expect(exitCode).toBe(buildExitCode === 0 ? 0 : 1)
        expect(requests).toBeGreaterThan(1)
        expect(existsSync(readFileSync(tokenPathLog, 'utf8'))).toBe(false)
        if (buildExitCode === 0) {
          expect(stderr).toBe('')
        } else {
          expect(stderr).toContain(
            `nix-fast-build failed with exit code ${buildExitCode}`,
          )
        }
      } finally {
        server.stop(true)
        rmSync(directory, { recursive: true, force: true })
      }
    },
  )
})
