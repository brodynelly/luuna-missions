#!/usr/bin/env bun
/**
 * Differential CLI parity check. Keep the TypeScript entry point (or an older
 * checkout via MISSIONS_ORACLE_ENTRY) available while replacing the runtime.
 *
 *   MISSIONS_GO_BIN=/path/to/luuna-missions bun scripts/parity.mjs --suite all
 *   bun scripts/parity.mjs --go /path/to/luuna-missions --require-go
 *
 * Each case runs in two fresh, matching Git repositories. Only generated IDs,
 * absolute fixture paths, CRLF, and millisecond ISO timestamps are normalized.
 * JSON objects are compared by value, JSONL records by value in file order.
 * Human output, stderr, exit codes, and non-JSON file content are exact.
 */

import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFakeBin } from "../src/test-fake-bin.ts";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOracle = join(repository, "src", "index-legacy.ts");
const timeout = 30_000;
const maxBuffer = 32 * 1024 * 1024;

function usage() {
	return [
		"Usage: bun scripts/parity.mjs [--go PATH] [--suite smoke|core|relations|config|templates|misc|plans|all] [--require-go] [--keep] [--self-check]",
		"Environment: MISSIONS_GO_BIN, MISSIONS_BUN_BIN, MISSIONS_ORACLE_ENTRY",
		"For harness self-checks, MISSIONS_CANDIDATE_COMMAND may be a JSON argv array.",
		"Without a Go binary, this check reports SKIP (or fails with --require-go).",
	].join("\n");
}

function optionsFrom(argv) {
	const opts = {
		go: process.env.MISSIONS_GO_BIN,
		bun: process.env.MISSIONS_BUN_BIN || process.execPath,
		oracle: process.env.MISSIONS_ORACLE_ENTRY || defaultOracle,
		suite: "smoke",
		requireGo: false,
		keep: false,
		selfCheck: false,
		candidateCommand: process.env.MISSIONS_CANDIDATE_COMMAND,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			console.log(usage());
			process.exit(0);
		}
		if (arg === "--go" || arg === "--suite" || arg === "--oracle-entry") {
			const value = argv[++i];
			if (!value) throw new Error(`${arg} requires a value`);
			if (arg === "--go") opts.go = value;
			else if (arg === "--suite") opts.suite = value;
			else opts.oracle = value;
		} else if (arg === "--require-go") opts.requireGo = true;
		else if (arg === "--keep") opts.keep = true;
		else if (arg === "--self-check") opts.selfCheck = true;
		else throw new Error(`Unknown option: ${arg}\n${usage()}`);
	}
	if (!["smoke", "core", "relations", "config", "templates", "misc", "plans", "all"].includes(opts.suite)) {
		throw new Error(`Unknown suite: ${opts.suite}`);
	}
	opts.oracle = resolve(opts.oracle);
	if (opts.go && (isAbsolute(opts.go) || opts.go.includes("/") || opts.go.includes("\\"))) {
		opts.go = resolve(opts.go);
	}
	if (opts.candidateCommand) {
		try {
			opts.candidateCommand = JSON.parse(opts.candidateCommand);
		} catch {
			throw new Error("MISSIONS_CANDIDATE_COMMAND must be a JSON argv array");
		}
		if (!Array.isArray(opts.candidateCommand) || !opts.candidateCommand.length || opts.candidateCommand.some(value => typeof value !== "string" || !value)) {
			throw new Error("MISSIONS_CANDIDATE_COMMAND must be a nonempty JSON string array");
		}
	}
	if (opts.selfCheck) opts.candidateCommand = [opts.bun, opts.oracle];
	return opts;
}

