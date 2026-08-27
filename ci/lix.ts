import { isDeepStrictEqual } from "node:util";
import { parsePackageSet } from "./eval-packages.ts";
import { appendStepSummary, readJsonFile } from "./lib.ts";

type Arguments = Readonly<{
	lix: string;
	nix: string;
	system: string;
}>;

function parseArguments(args: readonly string[]): Arguments {
	const values = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index];
		const value = args[index + 1];
		if (!flag?.startsWith("--") || value === undefined) {
			throw new Error("Expected --nix, --lix and --system arguments");
		}
		values.set(flag.slice(2), value);
	}
	const lix = values.get("lix");
	const nix = values.get("nix");
	const system = values.get("system");
	if (!lix || !nix || !system || values.size !== 3) {
		throw new Error("Expected --nix, --lix and --system arguments");
	}
	return { lix, nix, system };
}

export function packageSetsMatch(
	nixValue: unknown,
	lixValue: unknown,
	system: string,
): boolean {
	return isDeepStrictEqual(
		parsePackageSet(nixValue, system),
		parsePackageSet(lixValue, system),
	);
}

export async function checkLix(args: readonly string[]): Promise<void> {
	const { lix, nix, system } = parseArguments(args);
	const nixResult = parsePackageSet(readJsonFile(nix), system);
	const lixResult = parsePackageSet(readJsonFile(lix), system);
	const matches = isDeepStrictEqual(nixResult, lixResult);
	const summary = [
		`## Lix: ${system}`,
		"",
		`- Nix and Lix output paths: ${matches ? "identical" : "different"}`,
		"",
	].join("\n");
	console.log(summary);
	appendStepSummary(summary);
	if (!matches) {
		throw new Error(`Nix and Lix evaluation results differ on ${system}`);
	}
}
