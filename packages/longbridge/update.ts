#!/usr/bin/env nix
/*
#!nix shell nixpkgs#bun --command bun
*/
/** Update Longbridge after both native release artifacts are available. */

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const REPOSITORY_URL =
	"https://github.com/longbridge/longbridge-desktop-website.git";
const PACKAGE_PATH = join(import.meta.dir, "package.nix");
const USER_AGENT = "nur-packages (+https://github.com/9bingyin/nur-packages)";
const SUFFIXES = ["linux-x86_64.deb", "macos-aarch64.dmg"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function run(command: readonly string[], capture = false): string {
	if (command.length === 0) {
		throw new Error("Command must not be empty");
	}
	const result = Bun.spawnSync([...command], {
		stderr: "inherit",
		stdout: capture ? "pipe" : "inherit",
	});
	if (result.exitCode !== 0) {
		throw new Error(
			`Command failed with exit code ${result.exitCode}: ${command.join(" ")}`,
		);
	}
	if (!capture) {
		return "";
	}
	if (result.stdout === undefined) {
		throw new Error(`Command produced no stdout: ${command.join(" ")}`);
	}
	return result.stdout.toString();
}

function releaseVersions(): readonly string[] {
	const directory = mkdtempSync(join(tmpdir(), "longbridge-update-"));
	try {
		const repository = join(directory, "repository");
		run([
			"git",
			"clone",
			"--depth=1",
			"--filter=blob:none",
			"--sparse",
			REPOSITORY_URL,
			repository,
		]);
		run([
			"git",
			"-C",
			repository,
			"sparse-checkout",
			"set",
			"docs/release-notes",
		]);
		return readdirSync(join(repository, "docs/release-notes")).flatMap(
			(name) => {
				const version = /^v([0-9]+\.[0-9]+\.[0-9]+)\.md$/.exec(name)?.[1];
				return version === undefined ? [] : [version];
			},
		);
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
}

function compareVersionsDescending(left: string, right: string): number {
	const leftParts = left.split(".").map(Number);
	const rightParts = right.split(".").map(Number);
	const length = Math.max(leftParts.length, rightParts.length);
	for (let index = 0; index < length; index += 1) {
		const leftValue = leftParts[index] ?? 0;
		const rightValue = rightParts[index] ?? 0;
		if (leftValue !== rightValue) {
			return rightValue - leftValue;
		}
	}
	return 0;
}

async function artifactsAvailable(version: string): Promise<boolean> {
	const baseUrl =
		"https://assets.lbkrs.com/github/release/longbridge-desktop/stable/" +
		`longbridge-v${version}`;
	for (const suffix of SUFFIXES) {
		try {
			const response = await fetch(`${baseUrl}-${suffix}`, {
				headers: { "User-Agent": USER_AGENT },
				method: "HEAD",
				signal: AbortSignal.timeout(30_000),
			});
			if (response.status !== 200) {
				return false;
			}
		} catch {
			return false;
		}
	}
	return true;
}

async function latestVersion(): Promise<string> {
	const versions = [...releaseVersions()].sort(compareVersionsDescending);
	for (const version of versions) {
		if (await artifactsAvailable(version)) {
			return version;
		}
	}
	throw new Error("No Longbridge release has both Linux and macOS artifacts");
}

function prefetchSriHash(url: string): string {
	const payload: unknown = JSON.parse(
		run(["nix", "store", "prefetch-file", "--json", url], true),
	);
	if (!isRecord(payload)) {
		throw new Error(
			`nix store prefetch-file returned an invalid payload for ${url}`,
		);
	}
	const hashValue = payload.hash;
	if (typeof hashValue !== "string") {
		throw new Error(`nix store prefetch-file returned no hash for ${url}`);
	}
	return hashValue;
}

function replaceOnce(
	text: string,
	pattern: string,
	replacement: string,
	error: string,
): string {
	const expression = new RegExp(pattern, "m");
	if (expression.exec(text) === null) {
		throw new Error(error);
	}
	expression.lastIndex = 0;
	return text.replace(expression, replacement);
}

async function main(): Promise<void> {
	const version = await latestVersion();
	const baseUrl =
		"https://assets.lbkrs.com/github/release/longbridge-desktop/stable/" +
		`longbridge-v${version}`;
	let text = replaceOnce(
		await Bun.file(PACKAGE_PATH).text(),
		'^  version = "[^"]+";',
		`  version = "${version}";`,
		"Failed to update Longbridge version",
	);
	for (const suffix of SUFFIXES) {
		text = replaceOnce(
			text,
			`(suffix = "${suffix}";\\n\\s+hash = ")[^"]+(";)`,
			`$1${prefetchSriHash(`${baseUrl}-${suffix}`)}$2`,
			`Failed to update Longbridge hash for ${suffix}`,
		);
	}
	await Bun.write(PACKAGE_PATH, text);
}

try {
	await main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`error: ${message}`);
	process.exitCode = 1;
}
