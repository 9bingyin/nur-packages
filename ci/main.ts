import process from "node:process";
import { buildCache } from "./cache.ts";
import { discoverUpdates } from "./discovery.ts";
import { evalCompare } from "./eval-compare.ts";
import { evalPackages, evalSnapshot } from "./eval-packages.ts";
import { checkLix } from "./lix.ts";
import { mergePullRequest } from "./merge.ts";
import { mergePolicy } from "./merge-policy.ts";
import { preparePullRequest } from "./prepare-pr.ts";
import { publishStatus } from "./publish-status.ts";
import { review } from "./review.ts";
import { inspectUpdate, prepareUpdate, publishUpdate } from "./update.ts";
import {
	inspectUpdateBatch,
	prepareUpdateBatch,
	publishUpdateBatch,
} from "./update-batch.ts";
import { refreshUpdateQueue } from "./update-queue.ts";

function usage(): string {
	return [
		"Usage: bun ci/main.ts <command>",
		"",
		"Commands:",
		"  build-cache",
		"  discovery",
		"  eval-compare",
		"  eval-packages",
		"  eval-snapshot",
		"  inspect-update",
		"  inspect-update-batch",
		"  lix",
		"  merge",
		"  merge-policy",
		"  prepare-pr",
		"  prepare-update",
		"  prepare-update-batch",
		"  publish-status",
		"  publish-update",
		"  publish-update-batch",
		"  refresh-update-queue",
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
		case "inspect-update-batch":
			inspectUpdateBatch();
			return;
		case "lix":
			await checkLix(commandArgs);
			return;
		case "merge":
			await mergePullRequest();
			return;
		case "merge-policy":
			await mergePolicy();
			return;
		case "prepare-pr":
			await preparePullRequest();
			return;
		case "prepare-update":
			await prepareUpdate();
			return;
		case "prepare-update-batch":
			await prepareUpdateBatch();
			return;
		case "publish-status":
			await publishStatus();
			return;
		case "publish-update":
			await publishUpdate();
			return;
		case "publish-update-batch":
			await publishUpdateBatch();
			return;
		case "refresh-update-queue":
			await refreshUpdateQueue();
			return;
		case "review":
			await review(commandArgs);
			return;
		default:
			throw new Error(`Unknown command: ${command}\n\n${usage()}`);
	}
}

await main(process.argv.slice(2));
