#!/usr/bin/env nix
/*
#! nix shell --inputs-from . nixpkgs#bun --command bun
*/

import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

type ChangedFile = Readonly<{
	newMode: string;
	oldMode: string;
	path: string;
	status: "A" | "D" | "M";
}>;

type UpdateArgument = Readonly<{
	drvPaths: readonly string[];
	path: string;
}>;

type CommitChange = Readonly<{
	commitBody: string | null;
	commitMessage: string | null;
}>;

export type UpdateScript = Readonly<{
	argv: readonly UpdateArgument[];
	attrPath: string;
	error?: string;
	name: string;
	oldVersion: string;
	pname: string;
	sourceRoot: string;
	supportedFeatures: readonly string[];
}>;

type CommandResult = Readonly<{
	exitCode: number;
	stderr: string;
	stdout: string;
}>;

export const UPDATE_EXPRESSION = `
let
  config = builtins.fromJSON (builtins.getEnv "UPDATE_CONFIG");
  flake = builtins.getFlake (toString ./.);
  lib = flake.inputs.nixpkgs.lib;
  # Earlier systems own a package that exists on more than one system.
  preferred = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
  systems = preferred ++ lib.optionals (!lib.elem config.system preferred) [ config.system ];
  exists = system: name: builtins.hasAttr name (flake.packages.\${system} or { });
  ownerOf = name:
    let
      owners = builtins.filter (system: exists system name) systems;
    in
    if owners == [ ] then null else builtins.head owners;
  packages = flake.packages.\${config.system} or { };
  wanted =
    if config.packages == [ ] then
      builtins.filter (name: ownerOf name == config.system) (builtins.attrNames packages)
    else
      builtins.filter (
        name:
        let
          owner = ownerOf name;
        in
        owner == config.system || (owner == null && config.system == builtins.head systems)
      ) config.packages;
  normalize = name: script:
    if builtins.isList script || builtins.isString script || lib.isDerivation script then {
      command = script;
      attrPath = name;
      supportedFeatures = [ ];
    } else {
      command = script.command or script;
      attrPath = script.attrPath or name;
      supportedFeatures = script.supportedFeatures or [ ];
    };
  argumentOf = value: {
    path = toString value;
    drvPaths =
      if lib.isDerivation value then [ value.drvPath ]
      else if builtins.isString value then builtins.attrNames (builtins.getContext value)
      else [ ];
  };
  scriptOf = name:
    let
      package = packages.\${name} or null;
      updateScript = if package == null then null else package.updateScript or null;
      evaluated = builtins.tryEval (
        if package == null then { error = "missing package \${name}"; }
        else if updateScript == null then null
        else
          let
            normalized = normalize name updateScript;
          in {
            argv = map argumentOf (lib.toList normalized.command);
            attrPath = normalized.attrPath;
            name = package.name;
            oldVersion = lib.getVersion package;
            pname = lib.getName package;
            sourceRoot = toString flake.outPath;
            supportedFeatures = normalized.supportedFeatures;
          }
      );
    in
      if evaluated.success then evaluated.value else { error = "failed to evaluate \${name}"; };
in
  builtins.listToAttrs (map (name: { inherit name; value = scriptOf name; }) wanted)
`;

function required(name: string): string {
	const value = process.env[name];
	if (value === undefined || value === "") {
		throw new Error(`${name} is required`);
	}
	return value;
}

function run(
	args: readonly string[],
	options: Readonly<{ cwd?: string; env?: NodeJS.ProcessEnv }> = {},
): CommandResult {
	const result = Bun.spawnSync([...args], {
		cwd: options.cwd,
		env: options.env,
		stderr: "pipe",
		stdout: "pipe",
	});
	return {
		exitCode: result.exitCode,
		stderr: result.stderr.toString(),
		stdout: result.stdout.toString(),
	};
}

function runChecked(
	args: readonly string[],
	options: Readonly<{ cwd?: string; env?: NodeJS.ProcessEnv }> = {},
): CommandResult {
	const result = run(args, options);
	if (result.exitCode !== 0) {
		throw new Error(
			`${args.join(" ")} failed with exit code ${result.exitCode}: ${result.stderr.trim()}`,
		);
	}
	return result;
}

export function rewritePath(
	sourceRoot: string,
	repository: string,
	path: string,
): string {
	const root = sourceRoot.replace(/\/$/, "");
	if (path === root) {
		return repository;
	}
	const prefix = `${root}/`;
	return path.startsWith(prefix)
		? `${repository}/${path.slice(prefix.length)}`
		: path;
}

