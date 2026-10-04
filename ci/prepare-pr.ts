import { readFileSync } from "node:fs";
import process from "node:process";
import { decodeBase64, githubRepository, githubRequest } from "./github.ts";
import type { SystemConfig } from "./lib.ts";
import {
	parseJson,
	parseSystems,
	prettyJson,
	requireRecord,
	requireString,
	sleep,
	writeOutput,
	writeTextFile,
} from "./lib.ts";
import { parsePrRevision } from "./pr-runs.ts";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const RETRY_INTERVALS_SECONDS = [5, 10, 20, 40, 80] as const;

type RepositoryRef = Readonly<{
	label: string;
	ref: string;
	repo: string;
	repoId: number;
	sha: string;
}>;

type PullRequest = Readonly<{
	base: RepositoryRef;
	head: RepositoryRef;
	mergeCommitSha: string | null;
	mergeable: boolean | null;
	number: number;
	state: string;
}>;

function validateSha(name: string, value: unknown): string {
	const sha = requireString(value, name);
	if (!SHA_PATTERN.test(sha)) {
		throw new Error(`${name} is not a full commit SHA: ${sha}`);
	}
	return sha;
}

function parseRepositoryRef(value: unknown, name: string): RepositoryRef {
	const ref = requireRecord(value, name);
	const repository = requireRecord(ref.repo, `${name}.repo`);
	const repoId = repository.id;
	if (!Number.isInteger(repoId) || typeof repoId !== "number" || repoId <= 0) {
		throw new Error(`${name}.repo.id must be a positive integer`);
	}
	return {
		label: requireString(ref.label, `${name}.label`),
		ref: requireString(ref.ref, `${name}.ref`),
		repo: requireString(repository.full_name, `${name}.repo.full_name`),
		repoId,
		sha: validateSha(`${name}.sha`, ref.sha),
	};
}

function parsePullRequest(value: unknown): PullRequest {
	const pullRequest = requireRecord(value, "pull request");
	const number = pullRequest.number;
	if (!Number.isInteger(number) || typeof number !== "number" || number <= 0) {
		throw new Error("pull request.number must be a positive integer");
	}
	const mergeable = pullRequest.mergeable;
	if (mergeable !== null && typeof mergeable !== "boolean") {
		throw new Error("pull request.mergeable must be boolean or null");
	}
	const mergeCommitSha = pullRequest.merge_commit_sha;
	if (mergeCommitSha !== null && typeof mergeCommitSha !== "string") {
		throw new Error("pull request.merge_commit_sha must be string or null");
	}
	return {
		base: parseRepositoryRef(pullRequest.base, "pull request.base"),
		head: parseRepositoryRef(pullRequest.head, "pull request.head"),
		mergeCommitSha,
		mergeable,
		number,
		state: requireString(pullRequest.state, "pull request.state"),
	};
}

export function parsePrEvent(
	eventName: string,
	value: unknown,
):
	| Readonly<{ kind: "pull-request"; number: number }>
	| Readonly<{
			kind: "dispatch";
			number: number;
			headSha: string;
			baseSha: string;
	  }> {
	const event = requireRecord(value, "GitHub event");
	if (eventName === "workflow_dispatch") {
		const inputs = requireRecord(event.inputs, "event.inputs");
		const number = Number(inputs["pull-request-number"]);
		if (!Number.isInteger(number) || number <= 0) {
			throw new Error("Dispatch requires a pull request number");
		}
		return {
			kind: "dispatch",
			number,
			headSha: validateSha("dispatch head SHA", inputs["head-sha"]),
			baseSha: validateSha("dispatch base SHA", inputs["base-sha"]),
		};
	}
	if (eventName !== "pull_request_target") {
		throw new Error("prepare requires a PR or recheck event");
	}
	const pullRequest = requireRecord(event.pull_request, "event.pull_request");
	const number = pullRequest.number;
	if (!Number.isInteger(number) || typeof number !== "number" || number <= 0) {
		throw new Error("prepare requires a pull_request_target event");
	}
	return { kind: "pull-request", number };
}

function pullRequestEvent(): ReturnType<typeof parsePrEvent> {
	const eventPath = requireString(
		process.env.GITHUB_EVENT_PATH,
		"GITHUB_EVENT_PATH",
	);
	return parsePrEvent(
		requireString(process.env.GITHUB_EVENT_NAME, "GITHUB_EVENT_NAME"),
		parseJson(readFileSync(eventPath, "utf8"), "GitHub event"),
	);
}

async function pullRequestInfo(number: number): Promise<PullRequest> {
	for (const retrySeconds of RETRY_INTERVALS_SECONDS) {
		const pullRequest = parsePullRequest(
			await githubRequest(`/repos/${githubRepository()}/pulls/${number}`),
		);
		if (pullRequest.state !== "open") {
			throw new Error("The pull request is no longer open");
		}
		if (pullRequest.mergeable !== null) {
			return pullRequest;
		}
		console.log(
			`GitHub is still computing mergeability; retrying in ${retrySeconds} seconds`,
		);
		await sleep(retrySeconds * 1000);
	}
	throw new Error("GitHub did not finish computing pull request mergeability");
}

export function validateMergeParents(
	parents: readonly string[],
	baseSha: string,
	headSha: string,
): string {
	if (parents.length !== 2) {
		throw new Error(
			`Merge commit must have exactly two parents, got ${parents.length}`,
		);
	}
	const firstParent = parents[0];
	const secondParent = parents[1];
	if (firstParent !== baseSha || secondParent !== headSha) {
		throw new Error(
			`Merge commit parents do not match the pull request: ${parents.join(", ")}`,
		);
	}
	return firstParent;
}

