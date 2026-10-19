#!/usr/bin/env nix
/*
#!nix shell nixpkgs#bun --command bun
*/
/** Update Sparkle and its bundled service with nix-update. */

import { join } from "node:path";
import process from "node:process";

const ROOT = join(import.meta.dir, "../..");
const PACKAGE_PATH = join(import.meta.dir, "package.nix");
const SYSTEM = "aarch64-darwin";
const SPARKLE_VERSION = /^ {2}version = "([^"]+)";/m;
const SERVICE_BLOCK =
	/ {2}sparkle-service = buildGoModule \{(?<body>.*?)\n {2}\};/s;
const SERVICE_VERSION =
	/(pname = "sparkle-service";\n\s+version = ")([^"]+)(";)/;
const SERVICE_SOURCE =
	/src = fetchFromGitHub \{.*?rev = "([^"]+)";\s+hash = "([^"]+)";\s+\};\s+vendorHash = "([^"]+)";/s;
const UNSTABLE_VERSION = /^(?:.*-)?unstable-(\d{4}-\d{2}-\d{2})$/;

type CommitChange = {
	commitBody?: string;
	commitMessage: string;
};

function nixUpdate(...args: readonly string[]): void {
	const command = [
		"nix",
		"run",
		"nixpkgs#nix-update",
		"--",
		"--flake",
		"--system",
		SYSTEM,
		...args,
	];
	const result = Bun.spawnSync(command, {
		cwd: ROOT,
		stderr: "inherit",
		stdout: "pipe",
	});
	if (result.stdout !== undefined && result.stdout.length > 0) {
		process.stderr.write(result.stdout);
	}
	if (result.exitCode !== 0) {
		throw new Error(
			`Command failed with exit code ${result.exitCode}: ${command.join(" ")}`,
		);
	}
}

function versions(text: string): readonly [string, string] {
	const sparkle = SPARKLE_VERSION.exec(text)?.[1];
	const service = SERVICE_VERSION.exec(text)?.[2];
	if (sparkle === undefined || service === undefined) {
		throw new Error("Failed to read Sparkle package versions");
	}
	return [sparkle, service];
}

function serviceSource(text: string): readonly [string, string, string] {
	const body = SERVICE_BLOCK.exec(text)?.groups?.body;
	const source = body === undefined ? null : SERVICE_SOURCE.exec(body);
	if (
		source?.[1] === undefined ||
		source[2] === undefined ||
		source[3] === undefined
	) {
		throw new Error("Failed to read sparkle-service source");
	}
	return [source[1], source[2], source[3]];
}

function sameSource(
	left: readonly [string, string, string],
	right: readonly [string, string, string],
): boolean {
	return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

function normalizeServiceVersion(text: string): string {
	const service = SERVICE_VERSION.exec(text);
	const current = service?.[2];
	if (current === undefined) {
		throw new Error("Failed to find sparkle-service version");
	}
	const unstable = UNSTABLE_VERSION.exec(current)?.[1];
	if (unstable === undefined) {
		throw new Error(`Unexpected sparkle-service version: ${current}`);
	}
	return text.replace(SERVICE_VERSION, `$10-unstable-${unstable}$3`);
}

function serviceChange(
	oldVersion: string,
	newVersion: string,
): readonly [string, string] {
	if (oldVersion === newVersion) {
		return [
			`sparkle: refresh sparkle-service ${newVersion}`,
			`Refresh bundled \`sparkle-service\` at \`${newVersion}\`.`,
		];
	}
	return [
		`sparkle: update sparkle-service ${oldVersion} -> ${newVersion}`,
		`Update bundled \`sparkle-service\` from \`${oldVersion}\` to \`${newVersion}\`.`,
	];
}

async function main(): Promise<void> {
	const original = await Bun.file(PACKAGE_PATH).text();
	const [oldSparkle, oldService] = versions(original);

	nixUpdate("sparkle");
	const afterSparkle = await Bun.file(PACKAGE_PATH).text();
	nixUpdate("--version=branch=main", "sparkle.sparkle-service");
	const final = normalizeServiceVersion(await Bun.file(PACKAGE_PATH).text());
	await Bun.write(PACKAGE_PATH, final);

	const [newSparkle, newService] = versions(final);
	const sparkleChanged = afterSparkle !== original;
	const serviceChanged = !sameSource(
		serviceSource(final),
		serviceSource(afterSparkle),
	);
	if (sparkleChanged && oldSparkle === newSparkle) {
		throw new Error("Sparkle changed without changing its version");
	}
	if (!sparkleChanged && !serviceChanged) {
		console.log("[]");
		return;
	}

	const [serviceMessage, serviceBody] = serviceChange(oldService, newService);
	const change: CommitChange = sparkleChanged
		? {
				commitMessage: `sparkle: ${oldSparkle} -> ${newSparkle}`,
				...(serviceChanged ? { commitBody: serviceBody } : {}),
			}
		: {
				commitBody: serviceBody,
				commitMessage: serviceMessage,
			};
	console.log(JSON.stringify([change]));
}

try {
	await main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`error: ${message}`);
	process.exitCode = 1;
}