export function versionAccepted(
	oldVersion: string,
	newVersion: string,
	features: readonly string[],
	messages: readonly (string | null)[],
): boolean {
	const allowSameVersion =
		!features.includes("commit") || features.includes("same-version");
	return (
		newVersion !== "unknown" &&
		(newVersion !== oldVersion ||
			(allowSameVersion &&
				(messages.length === 0 ||
					messages.some((message) => Boolean(message?.trim())))))
	);
}

export function updateTitle(
	name: string,
	oldVersion: string,
	newVersion: string,
	messages: readonly (string | null)[],
): string {
	const message = messages.find((item) => item?.trim());
	if (message !== undefined && message !== null) {
		return message.trim();
	}
	return oldVersion === newVersion
		? `${name}: refresh ${newVersion}`
		: `${name}: ${oldVersion} -> ${newVersion}`;
}

export function filesAllowed(
	name: string,
	files: readonly ChangedFile[],
): string | null {
	if (files.length === 0) {
		return "update does not change any files";
	}
	for (const file of files) {
		const modes = [file.oldMode, file.newMode].filter(
			(mode) => mode !== "000000",
		);
		if (modes.some((mode) => mode !== "100644")) {
			return `${file.path} has an unsafe file mode`;
		}
		if (!file.path.startsWith(`packages/${name}/`)) {
			return `${file.path} is outside packages/${name}/`;
		}
	}
	return null;
}

