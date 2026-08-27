import process from "node:process";
import { parseJson, requiredEnvironment } from "./lib.ts";

export type GitHubRequestOptions = Readonly<{
	body?: unknown;
	method?: "GET" | "POST";
}>;

function apiUrl(path: string): URL {
	const base = process.env.GITHUB_API_URL ?? "https://api.github.com";
	return new URL(path.replace(/^\//, ""), `${base.replace(/\/$/, "")}/`);
}

export async function githubRequest(
	path: string,
	options: GitHubRequestOptions = {},
): Promise<unknown> {
	const response = await fetch(apiUrl(path), {
		method: options.method ?? "GET",
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${requiredEnvironment("GH_TOKEN")}`,
			"Content-Type": "application/json",
			"User-Agent": "nur-packages-ci",
			"X-GitHub-Api-Version": "2022-11-28",
		},
		...(options.body === undefined
			? {}
			: { body: JSON.stringify(options.body) }),
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(
			`GitHub API ${response.status} ${response.statusText} for ${path}` +
				(text ? `\n${text}` : ""),
		);
	}
	return text ? parseJson(text, `GitHub API response for ${path}`) : null;
}

export function githubRepository(): string {
	return requiredEnvironment("GITHUB_REPOSITORY");
}

export function decodeBase64(value: string): string {
	return Buffer.from(value.replaceAll(/\s/g, ""), "base64").toString("utf8");
}
