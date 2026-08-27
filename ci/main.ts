import process from "node:process";
import { buildAllCache, buildCache, buildCacheResult } from "./cache.ts";
import { cacheGate } from "./cache-gate.ts";
import { uploadCache } from "./cache-upload.ts";
import { discoverUpdates } from "./discovery.ts";
import { evalCompare } from "./eval-compare.ts";
import { evalPackages, evalSnapshot } from "./eval-packages.ts";
import { checkLix } from "./lix.ts";
import { mergeCachedPullRequest } from "./merge.ts";
import { preparePullRequest } from "./prepare-pr.ts";
import { publishStatus } from "./publish-status.ts";
import { review } from "./review.ts";
import { inspectUpdate, prepareUpdate, publishUpdate } from "./update.ts";

function usage(): string {
	return [
		"Usage: bun ci/main.ts <command>",
		"",
		"Commands:",
		"  build-cache",
		"  build-cache-all",
		"  build-cache-result",
		"  cache-gate",
		"  cache-upload",
		"  discovery",
		"  eval-compare",
		"  eval-packages",
		"  eval-snapshot",
		"  inspect-update",
		"  lix",
		"  merge",
		"  prepare-pr",
		"  prepare-update",
		"  publish-status",
		"  publish-update",
		"  review",
	].join("\n");
}

async function main(args: readonly string[]): Promise<void> {
	if (args.length === 0) {
		throw new Error(usage());
	}
	const command = args[0];
	const commandArgs = args.slice(1);
	switch (command) {
		case "build-cache":
			await buildCache(commandArgs);
			return;
		case "build-cache-all":
			await buildAllCache(commandArgs);
			return;
		case "build-cache-result":
			await buildCacheResult(commandArgs);
			return;
		case "cache-gate":
			await cacheGate();
			return;
		case "cache-upload":
			await uploadCache(commandArgs);
			return;
		case "discovery":
			await discoverUpdates();
			return;
		case "eval-compare":
			evalCompare(commandArgs);
			return;
		case "eval-packages":
			await evalPackages(commandArgs);
			return;
		case "eval-snapshot":
			await evalSnapshot(commandArgs);
			return;
		case "inspect-update":
			inspectUpdate();
			return;
		case "lix":
			await checkLix(commandArgs);
			return;
		case "merge":
			await mergeCachedPullRequest();
			return;
		case "prepare-pr":
			await preparePullRequest();
			return;
		case "prepare-update":
			await prepareUpdate();
			return;
		case "publish-status":
			await publishStatus();
			return;
		case "publish-update":
			await publishUpdate();
			return;
		case "review":
			await review(commandArgs);
			return;
		default:
			throw new Error(`Unknown command: ${command}\n\n${usage()}`);
	}
}

await main(process.argv.slice(2));
