# The QA gate

World of ClaudeCraft is built entirely with Claude Code, by many contributors. To keep the
quality bar high without slowing the edit loop, the project enforces it in layers. Each layer
does exactly one job, at the cheapest moment it can, and nothing heavier than necessary runs on
the inner loop.

## The layers

| Layer | What it is | When it runs | Cost | Blocks? |
|---|---|---|---|---|
| Instant copy gate | `Stop` hook -> `.claude/hooks/qa-stop.sh` | end of every Claude Code turn | milliseconds | yes, on a hard-invariant hit |
| Deterministic floor | `.githooks/pre-push` | once per `git push` | seconds | yes, on red |
| Judgment review | `/qa` command + the `qa-checklist` agent + the domain reviewers | when you finish a unit of work | an agent run | no (advisory locally, enforced at PR review) |

### 1. Instant copy gate (every turn)

`qa-stop.sh` scans only the lines the current turn ADDED, for hard invariants that are
detectable in milliseconds: an em dash, en dash, or emoji; a stray `.only(` that would silently
disable a test suite; a leftover `debugger`. On a hit it asks Claude to fix those exact lines
before finishing; otherwise it is silent. It never runs `tsc`, `vitest`, `biome`, or any agent.
A Stop hook fires every turn, so anything heavier here would tax every iteration, and a hook is
a shell command that cannot spawn an agent anyway.

### 2. Deterministic floor (every push)

`.githooks/pre-push` runs the heavier deterministic checks once, at the push boundary
(infrequent, so it does not slow editing): `tsc --noEmit`, the determinism/purity and
i18n-matcher guard tests, `biome` scoped to the branch's changed files, and a copy-rule scan of
the push diff. It blocks the push on any failure. Bypass in a genuine emergency with
`git push --no-verify`. The `SessionStart` hook `.claude/hooks/ensure-hooks.sh` points this
clone's `core.hooksPath` at `.githooks` so the floor actually runs (idempotent, and it never
clobbers an existing hook setup).

### 3. Judgment review (when you finish a feature)

Determinism, three-host parity, server authority, persistence safety, i18n correctness,
render/UI seams, responsive/mobile, competitive fairness across graphics tiers and devices
(no preset or device gives an information or timing advantage), content fidelity, and
performance need reasoning, not a regex, so they are an agent, not a hook. Run `/qa` (or invoke the `qa-checklist` agent) when you
finish a unit of work. It scales its depth to the size of the change, checks every invariant in
play, names the domain reviewers to dispatch, and ends with an adversarial "what is missing"
pass.

## The reviewer agents

All read-only, all in `.claude/agents/`:

- **`qa-checklist`** - the evergreen end-of-contribution gate (also reachable as `/qa`). The
  default; it dispatches the others by domain.
- **`architecture-reviewer`** - determinism, rng draw-order, tick-phase, and the `SimContext`
  seam, for any `src/sim/` change.
- **`cross-platform-sync`** - IWorld parity, the wire protocol, SimEvent and command coverage,
  and the sim/server i18n matchers.
- **`migration-safety`** - inline-DDL and JSONB persistence safety (additive/idempotent DDL,
  back-compat, indexes, parameterized SQL, boot safety).
- **`privacy-security-review`** - server authority / anti-cheat, dev-command gating, secrets,
  auth (including OAuth, TOTP, and wallet linking), and account-data privacy.
- **`release-malware-audit`** - the release gate for deliberately planted malicious code
  (triages `scripts/malware_scan.mjs`).

## Keeping the gate current

The reviewer agents encode facts about the codebase (seams, file roles, invariants, the gates
that enforce them). When the architecture changes, update the relevant agent in the same spirit
as the code: anchor claims on stable things (file paths, symbol names, gate names), NOT on line
numbers or line counts, which drift constantly. The `qa-checklist` agent is the place to add a
new evergreen check; a new dedicated reviewer is only worth it when an invariant is large enough
to need its own focused prompt and is not already covered by a standing test.

## Trust and safety

The hooks run shell on your machine with your permissions, so treat them like any other
checked-in tooling. They are deliberately small and auditable (bash plus `git` and `perl`), read
only `git diff` and `git config`, write nothing outside `core.hooksPath`, and make no network
calls. Claude Code does not run project hooks until you confirm trust for the repo, and the hook
set is snapshotted at startup. The repo's own `release-malware-audit` scanner also scans
`.claude/**`. To opt out: `git push --no-verify` (one push), `git config --unset core.hooksPath`
(disable the pre-push floor for your clone), or `"disableAllHooks": true` in your
`.claude/settings.local.json` (which is not checked in). See `.claude/hooks/README.md`.
