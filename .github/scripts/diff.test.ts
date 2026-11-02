import { describe, expect, test } from "bun:test";
import { diffViolation, type parseRawDiff, pathPolicy } from "./diff.ts";

const file = (
	path: string,
	status: "A" | "D" | "M" = "M",
): ReturnType<typeof parseRawDiff>[number] => ({
	newMode: "100644",
	oldMode: status === "A" ? "000000" : "100644",
	path,
	status,
});

describe("pathPolicy", () => {
	test("ignores human branches", () => {
		expect(pathPolicy("main")).toEqual({ kind: "ignore" });
	});

	test("recognizes package and lock updates", () => {
		expect(pathPolicy("update/vocat")).toEqual({
			kind: "package",
			name: "vocat",
		});
		expect(pathPolicy("update/lock")).toEqual({ kind: "lock" });
	});

	test("rejects an unsafe update branch name", () => {
		expect(pathPolicy("update/../flake.nix").kind).toBe("reject");
	});
});

describe("diffViolation", () => {
	test("allows a package update inside its directory", () => {
		expect(
			diffViolation(pathPolicy("update/vocat"), [
				file("packages/vocat/package.nix"),
			]),
		).toBeNull();
	});

	test("rejects a package update that leaves its directory", () => {
		expect(
			diffViolation(pathPolicy("update/vocat"), [file("flake.nix")]),
		).toMatch(/outside/);
	});

	test("allows only flake.lock on the lock branch", () => {
		expect(
			diffViolation(pathPolicy("update/lock"), [file("flake.lock")]),
		).toBeNull();
		expect(
			diffViolation(pathPolicy("update/lock"), [file("flake.nix")]),
		).toMatch(/outside/);
	});

	test("does not restrict other branches", () => {
		expect(
			diffViolation(pathPolicy("feature"), [file("flake.nix")]),
		).toBeNull();
	});
});
