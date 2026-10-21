# Repository extraction, October 21, 2026

Maintainer and release owner: brodynelly. Destination: https://github.com/brodynelly/luuna-missions.

- Source: brodynelly/luuna at `fd42d59c5f608b9120d9cdc2e2354b66f945a5ed`, path `components/missions`.
- Component-scoped history: `git subtree split --prefix=components/missions fd42d59c5f608b9120d9cdc2e2354b66f945a5ed` produced `30f32af42223e8fab46f6e3e0e9272bfe11354cc`.
- The extracted baseline tree exactly matches the source subtree before independent-repository metadata changes.
- Original upstream provenance and pre-branding import revision remain in UPSTREAM.md; the complete earlier monorepo history stays in Luuna.
- Source, data formats, aliases, dependencies and lockfile are unchanged by extraction. LICENSE SHA-256: `9d36b754124311e7363b9f800e147f95b4dcaea008aa3565b70e15b8a7462f0a`.
- This commit adds standalone ownership, documentation and CI. Luuna consumes the exact reviewed Git commit as a submodule at the existing path.
- No registry package is published. GitHub access supplies source retrieval; npm release credentials are intentionally unnecessary.

Visibility: public, explicitly authorized by the owner on October 21, 2026. Luuna remains private. No private authoring records or credential files are included in the extracted history.

The owner requested the explicit luuna-* repository names on October 21, 2026. GitHub repository identity, history and CI are preserved by rename; the canonical destination is brodynelly/luuna-missions.
