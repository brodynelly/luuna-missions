// Cross-platform stand-ins for external CLIs (e.g. a fake `ml`) in tests.
//
// POSIX runs the stand-in directly through a `#!/usr/bin/env bun` shebang.
// Windows cannot exec shebang scripts, so the script is written as
// `<name>.js` next to a `<name>.cmd` launcher that Bun.which resolves through
// PATHEXT. Bun refuses to pass arguments containing cmd.exe metacharacters
// (such as `"` or `&`) to a .cmd file, so tests must invoke stand-ins with
// plain arguments.

import { chmod, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

/** Write an executable `name` into binDir that runs `script` with Bun. */
export async function writeFakeBin(binDir: string, name: string, script: string): Promise<void> {
	if (process.platform === "win32") {
		await writeFile(join(binDir, `${name}.js`), script);
		await writeFile(join(binDir, `${name}.cmd`), `@"${process.execPath}" "%~dp0${name}.js" %*\r\n`);
		return;
	}
	const scriptPath = join(binDir, name);
	await writeFile(scriptPath, `#!/usr/bin/env bun\n${script}`);
	await chmod(scriptPath, 0o755);
}

/** The current PATH with dir prepended, using the platform's list delimiter. */
export function pathWith(dir: string): string {
	return `${dir}${delimiter}${process.env.PATH ?? ""}`;
}
