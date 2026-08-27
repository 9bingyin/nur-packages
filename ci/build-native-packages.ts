import {
	chmodSync,
	mkdtempSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
	parseJson,
	requiredEnvironment,
	requireRecord,
	requireString,
	run,
	sleep,
} from "./lib.ts";

const NIKS3_AUDIENCE = "https://niks3.bingyin.org";
const NIX_FAST_BUILD_INPUT = "github:Mic92/nix-fast-build";

async function fetchOidcToken(): Promise<string> {
	const requestUrl = new URL(
		requiredEnvironment("ACTIONS_ID_TOKEN_REQUEST_URL"),
	);
	requestUrl.searchParams.set("audience", NIKS3_AUDIENCE);
	const response = await fetch(requestUrl, {
		headers: {
			Authorization: `Bearer ${requiredEnvironment("ACTIONS_ID_TOKEN_REQUEST_TOKEN")}`,
		},
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(
			`GitHub OIDC request failed with ${response.status}: ${text}`,
		);
	}
	const payload = requireRecord(
		parseJson(text, "GitHub OIDC response"),
		"GitHub OIDC response",
	);
	return requireString(payload.value, "GitHub OIDC response.value");
}

async function writeToken(path: string): Promise<void> {
	const temporary = `${path}.new`;
	writeFileSync(temporary, await fetchOidcToken(), { mode: 0o600 });
	chmodSync(temporary, 0o600);
	renameSync(temporary, path);
}

async function refreshToken(path: string, signal: AbortSignal): Promise<void> {
	while (await sleep(180_000, signal)) {
		while (!signal.aborted) {
			try {
				await writeToken(path);
				break;
			} catch (error) {
				console.log(
					`::warning::Failed to refresh niks3 OIDC token: ${String(error)}`,
				);
				if (!(await sleep(15_000, signal))) {
					return;
				}
			}
		}
	}
}

export function nixFastBuildCommand(
	system: string,
	niks3Server: string | undefined,
): readonly string[] {
	return [
		"nix",
		"shell",
		NIX_FAST_BUILD_INPUT,
		...(niks3Server ? ["nixpkgs#niks3"] : []),
		"-c",
		"nix-fast-build",
		"--flake",
		`.#packages.${system}`,
		"--systems",
		system,
		"--skip-cached",
		"--eval-workers",
		"1",
		"--no-nom",
		...(niks3Server ? ["--niks3-server", niks3Server] : []),
	];
}

async function runBuild(
	system: string,
	niks3Server: string | undefined,
	tokenPath: string | undefined,
): Promise<void> {
	await run(nixFastBuildCommand(system, niks3Server), {
		...(tokenPath === undefined
			? {}
			: { env: { NIKS3_AUTH_TOKEN_FILE: tokenPath } }),
	});
}

export async function buildNativePackages(): Promise<void> {
	const system = requiredEnvironment("SYSTEM");
	const niks3Server = process.env.NIKS3_SERVER;
	if (!niks3Server) {
		await runBuild(system, undefined, undefined);
		return;
	}

	const directory = mkdtempSync(join(tmpdir(), "niks3-auth-"));
	const tokenPath = join(directory, "token");
	const controller = new AbortController();
	try {
		await writeToken(tokenPath);
		const refresh = refreshToken(tokenPath, controller.signal);
		try {
			await runBuild(system, niks3Server, tokenPath);
		} finally {
			controller.abort();
			await refresh;
		}
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
}
