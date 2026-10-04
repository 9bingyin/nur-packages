import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";
import { nixFastBuildCommand } from "./cache.ts";
import {
	buildBatchMatrix,
	buildMatrix,
	parseFlakeInputs,
	parsePackageVersions,
	parseUpdateScope,
	targetInScope,
} from "./discovery.ts";
import { combineEvalResults, evalReportMarkdown } from "./eval-compare.ts";
import {
	comparePackages,
	markdownSummary,
	parsePackageSet,
} from "./eval-packages.ts";
import { parseSystems, run } from "./lib.ts";
import { pullRequestMatchesMerge } from "./merge.ts";
import {
	dependabotDiffAllowed,
	ownBotDiffAllowed,
	provenanceDiffAllowed,
	selectMergeMode,
} from "./merge-policy.ts";
import {
	dispatchPrRecheck,
	latestCompletedPrRun,
	parsePrRevision,
	prRunMatches,
	readPrRevision,
	requestedBaseSha,
	shouldRecheck,
	trustedPrRun,
	trustedRevisionArtifact,
} from "./pr-runs.ts";
import { parsePrEvent, validateMergeParents } from "./prepare-pr.ts";
import { checksSucceeded } from "./publish-status.ts";
import {
	reviewBuildCommand,
	reviewMarkdown,
	selectReviewPackages,
} from "./review.ts";
import {
	buildPullRequest,
	existingUpdateMatches,
	flakeInputSnapshot,
	parseCommitChanges,
	parseRawDiff,
	parseTarget,
	parseUpdateScript,
	updateVersionIsValid,
	validateChangedFiles,
	worktreeCommand,
} from "./update.ts";
import {
	parseUpdateBatch,
	updateBatchIsFatal,
	updateBatchSummary,
} from "./update-batch.ts";
import {
	formatUpdateProvenance,
	parseUpdateProvenance,
} from "./update-provenance.ts";
import { automaticRebaseAllowed } from "./update-queue.ts";

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

test("merge policy downgrades manually changed bot branches", () => {
	const files = parseRawDiff(
		":100644 100644 1111111 2222222 M\0packages/foo/package.nix\0",
	);
	const reference = {
		baseRef: "main",
		baseRepositoryId: 1,
		mergeable: true,
		baseSha: "1".repeat(40),
		headRef: "update/foo",
		headRepositoryId: 1,
		headSha: "2".repeat(40),
		number: 1,
	};
	const pullRequest = {
		baseRef: reference.baseRef,
		baseSha: reference.baseSha,
		draft: false,
		headRepositoryId: 1,
		headSha: reference.headSha,
		number: 1,
		state: "open",
		userId: 10,
		userLogin: "updates[bot]",
		userType: "Bot",
	};
	assert.equal(ownBotDiffAllowed("update/foo", files), true);
	assert.equal(
		selectMergeMode(pullRequest, reference, 1, 10, true, files, ""),
		"auto",
	);
	assert.equal(
		selectMergeMode(pullRequest, reference, 1, 10, false, files, ""),
		"manual",
	);
	assert.equal(
		selectMergeMode(
			{ ...pullRequest, baseSha: "3".repeat(40) },
			reference,
			1,
			10,
			true,
			files,
			"",
		),
		"stale",
	);
});

test("update scopes separate weekly nixpkgs from regular updates", () => {
	const targets = [
		{
			currentVersion: "1",
			name: "foo",
			system: "aarch64-darwin",
			type: "package" as const,
		},
		{
			currentVersion: "1",
			name: "nixpkgs",
			system: "x86_64-linux",
			type: "flake-input" as const,
		},
		{
			currentVersion: "1",
			name: "treefmt-nix",
			system: "x86_64-linux",
			type: "flake-input" as const,
		},
	];
	assert.equal(parseUpdateScope(undefined), "regular");
	assert.throws(() => parseUpdateScope("unknown"));
	assert.deepEqual(
		targets
			.filter((target) => targetInScope(target, "regular"))
			.map(({ name }) => name),
		["foo", "treefmt-nix"],
	);
	assert.deepEqual(
		targets
			.filter((target) => targetInScope(target, "nixpkgs"))
			.map(({ name }) => name),
		["nixpkgs"],
	);
	assert.equal(
		targets.filter((target) => targetInScope(target, "all")).length,
		3,
	);
});

