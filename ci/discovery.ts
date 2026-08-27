import { existsSync } from "node:fs";
import process from "node:process";
import type { SystemConfig } from "./lib.ts";
import {
	compactJson,
	isRecord,
	parseJson,
	prettyJson,
	readJsonFile,
	readSystems,
	run,
	splitFilter,
	writeOutput,
} from "./lib.ts";

const MANUAL_UPDATE_MARKER = "no-auto-update";
const PACKAGE_EXPRESSION = `
let
  config = builtins.fromJSON (builtins.getEnv "DISCOVERY_CONFIG");
  flake = builtins.getFlake (toString ./.);
  pkgs = flake.packages.\${config.system} or { };
  isHidden = pkg: (builtins.tryEval (pkg.passthru.hideFromDocs or false)).value or false;
  shouldDiscover = pkg: !(isHidden pkg) && pkg ? version;
in
  builtins.mapAttrs (_: pkg: if shouldDiscover pkg then pkg.version else null) pkgs
`;

type UpdateType = "flake-input" | "package";

export type Target = Readonly<{
	currentVersion: string;
	name: string;
	system: string;
	type: UpdateType;
}>;

export type MatrixItem = Readonly<{
	artifact: string;
	group: string;
	requires_internet_archive: boolean;
	runner: string;
	system: string;
	target: Readonly<{ current_version: string; name: string }>;
	type: UpdateType;
}>;

export type UpdateMatrix = Readonly<{
	include: readonly MatrixItem[];
}>;

export type BatchMatrixItem = Readonly<{
	artifact: string;
	group: string;
	runner: string;
	targets: readonly MatrixItem[];
}>;

export type BatchMatrix = Readonly<{
	include: readonly BatchMatrixItem[];
}>;

function packageDirectory(name: string): string {
	return `packages/${name}`;
}

function automaticUpdatesDisabled(name: string): boolean {
	return existsSync(`${packageDirectory(name)}/${MANUAL_UPDATE_MARKER}`);
}

export function parsePackageVersions(
	value: unknown,
	system: string,
): ReadonlyMap<string, string> {
	if (!isRecord(value)) {
		throw new Error(`Package discovery for ${system} returned a non-object`);
	}
	const versions = new Map<string, string>();
	for (const [name, version] of Object.entries(value)) {
		if (typeof version === "string") {
			versions.set(name, version);
		}
	}
	return versions;
}

async function packageVersions(
	system: string,
): Promise<ReadonlyMap<string, string>> {
	const result = await run(
		["nix", "eval", "--json", "--impure", "--expr", PACKAGE_EXPRESSION],
		{
			capture: true,
			check: false,
			env: { DISCOVERY_CONFIG: JSON.stringify({ system }) },
		},
	);
	if (!result.success) {
		throw new Error(
			`Failed to discover packages for ${system}:\n${result.stderr}`,
		);
	}
	return parsePackageVersions(
		parseJson(result.stdout, `package discovery for ${system}`),
		system,
	);
}

async function discoverPackages(
	systems: readonly SystemConfig[],
	packageFilter: readonly string[] | undefined,
): Promise<readonly Target[]> {
	const discovered = new Map<string, Target>();
	const disabled = new Set<string>();

	for (const { system } of systems) {
		for (const [name, version] of await packageVersions(system)) {
			if (automaticUpdatesDisabled(name)) {
				disabled.add(name);
				continue;
			}
			if (
				(packageFilter === undefined || packageFilter.includes(name)) &&
				!discovered.has(name)
			) {
				discovered.set(name, {
					currentVersion: version,
					name,
					system,
					type: "package",
				});
			}
		}
	}

	for (const name of packageFilter ?? []) {
		if (disabled.has(name)) {
			console.log(`::warning::Package ${name} has automatic updates disabled`);
		} else if (!discovered.has(name)) {
			console.log(`::warning::Package ${name} was not found or has no version`);
		}
	}
	return [...discovered.values()].sort((left, right) =>
		left.name.localeCompare(right.name),
	);
}

