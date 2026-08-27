import { existsSync, readFileSync, realpathSync } from "node:fs";
import process from "node:process";
import {
	isRecord,
	parseJson,
	readJsonFile,
	requiredEnvironment,
	requireRecord,
	requireString,
	run,
} from "./lib.ts";

const UPDATE_SCRIPT_EXPRESSION = `
let
  config = builtins.fromJSON (builtins.getEnv "UPDATE_SCRIPT_CONFIG");
  flake = builtins.getFlake (toString ./.);
  package = flake.packages.\${config.system}.\${config.name};
  lib = flake.inputs.nixpkgs.lib;
  updateScript = package.updateScript or null;
  command = if updateScript == null then null else updateScript.command or updateScript;
in
  if updateScript == null then null else {
    argv = map (value: {
      path = toString value;
      drvPath = if lib.isDerivation value then value.drvPath else null;
    }) (lib.toList command);
    attrPath = updateScript.attrPath or config.name;
    name = package.name;
    pname = lib.getName package;
    oldVersion = lib.getVersion package;
    sourceRoot = toString flake.outPath;
    supportedFeatures = updateScript.supportedFeatures or [ ];
  }
`;

type UpdateType = "flake-input" | "package";

type Target = Readonly<{
	currentVersion: string;
	name: string;
}>;

export type UpdateArgument = Readonly<{
	drvPath: string | null;
	path: string;
}>;

export type UpdateScript = Readonly<{
	argv: readonly UpdateArgument[];
	attrPath: string;
	name: string;
	oldVersion: string;
	pname: string;
	sourceRoot: string;
	supportedFeatures: readonly string[];
}>;

type CommitChange = Readonly<{
	commitBody: string | null;
	commitMessage: string | null;
}>;

type ScriptResult =
	| Readonly<{ kind: "plain" }>
	| Readonly<{ changes: readonly CommitChange[]; kind: "commit" }>;

type PullRequest = Readonly<{
	body: string;
	branch: string;
	commitMessage: string;
	title: string;
}>;

export function parseTargets(value: unknown): readonly Target[] {
	if (!Array.isArray(value)) {
		throw new Error("UPDATE_TARGETS must be a JSON array");
	}
	return value.map((item, index) => {
		const target = requireRecord(item, `UPDATE_TARGETS item ${index}`);
		return {
			currentVersion: requireString(
				target.current_version,
				`UPDATE_TARGETS item ${index}.current_version`,
			),
			name: requireString(target.name, `UPDATE_TARGETS item ${index}.name`),
		};
	});
}

export function parseUpdateScript(value: unknown): UpdateScript | null {
	if (value === null) {
		return null;
	}
	const script = requireRecord(value, "updateScript");
	if (!Array.isArray(script.argv) || script.argv.length === 0) {
		throw new Error("updateScript.argv must be a non-empty array");
	}
	const argv = script.argv.map((argument, index) => {
		const entry = requireRecord(argument, `updateScript.argv[${index}]`);
		const drvPath = entry.drvPath;
		if (drvPath !== null && typeof drvPath !== "string") {
			throw new Error(
				`updateScript.argv[${index}].drvPath must be a string or null`,
			);
		}
		return {
			drvPath,
			path: requireString(entry.path, `updateScript.argv[${index}].path`),
		};
	});
	if (!Array.isArray(script.supportedFeatures)) {
		throw new Error("updateScript.supportedFeatures must be an array");
	}
	const supportedFeatures = script.supportedFeatures.map((feature, index) =>
		requireString(feature, `updateScript.supportedFeatures[${index}]`),
	);
	return {
		argv,
		attrPath: requireString(script.attrPath, "updateScript.attrPath"),
		name: requireString(script.name, "updateScript.name"),
		oldVersion: requireString(script.oldVersion, "updateScript.oldVersion"),
		pname: requireString(script.pname, "updateScript.pname"),
		sourceRoot: requireString(script.sourceRoot, "updateScript.sourceRoot"),
		supportedFeatures,
	};
}

export function parseCommitChanges(value: unknown): readonly CommitChange[] {
	if (!Array.isArray(value)) {
		throw new Error(
			"An update script with the commit feature must print a JSON array",
		);
	}
	return value.map((item, index) => {
		const change = requireRecord(item, `update script change ${index}`);
		const commitMessage = change.commitMessage;
		const commitBody = change.commitBody;
		if (commitMessage !== undefined && typeof commitMessage !== "string") {
			throw new Error(
				`update script change ${index}.commitMessage must be a string`,
			);
		}
		if (commitBody !== undefined && typeof commitBody !== "string") {
			throw new Error(
				`update script change ${index}.commitBody must be a string`,
			);
		}
		return {
			commitBody: commitBody ?? null,
			commitMessage: commitMessage ?? null,
		};
	});
}

function branchName(updateType: UpdateType, name: string): string {
	return `automation/update-${updateType}-${name}`;
}

async function remoteBranchExists(branch: string): Promise<boolean> {
	return (
		await run(
			["git", "ls-remote", "--exit-code", "--heads", "origin", branch],
			{
				check: false,
			},
		)
	).success;
}