function processResult(command, args, cwd, input, extraEnv) {
	const env = { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", CI: "1" };
	for (const key of Object.keys(env)) {
		if (key.startsWith("LUUNA_MISSIONS_") || ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"].includes(key)) {
			delete env[key];
		}
	}
	Object.assign(env, extraEnv);
	const result = spawnSync(command, args, {
		cwd,
		input,
		encoding: "utf8",
		timeout,
		maxBuffer,
		env,
	});
	if (result.error) {
		throw new Error(`Could not run ${basename(command)} ${args.join(" ")}: ${result.error.message}`);
	}
	if (result.signal) {
		throw new Error(`${basename(command)} ${args.join(" ")} ended on ${result.signal}`);
	}
	return {
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		exit: result.status,
	};
}

function cliRun(side, args, input) {
	return side.kind === "oracle"
		? processResult(side.bun, [side.entry, ...args], side.cwd, input, side.extraEnv)
		: processResult(side.command[0], [...side.command.slice(1), ...args], side.cwd, input, side.extraEnv);
}

function bindIds(name, oldResult, newResult, oracle, candidate) {
	let oldPayload;
	let newPayload;
	try {
		oldPayload = JSON.parse(oldResult.stdout);
		newPayload = JSON.parse(newResult.stdout);
	} catch {
		return;
	}
	const pairs = [];
	if (["create feature", "create followup", "create plan seed", "create extra seed", "create adopt seed", "create atlas seed", "create stdin seed", "create absent atlas seed"].includes(name)) {
		pairs.push([name.replaceAll(" ", "_"), oldPayload.id, newPayload.id]);
	}
	const submitKeys = { "submit plan": "plan", "submit atlas plan": "atlas_plan", "submit stdin plan": "stdin_plan", "submit absent atlas plan": "absent_atlas_plan" };
	if (submitKeys[name]) {
		const prefix = submitKeys[name];
		pairs.push([prefix === "plan" ? "plan_id" : `${prefix}_id`, oldPayload.plan_id, newPayload.plan_id]);
		if (Array.isArray(oldPayload.children) && Array.isArray(newPayload.children)) {
			for (let i = 0; i < Math.min(oldPayload.children.length, newPayload.children.length); i++) {
				pairs.push([`${prefix}_child_${i + 1}`, oldPayload.children[i], newPayload.children[i]]);
			}
		}
	}
	if (name === "tpl create") pairs.push(["template_id", oldPayload.id, newPayload.id]);
	if (name === "plan create") pairs.push(["adopt_plan_id", oldPayload.plan_id, newPayload.plan_id]);
	if (name === "tpl pour" && Array.isArray(oldPayload.ids) && Array.isArray(newPayload.ids)) {
		for (let i = 0; i < Math.min(oldPayload.ids.length, newPayload.ids.length); i++) {
			pairs.push([`template_child_${i + 1}`, oldPayload.ids[i], newPayload.ids[i]]);
		}
	}
	for (const [key, oldId, newId] of pairs) {
		if (typeof oldId === "string" && oldId && typeof newId === "string" && newId) {
			oracle.ids.set(key, oldId);
			candidate.ids.set(key, newId);
		}
	}
}

function normalize(value, side) {
	let text = value.replaceAll("\r\n", "\n");
	const paths = [
		side.cwd,
		side.cwd.replaceAll("\\", "/"),
		side.cwd.replaceAll("\\", "\\\\"),
	];
	for (const path of [...new Set(paths)].sort((a, b) => b.length - a.length)) {
		text = text.replaceAll(path, "<PROJECT>");
	}
	for (const [key, id] of [...side.ids].sort((a, b) => b[1].length - a[1].length)) {
		text = text.replaceAll(id, `<${key}>`);
	}
	return text.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\b/g, "<ISO>");
}

async function filesIn(dir, base = dir, found = new Map()) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (entry.name === ".git" && dir === base) continue;
		const absolute = join(dir, entry.name);
		if (entry.isDirectory()) await filesIn(absolute, base, found);
		else if (entry.isFile()) found.set(relative(base, absolute).replaceAll("\\", "/"), await readFile(absolute, "utf8"));
		else found.set(relative(base, absolute).replaceAll("\\", "/"), `<${entry.isSymbolicLink() ? "symlink" : "special"}>`);
	}
	return found;
}

function excerpt(value) {
	const str = typeof value === "string" ? value : JSON.stringify(value);
	return str.length > 1_200 ? `${str.slice(0, 1_200)}… (${str.length} chars)` : str;
}

function compareText(label, oldValue, newValue, differences) {
	if (oldValue === newValue) return;
	let offset = 0;
	const limit = Math.min(oldValue.length, newValue.length);
	while (offset < limit && oldValue[offset] === newValue[offset]) offset++;
	const start = Math.max(0, offset - 100);
	differences.push(`${label} differs at character ${offset}\n  TS: ${excerpt(oldValue.slice(start, offset + 400))}\n  Go: ${excerpt(newValue.slice(start, offset + 400))}`);
}

function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
	}
	return value;
}

function compareOutput(label, oldValue, newValue, differences) {
	let oldJSON;
	let newJSON;
	try {
		oldJSON = JSON.parse(oldValue);
		newJSON = JSON.parse(newValue);
	} catch {
		compareText(label, oldValue, newValue, differences);
		return;
	}
	compareText(label, JSON.stringify(canonical(oldJSON)), JSON.stringify(canonical(newJSON)), differences);
}

function compareJsonl(path, oldValue, newValue, differences) {
	const oldLines = oldValue.split("\n").filter(line => line.trim() !== "");
	const newLines = newValue.split("\n").filter(line => line.trim() !== "");
	if (oldLines.length !== newLines.length) {
		differences.push(`file ${path}: TS has ${oldLines.length} records/lines; Go has ${newLines.length}`);
	}
	for (let i = 0; i < Math.min(oldLines.length, newLines.length); i++) {
		compareOutput(`file ${path} line ${i + 1}`, oldLines[i], newLines[i], differences);
	}
}

