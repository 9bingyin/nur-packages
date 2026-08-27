import { realpathSync } from "node:fs";
import {
	appendStepSummary,
	isRecord,
	parseJson,
	prettyJson,
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

export async function evalPackages(args: readonly string[]): Promise<void> {
	const { merged, output, system, target } = parseArguments(args);
	const comparison = comparePackages(
		await evaluatePackages(target, system),
		await evaluatePackages(merged, system),
		system,
	);
	writeTextFile(output, prettyJson(comparison));
	const summary = markdownSummary(comparison);
	console.log(summary);
	appendStepSummary(summary);
}
