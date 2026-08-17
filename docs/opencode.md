<!-- docs/ - operator guidance for repository OpenCode support. -->

# OpenCode in World of ClaudeCraft

The checked-in OpenCode layer makes a session launched from the repository
productive using OpenCode's own native mechanisms. Root and local `CLAUDE.md`
files own repository truth. `.claude/` remains the canonical Claude Code setup
and is not changed by OpenCode support; `.opencode/` adds only OpenCode
discovery, agent definitions, permissions, and a native guard plugin.

## Start a session

1. Start from the requested release branch. Use an isolated worktree when
   another session may share the checkout.
2. Launch OpenCode at the worktree root (or the repository root) and check
   `.opencode/README.md`, `.opencode/agents/`, and
   `.opencode/plugins/woc-guard.ts` before trusting the project.
3. Restart OpenCode after pulling changes to project agents, the plugin, or
   skills: OpenCode loads them at startup.
4. Run `opencode debug skill` to see the shared skills, and
   `opencode agent list` to see the native reviewers.

OpenCode loads `CLAUDE.md` and `AGENTS.md` as instruction files by default, so
repository guidance is available without extra configuration.

## Models stay selectable

No OpenCode agent pins a `model` or `provider`. Every agent inherits the model
the user selects in OpenCode (primary agents use the globally configured model;
subagents use the invoking agent's model). Choose the model for the task the
same way you would for any OpenCode session. Correctness, tests, and review
requirements never change with model selection.

## Checked-in surfaces

| Surface | Purpose |
|---|---|
| `.opencode/agents/*.md` | Native OpenCode reviewers mirroring `.claude/agents/` (same instruction bodies, translated frontmatter) |
| `.opencode/plugins/woc-guard.ts` | Native plugin: generated-file guard, instant QA scan, hooks-path setup |
| root `.gitignore` | Ignore rule (`.opencode/*` plus unignores) keeps generated local scaffolding out of git |
| `.opencode/README.md` | Project-local integration documentation |
| `docs/opencode.md` | Operator setup and maintenance guidance |

Personal profiles, auth, provider settings, caches, sessions, and worktrees
stay ignored. The project config deliberately does not set a model, provider,
or credential.

## Agents and permissions

The 12 read-only domain reviewers under `.claude/agents/` have native OpenCode
counterparts under `.opencode/agents/` with the same bodies. Read-only is
enforced by OpenCode's permission engine, not by prose: `edit`, `write`, and
`apply_patch` are denied, `task`, `webfetch`, and `websearch` are denied, and
`bash` is `ask` by default with an allowlist of read-only git and file commands
plus test commands. The reviewers therefore cannot modify files through their
tools or through the bash allowlist; any bash command outside that allowlist
(including write-capable git or shell commands) falls back to `ask` and needs
explicit user approval, so file changes are never automatic.

`tests/opencode_setup.test.ts` is the drift gate. Editing a `.claude/agents/`
body without mirroring it into `.opencode/agents/` fails the suite, as does
introducing a `model`, a `provider`, a `maxTurns`, a `tools`, or any non-native
frontmatter key.

## Skills stay shared

OpenCode natively discovers `.claude/skills/<name>/SKILL.md` (and
`.agents/skills/<name>/SKILL.md`), so there is no `.opencode/skills/` mirror
and `.claude/skills/` remains the single source of truth. Verified on OpenCode
1.18.18: `opencode debug skill` lists all WoCC skills and an agent can load one
through the `skill` tool.

## Guardrails

The plugin at `.opencode/plugins/woc-guard.ts` is the behavioral translation of
the Claude hooks, using OpenCode's native plugin API:

- **Generated-file guard.** Blocks `edit`/`write`/`apply_patch` on
  `*.generated.ts` and `i18n.resolved.generated/` artifacts, matching
  `deny-generated-edit.sh`. Regenerators write through build scripts and are
  unaffected.
- **Instant QA scan.** Blocks edits that add an em/en dash, an emoji, a stray
  `.only(`, a `debugger`, or a `Math.random`/`Date.now`/`performance.now` call
  under `src/sim/`, matching `qa-stop.sh`'s invariants and its path exclusions.
  Deeper guarantees remain where they have always lived: the sim determinism
  deep guard is `tests/architecture.test.ts`, `debugger` is caught by biome,
  and the push-boundary copy-rule floor is `.githooks/pre-push`. The plugin
  makes the same checks instant inside the edit loop.
- **Hooks-path setup.** On load it sets `core.hooksPath=.githooks` only when
  nothing already owns the hook path, so the pre-push floor runs for OpenCode
  users too. Idempotent and non-destructive; a foreign `.githooks` value is
  left alone with a warning.

There is no `.opencode/settings.json` and no `CLAUDE_PROJECT_DIR` dependency.
OpenCode executes the plugin, not a copied Claude hook.

## Maintenance

- **Agents:** edit the Claude source in `.claude/agents/`, mirror the body and
  description into `.opencode/agents/`, and let `tests/opencode_setup.test.ts`
  confirm the parity, schema, permissions, and model-neutrality invariants.
- **Plugin:** the guard logic is dependency-free plain TypeScript with pure
  helper functions, so its behavior is unit-tested directly and loads anywhere
  OpenCode runs.
- **Skills:** edit `.claude/skills/` only. OpenCode picks the change up at the
  next session start.