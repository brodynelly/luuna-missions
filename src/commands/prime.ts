import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { findMissionsDir, projectRootFromMissionsDir } from "../config.ts";
import { outputJson } from "../output.ts";
import { loadPlanContext } from "../plan-context.ts";
import { sortIssues } from "../sort.ts";
import { readIssues } from "../store.ts";
import type { Issue } from "../types.ts";
import { readyIssues } from "./ready.ts";

const PRIME_FILE = "PRIME.md";

export interface PrimeCommand {
	command: string;
	description: string;
}

export interface PrimeCommandGroup {
	name: string;
	commands: PrimeCommand[];
	notes?: string[];
}

export interface PrimeWorkflow {
	name: string;
	commands: string[];
}

export interface PrimeSectionsFull {
	mode: "full";
	title: string;
	contextRecovery: string;
	closeProtocol: {
		warning: string;
		steps: string[];
		footer: string;
	};
	rules: string[];
	commandGroups: PrimeCommandGroup[];
	workflows: PrimeWorkflow[];
}

export interface PrimeSectionsCompact {
	mode: "compact";
	title: string;
	commands: PrimeCommand[];
	planningNote: string;
	closingNote: string;
}

export type PrimeSections = PrimeSectionsFull | PrimeSectionsCompact;

// Quality-gate command for the close checklist: the repo's own `verify` script
// when package.json has one, else a generic instruction (no guessed commands).
function gatesCommand(projectRoot: string | null): string | null {
	if (projectRoot) {
		try {
			const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
				scripts?: Record<string, unknown>;
			};
			if (typeof pkg.scripts?.verify === "string") return "bun run verify";
		} catch {
			// No or unreadable package.json — fall through to the generic step.
		}
	}
	return null;
}

const GENERIC_GATES = "the project's quality gates (tests, lint, typecheck)";

function buildFull(gates: string | null): PrimeSectionsFull {
	return {
		mode: "full",
		title: "Missions Workflow Context",
		contextRecovery: "Run `luuna-missions prime` after compaction, clear, or new session",
		closeProtocol: {
			warning: 'Before saying "done", run this checklist:',
			steps: [
				"Close completed issues:    luuna-missions close <id1> <id2> ...",
				'File remaining work:       luuna-missions create --title "..." --from <id>',
				`Run quality gates:         ${gates ?? GENERIC_GATES}`,
				"Commit issue changes:      luuna-missions sync",
			],
			footer: "Then push or open a PR as the repo's conventions say.",
		},
		rules: [
			"**Track durable work in missions** (`luuna-missions create`, `luuna-missions ready`, `luuna-missions close`), not markdown task files. In-session checklists (TodoWrite) are fine.",
			"**Claim before starting**: `luuna-missions update <id> --claim` (atomic; fails if someone else has it)",
			"**Never hand-edit `.luuna/missions/*.jsonl`**: `luuna-missions` commands lock, validate, and dedup; hand edits skip all three",
		],
		commandGroups: [
			{
				name: "Finding Work",
				commands: [
					{
						command: "luuna-missions ready",
						description: "Show issues ready to work (no blockers)",
					},
					{ command: "luuna-missions list --status=in_progress", description: "Active work" },
					{ command: "luuna-missions show <id> [<id2> ...]", description: "Detailed issue view" },
					{ command: "luuna-missions search <query>", description: "Full-text search" },
				],
			},
			{
				name: "Creating & Updating",
				commands: [
					{
						command:
							'luuna-missions create --title="..." --type=task|bug|feature|epic --priority=2',
						description: "New issue (priority 0-4, 0=critical)",
					},
					{
						command: "luuna-missions update <id> --claim --as <agent>",
						description: "Claim work atomically (fails if already taken)",
					},
					{
						command: 'luuna-missions create --title="..." --from <id>',
						description: "File work discovered while on <id> (non-blocking provenance)",
					},
					{
						command: "luuna-missions close <id1> <id2> ...",
						description: "Close one or more issues",
					},
				],
			},
			{
				name: "Dependencies & Blocking",
				commands: [
					{ command: "luuna-missions dep add <issue> <depends-on>", description: "Add dependency" },
					{ command: "luuna-missions blocked", description: "Show all blocked issues" },
				],
			},
			{
				name: "Labels",
				commands: [
					{
						command: "luuna-missions label add <id> bug ui",
						description: "Add labels to an issue",
					},
					{ command: "luuna-missions list --label=bug", description: "Filter by label" },
				],
			},
			{
				name: "Sync & Project Health",
				commands: [
					{
						command: "luuna-missions sync",
						description: "Stage and commit .luuna/missions/ changes",
					},
					{ command: "luuna-missions doctor", description: "Check for data integrity issues" },
				],
			},
			{
				name: "Planning",
				notes: [
					"Use `luuna-missions plan` when work is large or ambiguous; submit spawns one child seed per step. For small, well-scoped tasks, just `luuna-missions create`.",
				],
				commands: [
					{
						command: "luuna-missions plan prompt <seed-id>",
						description: "Emit prompt JSON for the LLM to fill",
					},
					{
						command: "luuna-missions plan submit <seed-id> --plan <file>",
						description: "Validate + spawn children",
					},
					{
						command: "luuna-missions plan show <pl-id>",
						description: "Sections, children, nested sub-plans",
					},
				],
			},
		],
		workflows: [
			{
				name: "Starting work",
				commands: [
					"luuna-missions ready                    # Find available work",
					"luuna-missions show <id>                # Review issue details",
					"luuna-missions update <id> --claim      # Claim it",
				],
			},
			{
				name: "Completing work",
				commands: [
					"luuna-missions close <id1> <id2> ...    # Close all completed issues at once",
					"luuna-missions sync                     # Stage + commit .luuna/missions/",
				],
			},
		],
	};
}

