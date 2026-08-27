import { realpathSync } from "node:fs";
import { type EvalReport, parseEvalReport } from "./eval-compare.ts";
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
		success: boolean;
	}>;

type Arguments = Readonly<{
	comparison: string;
	output: string;
	repository: string;
	system: string;
}>;

export function selectReviewPackages(
	report: EvalReport,
	system: string,
): ReviewSelection {
	const result = report.results.find((item) => item.system === system);
	if (result === undefined) {
		throw new Error(`Evaluation report has no result for ${system}`);
	}
	const changed = result.changed.map(({ name }) => name).sort();
	return {
		added: [...result.added].sort(),
		changed,
		removed: [...result.removed].sort(),
		selected: [...new Set([...result.added, ...changed])].sort(),
		system,
	};
}

export function reviewBuildCommand(
	repository: string,
	selection: ReviewSelection,
): readonly string[] {
	const absoluteRepository = realpathSync(repository);
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
		...selection.selected.map(
			(name) =>
				`path:${absoluteRepository}#packages.${selection.system}.${JSON.stringify(name)}`,
		),
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
	const comparison = values.get("comparison");
	const repository = values.get("repository");
	const system = values.get("system");
	const output = values.get("output");
	if (!comparison || !repository || !system || !output || values.size !== 4) {
		throw new Error(
			"Expected --comparison, --repository, --system and --output arguments",
		);
	}
	return { comparison, output, repository, system };
}

function writeReport(path: string, report: ReviewReport): void {
	writeTextFile(path, prettyJson(report));
	const summary = reviewMarkdown(report);
	console.log(summary);
	appendStepSummary(summary);
}

export async function review(args: readonly string[]): Promise<void> {
	const { comparison, output, repository, system } = parseArguments(args);
	const selection = selectReviewPackages(
		parseEvalReport(readJsonFile(comparison)),
		system,
	);
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
