import {
	existsSync,
	mkdirSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import process from "node:process";
import type { MatrixItem } from "./discovery.ts";
import {
	compactJson,
	parseJson,
	prettyJson,
	requiredEnvironment,
	requireRecord,
	requireString,
	run,
	writeOutput,
} from "./lib.ts";
import { publishUpdate, updateArtifactChanged } from "./update.ts";

const UPDATE_CONCURRENCY_DEFAULT = 4;
const UPDATE_MANIFEST = "manifest.json";
const UPDATE_PATCH = "changes.patch";

type BatchTarget = MatrixItem;

type Worktree = Readonly<{
	directory: string;
	target: BatchTarget;
}>;

function positiveInteger(value: string | undefined, fallback: number): number {
	if (value === undefined || value.length === 0) {
		return fallback;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error("UPDATE_CONCURRENCY must be a positive integer");
	}
	return parsed;
}

function parseBatchTarget(value: unknown, index: number): BatchTarget {
	const item = requireRecord(value, `UPDATE_BATCH[${index}]`);
	const target = requireRecord(item.target, `UPDATE_BATCH[${index}].target`);
	const type = item.type;
	if (type !== "package" && type !== "flake-input") {
		throw new Error(`UPDATE_BATCH[${index}].type is invalid`);
	}
	const requiresInternetArchive = item.requires_internet_archive;
	if (typeof requiresInternetArchive !== "boolean") {
		throw new Error(
			`UPDATE_BATCH[${index}].requires_internet_archive must be boolean`,
		);
	}
	const artifact = requireString(
		item.artifact,
		`UPDATE_BATCH[${index}].artifact`,
	);
	if (!/^update-[A-Za-z0-9_.-]+$/.test(artifact)) {
		throw new Error(`UPDATE_BATCH[${index}].artifact is invalid`);
	}
	return {
		artifact,
		group: requireString(item.group, `UPDATE_BATCH[${index}].group`),
		requires_internet_archive: requiresInternetArchive,
		runner: requireString(item.runner, `UPDATE_BATCH[${index}].runner`),
		system: requireString(item.system, `UPDATE_BATCH[${index}].system`),
		target: {
			current_version: requireString(
				target.current_version,
				`UPDATE_BATCH[${index}].target.current_version`,
			),
			name: requireString(target.name, `UPDATE_BATCH[${index}].target.name`),
		},
		type,
	};
}

export function parseUpdateBatch(value: unknown): readonly BatchTarget[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error("UPDATE_BATCH must be a non-empty array");
	}
	const targets = value.map(parseBatchTarget);
	if (
		new Set(targets.map(({ artifact }) => artifact)).size !== targets.length
	) {
		throw new Error("UPDATE_BATCH contains duplicate artifacts");
	}
	return targets;
}

async function createWorktrees(
	repository: string,
	root: string,
	targets: readonly BatchTarget[],
): Promise<readonly Worktree[]> {
	const worktrees: Worktree[] = [];
	try {
		for (const target of targets) {
			const directory = join(root, target.artifact);
			await run([
				"git",
				"-C",
				repository,
				"worktree",
				"add",
				"--detach",
				"--force",
				directory,
				"HEAD",
			]);
			worktrees.push({ directory, target });
		}
		return worktrees;
	} catch (error) {
		for (const { directory } of worktrees) {
			await run(
				["git", "-C", repository, "worktree", "remove", "--force", directory],
				{ check: false },
			);
		}
		throw error;
	}
}

async function runTarget(
	worktree: Worktree,
	artifactRoot: string,
): Promise<void> {
	const { target } = worktree;
	const internetArchiveAccessKey = target.requires_internet_archive
		? requiredEnvironment("INTERNET_ARCHIVE_ACCESS_KEY")
		: "";
	const internetArchiveSecretKey = target.requires_internet_archive
		? requiredEnvironment("INTERNET_ARCHIVE_SECRET_KEY")
		: "";
	await run([process.execPath, "ci/main.ts", "prepare-update"], {
		cwd: worktree.directory,
		env: {
			INTERNET_ARCHIVE_ACCESS_KEY: internetArchiveAccessKey,
			INTERNET_ARCHIVE_SECRET_KEY: internetArchiveSecretKey,
			NIXPKGS_ALLOW_UNFREE: "1",
			NIX_UPDATE_SYSTEM: target.system,
			UPDATE_ARTIFACT_DIR: join(artifactRoot, target.artifact),
			UPDATE_TARGET: compactJson(target.target),
			UPDATE_TYPE: target.type,
		},
	});
}

