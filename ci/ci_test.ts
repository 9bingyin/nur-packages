import assert from "node:assert/strict";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { nixFastBuildCommand } from "./cache.ts";
import {
	buildBatchMatrix,
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
import { parseSystems, requireRecord, run } from "./lib.ts";
import { pullRequestMatchesMerge } from "./merge.ts";
import {
	dependabotDiffAllowed,
	ownBotDiffAllowed,
	selectMergeMode,
} from "./merge-policy.ts";
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
	pushUpdateBranch,
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
		baseSha: "1".repeat(40),
		headRef: "update/foo",
		headRepositoryId: 1,
		headSha: "2".repeat(40),
		number: 1,
	};
	const pullRequest = {
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
		base: { sha: expected.baseSha },
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

test("update checkout preserves parent objects for Nix worktrees", async () => {
	const workflow = requireRecord(
		Bun.YAML.parse(
			readFileSync(
				new URL("../.github/workflows/update.yml", import.meta.url),
				"utf8",
			),
		),
		"Update workflow",
	);
	const jobs = requireRecord(workflow.jobs, "Update jobs");
	const update = requireRecord(jobs.update, "Update job");
	assert.ok(Array.isArray(update.steps));
	const checkout = requireRecord(update.steps[0], "Update checkout");
	const options = requireRecord(checkout.with, "Update checkout options");
	assert.equal(options["persist-credentials"], false);
	const depth = options["fetch-depth"] ?? 1;
	const directory = mkdtempSync(join(tmpdir(), "update-checkout-test-"));
	const source = join(directory, "source");
	const repository = join(directory, "checkout");
	const worktree = join(directory, "worktree");
	mkdirSync(source);
	const git = async (...args: string[]) =>
		run(["git", "-C", source, ...args], {
			capture: true,
			env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
		});
	try {
		await git("init", "--initial-branch=main");
		await git("config", "user.name", "CI");
		await git("config", "user.email", "ci@example.com");
		writeFileSync(join(source, "flake.nix"), "{ outputs = { self }: {}; }\n");
		await git("add", ".");
		await git("commit", "-m", "base");
		const parent = (await git("rev-parse", "HEAD")).stdout.trim();
		writeFileSync(join(source, "other"), "head\n");
		await git("add", ".");
		await git("commit", "-m", "head");
		await run(
			[
				"git",
				"clone",
				...(depth === 0 ? [] : [`--depth=${depth}`]),
				`file://${source}`,
				repository,
			],
			{ capture: true },
		);
		await run(
			[
				"git",
				"-C",
				repository,
				"worktree",
				"add",
				"--detach",
				worktree,
				"HEAD",
			],
			{ capture: true },
		);
		const result = await run(
			["git", "-C", worktree, "cat-file", "-e", parent],
			{ capture: true, check: false },
		);
		assert.equal(
			result.code,
			0,
			`Nix worktree cannot resolve its parent: ${result.stderr}`,
		);
		assert.equal(depth, 0);
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
});

test("update pushes retry server failures without overwriting changed branches", async () => {
	const directory = mkdtempSync(join(tmpdir(), "update-push-test-"));
	const repository = join(directory, "work");
	const remote = join(directory, "remote.git");
	const attempts = join(directory, "attempts");
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
		writeFileSync(join(repository, "package"), "version 1\n");
		await git("add", ".");
		await git("commit", "-m", "base");
		const base = await git("rev-parse", "HEAD");
		const hook = join(remote, "hooks/pre-receive");
		writeFileSync(
			hook,
			`#!/bin/sh\necho attempt >> '${attempts}'\nif [ "$(wc -l < '${attempts}')" -eq 1 ]; then\n  echo 'Internal Server Error' >&2\n  exit 1\nfi\ncat >/dev/null\n`,
		);
		chmodSync(hook, 0o755);
		const uploadPack = join(directory, "upload-pack");
		writeFileSync(
			uploadPack,
			'#!/bin/sh\necho "Service Unavailable" >&2\nexit 1\n',
		);
		chmodSync(uploadPack, 0o755);
		await git("config", "remote.origin.uploadpack", uploadPack);
		await pushUpdateBranch(repository, "update/foo", null);
		await git("config", "--unset", "remote.origin.uploadpack");
		assert.equal(readFileSync(attempts, "utf8").trim().split("\n").length, 2);
		assert.equal(
			(await git("ls-remote", "origin", "refs/heads/update/foo")).split(
				/\s/,
			)[0],
			base,
		);
		writeFileSync(join(repository, "package"), "version 2\n");
		await git("add", ".");
		await git("commit", "-m", "update");
		await pushUpdateBranch(repository, "update/foo", base);
		const head = await git("rev-parse", "HEAD");
		writeFileSync(join(repository, "package"), "version 3\n");
		await git("add", ".");
		await git("commit", "-m", "next update");
		await assert.rejects(
			pushUpdateBranch(repository, "update/foo", base),
			/stale info/,
		);
		await git("checkout", "--detach", base);
		await assert.rejects(
			pushUpdateBranch(repository, "update/foo", null),
			/stale info/,
		);
		assert.equal(
			(await git("ls-remote", "origin", "refs/heads/update/foo")).split(
				/\s/,
			)[0],
			head,
		);
		assert.equal(readFileSync(attempts, "utf8").trim().split("\n").length, 3);
		writeFileSync(
			hook,
			`#!/bin/sh\necho attempt >> '${attempts}'\necho 'permission denied' >&2\nexit 1\n`,
		);
		await assert.rejects(
			pushUpdateBranch(repository, "update/bar", null),
			/permission denied/,
		);
		assert.equal(readFileSync(attempts, "utf8").trim().split("\n").length, 4);
		writeFileSync(
			hook,
			`#!/bin/sh\necho attempt >> '${attempts}'\necho 'Internal Server Error' >&2\nexit 1\n`,
		);
		await assert.rejects(
			pushUpdateBranch(repository, "update/bar", null),
			/Internal Server Error/,
		);
		assert.equal(readFileSync(attempts, "utf8").trim().split("\n").length, 6);
		rmSync(hook);
		const receivePack = join(directory, "receive-pack");
		writeFileSync(
			receivePack,
			`#!/bin/sh\necho attempt >> '${attempts}'\ngit-receive-pack "$@"\necho "Internal Server Error" >&2\nexit 1\n`,
		);
		chmodSync(receivePack, 0o755);
		await git("config", "remote.origin.receivepack", receivePack);
		await pushUpdateBranch(repository, "update/bar", null);
		assert.equal(
			(await git("ls-remote", "origin", "refs/heads/update/bar")).split(
				/\s/,
			)[0],
			base,
		);
		assert.equal(readFileSync(attempts, "utf8").trim().split("\n").length, 7);
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
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
