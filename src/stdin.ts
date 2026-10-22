// Read all of stdin as UTF-8 text.
//
// Bun.stdin.text() is deliberately not used: on Windows, a pending
// Bun.stdin.text() that is not under a top-level await does not keep the event
// loop alive, so the CLI exits 0 before the read completes and piped input is
// silently dropped (observed with Bun 1.4.3 for shell pipes, file redirects and
// spawned children). Consuming Bun.stdin.stream() holds the loop open on every
// platform.
export async function readStdin(): Promise<string> {
	return await new Response(Bun.stdin.stream()).text();
}
