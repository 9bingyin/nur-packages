import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
	downloadGitHubArtifact,
	githubRepository,
	githubRequest,
} from "./github.ts";
import {
	readJsonFile,
	requiredEnvironment,
	requireRecord,
	requireString,
	run,
} from "./lib.ts";

function actionsToken(): string {
	return process.env.GH_ACTIONS_TOKEN || requiredEnvironment("GH_TOKEN");
}

export const PR_WORKFLOW_PATH = ".github/workflows/pull-request-target.yml";
const SHA_PATTERN = /^[0-9a-f]{40}$/;

export type PrRevision = Readonly<{
	baseRef: string;
	baseSha: string;
	headRef: string;
	headRepositoryId: number;
	headSha: string;
	mergeable: boolean;
	number: number;
	repositoryId: number;
	runAttempt: number;
	runId: number;
}>;

export function positiveInteger(value: unknown, name: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
	return value;
}

function sha(value: unknown, name: string): string {
	const result = requireString(value, name);
	if (!SHA_PATTERN.test(result)) {
		throw new Error(`${name} must be a full commit SHA`);
	}
	return result;
}

export function parsePrRevision(value: unknown): PrRevision {
	const revision = requireRecord(value, "PR revision");
	if (typeof revision.mergeable !== "boolean") {
		throw new Error("PR revision.mergeable must be boolean");
	}
	return {
		baseRef: requireString(revision.baseRef, "PR revision.baseRef"),
		baseSha: sha(revision.baseSha, "PR revision.baseSha"),
		headRef: requireString(revision.headRef, "PR revision.headRef"),
		headRepositoryId: positiveInteger(
			revision.headRepositoryId,
			"PR revision.headRepositoryId",
		),
		headSha: sha(revision.headSha, "PR revision.headSha"),
		mergeable: revision.mergeable,
		number: positiveInteger(revision.number, "PR revision.number"),
		repositoryId: positiveInteger(
			revision.repositoryId,
			"PR revision.repositoryId",
		),
		runAttempt: positiveInteger(revision.runAttempt, "PR revision.runAttempt"),
		runId: positiveInteger(revision.runId, "PR revision.runId"),
	};
}

export function trustedPrRun(
	value: Record<string, unknown>,
	repositoryId: number,
): boolean {
	const repository = requireRecord(value.repository, "workflow run.repository");
	return (
		value.path === PR_WORKFLOW_PATH &&
		repository.id === repositoryId &&
		(value.event === "pull_request_target" ||
			value.event === "workflow_dispatch")
	);
}

export function trustedRevisionArtifact(
	artifact: Record<string, unknown>,
	prepare: Record<string, unknown>,
): boolean {
	const created = Date.parse(String(artifact.created_at));
	const started = Date.parse(String(prepare.started_at));
	const completed = Date.parse(String(prepare.completed_at));
	return (
		prepare.name === "prepare" &&
		prepare.conclusion === "success" &&
		artifact.expired === false &&
		created >= started &&
		created <= completed
	);
}

