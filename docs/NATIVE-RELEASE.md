# Native release: quick reference

This page summarizes the native release tooling. [RELEASING.md](RELEASING.md) has the full details and the owner gates. Nothing here publishes anything: there is no tag, GitHub Release, npm publish, signing or attestation.

## Artifacts

- **Package:** `@luuna/missions-cli` (unpublished). The binary prints `internal_version` `0.6.0`, the upstream compatibility baseline taken from `package.json`.
- **Archive:** `luuna-missions_<version>_<os>_<arch>.tar.gz` for `darwin|linux` × `arm64|amd64`. It holds exactly `bin/luuna-missions` and `bin/lms`. `lms` is a byte-identical copy. Both entries are mode 0755 with owner `0:0`. The aliases `lm`/`missions` stay Bun package bins only.
- **Fixed UTC mtime:** 2000-01-01T00:00:00Z (`946684800`), so the archive bytes do not depend on the builder's time zone.
- **Files next to the archive:** `LICENSE`, `UPSTREAM.md`, `provenance.json` and `SHA256SUMS`. `SHA256SUMS` covers the archive, `provenance.json`, `LICENSE` and `UPSTREAM.md`.
- **Provenance:** `provenance.json` is self-reported metadata, not an attestation. It records the commit, ref, `source_tree_dirty`, run id, runner, Go version, build flags, the archive SHA256, `archive_version` and `internal_version`. Values it cannot determine are JSON `null` rather than guesses.

## Commands (host platform)

```sh
GOTOOLCHAIN=local go test ./...
sh scripts/release/test-release-scripts.sh   # offline; stub fixtures and stub go
out=$(mktemp -d)
a=$(sh scripts/release/package.sh --version 0.0.0-local --out "$out")
sh scripts/release/check-archive.sh --require-run "$a"
```

`check-archive.sh` validates the name, `SHA256SUMS` and the entry listing before it extracts anything. On the host it then runs `--help`/`--version` through both names and requires identical output. Cross-built targets are checked without being executed. `--require-run` makes that a failure (exit 6). `--require-run` with `--no-run` is a usage error (exit 2). A `SHA256SUMS` problem exits 4.

## Workflow (manual artifacts only)

`.github/workflows/release.yml` runs only on `workflow_dispatch` with a `version` input. It has `contents: read` and four host-native runners: `macos-14`, `macos-15-intel`, `ubuntu-latest` and `ubuntu-24.04-arm`. Each job runs Go tests → release-script tests → `package.sh` → `check-archive.sh --require-run` → `actions/upload-artifact` (14-day retention). The attestation step is commented out. Downloading the artifacts, signing and releasing are owner gates.

## Clean-checkout validation fix

`AGENTS.md` mentions `dist/`, which is ignored and exists only after a native build. On a fresh clone, `bun run check:agents` (and therefore `bun run verify`) failed with ``referenced path `dist` does not exist``. `check:agents` now passes `--known-missing dist`. `.gitignore` adds `.tac/tools/` next to `.tac/runs/`. No validator logic, placeholder files or `.gitkeep` files were added.

## Local Bun

Release builds do not need Bun. For component validation, use the repo-local Bun 1.4.3 in the ignored `.tac/tools/bin/` rather than a global install:

```sh
PATH="$PWD/.tac/tools/bin:$PATH" bun run verify
```

## Verification limits

- A local run proves only the host platform. Other targets are claimed only after their native runner (or the owner, on that platform) executes `check-archive.sh --require-run`.
- Linux binaries are static (`CGO_ENABLED=0`). musl/Alpine is not claimed. Windows is out of scope.
- macOS binaries are unsigned. Gatekeeper may quarantine them after a browser download.
- The workflow's Go version comes from the `go 1.22` minimum in `go.mod`. Check the exact version in `provenance.json`.
