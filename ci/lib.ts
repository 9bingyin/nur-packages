import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

export type CommandResult = Readonly<{
	code: number;
	stderr: string;
	stdout: string;
	success: boolean;
}>;

export type RunOptions = Readonly<{
	capture?: boolean;
	check?: boolean;
	cwd?: string;
	env?: Readonly<Record<string, string>>;
}>;

export type SystemConfig = Readonly<{
	runner: string;
	system: string;
}>;

export class CommandError extends Error {
	readonly command: readonly string[];
	readonly result: CommandResult;

	constructor(command: readonly string[], result: CommandResult) {
		const details = result.stderr.trim() || result.stdout.trim();
		super(
			`Command failed with exit code ${result.code}: ${formatCommand(command)}` +
				(details ? `\n${details}` : ""),
		);
		this.name = "CommandError";
		this.command = command;
		this.result = result;
	}
}

function shellQuote(value: string): string {
	return /^[A-Za-z0-9_./:=+@%-]+$/.test(value)
		? value
		: `'${value.replaceAll("'", "'\\''")}'`;
}

export function formatCommand(command: readonly string[]): string {
	return command.map(shellQuote).join(" ");
}

export function run(
	command: readonly string[],
	options: RunOptions = {},
): Promise<CommandResult> {
	const executable = command[0];
	if (executable === undefined) {
		throw new Error("Command must not be empty");
	}

	const capture = options.capture ?? false;
	return new Promise((resolve, reject) => {
		const child = spawn(executable, command.slice(1), {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
			stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
		});
		let stdout = "";
		let stderr = "";
		if (capture) {
			child.stdout?.setEncoding("utf8");
			child.stderr?.setEncoding("utf8");
			child.stdout?.on("data", (chunk: string) => {
				stdout += chunk;
			});
			child.stderr?.on("data", (chunk: string) => {
				stderr += chunk;
			});
		}
		child.once("error", reject);
		child.once("close", (code) => {
			const result = {
				code: code ?? 1,
				stderr,
				stdout,
				success: code === 0,
			} satisfies CommandResult;
			if ((options.check ?? true) && !result.success) {
				reject(new CommandError(command, result));
			} else {
				resolve(result);
			}
		});
	});
}

export function requiredEnvironment(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} must be set`);
	}
	return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireRecord(
	value: unknown,
	name: string,
): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error(`${name} must be an object`);
	}
	return value;
}

export function requireString(value: unknown, name: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${name} must be a non-empty string`);
	}
	return value;
}

export function parseJson(text: string, name = "JSON"): unknown {
	try {
		const value: unknown = JSON.parse(text);
		return value;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`${name} is invalid: ${message}`);
	}
}

export function readJsonFile(path: string): unknown {
	return parseJson(readFileSync(path, "utf8"), path);
}

export function writeOutput(name: string, value: string): void {
	const outputPath = process.env.GITHUB_OUTPUT;
	if (!outputPath) {
		console.log(`output: ${name}=${value}`);
		return;
	}
	appendFileSync(outputPath, `${name}=${value}\n`);
}

export function appendStepSummary(markdown: string): void {
	const summaryPath = process.env.GITHUB_STEP_SUMMARY;
	if (summaryPath) {
		appendFileSync(summaryPath, markdown);
	}
}

export function writeTextFile(path: string, content: string): void {
	writeFileSync(path, content);
}

export function parseSystems(value: unknown): readonly SystemConfig[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error("ci/systems.json must contain a non-empty array");
	}

	const systems = value.map((entry, index) => {
		const record = requireRecord(entry, `ci/systems.json entry ${index}`);
		return {
			runner: requireString(
				record.runner,
				`ci/systems.json entry ${index}.runner`,
			),
			system: requireString(
				record.system,
				`ci/systems.json entry ${index}.system`,
			),
		} satisfies SystemConfig;
	});

	const names = systems.map(({ system }) => system);
	if (new Set(names).size !== names.length) {
		throw new Error("ci/systems.json contains duplicate systems");
	}
	return systems;
}

export function readSystems(): readonly SystemConfig[] {
	return parseSystems(readJsonFile("ci/systems.json"));
}

export function splitFilter(
	value: string | undefined,
): readonly string[] | undefined {
	const items = value?.split(/\s+/).filter(Boolean) ?? [];
	return items.length === 0 ? undefined : items;
}

export function compactJson(value: unknown): string {
	return JSON.stringify(value);
}

export function prettyJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

export function sleep(
	milliseconds: number,
	signal?: AbortSignal,
): Promise<boolean> {
	if (signal?.aborted) {
		return Promise.resolve(false);
	}
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", abort);
			resolve(true);
		}, milliseconds);
		const abort = () => {
			clearTimeout(timer);
			resolve(false);
		};
		signal?.addEventListener("abort", abort, { once: true });
	});
}
