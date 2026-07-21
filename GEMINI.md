# Gemini Developer Guide: World of ClaudeCraft

**The root `CLAUDE.md` and the per-directory `CLAUDE.md` files are the canonical source of
truth.** This project is driven primarily through Claude Code; read the root `CLAUDE.md` in full
and the local `CLAUDE.md` when you open files in a directory. They own the architecture, the hard
invariants (sim purity and determinism, graphics fairness, i18n, secrets, the no-em-dash and
no-emoji rule), the module-first doctrine, the commands, the UI / a11y / i18n rules, and the git
conventions (Conventional Commits WITH a scope). When this guide and `CLAUDE.md` disagree,
**`CLAUDE.md` wins.** Do not keep a second copy of those rules here; this file holds only the
Gemini-session notes that have no home in `CLAUDE.md`.

`GEMINI.md` is tracked (committed); do not add it to `.gitignore`.

## Model capabilities and optimization
- **Thinking level.** Raise it for complex logic (simulation consistency, pathfinding, WS sync,
  DB schemas, multi-step algorithms); lower it for lightweight edits (docs, simple UI alignment)
  to save latency and cost. Reason through edge cases and blast radius before writing code, and
  red-team your own diff before declaring it done.
- **Context-cache discipline (large input discount).** Keep imports stable and grouped at the
  top of files; avoid gratuitous edits to large files (`src/sim/sim.ts`, `src/ui/hud.ts`, this
  guide), since any prefix or import change invalidates the cache and raises latency and cost.
  Keep static reference material early in the prompt.
- **Agentic loop.** Spawn a research subagent for long-horizon research or verbose E2E runs to
  keep the main context clean. Use the native `schedule` tool for delayed or recurring checks
  instead of terminal `sleep`. Gemini at high reasoning tends toward flowery narration, so keep
  comments and explanations concise and functional.

## MCP setup
Configs live in `~/.gemini/config/mcp_config.json` and `~/.gemini/settings.json`.
- **SSE / HTTP transport (Context7):** use the `"url"` key, NOT `"httpUrl"` (the connector
  parser does not recognize `httpUrl` and fails with `no connector can handle spec`).
- **Stdio transport (Playwright, Postgres):** use the `"command"` and `"args"` keys.
- **Servers:** Playwright drives and verifies the client at `http://localhost:5173`
  (`browser_tabs` action new, `browser_navigate`, `browser_click` / `browser_press_key` /
  `browser_evaluate`, `browser_take_screenshot`); Postgres needs `npm run db:up` first; Context7
  resolves library ids and pulls version-specific docs (query it before using Three.js, pg, and
  similar to avoid deprecated APIs).