function compareIdSortedList(oldResult, newResult, oracle, candidate, differences) {
	let oldRaw;
	let newRaw;
	try {
		oldRaw = JSON.parse(oldResult.stdout);
		newRaw = JSON.parse(newResult.stdout);
		if (!Array.isArray(oldRaw.issues) || !Array.isArray(newRaw.issues)) throw new Error("missing issues array");
	} catch {
		compareOutput("stdout", normalize(oldResult.stdout, oracle), normalize(newResult.stdout, candidate), differences);
		return;
	}
	for (const [label, payload] of [["TS", oldRaw], ["Go", newRaw]]) {
		const ids = payload.issues.map(issue => issue.id);
		if (ids.some((item, index) => index > 0 && ids[index - 1].localeCompare(item) > 0)) {
			differences.push(`${label} list --sort id is not ordered by its actual generated IDs: ${ids.join(", ")}`);
		}
	}
	const normalized = (result, side) => {
		const payload = JSON.parse(normalize(result.stdout, side));
		payload.issues.sort((a, b) => a.id.localeCompare(b.id));
		return JSON.stringify(canonical(payload));
	};
	compareText("stdout issue set", normalized(oldResult, oracle), normalized(newResult, candidate), differences);
}

async function compareFiles(oracle, candidate, differences) {
	const oldFiles = await filesIn(oracle.cwd);
	const newFiles = await filesIn(candidate.cwd);
	const paths = [...new Set([...oldFiles.keys(), ...newFiles.keys()])].sort();
	for (const path of paths) {
		if (!oldFiles.has(path)) differences.push(`Unexpected Go file: ${path}`);
		else if (!newFiles.has(path)) differences.push(`Missing Go file: ${path}`);
		else {
			const oldValue = normalize(oldFiles.get(path), oracle);
			const newValue = normalize(newFiles.get(path), candidate);
			if (path.endsWith(".jsonl")) compareJsonl(path, oldValue, newValue, differences);
			else if (path.endsWith(".json")) compareOutput(`file ${path}`, oldValue, newValue, differences);
			else compareText(`file ${path}`, oldValue, newValue, differences);
		}
	}
}

async function step(name, argsFor, oracle, candidate, inputFor) {
	const oldArgs = argsFor(oracle.ids);
	const newArgs = argsFor(candidate.ids);
	const oldInput = inputFor?.(oracle.ids);
	const newInput = inputFor?.(candidate.ids);
	const oldResult = cliRun(oracle, oldArgs, oldInput);
	const newResult = cliRun(candidate, newArgs, newInput);
	bindIds(name, oldResult, newResult, oracle, candidate);
	const differences = [];
	if (oldResult.exit !== newResult.exit) differences.push(`exit: TS=${oldResult.exit}, Go=${newResult.exit}`);
	if (name === "list sort") compareIdSortedList(oldResult, newResult, oracle, candidate, differences);
	else compareOutput("stdout", normalize(oldResult.stdout, oracle), normalize(newResult.stdout, candidate), differences);
	compareOutput("stderr", normalize(oldResult.stderr, oracle), normalize(newResult.stderr, candidate), differences);
	await compareFiles(oracle, candidate, differences);
	if (differences.length) {
		throw new Error(`${name} (${oldArgs.join(" ")})\n${differences.slice(0, 8).join("\n")}${differences.length > 8 ? `\n… ${differences.length - 8} more differences` : ""}`);
	}
	return 1;
}

function id(ids, key) {
	const value = ids.get(key);
	if (!value) throw new Error(`Previous step did not yield ${key}; cannot continue`);
	return value;
}

