#!/usr/bin/env nix
/*
#!nix shell nixpkgs#bun --command bun
*/
/** Update Zed (aarch64-darwin) from Zed's stable release API. */

import { join } from "node:path";
import process from "node:process";

const ASSET_NAME = "Zed-aarch64.dmg";
const RELEASE_URL =
	"https://cloud.zed.dev/releases/stable/latest/asset?os=macos&arch=aarch64&asset=zed";
const PACKAGE_PATH = join(import.meta.dir, "package.nix");
const USER_AGENT = "nur-packages (+https://github.com/9bingyin/nur-packages)";
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
	if (!capture) {
		return "";
	}
	if (result.stdout === undefined) {
		throw new Error(`Command produced no stdout: ${command.join(" ")}`);
	}
	return result.stdout.toString();
}

function downloadUrl(version: string): string {
	return `https://zed.dev/api/releases/stable/${version}/${ASSET_NAME}`;
}

async function latestRelease(): Promise<readonly [string, string]> {
	const response = await fetch(RELEASE_URL, {
		headers: { Accept: "application/json", "User-Agent": USER_AGENT },
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) {
		throw new Error(
			`Zed release API returned HTTP ${response.status} ${response.statusText}`,
		);
	}
	const payload: unknown = await response.json();
	if (!isRecord(payload)) {
		throw new Error("Zed release API returned a non-object payload");
	}
	const version = payload.version;
	const url = payload.url;
	if (typeof version !== "string" || !VERSION_RE.test(version)) {
		throw new Error("Zed release API has an invalid version");
	}
	const expectedSuffix = `/v${version}/${ASSET_NAME}`;
	if (typeof url !== "string" || !url.endsWith(expectedSuffix)) {
		throw new Error(
			`Zed release asset was renamed or moved: ${JSON.stringify(url)}`,
		);
	}
	return [version, downloadUrl(version)];
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

function currentVersion(packageText: string): string {
	const match = /^ {2}version = "([^"]+)";/m.exec(packageText);
	if (match?.[1] === undefined) {
		throw new Error("Failed to read current Zed version");
	}
	return match[1];
}

async function updatePackage(version: string, url: string): Promise<void> {
	const packageText = await Bun.file(PACKAGE_PATH).text();
	if (currentVersion(packageText) === version) {
		console.log(`zed-editor-bin is already at ${version}`);
		return;
	}

	const updated = replaceOnce(
		replaceOnce(
			packageText,
			'^  version = "[^"]+";',
			`  version = "${version}";`,
			"Failed to update Zed version",
		),
		'(hash = ")[^"]+(";)',
		`$1${prefetchSriHash(url)}$2`,
		"Failed to update Zed hash",
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
