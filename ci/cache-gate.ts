import { mkdirSync, rmSync } from "node:fs";
import process from "node:process";
import { parseEvalReport, type ReviewRevision } from "./eval-compare.ts";
import { githubRepository, githubRequest } from "./github.ts";
import {
	compactJson,
	isRecord,
	readJsonFile,
	readSystems,
	requiredEnvironment,
	requireRecord,
	requireString,
	run,
	writeOutput,
} from "./lib.ts";
import { validateMergeParents } from "./prepare-pr.ts";
import { parseRawDiff } from "./update.ts";

const DEPENDABOT_USER_ID = 49_699_333;
const UPDATE_PROVENANCE_CONTEXT = "update provenance";
const EXPECTED_WORKFLOW_PATH = ".github/workflows/pull-request-target.yml";
const PRIVILEGED_WORKFLOWS = new Set([
	".github/workflows/build-cache.yml",
	".github/workflows/build.yml",
	".github/workflows/cache-pr.yml",
	".github/workflows/cache.yml",
	".github/workflows/check.yml",
	".github/workflows/eval.yml",
	".github/workflows/lint.yml",
	".github/workflows/pull-request-target.yml",
	".github/workflows/review.yml",
	".github/workflows/update-dependencies.yml",
]);
const ACTION_REFERENCE_PATTERN =
	/^\s*uses:\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?)@([0-9a-f]{40})(?:\s+#.*)?$/;

type CacheMode = "auto" | "manual";

type PullRequestInfo = Readonly<{
	baseRef: string;
	baseSha: string;
	draft: boolean;
	headRef: string;
	headRepository: string;
	headRepositoryId: number;
	headSha: string;
	mergeCommitSha: string | null;
	mergeable: boolean | null;
	number: number;
	state: string;
	userId: number;
	userLogin: string;
	userType: string;
}>;

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
	return value;
}

function parsePullRequest(value: unknown): PullRequestInfo {
	const pullRequest = requireRecord(value, "pull request");
	const base = requireRecord(pullRequest.base, "pull request.base");
	const head = requireRecord(pullRequest.head, "pull request.head");
	const headRepository = requireRecord(head.repo, "pull request.head.repo");
	const user = requireRecord(pullRequest.user, "pull request.user");
	const mergeable = pullRequest.mergeable;
	const mergeCommitSha = pullRequest.merge_commit_sha;
	if (mergeable !== null && typeof mergeable !== "boolean") {
		throw new Error("pull request.mergeable must be boolean or null");
	}
	if (mergeCommitSha !== null && typeof mergeCommitSha !== "string") {
		throw new Error("pull request.merge_commit_sha must be string or null");
	}
	if (typeof pullRequest.draft !== "boolean") {
		throw new Error("pull request.draft must be boolean");
	}
	return {
		baseRef: requireString(base.ref, "pull request.base.ref"),
		baseSha: requireString(base.sha, "pull request.base.sha"),
		draft: pullRequest.draft,
		headRef: requireString(head.ref, "pull request.head.ref"),
		headRepository: requireString(
			headRepository.full_name,
			"pull request.head.repo.full_name",
		),
		headRepositoryId: positiveInteger(
			headRepository.id,
			"pull request.head.repo.id",
		),
		headSha: requireString(head.sha, "pull request.head.sha"),
		mergeCommitSha,
		mergeable,
		number: positiveInteger(pullRequest.number, "pull request.number"),
		state: requireString(pullRequest.state, "pull request.state"),
		userId: positiveInteger(user.id, "pull request.user.id"),
		userLogin: requireString(user.login, "pull request.user.login"),
		userType: requireString(user.type, "pull request.user.type"),
	};
}

async function validateWorkflowRun(revision: ReviewRevision): Promise<void> {
	const run = requireRecord(
		await githubRequest(
			`/repos/${githubRepository()}/actions/runs/${revision.runId}`,
		),
		"workflow run",
	);
	const repository = requireRecord(run.repository, "workflow run.repository");
	const expectedWorkflowRef = `${githubRepository()}/${EXPECTED_WORKFLOW_PATH}@refs/heads/${revision.baseBranch}`;
	if (
		run.event !== "pull_request_target" ||
		run.conclusion !== "success" ||
		run.path !== EXPECTED_WORKFLOW_PATH ||
		run.run_attempt !== revision.runAttempt ||
		run.head_sha !== revision.workflowSha ||
		revision.workflowSha !== revision.baseSha ||
		revision.workflowRef !== expectedWorkflowRef ||
		repository.id !== revision.repositoryId
	) {
		throw new Error(
			"The review workflow run does not match the trusted policy",
		);
	}
	const artifacts = requireRecord(
		await githubRequest(
			`/repos/${githubRepository()}/actions/runs/${revision.runId}/artifacts?per_page=100`,
		),
		"workflow artifacts",
	);
	if (
		!Array.isArray(artifacts.artifacts) ||
		artifacts.artifacts.filter(
			(artifact) => isRecord(artifact) && artifact.name === "comparison",
		).length !== 1
	) {
		throw new Error(
			"The review workflow must contain exactly one comparison artifact",
		);
	}
}