async function mergeTargetSha(
	sha: string,
	baseSha: string,
	headSha: string,
): Promise<string> {
	const commit = requireRecord(
		await githubRequest(`/repos/${githubRepository()}/commits/${sha}`),
		"merge commit",
	);
	if (!Array.isArray(commit.parents)) {
		throw new Error("Merge commit parents must be an array");
	}
	const parents = commit.parents.map((parent, index) =>
		validateSha(
			`merge commit parent ${index}`,
			requireRecord(parent, `merge commit parent ${index}`).sha,
		),
	);
	return validateMergeParents(parents, baseSha, headSha);
}

async function mergeBaseSha(
	base: RepositoryRef,
	head: RepositoryRef,
): Promise<string> {
	const comparison = requireRecord(
		await githubRequest(
			`/repos/${githubRepository()}/compare/${encodeURIComponent(`${base.label}...${head.label}`)}`,
		),
		"commit comparison",
	);
	const mergeBase = requireRecord(
		comparison.merge_base_commit,
		"comparison.merge_base_commit",
	);
	return validateSha("targetSha", mergeBase.sha);
}

async function readSystems(ref: string): Promise<readonly SystemConfig[]> {
	const content = requireRecord(
		await githubRequest(
			`/repos/${githubRepository()}/contents/ci/systems.json?ref=${encodeURIComponent(ref)}`,
		),
		"ci/systems.json content",
	);
	const encoding = requireString(content.encoding, "ci/systems.json encoding");
	if (encoding !== "base64") {
		throw new Error(`Unsupported ci/systems.json encoding: ${encoding}`);
	}
	const entries = parseJson(
		decodeBase64(requireString(content.content, "ci/systems.json content")),
		"ci/systems.json",
	);
	return parseSystems(entries);
}

async function changedFiles(number: number): Promise<readonly string[]> {
	const files: string[] = [];
	for (let page = 1; ; page += 1) {
		const response = await githubRequest(
			`/repos/${githubRepository()}/pulls/${number}/files?per_page=100&page=${page}`,
		);
		if (!Array.isArray(response)) {
			throw new Error("GitHub pull request files response must be an array");
		}
		for (const item of response) {
			const file = requireRecord(item, "pull request file");
			files.push(requireString(file.filename, "pull request file.filename"));
		}
		if (response.length < 100) {
			return files;
		}
	}
}

export async function preparePullRequest(): Promise<void> {
	const event = pullRequestEvent();
	const pullRequest = await pullRequestInfo(event.number);
	const headSha = validateSha("headSha", pullRequest.head.sha);
	if (
		event.kind === "dispatch" &&
		(event.headSha !== headSha || event.baseSha !== pullRequest.base.sha)
	) {
		throw new Error("The pull request changed before its recheck started");
	}

	let mergedRepository: string;
	let mergedSha: string;
	let targetSha: string;
	if (pullRequest.mergeable) {
		mergedRepository = pullRequest.base.repo;
		mergedSha = validateSha("mergedSha", pullRequest.mergeCommitSha);
		targetSha = await mergeTargetSha(mergedSha, pullRequest.base.sha, headSha);
		console.log(
			"The pull request is mergeable; checking its test merge commit",
		);
	} else {
		mergedRepository = pullRequest.head.repo;
		mergedSha = headSha;
		targetSha = await mergeBaseSha(pullRequest.base, pullRequest.head);
		console.log(
			"::warning::The pull request has conflicts; checking its head against the merge base",
		);
	}

	const systemConfigs = await readSystems(targetSha);
	const systems = systemConfigs.map(({ system }) => system);
	const files = await changedFiles(pullRequest.number);

	console.log(`base branch: ${pullRequest.base.ref}`);
	console.log(`head branch: ${pullRequest.head.ref}`);
	console.log(`head SHA: ${headSha}`);
	console.log(`merged repository: ${mergedRepository}`);
	console.log(`merged SHA: ${mergedSha}`);
	console.log(`target SHA: ${targetSha}`);
	console.log(`systems: ${systems.join(", ")}`);

	writeTextFile(
		"pr-revision.json",
		prettyJson(
			parsePrRevision({
				baseRef: pullRequest.base.ref,
				baseSha: pullRequest.base.sha,
				headRef: pullRequest.head.ref,
				headRepositoryId: pullRequest.head.repoId,
				headSha,
				mergeable: pullRequest.mergeable,
				number: pullRequest.number,
				repositoryId: Number(process.env.GITHUB_REPOSITORY_ID),
				runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
				runId: Number(process.env.GITHUB_RUN_ID),
			}),
		),
	);

	writeOutput("baseBranch", pullRequest.base.ref);
	writeOutput("headBranch", pullRequest.head.ref);
	writeOutput("headRepository", pullRequest.head.repo);
	writeOutput("headRepositoryId", String(pullRequest.head.repoId));
	writeOutput("headSha", headSha);
	writeOutput("matrix", JSON.stringify({ include: systemConfigs }));
	writeOutput("mergeable", String(pullRequest.mergeable));
	writeOutput("mergedRepository", mergedRepository);
	writeOutput("mergedSha", mergedSha);
	writeOutput("targetSha", targetSha);
	writeOutput("systems", JSON.stringify(systems));
	writeOutput("pullRequestNumber", String(pullRequest.number));
	writeOutput("files", JSON.stringify(files));
}
