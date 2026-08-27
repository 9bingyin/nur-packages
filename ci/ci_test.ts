import assert from "node:assert/strict";
import test from "node:test";
import {
	dependabotDiffAllowed,
	ownBotDiffAllowed,
	selectCacheMode,
} from "./cache-gate.ts";
import { parseStorePaths } from "./cache-upload.ts";
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
import { packageSetsMatch } from "./lix.ts";
import { pullRequestMatchesCache } from "./merge.ts";
import { validateMergeParents } from "./prepare-pr.ts";
import { checksSucceeded } from "./publish-status.ts";
import {
	reviewBuildCommand,
	reviewMarkdown,
	selectReviewPackages,
} from "./review.ts";
import {
	buildPullRequest,
	parseCommitChanges,
	parseRawDiff,
	parseTarget,
	parseUpdateScript,
	validateChangedFiles,
	worktreeCommand,
} from "./update.ts";

const REVIEW_REVISION = {
	baseBranch: "main",
	baseSha: "1".repeat(40),
	headBranch: "update/foo",
	headRepository: "owner/repository",
	headRepositoryId: 2,
	headSha: "2".repeat(40),
	mergeable: true,
	mergedRepository: "owner/repository",
	mergedSha: "3".repeat(40),
	pullRequestNumber: 1,
	repositoryId: 2,
	repositoryOwnerId: 3,
	runAttempt: 1,
	runId: 4,
	targetSha: "1".repeat(40),
	workflowRef:
		"owner/repository/.github/workflows/pull-request-target.yml@refs/heads/main",
	workflowSha: "4".repeat(40),
} as const;

test("parseSystems validates systems and runners", () => {
	assert.deepEqual(
		parseSystems([{ runner: "ubuntu-latest", system: "x86_64-linux" }]),
		[{ runner: "ubuntu-latest", system: "x86_64-linux" }],
	);
});

test("prepare validates the test merge parents", () => {
	assert.equal(validateMergeParents(["base", "head"], "base", "head"), "base");
	assert.throws(() => validateMergeParents(["head", "base"], "base", "head"));
});

test("cache gate downgrades manually changed bot branches", () => {
	const files = parseRawDiff(
		":100644 100644 1111111 2222222 M\0packages/foo/package.nix\0",
	);
	const pullRequest = {
		baseRef: "main",
		baseSha: "1".repeat(40),
		draft: false,
		headRef: "update/foo",
		headRepository: "owner/repository",
		headRepositoryId: 1,
		headSha: "2".repeat(40),
		mergeCommitSha: "3".repeat(40),
		mergeable: true,
		number: 1,
		state: "open",
		userId: 10,
		userLogin: "updates[bot]",
		userType: "Bot",
	};
	assert.equal(ownBotDiffAllowed("update/foo", files), true);
	assert.equal(selectCacheMode(pullRequest, 1, 10, true, files, ""), "auto");
	assert.equal(selectCacheMode(pullRequest, 1, 10, false, files, ""), "manual");
});

test("dependabot auto mode accepts only full SHA action changes", () => {
	const files = parseRawDiff(
		":100644 100644 1111111 2222222 M\0.github/workflows/docs.yml\0",
	);
	const oldSha = "1".repeat(40);
	const newSha = "2".repeat(40);
	const diff = [
		"diff --git a/.github/workflows/docs.yml b/.github/workflows/docs.yml",
		"index 1111111..2222222 100644",
		"--- a/.github/workflows/docs.yml",
		"+++ b/.github/workflows/docs.yml",
		"@@ -1 +1 @@",
		`-  uses: actions/checkout@${oldSha}`,
		`+  uses: actions/checkout@${newSha}`,
	].join("\n");
	assert.equal(dependabotDiffAllowed(files, diff), true);
	assert.equal(dependabotDiffAllowed(files, diff.replace(newSha, "v7")), false);
});

test("cache uploads accept only Nix store paths", () => {
	const path = `/nix/store/${"a".repeat(32)}-package`;
	assert.deepEqual(parseStorePaths([path]), [path]);
	assert.throws(() => parseStorePaths(["/tmp/package"]));
});

test("merge requires the exact cached revision", () => {
	const expected = {
		baseSha: "1".repeat(40),
		headSha: "2".repeat(40),
		mergedSha: "3".repeat(40),
		number: 1,
	};
	const pullRequest = {
		base: { sha: expected.baseSha },
		draft: false,
		head: { sha: expected.headSha },
		merge_commit_sha: expected.mergedSha,
		mergeable: true,
		number: 1,
		state: "open",
	};
	assert.equal(pullRequestMatchesCache(pullRequest, expected), true);
	assert.equal(
		pullRequestMatchesCache(
			{ ...pullRequest, base: { sha: "4".repeat(40) } },
			expected,
		),
		false,
	);
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
		["package-forge", "flake-input-nixpkgs"],
	);
	assert.deepEqual(matrix.include[0]?.target, {
		current_version: "1.0",
		name: "forge",
	});
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

test("Lix evaluation must match all Nix output paths", () => {
	const result = {
		package: { path: "/nix/store/package", version: "1" },
	};
	assert.equal(packageSetsMatch(result, result, "x86_64-linux"), true);
	assert.equal(
		packageSetsMatch(
			result,
			{ package: { path: "/nix/store/other", version: "1" } },
			"x86_64-linux",
		),
		false,
	);
});

test("eval report combines systems for review", () => {
	const report = combineEvalResults(
		[
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
		],
		REVIEW_REVISION,
	);
	assert.deepEqual(report.added, ["linux-only"]);
	assert.deepEqual(report.changed, ["shared"]);
	assert.equal(evalReportMarkdown(report).includes("`aarch64-darwin`"), true);
});

test("review builds added and changed packages for one system", () => {
	const report = combineEvalResults(
		[
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
		],
		REVIEW_REVISION,
	);
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
		reviewMarkdown({ ...selection, storePaths: [], success: true }).includes(
			"Build | success",
		),
		true,
	);
});

test("checksSucceeded requires every job to succeed", () => {
	assert.equal(checksSucceeded(["success", "success"]), true);
	assert.equal(checksSucceeded(["success", "failure"]), false);
});

test("update patches stay inside the selected package", () => {
	const files = parseRawDiff(
		":100644 100644 1111111 2222222 M\0packages/foo/package.nix\0",
	);
	validateChangedFiles("package", "foo", files);
	assert.throws(() => validateChangedFiles("package", "bar", files));
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
	const target = parseTarget({ current_version: "1.0", name: "foo" });
	assert.deepEqual(target, { currentVersion: "1.0", name: "foo" });
	const pullRequest = buildPullRequest("package", "foo", "1.0", "2.0");
	assert.deepEqual(pullRequest, {
		body: "Automated update of `foo` from `1.0` to `2.0`.",
		branch: "update/foo",
		commitMessage: "foo: 1.0 -> 2.0",
		title: "foo: 1.0 -> 2.0",
	});
});