async function smoke(oracle, candidate) {
	let count = 0;
	const run = async (name, args) => { count += await step(name, args, oracle, candidate); };
	await run("no command", () => []);
	await run("quiet without command", () => ["--quiet"]);
	await run("version json", () => ["--version", "--json"]);
	await run("version before help", () => ["--version", "--help"]);
	await run("help before version", () => ["--help", "--version"]);
	await run("format before version", () => ["--format", "json", "--version"]);
	await run("root help", () => ["--help"]);
	await run("json before help", () => ["--json", "--help"]);
	await run("format before help", () => ["--format", "json", "--help"]);
	await run("leading json option", () => ["--json"]);
	await run("leading json before command", () => ["--json", "list"]);
	await run("leading format option", () => ["--format", "json"]);
	await run("init", () => ["init", "--json"]);
	await run("version after command", () => ["list", "--version"]);
	await run("config rejects sibling option", () => ["config", "schema", "--path", "project"]);
	await run("config rejects parent option", () => ["config", "--json", "schema"]);
	await run("template rejects sibling option", () => ["tpl", "list", "--prefix", "unused"]);
	await run("template rejects inline sibling option", () => ["tpl", "list", "--prefix=unused"]);
	await run("template rejects create sibling option", () => ["tpl", "create", "--name", "unused", "--title", "unexpected"]);
	await run("template rejects parent option", () => ["tpl", "--json", "list"]);
	await run("config show", () => ["config", "show", "--json"]);
	await run("create feature", () => ["create", "--title", "Feature ticket", "--type", "feature", "--priority", "P1", "--labels", "api,core", "--json"]);
	await run("create followup", () => ["create", "--title", "Follow-up task", "--type", "task", "--json"]);
	await run("dep add", ids => ["dep", "add", id(ids, "create_followup"), id(ids, "create_feature"), "--json"]);
	await run("ready", () => ["ready", "--json"]);
	await run("blocked", () => ["blocked", "--json"]);
	await run("list", () => ["list", "--json"]);
	await run("show", ids => ["show", id(ids, "create_feature"), "--json"]);
	await run("search", () => ["search", "Feature", "--json"]);
	await run("claim", ids => ["update", id(ids, "create_feature"), "--claim", "--as", "parity", "--json"]);
	await run("label add", ids => ["label", "add", id(ids, "create_feature"), "backend", "--json"]);
	await run("close", ids => ["close", id(ids, "create_feature"), "--reason", "done", "--json"]);
	await run("ready after close", () => ["ready", "--json"]);
	await run("stats", () => ["stats", "--json"]);
	await run("doctor", () => ["doctor", "--json"]);
	await run("sync status", () => ["sync", "--status", "--json"]);
	await run("completions", () => ["completions", "bash"]);
	await run("unknown command", () => ["creat", "--json"]);
	return count;
}

async function core(oracle, candidate) {
	let count = 0;
	const run = async (name, args) => { count += await step(name, args, oracle, candidate); };
	await run("init", () => ["init", "--json"]);
	await run("create invalid priority", () => ["create", "--title", "Invalid", "--priority", "P9", "--json"]);
	await run("create feature", () => ["create", "--title", "Core feature", "--type", "feature", "--priority", "P1", "--labels", "api,ui", "--json"]);
	await run("create followup", () => ["create", "--title", "Core followup", "--type", "task", "--priority", "P3", "--json"]);
	await run("schedule date-only", ids => ["update", id(ids, "create_followup"), "--extensions", '{"scheduledFor":"2999-01-01"}', "--json"]);
	await run("ready respects date-only schedule", () => ["ready", "--respect-schedule", "--json"]);
	await run("clear date-only schedule", ids => ["update", id(ids, "create_followup"), "--clear-extensions", "--json"]);
	await run("show human", ids => ["show", id(ids, "create_feature")]);
	await run("list human", () => ["list"]);
	await run("ready human", () => ["ready"]);
	await run("search human", () => ["search", "Core"]);
	await run("stats human", () => ["stats"]);
	await run("list type", () => ["list", "--type", "feature", "--json"]);
	await run("list priority", () => ["list", "--priority-max", "1", "--json"]);
	await run("list label", () => ["list", "--label", "api", "--json"]);
	await run("list sort", () => ["list", "--sort", "id", "--json"]);
	await run("list limit", () => ["list", "--limit", "1", "--json"]);
	await run("list ids", () => ["list", "--format", "ids"]);
	await run("list plain", () => ["list", "--format", "plain"]);
	await run("list compact", () => ["list", "--format", "compact"]);
	await run("list invalid status", () => ["list", "--status", "bogus", "--json"]);
	await run("list invalid type", () => ["list", "--type", "bogus", "--json"]);
	await run("list invalid limit", () => ["list", "--limit", "zero", "--json"]);
	await run("list invalid sort", () => ["list", "--sort", "bogus", "--json"]);
	await run("show", ids => ["show", id(ids, "create_feature"), "--json"]);
	await run("show missing", () => ["show", "missing-0000", "--json"]);
	await run("search", () => ["search", "Core", "--json"]);
	await run("search missing", () => ["search", "NoMatchingPhrase", "--json"]);
	await run("ready", () => ["ready", "--json"]);
	await run("blocked", () => ["blocked", "--json"]);
	await run("stats", () => ["stats", "--json"]);
	await run("update fields", ids => ["update", id(ids, "create_feature"), "--title", "Renamed core feature", "--priority", "P0", "--description", "Updated description", "--extensions", '{"source":"parity"}', "--json"]);
	await run("update invalid status", ids => ["update", id(ids, "create_feature"), "--status", "bogus", "--json"]);
	await run("update clear extensions", ids => ["update", id(ids, "create_feature"), "--clear-extensions", "--json"]);
	await run("claim", ids => ["update", id(ids, "create_followup"), "--claim", "--as", "parity", "--json"]);
	await run("claim conflict", ids => ["update", id(ids, "create_followup"), "--claim", "--as", "other", "--json"]);
	await run("close", ids => ["close", id(ids, "create_feature"), "--reason", "complete", "--json"]);
	await run("list all", () => ["list", "--all", "--json"]);
	await run("show closed", ids => ["show", id(ids, "create_feature"), "--json"]);
	await run("reopen", ids => ["update", id(ids, "create_feature"), "--status", "open", "--json"]);
	await run("show reopened", ids => ["show", id(ids, "create_feature"), "--json"]);
	await run("stats after reopen", () => ["stats", "--json"]);
	return count;
}

