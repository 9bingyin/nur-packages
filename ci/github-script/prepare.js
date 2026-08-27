// @ts-check

const SHA_PATTERN = /^[0-9a-f]{40}$/
const RETRY_INTERVALS_SECONDS = [5, 10, 20, 40, 80]

function validateSha(name, value) {
  if (!SHA_PATTERN.test(value)) {
    throw new Error(`${name} is not a full commit SHA: ${value}`)
  }
  return value
}

async function readSystems({ github, context, ref }) {
  const response = await github.rest.repos.getContent({
    ...context.repo,
    path: 'ci/systems.json',
    ref,
  })
  const { content, encoding } = response.data
  const entries = JSON.parse(Buffer.from(content, encoding).toString())
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('ci/systems.json must contain a non-empty array')
  }

  const systems = entries.map((entry) => entry?.system)
  if (!systems.every((system) => typeof system === 'string' && system)) {
    throw new Error('Every ci/systems.json entry must contain a system')
  }
  if (new Set(systems).size !== systems.length) {
    throw new Error('ci/systems.json contains duplicate systems')
  }
  return systems
}

async function pullRequestInfo({ github, context, core }) {
  const pullNumber = context.payload.pull_request?.number
  if (!pullNumber) {
    throw new Error('prepare requires a pull_request_target event')
  }

  for (const retryInterval of RETRY_INTERVALS_SECONDS) {
    const response = await github.rest.pulls.get({
      ...context.repo,
      pull_number: pullNumber,
    })
    const pullRequest = response.data
    if (pullRequest.state !== 'open') {
      throw new Error('The pull request is no longer open')
    }
    if (pullRequest.mergeable !== null) {
      return pullRequest
    }

    core.info(
      `GitHub is still computing mergeability; retrying in ${retryInterval} seconds`,
    )
    await new Promise((resolve) => setTimeout(resolve, retryInterval * 1000))
  }

  throw new Error('GitHub did not finish computing pull request mergeability')
}

module.exports = async ({ github, context, core }) => {
  const pullRequest = await pullRequestInfo({ github, context, core })
  const { base, head } = pullRequest
  if (!base.repo?.full_name || !head.repo?.full_name) {
    throw new Error('The pull request base or head repository is unavailable')
  }
  const headSha = validateSha('headSha', head.sha)

  let mergedRepository
  let mergedSha
  let targetSha
  if (pullRequest.mergeable) {
    mergedRepository = base.repo.full_name
    mergedSha = validateSha('mergedSha', pullRequest.merge_commit_sha)
    const mergeCommit = await github.rest.repos.getCommit({
      ...context.repo,
      ref: mergedSha,
    })
    const firstParent = mergeCommit.data.parents[0]?.sha
    targetSha = validateSha('targetSha', firstParent)
    core.info('The pull request is mergeable; checking its test merge commit')
  } else {
    mergedRepository = head.repo.full_name
    mergedSha = headSha
    const comparison = await github.rest.repos.compareCommitsWithBasehead({
      ...context.repo,
      basehead: `${base.label}...${head.label}`,
    })
    targetSha = validateSha(
      'targetSha',
      comparison.data.merge_base_commit.sha,
    )
    core.warning(
      'The pull request has conflicts; checking its head against the merge base',
    )
  }

  const systems = await readSystems({
    github,
    context,
    ref: targetSha,
  })
  const files = (
    await github.paginate(github.rest.pulls.listFiles, {
      ...context.repo,
      pull_number: pullRequest.number,
      per_page: 100,
    })
  ).map((file) => file.filename)

  core.info(`base branch: ${base.ref}`)
  core.info(`head branch: ${head.ref}`)
  core.info(`head SHA: ${headSha}`)
  core.info(`merged repository: ${mergedRepository}`)
  core.info(`merged SHA: ${mergedSha}`)
  core.info(`target SHA: ${targetSha}`)
  core.info(`systems: ${systems.join(', ')}`)

  core.setOutput('baseBranch', base.ref)
  core.setOutput('headBranch', head.ref)
  core.setOutput('headSha', headSha)
  core.setOutput('mergedRepository', mergedRepository)
  core.setOutput('mergedSha', mergedSha)
  core.setOutput('targetSha', targetSha)
  core.setOutput('systems', JSON.stringify(systems))
  core.setOutput('files', JSON.stringify(files))
}