export async function readPrRevision(
	runId: number,
	runAttempt: number,
	repositoryId: number,
): Promise<PrRevision | null> {
	const artifacts = requireRecord(
		await githubRequest(
			`/repos/${githubRepository()}/actions/runs/${runId}/artifacts?per_page=100`,
			{ token: actionsToken() },
		),
		"workflow artifacts",
	);
	if (!Array.isArray(artifacts.artifacts))
		throw new Error("Workflow artifacts must be an array");
	const matching = artifacts.artifacts
		.map((value) => requireRecord(value, "artifact"))
		.filter((value) => value.name === `pr-revision-${runAttempt}`);
	const artifact = matching[0];
	if (matching.length === 0 || artifact?.expired === true) return null;
	const jobs = requireRecord(
		await githubRequest(
			`/repos/${githubRepository()}/actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100`,
			{ token: actionsToken() },
		),
		"workflow jobs",
	);
	if (!Array.isArray(jobs.jobs))
		throw new Error("Workflow jobs must be an array");
	const prepare = jobs.jobs
		.map((value) => requireRecord(value, "workflow job"))
		.find((value) => value.name === "prepare");
	if (
		matching.length !== 1 ||
		!artifact ||
		!prepare ||
		!trustedRevisionArtifact(artifact, prepare)
	) {
		throw new Error("PR revision was not uploaded by the trusted prepare job");
	}
	const directory = mkdtempSync(join(tmpdir(), "pr-revision-"));
	try {
		const archive = join(directory, "revision.zip");
		await downloadGitHubArtifact(
			positiveInteger(artifact.id, "artifact.id"),
			archive,
			actionsToken(),
		);
		await run(["unzip", "-q", archive, "pr-revision.json", "-d", directory]);
		const revision = parsePrRevision(
			readJsonFile(join(directory, "pr-revision.json")),
		);
		if (
			revision.runId !== runId ||
			revision.runAttempt !== runAttempt ||
			revision.repositoryId !== repositoryId
		) {
			throw new Error("PR revision does not match the workflow run");
		}
		return revision;
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

export function prRunMatches(
	value: Record<string, unknown>,
	number: number,
	branch: string,
	headSha: string,
): boolean {
	return (
		(typeof value.display_title === "string" &&
			value.display_title.startsWith(`PR #${number} @ ${headSha} / `)) ||
		(value.event === "pull_request_target" &&
			value.head_branch === branch &&
			value.head_sha === headSha)
	);
}

export async function latestPrRuns(
	targets: readonly Readonly<{
		number: number;
		branch: string;
		headSha: string;
	}>[],
): Promise<readonly Record<string, unknown>[]> {
	const runs: Record<string, unknown>[] = [];
	for (let page = 1; page <= 10; page += 1) {
		const value = requireRecord(
			await githubRequest(
				`/repos/${githubRepository()}/actions/workflows/pull-request-target.yml/runs?per_page=100&page=${page}`,
				{ token: actionsToken() },
			),
			"PR workflow runs",
		);
		if (!Array.isArray(value.workflow_runs))
			throw new Error("PR workflow runs must be an array");
		runs.push(
			...value.workflow_runs.map((item) =>
				requireRecord(item, "PR workflow run"),
			),
		);
		if (
			value.workflow_runs.length < 100 ||
			targets.every((target) =>
				runs.some((item) =>
					prRunMatches(item, target.number, target.branch, target.headSha),
				),
			)
		)
			break;
	}
	return runs;
}

export function latestCompletedPrRun(
	runs: readonly Record<string, unknown>[],
	number: number,
	branch: string,
	headSha: string,
): Record<string, unknown> | null {
	const matching = runs.filter((value) =>
		prRunMatches(value, number, branch, headSha),
	);
	if (matching.some((value) => value.status !== "completed")) {
		return null;
	}
	return matching[0] ?? null;
}

export function requestedBaseSha(
	value: Record<string, unknown>,
): string | null {
	const title =
		typeof value.display_title === "string" ? value.display_title : "";
	return / \/ ([0-9a-f]{40})$/.exec(title)?.[1] ?? null;
}

export async function dispatchPrRecheck(
	number: number,
	branch: string,
	baseSha: string,
	headSha: string,
): Promise<void> {
	await githubRequest(
		`/repos/${githubRepository()}/actions/workflows/pull-request-target.yml/dispatches`,
		{
			method: "POST",
			token: actionsToken(),
			body: {
				ref: branch,
				inputs: {
					"pull-request-number": String(number),
					"head-sha": headSha,
					"base-sha": baseSha,
				},
			},
		},
	);
}

export function shouldRecheck(
	revision: PrRevision,
	baseSha: string,
	headSha: string,
): boolean {
	return revision.headSha === headSha && revision.baseSha !== baseSha;
}
