import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type EvalComparison, parseEvalComparison } from "./eval-packages.ts";
import {
	appendStepSummary,
	prettyJson,
	readJsonFile,
	requireRecord,
	requireString,
	writeTextFile,
} from "./lib.ts";

const SHA_PATTERN = /^[0-9a-f]{40}$/;

export type ReviewRevision = Readonly<{
	baseBranch: string;
	baseSha: string;
	headBranch: string;
	headRepository: string;
	headRepositoryId: number;
	headSha: string;
	mergeable: boolean;
	mergedRepository: string;
	mergedSha: string;
	pullRequestNumber: number;
	repositoryId: number;
	repositoryOwnerId: number;
	runAttempt: number;
	runId: number;
	targetSha: string;
	workflowRef: string;
	workflowSha: string;
}>;

export type EvalReport = Readonly<{
	added: readonly string[];
	changed: readonly string[];
	removed: readonly string[];
	results: readonly EvalComparison[];
	revision: ReviewRevision;
}>;

type Arguments = Readonly<{
	input: string;
	output: string;
	revision: string;
}>;

function sortedNames(
	results: readonly EvalComparison[],
	select: (result: EvalComparison) => readonly string[],
): readonly string[] {
	return [...new Set(results.flatMap(select))].sort();
}

function parsePositiveInteger(value: unknown, name: string): number {
	if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
	return value;
}

function parseSha(value: unknown, name: string): string {
	const sha = typeof value === "string" ? value : "";
	if (!SHA_PATTERN.test(sha)) {
		throw new Error(`${name} must be a full commit SHA`);
	}
	return sha;
}

export function parseReviewRevision(value: unknown): ReviewRevision {
	const revision = requireRecord(value, "review revision");
	if (typeof revision.mergeable !== "boolean") {
		throw new Error("review revision.mergeable must be boolean");
	}
	return {
		baseBranch: requireString(
			revision.baseBranch,
			"review revision.baseBranch",
		),
		baseSha: parseSha(revision.baseSha, "review revision.baseSha"),
		headBranch: requireString(
			revision.headBranch,
			"review revision.headBranch",
		),
		headRepository: requireString(
			revision.headRepository,
			"review revision.headRepository",
		),
		headRepositoryId: parsePositiveInteger(
			revision.headRepositoryId,
			"review revision.headRepositoryId",
		),
		headSha: parseSha(revision.headSha, "review revision.headSha"),
		mergeable: revision.mergeable,
		mergedRepository: requireString(
			revision.mergedRepository,
			"review revision.mergedRepository",
		),
		mergedSha: parseSha(revision.mergedSha, "review revision.mergedSha"),
		pullRequestNumber: parsePositiveInteger(
			revision.pullRequestNumber,
			"review revision.pullRequestNumber",
		),
		repositoryId: parsePositiveInteger(
			revision.repositoryId,
			"review revision.repositoryId",
		),
		repositoryOwnerId: parsePositiveInteger(
			revision.repositoryOwnerId,
			"review revision.repositoryOwnerId",
		),
		runAttempt: parsePositiveInteger(
			revision.runAttempt,
			"review revision.runAttempt",
		),
		runId: parsePositiveInteger(revision.runId, "review revision.runId"),
		targetSha: parseSha(revision.targetSha, "review revision.targetSha"),
		workflowRef: requireString(
			revision.workflowRef,
			"review revision.workflowRef",
		),
		workflowSha: parseSha(revision.workflowSha, "review revision.workflowSha"),
	};
}

export function combineEvalResults(
	results: readonly EvalComparison[],
	revision: ReviewRevision,
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
		revision,
	};
}

export function parseEvalReport(value: unknown): EvalReport {
	const report = requireRecord(value, "eval report");
	if (!Array.isArray(report.results)) {
		throw new Error("eval report.results must be an array");
	}
	return combineEvalResults(
		report.results.map(parseEvalComparison),
		parseReviewRevision(report.revision),
	);
}

export function evalReportMarkdown(report: EvalReport): string {
	const lines = [
		"## Eval",
		"",
		`Reviewed merge: \`${report.revision.mergedSha.slice(0, 12)}\``,
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
	const values = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index];
		const value = args[index + 1];
		if (!flag?.startsWith("--") || value === undefined) {
			throw new Error("Expected --input, --output and --revision arguments");
		}
		values.set(flag.slice(2), value);
	}
	const input = values.get("input");
	const output = values.get("output");
	const revision = values.get("revision");
	if (!input || !output || !revision || values.size !== 3) {
		throw new Error("Expected --input, --output and --revision arguments");
	}
	return { input, output, revision };
}

export function evalCompare(args: readonly string[]): void {
	const { input, output, revision } = parseArguments(args);
	const results = readdirSync(input)
		.filter((file) => file.endsWith(".json"))
		.sort()
		.map((file) => parseEvalComparison(readJsonFile(join(input, file))));
	const report = combineEvalResults(
		results,
		parseReviewRevision(readJsonFile(revision)),
	);
	writeTextFile(output, prettyJson(report));
	const summary = evalReportMarkdown(report);
	console.log(summary);
	appendStepSummary(summary);
}
