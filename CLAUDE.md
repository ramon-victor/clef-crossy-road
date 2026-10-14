@AGENTS.md

## Claude Code notes

- Claude Code reads `CLAUDE.md`, not `AGENTS.md`; the import above keeps a single source of truth. Do not duplicate rules here.
- Use plan mode before touching ported game rules in `packages/core` or the `Observation` schema.
- `.env` holds a real API token. Never `cat`/`Read` it into the conversation; load it with `node --env-file=.env`.
