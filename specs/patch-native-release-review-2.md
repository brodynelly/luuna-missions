# Patch: native release review 2 blockers (C-missions)

This follows `specs/chore-native-release.md` and `specs/patch-native-release-clean-verify.md`. It fixes only the blockers found in final review. Workflow triggers and permissions, the archive layout, Go/TS runtime sources, `package.json`, `.gitignore` and `.tac/` stay as they are. Nothing is committed, tagged, released or published.

## Blockers

1. **`SHA256SUMS` is optional and may be a symlink.** `scripts/release/check-archive.sh:65-71` skips checksum verification when no `SHA256SUMS` file is present. `-f` also follows symlinks. The tests encode this behavior: `scripts/release/test-release-scripts.sh:92-93` passes a good archive that has no sums file, and every negative fixture at lines 106-159 also has none.
2. **Provenance dirtiness is inaccurate.** `scripts/release/package.sh:170` runs `git status --porcelain --untracked-files=no`, so untracked, non-ignored source files (for example a new `internal/x.go`) are reported as `"tracked_tree_dirty": false`. When Git is unavailable or the checkout is not a repository, `dirty` stays `false` (line 169), and `commit`/`ref` become the string `"unknown"` (lines 167-168) instead of JSON `null`.
3. **The archive bytes depend on the time zone.** `scripts/release/package.sh:151` runs `touch -t 200001010000` in the local time zone, so the tar mtime, and with it the archive SHA256, changes with `TZ`.
4. **tar failures are masked.** `scripts/release/package.sh:154-160` runs `(… tar …) | gzip >file`. POSIX `sh` has no `pipefail`, so a failing `tar` still leaves exit 0 and a truncated or empty archive that is then checksummed.
5. **CI can pass without executing the binaries on the host.** `.github/workflows/release.yml:58-59` relies on `check-archive.sh`. When the host and target do not match, for example because of an unexpected runner arch or a `uname` mismatch, the script prints `not executed` and still exits 0 (`check-archive.sh:110-112`). CI never fails if the native host run did not happen.

## Tasks

1. **`check-archive.sh` requires `SHA256SUMS`:**
   - Require `$dir/SHA256SUMS` to exist as a regular file that is not a symlink (`[ -f … ] && [ ! -L … ]`). Otherwise exit 4.
   - Require exactly one line whose second field equals `$name`. Accept the optional `*` binary-mode prefix on that field and treat it as the same name.
   - Require the first field to match `^[0-9a-f]{64}$`, and require it to equal the computed digest. Exit 4 on any violation.
   - Do these checks before listing or extracting the archive.
   - Update the header comment and the `docs/RELEASING.md` "before it extracts" list. That list becomes: "2. The mandatory `SHA256SUMS`, which must be a regular file, not a symlink, with exactly one matching entry."
2. **`check-archive.sh --require-run`:** add an option. When it is given and execution did not happen (target is not the host, or `--no-run` was also given), exit 6 with a clear message. `--require-run` together with `--no-run` is a usage error and exits 2.
3. **Workflow:** on `.github/workflows/release.yml:59`, call `check-archive.sh --require-run …`. Change nothing else in the workflow.
4. **`package.sh` provenance:**
   - If `git -C "$root" rev-parse --is-inside-work-tree` fails, emit `"commit": null`, `"ref": null` (unless `GITHUB_REF` is set) and `"source_tree_dirty": null`.
   - Otherwise compute dirtiness with `git -C "$root" status --porcelain --untracked-files=normal`. That includes untracked, non-ignored files and still respects `.gitignore`. If that command fails, emit `null`. Do not let it fall back to `false`.
   - Rename the key from `tracked_tree_dirty` to `source_tree_dirty`, and update `docs/RELEASING.md:18` to match ("source-tree dirtiness, including untracked non-ignored files; `null` when unknown").
   - Emit unknown `commit` and `ref` as JSON `null`, not as a quoted string. Unknown `go` stays a string only if you document it; using `null` is preferred for consistency.
5. **TZ-independent mtime:** use `TZ=UTC0 touch -t 200001010000 …` so the stored mtime is always `946684800`.
6. **Propagate tar failures:** write the tar stream to a file first and gzip it in a separate command, so each exit status is checked under `set -e`:
   ```sh
   (cd "$work" && tar … -cf "$work/archive.tar" bin/luuna-missions bin/lms)
   gzip -n -9 <"$work/archive.tar" >"$out/$archive"
   ```
   Use the same structure for the GNU and BSD branches. Do not add `pipefail`, because it is not POSIX.
7. **Tests (`scripts/release/test-release-scripts.sh`), offline, no Go needed:**
   - Every positive and negative fixture that should reach the entry checks must write a matching `SHA256SUMS` next to it. Add a helper `sums DIR NAME`.
   - Add new cases, each with its expected exit code:
     - Archive without `SHA256SUMS`: exit 4.
     - `SHA256SUMS` that is a symlink to a valid sums file: exit 4.
     - Two entries for the archive name, even identical ones: exit 4.
     - A non-hex or short digest: exit 4.
     - `--require-run` on a foreign-platform archive: exit 6.
     - `--require-run --no-run`: exit 2.
     - `--require-run` on the good host archive: exit 0, with the output containing `executed on host`.
   - For the corrupt-archive case, the sums file must match the corrupt bytes, so the result is still exit 5.
   - Add a test that runs `package.sh` with `LUUNA_MISSIONS_GO` pointing at a stub `go`. The stub writes a small `#!/bin/sh` file to the `-o` path for `build` and prints `go0.0-stub` for `env GOVERSION`. With that stub, check:
     - Two runs with `TZ=UTC` and `TZ=Pacific/Kiritimati` produce byte-identical archives.
     - The stored mtime is `946684800`.
     - In a temporary Git clone of the repository, or a temp copy initialized with `git init` and one commit of the needed files, an untracked non-ignored file yields `"source_tree_dirty": true`, and a clean tree yields `false`.
     - Outside any Git work tree (a copy with no `.git`), the provenance has `"commit": null` and `"source_tree_dirty": null`.
     - A `tar` shim on `PATH` that exits 1 makes `package.sh` exit non-zero.
   - Tests must use temp directories only and must never modify the real working tree.

## Validation

```sh
GOTOOLCHAIN=local go test ./...
sh scripts/release/test-release-scripts.sh
out=$(mktemp -d); a=$(sh scripts/release/package.sh --version 0.0.0-local --out "$out"); sh scripts/release/check-archive.sh --require-run "$a"
o1=$(mktemp -d); o2=$(mktemp -d)
TZ=UTC sh scripts/release/package.sh --version 0.0.0-local --out "$o1" >/dev/null
TZ=Asia/Tokyo sh scripts/release/package.sh --version 0.0.0-local --out "$o2" >/dev/null
cmp "$o1"/*.tar.gz "$o2"/*.tar.gz
grep -n 'source_tree_dirty' "$o1/provenance.json"   # true here: working tree has untracked release files
grep -nE 'gh release|action-gh-release|npm publish|attest-build-provenance' .github/workflows/release.yml   # only commented lines
```

Report any failing or skipped command with its output. Never record a check as passing if it did not run.

## Out of scope

- Workflow trigger, permission, matrix or attestation changes
- Archive layout changes
- Signing
- Commits, tags, pushes or publication
- Changes to `.tac` state or logs