async function prepareUpdateBranch(
	updateType: UpdateType,
	name: string,
): Promise<void> {
	const baseBranch = process.env.BASE_BRANCH ?? "main";
	const branch = branchName(updateType, name);
	await run(["git", "fetch", "origin", baseBranch]);

	if (!(await remoteBranchExists(branch))) {
		await run(["git", "checkout", "-B", branch, `origin/${baseBranch}`]);
		return;
	}

	console.log(`Reusing update branch ${branch}`);
	await run(["git", "fetch", "origin", branch]);
	await run(["git", "checkout", "-B", branch, `origin/${branch}`]);
	const rebase = await run(["git", "rebase", `origin/${baseBranch}`], {
		check: false,
	});
	if (rebase.success) {
		return;
	}

	console.log(
		`::warning::Cannot rebase ${branch}; rebuilding it from ${baseBranch}`,
	);
	await run(["git", "rebase", "--abort"], { check: false });
	await run(["git", "reset", "--hard", `origin/${baseBranch}`]);
}

async function pullRequestNumber(branch: string): Promise<string | null> {
	const result = await run(
		[
			"gh",
			"pr",
			"list",
			"--head",
			branch,
			"--json",
			"number",
			"--jq",
			".[0].number // empty",
		],
		{ capture: true },
	);
	return result.stdout.trim() || null;
}

function labelArguments(labels: string): readonly string[] {
	return labels
		.split(",")
		.map((label) => label.trim())
		.filter(Boolean)
		.flatMap((label) => ["--label", label]);
}

export function buildPullRequest(
	updateType: UpdateType,
	name: string,
	currentVersion: string,
	newVersion: string,
	changes: readonly CommitChange[] = [],
): PullRequest {
	const defaultTitle =
		updateType === "package"
			? `${name}: ${currentVersion} -> ${newVersion}`
			: `flake.lock: update ${name}`;
	const defaultBody =
		updateType === "package"
			? `Automated update of \`${name}\` from \`${currentVersion}\` to \`${newVersion}\`.`
			: `Automated update of flake input \`${name}\` from \`${currentVersion}\` to \`${newVersion}\`.`;
	const title =
		changes.find(({ commitMessage }) => commitMessage)?.commitMessage ??
		defaultTitle;
	const bodies = changes.flatMap(({ commitBody }) =>
		commitBody ? [commitBody] : [],
	);
	return {
		body: bodies.length > 0 ? bodies.join("\n\n") : defaultBody,
		branch: branchName(updateType, name),
		commitMessage: title,
		title,
	};
}

async function createOrUpdatePullRequest(
	pullRequest: PullRequest,
): Promise<void> {
	const baseBranch = process.env.BASE_BRANCH ?? "main";
	const labels = process.env.PR_LABELS ?? "dependencies,automated";
	await run(["git", "add", "-A"]);
	await run(["git", "commit", "-m", pullRequest.commitMessage]);
	await run([
		"git",
		"push",
		"--force-with-lease",
		"origin",
		`HEAD:${pullRequest.branch}`,
	]);

	const number = await pullRequestNumber(pullRequest.branch);
	if (number) {
		await run([
			"gh",
			"pr",
			"edit",
			number,
			"--title",
			pullRequest.title,
			"--body",
			pullRequest.body,
		]);
		return;
	}

	await run([
		"gh",
		"pr",
		"create",
		"--base",
		baseBranch,
		"--head",
		pullRequest.branch,
		"--title",
		pullRequest.title,
		"--body",
		pullRequest.body,
		...labelArguments(labels),
	]);
	if (!(await pullRequestNumber(pullRequest.branch))) {
		throw new Error("GitHub did not return the created pull request");
	}
}

async function resetWorktree(): Promise<void> {
	await run(["git", "reset", "--hard", "HEAD"], { check: false });
	await run(["git", "clean", "-fd"], { check: false });
}

async function hasChanges(): Promise<boolean> {
	const status = await run(["git", "status", "--porcelain"], { capture: true });
	return status.stdout.trim().length > 0;
}

function nixUpdateArguments(name: string): readonly string[] {
	const path = `packages/${name}/nix-update-args`;
	if (!existsSync(path)) {
		return [];
	}
	return readFileSync(path, "utf8")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"));
}

export async function evaluateUpdateScript(
	name: string,
	system: string,
): Promise<UpdateScript | null> {
	const result = await run(
		["nix", "eval", "--json", "--impure", "--expr", UPDATE_SCRIPT_EXPRESSION],
		{
			capture: true,
			env: { UPDATE_SCRIPT_CONFIG: JSON.stringify({ name, system }) },
		},
	);
	return parseUpdateScript(
		parseJson(result.stdout, `update script for ${name}`),
	);
}

export function worktreeCommand(
	argv: readonly string[],
	sourceRoot: string,
	repositoryRoot: string,
): readonly string[] {
	const normalizedSourceRoot = sourceRoot.replace(/\/$/, "");
	const sourcePrefix = `${normalizedSourceRoot}/`;
	return argv.map((argument) => {
		if (argument === normalizedSourceRoot) {
			return repositoryRoot;
		}
		return argument.startsWith(sourcePrefix)
			? `${repositoryRoot}/${argument.slice(sourcePrefix.length)}`
			: argument;
	});
}

