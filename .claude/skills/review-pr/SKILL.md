---
name: review-pr
description: Review a GitHub pull request for World of ClaudeCraft the way the maintainer does. Use when asked to review a PR, look at a PR, or check a PR (a github.com/.../pull/<n> link or a PR number). Fetches the PR, classifies the change by domain (sim, wire/parity, render, ui, server, i18n), verifies the repo's invariants against the real code (not the PR description), checks the merge-conflict scope, independently confirms any consequential finding, then posts a short, plain, friendly GitHub review with severity-tagged findings. Not for reviewing the local working tree (that is /code-review).
user-invocable: true
---

# Review a PR (World of ClaudeCraft house style)

This repo takes many small AI-authored contributions, so review is the gate that keeps
the invariants intact. A good review here is not a vibe check of the diff: it verifies
the load-bearing claims against the actual code, names issues with file:line evidence
and a severity, and reads like a calm human wrote it. Work through the steps below.

`/code-review` reviews the local working tree; THIS skill reviews a GitHub PR end to
end and posts the result. They are different jobs.

## What a good review looks like (the voice)

- Short, calm, plain GitHub style. Write like a person, not an AI: no preamble, no
  summary-of-a-summary, no "Great work!" throat-clearing, no bulleted restatement of the
  diff, no hedging boilerplate. If a sentence sounds like a model wrote it, cut it.
- **No em dashes or en dashes, and no emojis.** Use commas, colons, parentheses, or "to"
  for ranges. (You are reviewing a repo that bans them; do not introduce them yourself.)
- Lead with what is genuinely good when it is good, then the issues. Do not flatter.
- Every finding carries a **severity** and **evidence**: `blocking` / `should-fix` /
  `nit`, with a `file:line` pointer and a one-line why.
- **i18n: review English only. The maintainer does every other locale at release time.**
  Check only that new player-visible strings are English `t()` keys in the right catalog.
  Never raise a missing-translation finding, never draft a locale string, and never ask
  the contributor about any non-English locale (the non-Latin overlays and the M16 gate
  included). All of that is release-time maintainer work.
- Post as a plain comment review (not approve / request-changes) unless told otherwise.
- Match the depth to the change: a one-file fix gets a tight note; a sim/wire/auth
  change earns the full invariant pass.

## Step 1: Gather and scope

```
gh pr view <n> --json title,body,author,headRefName,baseRefName,state,additions,deletions,changedFiles,mergeable,mergeStateStatus,commits
gh pr diff <n> --name-only           # which files, which domains
gh pr diff <n>                       # the diff (skip the generated i18n blocks)
git fetch origin pull/<n>/head:pr-<n>-review   # local ref at the PR head
git fetch origin <baseRefName>
```

Conflict scope (do not trust the GitHub `CONFLICTING` flag for WHICH files):

```
git merge-tree --write-tree --name-only pr-<n>-review origin/<baseRefName>
```

Files printed at the top / marked `CONFLICT` are the true conflicts; `Auto-merging`
lines are clean. Read files at the PR head with `git show pr-<n>-review:<path>`.

## Step 2: Classify the change, then run that domain's invariant pass

Pick the domains the diff touches (a PR can hit several) and check each. The root and
sub `CLAUDE.md` files are the source of truth; this is the checklist.

**Sim (`src/sim/**`) -> determinism + purity + three-host parity.**
- Determinism: ALL randomness through `Rng` (`src/sim/rng.ts`). Never `Math.random`,
  `Date.now`, or `performance.now`. Same seed gives the same world. Watch the sneaky
  ones: `Map`/`Set` iteration order, object-key order, unstable sorts. A sort must be a
  total order (tiebreak on a stable id), not lean on input order or engine sort
  stability. Pathfinding/AI are classic nondeterminism hiding spots.
- Purity: zero DOM/Three/browser imports; never imports `render/`, `ui/`, `game/`,
  `net/`. (`tests/architecture.test.ts` guards this; confirm the diff respects it.)
- Tick-based timers count `tickCount`/`DT`, not wall-clock. Session-only fields (e.g.
  `joinedAt`) are re-derived on load, never persisted with a stale tick epoch.

**Wire / parity (`server/game.ts`, `src/net/online.ts`, `types.ts`, `entity.ts`).**
- A new `Entity` field either round-trips BOTH ways (encoded in `wireEntity` /
  `dynamicFields`, decoded in `applyWire`) OR is deliberately server-local. If
  server-local, it must still be added to `blankEntity` in `online.ts` so the offline
  `Sim` and the `ClientWorld` mirror keep identical entity shapes (precedent:
  `chargePath`, `petPath`). Drift (one host has it, the other does not) is a bug.
- Server authority: movement, combat, loot, economy resolve server-side. The client is
  a renderer. A client-side movement/combat decision is a finding, not a feature.
- When in doubt, hand this to the `cross-platform-sync` agent (`.claude/agents/`).

**Render (`src/render/**`) -> reads the world, never mutates it.**
- Thin `IWorld` consumer; no concrete `Sim`/`ClientWorld` coupling beyond what the file
  already has. New visual system is its own `src/render/<thing>.ts`, not a method bank
  on `renderer.ts`. Pure geometry/math extracted and unit-tested without Three.
- Watch per-frame cost (samples/allocations in the hot path).

**UI (`src/ui/**`, `index.html`) -> seam + modularity + i18n + parity + a11y.**
- `IWorld` only; never reach into a concrete world. A new window/panel is its own module
  the HUD composes (`chat_window.ts` pattern), not a new banner section in `hud.ts`.
  Pure clamping/geometry/formatting extracted and tested.
- **play.html CSS parity:** `play.html` is a separate build entry that carries the same
  chrome DOM. CSS added to `index.html` for shared chrome must be mirrored into
  `play.html` or it breaks on `/play`. Check this explicitly (a recurring miss).
