import { realpathSync } from "node:fs";
import {
	isRecord,
	parseJson,
	prettyJson,
	requireRecord,
	requireString,
	run,
	writeTextFile,
} from "./lib.ts";

const APPLY_EXPRESSION =
	"packages: builtins.mapAttrs (_: package: { " +
	"path = package.outPath; " +
	"version = package.version or null; " +
	"}) packages";

export type PackageOutput = Readonly<{
	path: string;
	version: string | null;
}>;

export type PackageSet = Readonly<Record<string, PackageOutput>>;

export type ChangedPackage = Readonly<{
	after: PackageOutput;
	before: PackageOutput;
	name: string;
}>;

export type EvalComparison = Readonly<{
	added: readonly string[];
	changed: readonly ChangedPackage[];
	mergedCount: number;
	removed: readonly string[];
	system: string;
	targetCount: number;
	unchangedCount: number;
}>;

type Arguments = Readonly<{
	merged: string;
	output: string;
	system: string;
	target: string;
}>;

type SnapshotArguments = Readonly<{
	output: string;
	repository: string;
	system: string;
}>;

function parseCount(value: unknown, name: string): number {
	if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
		throw new Error(`${name} must be a non-negative integer`);
	}
	return value;
}

function parseNames(value: unknown, name: string): readonly string[] {
	if (!Array.isArray(value)) {
		throw new Error(`${name} must be an array`);
	}
	return value.map((item, index) => requireString(item, `${name}[${index}]`));
}

function parsePackageOutput(value: unknown, name: string): PackageOutput {
	const output = requireRecord(value, name);
	const version = output.version;
	if (version !== null && typeof version !== "string") {
		throw new Error(`${name}.version must be a string or null`);
	}
	return {
		path: requireString(output.path, `${name}.path`),
		version,
	};
}

export function parseEvalComparison(value: unknown): EvalComparison {
	const comparison = requireRecord(value, "eval comparison");
	if (!Array.isArray(comparison.changed)) {
		throw new Error("eval comparison.changed must be an array");
	}
	const changed = comparison.changed.map((item, index) => {
		const change = requireRecord(item, `eval comparison.changed[${index}]`);
		return {
			after: parsePackageOutput(
				change.after,
				`eval comparison.changed[${index}].after`,
			),
			before: parsePackageOutput(
				change.before,
				`eval comparison.changed[${index}].before`,
			),
			name: requireString(
				change.name,
				`eval comparison.changed[${index}].name`,
			),
		} satisfies ChangedPackage;
	});
	return {
		added: parseNames(comparison.added, "eval comparison.added"),
		changed,
		mergedCount: parseCount(
			comparison.mergedCount,
			"eval comparison.mergedCount",
		),
		removed: parseNames(comparison.removed, "eval comparison.removed"),
		system: requireString(comparison.system, "eval comparison.system"),
		targetCount: parseCount(
			comparison.targetCount,
			"eval comparison.targetCount",
		),
		unchangedCount: parseCount(
			comparison.unchangedCount,
			"eval comparison.unchangedCount",
		),
	};
}

export function parsePackageSet(value: unknown, system: string): PackageSet {
	if (!isRecord(value)) {
		throw new Error(`Package evaluation for ${system} returned a non-object`);
	}
	const packages: Record<string, PackageOutput> = {};
	for (const [name, item] of Object.entries(value)) {
		if (!isRecord(item) || typeof item.path !== "string") {
			throw new Error(`Package ${name} has no output path on ${system}`);
		}
		if (item.version !== null && typeof item.version !== "string") {
			throw new Error(`Package ${name} has an invalid version on ${system}`);
		}
		packages[name] = { path: item.path, version: item.version };
	}
	return packages;
}

export async function evaluatePackages(
	repository: string,
	system: string,
): Promise<PackageSet> {
	const absoluteRepository = realpathSync(repository);
	const result = await run(
		[
			"nix",
			"eval",
			"--json",
			"--no-write-lock-file",
			"--option",
			"accept-flake-config",
			"false",
			"--option",
			"allow-import-from-derivation",
			"false",
			`path:${absoluteRepository}#packages.${system}`,
			"--apply",
			APPLY_EXPRESSION,
		],
		{ capture: true },
	);
	return parsePackageSet(
		parseJson(result.stdout, `package evaluation for ${system}`),
		system,
	);
}

export function comparePackages(
	target: PackageSet,
	merged: PackageSet,
	system: string,
): EvalComparison {
	const targetNames = new Set(Object.keys(target));
	const mergedNames = new Set(Object.keys(merged));
	const commonNames = [...targetNames]
		.filter((name) => mergedNames.has(name))
		.sort();
	const changed = commonNames.flatMap((name) => {
		const before = target[name];
		const after = merged[name];
		if (
			before === undefined ||
			after === undefined ||
			before.path === after.path
		) {
			return [];
		}
		return [{ after, before, name }];
	});
	return {
		added: [...mergedNames].filter((name) => !targetNames.has(name)).sort(),
		changed,
		mergedCount: mergedNames.size,
		removed: [...targetNames].filter((name) => !mergedNames.has(name)).sort(),
		system,
		targetCount: targetNames.size,
		unchangedCount: commonNames.length - changed.length,
	};
}

export function markdownSummary(result: EvalComparison): string {
	const lines = [
		`## Eval: ${result.system}`,
		"",
		"| Result | Count |",
		"| --- | ---: |",
		`| Added | ${result.added.length} |`,
		`| Removed | ${result.removed.length} |`,
		`| Changed | ${result.changed.length} |`,
		`| Unchanged | ${result.unchangedCount} |`,
	];
	const sections: readonly Readonly<{
		names: readonly string[];
		title: string;
	}>[] = [
		{ names: result.added, title: "Added packages" },
		{ names: result.removed, title: "Removed packages" },
		{
			names: result.changed.map(({ name }) => name),
			title: "Changed packages",
		},
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

export function parseArguments(args: readonly string[]): Arguments {
	const values = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index];
		const value = args[index + 1];
		if (!flag?.startsWith("--") || value === undefined) {
			throw new Error(
				"Expected --target, --merged, --system and --output arguments",
			);
		}
		values.set(flag.slice(2), value);
	}
	const target = values.get("target");
	const merged = values.get("merged");
	const system = values.get("system");
	const output = values.get("output");
	if (!target || !merged || !system || !output || values.size !== 4) {
		throw new Error(
			"Expected --target, --merged, --system and --output arguments",
		);
	}
	return { merged, output, system, target };
}

function parseSnapshotArguments(args: readonly string[]): SnapshotArguments {
	const values = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index];
		const value = args[index + 1];
		if (!flag?.startsWith("--") || value === undefined) {
			throw new Error("Expected --repository, --system and --output arguments");
		}
		values.set(flag.slice(2), value);
	}
	const repository = values.get("repository");
	const system = values.get("system");
	const output = values.get("output");
	if (!repository || !system || !output || values.size !== 3) {
		throw new Error("Expected --repository, --system and --output arguments");
	}
	return { output, repository, system };
}

export async function evalSnapshot(args: readonly string[]): Promise<void> {
	const { output, repository, system } = parseSnapshotArguments(args);
	writeTextFile(output, prettyJson(await evaluatePackages(repository, system)));
}

export async function evalPackages(args: readonly string[]): Promise<void> {
	const { merged, output, system, target } = parseArguments(args);
	const comparison = comparePackages(
		await evaluatePackages(target, system),
		await evaluatePackages(merged, system),
		system,
	);
	writeTextFile(output, prettyJson(comparison));
	console.log(markdownSummary(comparison));
}
