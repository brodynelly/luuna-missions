import { ensureNativeBinary } from "./native-build.ts";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const go = process.env.LUUNA_MISSIONS_GO || "go";
const tests = Bun.spawnSync([go, "test", "./..."], {
	cwd: root,
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit",
});
if (tests.exitCode !== 0) process.exit(tests.exitCode ?? 1);

const binary = ensureNativeBinary();
const parity = Bun.spawnSync(["bun", "scripts/parity.mjs", "--go", binary, "--require-go", "--suite", "all"], {
	cwd: root,
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit",
});
process.exitCode = parity.exitCode ?? 1;