function buildCompact(gates: string | null): PrimeSectionsCompact {
	return {
		mode: "compact",
		title: "Missions Quick Reference",
		commands: [
			{ command: "luuna-missions ready", description: "Find unblocked work" },
			{ command: "luuna-missions show <id> [id...]", description: "View one or more issues" },
			{
				command: 'luuna-missions create --title "..."',
				description: "Create issue (--type, --priority, --from)",
			},
			{ command: "luuna-missions update <id> --claim", description: "Claim work (atomic)" },
			{ command: "luuna-missions close <id>", description: "Complete work" },
			{ command: "luuna-missions dep add <a> <b>", description: "a depends on b" },
			{ command: "luuna-missions plan prompt <seed>", description: "Plan large/ambiguous work" },
			{ command: "luuna-missions sync", description: "Stage + commit .luuna/missions/" },
		],
		planningNote:
			"**Planning:** Use `luuna-missions plan` for ambiguous or large work — built-in templates: `feature`, `bug`, `refactor`.",
		closingNote: `**Before finishing:** \`luuna-missions close <ids>\`, run ${gates ? `\`${gates}\`` : GENERIC_GATES}, \`luuna-missions sync\`; push per repo conventions. Never hand-edit \`.luuna/missions/*.jsonl\`.`,
	};
}

// ── Live state ─────────────────────────────────────────────────────────────

const READY_LIMIT = 5;

export interface PrimeIssueRef {
	id: string;
	title: string;
	priority: number;
	assignee?: string;
}

export interface PrimeState {
	inProgress: PrimeIssueRef[];
	ready: PrimeIssueRef[];
	readyCount: number;
}

function ref(i: Issue): PrimeIssueRef {
	return {
		id: i.id,
		title: i.title,
		priority: i.priority,
		...(i.assignee ? { assignee: i.assignee } : {}),
	};
}

async function loadState(missionsDir: string): Promise<PrimeState> {
	const issues = await readIssues(missionsDir);
	const ready = sortIssues(readyIssues(issues, await loadPlanContext(missionsDir)), "priority");
	return {
		inProgress: sortIssues(
			issues.filter((i) => i.status === "in_progress"),
			"priority",
		).map(ref),
		ready: ready.slice(0, READY_LIMIT).map(ref),
		readyCount: ready.length,
	};
}

function refLine(r: PrimeIssueRef): string {
	const who = r.assignee ? ` (@${r.assignee})` : "";
	return `- ${r.id} P${String(r.priority)} ${r.title}${who}`;
}

export function renderState(state: PrimeState): string {
	const lines = ["## Current State", ""];
	if (state.inProgress.length > 0) {
		lines.push("In progress:");
		for (const r of state.inProgress) lines.push(refLine(r));
		lines.push("");
	}
	if (state.readyCount === 0) {
		lines.push("Ready: none");
	} else {
		const more =
			state.readyCount > state.ready.length
				? ` (top ${String(state.ready.length)} of ${String(state.readyCount)})`
				: "";
		lines.push(`Ready${more}:`);
		for (const r of state.ready) lines.push(refLine(r));
	}
	lines.push("");
	return lines.join("\n");
}