function parseRawDiff(value: string): readonly ChangedFile[] {
	const parts = value.split("\0");
	if (parts.at(-1) === "") {
		parts.pop();
	}
	if (parts.length % 2 !== 0) {
		throw new Error("git diff --raw returned an incomplete entry");
	}
	return parts.flatMap((header, index) => {
		if (index % 2 !== 0) {
			return [];
		}
		const path = parts[index + 1] ?? "";
		const match = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([ADM])$/.exec(header);
		if (!match || path.length === 0) {
			throw new Error(`Unsupported git diff entry: ${header} ${path}`);
		}
		const status = match[3];
		if (status !== "A" && status !== "D" && status !== "M") {
			throw new Error(`Unsupported git diff status: ${status}`);
		}
		return [
			{
				newMode: match[2] ?? "",
				oldMode: match[1] ?? "",
				path,
				status,
			},
		];
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseUpdateScripts(
	value: unknown,
): ReadonlyMap<string, UpdateScript | null> {
	if (!isRecord(value)) {
		throw new Error("update script evaluation must be an object");
	}
	const scripts = new Map<string, UpdateScript | null>();
	for (const [name, entry] of Object.entries(value)) {
		if (entry === null) {
			scripts.set(name, null);
			continue;
		}
		if (!isRecord(entry)) {
			throw new Error(`update script for ${name} is invalid`);
		}
		if (typeof entry.error === "string") {
			scripts.set(name, {
				argv: [],
				attrPath: name,
				error: entry.error,
				name,
				oldVersion: "unknown",
				pname: name,
				sourceRoot: "",
				supportedFeatures: [],
			});
			continue;
		}
		if (!Array.isArray(entry.argv) || entry.argv.length === 0) {
			throw new Error(`update script for ${name} has no command`);
		}
		const argv = entry.argv.map((argument, index) => {
			if (!isRecord(argument) || typeof argument.path !== "string") {
				throw new Error(
					`update script for ${name} argument ${index} is invalid`,
				);
			}
			const drvPaths = Array.isArray(argument.drvPaths)
				? argument.drvPaths.filter((item) => typeof item === "string")
				: typeof argument.drvPath === "string"
					? [argument.drvPath]
					: [];
			return { drvPaths, path: argument.path };
		});
		const features = entry.supportedFeatures;
		scripts.set(name, {
			argv,
			attrPath: String(entry.attrPath ?? name),
			name: String(entry.name ?? name),
			oldVersion: String(entry.oldVersion ?? "unknown"),
			pname: String(entry.pname ?? name),
			sourceRoot: String(entry.sourceRoot ?? ""),
			supportedFeatures: Array.isArray(features)
				? features.filter((feature) => typeof feature === "string")
				: [],
		});
	}
	return scripts;
}

function commitChanges(
	stdout: string,
	features: readonly string[],
): readonly CommitChange[] {
	if (!features.includes("commit")) {
		return [];
	}
	const value = JSON.parse(stdout) as unknown;
	if (!Array.isArray(value)) {
		throw new Error("commit update script must print a JSON array");
	}
	return value.map((item, index) => {
		if (!isRecord(item)) {
			throw new Error(`commit update ${index} must be an object`);
		}
		const commitMessage = item.commitMessage;
		const commitBody = item.commitBody;
		if (commitMessage !== undefined && typeof commitMessage !== "string") {
			throw new Error(`commit update ${index} message must be a string`);
		}
		if (commitBody !== undefined && typeof commitBody !== "string") {
			throw new Error(`commit update ${index} body must be a string`);
		}
		return {
			commitBody: typeof commitBody === "string" ? commitBody : null,
			commitMessage: typeof commitMessage === "string" ? commitMessage : null,
		};
	});
}

// nix-update 1.16 only enables flakes with --flake. UPDATE_NIX_FLAKE=1 is kept
// for newer releases, which also read that variable.
export function commandForUpdate(argv: readonly string[]): readonly string[] {
	const executable = argv[0]?.split("/").at(-1);
	if (executable !== "nix-update" || argv.includes("--flake")) {
		return argv;
	}
	return [...argv, "--flake"];
}

function discover(
	system: string,
	packages: readonly string[],
): ReadonlyMap<string, UpdateScript | null> {
	const result = runChecked(
		["nix", "eval", "--json", "--impure", "--expr", UPDATE_EXPRESSION],
		{
			env: {
				...process.env,
				UPDATE_CONFIG: JSON.stringify({ packages, system }),
			},
		},
	);
	return parseUpdateScripts(JSON.parse(result.stdout) as unknown);
}

function realise(script: UpdateScript): readonly string[] {
	const derivations = [
		...new Set(script.argv.flatMap(({ drvPaths }) => drvPaths)),
	];
	if (derivations.length > 0) {
		runChecked(["nix-store", "--realise", ...derivations]);
	}
	return script.argv.map(({ path }) => path);
}

function remoteHead(branch: string): string | null {
	const result = run([
		"git",
		"fetch",
		"--quiet",
		"origin",
		`refs/heads/${branch}`,
	]);
	if (result.exitCode !== 0) {
		return null;
	}
	return runChecked(["git", "rev-parse", "FETCH_HEAD"]).stdout.trim();
}

function foreignAuthors(
	remote: string,
	baseSha: string,
	botName: string,
): boolean {
	const names = runChecked([
		"git",
		"log",
		"--format=%an",
		remote,
		`^${baseSha}`,
	])
		.stdout.split("\n")
		.map((name) => name.trim())
		.filter((name) => name !== "");
	const allowed = new Set([botName, "mergify[bot]"]);
	return names.some((name) => !allowed.has(name));
}

function publish(
	repository: string,
	name: string,
	title: string,
	body: string,
	baseBranch: string,
	baseSha: string,
	botName: string,
): boolean {
	const branch = `update/${name}`;
	const remote = remoteHead(branch);
	if (remote !== null && foreignAuthors(remote, baseSha, botName)) {
		console.warn(`Skipping ${branch} because it contains manual changes`);
		return false;
	}
	if (remote === null) {
		runChecked([
			"git",
			"-C",
			repository,
			"push",
			"origin",
			`HEAD:refs/heads/${branch}`,
		]);
	} else {
		runChecked([
			"git",
			"-C",
			repository,
			"push",
			`--force-with-lease=refs/heads/${branch}:${remote}`,
			"origin",
			`HEAD:refs/heads/${branch}`,
		]);
	}
	const existing = runChecked([
		"gh",
		"pr",
		"list",
		"--head",
		branch,
		"--json",
		"number",
		"--jq",
		".[0].number // empty",
	]).stdout.trim();
	if (existing === "") {
		runChecked([
			"gh",
			"pr",
			"create",
			"--base",
			baseBranch,
			"--head",
			branch,
			"--title",
			title,
			"--body",
			body,
			"--label",
			"dependencies",
			"--label",
			"automated",
		]);
	}
	return true;
}

function updateOne(
	repository: string,
	packageName: string,
	script: UpdateScript,
	system: string,
	baseSha: string,
	baseBranch: string,
	botName: string,
): void {
	const directory = mkdtempSync(join(tmpdir(), `update-${packageName}-`));
	try {
		runChecked([
			"git",
			"-C",
			repository,
			"worktree",
			"add",
			"--detach",
			directory,
			baseSha,
		]);
		const argv = commandForUpdate(
			realise(script).map((path) =>
				rewritePath(script.sourceRoot, directory, path),
			),
		);
		const result = run(argv, {
			cwd: directory,
			env: {
				...process.env,
				UPDATE_NIX_ATTR_PATH: script.attrPath,
				UPDATE_NIX_FLAKE: "1",
				UPDATE_NIX_NAME: script.name,
				UPDATE_NIX_OLD_VERSION: script.oldVersion,
				UPDATE_NIX_PNAME: script.pname,
			},
		});
		process.stderr.write(result.stderr);
		if (result.exitCode !== 0) {
			throw new Error(result.stderr.trim() || `${packageName} update failed`);
		}
		const head = runChecked([
			"git",
			"-C",
			directory,
			"rev-parse",
			"HEAD",
		]).stdout.trim();
		if (head !== baseSha) {
			throw new Error(`${packageName} update script created a commit`);
		}
		runChecked(["git", "-C", directory, "add", "-N", "--", "."]);
		const files = parseRawDiff(
			runChecked([
				"git",
				"-C",
				directory,
				"diff",
				"--raw",
				"-z",
				"--no-renames",
				"HEAD",
			]).stdout,
		);
		if (files.length === 0) {
			console.log(`${packageName} is already up to date`);
			return;
		}
		const violation = filesAllowed(packageName, files);
		if (violation !== null) {
			throw new Error(violation);
		}
		const changes = commitChanges(result.stdout, script.supportedFeatures);
		if (script.supportedFeatures.includes("commit") && changes.length === 0) {
			throw new Error(
				`${packageName} reported no changes but modified the worktree`,
			);
		}
		const messages = changes.map(({ commitMessage }) => commitMessage);
		const version = run(
			["nix", "eval", "--raw", `.#packages.${system}.${packageName}.version`],
			{ cwd: directory },
		);
		const newVersion =
			version.exitCode === 0 ? version.stdout.trim() || "unknown" : "unknown";
		if (
			!versionAccepted(
				script.oldVersion,
				newVersion,
				script.supportedFeatures,
				messages,
			)
		) {
			throw new Error(`${packageName} did not change its version`);
		}
		const title = (
			updateTitle(packageName, script.oldVersion, newVersion, messages).split(
				"\n",
			)[0] ?? packageName
		).trim();
		const body =
			changes
				.find(({ commitBody }) => commitBody?.trim())
				?.commitBody?.trim() ??
			(script.oldVersion === newVersion
				? `Automated refresh of \`${packageName}\` at version \`${newVersion}\`.`
				: `Automated update of \`${packageName}\` from \`${script.oldVersion}\` to \`${newVersion}\`.`);
		runChecked(["git", "-C", directory, "add", "--", "."]);
		runChecked(["git", "-C", directory, "commit", "-m", title]);
		const published = publish(
			directory,
			packageName,
			title,
			body,
			baseBranch,
			baseSha,
			botName,
		);
		console.log(
			`${published ? "Updated" : "Skipped"} ${packageName}: ${title}`,
		);
	} finally {
		run(["git", "-C", repository, "worktree", "remove", "--force", directory]);
		rmSync(directory, { force: true, recursive: true });
	}
}

async function main(): Promise<void> {
	const system = required("SYSTEM");
	const repository = process.cwd();
	const baseBranch = process.env.BASE_BRANCH ?? "main";
	const botName = required("BOT_NAME");
	required("GH_TOKEN");
	const packages = (process.env.PACKAGES ?? "")
		.split(/\s+/)
		.map((name) => name.trim())
		.filter((name) => name !== "");
	runChecked(["git", "fetch", "origin", baseBranch]);
	const baseSha = runChecked([
		"git",
		"rev-parse",
		`origin/${baseBranch}`,
	]).stdout.trim();
	const scripts = discover(system, packages);
	const failures: string[] = [];
	let considered = 0;
	for (const [name, script] of scripts) {
		if (script === null) {
			if (packages.includes(name)) {
				failures.push(`${name}: no updateScript`);
			}
			continue;
		}
		if (script.error !== undefined) {
			failures.push(`${name}: ${script.error}`);
			continue;
		}
		considered += 1;
		try {
			updateOne(repository, name, script, system, baseSha, baseBranch, botName);
		} catch (error) {
			const message = `${name}: ${error instanceof Error ? error.message : String(error)}`;
			failures.push(message);
			console.error(`::error::${message}`);
		}
	}
	const summary = [
		`## Package Update ${system}`,
		"",
		`- Scripts: ${considered}`,
		`- Failures: ${failures.length}`,
		...(failures.length === 0 ? [] : ["", "```", ...failures, "```"]),
		"",
	].join("\n");
	console.log(summary);
	if (process.env.GITHUB_STEP_SUMMARY !== undefined) {
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
	}
	if (failures.length > 0) {
		throw new Error(`${failures.length} package updates failed`);
	}
}

if (import.meta.main) {
	await main();
}
