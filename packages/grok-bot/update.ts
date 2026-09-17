#!/usr/bin/env bun
/** Update Grok Bot (aarch64-darwin) from Cursor's stable update feed. */

import { join } from "node:path";
import process from "node:process";

const ARCH = "darwin-arm64";
const FEED_URL = `https://api2.cursor.sh/updates/api/update/${ARCH}/sand/0.0.1/stable`;
const DOWNLOAD_BASE = "https://downloads.cursor.com/grokbot/stable";
const PACKAGE_PATH = join(import.meta.dir, "package.nix");
const USER_AGENT = "9bingyin-nur-packages-updater";
const VERSION_RE = /^[0-9]+(?:\.[0-9]+)+$/;

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
	return capture ? result.stdout.toString() : "";
}

async function latestRelease(): Promise<readonly [string, string]> {
	const response = await fetch(FEED_URL, {
		headers: { "User-Agent": USER_AGENT },
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) {
		throw new Error(
			`Grok Bot update feed returned HTTP ${response.status} ${response.statusText}`,
		);
	}
	const payload: unknown = await response.json();
	if (!isRecord(payload)) {
		throw new Error("Grok Bot update feed returned a non-object payload");
	}
	const version = payload.name;
	const url = payload.url;
	if (typeof version !== "string" || !VERSION_RE.test(version)) {
		throw new Error("Grok Bot update feed has an invalid version");
	}
	const expectedUrl = `${DOWNLOAD_BASE}/${ARCH}/${version}/Grok_Bot_${version}.zip`;
	if (url !== expectedUrl) {
		throw new Error(
			`Grok Bot update feed has an unexpected download URL: ${JSON.stringify(url)}`,
		);
	}
	return [version, expectedUrl];
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
	const updated = text.replace(new RegExp(pattern, "m"), replacement);
	if (updated === text) {
		throw new Error(error);
	}
	return updated;
}

function currentVersion(packageText: string): string {
	const match = /^ {2}version = "([^"]+)";/m.exec(packageText);
	if (match?.[1] === undefined) {
		throw new Error("Failed to read current Grok Bot version");
	}
	return match[1];
}

async function updatePackage(version: string, url: string): Promise<void> {
	const packageText = await Bun.file(PACKAGE_PATH).text();
	if (currentVersion(packageText) === version) {
		console.log(`grok-bot is already at ${version}`);
		return;
	}

	const updated = replaceOnce(
		replaceOnce(
			packageText,
			'^  version = "[^"]+";',
			`  version = "${version}";`,
			"Failed to update Grok Bot version",
		),
		'(hash = ")[^"]+(";)',
		`$1${prefetchSriHash(url)}$2`,
		"Failed to update Grok Bot hash",
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
