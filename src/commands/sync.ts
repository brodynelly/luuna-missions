import type { Command } from "commander";
import { findMissionsDir, isInsideWorktree, projectRootFromMissionsDir } from "../config.ts";
import { outputJson, printSuccess, printWarning } from "../output.ts";
import { MISSIONS_DIR } from "../types.ts";

function spawnSync(
	cmd: string[],
	cwd: string,
): { stdout: string; stderr: string; exitCode: number } {
	const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
	const stdout = new TextDecoder().decode(result.stdout);
	const stderr = new TextDecoder().decode(result.stderr);
	return { stdout, stderr, exitCode: result.exitCode ?? 0 };
}

export async function run(args: string[], missionsDir?: string): Promise<void> {
	const jsonMode = args.includes("--json");
	const statusOnly = args.includes("--status");
	const dryRun = args.includes("--dry-run");

	const dir = missionsDir ?? (await findMissionsDir());
	const projectRoot = projectRootFromMissionsDir(dir);

	// Worktree guard: skip commit when running from a worktree
	if (!missionsDir && isInsideWorktree(process.cwd())) {
		const msg = "Inside a git worktree — skipping commit. Issues are stored in the main repo.";
		if (jsonMode) {
			await outputJson({
				success: true,
				command: "sync",
				committed: false,
				worktree: true,
				message: msg,
			});
		} else {
			printWarning(msg);
		}
		return;
	}

	const statusResult = spawnSync(
		["git", "-C", projectRoot, "status", "--porcelain", `${MISSIONS_DIR}/`],
		projectRoot,
	);

	const changed = statusResult.stdout.trim();

	if (statusOnly) {
		if (jsonMode) {
			await outputJson({ success: true, command: "sync", hasChanges: !!changed, changes: changed });
		} else {
			if (changed) {
				printSuccess("Uncommitted .luuna/missions/ changes:");
				console.log(changed);
			} else {
				printSuccess("No uncommitted .luuna/missions/ changes.");
			}
		}
		return;
	}

	if (!changed) {
		if (jsonMode) {
			await outputJson({
				success: true,
				command: "sync",
				committed: false,
				message: "Nothing to commit",
			});
		} else {
			printSuccess("No changes to commit.");
		}
		return;
	}

	if (dryRun) {
		const date = new Date().toISOString().slice(0, 10);
		const msg = `missions: sync ${date}`;
		if (jsonMode) {
			await outputJson({
				success: true,
				command: "sync",
				dryRun: true,
				wouldCommit: true,
				message: msg,
				changes: changed,
			});
		} else {
			printSuccess("Dry run — would commit:");
			console.log(changed);
			console.log(`Commit message: ${msg}`);
		}
		return;
	}

	// Stage
	const addResult = spawnSync(["git", "-C", projectRoot, "add", `${MISSIONS_DIR}/`], projectRoot);
	if (addResult.exitCode !== 0) {
		throw new Error(`git add failed: ${addResult.stderr}`);
	}

	// Commit
	const date = new Date().toISOString().slice(0, 10);
	const msg = `missions: sync ${date}`;
	const commitResult = spawnSync(["git", "-C", projectRoot, "commit", "-m", msg], projectRoot);
	if (commitResult.exitCode !== 0) {
		throw new Error(`git commit failed: ${commitResult.stderr}`);
	}

	if (jsonMode) {
		await outputJson({ success: true, command: "sync", committed: true, message: msg });
	} else {
		printSuccess(`Committed: ${msg}`);
	}
}

export function register(program: Command): void {
	program
		.command("sync")
		.description("Stage and commit .luuna/missions/ changes")
		.option("--status", "Check status without committing")
		.option("--dry-run", "Show what would be committed without committing")
		.option("--json", "Output as JSON")
		.action(async (opts: { status?: boolean; dryRun?: boolean; json?: boolean }) => {
			const args: string[] = [];
			if (opts.status) args.push("--status");
			if (opts.dryRun) args.push("--dry-run");
			if (opts.json) args.push("--json");
			await run(args);
		});
}
