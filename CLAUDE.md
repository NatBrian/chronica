# Chronica

Observer-only fantasy world sim in the browser: deterministic simulation, LLM-driven kings, self-writing history book, time-machine replay.

**Start here: `docs/08-roadmap.md`** — the execution playbook. It assumes zero context: tells you what this project is, which design doc governs which system, the ground rules (determinism, import boundaries, anti-scope), and exactly what to build milestone by milestone.

Rules that always apply:
- `docs/08-roadmap.md` is the build order; milestones are strictly sequential.
- Determinism rules in `docs/01-architecture.md` are inviolable in `/src/sim`.
- Anti-scope in `docs/00-vision.md` is binding — do not add features from the excluded list.
- Every code change keeps the determinism CI suite green.
- New edge cases go in `docs/10-edge-cases.md` with a test.
