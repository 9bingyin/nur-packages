#!/usr/bin/env nix
/*
#!nix shell nixpkgs#bun --command bun
*/
/** Update Termius from the official appcast and archive its arm64 macOS ZIP. */

import { createHash } from "node:crypto";
import { join } from "node:path";
import process from "node:process";

const APPCAST_URL = "https://autoupdate.termius.com/mac-arm64/latest-mac.yml";
const SOURCE_URL = "https://autoupdate.termius.com/mac-arm64/Termius.zip";
const SPN2_SAVE_URL = "https://web.archive.org/save";
const SPN2_STATUS_URL = "https://web.archive.org/save/status";
const CDX_API_URL = "https://web.archive.org/cdx/search/cdx";
const PACKAGE_PATH = join(import.meta.dir, "package.nix");
const USER_AGENT = "nur-packages (+https://github.com/9bingyin/nur-packages)";
const HTTP_RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_HTTP_RETRIES = 2;
const CAPTURE_TIMEOUT_SECONDS = 600;
const REPLAY_POLL_SECONDS = 20;

class SkipUpdate extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SkipUpdate";
	}
}

class RateLimited extends SkipUpdate {
	constructor(message: string) {
		super(message);
		this.name = "RateLimited";
	}
}

class ReplayNotReady extends SkipUpdate {
	constructor(message: string) {
		super(message);
		this.name = "ReplayNotReady";
	}
}

class HttpStatusError extends Error {
	readonly retryAfter: string | null;
	readonly status: number;