async function runWorkers(
	worktrees: readonly Worktree[],
	artifactRoot: string,
	concurrency: number,
): Promise<readonly string[]> {
	let next = 0;
	const failures: string[] = [];
	const workers = Array.from(
		{ length: Math.min(concurrency, worktrees.length) },
		async () => {
			while (next < worktrees.length) {
				const index = next;
				next += 1;
				const worktree = worktrees[index];
				if (worktree === undefined) {
					continue;
				}
				try {
					await runTarget(worktree, artifactRoot);
				} catch (error) {
					failures.push(`${worktree.target.group}: ${String(error)}`);
				}
			}
		},
	);
	await Promise.all(workers);
	return failures;
}

export async function prepareUpdateBatch(): Promise<void> {
	const repository = realpathSync(".");
	const artifactRoot = requiredEnvironment("UPDATE_BATCH_DIR");
	const worktreeRoot = requiredEnvironment("UPDATE_WORKTREE_DIR");
	const targets = parseUpdateBatch(
		parseJson(requiredEnvironment("UPDATE_BATCH"), "UPDATE_BATCH"),
	);
	const concurrency = positiveInteger(
		process.env.UPDATE_CONCURRENCY,
		UPDATE_CONCURRENCY_DEFAULT,
	);
	rmSync(artifactRoot, { force: true, recursive: true });
	rmSync(worktreeRoot, { force: true, recursive: true });
	mkdirSync(artifactRoot, { recursive: true });
	mkdirSync(worktreeRoot, { recursive: true });
	const worktrees = await createWorktrees(repository, worktreeRoot, targets);
	try {
		const failures = await runWorkers(worktrees, artifactRoot, concurrency);
		writeFileSync(
			join(artifactRoot, "batch-result.json"),
			prettyJson({ failures, total: targets.length }),
		);
		if (failures.length > 0) {
			throw new Error(`Update batch failed:\n${failures.join("\n")}`);
		}
	} finally {
		for (const { directory } of worktrees) {
			await run(
				["git", "-C", repository, "worktree", "remove", "--force", directory],
				{ check: false },
			);
		}
		rmSync(worktreeRoot, { force: true, recursive: true });
	}
}

function updateArtifactDirectories(root: string): readonly string[] {
	if (!existsSync(root)) {
		return [];
	}
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(root, entry.name))
		.filter(
			(directory) =>
				existsSync(join(directory, UPDATE_MANIFEST)) &&
				existsSync(join(directory, UPDATE_PATCH)),
		)
		.sort();
}

export function inspectUpdateBatch(): void {
	const directories = updateArtifactDirectories(
		requiredEnvironment("UPDATE_BATCH_DIR"),
	);
	const changed = directories.filter(updateArtifactChanged);
	writeOutput("changed", String(changed.length > 0));
	writeOutput("changedCount", String(changed.length));
	writeOutput("preparedCount", String(directories.length));
}

export async function publishUpdateBatch(): Promise<void> {
	requiredEnvironment("GH_TOKEN");
	const directories = updateArtifactDirectories(
		requiredEnvironment("UPDATE_BATCH_DIR"),
	).filter(updateArtifactChanged);
	const previous = process.env.UPDATE_ARTIFACT_DIR;
	const failures: string[] = [];
	try {
		for (const directory of directories) {
			process.env.UPDATE_ARTIFACT_DIR = directory;
			try {
				await publishUpdate();
			} catch (error) {
				failures.push(`${directory}: ${String(error)}`);
			}
		}
	} finally {
		if (previous === undefined) {
			delete process.env.UPDATE_ARTIFACT_DIR;
		} else {
			process.env.UPDATE_ARTIFACT_DIR = previous;
		}
	}
	if (failures.length > 0) {
		throw new Error(`Publishing update batch failed:\n${failures.join("\n")}`);
	}
}
