import assert from "node:assert/strict";
import test from "node:test";
import { pullRequestNumbers, shouldMerge } from "./auto-merge.ts";
import { nixFastBuildCommand } from "./build-native-packages.ts";
import {
	buildMatrix,
	parseFlakeInputs,
	parsePackageVersions,
} from "./discovery.ts";
import { combineEvalResults, evalReportMarkdown } from "./eval-compare.ts";
import {
	comparePackages,
	markdownSummary,
	parsePackageSet,
} from "./eval-packages.ts";
import { parseSystems } from "./lib.ts";
import { checksSucceeded } from "./publish-status.ts";
import {
	reviewBuildCommand,
	reviewMarkdown,
	selectReviewPackages,
} from "./review.ts";
import {
	buildPullRequest,
	parseCommitChanges,
	parseTargets,
	parseUpdateScript,
	worktreeCommand,
} from "./update.ts";

test("parseSystems validates systems and runners", () => {
	assert.deepEqual(
		parseSystems([{ runner: "ubuntu-latest", system: "x86_64-linux" }]),
		[{ runner: "ubuntu-latest", system: "x86_64-linux" }],
	);
});

test("pullRequestNumbers ignores malformed entries", () => {
	assert.deepEqual(
		pullRequestNumbers({
			workflow_run: { pull_requests: [{ number: 12 }, { number: "13" }, null] },
		}),
		[12],
	);
});

test("shouldMerge accepts only eligible automated updates", () => {
	const pullRequest = {
		baseRefName: "main",
		headRefName: "automation/update-package-forge",
		headRefOid: "abc",
		isDraft: false,
		labels: [{ name: "automated" }, { name: "dependencies" }],
	};
	assert.equal(shouldMerge(pullRequest, "abc", "main"), true);
	assert.equal(
		shouldMerge({ ...pullRequest, isDraft: true }, "abc", "main"),
		false,
	);
});

test("nixFastBuildCommand adds niks3 only when configured", () => {
	const plain = nixFastBuildCommand("x86_64-linux", undefined);
	assert.equal(plain.includes("nixpkgs#niks3"), false);
	const cached = nixFastBuildCommand("x86_64-linux", "https://cache.example");
	assert.equal(cached.includes("nixpkgs#niks3"), true);
	assert.equal(cached.includes("--niks3-server"), true);
});

test("discovery builds package and flake input groups", () => {
	const systems = parseSystems([
		{ runner: "ubuntu-latest", system: "x86_64-linux" },
		{ runner: "macos-latest", system: "aarch64-darwin" },
	]);
	const packageVersions = parsePackageVersions(
		{ forge: "1.0", hidden: null },
		"x86_64-linux",
	);
	assert.deepEqual([...packageVersions], [["forge", "1.0"]]);
	const flakeInputs = parseFlakeInputs(
		{
			nodes: {
				nixpkgs: { locked: { rev: "1234567890abcdef" } },
				root: { inputs: { nixpkgs: "nixpkgs" } },
			},
		},
		undefined,
	);
	const matrix = buildMatrix(
		systems,
		[
			{
				currentVersion: "1.0",
				name: "forge",
				system: "x86_64-linux",
				type: "package",
			},
		],
		flakeInputs,
	);
	assert.deepEqual(
		matrix.include.map(({ group }) => group),
		["package-x86_64-linux", "flake-inputs"],
	);
});

test("eval comparison reports added, removed and changed packages", () => {
	const target = parsePackageSet(
		{
			changed: { path: "/nix/store/old", version: "1" },
			removed: { path: "/x", version: null },
		},
		"x86_64-linux",
	);
	const merged = parsePackageSet(
		{
			added: { path: "/y", version: "1" },
			changed: { path: "/nix/store/new", version: "2" },
		},
		"x86_64-linux",
	);
	const result = comparePackages(target, merged, "x86_64-linux");
	assert.deepEqual(result.added, ["added"]);
	assert.deepEqual(result.removed, ["removed"]);
	assert.deepEqual(
		result.changed.map(({ name }) => name),
		["changed"],
	);
	assert.equal(markdownSummary(result).includes("### Changed packages"), true);
});