test("only nixpkgs may be automatically rebased", () => {
	const provenance = {
		baseSha: "1".repeat(40),
		headSha: "2".repeat(40),
		patchSha256: "3".repeat(64),
		runId: 1,
		runAttempt: 1,
		targetType: "flake-input" as const,
		targetName: "nixpkgs",
	};
	assert.equal(automaticRebaseAllowed(provenance), true);
	assert.equal(
		automaticRebaseAllowed({ ...provenance, targetType: "package" }),
		false,
	);
	assert.equal(
		automaticRebaseAllowed({ ...provenance, targetName: "treefmt-nix" }),
		false,
	);
});

test("PR dispatch binds the requested head and base revisions", () => {
	const inputs = {
		"pull-request-number": "42",
		"head-sha": "1".repeat(40),
		"base-sha": "2".repeat(40),
	};
	assert.deepEqual(parsePrEvent("workflow_dispatch", { inputs }), {
		kind: "dispatch",
		number: 42,
		headSha: inputs["head-sha"],
		baseSha: inputs["base-sha"],
	});
	assert.deepEqual(
		parsePrEvent("pull_request_target", { pull_request: { number: 42 } }),
		{ kind: "pull-request", number: 42 },
	);
	assert.throws(() =>
		parsePrEvent("workflow_dispatch", {
			inputs: { ...inputs, "head-sha": "main" },
		}),
	);
	assert.throws(() =>
		parsePrEvent("workflow_dispatch", {
			inputs: { ...inputs, "base-sha": "main" },
		}),
	);
	assert.throws(() =>
		parsePrEvent("workflow_dispatch", {
			inputs: { ...inputs, "pull-request-number": "0" },
		}),
	);
	assert.throws(() => parsePrEvent("push", {}));
});

const PR_REVISION = {
	baseRef: "main",
	baseSha: "1".repeat(40),
	headRef: "update/foo",
	headRepositoryId: 1,
	headSha: "2".repeat(40),
	mergeable: true,
	number: 42,
	repositoryId: 1,
	runId: 100,
	runAttempt: 1,
} as const;

test("base advancement rechecks a package without changing its head", () => {
	const original = parsePrRevision(PR_REVISION);
	const newBase = "3".repeat(40);
	assert.equal(shouldRecheck(original, newBase, original.headSha), true);
	const rechecked = { ...original, baseSha: newBase };
	assert.equal(shouldRecheck(rechecked, newBase, original.headSha), false);
	assert.equal(shouldRecheck(original, newBase, "4".repeat(40)), false);
	assert.equal(
		shouldRecheck(rechecked, "5".repeat(40), original.headSha),
		true,
	);
	assert.throws(() => parsePrRevision({ ...original, runAttempt: 0 }));
	assert.throws(() => parsePrRevision({ ...original, baseSha: "main" }));
});

test("recheck scheduling waits for active checks and identifies dispatched runs", () => {
	const completed = {
		display_title: `PR #42 @ ${PR_REVISION.headSha} / ${PR_REVISION.baseSha}`,
		event: "workflow_dispatch",
		head_branch: "main",
		head_sha: PR_REVISION.baseSha,
		status: "completed",
		conclusion: "success",
	};
	const active = { ...completed, status: "in_progress" };
	assert.equal(
		prRunMatches(completed, 42, "update/foo", PR_REVISION.headSha),
		true,
	);
	assert.equal(
		prRunMatches(completed, 43, "update/foo", PR_REVISION.headSha),
		false,
	);
	assert.equal(
		prRunMatches(completed, 42, "update/foo", "9".repeat(40)),
		false,
	);
	assert.equal(requestedBaseSha(completed), PR_REVISION.baseSha);
	assert.equal(
		latestCompletedPrRun(
			[active, completed],
			42,
			"update/foo",
			PR_REVISION.headSha,
		),
		null,
	);
	assert.equal(
		latestCompletedPrRun([completed], 42, "update/foo", PR_REVISION.headSha),
		completed,
	);
	assert.equal(
		latestCompletedPrRun([], 42, "update/foo", PR_REVISION.headSha),
		null,
	);
});

