# Luuna Missions

Git-native tickets and structured work plans. This is Luuna's maintained MIT-licensed fork of Seeds (see Origin and attribution below), imported from upstream version **0.6.0**. The Luuna package identity is **@luuna/missions-cli**. It is maintained in the independent public repository [brodynelly/luuna-missions](https://github.com/brodynelly/luuna-missions). The npm package remains private and unpublished.

Run from this directory with Bun 1.4.3:

```bash
bun install --frozen-lockfile --ignore-scripts
bun src/index.ts --help
bun run verify
```

The primary executable is `luuna-missions` with `lm` as its short alias.

Project data lives in `.luuna/missions/` (`issues.jsonl`, `plans.jsonl`, `templates.jsonl`, `config.yaml`). Environment variables use the `LUUNA_MISSIONS_` prefix. A legacy `.seeds/` directory is moved to `.luuna/missions/` automatically the first time a command runs; see [MIGRATION.md](MIGRATION.md). Luuna consumes a pinned Git submodule and integrates through the CLI/JSON boundary (Atlas also exports a TypeScript library); runtime policy and approvals remain Luuna's responsibility.

Self-upgrade is disabled while the package is private. Update through a reviewed commit in this repository; never replace this fork with a similarly named registry package. Dependency installs do not change Git hooks.

Read [UPSTREAM.md](UPSTREAM.md) for attribution and provenance, [AGENTS.md](AGENTS.md) for development rules, and [the original README](docs/UPSTREAM-README.md) for inherited command examples. Upstream release/runbook documents are historical references and do not authorize publication.

## Maintenance and releases

The repository owner and release maintainer is `brodynelly`. CI runs the frozen Bun 1.4.3 dependency installation, type checks, instruction checks and full suite on Linux. Registry publishing is disabled and requires no npm token. Luuna pins a reviewed commit, never a floating branch; update its submodule only after CI and the consumer smoke pass. See [MIGRATION.md](MIGRATION.md) for the verified source baseline.

## Origin and attribution

Luuna Missions is derived from [Seeds](https://github.com/jayminwest/seeds) 0.6.0 by Jaymin West (MIT). The original license is preserved in [LICENSE](LICENSE), and provenance is recorded in [UPSTREAM.md](UPSTREAM.md). Seeds is an independent project; Luuna Missions is not affiliated with or endorsed by its authors.