async function validateMergeCommit(revision: ReviewRevision): Promise<void> {
	const commit = requireRecord(
		await githubRequest(
			`/repos/${githubRepository()}/commits/${revision.mergedSha}`,
		),
		"merge commit",
	);
	if (!Array.isArray(commit.parents)) {
		throw new Error("Merge commit parents must be an array");
	}
	const parents = commit.parents.map((parent, index) =>
		requireString(
			requireRecord(parent, `merge commit parent ${index}`).sha,
			`merge commit parent ${index}.sha`,
		),
	);
	validateMergeParents(parents, revision.baseSha, revision.headSha);
}

async function hasProvenance(sha: string, botUserId: number): Promise<boolean> {
	const response = requireRecord(
		await githubRequest(`/repos/${githubRepository()}/commits/${sha}/status`),
		"commit status",
	);
	if (!Array.isArray(response.statuses)) {
		return false;
	}
	return response.statuses.some((item) => {
		const status = isRecord(item) ? item : {};
		const creator = isRecord(status.creator) ? status.creator : {};
		return (
			status.context === UPDATE_PROVENANCE_CONTEXT &&
			status.state === "success" &&
			creator.id === botUserId
		);
	});
}

function regularFiles(files: ReturnType<typeof parseRawDiff>): boolean {
	return files.every((file) =>
		[file.oldMode, file.newMode]
			.filter((mode) => mode !== "000000")
			.every((mode) => mode === "100644"),
	);
}

export function ownBotDiffAllowed(
	headRef: string,
	files: ReturnType<typeof parseRawDiff>,
): boolean {
	if (!headRef.startsWith("update/") || !regularFiles(files)) {
		return false;
	}
	const target = headRef.slice("update/".length);
	if (!/^[A-Za-z0-9][A-Za-z0-9+._-]*$/.test(target)) {
		return false;
	}
	return (
		files.length > 0 &&
		(files.every((file) => file.path === "flake.lock") ||
			files.every((file) => file.path.startsWith(`packages/${target}/`)))
	);
}

function actionChangesOnly(diff: string): boolean {
	const removed: string[] = [];
	const added: string[] = [];
	for (const line of diff.split("\n")) {
		if (
			line.startsWith("diff --git ") ||
			line.startsWith("index ") ||
			line.startsWith("--- ") ||
			line.startsWith("+++ ") ||
			line.startsWith("@@") ||
			line.length === 0
		) {
			continue;
		}
		if (line.startsWith("-") || line.startsWith("+")) {
			const match = ACTION_REFERENCE_PATTERN.exec(line.slice(1));
			if (!match) {
				return false;
			}
			(line.startsWith("-") ? removed : added).push(match[1] ?? "");
			continue;
		}
		return false;
	}
	return (
		removed.length > 0 &&
		removed.length === added.length &&
		removed.every((action, index) => action === added[index])
	);
}

export function dependabotDiffAllowed(
	files: ReturnType<typeof parseRawDiff>,
	diff: string,
): boolean {
	return (
		files.length > 0 &&
		regularFiles(files) &&
		files.every(
			(file) =>
				/^\.github\/workflows\/[^/]+\.ya?ml$/.test(file.path) &&
				!PRIVILEGED_WORKFLOWS.has(file.path),
		) &&
		actionChangesOnly(diff)
	);
}

export function selectCacheMode(
	pullRequest: PullRequestInfo,
	repositoryId: number,
	botUserId: number,
	provenance: boolean,
	files: ReturnType<typeof parseRawDiff>,
	dependabotDiff: string,
): CacheMode {
	if (
		pullRequest.userId === botUserId &&
		pullRequest.userType === "Bot" &&
		pullRequest.headRepositoryId === repositoryId &&
		provenance &&
		ownBotDiffAllowed(pullRequest.headRef, files)
	) {
		return "auto";
	}
	if (
		pullRequest.userId === DEPENDABOT_USER_ID &&
		pullRequest.userLogin === "dependabot[bot]" &&
		pullRequest.userType === "Bot" &&
		pullRequest.headRepositoryId === repositoryId &&
		pullRequest.headRef.startsWith("dependabot/") &&
		dependabotDiffAllowed(files, dependabotDiff)
	) {
		return "auto";
	}
	return "manual";
}

