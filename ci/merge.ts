import { githubRepository, githubRequest } from "./github.ts";
import {
	requiredEnvironment,
	requireRecord,
	requireString,
	run,
} from "./lib.ts";

const SHA_PATTERN = /^[0-9a-f]{40}$/;

type ExpectedPullRequest = Readonly<{
	baseRef: string;
	baseSha: string;
	headSha: string;
	number: number;
}>;

function expectedPullRequest(): ExpectedPullRequest {
	const number = Number(requiredEnvironment("PULL_REQUEST_NUMBER"));
	const baseRef = requiredEnvironment("BASE_REF");
	const baseSha = requiredEnvironment("BASE_SHA");
	const headSha = requiredEnvironment("HEAD_SHA");
	if (
		!Number.isInteger(number) ||
		number <= 0 ||
		!baseRef ||
		!SHA_PATTERN.test(baseSha) ||
		!SHA_PATTERN.test(headSha)
	) {
		throw new Error("Pull request merge metadata is invalid");
	}
	return { baseRef, baseSha, headSha, number };
}

export function pullRequestMatchesMerge(
	value: unknown,
	expected: ExpectedPullRequest,
	currentBaseSha: string,
): boolean {
	const pullRequest = requireRecord(value, "pull request");
	const base = requireRecord(pullRequest.base, "pull request.base");
	const head = requireRecord(pullRequest.head, "pull request.head");
	return (
		pullRequest.number === expected.number &&
		currentBaseSha === expected.baseSha &&
		base.sha === expected.baseSha &&
		pullRequest.state === "open" &&
		pullRequest.draft === false &&
		head.sha === expected.headSha
	);
}

export async function mergePullRequest(): Promise<void> {
	requiredEnvironment("GH_TOKEN");
	const expected = expectedPullRequest();
	const pullRequest = await githubRequest(
		`/repos/${githubRepository()}/pulls/${expected.number}`,
	);
	const branch = requireRecord(
		await githubRequest(
			`/repos/${githubRepository()}/branches/${encodeURIComponent(expected.baseRef)}`,
		),
		"base branch",
	);
	const commit = requireRecord(branch.commit, "base branch.commit");
	const currentBaseSha = requireString(commit.sha, "base branch.commit.sha");
	if (!pullRequestMatchesMerge(pullRequest, expected, currentBaseSha)) {
		throw new Error("The pull request changed after Review");
	}
	await run([
		"gh",
		"pr",
		"merge",
		String(expected.number),
		"--squash",
		"--delete-branch",
		"--match-head-commit",
		expected.headSha,
	]);
}
