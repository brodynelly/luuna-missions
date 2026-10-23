# Patch: clean-checkout verification for native release (C-missions)

This follows up on `specs/chore-native-release.md`. It only fixes verification on a fresh checkout. The release scripts, workflow, Go/TS runtime sources and other checks stay as they are. Nothing is committed, tagged, released or published.

## Problem

- `AGENTS.md` mentions the build output directory as `` `dist/` ``. `scripts/validate-agents-md.ts` (`extractBacktickedPaths`) strips the trailing slash, so it checks the path `dist`.
- `.gitignore` ignores `dist/`, and the directory only appears after the native launcher or `scripts/native-build.ts` has run. On a fresh clone, `bun run check:agents` fails with ``referenced path `dist` does not exist``. That failure also breaks `bun run verify`, which calls `check:agents` before the tests.
- The local validation toolchain lives in `.tac/tools/`: a Bun 1.4.3 binary at `.tac/tools/bin/bun`, plus `node_modules/`, `package.json` and `package-lock.json`. Git ignores `.tac/runs/` and `.tac/tools/node_modules/` today, but `.tac/tools/bin/`, `.tac/tools/package.json` and `.tac/tools/package-lock.json` still show up in `git status`.

## Constraints

- Use the existing `--known-missing` support in `scripts/validate-agents-md.ts`. Do not add tracked `dist/` content, placeholder files or `.gitkeep` files.
- Do not change the validator logic, its tests, `AGENTS.md` wording, or the existing `--known-missing` entries (`docs/check-all-standard.md`, `templates/l5-toolkit/scripts`). Do not touch any other check.
- Do not edit, move or delete anything under `.tac/`. The only `.tac` change is the new ignore rule.
- Do not install anything globally. Use the Bun binary already at `.tac/tools/bin/bun`.

## Tasks

1. **`package.json` `check:agents`:** add `--known-missing dist` to the existing argument list and change nothing else. The result is:
   `bun run scripts/validate-agents-md.ts --known-missing docs/check-all-standard.md --known-missing templates/l5-toolkit/scripts --known-missing dist`
   The value must be `dist`, with no trailing slash, because it has to match the cleaned token.
2. **`.gitignore`:** in the "agent-local scratch" section, add `.tac/tools/` next to the existing `.tac/runs/` entry. Leave every other rule as it is, including `dist/`.
3. **`docs/RELEASING.md`:** only if it describes local validation, add one sentence. It should say that `check:agents` treats the ignored `dist/` as known-missing, and that the local Bun lives in ignored `.tac/tools/`. Make no other doc edits.

## Regression check (fresh-checkout simulation)

Run from the repository root. This check moves an existing generated `dist/` aside temporarily and always restores it. It never deletes `dist/` and never overwrites a backup.

```sh
set -eu
export PATH="$PWD/.tac/tools/bin:$PATH"
test "$(bun --version)" = "1.4.3"

bak=""
if [ -e dist ]; then
  bak=$(mktemp -d "${TMPDIR:-/tmp}/lms-dist-bak.XXXXXX")
  mv dist "$bak/dist"
fi
restore() {
  if [ -n "$bak" ] && [ -e "$bak/dist" ]; then
    if [ -e dist ]; then
      # verify regenerated dist; keep regenerated copy beside the original, do not delete either
      mv dist "$bak/dist.regenerated"
    fi
    mv "$bak/dist" dist
    echo "restored original dist/ (regenerated copy, if any, at $bak/dist.regenerated)"
  fi
}
trap restore EXIT INT TERM

test ! -e dist
bun run check:agents          # must pass with dist absent
bun run verify                # full suite with dist absent at start
```

Expected results:

- `check:agents` exits 0 while `dist/` is absent.
- `verify` exits 0. It may regenerate `dist/` through the native build, which is expected.
- After the trap runs, the original `dist/` is back in place, byte for byte. Nothing the user had is deleted.

Negative control: temporarily run the validator without the new flag, for example `bun run scripts/validate-agents-md.ts --known-missing docs/check-all-standard.md --known-missing templates/l5-toolkit/scripts`, while `dist/` is absent. It must still fail on `dist`. That shows the flag is the actual fix. Do not run the control with the flag removed from `package.json`.

## Validation

```sh
export PATH="$PWD/.tac/tools/bin:$PATH"
bun --version                                         # 1.4.3 (local .tac/tools)
git diff --stat -- package.json .gitignore            # only the two intended lines
git check-ignore -v .tac/tools/bin/bun .tac/tools/package.json .tac/tools/package-lock.json dist/x
git status --porcelain --untracked-files=all | grep '^?? .tac/' && exit 1 || true   # no .tac entries untracked
git ls-files dist .tac                                # empty: no tracked dist or .tac content
# regression check above (dist moved aside, check:agents, full verify, dist restored)
GOTOOLCHAIN=local go test ./...
sh scripts/release/test-release-scripts.sh
```

Report any failing or skipped command with its output. Never record a check as passing if it did not run, for example because `go` is missing or a step was skipped.

## Out of scope

- Validator code changes, new allow-list mechanisms, changes to other `--known-missing` entries
- Tracked `dist/` artifacts
- CI workflow edits
- Changes to `.tac` state or logs
- Commits, tags or pushes

SPEC: specs/patch-native-release-clean-verify.md
