import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Command } from "commander";
import { migrateLegacyLayout } from "../legacy-layout.ts";
import { outputJson, printSuccess } from "../output.ts";
import {
	CONFIG_FILE,
	DEFAULT_MAX_PLAN_DEPTH,
	ISSUES_FILE,
	MISSIONS_DIR,
	PLANS_FILE,
	TEMPLATES_FILE,
} from "../types.ts";

export const MERGE_UNION_LINES = [
	".luuna/missions/issues.jsonl merge=union",
	".luuna/missions/templates.jsonl merge=union",
	".luuna/missions/plans.jsonl merge=union",
];

function ensureGitattributes(cwd: string): void {
	const gitattrsPath = join(cwd, ".gitattributes");
	if (existsSync(gitattrsPath)) {
		const existing = readFileSync(gitattrsPath, "utf8");
		const missing = MERGE_UNION_LINES.filter((line) => !existing.includes(line));
		if (missing.length === 0) return;
		const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
		writeFileSync(gitattrsPath, `${existing}${sep}${missing.join("\n")}\n`);
	} else {
		writeFileSync(gitattrsPath, `${MERGE_UNION_LINES.join("\n")}\n`);
	}
}

export async function run(args: string[]): Promise<void> {
	const jsonMode = args.includes("--json");
	const cwd = process.cwd();
	migrateLegacyLayout(cwd);
	const missionsDir = join(cwd, MISSIONS_DIR);

	if (existsSync(join(missionsDir, CONFIG_FILE))) {
		// Re-run still backfills any missing merge=union lines per-file.
		ensureGitattributes(cwd);
		if (jsonMode) {
			await outputJson({ success: true, command: "init", dir: missionsDir });
		} else {
			printSuccess(`Already initialized: ${missionsDir}`);
		}
		return;
	}

	mkdirSync(missionsDir, { recursive: true });

	// config.yaml — derive project name from directory
	const projectName = basename(cwd);
	writeFileSync(
		join(missionsDir, CONFIG_FILE),
		`project: "${projectName}"\nversion: "1"\nmax_plan_depth: ${DEFAULT_MAX_PLAN_DEPTH}\n`,
	);

	// empty JSONL files
	writeFileSync(join(missionsDir, ISSUES_FILE), "");
	writeFileSync(join(missionsDir, TEMPLATES_FILE), "");
	writeFileSync(join(missionsDir, PLANS_FILE), "");

	// .gitignore inside .luuna/missions/
	writeFileSync(join(missionsDir, ".gitignore"), "*.lock\n");

	ensureGitattributes(cwd);

	if (jsonMode) {
		await outputJson({ success: true, command: "init", dir: missionsDir });
	} else {
		printSuccess(`Initialized .luuna/missions/ in ${cwd}`);
	}
}

export function register(program: Command): void {
	program
		.command("init")
		.description("Initialize .luuna/missions/ in current directory")
		.option("--json", "Output as JSON")
		.action(async (opts: { json?: boolean }) => {
			await run(opts.json ? ["--json"] : []);
		});
}
