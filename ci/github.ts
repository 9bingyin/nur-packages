import { writeFileSync } from "node:fs";
import process from "node:process";
import {
	parseJson,
	requiredEnvironment,
	requireRecord,
	requireString,
} from "./lib.ts";

export type GitHubRequestOptions = Readonly<{
	body?: unknown;
	method?: "GET" | "PATCH" | "POST";
	token?: string;
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
			Authorization: `Bearer ${options.token ?? requiredEnvironment("GH_TOKEN")}`,
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

export async function githubRequestPages(
	path: string,
): Promise<readonly unknown[]> {
	const items: unknown[] = [];
	for (let page = 1; page <= 100; page += 1) {
		const separator = path.includes("?") ? "&" : "?";
		const response = await githubRequest(
			`${path}${separator}per_page=100&page=${page}`,
		);
		if (!Array.isArray(response)) {
			throw new Error(`GitHub API pagination returned a non-array for ${path}`);
		}
		items.push(...response);
		if (response.length < 100) {
			return items;
		}
	}
	throw new Error(`GitHub API pagination exceeded 100 pages for ${path}`);
}

export async function downloadGitHubArtifact(
	id: number,
	output: string,
	token: string,
): Promise<void> {
	const response = await fetch(
		apiUrl(`/repos/${githubRepository()}/actions/artifacts/${id}/zip`),
		{
			headers: {
				Authorization: `Bearer ${token}`,
				"User-Agent": "nur-packages-ci",
				"X-GitHub-Api-Version": "2022-11-28",
			},
		},
	);
	if (!response.ok)
		throw new Error(`Artifact download failed: ${response.status}`);
	writeFileSync(output, new Uint8Array(await response.arrayBuffer()));
}

export function githubRepository(): string {
	return requiredEnvironment("GITHUB_REPOSITORY");
}

export async function currentBranchSha(branch: string): Promise<string> {
	const value = requireRecord(
		await githubRequest(
			`/repos/${githubRepository()}/branches/${encodeURIComponent(branch)}`,
		),
		"base branch",
	);
	const commit = requireRecord(value.commit, "base branch.commit");
	const sha = requireString(commit.sha, "base branch.commit.sha");
	if (!/^[0-9a-f]{40}$/.test(sha)) {
		throw new Error("base branch.commit.sha must be a full commit SHA");
	}
	return sha;
}

export function decodeBase64(value: string): string {
	return Buffer.from(value.replaceAll(/\s/g, ""), "base64").toString("utf8");
}
