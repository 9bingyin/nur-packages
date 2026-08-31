import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import process from "node:process";
import {
	githubRepository,
	githubRequest,
	githubRequestPages,
} from "./github.ts";
import {
	isRecord,
	parseJson,
	prettyJson,
	readJsonFile,
	requiredEnvironment,
	requireRecord,
	requireString,
	run,
	writeOutput,
} from "./lib.ts";
import {
	formatUpdateProvenance,
	parseUpdateProvenance,
} from "./update-provenance.ts";

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
	| Readonly<{
			allowSameVersion: boolean;
			changes: readonly CommitChange[];
			kind: "commit";
	  }>;

type PullRequest = Readonly<{
	body: string;
	branch: string;
	commitMessage: string;
	title: string;
}>;

type ChangedFile = Readonly<{
	newMode: string;
	oldMode: string;
	path: string;
	status: "A" | "D" | "M";
}>;

export type UpdateManifest = Readonly<{
	baseSha: string;
	changedFiles: readonly ChangedFile[];
	currentVersion: string;
	name: string;
	newVersion: string;
	noChanges: boolean;
	patchSha256: string;
	pullRequest: PullRequest;
	runAttempt: number;
	runId: number;
	schemaVersion: 1;
	system: string;
	type: UpdateType;
}>;

const UPDATE_MANIFEST = "manifest.json";
const UPDATE_PATCH = "changes.patch";
const MAX_CHANGED_FILES = 50;
const MAX_PATCH_BYTES = 5 * 1024 * 1024;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const TARGET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9+._-]*$/;

