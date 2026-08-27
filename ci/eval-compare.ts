import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type EvalComparison, parseEvalComparison } from "./eval-packages.ts";
import {
	appendStepSummary,
	prettyJson,
	readJsonFile,
	writeTextFile,
} from "./lib.ts";

export type EvalReport = Readonly<{
	added: readonly string[];
	changed: readonly string[];
	removed: readonly string[];
	results: readonly EvalComparison[];
}>;

type Arguments = Readonly<{
	input: string;
	output: string;
}>;

function sortedNames(
	results: readonly EvalComparison[],
	select: (result: EvalComparison) => readonly string[],
): readonly string[] {
	return [...new Set(results.flatMap(select))].sort();
}

export function combineEvalResults(
	results: readonly EvalComparison[],
): EvalReport {
	if (results.length === 0) {
		throw new Error("No evaluation results were found");
	}
	const sorted = [...results].sort((left, right) =>
		left.system.localeCompare(right.system),
	);
	const systems = sorted.map(({ system }) => system);
	if (new Set(systems).size !== systems.length) {
		throw new Error("Evaluation results contain duplicate systems");
	}
	return {
		added: sortedNames(sorted, ({ added }) => added),
		changed: sortedNames(sorted, ({ changed }) =>
			changed.map(({ name }) => name),
		),
		removed: sortedNames(sorted, ({ removed }) => removed),
		results: sorted,
	};
}

export function evalReportMarkdown(report: EvalReport): string {
	const lines = [
		"## Eval",
		"",
		"| System | Added | Removed | Changed | Unchanged |",
		"| --- | ---: | ---: | ---: | ---: |",
		...report.results.map(
			(result) =>
				`| \`${result.system}\` | ${result.added.length} | ${result.removed.length} | ${result.changed.length} | ${result.unchangedCount} |`,
		),
	];
	const sections: readonly Readonly<{
		names: readonly string[];
		title: string;
	}>[] = [
		{ names: report.added, title: "Added packages" },
		{ names: report.removed, title: "Removed packages" },
		{ names: report.changed, title: "Changed packages" },
	];
	for (const { names, title } of sections) {
		if (names.length > 0) {
			lines.push(
				"",
				`### ${title}`,
				"",
				...names.map((name) => `- \`${name}\``),
			);
		}
	}
	return `${lines.join("\n")}\n`;
}

function parseArguments(args: readonly string[]): Arguments {
	if (
		args.length !== 4 ||
		args[0] !== "--input" ||
		args[1] === undefined ||
		args[2] !== "--output" ||
		args[3] === undefined
	) {
		throw new Error("Expected --input and --output arguments");
	}
	return { input: args[1], output: args[3] };
}

export function evalCompare(args: readonly string[]): void {
	const { input, output } = parseArguments(args);
	const results = readdirSync(input)
		.filter((file) => file.endsWith(".json"))
		.sort()
		.map((file) => parseEvalComparison(readJsonFile(join(input, file))));
	const report = combineEvalResults(results);
	writeTextFile(output, prettyJson(report));
	const summary = evalReportMarkdown(report);
	console.log(summary);
	appendStepSummary(summary);
}