async function checkoutCandidate(
	repository: string,
	revision: ReviewRevision,
): Promise<void> {
	if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(revision.mergedRepository)) {
		throw new Error("The merged repository name is invalid");
	}
	rmSync(repository, { force: true, recursive: true });
	mkdirSync(repository, { recursive: true });
	const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com";
	await run(["git", "-C", repository, "init"]);
	await run([
		"git",
		"-C",
		repository,
		"remote",
		"add",
		"origin",
		`${serverUrl}/${revision.mergedRepository}.git`,
	]);
	await run([
		"git",
		"-C",
		repository,
		"fetch",
		"--depth=2",
		"origin",
		revision.mergedSha,
	]);
	await run(["git", "-C", repository, "checkout", "--detach", "FETCH_HEAD"]);
}

async function repositoryDiff(
	repository: string,
	revision: ReviewRevision,
): Promise<Readonly<{ diff: string; files: ReturnType<typeof parseRawDiff> }>> {
	const raw = await run(
		[
			"git",
			"-C",
			repository,
			"diff",
			"--raw",
			"-z",
			"--no-renames",
			revision.baseSha,
			revision.mergedSha,
		],
		{ capture: true },
	);
	const diff = await run(
		[
			"git",
			"-C",
			repository,
			"diff",
			"--unified=0",
			"--no-renames",
			revision.baseSha,
			revision.mergedSha,
			"--",
			".github/workflows",
		],
		{ capture: true },
	);
	return { diff: diff.stdout, files: parseRawDiff(raw.stdout) };
}

export async function cacheGate(): Promise<void> {
	requiredEnvironment("GH_TOKEN");
	const comparison = parseEvalReport(
		readJsonFile(requiredEnvironment("COMPARISON_FILE")),
	);
	const revision = comparison.revision;
	if (
		revision.runId !==
		positiveInteger(
			Number(requiredEnvironment("TRIGGER_RUN_ID")),
			"TRIGGER_RUN_ID",
		)
	) {
		throw new Error("The comparison belongs to another workflow run");
	}
	if (!revision.mergeable || revision.targetSha !== revision.baseSha) {
		throw new Error("Conflicting pull requests cannot write the binary cache");
	}
	if (
		revision.repositoryId !==
		positiveInteger(
			Number(process.env.GITHUB_REPOSITORY_ID),
			"GITHUB_REPOSITORY_ID",
		)
	) {
		throw new Error("The comparison belongs to another repository");
	}
	await validateWorkflowRun(revision);
	await validateMergeCommit(revision);
	const pullRequest = parsePullRequest(
		await githubRequest(
			`/repos/${githubRepository()}/pulls/${revision.pullRequestNumber}`,
		),
	);
	if (
		pullRequest.number !== revision.pullRequestNumber ||
		pullRequest.state !== "open" ||
		pullRequest.draft ||
		pullRequest.mergeable !== true ||
		pullRequest.baseRef !== revision.baseBranch ||
		pullRequest.baseSha !== revision.baseSha ||
		pullRequest.headRef !== revision.headBranch ||
		pullRequest.headRepository !== revision.headRepository ||
		pullRequest.headRepositoryId !== revision.headRepositoryId ||
		pullRequest.headSha !== revision.headSha ||
		pullRequest.mergeCommitSha !== revision.mergedSha
	) {
		throw new Error("The pull request changed after Review");
	}
	const systems = readSystems();
	const reviewedSystems = comparison.results.map(({ system }) => system).sort();
	const trustedSystems = systems.map(({ system }) => system).sort();
	if (JSON.stringify(reviewedSystems) !== JSON.stringify(trustedSystems)) {
		throw new Error(
			"The reviewed systems do not match trusted ci/systems.json",
		);
	}
	const candidateRepository = requiredEnvironment("CANDIDATE_REPOSITORY");
	await checkoutCandidate(candidateRepository, revision);
	const { diff, files } = await repositoryDiff(candidateRepository, revision);
	const botUserId = positiveInteger(
		Number(requiredEnvironment("AUTOMATION_BOT_USER_ID")),
		"AUTOMATION_BOT_USER_ID",
	);
	const mode = selectCacheMode(
		pullRequest,
		revision.repositoryId,
		botUserId,
		await hasProvenance(revision.headSha, botUserId),
		files,
		diff,
	);
	writeOutput("baseSha", revision.baseSha);
	writeOutput("headSha", revision.headSha);
	writeOutput("matrix", compactJson({ include: systems }));
	writeOutput("mergedRepository", revision.mergedRepository);
	writeOutput("mergedSha", revision.mergedSha);
	writeOutput("mode", mode);
	writeOutput("pullRequestNumber", String(revision.pullRequestNumber));
	writeOutput("reviewRunId", String(revision.runId));
}
