import process from "node:process";
import { githubRepository, githubRequest } from "./github.ts";
import {
	requiredEnvironment,
	requireRecord,
	requireString,
	run,
} from "./lib.ts";
import { validateMergeParents } from "./prepare-pr.ts";

const SHA_PATTERN = /^[0-9a-f]{40}$/;

type ExpectedPullRequest = Readonly<{
	baseSha: string;
	headSha: string;
	mergedSha: string;
	number: number;
}>;

function expectedPullRequest(): ExpectedPullRequest {
	const number = Number(requiredEnvironment("PULL_REQUEST_NUMBER"));
	const baseSha = requiredEnvironment("BASE_SHA");
	const headSha = requiredEnvironment("HEAD_SHA");
	const mergedSha = requiredEnvironment("MERGED_SHA");
	if (
		!Number.isInteger(number) ||
		number <= 0 ||
		!SHA_PATTERN.test(baseSha) ||
		!SHA_PATTERN.test(headSha) ||
		!SHA_PATTERN.test(mergedSha)
	) {
		throw new Error("Cached pull request metadata is invalid");
	}
	return { baseSha, headSha, mergedSha, number };
}

export function pullRequestMatchesCache(
	value: unknown,
	expected: ExpectedPullRequest,
): boolean {
	const pullRequest = requireRecord(value, "pull request");
	const base = requireRecord(pullRequest.base, "pull request.base");
	const head = requireRecord(pullRequest.head, "pull request.head");
	return (
		pullRequest.number === expected.number &&
		pullRequest.state === "open" &&
		pullRequest.draft === false &&
		pullRequest.mergeable === true &&
		pullRequest.merge_commit_sha === expected.mergedSha &&
		base.sha === expected.baseSha &&
		head.sha === expected.headSha
	);
}

async function validateCachedMerge(
	expected: ExpectedPullRequest,
): Promise<void> {
	const commit = requireRecord(
		await githubRequest(
			`/repos/${githubRepository()}/commits/${expected.mergedSha}`,
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
	validateMergeParents(parents, expected.baseSha, expected.headSha);
}

export async function mergeCachedPullRequest(): Promise<void> {
	requiredEnvironment("GH_TOKEN");
	const expected = expectedPullRequest();
	const pullRequest = await githubRequest(
		`/repos/${githubRepository()}/pulls/${expected.number}`,
	);
	if (!pullRequestMatchesCache(pullRequest, expected)) {
		throw new Error("The pull request changed after the cache build");
	}
	await validateCachedMerge(expected);
	await run([
		"gh",
		"pr",
		"merge",
		String(expected.number),
		"--auto",
		"--squash",
		"--delete-branch",
		"--match-head-commit",
		expected.headSha,
	]);
}
