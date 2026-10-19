#!/usr/bin/env nix
/*
#!nix shell nixpkgs#bun --command bun
*/
/** Update Helium's Linux and macOS releases independently. */

import { join } from "node:path";
import process from "node:process";

const SOURCES_PATH = join(import.meta.dir, "sources.json");
const USER_AGENT = "nur-packages (+https://github.com/9bingyin/nur-packages)";
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9.+_-]*$/;
const PLATFORMS = {
	linux: {
		assets: {
			"x86_64-linux": "x86_64_linux.tar.xz",
			"aarch64-linux": "arm64_linux.tar.xz",
		},
		repository: "helium-linux",
	},
	darwin: {
		assets: {
			"aarch64-darwin": "arm64-macos.dmg",
		},
		repository: "helium-macos",
	},
} as const;

type Platform = keyof typeof PLATFORMS;
type PlatformSource = {
	hashes: Record<string, string>;
	version: string;
};
type Sources = Record<Platform, PlatformSource>;
type CommitChange = {
	commitMessage: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlatformSource(value: unknown): value is PlatformSource {
	if (
		!isRecord(value) ||
		typeof value.version !== "string" ||
		!isRecord(value.hashes)
	) {
		return false;
	}
	return Object.values(value.hashes).every((hash) => typeof hash === "string");
}

function parseSources(value: unknown): Sources {
	if (!isRecord(value)) {
		throw new Error("Helium sources.json is not an object");
	}
	const sources = {} as Sources;
	for (const platform of Object.keys(PLATFORMS) as Platform[]) {
		const entry = value[platform];
		if (!isPlatformSource(entry)) {
			throw new Error(`Helium sources.json has no ${platform} release`);
		}
		sources[platform] = {
			hashes: { ...entry.hashes },
			version: entry.version,
		};
	}
	return sources;
}

function pythonQuote(value: string, safe: string): string {
	const alwaysSafe = `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-${safe}`;
	return [...value]
		.map((char) => {
			if (alwaysSafe.includes(char)) {
				return char;
			}
			return [...Buffer.from(char)]
				.map((byte) => `%${byte.toString(16).toUpperCase()}`)
				.join("");
		})
		.join("");
}

async function latestRelease(repository: string): Promise<string> {
	const response = await fetch(
		`https://github.com/imputnet/${repository}/releases/latest`,
		{
			headers: { "User-Agent": USER_AGENT },
			method: "HEAD",
			signal: AbortSignal.timeout(30_000),
		},
	);
	if (!response.ok) {
		throw new Error(
			`Helium release lookup returned HTTP ${response.status} ${response.statusText}`,
		);
	}
	const path = new URL(response.url).pathname;
	const prefix = `/imputnet/${repository}/releases/tag/`;
	if (!path.startsWith(prefix)) {
		throw new Error(`Unexpected Helium release URL: ${response.url}`);
	}
	const version = decodeURIComponent(path.slice(prefix.length)).replace(
		/\/$/,
		"",
	);
	if (!VERSION_RE.test(version)) {
		throw new Error(`Invalid Helium release tag: ${version}`);
	}
	return version;
}

function assetUrl(repository: string, version: string, suffix: string): string {
	const asset =
		repository === "helium-linux"
			? `helium-${version}-${suffix}`
			: `helium_${version}_${suffix}`;
	const quotedVersion = pythonQuote(version, ".+_-");
	const quotedAsset = pythonQuote(asset, "");
	return `https://github.com/imputnet/${repository}/releases/download/${quotedVersion}/${quotedAsset}`;
}

function prefetchSriHash(url: string): string {
	const result = Bun.spawnSync(
		["nix", "store", "prefetch-file", "--json", url],
		{
			stderr: "inherit",
			stdout: "pipe",
		},
	);
	if (result.exitCode !== 0) {
		throw new Error(
			`Command failed with exit code ${result.exitCode}: nix store prefetch-file --json ${url}`,
		);
	}
	if (result.stdout === undefined) {
		throw new Error(`nix store prefetch-file returned no stdout for ${url}`);
	}
	const payload: unknown = JSON.parse(result.stdout.toString());
	if (!isRecord(payload)) {
		throw new Error(
			`nix store prefetch-file returned an invalid payload for ${url}`,
		);
	}
	const hashValue = payload.hash;
	if (typeof hashValue !== "string" || !hashValue.startsWith("sha256-")) {
		throw new Error(`nix store prefetch-file returned no SRI hash for ${url}`);
	}
	return hashValue;
}

async function updatePackage(): Promise<readonly CommitChange[]> {
	const sources = parseSources(await Bun.file(SOURCES_PATH).json());
	const changes: string[] = [];
	for (const platform of Object.keys(PLATFORMS) as Platform[]) {
		const { assets, repository } = PLATFORMS[platform];
		const version = await latestRelease(repository);
		const current = sources[platform];
		if (current.version === version) {
			continue;
		}
		const hashes: Record<string, string> = {};
		for (const [system, suffix] of Object.entries(assets)) {
			hashes[system] = prefetchSriHash(assetUrl(repository, version, suffix));
		}
		sources[platform] = { hashes, version };
		const label = platform === "darwin" ? "macos" : "linux";
		changes.push(`${label} ${current.version} -> ${version}`);
	}
	if (changes.length === 0) {
		return [];
	}
	await Bun.write(SOURCES_PATH, `${JSON.stringify(sources, null, 2)}\n`);
	return [{ commitMessage: `helium-bin: ${changes.join("; ")}` }];
}

async function main(): Promise<void> {
	console.log(JSON.stringify(await updatePackage()));
}

try {
	await main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`error: ${message}`);
	process.exitCode = 1;
}
