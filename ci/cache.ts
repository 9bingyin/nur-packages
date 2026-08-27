import {
	chmodSync,
	mkdtempSync,
	realpathSync,
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

const TOKEN_REFRESH_INTERVAL = 180_000;
const TOKEN_REFRESH_RETRY_INTERVAL = 15_000;

type Arguments = Readonly<{
	output: string;
	repository: string;
	system: string;
}>;

function parseArguments(args: readonly string[]): Arguments {
	const values = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index];
		const value = args[index + 1];
		if (!flag?.startsWith("--") || value === undefined) {
			throw new Error("Expected --repository, --system and --output arguments");
		}
		values.set(flag.slice(2), value);
	}
	const repository = values.get("repository");
	const system = values.get("system");
	const output = values.get("output");
	if (!repository || !system || !output || values.size !== 3) {
		throw new Error("Expected --repository, --system and --output arguments");
	}
	return { output, repository, system };
}

export function nixFastBuildCommand(
	repository: string,
	system: string,
	output: string,
	niks3Server: string,
): readonly string[] {
	return [
		"nix-fast-build",
		"--flake",
		`path:${realpathSync(repository)}#packages.${system}`,
		"--systems",
		system,
		"--skip-cached",
		"--eval-workers",
		"1",
		"--no-nom",
		"--niks3-server",
		niks3Server,
		"--result-format",
		"json",
		"--result-file",
		output,
	];
}

async function fetchOidcToken(audience: string): Promise<string> {
	const requestUrl = new URL(
		requiredEnvironment("ACTIONS_ID_TOKEN_REQUEST_URL"),
	);
	requestUrl.searchParams.set("audience", audience);
	const response = await fetch(requestUrl, {
		headers: {
			Authorization: `Bearer ${requiredEnvironment("ACTIONS_ID_TOKEN_REQUEST_TOKEN")}`,
		},
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) {
		throw new Error(
			`GitHub OIDC request failed with status ${response.status}`,
		);
	}
	const payload = requireRecord(
		parseJson(await response.text(), "GitHub OIDC response"),
		"GitHub OIDC response",
	);
	return requireString(payload.value, "GitHub OIDC response.value");
}

async function writeOidcToken(path: string, audience: string): Promise<void> {
	const temporary = `${path}.new`;
	writeFileSync(temporary, await fetchOidcToken(audience), { mode: 0o600 });
	chmodSync(temporary, 0o600);
	renameSync(temporary, path);
}

async function refreshOidcToken(
	path: string,
	audience: string,
	signal: AbortSignal,
): Promise<void> {
	while (await sleep(TOKEN_REFRESH_INTERVAL, signal)) {
		while (!signal.aborted) {
			try {
				await writeOidcToken(path, audience);
				break;
			} catch (error) {
				console.warn(`Failed to refresh niks3 OIDC token: ${String(error)}`);
				await sleep(TOKEN_REFRESH_RETRY_INTERVAL, signal);
			}
		}
	}
}

export async function buildCache(args: readonly string[]): Promise<void> {
	const { output, repository, system } = parseArguments(args);
	const niks3Server = requiredEnvironment("NIKS3_SERVER");
	const directory = mkdtempSync(join(tmpdir(), "niks3-auth-"));
	const tokenPath = join(directory, "token");
	const controller = new AbortController();
	try {
		await writeOidcToken(tokenPath, niks3Server);
		const refresh = refreshOidcToken(tokenPath, niks3Server, controller.signal);
		try {
			await run(nixFastBuildCommand(repository, system, output, niks3Server), {
				env: { NIKS3_AUTH_TOKEN_FILE: tokenPath },
			});
		} finally {
			controller.abort();
			await refresh;
		}
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
}
