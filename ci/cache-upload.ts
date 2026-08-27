import { createHash } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
	appendStepSummary,
	prettyJson,
	readJsonFile,
	requireString,
	run,
	writeTextFile,
} from "./lib.ts";

const STORE_PATH_PATTERN = /^\/nix\/store\/[0-9a-z]{32}-[^/\0]+$/;
const SYSTEM_PATTERN = /^[A-Za-z0-9_+-]+$/;

type Arguments = Readonly<{
	bundle: string;
	output: string;
	repository: string;
	system: string;
}>;

type UploadReport = Readonly<{
	storePaths: readonly string[];
	success: boolean;
	system: string;
}>;

function parseArguments(args: readonly string[]): Arguments {
	const values = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index];
		const value = args[index + 1];
		if (!flag?.startsWith("--") || value === undefined) {
			throw new Error(
				"Expected --bundle, --repository, --system and --output arguments",
			);
		}
		values.set(flag.slice(2), value);
	}
	const bundle = values.get("bundle");
	const repository = values.get("repository");
	const system = values.get("system");
	const output = values.get("output");
	if (!bundle || !repository || !system || !output || values.size !== 4) {
		throw new Error(
			"Expected --bundle, --repository, --system and --output arguments",
		);
	}
	if (!SYSTEM_PATTERN.test(system)) {
		throw new Error(`Unsupported Nix system: ${system}`);
	}
	return { bundle, output, repository, system };
}

export function parseStorePaths(value: unknown): readonly string[] {
	if (!Array.isArray(value)) {
		throw new Error("cache bundle paths.json must be an array");
	}
	const paths = value.map((item, index) => {
		const path = requireString(item, `cache bundle path ${index}`);
		if (!STORE_PATH_PATTERN.test(path)) {
			throw new Error(`Invalid Nix store path: ${path}`);
		}
		return path;
	});
	if (new Set(paths).size !== paths.length) {
		throw new Error("cache bundle contains duplicate store paths");
	}
	return paths.sort();
}

function nixString(value: string): string {
	return JSON.stringify(value);
}

function uploadExpression(
	repository: string,
	system: string,
	storePaths: readonly string[],
): string {
	const name = createHash("sha256")
		.update(storePaths.join("\n"))
		.digest("hex")
		.slice(0, 16);
	const paths = storePaths.map(nixString).join(" ");
	const links = storePaths
		.map(
			(_path, index) =>
				`ln -s \${pkgs.lib.escapeShellArg (builtins.elemAt paths ${index})} "$out/${index}"`,
		)
		.join("\n");
	return `
let
  flake = builtins.getFlake ${nixString(`path:${realpathSync(repository)}`)};
  pkgs = import flake.inputs.nixpkgs { inherit system; };
  system = ${nixString(system)};
  paths = map builtins.storePath [ ${paths} ];
in
pkgs.runCommand "cache-upload-${name}"
  {
    allowSubstitutes = false;
    preferLocalBuild = true;
    inherit paths;
  }
  ''
    mkdir -p "$out"
    ${links}
  ''
`;
}

function uploadMarkdown(report: UploadReport): string {
	return [
		`## Cache upload: ${report.system}`,
		"",
		`- Store paths: ${report.storePaths.length}`,
		`- Upload: ${report.success ? "success" : "failure"}`,
		"",
	].join("\n");
}

function writeReport(path: string, report: UploadReport): void {
	writeTextFile(path, prettyJson(report));
	const summary = uploadMarkdown(report);
	console.log(summary);
	appendStepSummary(summary);
}

export async function uploadCache(args: readonly string[]): Promise<void> {
	const { bundle, output, repository, system } = parseArguments(args);
	const storePaths = parseStorePaths(readJsonFile(`${bundle}/paths.json`));
	if (storePaths.length === 0) {
		writeReport(output, { storePaths, success: true, system });
		return;
	}
	try {
		const storeDirectory = `${bundle}/store`;
		await run([
			"nix",
			"copy",
			"--no-check-sigs",
			"--from",
			pathToFileURL(storeDirectory).href,
			...storePaths,
		]);
		await run(["nix", "path-info", ...storePaths]);
		const expressionDirectory = `${bundle}/upload`;
		mkdirSync(expressionDirectory, { recursive: true });
		const expression = `${expressionDirectory}/default.nix`;
		writeTextFile(expression, uploadExpression(repository, system, storePaths));
		await run(["nix", "build", "--impure", "--no-link", "--file", expression]);
		writeReport(output, { storePaths, success: true, system });
	} catch (error) {
		writeReport(output, { storePaths, success: false, system });
		throw error;
	}
}
