#!/usr/bin/env bun
// Compatibility entrypoint for the package bins and Luuna's pinned launcher.
// Command behavior lives in the Go executable; this file only builds and runs
// the matching native revision when a checkout has no cached binary yet.
import { ensureNativeBinary } from "../scripts/native-build.ts";

export { VERSION } from "./version.ts";

try {
	const native = ensureNativeBinary();
	const child = Bun.spawn([native, ...process.argv.slice(2)], {
		cwd: process.cwd(),
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	process.on("SIGINT", () => child.kill("SIGINT"));
	process.on("SIGTERM", () => child.kill("SIGTERM"));
	process.exitCode = await child.exited;
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`Error: ${message}\n`);
	process.exitCode = 1;
}
