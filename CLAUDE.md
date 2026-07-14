# Chronica

Observer-only fantasy world sim in the browser: deterministic simulation, LLM-driven kings, self-writing history book, time-machine replay.

**Start here: v1 (M0-M6) per `docs/08-roadmap.md`; v2 (M7-M12, SHIPPED) per `docs/12-v2-upgrade.md`; v2.5 visual overhaul (V1-V6, current work) per `docs/13-visual-overhaul.md`.** Both assume zero context: they tell you what this project is, which design doc governs which system, the ground rules (determinism, import boundaries, anti-scope), and exactly what to build milestone by milestone. For v2 work read `docs/12-v2-upgrade.md` §"How to use this doc" first; visual/UX designs it references live in `docs/11-visual-polish.md`.

Rules that always apply:
- `docs/08-roadmap.md` (v1) and `docs/12-v2-upgrade.md` (v2) are the build order; milestones are strictly sequential.
- The em-dash character is forbidden everywhere in this repo: code, docs, UI strings, commit messages.
- Determinism rules in `docs/01-architecture.md` are inviolable in `/src/sim`.
- Anti-scope in `docs/00-vision.md` is binding : do not add features from the excluded list.
- Every code change keeps the determinism CI suite green.
- New edge cases go in `docs/10-edge-cases.md` with a test.
