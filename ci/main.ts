import process from "node:process";
import { autoMerge } from "./auto-merge.ts";
import { buildNativePackages } from "./build-native-packages.ts";
import { discoverUpdates } from "./discovery.ts";
import { evalPackages } from "./eval-packages.ts";
import { preparePullRequest } from "./prepare-pr.ts";
import { publishStatus } from "./publish-status.ts";
import { updateTargets } from "./update.ts";

function usage(): string {
	return [
		"Usage: bun ci/main.ts <command>",
		"",
		"Commands:",
		"  auto-merge",
		"  build-native-packages",
		"  discovery",
		"  eval-packages",
		"  prepare-pr",
		"  publish-status",
		"  update",
	].join("\n");
}

async function main(args: readonly string[]): Promise<void> {
	if (args.length === 0) {
		throw new Error(usage());
	}
	const command = args[0];
	const commandArgs = args.slice(1);
	switch (command) {
		case "auto-merge":
			await autoMerge();
			return;
		case "build-native-packages":
			await buildNativePackages();
			return;
		case "discovery":
			await discoverUpdates();
			return;
		case "eval-packages":
			await evalPackages(commandArgs);
			return;
		case "prepare-pr":
			await preparePullRequest();
			return;
		case "publish-status":
			await publishStatus();
			return;
		case "update":
			await updateTargets();
			return;
		default:
			throw new Error(`Unknown command: ${command}\n\n${usage()}`);
	}
}

await main(process.argv.slice(2));
