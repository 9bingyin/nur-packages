#!/usr/bin/env nix
/*
#!nix shell nixpkgs#bun --command bun
*/
/** Update UU Remote (aarch64-darwin) from NetEase's release redirect. */

import { join } from "node:path";
import process from "node:process";

const LIVECHECK_URL =
	"https://api.nrd.nie.163.com/api/v1/release/dl/4?channel=gwqd";
const PACKAGE_PATH = join(import.meta.dir, "package.nix");
const USER_AGENT = "9bingyin-nur-packages-updater";
const VERSION_RE = /^[0-9]+(?:\.[0-9]+)+$/;
const PKG_URL_RE = /uuyc[._-]v?(\d+(?:\.\d+)+)\.pkg/i;

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
	// Drop the signed query and use the nochannel artifact, matching Homebrew.
	return `https://a56.gdl.netease.com/uuyc_${version}_nochannel.pkg`;
}

function versionParts(version: string): readonly number[] {
	if (!VERSION_RE.test(version)) {
		throw new Error(`Invalid version: ${version}`);
	}
	return version.split(".").map((part) => {
		const value = Number(part);
		if (!Number.isSafeInteger(value)) {
			throw new Error(`Invalid version segment: ${part}`);
		}
		return value;
	});
}

function compareVersions(left: string, right: string): number {
	const leftParts = versionParts(left);
	const rightParts = versionParts(right);
	const length = Math.max(leftParts.length, rightParts.length);
	for (let index = 0; index < length; index += 1) {
		const leftValue = leftParts[index] ?? 0;
		const rightValue = rightParts[index] ?? 0;
		if (leftValue !== rightValue) {
			return leftValue < rightValue ? -1 : 1;
		}
	}
	return 0;
}

async function latestRelease(): Promise<readonly [string, string]> {
	// Match Homebrew livecheck: only inspect the redirect Location header.
	const response = await fetch(LIVECHECK_URL, {
		headers: { "User-Agent": USER_AGENT },
		redirect: "manual",
		signal: AbortSignal.timeout(30_000),
	});
	if (response.status < 300 || response.status >= 400) {
		throw new Error(
			`UU Remote livecheck returned HTTP ${response.status} ${response.statusText}`,
		);
	}
	const location = response.headers.get("location");
	if (location === null || location.length === 0) {
		throw new Error("UU Remote livecheck returned no Location header");
	}
	const version = PKG_URL_RE.exec(location)?.[1];
	if (version === undefined || !VERSION_RE.test(version)) {
		throw new Error(
			`Could not parse UU Remote version from ${JSON.stringify(location)}`,
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
	const updated = text.replace(new RegExp(pattern, "m"), replacement);
	if (updated === text) {
		throw new Error(error);
	}
	return updated;
}

function currentVersion(packageText: string): string {
	const version = /^ {2}version = "([^"]+)";/m.exec(packageText)?.[1];
	if (version === undefined || !VERSION_RE.test(version)) {
		throw new Error("Failed to read current uuremote version");
	}
	return version;
}

async function updatePackage(version: string, url: string): Promise<void> {
	const packageText = await Bun.file(PACKAGE_PATH).text();
	const current = currentVersion(packageText);
	const comparison = compareVersions(version, current);
	if (comparison === 0) {
		console.log(`uuremote is already at ${version}`);
		return;
	}
	if (comparison < 0) {
		console.log(
			`uuremote livecheck returned ${version}, which is older than ${current}; skipping downgrade`,
		);
		return;
	}

	const updated = replaceOnce(
		replaceOnce(
			packageText,
			'^  version = "[^"]+";',
			`  version = "${version}";`,
			"Failed to update uuremote version",
		),
		'(hash = ")[^"]+(";)',
		`$1${prefetchSriHash(url)}$2`,
		"Failed to update uuremote hash",
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