function lockedRevision(
	nodes: Record<string, unknown>,
	nodeName: string,
): string {
	const node = nodes[nodeName];
	if (!isRecord(node) || !isRecord(node.locked)) {
		return "unknown";
	}
	const revision = node.locked.rev ?? node.locked.lastModified;
	return revision === undefined ? "unknown" : String(revision).slice(0, 8);
}

export function parseFlakeInputs(
	lock: unknown,
	inputFilter: readonly string[] | undefined,
): readonly Target[] {
	if (!isRecord(lock)) {
		throw new Error("flake.lock must be an object");
	}
	const nodes = lock.nodes;
	if (!isRecord(nodes)) {
		throw new Error("flake.lock has no nodes");
	}
	const root = nodes.root;
	if (!isRecord(root)) {
		throw new Error("flake.lock has no root node");
	}
	const inputs = root.inputs;
	if (!isRecord(inputs)) {
		throw new Error("flake.lock has no root inputs");
	}

	const names = inputFilter ?? Object.keys(inputs).sort();
	return names.map((name) => {
		const reference = inputs[name];
		const nodeName = typeof reference === "string" ? reference : name;
		return {
			currentVersion: lockedRevision(nodes, nodeName),
			name,
			system: "x86_64-linux",
			type: "flake-input",
		};
	});
}

function matrixTarget(target: Target): MatrixItem["target"] {
	return {
		current_version: target.currentVersion,
		name: target.name,
	};
}

function artifactName(type: UpdateType, name: string): string {
	return `update-${type}-${name.replaceAll(/[^A-Za-z0-9_.-]/g, "-")}`;
}

export function buildMatrix(
	systems: readonly SystemConfig[],
	packages: readonly Target[],
	flakeInputs: readonly Target[],
): UpdateMatrix {
	const include: MatrixItem[] = [];
	for (const { runner, system } of systems) {
		for (const target of packages.filter((item) => item.system === system)) {
			include.push({
				artifact: artifactName("package", target.name),
				group: `package-${target.name}`,
				requires_internet_archive: target.name === "termius",
				runner,
				system,
				target: matrixTarget(target),
				type: "package",
			});
		}
	}

	const runner = systems.find(
		({ system }) => system === "x86_64-linux",
	)?.runner;
	if (!runner && flakeInputs.length > 0) {
		throw new Error(
			"ci/systems.json must define x86_64-linux for flake input updates",
		);
	}
	for (const target of flakeInputs) {
		include.push({
			artifact: artifactName("flake-input", target.name),
			group: `flake-input-${target.name}`,
			requires_internet_archive: false,
			runner: runner ?? "",
			system: "x86_64-linux",
			target: matrixTarget(target),
			type: "flake-input",
		});
	}
	return { include };
}

export function buildBatchMatrix(matrix: UpdateMatrix): BatchMatrix {
	const batches = new Map<string, BatchMatrixItem>();
	for (const item of matrix.include) {
		const key = `${item.runner}:${item.system}`;
		const existing = batches.get(key);
		if (existing) {
			batches.set(key, { ...existing, targets: [...existing.targets, item] });
		} else {
			batches.set(key, {
				artifact: `update-batch-${item.system}`,
				group: item.system,
				runner: item.runner,
				targets: [item],
			});
		}
	}
	return {
		include: [...batches.values()].sort((left, right) =>
			left.group.localeCompare(right.group),
		),
	};
}

export async function discoverUpdates(): Promise<void> {
	const systems = readSystems();
	const packageFilter = splitFilter(process.env.PACKAGES);
	const inputFilter = splitFilter(process.env.INPUTS);
	const matrix = buildMatrix(
		systems,
		await discoverPackages(systems, packageFilter),
		parseFlakeInputs(readJsonFile("flake.lock"), inputFilter),
	);
	const batchMatrix = buildBatchMatrix(matrix);
	console.log(prettyJson(batchMatrix).trimEnd());
	writeOutput("batch-matrix", compactJson(batchMatrix));
	writeOutput("matrix", compactJson(matrix));
	writeOutput("has-updates", String(matrix.include.length > 0));
}
