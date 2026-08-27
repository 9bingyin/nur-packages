import process from "node:process";
import { githubRepository, githubRequest } from "./github.ts";
import { parseJson, requiredEnvironment } from "./lib.ts";

export function checksSucceeded(value: unknown): boolean {
	if (
		!Array.isArray(value) ||
		!value.every((result) => typeof result === "string")
	) {
		throw new Error("RESULTS must be a JSON array of job result strings");
	}
	return value.every((result) => result === "success");
}

export async function publishStatus(): Promise<void> {
	const success = checksSucceeded(
		parseJson(requiredEnvironment("RESULTS"), "RESULTS"),
	);
	const sha = requiredEnvironment("HEAD_SHA");
	const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com";
	const runId = requiredEnvironment("GITHUB_RUN_ID");

	await githubRequest(`/repos/${githubRepository()}/statuses/${sha}`, {
		method: "POST",
		body: {
			context: "no PR failures",
			state: success ? "success" : "error",
			target_url: `${serverUrl}/${githubRepository()}/actions/runs/${runId}`,
		},
	});
}
