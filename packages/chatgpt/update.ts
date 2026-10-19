#!/usr/bin/env nix
/*
#!nix shell nixpkgs#bun --command bun
*/
/** Update ChatGPT (aarch64-darwin) from OpenAI's official Sparkle appcast. */

import { join } from "node:path";
import process from "node:process";

const APPCAST_BASE_URL = "https://persistent.oaistatic.com/codex-app-prod";
const APPCAST_URL = `${APPCAST_BASE_URL}/appcast.xml`;
const ARCH = "arm64";
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

function elementText(xml: string, name: string): string | undefined {
	const match = new RegExp(
		`<(?:[A-Za-z0-9]+:)?${name}>([^<]*)</(?:[A-Za-z0-9]+:)?${name}>`,
	).exec(xml);
	return match?.[1];
}

function enclosureUrl(item: string): string | undefined {
	const match = /<enclosure\b([^>]*)\/?>/.exec(item);
	const attributes = match?.[1];
	if (attributes === undefined) {
		return undefined;
	}
	return /\burl="([^"]*)"/.exec(attributes)?.[1];
}

async function latestRelease(): Promise<readonly [string, string]> {
	const response = await fetch(APPCAST_URL, {
		headers: { "User-Agent": USER_AGENT },
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) {
		throw new Error(
			`ChatGPT appcast returned HTTP ${response.status} ${response.statusText}`,
		);
	}
	const xml = await response.text();
	const item = /<item\b[^>]*>([\s\S]*?)<\/item>/.exec(xml)?.[1];
	if (item === undefined) {
		throw new Error("ChatGPT appcast has no release item");
	}
	const version = elementText(item, "shortVersionString");
	const url = enclosureUrl(item);
	if (version === undefined || !VERSION_RE.test(version)) {
		throw new Error("ChatGPT appcast has an invalid version");
	}
	const expectedUrl = `${APPCAST_BASE_URL}/ChatGPT-darwin-${ARCH}-${version}.zip`;
	if (url !== expectedUrl) {
		throw new Error(
			`ChatGPT appcast has an unexpected download URL: ${JSON.stringify(url)}`,
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
	const expression = new RegExp(pattern, "m");
	if (expression.exec(text) === null) {
		throw new Error(error);
	}
	expression.lastIndex = 0;
	return text.replace(expression, replacement);
}

async function updatePackage(version: string, url: string): Promise<void> {
	const updated = replaceOnce(
		replaceOnce(
			await Bun.file(PACKAGE_PATH).text(),
			'^  version = "[^"]+";',
			`  version = "${version}";`,
			"Failed to update ChatGPT version",
		),
		'(hash = ")[^"]+(";)',
		`$1${prefetchSriHash(url)}$2`,
		"Failed to update ChatGPT hash",
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
