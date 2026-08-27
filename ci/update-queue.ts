import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
	githubRepository,
	githubRequest,
	githubRequestPages,
} from "./github.ts";
import { isRecord, requiredEnvironment, requireRecord, run } from "./lib.ts";
import { ownBotDiffAllowed } from "./merge-policy.ts";
import { parseRawDiff } from "./update.ts";
import {
	formatUpdateProvenance,
	parseUpdateProvenance,
	type UpdateProvenance,
} from "./update-provenance.ts";

type QueueCandidate = Readonly<{
	branch: string;
	commentId: number;
	headSha: string;
	number: number;
	provenance: UpdateProvenance;
}>;

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
	return value;
}

function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

async function provenanceComment(
	pullRequest: number,
	headSha: string,
	botUserId: number,
): Promise<Readonly<{ id: number; provenance: UpdateProvenance }> | null> {
	const comments = await githubRequestPages(
		`/repos/${githubRepository()}/issues/${pullRequest}/comments`,
	);
	for (const item of comments) {
		if (!isRecord(item) || !isRecord(item.user)) {
			continue;
		}
		const provenance = parseUpdateProvenance(item.body);
		if (
			item.user.id === botUserId &&
			provenance?.headSha === headSha &&
			Number.isInteger(item.id) &&
			typeof item.id === "number"
		) {
			return { id: item.id, provenance };
		}
	}
	return null;
}

async function queueCandidates(
	baseBranch: string,
	botUserId: number,
	repositoryId: number,
): Promise<readonly QueueCandidate[]> {
	const pulls = await githubRequestPages(
		`/repos/${githubRepository()}/pulls?state=open&base=${encodeURIComponent(baseBranch)}`,
	);
	const candidates: QueueCandidate[] = [];
	for (const item of pulls) {
		if (!isRecord(item) || !isRecord(item.user) || !isRecord(item.head)) {
			continue;
		}
		const headRepository = isRecord(item.head.repo) ? item.head.repo : {};
		const number = item.number;
		const headSha = item.head.sha;
		const branch = item.head.ref;
		if (
			!Number.isInteger(number) ||
			typeof number !== "number" ||
			number <= 0 ||
			item.draft !== false ||
			item.user.id !== botUserId ||
			item.user.type !== "Bot" ||
			headRepository.id !== repositoryId ||
			typeof headSha !== "string" ||
			typeof branch !== "string" ||
			!branch.startsWith("update/")
		) {
			continue;
		}
		const comment = await provenanceComment(number, headSha, botUserId);
		if (comment && branch === `update/${comment.provenance.targetName}`) {
			candidates.push({
				branch,
				commentId: comment.id,
				headSha,
				number,
				provenance: comment.provenance,
			});
		}
	}
	return candidates.sort((left, right) => left.number - right.number);
}

async function currentBaseSha(
	repository: string,
	baseBranch: string,
): Promise<string> {
	await run(["git", "-C", repository, "fetch", "origin", baseBranch]);
	return (
		await run(["git", "-C", repository, "rev-parse", `origin/${baseBranch}`], {
			capture: true,
		})
	).stdout.trim();
}

async function validatedPatch(
	repository: string,
	candidate: QueueCandidate,
): Promise<string> {
	await run([
		"git",
		"-C",
		repository,
		"fetch",
		"--no-tags",
		"origin",
		candidate.provenance.baseSha,
		candidate.headSha,
	]);
	const raw = await run(
		[
			"git",
			"-C",
			repository,
			"diff",
			"--raw",
			"-z",
			"--no-renames",
			candidate.provenance.baseSha,
			candidate.headSha,
		],
		{ capture: true },
	);
	if (!ownBotDiffAllowed(candidate.branch, parseRawDiff(raw.stdout))) {
		throw new Error(`Pull request #${candidate.number} has an unsafe diff`);
	}
	const patch = (
		await run(
			[
				"git",
				"-C",
				repository,
				"diff",
				"--binary",
				"--full-index",
				"--no-renames",
				candidate.provenance.baseSha,
				candidate.headSha,
			],
			{ capture: true },
		)
	).stdout;
	if (sha256(patch) !== candidate.provenance.patchSha256) {
		throw new Error(`Pull request #${candidate.number} patch digest changed`);
	}
	return patch;
}

