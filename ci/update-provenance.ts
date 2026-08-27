import { isRecord, requireString } from "./lib.ts";

const PREFIX = "<!-- update-provenance:v1 ";
const SUFFIX = " -->";
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export type UpdateProvenance = Readonly<{
	baseSha: string;
	headSha: string;
	patchSha256: string;
	runAttempt: number;
	runId: number;
	targetName: string;
	targetType: "flake-input" | "package";
}>;

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
	return value;
}

function sha(value: unknown, name: string): string {
	const result = requireString(value, name);
	if (!SHA_PATTERN.test(result)) {
		throw new Error(`${name} must be a full commit SHA`);
	}
	return result;
}

export function formatUpdateProvenance(value: UpdateProvenance): string {
	return `Automated update provenance for \`${value.headSha.slice(0, 12)}\`.\n\n${PREFIX}${JSON.stringify(value)}${SUFFIX}`;
}

export function parseUpdateProvenance(body: unknown): UpdateProvenance | null {
	if (typeof body !== "string") {
		return null;
	}
	const start = body.indexOf(PREFIX);
	const end = body.indexOf(SUFFIX, start + PREFIX.length);
	if (start < 0 || end < 0) {
		return null;
	}
	let value: unknown;
	try {
		value = JSON.parse(body.slice(start + PREFIX.length, end));
	} catch {
		return null;
	}
	if (!isRecord(value)) {
		return null;
	}
	try {
		const patchSha256 = requireString(
			value.patchSha256,
			"update provenance.patchSha256",
		);
		if (!DIGEST_PATTERN.test(patchSha256)) {
			throw new Error("update provenance.patchSha256 must be a SHA-256 digest");
		}
		const targetType = requireString(
			value.targetType,
			"update provenance.targetType",
		);
		if (targetType !== "flake-input" && targetType !== "package") {
			throw new Error("update provenance.targetType is invalid");
		}
		return {
			baseSha: sha(value.baseSha, "update provenance.baseSha"),
			headSha: sha(value.headSha, "update provenance.headSha"),
			patchSha256,
			runAttempt: positiveInteger(
				value.runAttempt,
				"update provenance.runAttempt",
			),
			runId: positiveInteger(value.runId, "update provenance.runId"),
			targetName: requireString(
				value.targetName,
				"update provenance.targetName",
			),
			targetType,
		};
	} catch {
		return null;
	}
}
