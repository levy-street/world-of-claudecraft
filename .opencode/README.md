# World of ClaudeCraft OpenCode integration

Project-owned tooling that makes OpenCode a native development environment for
World of ClaudeCraft (WoCC). It is built on OpenCode's own mechanisms: markdown
agents, the plugin API, and native skill discovery. It does not copy Claude
Code's hook protocol and it does not touch `.claude/`, which remains the
canonical source for the Claude workflow.

This directory is committed project infrastructure. It belongs to the WoCC
repository, not to any individual contributor.

## What lives here

| Path | Purpose |
|---|---|
| `.opencode/agents/` | Native OpenCode agent definitions (the read-only domain reviewers) |
| `.opencode/plugins/woc-guard.ts` | Native OpenCode plugin: generated-file guard, QA scan, hooks-path setup |
| root `.gitignore` | Ignore rule (`.opencode/*` plus unignores) keeps OpenCode's generated local scaffolding out of git while tracking the committed tooling |

OpenCode discovers all three automatically when a session starts in the repo.
No global or personal OpenCode configuration is required or modified.

## Agents

`.opencode/agents/*.md` are native OpenCode markdown agents, one per domain
reviewer. Each carries the same instruction body as its `.claude/agents/`
counterpart, with frontmatter translated to OpenCode's schema:

- `mode: subagent`
- read-only permissions enforced by OpenCode's permission engine:
  `edit`, `write`, and `apply_patch` are `deny`, so no tool-based file
  modification is possible; `task`, `webfetch`, and `websearch` are `deny`;
  `bash` is `ask` by default with an allowlist of read-only git and file
  commands plus test commands. Any bash command outside that allowlist
  (including a write-capable git or shell command) falls back to `ask` and
  requires explicit user approval, so file changes are never automatic
- no `model` and no `provider`: every agent inherits the model the user has
  selected in OpenCode, so the tooling never pins a vendor

The drift test `tests/opencode_setup.test.ts` keeps the two agent sets in sync.
To update an agent, edit `.claude/agents/<name>.md` and mirror the body into
`.opencode/agents/<name>.md` (the test enforces byte-identical bodies, matching
descriptions, read-only permissions, and the absence of any hard-coded model or
Claude-only field).

## Skills

OpenCode natively discovers `.claude/skills/<name>/SKILL.md`, so there is no
`.opencode/skills/` mirror and no duplicate source of truth. Verified against
OpenCode 1.18.18: all 14 WoCC skills are listed by `opencode debug skill` and
an agent can load them through the `skill` tool. Claude-only skill frontmatter
fields (for example `disable-model-invocation` on `feature-plan`) are ignored
by OpenCode's parser; they are harmless and remain single-source in
`.claude/skills/`.

## Plugin guardrails

`.opencode/plugins/woc-guard.ts` is the behavioral translation of the three
Claude hooks, implemented with OpenCode's native plugin API
(`tool.execute.before` and the plugin factory). It never executes a copied
shell script and never relies on Claude's `settings.json` hook protocol.

- **Generated-file guard** (`deny-generated-edit.sh` equivalent): blocks
  `edit`/`write`/`apply_patch` on `*.generated.ts` and anything under an
  `i18n.resolved.generated/` directory. Regenerators write through build
  scripts and are unaffected, matching the Claude hook's scope.
- **QA scan** (`qa-stop.sh` equivalent): scans the content an edit or write is
  about to add for the hard copy invariants: em/en dash, emoji, a stray
  `.only(`, a leftover `debugger`, and a `Math.random`/`Date.now`/
  `performance.now` call added under `src/sim/`. The same path exclusions as
  the pre-push copy scan apply (locale overlays, resolved i18n bundles, the
  Russian doc mirrors, lockfiles). Deeper guarantees still live where they
  always have: `tests/architecture.test.ts` owns sim determinism, biome owns
  `debugger`, and `.githooks/pre-push` owns the copy-rule floor at the push
  boundary. The plugin makes the same checks instant inside the edit loop.
- **Hooks-path setup** (`ensure-hooks.sh` equivalent): on load it idempotently
  points this clone's `core.hooksPath` at `.githooks` so the pre-push QA floor
  runs. It never clobbers an existing hook path; a value that points at another
  checkout's `.githooks` is left alone with a warning.

A blocked `tool.execute.before` surfaces as a tool error to the agent, which
fixes the content and retries. No loop guard is needed (Claude's Stop hook
needed one because it fires after an unedited reply).

## Configuration

There is deliberately no `.opencode/settings.json` and no `opencode.json`.
OpenCode auto-discovers the agents, the plugin, and the skills. Nothing depends
on `CLAUDE_PROJECT_DIR` or any Claude-specific environment variable.

## Verifying the integration

Run these from the repo root:

```sh
opencode agent list              # the 12 woc reviewers appear as subagents
opencode debug agent qa-checklist  # mode subagent, edit/write/apply_patch deny, no model
opencode debug skill             # the 14 .claude/skills skills are listed
opencode --print-logs run "..."  # plugin init logs the repository-local load path
```

The plugin logs its own resolved path at load, so `--print-logs` shows it was
loaded from `.opencode/plugins/woc-guard.ts` inside this repository.