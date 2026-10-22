// Legacy (pre-Luuna) layout migration. This is the only module that may name
// the old Seeds-era storage directory, hook commands and ignore patterns.

import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MISSIONS_DIR } from "./types.ts";

const LEGACY_DIR = ".seeds";
const LUUNA_DIR = ".luuna";

/** Hook commands written by the Seeds-era `setup claude`; replaced on re-install. */
export const LEGACY_HOOK_COMMAND_RE = /^\s*(?:sd|seeds)\s+(prime|guard)(\s|$)/;

function isSymlink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

function exists(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
}

/** Rewrite managed `.gitattributes` / `.gitignore` lines that name the legacy path. */
function rewriteIgnoreFiles(projectRoot: string): void {
	for (const name of [".gitattributes", ".gitignore"]) {
		const file = join(projectRoot, name);
		if (!existsSync(file) || isSymlink(file)) continue;
		const before = readFileSync(file, "utf8");
		const after = before.replace(
			/(^|[\s!])\.seeds(?=\/|\s|$)/gm,
			(_m, pre: string) => `${pre}${MISSIONS_DIR}`,
		);
		if (after !== before) writeFileSync(file, after);
	}
}

/**
 * Move a legacy `.seeds/` store at `projectRoot` to `.luuna/missions/`.
 * Returns true when a move happened. Throws when both layouts exist or a
 * symlink is involved. The single notice line goes to stderr, never stdout.
 */
export function migrateLegacyLayout(projectRoot: string): boolean {
	const legacy = join(projectRoot, LEGACY_DIR);
	if (!exists(legacy)) return false;
	const luuna = join(projectRoot, LUUNA_DIR);
	const target = join(projectRoot, MISSIONS_DIR);
	if (exists(target)) {
		throw new Error(
			`Both ${LEGACY_DIR}/ and ${MISSIONS_DIR}/ exist in ${projectRoot}. Resolve manually: keep ${MISSIONS_DIR}/ and remove ${LEGACY_DIR}/, or the reverse.`,
		);
	}
	if (isSymlink(legacy) || isSymlink(luuna)) {
		throw new Error(
			`Refusing to migrate ${LEGACY_DIR}/ in ${projectRoot}: ${LEGACY_DIR} or ${LUUNA_DIR} is a symlink. Move it to ${MISSIONS_DIR}/ manually.`,
		);
	}
	if (!lstatSync(legacy).isDirectory()) return false;
	mkdirSync(luuna, { recursive: true });
	renameSync(legacy, target);
	rewriteIgnoreFiles(projectRoot);
	process.stderr.write(`Migrated legacy ${LEGACY_DIR}/ to ${MISSIONS_DIR}/ in ${projectRoot}\n`);
	return true;
}

/**
 * Rewrite Seeds-era HTML comment markers (`<!-- seeds:start -->`,
 * `<!-- seeds:plan-backref:start -->`, `<!-- seeds-onboard-schema:N -->`, ...)
 * to the current `missions` spelling so existing CLAUDE.md sections and issue
 * descriptions keep being recognised.
 */
export function upgradeLegacyMarkers(text: string): string {
	return text.replace(/<!-- seeds(?=[:-])/g, "<!-- missions");
}