	constructor(status: number, retryAfter: string | null) {
		super(`HTTP ${status}`);
		this.name = "HTTPError";
		this.retryAfter = retryAfter;
		this.status = status;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorName(error: unknown): string {
	return error instanceof Error ? error.name : "Error";
}

function redact(message: string): string {
	let redacted = message;
	for (const name of [
		"INTERNET_ARCHIVE_ACCESS_KEY",
		"INTERNET_ARCHIVE_SECRET_KEY",
	]) {
		const value = process.env[name];
		if (value !== undefined && value.length > 0) {
			redacted = redacted.replaceAll(value, "<REDACTED>");
		}
	}
	return redacted.split(/\s+/).join(" ").slice(0, 500);
}

function log(message: string): void {
	console.error(`termius: ${redact(message)}`);
}

function requiredEnvironment(name: string): string {
	const value = process.env[name];
	if (value === undefined || value.length === 0) {
		throw new Error(`${name} must be set`);
	}
	return value;
}

function archiveHeaders(): Record<string, string> {
	return {
		Accept: "application/json",
		Authorization: `LOW ${requiredEnvironment("INTERNET_ARCHIVE_ACCESS_KEY")}:${requiredEnvironment("INTERNET_ARCHIVE_SECRET_KEY")}`,
		"User-Agent": USER_AGENT,
	};
}

function sleep(seconds: number): Promise<void> {
	return Bun.sleep(Math.max(0, seconds) * 1000);
}

function retryAfterSeconds(raw: string | null, fallback: number): number {
	if (raw === null) {
		return fallback;
	}
	const trimmed = raw.trim();
	if (/^[0-9]+(?:\.[0-9]+)?$/.test(trimmed)) {
		const delay = Number(trimmed);
		return Number.isFinite(delay) ? Math.max(fallback, delay) : fallback;
	}
	const date = Date.parse(trimmed);
	if (Number.isNaN(date)) {
		return fallback;
	}
	const delay = (date - Date.now()) / 1000;
	return Number.isFinite(delay) ? Math.max(fallback, delay) : fallback;
}

async function readUrl(url: string, timeout = 30): Promise<string> {
	const response = await fetch(url, {
		headers: { "User-Agent": USER_AGENT },
		signal: AbortSignal.timeout(timeout * 1000),
	});
	if (!response.ok) {
		throw new HttpStatusError(
			response.status,
			response.headers.get("Retry-After"),
		);
	}
	return response.text();
}

function latestRelease(appcast: string): readonly [string, string] {
	const lines = appcast.split(/\r?\n/);
	const versions = lines.flatMap((line) => {
		const version = /^version:\s*([0-9]+(?:\.[0-9]+)+)$/.exec(line)?.[1];
		return version === undefined ? [] : [version];
	});
	if (versions.length !== 1 || versions[0] === undefined) {
		throw new Error("Termius appcast has no unique valid version");
	}

	const digests: string[] = [];
	for (const [index, line] of lines.slice(0, -1).entries()) {
		if (!/^\s*-\s+url:\s*Termius\.zip\s*$/.test(line)) {
			continue;
		}
		const digest = /^\s+sha512:\s*([A-Za-z0-9+/]+={0,2})\s*$/.exec(
			lines[index + 1] ?? "",
		)?.[1];
		if (digest !== undefined) {
			digests.push(digest);
		}
	}
	if (digests.length !== 1 || digests[0] === undefined) {
		throw new Error("Termius appcast has no unique ZIP SHA-512 digest");
	}
	const digest = digests[0];
	const decoded = Buffer.from(digest, "base64");
	if (decoded.length !== 64 || decoded.toString("base64") !== digest) {
		throw new Error("Termius appcast has an invalid ZIP SHA-512 digest");
	}
	return [versions[0], `sha512-${digest}`];
}

function waybackUrl(timestamp: string): string {
	return `https://web.archive.org/web/${timestamp}if_/${SOURCE_URL}`;
}

function jsonObject(raw: Uint8Array): Record<string, unknown> {
	let payload: unknown;
	try {
		payload = JSON.parse(Buffer.from(raw).toString("utf8"));
	} catch {
		throw new SkipUpdate("Wayback Machine returned a non-JSON response");
	}
	if (!isRecord(payload)) {
		throw new SkipUpdate("Wayback Machine returned a non-object JSON payload");
	}
	return payload;
}

async function requestBytes(
	url: string,
	options: {
		authenticated?: boolean;
		data?: string;
		timeout?: number;
	} = {},
): Promise<Uint8Array> {
	const authenticated = options.authenticated ?? false;
	const timeout = options.timeout ?? 60;
	const headers = authenticated
		? archiveHeaders()
		: { "User-Agent": USER_AGENT };
	headers.Accept = "application/json";
	if (options.data !== undefined) {
		headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
	}

	for (let attempt = 0; attempt < MAX_HTTP_RETRIES; attempt += 1) {
		let delay = 5;
		let rateLimited = false;
		let reason = "";
		let retryable = false;
		try {
			const response = await fetch(url, {
				headers,
				method: options.data === undefined ? "GET" : "POST",
				redirect: authenticated ? "manual" : "follow",
				signal: AbortSignal.timeout(timeout * 1000),
				...(options.data === undefined ? {} : { body: options.data }),
			});
			if (response.status < 200 || response.status >= 300) {
				const status = response.status;
				const retryAfter = response.headers.get("Retry-After");
				await response.body?.cancel();
				throw new HttpStatusError(status, retryAfter);
			}
			return new Uint8Array(await response.arrayBuffer());
		} catch (error) {
			if (error instanceof HttpStatusError) {
				if (authenticated && (error.status === 401 || error.status === 403)) {
					throw new Error(
						`Wayback API credentials rejected (HTTP ${error.status})`,
					);
				}
				retryable =
					options.data === undefined
						? HTTP_RETRY_STATUSES.has(error.status)
						: error.status === 429;
				delay = retryAfterSeconds(error.retryAfter, delay);
				reason = `HTTP ${error.status} from ${url}`;
				rateLimited = error.status === 429;
			} else {
				retryable = options.data === undefined;
				reason = `${errorName(error)} from ${url}`;
			}
		}
		if (!retryable || attempt === MAX_HTTP_RETRIES - 1 || delay > 60) {
			if (options.data !== undefined) {
				reason +=
					"; capture not confirmed; checking existing captures instead of resubmitting";
			}
			if (rateLimited) {
				throw new RateLimited(reason);
			}
			throw new SkipUpdate(reason);
		}
		log(`${reason}; retrying read/request after ${delay}s`);
		await sleep(delay);
	}
	throw new SkipUpdate(`Wayback request failed: ${url}`);
}

async function requestJson(
	url: string,
	options: { data?: string; timeout: number },
): Promise<Record<string, unknown>> {
	return jsonObject(
		await requestBytes(url, {
			authenticated: true,
			...(options.data === undefined ? {} : { data: options.data }),
			timeout: options.timeout,
		}),
	);
}

function captureError(payload: Record<string, unknown>): string {
	const code = payload.status_ext ?? "unknown";
	const message = payload.message ?? payload.exception ?? "no details";
	return redact(`${String(code)}: ${String(message)}`);
}

function captureTimestamp(payload: Record<string, unknown>): string {
	const timestamp = payload.timestamp;
	if (typeof timestamp !== "string" || !/^[0-9]{14}$/.test(timestamp)) {
		throw new SkipUpdate("Wayback Machine returned no valid capture timestamp");
	}
	if ((payload.original_url ?? SOURCE_URL) !== SOURCE_URL) {
		throw new SkipUpdate("Wayback Machine captured a different source URL");
	}
	return timestamp;
}

async function saveSnapshot(): Promise<string> {
	const capture = await requestJson(SPN2_SAVE_URL, {
		data: new URLSearchParams({
			force_get: "1",
			js_behavior_timeout: "0",
			skip_first_archive: "1",
			url: SOURCE_URL,
		}).toString(),
		timeout: 120,
	});
	if (capture.status === "error") {
		throw new SkipUpdate(`capture refused (${captureError(capture)})`);
	}
	if (capture.status === "success") {
		return captureTimestamp(capture);
	}
	const jobId = capture.job_id;
	if (typeof jobId !== "string" || !/^[A-Za-z0-9-]{1,100}$/.test(jobId)) {
		throw new SkipUpdate(`no capture job started (${captureError(capture)})`);
	}
	log(`submitted capture job ${jobId}`);

	const deadline = performance.now() + CAPTURE_TIMEOUT_SECONDS * 1000;
	let delay = 5;
	let lastError = "still pending";
	while (performance.now() < deadline) {
		await sleep(
			Math.min(delay, Math.max(0, (deadline - performance.now()) / 1000)),
		);
		if (performance.now() >= deadline) {
			break;
		}
		let status: Record<string, unknown>;
		try {
			status = await requestJson(`${SPN2_STATUS_URL}/${jobId}`, {
				timeout: 60,
			});
		} catch (error) {
			if (!(error instanceof SkipUpdate) || error instanceof RateLimited) {
				throw error;
			}
			lastError = error.message;
			log(
				`job ${jobId} status unavailable; keeping the same job (${lastError})`,
			);
			delay = Math.min(delay * 1.5, 20);
			continue;
		}
		if ((status.job_id ?? jobId) !== jobId) {
			throw new SkipUpdate("Wayback Machine returned a different capture job");
		}
		if (status.status === "success") {
			const timestamp = captureTimestamp(status);
			log(`capture job ${jobId} succeeded at ${timestamp}`);
			return timestamp;
		}
		if (status.status === "error") {
			throw new SkipUpdate(
				`capture job ${jobId} failed (${captureError(status)})`,
			);
		}
		delay = Math.min(delay * 1.5, 20);
	}
	throw new SkipUpdate(`capture job ${jobId} timed out (${lastError})`);
}

function formatUtcTimestamp(date: Date): string {
	const pad = (value: number): string => String(value).padStart(2, "0");
	return (
		`${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}` +
		`${pad(date.getUTCDate())}${pad(date.getUTCHours())}` +
		`${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
	);
}

async function archiveHash(timestamp: string): Promise<string> {
	const url = waybackUrl(timestamp);
	const deadline = performance.now() + CAPTURE_TIMEOUT_SECONDS * 1000;
	let response: Response;
	try {
		response = await fetch(url, {
			headers: { "User-Agent": USER_AGENT },
			signal: AbortSignal.timeout(120_000),
		});
	} catch (error) {
		throw new ReplayNotReady(
			`capture ${timestamp} unavailable (${errorName(error)})`,
		);
	}
	if (!response.ok) {
		const message = `capture ${timestamp} unavailable (HTTP ${response.status})`;
		await response.body?.cancel();
		if (response.status === 429) {
			throw new RateLimited(message);
		}
		if ([400, 401, 403, 410].includes(response.status)) {
			throw new SkipUpdate(message);
		}
		throw new ReplayNotReady(message);
	}
	if (response.url !== url) {
		await response.body?.cancel();
		throw new ReplayNotReady(`capture ${timestamp} redirected to another URL`);
	}
	const memento = response.headers.get("Memento-Datetime");
	const capturedAt = memento === null ? Number.NaN : Date.parse(memento);
	if (memento === null || Number.isNaN(capturedAt)) {
		await response.body?.cancel();
		throw new ReplayNotReady(
			`capture ${timestamp} has no valid Memento-Datetime`,
		);
	}
	if (formatUtcTimestamp(new Date(capturedAt)) !== timestamp) {
		await response.body?.cancel();
		throw new ReplayNotReady(
			`capture ${timestamp} replayed a different timestamp`,
		);
	}

	const reader = response.body?.getReader();
	if (reader === undefined) {
		throw new ReplayNotReady(`capture ${timestamp} unavailable (Error)`);
	}
	const digest = createHash("sha512");
	try {
		while (true) {
			if (performance.now() >= deadline) {
				await reader.cancel();
				throw new ReplayNotReady(`capture ${timestamp} download timed out`);
			}
			const chunk = await reader.read();
			if (chunk.done) {
				break;
			}
			digest.update(chunk.value);
		}
	} catch (error) {
		if (error instanceof SkipUpdate) {
			throw error;
		}
		throw new ReplayNotReady(
			`capture ${timestamp} unavailable (${errorName(error)})`,
		);
	}
	return `sha512-${digest.digest("base64")}`;
}

async function cdxTimestamps(
	...parameters: readonly (readonly [string, string])[]
): Promise<readonly string[]> {
	const query = new URLSearchParams({
		fl: "timestamp",
		output: "json",
		url: SOURCE_URL,
	});
	for (const [key, value] of parameters) {
		query.set(key, value);
	}
	let payload: unknown;
	try {
		payload = JSON.parse(
			Buffer.from(await requestBytes(`${CDX_API_URL}?${query}`)).toString(
				"utf8",
			),
		);
	} catch (error) {
		if (error instanceof SkipUpdate) {
			throw error;
		}
		throw new SkipUpdate("Wayback CDX returned a non-JSON response");
	}
	if (!Array.isArray(payload)) {
		throw new SkipUpdate("Wayback CDX returned a non-array response");
	}
	return payload.flatMap((row) => {
		if (!Array.isArray(row) || row.length !== 1) {
			return [];
		}
		const timestamp = row[0];
		return typeof timestamp === "string" && /^[0-9]{14}$/.test(timestamp)
			? [timestamp]
			: [];
	});
}

async function waitForCapture(
	timestamp: string,
	hashValue: string,
): Promise<void> {
	const deadline = performance.now() + CAPTURE_TIMEOUT_SECONDS * 1000;
	let lastError = "";
	while (performance.now() < deadline) {
		try {
			const capturedHash = await archiveHash(timestamp);
			if (capturedHash !== hashValue) {
				throw new SkipUpdate(
					`capture ${timestamp} does not match the official SHA-512`,
				);
			}
			return;
		} catch (error) {
			if (!(error instanceof ReplayNotReady)) {
				throw error;
			}
			if (error.message !== lastError) {
				lastError = error.message;
				log(`waiting for replay: ${lastError}`);
			}
		}
		await sleep(
			Math.min(
				REPLAY_POLL_SECONDS,
				Math.max(0, (deadline - performance.now()) / 1000),
			),
		);
	}
	throw new SkipUpdate(
		`capture ${timestamp} is not replayable yet (${lastError})`,
	);
}

async function recentCaptures(): Promise<readonly string[]> {
	const timestamps = await cdxTimestamps(
		["filter", "statuscode:(200|-)"],
		["limit", "-3"],
	);
	return [...new Set(timestamps)].sort().reverse();
}

async function matchingCapture(
	hashValue: string,
	checked: Set<string>,
): Promise<string | null> {
	let timestamps: readonly string[];
	try {
		timestamps = await recentCaptures();
	} catch (error) {
		if (error instanceof RateLimited) {
			throw error;
		}
		if (error instanceof SkipUpdate) {
			log(
				`capture index unavailable (${error.message}); continuing without CDX`,
			);
			return null;
		}
		throw error;
	}
	for (const timestamp of timestamps) {
		if (checked.has(timestamp)) {
			continue;
		}
		try {
			const capturedHash = await archiveHash(timestamp);
			checked.add(timestamp);
			if (capturedHash === hashValue) {
				log(`reusing verified capture ${timestamp}`);
				return timestamp;
			}
		} catch (error) {
			if (error instanceof RateLimited) {
				throw error;
			}
			if (error instanceof SkipUpdate) {
				log(error.message);
				continue;
			}
			throw error;
		}
	}
	return null;
}

async function resolveTimestamp(hashValue: string): Promise<string> {
	const checked = new Set<string>();
	const existing = await matchingCapture(hashValue, checked);
	if (existing !== null) {
		return existing;
	}
	let reason = "";
	try {
		const timestamp = await saveSnapshot();
		await waitForCapture(timestamp, hashValue);
		return timestamp;
	} catch (error) {
		if (!(error instanceof SkipUpdate) || error instanceof RateLimited) {
			throw error;
		}
		reason = error.message;
		log(`${reason}; checking existing captures again`);
	}
	const retry = await matchingCapture(hashValue, checked);
	if (retry !== null) {
		return retry;
	}
	throw new SkipUpdate(
		`${reason}; no verified capture available; deferred to the next update run`,
	);
}

function uniqueMatch(
	text: string,
	pattern: RegExp,
	error: string,
): RegExpExecArray {
	const matches = [...text.matchAll(new RegExp(pattern.source, "gm"))];
	if (matches.length !== 1 || matches[0] === undefined) {
		throw new Error(error);
	}
	return matches[0];
}

function replaceOnce(
	text: string,
	pattern: RegExp,
	replacement: string,
	error: string,
): string {
	uniqueMatch(text, pattern, error);
	return text.replace(pattern, replacement);
}

function currentValue(text: string, pattern: RegExp, error: string): string {
	const value = uniqueMatch(text, pattern, error)[1];
	if (value === undefined) {
		throw new Error(error);
	}
	return value;
}

async function updatePackage(
	version: string,
	hashValue: string,
): Promise<void> {
	const text = await Bun.file(PACKAGE_PATH).text();
	const currentVersion = currentValue(
		text,
		/^ {2}version = "([^"]+)";/m,
		"Failed to read the current Termius version",
	);
	currentValue(
		text,
		/^ {2}waybackTimestamp = "([0-9]{14})";/m,
		"Failed to read the current Termius Wayback timestamp",
	);
	const currentHash = currentValue(
		text,
		/^ {4}hash = "([^"]+)";/m,
		"Failed to read the current Termius hash",
	);
	if (currentVersion === version && currentHash === hashValue) {
		console.log(`termius is already at ${version}`);
		return;
	}

	const timestamp = await resolveTimestamp(hashValue);
	const updated = replaceOnce(
		replaceOnce(
			replaceOnce(
				text,
				/^ {2}version = "[^"]+";/m,
				`  version = "${version}";`,
				"Failed to update the Termius version",
			),
			/^ {2}waybackTimestamp = "[0-9]{14}";/m,
			`  waybackTimestamp = "${timestamp}";`,
			"Failed to update the Termius Wayback timestamp",
		),
		/^ {4}hash = "[^"]+";/m,
		`    hash = "${hashValue}";`,
		"Failed to update the Termius hash",
	);
	await Bun.write(PACKAGE_PATH, updated);
}

async function main(): Promise<void> {
	const [version, hashValue] = latestRelease(await readUrl(APPCAST_URL));
	await updatePackage(version, hashValue);
}

try {
	await main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`::error::termius: ${redact(message)}`);
	process.exitCode = 1;
}