test("checked revisions come only from the trusted workflow and prepare job", () => {
	const workflow = {
		path: ".github/workflows/pull-request-target.yml",
		event: "workflow_dispatch",
		repository: { id: 1 },
	};
	assert.equal(trustedPrRun(workflow, 1), true);
	assert.equal(trustedPrRun({ ...workflow, event: "pull_request" }, 1), false);
	assert.equal(
		trustedPrRun({ ...workflow, path: ".github/workflows/untrusted.yml" }, 1),
		false,
	);
	assert.equal(trustedPrRun(workflow, 2), false);
	const prepare = {
		name: "prepare",
		conclusion: "success",
		started_at: "2026-10-01T00:00:00Z",
		completed_at: "2026-10-01T00:01:00Z",
	};
	const artifact = { expired: false, created_at: "2026-10-01T00:00:30Z" };
	assert.equal(trustedRevisionArtifact(artifact, prepare), true);
	assert.equal(
		trustedRevisionArtifact(
			{ ...artifact, created_at: "2026-10-01T00:02:00Z" },
			prepare,
		),
		false,
	);
	assert.equal(
		trustedRevisionArtifact({ ...artifact, expired: true }, prepare),
		false,
	);
	assert.equal(
		trustedRevisionArtifact(artifact, { ...prepare, conclusion: "failure" }),
		false,
	);
});

test("fresh rechecks validate provenance against the original update base", () => {
	const patch = "trusted package update";
	const files = parseRawDiff(
		":100644 100644 1111111 2222222 M\0packages/foo/package.nix\0",
	);
	const provenance = {
		baseSha: "6".repeat(40),
		headSha: PR_REVISION.headSha,
		patchSha256: createHash("sha256").update(patch).digest("hex"),
		targetName: "foo",
		targetType: "package" as const,
		runId: 1,
		runAttempt: 1,
	};
	assert.equal(
		provenanceDiffAllowed(provenance, "update/foo", patch, files),
		true,
	);
	assert.equal(
		provenanceDiffAllowed(provenance, "update/foo", `${patch} changed`, files),
		false,
	);
	assert.equal(
		provenanceDiffAllowed(provenance, "update/bar", patch, files),
		false,
	);
	assert.equal(
		provenanceDiffAllowed(
			{ ...provenance, targetName: "bar" },
			"update/bar",
			patch,
			files,
		),
		false,
	);
	const pullRequest = {
		baseRef: PR_REVISION.baseRef,
		baseSha: PR_REVISION.baseSha,
		headSha: PR_REVISION.headSha,
		headRepositoryId: 1,
		number: 42,
		draft: false,
		state: "open",
		userId: 10,
		userLogin: "updates[bot]",
		userType: "Bot",
	};
	assert.equal(
		selectMergeMode(pullRequest, PR_REVISION, 1, 10, true, files, ""),
		"auto",
	);
	assert.equal(
		selectMergeMode(
			{ ...pullRequest, baseSha: "3".repeat(40) },
			PR_REVISION,
			1,
			10,
			true,
			files,
			"",
		),
		"stale",
	);
	assert.equal(
		selectMergeMode(
			pullRequest,
			{ ...PR_REVISION, mergeable: false },
			1,
			10,
			true,
			files,
			"",
		),
		"manual",
	);
});

