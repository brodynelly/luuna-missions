import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceDigest } from "./native-build.ts";

test("native cache key includes embedded assets", () => {
	const fixture = mkdtempSync(join(tmpdir(), "missions-native-digest-"));
	try {
		mkdirSync(join(fixture, "cmd"));
		mkdirSync(join(fixture, "internal", "cli"), { recursive: true });
		writeFileSync(join(fixture, "package.json"), '{"version":"0.6.0"}');
		writeFileSync(join(fixture, "go.mod"), "module example.test/missions\n");
		writeFileSync(join(fixture, "go.sum"), "");
		writeFileSync(join(fixture, "cmd", "main.go"), "package main\n");
		const help = join(fixture, "internal", "cli", "help.txt");
		writeFileSync(help, "before\n");
		const before = sourceDigest(fixture);
		writeFileSync(help, "after\n");
		expect(sourceDigest(fixture)).not.toBe(before);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});
