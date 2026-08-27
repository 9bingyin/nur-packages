import { realpathSync } from "node:fs";
import { parseEvalReport } from "./eval-compare.ts";
import { parseEvalComparison } from "./eval-packages.ts";
import {
	appendStepSummary,
	parseJson,
	prettyJson,
	readJsonFile,
	requireString,
	run,
	writeTextFile,
} from "./lib.ts";
import {
	type ReviewSelection,
	reviewBuildCommand,
	selectPackagesFromResult,
	selectReviewPackages,
} from "./review.ts";

export type CacheReport = ReviewSelection &
	Readonly<{
		success: boolean;
	}>;

type BuildArguments = Readonly<{
	input: string;
	output: string;
	repository: string;
	system: string;
}>;

type AllArguments = Readonly<{
	output: string;
	repository: string;
	system: string;
}>;

function argumentMap(args: readonly string[]): ReadonlyMap<string, string> {
	const values = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index];
		const value = args[index + 1];
		if (!flag?.startsWith("--") || value === undefined) {
			throw new Error("Expected paired --flag value arguments");
		}
		values.set(flag.slice(2), value);
	}
	return values;
}

function parseBuildArguments(
	args: readonly string[],
	inputName: "comparison" | "result",
): BuildArguments {
	const values = argumentMap(args);
	const input = values.get(inputName);
	const repository = values.get("repository");
	const system = values.get("system");
	const output = values.get("output");
	if (!input || !repository || !system || !output || values.size !== 4) {
		throw new Error(
			`Expected --${inputName}, --repository, --system and --output arguments`,
		);
	}
	return { input, output, repository, system };
}

function parseAllArguments(args: readonly string[]): AllArguments {
	const values = argumentMap(args);
	const repository = values.get("repository");
	const system = values.get("system");
	const output = values.get("output");
	if (!repository || !system || !output || values.size !== 3) {
		throw new Error("Expected --repository, --system and --output arguments");
	}
	return { output, repository, system };
}

function cacheMarkdown(report: CacheReport): string {
	const lines = [
		`## Cache: ${report.system}`,
		"",
		"| Result | Count |",
		"| --- | ---: |",
		`| Added | ${report.added.length} |`,
		`| Changed | ${report.changed.length} |`,
		`| Removed | ${report.removed.length} |`,
		`| Upload targets | ${report.selected.length} |`,
		`| Build | ${report.success ? "success" : "failure"} |`,
	];
	if (report.selected.length > 0) {
		lines.push(
			"",
			"### Upload targets",
			"",
			...report.selected.map((name) => `- \`${name}\``),
		);
	} else {
		lines.push("", "No package outputs changed on this system.");
	}
	return `${lines.join("\n")}\n`;
}

function writeReport(path: string, report: CacheReport): void {
	writeTextFile(path, prettyJson(report));
	const summary = cacheMarkdown(report);
	console.log(summary);
	appendStepSummary(summary);
}

async function buildSelection(
	repository: string,
	output: string,
	selection: ReviewSelection,
): Promise<void> {
	if (selection.selected.length === 0) {
		writeReport(output, { ...selection, success: true });
		return;
	}
	try {
		await run(reviewBuildCommand(repository, selection));
		writeReport(output, { ...selection, success: true });
	} catch (error) {
		writeReport(output, { ...selection, success: false });
		throw error;
	}
}

export async function buildCache(args: readonly string[]): Promise<void> {
	const { input, output, repository, system } = parseBuildArguments(
		args,
		"comparison",
	);
	await buildSelection(
		repository,
		output,
		selectReviewPackages(parseEvalReport(readJsonFile(input)), system),
	);
}

export async function buildCacheResult(args: readonly string[]): Promise<void> {
	const { input, output, repository, system } = parseBuildArguments(
		args,
		"result",
	);
	const result = parseEvalComparison(readJsonFile(input));
	if (result.system !== system) {
		throw new Error(`Evaluation result is for ${result.system}, not ${system}`);
	}
	await buildSelection(repository, output, selectPackagesFromResult(result));
}

async function packageNames(
	repository: string,
	system: string,
): Promise<readonly string[]> {
	const absoluteRepository = realpathSync(repository);
	const result = await run(
		[
			"nix",
			"eval",
			"--json",
			"--no-write-lock-file",
			`path:${absoluteRepository}#packages.${system}`,
			"--apply",
			"builtins.attrNames",
		],
		{ capture: true },
	);
	const value = parseJson(result.stdout, `packages for ${system}`);
	if (!Array.isArray(value)) {
		throw new Error(`packages.${system} did not evaluate to an attribute set`);
	}
	return value.map((name, index) =>
		requireString(name, `packages.${system}[${index}]`),
	);
}

export async function buildAllCache(args: readonly string[]): Promise<void> {
	const { output, repository, system } = parseAllArguments(args);
	const names = [...(await packageNames(repository, system))].sort();
	await buildSelection(repository, output, {
		added: names,
		changed: [],
		removed: [],
		selected: names,
		system,
	});
}
