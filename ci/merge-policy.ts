import { mkdirSync, rmSync } from "node:fs";
import process from "node:process";
import {
	githubRepository,
	githubRequest,
	githubRequestPages,
} from "./github.ts";
import {
	compactJson,
	isRecord,
	requiredEnvironment,
	requireRecord,
	requireString,
	run,
	writeOutput,
} from "./lib.ts";
import { parseRawDiff } from "./update.ts";
import { parseUpdateProvenance } from "./update-provenance.ts";

const DEPENDABOT_USER_ID = 49_699_333;
const EXPECTED_WORKFLOW_PATH = ".github/workflows/pull-request-target.yml";
const PRIVILEGED_WORKFLOWS = new Set([
	".github/workflows/build-cache.yml",
	".github/workflows/build.yml",
	".github/workflows/check.yml",
	".github/workflows/eval.yml",
	".github/workflows/lint.yml",
	".github/workflows/lix.yml",
	".github/workflows/merge-pr.yml",
	".github/workflows/pull-request-target.yml",
	".github/workflows/review.yml",
	".github/workflows/update.yml",
]);
const ACTION_REFERENCE_PATTERN =
	/^\s*uses:\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?)@([0-9a-f]{40})(?:\s+#.*)?$/;

type MergeMode = "auto" | "manual" | "stale";

type PullRequestReference = Readonly<{
	baseRef: string;
	baseRepositoryId: number;
	baseSha: string;
	headRef: string;
	headRepositoryId: number;
	headSha: string;
	number: number;
}>;

type PullRequestInfo = Readonly<{
	baseSha: string;
	draft: boolean;
	headRepositoryId: number;
	headSha: string;
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

function parseReference(value: unknown): PullRequestReference {
	const pullRequest = requireRecord(value, "workflow run pull request");
	const base = requireRecord(
		pullRequest.base,
		"workflow run pull request.base",
	);
	const head = requireRecord(
		pullRequest.head,
		"workflow run pull request.head",
	);
	const baseRepository = requireRecord(
		base.repo,
		"workflow run pull request.base.repo",
	);
	const headRepository = requireRecord(
		head.repo,
		"workflow run pull request.head.repo",
	);
	return {
		baseRef: requireString(base.ref, "workflow run pull request.base.ref"),
		baseRepositoryId: positiveInteger(
			baseRepository.id,
			"workflow run pull request.base.repo.id",
		),
		baseSha: requireString(base.sha, "workflow run pull request.base.sha"),
		headRef: requireString(head.ref, "workflow run pull request.head.ref"),
		headRepositoryId: positiveInteger(
			headRepository.id,
			"workflow run pull request.head.repo.id",
		),
		headSha: requireString(head.sha, "workflow run pull request.head.sha"),
		number: positiveInteger(
			pullRequest.number,
			"workflow run pull request.number",
		),
	};
}

function parsePullRequest(value: unknown): PullRequestInfo {
	const pullRequest = requireRecord(value, "pull request");
	const base = requireRecord(pullRequest.base, "pull request.base");
	const head = requireRecord(pullRequest.head, "pull request.head");
	const headRepository = requireRecord(head.repo, "pull request.head.repo");
	const user = requireRecord(pullRequest.user, "pull request.user");
	if (typeof pullRequest.draft !== "boolean") {
		throw new Error("pull request.draft must be boolean");
	}
	return {
		baseSha: requireString(base.sha, "pull request.base.sha"),
		draft: pullRequest.draft,
		headRepositoryId: positiveInteger(
			headRepository.id,
			"pull request.head.repo.id",
		),
		headSha: requireString(head.sha, "pull request.head.sha"),
		number: positiveInteger(pullRequest.number, "pull request.number"),
		state: requireString(pullRequest.state, "pull request.state"),
		userId: positiveInteger(user.id, "pull request.user.id"),
		userLogin: requireString(user.login, "pull request.user.login"),
		userType: requireString(user.type, "pull request.user.type"),
	};
}

async function triggeringPullRequest(
	runId: number,
): Promise<PullRequestReference> {
	const run = requireRecord(
		await githubRequest(`/repos/${githubRepository()}/actions/runs/${runId}`),
		"workflow run",
	);
	const repository = requireRecord(run.repository, "workflow run.repository");
	if (
		run.event !== "pull_request_target" ||
		run.conclusion !== "success" ||
		run.path !== EXPECTED_WORKFLOW_PATH ||
		repository.id !==
			positiveInteger(
				Number(process.env.GITHUB_REPOSITORY_ID),
				"GITHUB_REPOSITORY_ID",
			) ||
		!Array.isArray(run.pull_requests) ||
		run.pull_requests.length !== 1
	) {
		throw new Error("The triggering PR workflow does not match merge policy");
	}
	return parseReference(run.pull_requests[0]);
}

async function hasProvenance(
	pullRequest: number,
	baseSha: string,
	headSha: string,
	botUserId: number,
): Promise<boolean> {
	const comments = await githubRequestPages(
		`/repos/${githubRepository()}/issues/${pullRequest}/comments`,
	);
	return comments.some((item) => {
		const comment = isRecord(item) ? item : {};
		const user = isRecord(comment.user) ? comment.user : {};
		const provenance = parseUpdateProvenance(comment.body);
		return (
			user.id === botUserId &&
			provenance?.baseSha === baseSha &&
			provenance.headSha === headSha
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

export function selectMergeMode(
	pullRequest: PullRequestInfo,
	reference: PullRequestReference,
	repositoryId: number,
	botUserId: number,
	provenance: boolean,
	files: ReturnType<typeof parseRawDiff>,
	dependabotDiff: string,
): MergeMode {
	if (
		pullRequest.number !== reference.number ||
		pullRequest.baseSha !== reference.baseSha ||
		pullRequest.state !== "open" ||
		pullRequest.draft ||
		pullRequest.headSha !== reference.headSha ||
		pullRequest.headRepositoryId !== reference.headRepositoryId
	) {
		return "stale";
	}
	if (
		pullRequest.userId === botUserId &&
		pullRequest.userType === "Bot" &&
		reference.headRepositoryId === repositoryId &&
		provenance &&
		ownBotDiffAllowed(reference.headRef, files)
	) {
		return "auto";
	}
	if (
		pullRequest.userId === DEPENDABOT_USER_ID &&
		pullRequest.userLogin === "dependabot[bot]" &&
		pullRequest.userType === "Bot" &&
		reference.headRepositoryId === repositoryId &&
		reference.headRef.startsWith("dependabot/") &&
		dependabotDiffAllowed(files, dependabotDiff)
	) {
		return "auto";
	}
	return "manual";
}

async function repositoryDiff(
	repository: string,
	baseSha: string,
	headSha: string,
): Promise<Readonly<{ diff: string; files: ReturnType<typeof parseRawDiff> }>> {
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
		`${serverUrl}/${githubRepository()}.git`,
	]);
	await run([
		"git",
		"-C",
		repository,
		"fetch",
		"--depth=1",
		"origin",
		baseSha,
		headSha,
	]);
	const raw = await run(
		[
			"git",
			"-C",
			repository,
			"diff",
			"--raw",
			"-z",
			"--no-renames",
			baseSha,
			headSha,
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
			baseSha,
			headSha,
			"--",
			".github/workflows",
		],
		{ capture: true },
	);
	return { diff: diff.stdout, files: parseRawDiff(raw.stdout) };
}

export async function mergePolicy(): Promise<void> {
	requiredEnvironment("GH_TOKEN");
	const runId = positiveInteger(
		Number(requiredEnvironment("TRIGGER_RUN_ID")),
		"TRIGGER_RUN_ID",
	);
	const reference = await triggeringPullRequest(runId);
	const repositoryId = positiveInteger(
		Number(process.env.GITHUB_REPOSITORY_ID),
		"GITHUB_REPOSITORY_ID",
	);
	const pullRequest = parsePullRequest(
		await githubRequest(
			`/repos/${githubRepository()}/pulls/${reference.number}`,
		),
	);
	const botUserId = positiveInteger(
		Number(requiredEnvironment("AUTOMATION_BOT_USER_ID")),
		"AUTOMATION_BOT_USER_ID",
	);
	const ownBot =
		pullRequest.userId === botUserId && pullRequest.userType === "Bot";
	const dependabot =
		pullRequest.userId === DEPENDABOT_USER_ID &&
		pullRequest.userLogin === "dependabot[bot]" &&
		pullRequest.userType === "Bot";
	const needsDiff =
		reference.headRepositoryId === repositoryId && (ownBot || dependabot);
	const { diff, files } = needsDiff
		? await repositoryDiff(
				requiredEnvironment("CANDIDATE_REPOSITORY"),
				reference.baseSha,
				reference.headSha,
			)
		: { diff: "", files: [] };
	const mode = selectMergeMode(
		pullRequest,
		reference,
		repositoryId,
		botUserId,
		ownBot
			? await hasProvenance(
					reference.number,
					reference.baseSha,
					reference.headSha,
					botUserId,
				)
			: false,
		files,
		diff,
	);
	writeOutput("baseSha", reference.baseSha);
	writeOutput("headSha", reference.headSha);
	writeOutput("mode", mode);
	writeOutput("pullRequestNumber", String(reference.number));
	console.log(compactJson({ mode, pullRequest: reference.number }));
}
