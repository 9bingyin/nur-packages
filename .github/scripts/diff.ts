#!/usr/bin/env nix
/*
#! nix shell --inputs-from . nixpkgs#bun --command bun
*/

import { appendFileSync } from 'node:fs'

export type ChangedFile = Readonly<{
  newMode: string
  oldMode: string
  path: string
  status: 'A' | 'D' | 'M'
}>

export type PathPolicy =
  | Readonly<{ kind: 'ignore' }>
  | Readonly<{ kind: 'lock' }>
  | Readonly<{ kind: 'package'; name: string }>
  | Readonly<{ kind: 'reject'; reason: string }>

const PACKAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9+._-]*$/

export function pathPolicy(branch: string): PathPolicy {
  if (branch === 'update/lock') {
    return { kind: 'lock' }
  }
  if (!branch.startsWith('update/')) {
    return { kind: 'ignore' }
  }
  const name = branch.slice('update/'.length)
  if (!PACKAGE_NAME.test(name)) {
    return { kind: 'reject', reason: `invalid update branch: ${branch}` }
  }
  return { kind: 'package', name }
}

export function parseRawDiff(value: string): readonly ChangedFile[] {
  const parts = value.split('\0')
  if (parts.at(-1) === '') {
    parts.pop()
  }
  if (parts.length % 2 !== 0) {
    throw new Error('git diff --raw returned an incomplete entry')
  }
  const files: ChangedFile[] = []
  for (let index = 0; index < parts.length; index += 2) {
    const header = parts[index] ?? ''
    const path = parts[index + 1] ?? ''
    const match = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([ADM])$/.exec(header)
    if (!match || path.length === 0) {
      throw new Error(`Unsupported git diff entry: ${header} ${path}`)
    }
    const status = match[3]
    if (status !== 'A' && status !== 'D' && status !== 'M') {
      throw new Error(`Unsupported git diff status: ${status}`)
    }
    files.push({
      newMode: match[2] ?? '',
      oldMode: match[1] ?? '',
      path,
      status,
    })
  }
  return files
}

function regularFile(file: ChangedFile): boolean {
  return [file.oldMode, file.newMode]
    .filter((mode) => mode !== '000000')
    .every((mode) => mode === '100644')
}

export function diffViolation(
  policy: PathPolicy,
  files: readonly ChangedFile[],
): string | null {
  if (policy.kind === 'ignore') {
    return null
  }
  if (policy.kind === 'reject') {
    return policy.reason
  }
  if (files.length === 0) {
    return 'update branch does not change any files'
  }
  for (const file of files) {
    if (!regularFile(file)) {
      return `${file.path} has an unsafe file mode`
    }
    const allowed =
      policy.kind === 'lock'
        ? file.path === 'flake.lock'
        : file.path.startsWith(`packages/${policy.name}/`)
    if (!allowed) {
      return `${file.path} is outside the update branch`
    }
  }
  return null
}

async function command(args: readonly string[]): Promise<string> {
  const result = Bun.spawnSync([...args], {
    stderr: 'pipe',
    stdout: 'pipe',
  })
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()
    throw new Error(
      `${args.join(' ')} failed with exit code ${result.exitCode}${stderr === '' ? '' : `: ${stderr}`}`,
    )
  }
  return result.stdout.toString()
}

async function main(): Promise<void> {
  const headRef = process.env.HEAD_REF ?? ''
  const baseSha = process.env.BASE_SHA ?? ''
  const headSha = process.env.HEAD_SHA ?? ''
  if (headRef === '' || baseSha === '' || headSha === '') {
    throw new Error('HEAD_REF, BASE_SHA and HEAD_SHA are required')
  }
  const branch = headRef
  const policy = pathPolicy(branch)
  const files = parseRawDiff(
    await command([
      'git',
      'diff',
      '--raw',
      '-z',
      '--no-renames',
      `${baseSha}...${headSha}`,
    ]),
  )
  const violation = diffViolation(policy, files)
  const summary = [
    '## Diff',
    '',
    `- Branch: \`${branch}\``,
    `- Files: ${files.length}`,
    violation === null ? '- Result: allowed' : `- Result: ${violation}`,
    '',
  ].join('\n')
  console.log(summary)
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (summaryPath !== undefined) {
    appendFileSync(summaryPath, summary)
  }
  if (violation !== null) {
    throw new Error(violation)
  }
}

if (import.meta.main) {
  await main()
}