test("flake input comparisons ignore updates to unrelated and followed inputs", () => {
	const lock = {
		nodes: {
			root: { inputs: { nixpkgs: "nixpkgs", tool: "tool" } },
			nixpkgs: { locked: { rev: "old" } },
			tool: {
				locked: { rev: "tool-old" },
				inputs: { nixpkgs: ["nixpkgs"], dependency: "dep" },
			},
			dep: { locked: { rev: "dep-old" } },
		},
	};
	const nixpkgsChanged = {
		nodes: { ...lock.nodes, nixpkgs: { locked: { rev: "new" } } },
	};
	assert.equal(
		flakeInputSnapshot(lock, "tool"),
		flakeInputSnapshot(nixpkgsChanged, "tool"),
	);
	assert.notEqual(
		flakeInputSnapshot(lock, "nixpkgs"),
		flakeInputSnapshot(nixpkgsChanged, "nixpkgs"),
	);
	assert.notEqual(
		flakeInputSnapshot(lock, "tool"),
		flakeInputSnapshot(
			{ nodes: { ...lock.nodes, dep: { locked: { rev: "dep-new" } } } },
			"tool",
		),
	);
	assert.throws(() => flakeInputSnapshot(lock, "missing"));
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

test("nix-fast-build scans every uncached package", () => {
	const command = nixFastBuildCommand(
		".",
		"x86_64-linux",
		"cache-x86_64-linux.json",
		"https://niks3.example.com",
	);
	assert.equal(command.includes("--skip-cached"), true);
	assert.equal(command.includes("--niks3-server"), true);
	assert.equal(command.includes("#packages.x86_64-linux"), false);
	assert.equal(
		command.some((argument) => argument.endsWith("#packages.x86_64-linux")),
		true,
	);
});

test("merge requires the exact reviewed revision", () => {
	const expected = {
		baseRef: "main",
		baseSha: "1".repeat(40),
		headSha: "2".repeat(40),
		number: 1,
	};
	const pullRequest = {
		base: { ref: expected.baseRef, sha: expected.baseSha },
		draft: false,
		head: { sha: expected.headSha },
		number: 1,
		state: "open",
	};
	assert.equal(
		pullRequestMatchesMerge(pullRequest, expected, expected.baseSha),
		true,
	);
	assert.equal(
		pullRequestMatchesMerge(
			{ ...pullRequest, base: { ...pullRequest.base, ref: "other" } },
			expected,
			expected.baseSha,
		),
		false,
	);
	assert.equal(
		pullRequestMatchesMerge(pullRequest, expected, "4".repeat(40)),
		false,
	);
	assert.equal(
		pullRequestMatchesMerge(
			{ ...pullRequest, base: { sha: "4".repeat(40) } },
			expected,
			expected.baseSha,
		),
		false,
	);
	assert.equal(
		pullRequestMatchesMerge(
			{ ...pullRequest, head: { sha: "4".repeat(40) } },
			expected,
			expected.baseSha,
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
	assert.throws(
		() => parseFlakeInputs({ nodes: { root: { inputs: {} } } }, ["missing"]),
		/Flake input missing was not found/,
	);
	const batches = buildBatchMatrix(matrix);
	assert.deepEqual(
		batches.include.map(({ group, targets }) => [group, targets.length]),
		[["x86_64-linux", 2]],
	);
	assert.equal(parseUpdateBatch(batches.include[0]?.targets).length, 2);
});

test("update batch fails when any target fails", () => {
	assert.equal(updateBatchIsFatal(0), false);
	assert.equal(updateBatchIsFatal(1), true);
	assert.equal(updateBatchIsFatal(2), true);
});

test("update batch summary reports the failed targets", () => {
	assert.equal(
		updateBatchSummary([], 2),
		"Update batch: 2/2 targets succeeded.\n",
	);
	const summary = updateBatchSummary(
		["package-foo: boom", "package-bar: bang"],
		3,
	);
	assert.match(summary, /^Update batch: 1\/3 targets succeeded\.$/m);
	assert.match(summary, /package-foo: boom/);
	assert.match(summary, /package-bar: bang/);
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
		reviewMarkdown({ ...selection, success: true }).includes("Build | success"),
		true,
	);
});

test("checksSucceeded requires every job to succeed", () => {
	assert.equal(checksSucceeded(["success", "success"]), true);
	assert.equal(checksSucceeded(["success", "failure"]), false);
});

test("update provenance binds the exact base and head revisions", () => {
	const provenance = {
		baseSha: "1".repeat(40),
		headSha: "2".repeat(40),
		patchSha256: "3".repeat(64),
		runAttempt: 1,
		runId: 2,
		targetName: "package",
		targetType: "package" as const,
	};
	assert.deepEqual(
		parseUpdateProvenance(formatUpdateProvenance(provenance)),
		provenance,
	);
	assert.equal(parseUpdateProvenance("manual comment"), null);
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

test("same-version updates allow nix-update and require metadata from custom scripts", () => {
	const internalUpdate = [
		{
			commitBody: "Update bundled service.",
			commitMessage: "foo: update bundled service",
		},
	];
	assert.equal(updateVersionIsValid("1.0", "1.0", true, []), true);
	assert.equal(updateVersionIsValid("1.0", "1.0", true, internalUpdate), true);
	assert.equal(
		updateVersionIsValid("1.0", "1.0", false, internalUpdate),
		false,
	);
	for (const commitMessage of [null, "", "  "]) {
		assert.equal(
			updateVersionIsValid("1.0", "1.0", true, [
				{ commitBody: "Update bundled service.", commitMessage },
			]),
			false,
		);
	}
	assert.equal(
		updateVersionIsValid("1.0", "unknown", true, internalUpdate),
		false,
	);
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

test("unchanged open updates are not rebased by the periodic publisher", async () => {
	const directory = mkdtempSync(join(tmpdir(), "update-match-test-"));
	const repository = join(directory, "work");
	const remote = join(directory, "remote.git");
	mkdirSync(repository);
	const git = async (...args: string[]) =>
		(
			await run(["git", "-C", repository, ...args], {
				capture: true,
				env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
			})
		).stdout.trim();
	try {
		await git("init", "--initial-branch=main");
		await git("config", "user.name", "CI");
		await git("config", "user.email", "ci@example.com");
		await git("config", "commit.gpgsign", "false");
		await git("config", "core.hooksPath", "/dev/null");
		await run(["git", "init", "--bare", remote], { capture: true });
		await git("remote", "add", "origin", remote);
		mkdirSync(join(repository, "packages/foo"), { recursive: true });
		const packagePath = join(repository, "packages/foo/package.nix");
		const lock = {
			nodes: {
				root: { inputs: { nixpkgs: "nixpkgs", tool: "tool" } },
				nixpkgs: { locked: { rev: "old" } },
				tool: { locked: { rev: "tool" }, inputs: { nixpkgs: ["nixpkgs"] } },
			},
		};
		writeFileSync(packagePath, "version 1\nhash old\n");
		writeFileSync(join(repository, "flake.lock"), JSON.stringify(lock));
		await git("add", ".");
		await git("commit", "-m", "base");
		await git("checkout", "-b", "update/foo");
		writeFileSync(packagePath, "version 2\nhash new\n");
		await git("add", ".");
		await git("commit", "-m", "foo update");
		const head = await git("rev-parse", "HEAD");
		await git("push", "origin", "HEAD:refs/heads/update/foo");
		await git("checkout", "main");
		writeFileSync(join(repository, "unrelated"), "another merged update");
		writeFileSync(
			join(repository, "flake.lock"),
			JSON.stringify({
				nodes: { ...lock.nodes, nixpkgs: { locked: { rev: "new" } } },
			}),
		);
		await git("add", ".");
		await git("commit", "-m", "advance main");
		writeFileSync(packagePath, "version 2\nhash new\n");
		await git("add", ".");
		assert.equal(
			await existingUpdateMatches(repository, head, {
				type: "package",
				name: "foo",
			}),
			true,
		);
		assert.equal(
			await existingUpdateMatches(repository, head, {
				type: "flake-input",
				name: "tool",
			}),
			true,
		);
		assert.equal(
			await existingUpdateMatches(repository, head, {
				type: "flake-input",
				name: "nixpkgs",
			}),
			false,
		);
		writeFileSync(packagePath, "version 2\nhash newer-component\n");
		await git("add", ".");
		assert.equal(
			await existingUpdateMatches(repository, head, {
				type: "package",
				name: "foo",
			}),
			false,
		);
		assert.equal(
			(await git("ls-remote", "origin", "refs/heads/update/foo")).split(
				/\s/,
			)[0],
			head,
		);
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
});

test("revision artifacts bind the checked base, run and attempt", async () => {
	const directory = mkdtempSync(join(tmpdir(), "revision-test-"));
	const archive = join(directory, "revision.zip");
	const oldToken = process.env.GH_TOKEN;
	const oldActionsToken = process.env.GH_ACTIONS_TOKEN;
	const oldRepository = process.env.GITHUB_REPOSITORY;
	let created = "2026-10-01T00:00:30Z";
	let available = true;
	let dispatched = 0;
	process.env.GH_TOKEN = "test-only";
	process.env.GH_ACTIONS_TOKEN = "test-actions-only";
	process.env.GITHUB_REPOSITORY = "owner/repository";
	const originalFetch = globalThis.fetch;
	globalThis.fetch = Object.assign(
		async (
			input: Parameters<typeof fetch>[0],
			init?: Parameters<typeof fetch>[1],
		) => {
			const url = String(input);
			assert.equal(
				new Headers(init?.headers).get("Authorization"),
				"Bearer test-actions-only",
			);
			if (url.endsWith("/dispatches")) {
				assert.equal(init?.method, "POST");
				assert.deepEqual(JSON.parse(String(init?.body)), {
					ref: "main",
					inputs: {
						"pull-request-number": "42",
						"head-sha": PR_REVISION.headSha,
						"base-sha": PR_REVISION.baseSha,
					},
				});
				dispatched += 1;
				return new Response(null, { status: 204 });
			}
			if (url.includes("/artifacts?") && !available)
				return Response.json({ artifacts: [] });
			if (url.includes("/artifacts?"))
				return Response.json({
					artifacts: [
						{
							id: 1,
							name: "pr-revision-1",
							expired: false,
							created_at: created,
						},
					],
				});
			if (url.includes("/attempts/1/jobs"))
				return Response.json({
					jobs: [
						{
							name: "prepare",
							conclusion: "success",
							started_at: "2026-10-01T00:00:00Z",
							completed_at: "2026-10-01T00:01:00Z",
						},
					],
				});
			if (url.endsWith("/artifacts/1/zip"))
				return new Response(new Uint8Array(readFileSync(archive)));
			throw new Error(`Unexpected request: ${url}`);
		},
		{ preconnect: originalFetch.preconnect },
	);
	try {
		writeFileSync(
			join(directory, "pr-revision.json"),
			JSON.stringify(PR_REVISION),
		);
		await run(["zip", "-q", archive, "pr-revision.json"], {
			cwd: directory,
			capture: true,
		});
		assert.deepEqual(await readPrRevision(100, 1, 1), PR_REVISION);
		await dispatchPrRecheck(
			42,
			"main",
			PR_REVISION.baseSha,
			PR_REVISION.headSha,
		);
		assert.equal(dispatched, 1);
		await assert.rejects(readPrRevision(100, 1, 2), /does not match/);
		created = "2026-10-01T00:02:00Z";
		await assert.rejects(readPrRevision(100, 1, 1), /trusted prepare/);
		available = false;
		assert.equal(await readPrRevision(100, 1, 1), null);
	} finally {
		globalThis.fetch = originalFetch;
		if (oldToken === undefined) delete process.env.GH_TOKEN;
		else process.env.GH_TOKEN = oldToken;
		if (oldActionsToken === undefined) delete process.env.GH_ACTIONS_TOKEN;
		else process.env.GH_ACTIONS_TOKEN = oldActionsToken;
		if (oldRepository === undefined) delete process.env.GITHUB_REPOSITORY;
		else process.env.GITHUB_REPOSITORY = oldRepository;
		rmSync(directory, { force: true, recursive: true });
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
	assert.deepEqual(buildPullRequest("package", "foo", "1.0", "1.0"), {
		body: "Automated refresh of `foo` at version `1.0`.",
		branch: "update/foo",
		commitMessage: "foo: refresh 1.0",
		title: "foo: refresh 1.0",
	});
});