async function relations(oracle, candidate) {
	let count = 0;
	const run = async (name, args) => { count += await step(name, args, oracle, candidate); };
	await run("init", () => ["init", "--json"]);
	await run("create feature", () => ["create", "--title", "Blocker", "--json"]);
	await run("create followup", () => ["create", "--title", "Dependent", "--json"]);
	await run("dep add", ids => ["dep", "add", id(ids, "create_followup"), id(ids, "create_feature"), "--json"]);
	await run("dep list", ids => ["dep", "list", id(ids, "create_followup"), "--json"]);
	await run("dep self failure", ids => ["dep", "add", id(ids, "create_feature"), id(ids, "create_feature"), "--json"]);
	await run("blocked", () => ["blocked", "--json"]);
	await run("dep remove", ids => ["dep", "remove", id(ids, "create_followup"), id(ids, "create_feature"), "--json"]);
	await run("block", ids => ["block", id(ids, "create_followup"), "--by", id(ids, "create_feature"), "--json"]);
	await run("unblock from", ids => ["unblock", id(ids, "create_followup"), "--from", id(ids, "create_feature"), "--json"]);
	await run("block again", ids => ["block", id(ids, "create_followup"), "--by", id(ids, "create_feature"), "--json"]);
	await run("unblock all open blocker", ids => ["unblock", id(ids, "create_followup"), "--all", "--json"]);
	await run("close blocker", ids => ["close", id(ids, "create_feature"), "--json"]);
	await run("unblock all closed blocker", ids => ["unblock", id(ids, "create_followup"), "--all", "--json"]);
	await run("dep list after close", ids => ["dep", "list", id(ids, "create_followup"), "--json"]);
	await run("label add", ids => ["label", "add", id(ids, "create_followup"), " API ", "backend", "--json"]);
	await run("label add duplicate", ids => ["label", "add", id(ids, "create_followup"), "api", "--json"]);
	await run("label list", ids => ["label", "list", id(ids, "create_followup"), "--json"]);
	await run("label list-all", () => ["label", "list-all", "--json"]);
	await run("label filter", () => ["list", "--label", "api", "--json"]);
	await run("label remove", ids => ["label", "remove", id(ids, "create_followup"), "backend", "--json"]);
	await run("label list after remove", ids => ["label", "list", id(ids, "create_followup"), "--json"]);
	await run("label missing issue", () => ["label", "list", "missing-0000", "--json"]);
	return count;
}

async function config(oracle, candidate) {
	let count = 0;
	const run = async (name, args) => { count += await step(name, args, oracle, candidate); };
	await run("config schema compact", () => ["config", "schema", "--json"]);
	await run("config schema pretty", () => ["config", "schema"]);
	await run("init", () => ["init", "--json"]);
	await run("config show", () => ["config", "show", "--json"]);
	await run("config set project", () => ["config", "set", "project", "parity", "--json"]);
	await run("config show project", () => ["config", "show", "--path", "project", "--json"]);
	await run("config set depth", () => ["config", "set", "max_plan_depth", "5", "--json"]);
	await run("config show depth", () => ["config", "show", "--path", "max_plan_depth", "--json"]);
	await run("config invalid depth", () => ["config", "set", "max_plan_depth", "0", "--json"]);
	await run("config invalid property", () => ["config", "set", "unknown", "true", "--json"]);
	await run("config unset depth", () => ["config", "unset", "max_plan_depth", "--json"]);
	await run("config unset missing", () => ["config", "unset", "missing", "--json"]);
	await run("config unset required", () => ["config", "unset", "project", "--json"]);
	await run("config show final", () => ["config", "show", "--json"]);
	await run("init again", () => ["init", "--json"]);
	return count;
}