async function refreshCandidate(
	repository: string,
	candidate: QueueCandidate,
	baseSha: string,
): Promise<void> {
	const patch = await validatedPatch(repository, candidate);
	const temporary = mkdtempSync(join(tmpdir(), "update-refresh-"));
	const patchPath = join(temporary, "changes.patch");
	const messagePath = join(temporary, "message");
	try {
		writeFileSync(patchPath, patch);
		const message = (
			await run(
				[
					"git",
					"-C",
					repository,
					"show",
					"-s",
					"--format=%B",
					candidate.headSha,
				],
				{ capture: true },
			)
		).stdout;
		writeFileSync(messagePath, message);
		await run(["git", "-C", repository, "reset", "--hard"]);
		await run(["git", "-C", repository, "clean", "-ffdx"]);
		await run(["git", "-C", repository, "checkout", "--detach", baseSha]);
		await run([
			"git",
			"-C",
			repository,
			"apply",
			"--index",
			"--binary",
			patchPath,
		]);
		const raw = await run(
			[
				"git",
				"-C",
				repository,
				"diff",
				"--cached",
				"--raw",
				"-z",
				"--no-renames",
				baseSha,
			],
			{ capture: true },
		);
		if (!ownBotDiffAllowed(candidate.branch, parseRawDiff(raw.stdout))) {
			throw new Error(`Refreshed pull request #${candidate.number} is unsafe`);
		}
		await run(["git", "-C", repository, "checkout", "-B", candidate.branch]);
		await run(["git", "-C", repository, "commit", "-F", messagePath]);
		await run([
			"git",
			"-C",
			repository,
			"push",
			`--force-with-lease=refs/heads/${candidate.branch}:${candidate.headSha}`,
			"origin",
			`HEAD:refs/heads/${candidate.branch}`,
		]);
		const headSha = (
			await run(["git", "-C", repository, "rev-parse", "HEAD"], {
				capture: true,
			})
		).stdout.trim();
		const refreshedPatch = (
			await run(
				[
					"git",
					"-C",
					repository,
					"diff",
					"--binary",
					"--full-index",
					"--no-renames",
					baseSha,
					headSha,
				],
				{ capture: true },
			)
		).stdout;
		await githubRequest(
			`/repos/${githubRepository()}/issues/comments/${candidate.commentId}`,
			{
				body: {
					body: formatUpdateProvenance({
						...candidate.provenance,
						baseSha,
						headSha,
						patchSha256: sha256(refreshedPatch),
						runAttempt: positiveInteger(
							Number(process.env.GITHUB_RUN_ATTEMPT),
							"GITHUB_RUN_ATTEMPT",
						),
						runId: positiveInteger(
							Number(process.env.GITHUB_RUN_ID),
							"GITHUB_RUN_ID",
						),
					}),
				},
				method: "PATCH",
			},
		);
		console.log(`Refreshed update PR #${candidate.number} to ${baseSha}`);
	} finally {
		rmSync(temporary, { force: true, recursive: true });
	}
}

export async function refreshUpdateQueue(): Promise<void> {
	requiredEnvironment("GH_TOKEN");
	const repository = requiredEnvironment("CANDIDATE_REPOSITORY");
	const baseBranch = requiredEnvironment("BASE_BRANCH");
	const botUserId = positiveInteger(
		Number(requiredEnvironment("AUTOMATION_BOT_USER_ID")),
		"AUTOMATION_BOT_USER_ID",
	);
	const repositoryRecord = requireRecord(
		await githubRequest(`/repos/${githubRepository()}`),
		"repository",
	);
	const repositoryId = positiveInteger(repositoryRecord.id, "repository.id");
	const baseSha = await currentBaseSha(repository, baseBranch);
	const candidate = (
		await queueCandidates(baseBranch, botUserId, repositoryId)
	)[0];
	if (candidate === undefined) {
		console.log("No automated update PR is waiting");
		return;
	}
	if (candidate.provenance.baseSha === baseSha) {
		console.log(
			`Update PR #${candidate.number} is already based on current main`,
		);
		return;
	}
	await refreshCandidate(repository, candidate, baseSha);
}
