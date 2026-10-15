# Unified anamnesis and compact export

- Branch: codex/unified-anamnesis-export; managed deploy-only-main worktree.
- Scope approved by user: anamnesis feature, its routes/API/server/contracts/schema, shared section navigation, settings trainer composition and related tests/docs.
- Contract: replace report ranges with markerIds/dateKeys; private preview returns prepared HTML, page count and snapshot key; export checks snapshot and grants.
- Data: existing private files preserved; migrate historical report selections; local synthetic fixtures only.
- Acceptance: unified mounted sections, contextual recognition/review, exact date selection, shared compact pagination and saved-file preview.
- Checks: fresh/existing migrations, PDF fidelity/security, static/unit/integration/build, Docker PDF smoke and all three full E2E suites on final revision.
- Delivery: PR; no merge or deployment as part of the current request.