- Persistence (window pos, settings) restores clamped to the current viewport; drag /
  resize no-op on mobile; check keyboard operability + aria on new controls.

**Server (`server/**`) -> authority + auth + SQL + migration + privacy.**
- Every new route: bearer-authed and scoped to the account FROM THE TOKEN, not from
  client input. It must never read or mutate another account's data. Double-gate
  ownership (route check + the UPDATE/SELECT `WHERE account_id` clause).
- SQL: parameterized ($1,$2,...). Flag any interpolation of user input.
- Migration: schema is inline DDL re-applied every boot. Changes must be additive +
  idempotent (`ADD COLUMN IF NOT EXISTS`); JSONB load stays back-compat (old rows lack
  the field). Flag destructive/non-idempotent DDL. Hand to `migration-safety` /
  `privacy-security-review` agents for anything non-trivial.
- Privacy: no `password_hash` or other accounts' data returned to the client.
- CLAUDE.md requires tests for sim/server behavior changes. A server change with no test
  is a finding.

**i18n (any player-visible string). Review English only; the maintainer does every other
locale at release time.**
- Check only that new player-visible strings are English `t()` keys in the right
  `src/ui/i18n.catalog/<domain>.ts`, rendered via `t()`. `hud_chrome` is the English-only
  catalog domain. Numbers/money/dates/percents go through the formatters, never string
  concat.
- Do NOT raise any non-English i18n finding. Missing translations, the five non-Latin
  overlays (`zh_CN`, `zh_TW`, `ja_JP`, `ko_KR`, `ru_RU`), Latin-script `pending` rows, and
  the M16 completeness gate (`tests/i18n_completeness.test.ts`) are all release-time
  maintainer work, not a review finding and not a contributor ask. From the contributor's
  side a PR is English-only.
- `shell.ts` and some catalog modules carry inline per-locale blocks that need all
  locales present for `tsc`; that is structural, not a policy violation, and still not
  something to flag.

**The standard stale-base i18n conflict.** When the only true conflicts are
`src/ui/i18n.resolved.generated/pending.ts`, `src/ui/i18n.resolved.sha256`, and
`src/ui/i18n.status.summary.json`, that is mechanical regen churn, not a design problem.
Say so, and note the fix: merge the base and re-run the i18n build
(`i18n:build` / `i18n:admin` / `i18n:scan` / `i18n:hash --write`). A hand-edited or
malformed generated artifact (e.g. an `i18n.resolved.sha256` that is not exactly one
line) is a different thing and IS a blocker.

## Step 3: Verify against the real code, and confirm before you accuse

- Do not review the PR description, review the code. Read the actual files at the head
  ref, grep the surrounding conventions (the facing vector, the persistence path,
  whether a field is serialized), and run the targeted test (`npx vitest run <file>`)
  when you can.
- **Independently confirm any consequential or negative finding before you post it.**
  "This is dead code", "this duplicates base", "this leaks data", "this is
  nondeterministic": verify each with your own grep/read/run, because a wrong strong
  claim is worse than a missed nit. (Example: confirm a "feature already in base" claim
  by checking the base branch has the routes/files; confirm "not on the wire" by
  grepping `wireEntity`.)
- Distinguish what the diff CHANGED from what it inherited: do not flag pre-existing code
  the PR merely sits next to.

## Step 4: Tests

Failing-first where it is a bug fix (a test that reproduces it, then the fix). Sim tests
are seeded and deterministic. Pure logic is extracted so it tests without DOM/Three/GL.
Note meaningful gaps (an untested branch, gesture math, the stamping half of a gate) as
nits, not blockers, unless the untested thing is the actual fix.

## Step 5: Write and post

Assemble the review in the voice above: a short positive opening when earned, then
findings as a tight list, each with severity + `file:line` + one-line why, then any
non-blocking notes. Then post:

```
gh pr review <n> --comment --body-file <path-to-review.md>
gh api repos/<owner>/<repo>/pulls/<n>/reviews --jq '.[-1] | {author:.user.login, state:.state, url:.html_url}'
```

Reviews post AS THE MAINTAINER. Only post to `origin` (`levy-street`), never a fork.
Posting is outward-facing: if the task did not clearly ask you to post, present the draft
and ask first.

## Scaling up: many PRs, or one deep review

Multiple PRs, or a security/sim/wire change that deserves an adversarial pass: pre-fetch
the head refs, then fan out one read-only investigator per PR (or per dimension) with a
domain-tailored prompt that says READ-ONLY, do not post, return evidence-backed findings
with severity. Then YOU verify the consequential findings (Step 3) and write/post each
review in your own voice. Do not let a subagent author the final review prose or post it,
the voice and the verify-before-accuse bar are yours to hold. Prefer the purpose-built
agents (`architecture-reviewer` for `src/sim/` determinism + the `SimContext` seam,
`cross-platform-sync`, `migration-safety`, `privacy-security-review`, `qa-checklist`) for
their domains.

## Quick reference: domain -> first things to check

| Touches | Check first |
|---|---|
| `src/sim/**` | Rng-only, no wall-clock, total-order sorts, no DOM/Three import |
| `server/game.ts` + `online.ts` + `types.ts` | wire round-trip or server-local + `blankEntity` parity; server authority |
| `src/render/**` | reads not mutates; own module; per-frame cost |
| `src/ui/**` + `index.html` | IWorld seam; own module; play.html CSS parity; a11y/mobile; i18n |
| `server/**` routes/db | token-scoped auth; parameterized SQL; additive idempotent DDL; no oversharing; tests |
| i18n strings | English `t()` in catalog only; all other locales are release-time maintainer work, do not flag; generated-trio conflict = regen |
