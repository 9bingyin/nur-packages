import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import {
	currentBranchSha,
	decodeBase64,
	githubRepository,
	githubRequest,
} from "./github.ts";
import type { SystemConfig } from "./lib.ts";
import {
	CommandError,
	parseJson,
	parseSystems,
	prettyJson,
	requireRecord,
	requireString,
	run,
	writeOutput,
	writeTextFile,
} from "./lib.ts";
import { parsePrRevision } from "./pr-runs.ts";

const SHA_PATTERN = /^[0-9a-f]{40}$/;

type RepositoryRef = Readonly<{
	ref: string;
	repo: string;
	repoId: number;
	sha: string;
}>;

type PullRequest = Readonly<{
	base: RepositoryRef;
	head: RepositoryRef;
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
	return {
		base: parseRepositoryRef(pullRequest.base, "pull request.base"),
		head: parseRepositoryRef(pullRequest.head, "pull request.head"),
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
	const pullRequest = parsePullRequest(
		await githubRequest(`/repos/${githubRepository()}/pulls/${number}`),
	);
	if (pullRequest.state !== "open") {
		throw new Error("The pull request is no longer open");
	}
	return pullRequest;
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

async function createPrSnapshot(
	pullRequest: PullRequest,
	baseSha: string,
): Promise<
	Readonly<{ mergedSha: string; targetSha: string; mergeable: boolean }>
> {
	const repository = mkdtempSync(join(tmpdir(), "pr-source-"));
	const bundle = resolve("pr-source.bundle");
	const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com";
	const git = async (...args: string[]) =>
		(
			await run(["git", "-C", repository, ...args], { capture: true })
		).stdout.trim();
	try {
		await git("init", "--initial-branch=checked-source");
		await git(
			"fetch",
			"--no-tags",
			`${serverUrl}/${pullRequest.base.repo}.git`,
			baseSha,
		);
		await git(
			"fetch",
			"--no-tags",
			`${serverUrl}/${pullRequest.head.repo}.git`,
			pullRequest.head.sha,
		);
		const command = [
			"git",
			"-C",
			repository,
			"merge-tree",
			"--write-tree",
			baseSha,
			pullRequest.head.sha,
		];
		const merge = await run(command, { capture: true, check: false });
		if (merge.code !== 0 && merge.code !== 1)
			throw new CommandError(command, merge);
		const mergeable = merge.success;
		let mergedSha = pullRequest.head.sha;
		let targetSha = baseSha;
		if (mergeable) {
			const tree = validateSha("merged tree", merge.stdout.trim());
			const date = await git("show", "-s", "--format=%cI", baseSha);
			const commit = await run(
				[
					"git",
					"-C",
					repository,
					"commit-tree",
					tree,
					"-p",
					baseSha,
					"-p",
					pullRequest.head.sha,
					"-m",
					"CI test merge",
				],
				{
					capture: true,
					env: {
						GIT_AUTHOR_NAME: "nur-packages CI",
						GIT_AUTHOR_EMAIL: "ci@example.invalid",
						GIT_AUTHOR_DATE: date,
						GIT_COMMITTER_NAME: "nur-packages CI",
						GIT_COMMITTER_EMAIL: "ci@example.invalid",
						GIT_COMMITTER_DATE: date,
					},
				},
			);
			mergedSha = validateSha("mergedSha", commit.stdout.trim());
			validateMergeParents(
				(await git("show", "-s", "--format=%P", mergedSha)).split(" "),
				baseSha,
				pullRequest.head.sha,
			);
		} else {
			targetSha = validateSha(
				"targetSha",
				await git("merge-base", baseSha, pullRequest.head.sha),
			);
		}
		await git("update-ref", "refs/heads/checked-source", mergedSha);
		await git("bundle", "create", bundle, "HEAD", "refs/heads/checked-source");
		return { mergedSha, targetSha, mergeable };
	} finally {
		rmSync(repository, { recursive: true, force: true });
	}
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
	const baseSha = await currentBranchSha(pullRequest.base.ref);
	if (
		event.kind === "dispatch" &&
		(event.headSha !== headSha || event.baseSha !== baseSha)
	) {
		throw new Error("The pull request changed before its recheck started");
	}

	const { mergedSha, targetSha, mergeable } = await createPrSnapshot(
		pullRequest,
		baseSha,
	);
	const mergedRepository = mergeable
		? pullRequest.base.repo
		: pullRequest.head.repo;
	console.log(
		mergeable
			? "The pull request is mergeable; checking its pinned local merge commit"
			: "::warning::The pull request has conflicts; checking its head against the merge base",
	);

	const systemConfigs = await readSystems(targetSha);
	const systems = systemConfigs.map(({ system }) => system);
	const files = await changedFiles(pullRequest.number);

	console.log(`base branch: ${pullRequest.base.ref}`);
	console.log(`head branch: ${pullRequest.head.ref}`);
	console.log(`base SHA: ${baseSha}`);
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
				baseSha,
				headRef: pullRequest.head.ref,
				headRepositoryId: pullRequest.head.repoId,
				headSha,
				mergeable,
				number: pullRequest.number,
				repositoryId: Number(process.env.GITHUB_REPOSITORY_ID),
				runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
				runId: Number(process.env.GITHUB_RUN_ID),
			}),
		),
	);

	writeOutput("baseBranch", pullRequest.base.ref);
	writeOutput("baseSha", baseSha);
	writeOutput("headBranch", pullRequest.head.ref);
	writeOutput("headRepository", pullRequest.head.repo);
	writeOutput("headRepositoryId", String(pullRequest.head.repoId));
	writeOutput("headSha", headSha);
	writeOutput("matrix", JSON.stringify({ include: systemConfigs }));
	writeOutput("mergeable", String(mergeable));
	writeOutput("mergedRepository", mergedRepository);
	writeOutput("mergedSha", mergedSha);
	writeOutput("targetSha", targetSha);
	writeOutput("systems", JSON.stringify(systems));
	writeOutput("pullRequestNumber", String(pullRequest.number));
	writeOutput("files", JSON.stringify(files));
}