async function templates(oracle, candidate) {
	let count = 0;
	const run = async (name, args) => { count += await step(name, args, oracle, candidate); };
	await run("init", () => ["init", "--json"]);
	await run("tpl list empty", () => ["tpl", "list", "--json"]);
	await run("tpl create", () => ["tpl", "create", "--name", "Parity template", "--json"]);
	await run("tpl step first", ids => ["tpl", "step", "add", id(ids, "template_id"), "--title", "Build {prefix}", "--priority", "P1", "--json"]);
	await run("tpl step second", ids => ["tpl", "step", "add", id(ids, "template_id"), "--title", "Check {prefix}", "--type", "bug", "--json"]);
	await run("tpl step add help", () => ["tpl", "step", "add", "--help"]);
	await run("tpl list", () => ["tpl", "list", "--json"]);
	await run("tpl show", ids => ["tpl", "show", id(ids, "template_id"), "--json"]);
	await run("tpl pour", ids => ["tpl", "pour", id(ids, "template_id"), "--prefix", "feature", "--json"]);
	await run("tpl status", ids => ["tpl", "status", id(ids, "template_id"), "--json"]);
	await run("tpl child show", ids => ["show", id(ids, "template_child_1"), "--json"]);
	await run("tpl first close", ids => ["close", id(ids, "template_child_1"), "--json"]);
	await run("tpl status after close", ids => ["tpl", "status", id(ids, "template_id"), "--json"]);
	await run("tpl missing", () => ["tpl", "show", "missing-0000", "--json"]);
	return count;
}

async function misc(oracle, candidate) {
	let count = 0;
	const run = async (name, args, input) => { count += await step(name, args, oracle, candidate, input); };
	await run("init", () => ["init", "--json"]);
	await run("setup claude", () => ["setup", "claude", "--json"]);
	await run("setup claude help", () => ["setup", "claude", "--help"]);
	await run("setup claude idempotent", () => ["setup", "claude", "--json"]);
	await run("setup claude remove", () => ["setup", "claude", "--remove", "--json"]);
	await run("guard allow", () => ["guard"], () => JSON.stringify({ tool_name: "Write", tool_input: { file_path: "notes.txt" } }));
	await run("guard deny", () => ["guard"], () => JSON.stringify({ tool_name: "Edit", tool_input: { file_path: ".luuna/missions/issues.jsonl" } }));
	await run("guard malformed", () => ["guard"], () => "{malformed");
	await run("prime export", () => ["prime", "--export", "--json"]);
	await run("prime compact", () => ["prime", "--compact", "--json"]);
	await run("onboard stdout", () => ["onboard", "--stdout", "--json"]);
	await run("onboard check missing", () => ["onboard", "--check", "--json"]);
	await run("onboard install", () => ["onboard", "--json"]);
	await run("onboard check installed", () => ["onboard", "--check", "--json"]);
	for (const side of [oracle, candidate]) {
		await mkdir(join(side.cwd, ".beads"), { recursive: true });
		await writeFile(join(side.cwd, ".beads", "issues.jsonl"), '{"id":"legacy-1","title":"Imported bug","status":"open","issue_type":"bug","created_at":"2024-01-01T00:00:00.000Z","updated_at":"2024-01-01T00:00:00.000Z"}\n{malformed\n');
	}
	await run("migrate beads", () => ["migrate-from-beads", "--json"]);
	await run("migrate beads idempotent", () => ["migrate-from-beads", "--json"]);
	await run("upgrade private", () => ["upgrade", "--check", "--json"]);
	await run("completions zsh", () => ["completions", "zsh"]);
	await run("completions fish", () => ["completions", "fish"]);
	return count;
}

