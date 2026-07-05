# AGENTS.md

Any non-Claude coding agent (Codex and similar) treats this file as the entry point for World
of ClaudeCraft. **The root `CLAUDE.md` and the per-directory `CLAUDE.md` files are the canonical
source of truth.** Read the root `CLAUDE.md` in full, and the local `CLAUDE.md` when you open
files in a directory (`src/sim/`, `src/render/`, `src/ui/`, `server/`, ...). They own the
architecture, the hard invariants (sim purity and determinism, graphics fairness, i18n,
secrets), the module-first doctrine, the conventions, the commands, and the QA gate. If anything
here disagrees with `CLAUDE.md`, `CLAUDE.md` wins. This file holds ONLY the agent-runtime notes
that are not themselves repo facts.

## Startup checklist
1. Run `git status --short` before edits.
2. Preserve unrelated user work: do not revert, discard, stage, or commit changes unless asked.
3. Read the root `CLAUDE.md`, then `GEMINI.md` for any supplemental local context.
4. Use `rg` and targeted reads for discovery; read existing code and follow local patterns.

## Tool notes
- Plain Node `http` + `ws` server, no Express. Vanilla DOM UI, no Tailwind or new UI framework.
- For external library or API usage, fetch current docs via Context7 or the official docs
  rather than writing from memory.
- Keep `AGENTS.md` and `GEMINI.md` tracked: do not add either to `.gitignore`.
- Do not commit unless asked; if committing, stage only the files for your change and use
  Conventional Commits with a scope (`<type>(scope): ...`), matching `CLAUDE.md`.