test("eval report combines systems for review", () => {
	const report = combineEvalResults([
		{
			added: ["linux-only"],
			changed: [],
			mergedCount: 1,
			removed: [],
			system: "x86_64-linux",
			targetCount: 0,
			unchangedCount: 0,
		},
		{
			added: [],
			changed: [
				{
					after: { path: "/nix/store/new", version: "2" },
					before: { path: "/nix/store/old", version: "1" },
					name: "shared",
				},
			],
			mergedCount: 1,
			removed: [],
			system: "aarch64-darwin",
			targetCount: 1,
			unchangedCount: 0,
		},
	]);
	assert.deepEqual(report.added, ["linux-only"]);
	assert.deepEqual(report.changed, ["shared"]);
	assert.equal(evalReportMarkdown(report).includes("`aarch64-darwin`"), true);
});

test("review builds added and changed packages for one system", () => {
	const report = combineEvalResults([
		{
			added: ["added"],
			changed: [
				{
					after: { path: "/nix/store/new", version: "2" },
					before: { path: "/nix/store/old", version: "1" },
					name: "changed",
				},
			],
			mergedCount: 2,
			removed: ["removed"],
			system: "aarch64-darwin",
			targetCount: 2,
			unchangedCount: 0,
		},
	]);
	const selection = selectReviewPackages(report, "aarch64-darwin");
	assert.deepEqual(selection.selected, ["added", "changed"]);
	assert.equal(selection.removed[0], "removed");
	const command = reviewBuildCommand(".", selection);
	assert.equal(command.includes("--keep-going"), true);
	assert.equal(
		command.some((item) => item.endsWith('#packages.aarch64-darwin."added"')),
		true,
	);
	assert.equal(
		reviewMarkdown({ ...selection, success: true }).includes("Build | success"),
		true,
	);
});

test("checksSucceeded requires every job to succeed", () => {
	assert.equal(checksSucceeded(["success", "success"]), true);
	assert.equal(checksSucceeded(["success", "failure"]), false);
});

test("update protocol accepts nixpkgs updateScript metadata", () => {
	assert.deepEqual(
		parseUpdateScript({
			argv: [
				{ drvPath: null, path: "/nix/store/source/packages/foo/update.nu" },
				{ drvPath: null, path: "--stable" },
			],
			attrPath: "foo",
			name: "foo-1.0",
			oldVersion: "1.0",
			pname: "foo",
			sourceRoot: "/nix/store/source",
			supportedFeatures: ["commit"],
		}),
		{
			argv: [
				{ drvPath: null, path: "/nix/store/source/packages/foo/update.nu" },
				{ drvPath: null, path: "--stable" },
			],
			attrPath: "foo",
			name: "foo-1.0",
			oldVersion: "1.0",
			pname: "foo",
			sourceRoot: "/nix/store/source",
			supportedFeatures: ["commit"],
		},
	);
	assert.deepEqual(parseCommitChanges([{ commitMessage: "foo: 1.0 -> 2.0" }]), [
		{ commitBody: null, commitMessage: "foo: 1.0 -> 2.0" },
	]);
});

test("source update scripts run from the writable worktree", () => {
	const script = parseUpdateScript({
		argv: [
			{ drvPath: null, path: "/nix/store/source/packages/foo/update.nu" },
			{ drvPath: null, path: "/nix/store/source/packages/foo/config.json" },
			{ drvPath: null, path: "/nix/store/source" },
		],
		attrPath: "foo",
		name: "foo-1.0",
		oldVersion: "1.0",
		pname: "foo",
		sourceRoot: "/nix/store/source",
		supportedFeatures: [],
	});
	assert.notEqual(script, null);
	if (script !== null) {
		assert.deepEqual(
			worktreeCommand(
				script.argv.map(({ path }) => path),
				script.sourceRoot,
				"/worktree",
			),
			[
				"/worktree/packages/foo/update.nu",
				"/worktree/packages/foo/config.json",
				"/worktree",
			],
		);
	}
});

test("update target and pull request metadata stay compatible with workflow JSON", () => {
	const targets = parseTargets([{ current_version: "1.0", name: "foo" }]);
	assert.deepEqual(targets, [{ currentVersion: "1.0", name: "foo" }]);
	const pullRequest = buildPullRequest("package", "foo", "1.0", "2.0");
	assert.deepEqual(pullRequest, {
		body: "Automated update of `foo` from `1.0` to `2.0`.",
		branch: "automation/update-package-foo",
		commitMessage: "foo: 1.0 -> 2.0",
		title: "foo: 1.0 -> 2.0",
	});
});