async function plans(oracle, candidate) {
	let count = 0;
	const run = async (name, args, input) => { count += await step(name, args, oracle, candidate, input); };
	await run("init", () => ["init", "--json"]);
	await run("create plan seed", () => ["create", "--title", "Plan seed", "--type", "feature", "--json"]);
	await run("plan templates", () => ["plan", "templates", "--json"]);
	await run("plan prompt", ids => ["plan", "prompt", id(ids, "create_plan_seed"), "--json"]);
	const plan = {
		template: "feature",
		sections: {
			context: "This work matters because we need to verify a complete structured plan across CLI implementations.",
			approach: "Use a small two-step feature plan with an explicit dependency.",
			alternatives: [],
			steps: [
				{ title: "Implement feature", type: "task", priority: 2, blocks: [2] },
				{ title: "Verify feature", type: "task", priority: 2, blocks: [] },
			],
			risks: [],
			acceptance: ["The full feature flow works."],
		},
	};
	await Promise.all([oracle, candidate].map(side => writeFile(join(side.cwd, "plan.json"), JSON.stringify(plan))));
	await run("submit plan", ids => ["plan", "submit", id(ids, "create_plan_seed"), "--plan", "plan.json", "--json"]);
	await run("plan show", ids => ["plan", "show", id(ids, "create_plan_seed"), "--json"]);
	await run("plan list", () => ["plan", "list", "--json"]);
	await run("plan validate", ids => ["plan", "validate", id(ids, "create_plan_seed"), "--json"]);
	await run("plan edit name", ids => ["plan", "edit", id(ids, "create_plan_seed"), "--name", "Revised feature plan", "--json"]);
	await run("plan edit approach", ids => ["plan", "edit", id(ids, "plan_id"), "--section", "approach", "Use a revised approach with clear verification at each stage.", "--json"]);
	await run("plan edit step", ids => ["plan", "edit", id(ids, "plan_id"), "--step", "1", "--title", "Implement revised feature", "--priority", "P0", "--type", "bug", "--json"]);
	await run("plan edited child", ids => ["show", id(ids, "plan_child_1"), "--json"]);
	await run("plan validate after edit", ids => ["plan", "validate", id(ids, "plan_id"), "--json"]);
	await run("plan edit invalid step", ids => ["plan", "edit", id(ids, "plan_id"), "--step", "99", "--title", "Invalid", "--json"]);
	await run("plan edit invalid section", ids => ["plan", "edit", id(ids, "plan_id"), "--section", "steps", "Invalid", "--json"]);
	await run("create extra seed", () => ["create", "--title", "Additional plan work", "--json"]);
	await run("plan adopt", ids => ["plan", "adopt", id(ids, "plan_id"), id(ids, "create_extra_seed"), "--at", "1", "--json"]);
	await run("plan reorder duplicate", ids => ["plan", "reorder", id(ids, "plan_id"), id(ids, "plan_child_1"), id(ids, "plan_child_1"), "--json"]);
	await run("plan reorder", ids => ["plan", "reorder", id(ids, "plan_id"), id(ids, "plan_child_2"), id(ids, "plan_child_1"), id(ids, "create_extra_seed"), "--json"]);
	await run("plan release", ids => ["plan", "release", id(ids, "plan_id"), id(ids, "create_extra_seed"), "--json"]);
	await run("plan release missing child", ids => ["plan", "release", id(ids, "plan_id"), id(ids, "create_extra_seed"), "--json"]);
	await run("plan review", ids => ["plan", "review", id(ids, "plan_id"), "--by", "parity-reviewer", "--json"]);
	await run("plan outcome", ids => ["plan", "outcome", id(ids, "plan_id"), "--result", "partial", "--note", "Verification pending", "--json"]);
	await run("plan list outcome", () => ["plan", "list", "--outcome", "partial", "--json"]);
	await run("create adopt seed", () => ["create", "--title", "Adopt-only parent", "--type", "feature", "--json"]);
	await run("plan create", ids => ["plan", "create", id(ids, "create_adopt_seed"), "--name", "Adopt-only plan", "--json"]);
	await run("adopt-only list context", () => ["list", "--json"]);
	await run("adopt-only ready context", () => ["ready", "--json"]);
	await run("adopt-only search context", () => ["search", "Adopt-only", "--json"]);
	await run("block adopt-only parent", ids => ["block", id(ids, "create_adopt_seed"), "--by", id(ids, "create_extra_seed"), "--json"]);
	await run("adopt-only blocked context", () => ["blocked", "--json"]);
	await run("unblock adopt-only parent", ids => ["unblock", id(ids, "create_adopt_seed"), "--from", id(ids, "create_extra_seed"), "--json"]);
	await run("plan adopt released seed", ids => ["plan", "adopt", id(ids, "adopt_plan_id"), id(ids, "create_extra_seed"), "--json"]);
	await run("adopt-only plan show", ids => ["plan", "show", id(ids, "adopt_plan_id"), "--json"]);
	const invalidPlan = { template: "feature", sections: { approach: "Missing required fields", steps: [] } };
	await Promise.all([oracle, candidate].map(side => writeFile(join(side.cwd, "invalid-plan.json"), JSON.stringify(invalidPlan))));
	await run("plan submit invalid", ids => ["plan", "submit", id(ids, "create_plan_seed"), "--plan", "invalid-plan.json", "--json"]);
	const fakeBin = join(dirname(dirname(oracle.cwd)), "atlas-bin");
	await mkdir(fakeBin, { recursive: true });
	const fakeAtlas = [
		'const fs = require("node:fs");',
		'const path = require("node:path");',
		'const args = process.argv.slice(2);',
		'fs.appendFileSync(path.join(process.cwd(), "atlas-invocations.jsonl"), JSON.stringify(args) + "\\n");',
		'if (args[0] === "--json" && args[1] === "status") {',
		'  process.stdout.write(JSON.stringify({ domains: [{ domain: "parity" }] }));',
		'} else if (args[0] === "--json" && args[1] === "query") {',
		'  const kind = args[args.indexOf("--type") + 1];',
		'  process.stdout.write(JSON.stringify({ domains: [{ domain: "parity", records: [{ id: "atlas-" + kind, type: kind, name: "Parity " + kind, description: "Grounded record" }] }] }));',
		'} else if (args[0] === "record") {',
		'  process.stdout.write(JSON.stringify({ record: { id: "atlas-decision-record" } }));',
		'} else { process.stderr.write("unexpected fake Atlas args\\n"); process.exit(2); }',
	].join("\n");
	await writeFakeBin(fakeBin, "luuna-atlas", fakeAtlas);
	for (const side of [oracle, candidate]) side.extraEnv = { PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}` };
	await run("create atlas seed", () => ["create", "--title", "Atlas feature", "--type", "feature", "--labels", "parity", "--json"]);
	await run("plan prompt inferred atlas", ids => ["plan", "prompt", id(ids, "create_atlas_seed"), "--json"]);
	await run("submit atlas plan", ids => ["plan", "submit", id(ids, "create_atlas_seed"), "--plan", "plan.json", "--record-decision", "--domain", "parity", "--json"]);
	await run("create stdin seed", () => ["create", "--title", "Stdin feature", "--type", "feature", "--json"]);
	const stdinPlan = structuredClone(plan);
	stdinPlan.sections.steps[0].plan_template = "bug";
	await run("submit stdin plan", ids => ["plan", "submit", id(ids, "create_stdin_seed"), "--plan", "-", "--json"], () => JSON.stringify(stdinPlan));
	await run("nested inherited prompt", ids => ["plan", "prompt", id(ids, "stdin_plan_child_1"), "--json"]);
	const noAtlasBin = join(dirname(dirname(oracle.cwd)), "no-atlas-bin");
	await mkdir(noAtlasBin, { recursive: true });
	for (const side of [oracle, candidate]) side.extraEnv = { PATH: noAtlasBin };
	await run("create absent atlas seed", () => ["create", "--title", "Absent Atlas feature", "--type", "feature", "--json"]);
	await run("submit absent atlas plan", ids => ["plan", "submit", id(ids, "create_absent_atlas_seed"), "--plan", "plan.json", "--record-decision", "--domain", "parity", "--json"]);
	return count;
}

async function fixture(opts, suite) {
	const root = await mkdtemp(join(tmpdir(), "missions-parity-"));
	const oracle = { kind: "oracle", cwd: join(root, "oracle", "project"), bun: opts.bun, entry: opts.oracle, ids: new Map() };
	const candidate = { kind: "go", cwd: join(root, "go", "project"), command: opts.candidateCommand || [opts.go], ids: new Map() };
	try {
		for (const side of [oracle, candidate]) {
			await mkdir(side.cwd, { recursive: true });
			const initialized = processResult("git", ["init", "-q"], side.cwd);
			if (initialized.exit !== 0) throw new Error(`git init failed: ${initialized.stderr}`);
		}
		const suites = { smoke, core, relations, config, templates, misc, plans };
		const count = await suites[suite](oracle, candidate);
		console.log(`PASS ${suite}: ${count} parity steps`);
		return count;
	} finally {
		if (opts.keep) console.error(`Fixture retained at ${root}`);
		if (!opts.keep) {
			const safeRoot = resolve(root);
			const rel = relative(resolve(tmpdir()), safeRoot);
			if (!rel || rel.startsWith("..") || isAbsolute(rel) || !basename(safeRoot).startsWith("missions-parity-")) {
				throw new Error(`Refusing to remove unexpected fixture path: ${safeRoot}`);
			}
			await rm(safeRoot, { recursive: true, force: true });
		}
	}
}

async function main() {
	const opts = optionsFrom(process.argv.slice(2));
	if (!opts.go && !opts.candidateCommand) {
		if (opts.requireGo) throw new Error(`Go binary required. Set MISSIONS_GO_BIN or pass --go.\n${usage()}`);
		console.log("SKIP CLI parity: set MISSIONS_GO_BIN or pass --go to compare the Go binary.");
		return;
	}
	let total = 0;
	for (const suite of opts.suite === "all" ? ["smoke", "core", "relations", "config", "templates", "misc", "plans"] : [opts.suite]) {
		total += await fixture(opts, suite);
	}
	console.log(`PASS total: ${total} parity steps`);
}

main().catch(error => {
	console.error(`FAIL CLI parity: ${error.message}`);
	process.exitCode = 1;
});
