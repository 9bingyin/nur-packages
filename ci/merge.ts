import { githubRepository, githubRequest } from "./github.ts";
import { requiredEnvironment, requireRecord, run } from "./lib.ts";

const SHA_PATTERN = /^[0-9a-f]{40}$/;

type ExpectedPullRequest = Readonly<{
	baseSha: string;
	headSha: string;
	number: number;
}>;

function expectedPullRequest(): ExpectedPullRequest {
	const number = Number(requiredEnvironment("PULL_REQUEST_NUMBER"));
	const baseSha = requiredEnvironment("BASE_SHA");
	const headSha = requiredEnvironment("HEAD_SHA");
	if (
		!Number.isInteger(number) ||
		number <= 0 ||
		!SHA_PATTERN.test(baseSha) ||
		!SHA_PATTERN.test(headSha)
	) {
		throw new Error("Pull request merge metadata is invalid");
	}
	return { baseSha, headSha, number };
}

export function pullRequestMatchesMerge(
	value: unknown,
	expected: ExpectedPullRequest,
): boolean {
	const pullRequest = requireRecord(value, "pull request");
	const base = requireRecord(pullRequest.base, "pull request.base");
	const head = requireRecord(pullRequest.head, "pull request.head");
	return (
		pullRequest.number === expected.number &&
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
	if (!pullRequestMatchesMerge(pullRequest, expected)) {
		throw new Error("The pull request changed after Review");
	}
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
