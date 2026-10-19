#!/usr/bin/env nix
/*
#!nix shell nixpkgs#bun --command bun
*/
/** Update TeamSpeak 6 Client (aarch64-darwin) from the official downloads page. */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const DOWNLOADS_URL = "https://www.teamspeak.com/en/downloads/";
const DMG_URL_RE =
	/https:\/\/files\.teamspeak-services\.com\/pre_releases\/client\/([^/"']+)\/teamspeak-client-arm\.dmg/;
const PACKAGE_PATH = join(import.meta.dir, "package.nix");
// Cloudflare rejects clients that identify as Nix-style updaters.
// Keep this aligned with package.nix curlOptsList.
const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const CURL_OPTS = [
	"--http1.1",
	"-L",
	"-A",
	USER_AGENT,
	"-e",
	DOWNLOADS_URL,
] as const;

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

async function latestRelease(): Promise<readonly [string, string]> {
	const response = await fetch(DOWNLOADS_URL, {
		headers: { "User-Agent": USER_AGENT },
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) {
		throw new Error(
			`TeamSpeak downloads page returned HTTP ${response.status} ${response.statusText}`,
		);
	}
	const match = DMG_URL_RE.exec(await response.text());
	const version = match?.[1];
	const url = match?.[0];
	if (version === undefined || url === undefined) {
		throw new Error(
			"Could not find teamspeak-client-arm.dmg on the downloads page",
		);
	}
	return [version, url];
}

function prefetchSriHash(url: string): string {
	const directory = mkdtempSync(join(tmpdir(), "teamspeak6-client-"));
	const path = join(directory, "teamspeak-client-arm.dmg");
	try {
		run(["curl", ...CURL_OPTS, "-o", path, url]);
		return run(
			["nix", "hash", "file", "--type", "sha256", "--sri", path],
			true,
		).trim();
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
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

function currentVersion(packageText: string): string {
	const version = /^ {2}version = "([^"]+)";/m.exec(packageText)?.[1];
	if (version === undefined) {
		throw new Error("Failed to read current teamspeak6-client version");
	}
	return version;
}

async function updatePackage(version: string, url: string): Promise<void> {
	const packageText = await Bun.file(PACKAGE_PATH).text();
	if (currentVersion(packageText) === version) {
		console.log(`teamspeak6-client is already at ${version}`);
		return;
	}

	const updated = replaceOnce(
		replaceOnce(
			packageText,
			'^  version = "[^"]+";',
			`  version = "${version}";`,
			"Failed to update teamspeak6-client version",
		),
		'(hash = ")[^"]+(";)',
		`$1${prefetchSriHash(url)}$2`,
		"Failed to update teamspeak6-client hash",
	);
	await Bun.write(PACKAGE_PATH, updated);
}

async function main(): Promise<void> {
	const [version, url] = await latestRelease();
	await updatePackage(version, url);
}

try {
	await main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`error: ${message}`);
	process.exitCode = 1;
}
