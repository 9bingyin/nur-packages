import process from "node:process";
import {
	isRecord,
	parseJson,
	readJsonFile,
	requiredEnvironment,
	run,
} from "./lib.ts";

export function pullRequestNumbers(event: unknown): readonly number[] {
	if (!isRecord(event) || !isRecord(event.workflow_run)) {
		return [];
	}
	const pullRequests = event.workflow_run.pull_requests;
	if (!Array.isArray(pullRequests)) {
		return [];
	}
	return pullRequests.flatMap((pullRequest) => {
		if (!isRecord(pullRequest) || typeof pullRequest.number !== "number") {
			return [];
		}
		return Number.isInteger(pullRequest.number) && pullRequest.number > 0
			? [pullRequest.number]
			: [];
	});
}

function labelNames(pullRequest: Record<string, unknown>): ReadonlySet<string> {
	if (!Array.isArray(pullRequest.labels)) {
		return new Set();
	}
	return new Set(
		pullRequest.labels.flatMap((label) =>
			isRecord(label) && typeof label.name === "string" ? [label.name] : [],
		),
	);
}

export function shouldMerge(
	value: unknown,
	headSha: string,
	baseBranch: string,
): boolean {
	if (!isRecord(value)) {
		return false;
	}
	const labels = labelNames(value);
	return (
		typeof value.headRefName === "string" &&
		value.headRefName.startsWith("automation/update-") &&
		value.headRefOid === headSha &&
		value.baseRefName === baseBranch &&
		value.isDraft === false &&
		labels.has("automated") &&
		labels.has("dependencies")
	);
}

async function mergePullRequest(
	number: number,
	headSha: string,
): Promise<void> {
	const response = await run(
		[
			"gh",
			"pr",
			"view",
			String(number),
			"--json",
			"baseRefName,headRefName,headRefOid,isDraft,labels",
		],
		{ capture: true },
	);
	const pullRequest = parseJson(response.stdout, `pull request #${number}`);
	if (!shouldMerge(pullRequest, headSha, process.env.BASE_BRANCH ?? "main")) {
		console.log(
			`Skipping pull request #${number}: it is not an eligible automated update`,
		);
		return;
	}
	await run([
		"gh",
		"pr",
		"merge",
		String(number),
		"--squash",
		"--delete-branch",
		"--match-head-commit",
		headSha,
	]);
}

export async function autoMerge(): Promise<void> {
	requiredEnvironment("GH_TOKEN");
	const event = await readJsonFile(requiredEnvironment("GITHUB_EVENT_PATH"));
	const headSha = requiredEnvironment("WORKFLOW_HEAD_SHA");
	for (const number of pullRequestNumbers(event)) {
		await mergePullRequest(number, headSha);
	}
}