export async function realizeUpdateArguments(
	argv: readonly UpdateArgument[],
): Promise<readonly string[]> {
	const derivations = [
		...new Set(
			argv.flatMap(({ drvPath }) => (drvPath === null ? [] : [drvPath])),
		),
	];
	if (derivations.length > 0) {
		await run(["nix-store", "--realise", ...derivations]);
	}
	return argv.map(({ path }) => path);
}

async function runUpdateScript(script: UpdateScript): Promise<ScriptResult> {
	const repositoryRoot = realpathSync(".");
	const supportsCommit = script.supportedFeatures.includes("commit");
	const argv = await realizeUpdateArguments(script.argv);
	const result = await run(
		worktreeCommand(argv, script.sourceRoot, repositoryRoot),
		{
			capture: supportsCommit,
			cwd: repositoryRoot,
			env: {
				UPDATE_NIX_ATTR_PATH: script.attrPath,
				UPDATE_NIX_NAME: script.name,
				UPDATE_NIX_OLD_VERSION: script.oldVersion,
				UPDATE_NIX_PNAME: script.pname,
			},
		},
	);
	if (!supportsCommit) {
		return { kind: "plain" };
	}
	return {
		changes: parseCommitChanges(
			parseJson(result.stdout, "update script commit output"),
		),
		kind: "commit",
	};
}

async function updatePackage(
	name: string,
	system: string,
): Promise<ScriptResult> {
	const script = await evaluateUpdateScript(name, system);
	if (script) {
		return await runUpdateScript(script);
	}
	await run([
		"nix",
		"run",
		"nixpkgs#nix-update",
		"--",
		"--flake",
		"--system",
		system,
		name,
		...nixUpdateArguments(name),
	]);
	return { kind: "plain" };
}

async function updateFlakeInput(name: string): Promise<ScriptResult> {
	await run(["nix", "flake", "update", name]);
	return { kind: "plain" };
}

async function flakeInputRevision(name: string): Promise<string> {
	const lock = readJsonFile("flake.lock");
	if (!isRecord(lock) || !isRecord(lock.nodes)) {
		return "unknown";
	}
	const root = lock.nodes.root;
	const reference =
		isRecord(root) && isRecord(root.inputs) ? root.inputs[name] : name;
	const nodeName = typeof reference === "string" ? reference : name;
	const node = lock.nodes[nodeName];
	if (!isRecord(node) || !isRecord(node.locked)) {
		return "unknown";
	}
	const revision = node.locked.rev ?? node.locked.lastModified;
	return revision === undefined ? "unknown" : String(revision).slice(0, 8);
}

async function packageVersion(name: string, system: string): Promise<string> {
	const result = await run(
		["nix", "eval", "--raw", `.#packages.${system}.${name}.version`],
		{
			capture: true,
			check: false,
		},
	);
	return result.success ? result.stdout.trim() || "unknown" : "unknown";
}

async function processTarget(
	updateType: UpdateType,
	target: Target,
	system: string,
): Promise<void> {
	await resetWorktree();
	await prepareUpdateBranch(updateType, target.name);
	const scriptResult =
		updateType === "package"
			? await updatePackage(target.name, system)
			: await updateFlakeInput(target.name);
	const changed = await hasChanges();
	if (scriptResult.kind === "commit" && scriptResult.changes.length === 0) {
		if (changed) {
			throw new Error(
				`${target.name} reported no changes but modified the worktree`,
			);
		}
		console.log(`${target.name} is already up to date`);
		return;
	}
	if (!changed) {
		console.log(`${target.name} is already up to date`);
		return;
	}

	const newVersion =
		updateType === "package"
			? await packageVersion(target.name, system)
			: await flakeInputRevision(target.name);
	const changes = scriptResult.kind === "commit" ? scriptResult.changes : [];
	await createOrUpdatePullRequest(
		buildPullRequest(
			updateType,
			target.name,
			target.currentVersion,
			newVersion,
			changes,
		),
	);
}

export async function updateTargets(): Promise<void> {
	requiredEnvironment("GH_TOKEN");
	const updateType = process.env.UPDATE_TYPE;
	if (updateType !== "package" && updateType !== "flake-input") {
		throw new Error("UPDATE_TYPE must be package or flake-input");
	}
	const system = process.env.NIX_UPDATE_SYSTEM ?? "x86_64-linux";
	const targets = parseTargets(
		parseJson(requiredEnvironment("UPDATE_TARGETS"), "UPDATE_TARGETS"),
	);
	const failed: string[] = [];

	for (const target of targets) {
		try {
			await processTarget(updateType, target, system);
		} catch (error) {
			failed.push(target.name);
			console.log(`::error::${target.name} update failed: ${String(error)}`);
			await resetWorktree();
		}
	}
	if (failed.length > 0) {
		throw new Error(`Failed to update: ${failed.join(", ")}`);
	}
}