function renderFull(s: PrimeSectionsFull): string {
	const lines: string[] = [];
	lines.push(`# ${s.title}`);
	lines.push("");
	lines.push(`> **Context Recovery**: ${s.contextRecovery}`);
	lines.push("");

	lines.push("# Session Close Protocol");
	lines.push("");
	lines.push(s.closeProtocol.warning);
	lines.push("");
	lines.push("```");
	s.closeProtocol.steps.forEach((step, i) => {
		lines.push(`[ ] ${i + 1}. ${step}`);
	});
	lines.push("```");
	lines.push("");
	lines.push(s.closeProtocol.footer);
	lines.push("");

	lines.push("## Core Rules");
	for (const rule of s.rules) {
		lines.push(`- ${rule}`);
	}
	lines.push("");

	lines.push("## Essential Commands");
	lines.push("");
	for (const group of s.commandGroups) {
		lines.push(`### ${group.name}`);
		if (group.notes) {
			for (const note of group.notes) {
				lines.push(note);
				lines.push("");
			}
		}
		for (const cmd of group.commands) {
			lines.push(`- \`${cmd.command}\` — ${cmd.description}`);
		}
		lines.push("");
	}

	lines.push("## Common Workflows");
	lines.push("");
	for (const wf of s.workflows) {
		lines.push(`**${wf.name}:**`);
		lines.push("```bash");
		for (const c of wf.commands) {
			lines.push(c);
		}
		lines.push("```");
		lines.push("");
	}

	return `${lines.join("\n")}`;
}

function renderCompact(s: PrimeSectionsCompact): string {
	const lines: string[] = [];
	lines.push(`# ${s.title}`);
	lines.push("");
	lines.push("```");
	// Align descriptions at a fixed column for readability.
	const pad = 26;
	for (const c of s.commands) {
		const cmd = c.command.length >= pad ? `${c.command} ` : c.command.padEnd(pad);
		lines.push(`${cmd}# ${c.description}`);
	}
	lines.push("```");
	lines.push("");
	lines.push(s.planningNote);
	lines.push("");
	lines.push(s.closingNote);
	lines.push("");
	return lines.join("\n");
}

export function buildFullSections(projectRoot: string | null = null): PrimeSectionsFull {
	return buildFull(gatesCommand(projectRoot));
}

export function buildCompactSections(projectRoot: string | null = null): PrimeSectionsCompact {
	return buildCompact(gatesCommand(projectRoot));
}

export function renderPrimeSections(sections: PrimeSections): string {
	return sections.mode === "compact" ? renderCompact(sections) : renderFull(sections);
}

async function findMissionsDirOrNull(): Promise<string | null> {
	try {
		return await findMissionsDir();
	} catch {
		return null; // No missions dir — static template only, no live state.
	}
}

// Live state is best effort: prime runs as a SessionStart hook, where a
// failure must never block the session.
async function loadStateSafe(missionsDir: string | null): Promise<PrimeState | null> {
	if (!missionsDir) return null;
	try {
		return await loadState(missionsDir);
	} catch {
		return null;
	}
}

// A custom PRIME.md is opaque — we can't structurally parse it, so sections is null.
async function primeContent(
	missionsDir: string | null,
	sections: PrimeSections,
): Promise<{ sections: PrimeSections | null; content: string }> {
	const custom = missionsDir ? Bun.file(join(missionsDir, PRIME_FILE)) : null;
	if (custom && (await custom.exists())) return { sections: null, content: await custom.text() };
	return { sections, content: renderPrimeSections(sections) };
}

function withState(content: string, state: PrimeState | null): string {
	if (!state) return content;
	let sep = "\n\n";
	if (content === "" || content.endsWith("\n\n")) sep = "";
	else if (content.endsWith("\n")) sep = "\n";
	return `${content}${sep}${renderState(state)}`;
}

export async function run(args: string[]): Promise<void> {
	const jsonMode = args.includes("--json");
	const compact = args.includes("--compact");
	const exportMode = args.includes("--export");

	const missionsDir = await findMissionsDirOrNull();
	const projectRoot = missionsDir ? projectRootFromMissionsDir(missionsDir) : process.cwd();
	const defaults = compact ? buildCompactSections(projectRoot) : buildFullSections(projectRoot);

	// --export always outputs the default template, without live state.
	if (exportMode) {
		const content = renderPrimeSections(defaults);
		if (jsonMode) {
			await outputJson({ success: true, command: "prime", sections: defaults, content });
		} else {
			process.stdout.write(content);
		}
		return;
	}

	const { sections, content } = await primeContent(missionsDir, defaults);
	const state = await loadStateSafe(missionsDir);
	if (jsonMode) {
		await outputJson({ success: true, command: "prime", sections, state, content });
	} else {
		process.stdout.write(withState(content, state));
	}
}

export function register(program: Command): void {
	program
		.command("prime")
		.description("Output AI agent context")
		.option("--compact", "Condensed quick-reference output")
		.option("--export", "Output the default template")
		.option("--json", "Output as JSON")
		.action(async (opts: { compact?: boolean; export?: boolean; json?: boolean }) => {
			const args: string[] = [];
			if (opts.compact) args.push("--compact");
			if (opts.export) args.push("--export");
			if (opts.json) args.push("--json");
			await run(args);
		});
}

// Internal exports for testing.
export const _internal = { gatesCommand };
