import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerAll } from "../register-all.ts";
import { generateBash, generateFish, generateZsh } from "./completions.ts";

// Previously this file spawned `bun run src/index.ts completions <shell>` to
// see every registered command. We now build a fully-populated Program
// in-process via registerAll() and call the exported generators directly.
// Validation-error paths (unknown shell, missing argument) are still
// exercised through the in-process runCli harness so the printError ✗-prefix
// contract is enforced.

let fullProgram: Command;

beforeAll(async () => {
	fullProgram = new Command();
	await registerAll(fullProgram);
});

describe("luuna-missions completions (script generators)", () => {
	test("bash output contains complete -F", () => {
		const out = generateBash(fullProgram);
		expect(out).toContain("complete -F");
		expect(out).toContain("_luuna_missions_completions");
		expect(out).toContain("luuna-missions lms lm");
	});

	test("zsh output contains #compdef luuna-missions lms lm", () => {
		const out = generateZsh(fullProgram);
		expect(out).toContain("#compdef luuna-missions lms lm");
		expect(out).toContain("_luuna_missions");
	});

	test("fish output contains complete -c luuna-missions", () => {
		const out = generateFish(fullProgram);
		expect(out).toContain("complete -c luuna-missions");
		expect(out).toContain("complete -c lms");
	});

	test("output includes known commands", () => {
		const out = generateBash(fullProgram);
		expect(out).toContain("create");
		expect(out).toContain("list");
		expect(out).toContain("stats");
	});

	test("output includes subcommands for dep and tpl", () => {
		const out = generateBash(fullProgram);
		expect(out).toContain("dep");
		expect(out).toContain("tpl");
		// dep subcommands
		expect(out).toContain("add");
		expect(out).toContain("remove");
		// tpl subcommands
		expect(out).toContain("pour");
	});
});

describe("luuna-missions completions (CLI validation)", () => {
	let tmpDir: string;
	const cli = join(import.meta.dir, "..", "index.ts");
	const decoder = new TextDecoder();

	function runCli(args: string[]): { exitCode: number; stderr: string } {
		// Intentional CLI failures set process.exitCode. Isolate that state from
		// Bun's test runner, which retains it on Windows after a passing test.
		const result = Bun.spawnSync([process.execPath, cli, "completions", ...args], {
			cwd: tmpDir,
			stdout: "pipe",
			stderr: "pipe",
		});
		return { exitCode: result.exitCode, stderr: decoder.decode(result.stderr) };
	}

	beforeAll(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "missions-completions-"));
	});

	test("unknown shell exits non-zero with printError ✗ prefix", async () => {
		const { exitCode, stderr } = runCli(["powershell"]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Unknown shell");
		// pl-c94f step 1: validation errors flow through printError ("✗ " prefix)
		expect(stderr).toMatch(/^✗ /);
	});

	test("missing argument exits non-zero", async () => {
		const { exitCode } = runCli([]);
		expect(exitCode).not.toBe(0);
	});

	afterAll(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});
});
