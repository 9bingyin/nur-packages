import { mkdirSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { type EvalReport, parseEvalReport } from "./eval-compare.ts";
import type { EvalComparison } from "./eval-packages.ts";
import {
	appendStepSummary,
	prettyJson,
	readJsonFile,
	run,
	writeTextFile,
} from "./lib.ts";

export type ReviewSelection = Readonly<{
	added: readonly string[];
	changed: readonly string[];
	removed: readonly string[];
	selected: readonly string[];
	system: string;
}>;

export type ReviewReport = ReviewSelection &
	Readonly<{
		storePaths: readonly string[];
		success: boolean;
	}>;

type Arguments = Readonly<{
	cacheDirectory: string;
	comparison: string;
	output: string;
	repository: string;
	system: string;
}>;

export function selectPackagesFromResult(
	result: EvalComparison,
): ReviewSelection {
	const changed = result.changed.map(({ name }) => name).sort();
	return {
		added: [...result.added].sort(),
		changed,
		removed: [...result.removed].sort(),
		selected: [...new Set([...result.added, ...changed])].sort(),
		system: result.system,
	};
}

export function selectReviewPackages(
	report: EvalReport,
	system: string,
): ReviewSelection {
	const result = report.results.find((item) => item.system === system);
	if (result === undefined) {
		throw new Error(`Evaluation report has no result for ${system}`);
	}
	return selectPackagesFromResult(result);
}

export function reviewInstallables(
	repository: string,
	selection: ReviewSelection,
): readonly string[] {
	const absoluteRepository = realpathSync(repository);
	return selection.selected.map(
		(name) =>
			`path:${absoluteRepository}#packages.${selection.system}.${JSON.stringify(name)}`,
	);
}

export function reviewBuildCommand(
	repository: string,
	selection: ReviewSelection,
): readonly string[] {
	return [
		"nix",
		"build",
		"--no-link",
		"--keep-going",
		"--print-build-logs",
		"--no-write-lock-file",
		"--option",
		"accept-flake-config",
		"false",
		"--option",
		"allow-import-from-derivation",
		"false",
		...reviewInstallables(repository, selection),
	];
}

export function reviewMarkdown(report: ReviewReport): string {
	const lines = [
		`## Review: ${report.system}`,
		"",
		"| Result | Count |",
		"| --- | ---: |",
		`| Added | ${report.added.length} |`,
		`| Changed | ${report.changed.length} |`,
		`| Removed | ${report.removed.length} |`,
		`| Build targets | ${report.selected.length} |`,
		`| Store paths | ${report.storePaths.length} |`,
		`| Build | ${report.success ? "success" : "failure"} |`,
	];
	if (report.selected.length > 0) {
		lines.push(
			"",
			"### Build targets",
			"",
			...report.selected.map((name) => `- \`${name}\``),
		);
	} else {
		lines.push("", "No package outputs changed on this system.");
	}
	if (report.removed.length > 0) {
		lines.push(
			"",
			"### Removed packages",
			"",
			...report.removed.map((name) => `- \`${name}\``),
		);
	}
	return `${lines.join("\n")}\n`;
}

function parseArguments(args: readonly string[]): Arguments {
	const values = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index];
		const value = args[index + 1];
		if (!flag?.startsWith("--") || value === undefined) {
			throw new Error(
				"Expected --comparison, --repository, --system and --output arguments",
			);
		}
		values.set(flag.slice(2), value);
	}
	const cacheDirectory = values.get("cache-directory");
	const comparison = values.get("comparison");
	const repository = values.get("repository");
	const system = values.get("system");
	const output = values.get("output");
	if (
		!cacheDirectory ||
		!comparison ||
		!repository ||
		!system ||
		!output ||
		values.size !== 5
	) {
		throw new Error(
			"Expected --comparison, --repository, --system and --output arguments",
		);
	}
	return { cacheDirectory, comparison, output, repository, system };
}

async function createCacheBundle(
	directory: string,
	repository: string,
	selection: ReviewSelection,
): Promise<readonly string[]> {
	mkdirSync(directory, { recursive: true });
	const pathsFile = `${directory}/paths.json`;
	if (selection.selected.length === 0) {
		writeTextFile(pathsFile, prettyJson([]));
		return [];
	}
	const pathInfo = await run(
		["nix", "path-info", ...reviewInstallables(repository, selection)],
		{ capture: true },
	);
	const storePaths = pathInfo.stdout
		.split("\n")
		.map((path) => path.trim())
		.filter(Boolean)
		.sort();
	if (storePaths.length === 0) {
		throw new Error("Review produced no store paths");
	}
	const storeDirectory = `${directory}/store`;
	mkdirSync(storeDirectory, { recursive: true });
	await run([
		"nix",
		"copy",
		"--to",
		pathToFileURL(storeDirectory).href,
		...storePaths,
	]);
	writeTextFile(pathsFile, prettyJson(storePaths));
	return storePaths;
}

function writeReport(path: string, report: ReviewReport): void {
	writeTextFile(path, prettyJson(report));
	const summary = reviewMarkdown(report);
	console.log(summary);
	appendStepSummary(summary);
}

export async function review(args: readonly string[]): Promise<void> {
	const { cacheDirectory, comparison, output, repository, system } =
		parseArguments(args);
	const selection = selectReviewPackages(
		parseEvalReport(readJsonFile(comparison)),
		system,
	);
	if (selection.selected.length === 0) {
		const storePaths = await createCacheBundle(
			cacheDirectory,
			repository,
			selection,
		);
		writeReport(output, { ...selection, storePaths, success: true });
		return;
	}
	try {
		await run(reviewBuildCommand(repository, selection));
		const storePaths = await createCacheBundle(
			cacheDirectory,
			repository,
			selection,
		);
		writeReport(output, { ...selection, storePaths, success: true });
	} catch (error) {
		writeReport(output, { ...selection, storePaths: [], success: false });
		throw error;
	}
}