export function parseTarget(value: unknown): Target {
	const target = requireRecord(value, "UPDATE_TARGET");
	const name = requireString(target.name, "UPDATE_TARGET.name");
	if (!TARGET_NAME_PATTERN.test(name)) {
		throw new Error(`Unsupported update target name: ${name}`);
	}
	return {
		currentVersion: requireString(
			target.current_version,
			"UPDATE_TARGET.current_version",
		),
		name,
	};
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

export function updateVersionIsValid(
	currentVersion: string,
	newVersion: string,
	allowSameVersion: boolean,
	changes: readonly CommitChange[],
): boolean {
	return (
		newVersion !== "unknown" &&
		(newVersion !== currentVersion ||
			(allowSameVersion &&
				changes.some(({ commitMessage }) => Boolean(commitMessage?.trim()))))
	);
}

function branchName(_updateType: UpdateType, name: string): string {
	return `update/${name}`;
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

function labelArguments(labels: string, flag = "--label"): readonly string[] {
	return labels
		.split(",")
		.map((label) => label.trim())
		.filter(Boolean)
		.flatMap((label) => [flag, label]);
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
): Promise<string> {
	const baseBranch = process.env.BASE_BRANCH ?? "main";
	const labels = process.env.PR_LABELS ?? "dependencies,automated";
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
			...labelArguments(labels, "--add-label"),
		]);
		return number;
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
	const createdNumber = await pullRequestNumber(pullRequest.branch);
	if (!createdNumber) {
		throw new Error("GitHub did not return the created pull request");
	}
	return createdNumber;
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
		allowSameVersion: script.supportedFeatures.includes("same-version"),
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

function updateTypeFromEnvironment(): UpdateType {
	const updateType = process.env.UPDATE_TYPE;
	if (updateType !== "package" && updateType !== "flake-input") {
		throw new Error("UPDATE_TYPE must be package or flake-input");
	}
	return updateType;
}

function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function positiveEnvironmentInteger(name: string): number {
	const value = Number(requiredEnvironment(name));
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
	return value;
}

export function parseRawDiff(value: string): readonly ChangedFile[] {
	const parts = value.split("\0");
	if (parts.at(-1) === "") {
		parts.pop();
	}
	if (parts.length % 2 !== 0) {
		throw new Error("git diff --raw returned an incomplete entry");
	}
	const files: ChangedFile[] = [];
	for (let index = 0; index < parts.length; index += 2) {
		const header = parts[index] ?? "";
		const path = parts[index + 1] ?? "";
		const match = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([ADM])$/.exec(header);
		if (!match || path.length === 0) {
			throw new Error(`Unsupported git diff entry: ${header} ${path}`);
		}
		const status = match[3];
		if (status !== "A" && status !== "D" && status !== "M") {
			throw new Error(`Unsupported git diff status: ${status}`);
		}
		files.push({
			newMode: match[2] ?? "",
			oldMode: match[1] ?? "",
			path,
			status,
		});
	}
	return files;
}

function pathAllowed(
	updateType: UpdateType,
	name: string,
	path: string,
): boolean {
	return updateType === "package"
		? path.startsWith(`packages/${name}/`)
		: path === "flake.lock";
}

export function validateChangedFiles(
	updateType: UpdateType,
	name: string,
	files: readonly ChangedFile[],
): void {
	if (files.length === 0) {
		throw new Error("The update patch has no changed files");
	}
	if (files.length > MAX_CHANGED_FILES) {
		throw new Error(`The update changes too many files: ${files.length}`);
	}
	for (const file of files) {
		if (!pathAllowed(updateType, name, file.path)) {
			throw new Error(`Update target ${name} cannot modify ${file.path}`);
		}
		const modes = [file.oldMode, file.newMode].filter(
			(mode) => mode !== "000000",
		);
		if (modes.some((mode) => mode !== "100644")) {
			throw new Error(
				`Update target ${name} changed an unsafe file mode: ${file.path}`,
			);
		}
	}
}

async function diffFiles(staged: boolean): Promise<readonly ChangedFile[]> {
	const result = await run(
		[
			"git",
			"diff",
			...(staged ? ["--cached"] : []),
			"--raw",
			"-z",
			"--no-renames",
			"HEAD",
		],
		{ capture: true },
	);
	return parseRawDiff(result.stdout);
}

function writeUpdateArtifact(
	directory: string,
	manifest: UpdateManifest,
	patch: string,
): void {
	mkdirSync(directory, { recursive: true });
	writeFileSync(`${directory}/${UPDATE_PATCH}`, patch);
	writeFileSync(`${directory}/${UPDATE_MANIFEST}`, prettyJson(manifest));
}

function parseChangedFiles(value: unknown): readonly ChangedFile[] {
	if (!Array.isArray(value)) {
		throw new Error("update manifest.changedFiles must be an array");
	}
	return value.map((item, index) => {
		const file = requireRecord(item, `update manifest.changedFiles[${index}]`);
		const status = requireString(
			file.status,
			`update manifest.changedFiles[${index}].status`,
		);
		if (status !== "A" && status !== "D" && status !== "M") {
			throw new Error(`Unsupported update manifest status: ${status}`);
		}
		return {
			newMode: requireString(
				file.newMode,
				`update manifest.changedFiles[${index}].newMode`,
			),
			oldMode: requireString(
				file.oldMode,
				`update manifest.changedFiles[${index}].oldMode`,
			),
			path: requireString(
				file.path,
				`update manifest.changedFiles[${index}].path`,
			),
			status,
		};
	});
}

function parseManifestPullRequest(value: unknown): PullRequest {
	const pullRequest = requireRecord(value, "update manifest.pullRequest");
	return {
		body: requireString(pullRequest.body, "update manifest.pullRequest.body"),
		branch: requireString(
			pullRequest.branch,
			"update manifest.pullRequest.branch",
		),
		commitMessage: requireString(
			pullRequest.commitMessage,
			"update manifest.pullRequest.commitMessage",
		),
		title: requireString(
			pullRequest.title,
			"update manifest.pullRequest.title",
		),
	};
}

export function parseUpdateManifest(value: unknown): UpdateManifest {
	const manifest = requireRecord(value, "update manifest");
	const updateType = manifest.type;
	if (updateType !== "package" && updateType !== "flake-input") {
		throw new Error("update manifest.type is invalid");
	}
	if (manifest.schemaVersion !== 1 || typeof manifest.noChanges !== "boolean") {
		throw new Error("update manifest schema is invalid");
	}
	const baseSha = requireString(manifest.baseSha, "update manifest.baseSha");
	const patchSha256 = requireString(
		manifest.patchSha256,
		"update manifest.patchSha256",
	);
	if (!SHA_PATTERN.test(baseSha) || !/^[0-9a-f]{64}$/.test(patchSha256)) {
		throw new Error("update manifest contains an invalid digest");
	}
	const name = requireString(manifest.name, "update manifest.name");
	if (!TARGET_NAME_PATTERN.test(name)) {
		throw new Error(`Unsupported update target name: ${name}`);
	}
	const changedFiles = parseChangedFiles(manifest.changedFiles);
	const pullRequest = parseManifestPullRequest(manifest.pullRequest);
	if (
		(manifest.noChanges &&
			(changedFiles.length !== 0 || patchSha256 !== sha256(""))) ||
		(!manifest.noChanges && changedFiles.length === 0)
	) {
		throw new Error("update manifest change metadata is inconsistent");
	}
	const runAttempt = Number(manifest.runAttempt);
	const runId = Number(manifest.runId);
	if (
		!Number.isInteger(runAttempt) ||
		runAttempt <= 0 ||
		!Number.isInteger(runId) ||
		runId <= 0
	) {
		throw new Error("update manifest run metadata is invalid");
	}
	return {
		baseSha,
		changedFiles,
		currentVersion: requireString(
			manifest.currentVersion,
			"update manifest.currentVersion",
		),
		name,
		newVersion: requireString(
			manifest.newVersion,
			"update manifest.newVersion",
		),
		noChanges: manifest.noChanges,
		patchSha256,
		pullRequest,
		runAttempt,
		runId,
		schemaVersion: 1,
		system: requireString(manifest.system, "update manifest.system"),
		type: updateType,
	};
}

export async function prepareUpdate(): Promise<void> {
	const updateType = updateTypeFromEnvironment();
	const system = process.env.NIX_UPDATE_SYSTEM ?? "x86_64-linux";
	const target = parseTarget(
		parseJson(requiredEnvironment("UPDATE_TARGET"), "UPDATE_TARGET"),
	);
	const directory = requiredEnvironment("UPDATE_ARTIFACT_DIR");
	await resetWorktree();
	const baseSha = (
		await run(["git", "rev-parse", "HEAD"], { capture: true })
	).stdout.trim();
	const scriptResult =
		updateType === "package"
			? await updatePackage(target.name, system)
			: await updateFlakeInput(target.name);
	const currentHead = (
		await run(["git", "rev-parse", "HEAD"], { capture: true })
	).stdout.trim();
	if (currentHead !== baseSha) {
		throw new Error("Update scripts must not create commits");
	}
	const changed = await hasChanges();
	if (
		scriptResult.kind === "commit" &&
		scriptResult.changes.length === 0 &&
		changed
	) {
		throw new Error(
			`${target.name} reported no changes but modified the worktree`,
		);
	}
	const newVersion = changed
		? updateType === "package"
			? await packageVersion(target.name, system)
			: await flakeInputRevision(target.name)
		: target.currentVersion;
	const changes = scriptResult.kind === "commit" ? scriptResult.changes : [];
	const allowSameVersion =
		scriptResult.kind === "commit" && scriptResult.allowSameVersion;
	if (
		changed &&
		!updateVersionIsValid(
			target.currentVersion,
			newVersion,
			allowSameVersion,
			changes,
		)
	) {
		throw new Error(`${target.name} did not change its version`);
	}
	const pullRequest = buildPullRequest(
		updateType,
		target.name,
		target.currentVersion,
		newVersion,
		changes,
	);
	if (!changed) {
		const patch = "";
		writeUpdateArtifact(
			directory,
			{
				baseSha,
				changedFiles: [],
				currentVersion: target.currentVersion,
				name: target.name,
				newVersion,
				noChanges: true,
				patchSha256: sha256(patch),
				pullRequest,
				runAttempt: positiveEnvironmentInteger("GITHUB_RUN_ATTEMPT"),
				runId: positiveEnvironmentInteger("GITHUB_RUN_ID"),
				schemaVersion: 1,
				system,
				type: updateType,
			},
			patch,
		);
		console.log(`${target.name} is already up to date`);
		return;
	}

	await run(["git", "add", "-N", "--", "."]);
	const changedFiles = await diffFiles(false);
	validateChangedFiles(updateType, target.name, changedFiles);
	const patch = (
		await run(
			["git", "diff", "--binary", "--full-index", "--no-renames", "HEAD"],
			{ capture: true },
		)
	).stdout;
	if (Buffer.byteLength(patch) > MAX_PATCH_BYTES) {
		throw new Error(`Update patch exceeds ${MAX_PATCH_BYTES} bytes`);
	}
	writeUpdateArtifact(
		directory,
		{
			baseSha,
			changedFiles,
			currentVersion: target.currentVersion,
			name: target.name,
			newVersion,
			noChanges: false,
			patchSha256: sha256(patch),
			pullRequest,
			runAttempt: positiveEnvironmentInteger("GITHUB_RUN_ATTEMPT"),
			runId: positiveEnvironmentInteger("GITHUB_RUN_ID"),
			schemaVersion: 1,
			system,
			type: updateType,
		},
		patch,
	);
}

async function remoteBranchHead(branch: string): Promise<string | null> {
	const result = await run(
		["git", "ls-remote", "--heads", "origin", `refs/heads/${branch}`],
		{ capture: true },
	);
	return result.stdout.trim().split(/\s+/)[0] || null;
}

async function pullRequestComments(
	pullRequest: string,
): Promise<readonly Record<string, unknown>[]> {
	const response = await githubRequestPages(
		`/repos/${githubRepository()}/issues/${pullRequest}/comments`,
	);
	if (!Array.isArray(response)) {
		throw new Error("GitHub returned invalid pull request comments");
	}
	return response.filter(isRecord);
}

function botProvenance(comment: Record<string, unknown>, botUserId: number) {
	const user = isRecord(comment.user) ? comment.user : {};
	return user.id === botUserId ? parseUpdateProvenance(comment.body) : null;
}

async function hasTrustedProvenance(
	pullRequest: string,
	sha: string,
	botUserId: number,
	manifest: UpdateManifest,
): Promise<boolean> {
	return (await pullRequestComments(pullRequest)).some((comment) => {
		const provenance = botProvenance(comment, botUserId);
		return (
			provenance?.headSha === sha &&
			provenance.targetName === manifest.name &&
			provenance.targetType === manifest.type
		);
	});
}

async function createProvenanceComment(
	pullRequest: string,
	headSha: string,
	botUserId: number,
	manifest: UpdateManifest,
): Promise<void> {
	const body = formatUpdateProvenance({
		baseSha: manifest.baseSha,
		headSha,
		patchSha256: manifest.patchSha256,
		runAttempt: manifest.runAttempt,
		runId: manifest.runId,
		targetName: manifest.name,
		targetType: manifest.type,
	});
	const existing = (await pullRequestComments(pullRequest)).find(
		(comment) => botProvenance(comment, botUserId) !== null,
	);
	const commentId = existing?.id;
	if (typeof commentId === "number" && Number.isInteger(commentId)) {
		await githubRequest(
			`/repos/${githubRepository()}/issues/comments/${commentId}`,
			{ method: "PATCH", body: { body } },
		);
		return;
	}
	await githubRequest(
		`/repos/${githubRepository()}/issues/${pullRequest}/comments`,
		{ method: "POST", body: { body } },
	);
}

export function updateArtifactChanged(directory: string): boolean {
	const manifest = parseUpdateManifest(
		readJsonFile(`${directory}/${UPDATE_MANIFEST}`),
	);
	const patch = readFileSync(`${directory}/${UPDATE_PATCH}`, "utf8");
	if (sha256(patch) !== manifest.patchSha256) {
		throw new Error("Update patch digest does not match its manifest");
	}
	return !manifest.noChanges;
}

export function inspectUpdate(): void {
	writeOutput(
		"changed",
		String(updateArtifactChanged(requiredEnvironment("UPDATE_ARTIFACT_DIR"))),
	);
}

export async function publishUpdate(): Promise<void> {
	requiredEnvironment("GH_TOKEN");
	const directory = requiredEnvironment("UPDATE_ARTIFACT_DIR");
	const manifest = parseUpdateManifest(
		readJsonFile(`${directory}/${UPDATE_MANIFEST}`),
	);
	const patch = readFileSync(`${directory}/${UPDATE_PATCH}`, "utf8");
	if (sha256(patch) !== manifest.patchSha256) {
		throw new Error("Update patch digest does not match its manifest");
	}
	if (manifest.noChanges) {
		console.log(`${manifest.name} is already up to date`);
		return;
	}
	validateChangedFiles(manifest.type, manifest.name, manifest.changedFiles);
	const baseBranch = process.env.BASE_BRANCH ?? "main";
	await run(["git", "fetch", "origin", baseBranch]);
	const currentBase = (
		await run(["git", "rev-parse", `origin/${baseBranch}`], { capture: true })
	).stdout.trim();
	if (currentBase !== manifest.baseSha) {
		throw new Error("The base branch changed after the update was prepared");
	}
	await resetWorktree();
	await run(["git", "checkout", "--detach", manifest.baseSha]);
	await run([
		"git",
		"apply",
		"--index",
		"--binary",
		`${directory}/${UPDATE_PATCH}`,
	]);
	const appliedFiles = await diffFiles(true);
	validateChangedFiles(manifest.type, manifest.name, appliedFiles);
	if (JSON.stringify(appliedFiles) !== JSON.stringify(manifest.changedFiles)) {
		throw new Error("Applied update files do not match the manifest");
	}

	const branch = branchName(manifest.type, manifest.name);
	if (branch !== manifest.pullRequest.branch) {
		throw new Error("Update manifest branch does not match the target");
	}
	const botUserId = positiveEnvironmentInteger("AUTOMATION_BOT_USER_ID");
	const oldHead = await remoteBranchHead(branch);
	const existingPullRequest = await pullRequestNumber(branch);
	if (
		oldHead &&
		(!existingPullRequest ||
			!(await hasTrustedProvenance(
				existingPullRequest,
				oldHead,
				botUserId,
				manifest,
			)))
	) {
		console.log(
			`::warning::Skipping ${branch} because it contains manual changes`,
		);
		return;
	}
	await run(["git", "checkout", "-B", branch]);
	await run(["git", "commit", "-m", manifest.pullRequest.commitMessage]);
	const push = ["git", "push"];
	if (oldHead) {
		push.push(`--force-with-lease=refs/heads/${branch}:${oldHead}`);
	}
	push.push("origin", `HEAD:refs/heads/${branch}`);
	await run(push);
	const headSha = (
		await run(["git", "rev-parse", "HEAD"], { capture: true })
	).stdout.trim();
	const pullRequest = await createOrUpdatePullRequest({
		...manifest.pullRequest,
		body: `${manifest.pullRequest.body}\n\n<!-- update-run: ${manifest.runId}; patch: ${manifest.patchSha256} -->`,
	});
	await createProvenanceComment(pullRequest, headSha, botUserId, manifest);
}
