import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findMissionsDir } from "./config.ts";
import {
	LEGACY_HOOK_COMMAND_RE,
	migrateLegacyLayout,
	upgradeLegacyMarkers,
} from "./legacy-layout.ts";
import { replaceMarkerSection } from "./markers.ts";
import { stripPlanBackref } from "./plan-backref.ts";

const ENTRY = join(import.meta.dir, "index.ts");

// The in-process harness passes an explicit store dir, which bypasses discovery,
// so migration is exercised through a real subprocess.
function runCli(args: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
	const r = Bun.spawnSync(["bun", ENTRY, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	return {
		stdout: new TextDecoder().decode(r.stdout),
		stderr: new TextDecoder().decode(r.stderr),
		exitCode: r.exitCode ?? 0,
	};
}

let root: string;

function seedLegacy(dir: string): void {
	mkdirSync(join(dir, ".seeds"), { recursive: true });
	writeFileSync(join(dir, ".seeds", "config.yaml"), 'project: "x"\nversion: "1"\n');
	writeFileSync(join(dir, ".seeds", "issues.jsonl"), '{"id":"x-1"}\n');
}

function trySymlink(target: string, path: string): boolean {
	try {
		symlinkSync(target, path, "junction");
		return true;
	} catch {
		return false;
	}
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "missions-legacy-test-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("legacy layout migration", () => {
	test("returns false when there is no legacy directory", () => {
		expect(migrateLegacyLayout(root)).toBe(false);
	});

	test("moves .seeds to .luuna/missions, preserving contents", () => {
		seedLegacy(root);
		expect(migrateLegacyLayout(root)).toBe(true);
		expect(existsSync(join(root, ".seeds"))).toBe(false);
		expect(readFileSync(join(root, ".luuna", "missions", "issues.jsonl"), "utf8")).toBe(
			'{"id":"x-1"}\n',
		);
	});

	test("rewrites managed .gitattributes and .gitignore lines", () => {
		seedLegacy(root);
		writeFileSync(
			join(root, ".gitattributes"),
			"*.png binary\n.seeds/issues.jsonl merge=union\n.seeds/plans.jsonl merge=union\n",
		);
		writeFileSync(join(root, ".gitignore"), "node_modules/\n.seeds/*.lock\n");
		migrateLegacyLayout(root);
		const attrs = readFileSync(join(root, ".gitattributes"), "utf8");
		expect(attrs).toContain(".luuna/missions/issues.jsonl merge=union");
		expect(attrs).toContain("*.png binary");
		expect(attrs).not.toContain(".seeds");
		expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(
			"node_modules/\n.luuna/missions/*.lock\n",
		);
	});

	test("fails when both layouts exist and leaves both untouched", () => {
		seedLegacy(root);
		mkdirSync(join(root, ".luuna", "missions"), { recursive: true });
		expect(() => migrateLegacyLayout(root)).toThrow(/Both .*exist/);
		expect(existsSync(join(root, ".seeds", "config.yaml"))).toBe(true);
	});

	test("refuses when .luuna is a symlink", () => {
		seedLegacy(root);
		const elsewhere = mkdtempSync(join(tmpdir(), "missions-legacy-target-"));
		try {
			if (!trySymlink(elsewhere, join(root, ".luuna"))) return;
			expect(() => migrateLegacyLayout(root)).toThrow(/symlink/);
			expect(existsSync(join(root, ".seeds", "config.yaml"))).toBe(true);
			expect(existsSync(join(elsewhere, "missions"))).toBe(false);
		} finally {
			rmSync(elsewhere, { recursive: true, force: true });
		}
	});

	test("refuses when .seeds is a symlink", () => {
		const elsewhere = mkdtempSync(join(tmpdir(), "missions-legacy-target-"));
		try {
			if (!trySymlink(elsewhere, join(root, ".seeds"))) return;
			expect(() => migrateLegacyLayout(root)).toThrow(/symlink/);
			expect(existsSync(join(root, ".luuna"))).toBe(false);
		} finally {
			rmSync(elsewhere, { recursive: true, force: true });
		}
	});

	test("notice goes to stderr only; stdout stays valid JSON", () => {
		seedLegacy(root);
		const res = runCli(["list", "--json"], root);
		expect(res.exitCode).toBe(0);
		expect(res.stderr).toContain("Migrated legacy .seeds/ to .luuna/missions/");
		expect(res.stderr.trim().split("\n")).toHaveLength(1);
		expect(res.stdout).not.toContain("Migrated");
		expect(() => JSON.parse(res.stdout)).not.toThrow();
		expect(existsSync(join(root, ".luuna", "missions", "config.yaml"))).toBe(true);
	});

	test("init migrates a legacy store instead of creating a fresh one", () => {
		seedLegacy(root);
		const res = runCli(["init", "--json"], root);
		expect(res.exitCode).toBe(0);
		expect(res.stderr).toContain("Migrated legacy");
		expect(JSON.parse(res.stdout).success).toBe(true);
		expect(readFileSync(join(root, ".luuna", "missions", "issues.jsonl"), "utf8")).toBe(
			'{"id":"x-1"}\n',
		);
		expect(existsSync(join(root, ".seeds"))).toBe(false);
	});

	test("findMissionsDir migrates from a subdirectory", async () => {
		seedLegacy(root);
		mkdirSync(join(root, "sub"));
		const dir = await findMissionsDir(join(root, "sub"));
		expect(dir).toBe(join(root, ".luuna", "missions"));
	});

	test("a command fails with a clear error when both layouts exist", () => {
		seedLegacy(root);
		mkdirSync(join(root, ".luuna", "missions"), { recursive: true });
		writeFileSync(join(root, ".luuna", "missions", "config.yaml"), 'project: "x"\nversion: "1"\n');
		const res = runCli(["list", "--json"], root);
		expect(res.exitCode).toBe(1);
		expect(res.stderr + res.stdout).toContain("Both");
	});

	test("legacy hook commands are recognised for replacement", () => {
		expect(LEGACY_HOOK_COMMAND_RE.test("sd prime --compact")).toBe(true);
		expect(LEGACY_HOOK_COMMAND_RE.test("seeds guard")).toBe(true);
		expect(LEGACY_HOOK_COMMAND_RE.test("luuna-missions guard")).toBe(false);
	});

	test("legacy HTML markers are upgraded and still recognised", () => {
		expect(upgradeLegacyMarkers("<!-- seeds:start -->x<!-- seeds-onboard-schema:7 -->")).toBe(
			"<!-- missions:start -->x<!-- missions-onboard-schema:7 -->",
		);
		const replaced = replaceMarkerSection(
			"a\n<!-- seeds:start -->\nold\n<!-- seeds:end -->\nb",
			"new",
		);
		expect(replaced).toBe("a\n<!-- missions:start -->\nnew\n<!-- missions:end -->\nb");
		const backref = "note\n\n<!-- seeds:plan-backref:start -->\nx\n<!-- seeds:plan-backref:end -->";
		expect(stripPlanBackref(backref)).toBe("note");
	});
});
