# Phase 03: Host-parity bug fixes

PREMISE UPDATE (2026-07-17, Phase 1 session): the trade half of this phase is already done.
Release PR 2045 landed the instance-preserving trade fix on release/v0.27.0 (regression test in
`tests/trade.test.ts`) before this phase started, so the only remaining Phase 3 deliverable is the
`harvestClaimedBy` mirror below. Re-verify against code at session start per the docs anchor rule.

AS-LANDED DEVIATION (2026-07-17, Phase 3 merge a8c65a2c2, reviewed by cross-platform-sync): the
instructions below to register `hcb` in `ALL_DELTA_KEYS` / `TERSE_TO_IWORLD` were mis-specified.
`harvestClaimedBy` is a PER-ENTITY field, so `hcb` rides `dynamicFields` in `server/game.ts`
(sparse emit, auto-delta via the per-entity wire cache; the `tap` key is the template), and those
two registries pin selfWireJson maybe() SELF keys only (their scrape test asserts set-equality, so
listing `hcb` there would break it). The as-landed pin set: the round-trip and live-broadcast
suites in `tests/snapshots.test.ts` and `tests/corpse_harvest_sim.test.ts` (the sparse-absence
assertion in snapshots is the no-bloat tooth; `tests/bandwidth.test.ts` stays green but carries no
hcb-specific scenario). Authority: the Phase 3 LANDED entry in `state.md`. Read the registry
instructions below through this note.

This phase fixes the two known host-parity data bugs so item instances and corpse claims are
truthful in every host: trades currently strip `ItemInstancePayload` (the `removePreferFungible`
return is discarded), and `harvestClaimedBy` is hardcoded `null` in `ClientWorld`, so the online
corpse picker offers corpses the sim has already claimed. It is its own slice because both bugs are
pure parity repairs on surfaces later phases build on (masterwork instances from Phase 2 must
survive trades; Phase 4 gathering trusts corpse claims), and neither adds new gameplay.

## Context pointers

- `docs/professions-2/state.md`: locked decisions, the validation matrix (net/wire row), and the
  "Key existing surfaces" section (instances, gathering, wire key pattern).
- `docs/professions-2/progress.md`: the Phase 3 deliverable checklist.
- `src/sim/social/trade.ts`: the trade resolver; the `removePreferFungible` return value is
  discarded, which strips instance payloads on grant.
- `src/sim/bags.ts`: `removePreferFungible` and the instance-preserving grant helpers.
- `server/game.ts`: `wireEntity`, where the new `hcb` terse key joins the snapshot.
- `src/net/online.ts`: `ClientWorld`, where `harvestClaimedBy` is hardcoded `null` today.
- `src/ui/hud/loot/loot_window_controller.ts`: the corpse picker that must stop offering claimed
  corpses online.
- `src/sim/professions/combo_eligibility.ts`: the shared combo gate both hosts must consume
  (the 2033 stub trap: verify liveness, not just member shape).
- `tests/trade.test.ts`, `tests/corpse_harvest_sim.test.ts`: the suites to extend.
- `tests/snapshots.test.ts`: the `ALL_DELTA_KEYS` / `TERSE_TO_IWORLD` wire pins (SELF keys only;
  as landed, `hcb` is a per-entity `dynamicFields` key patterned on `tap`, see the deviation note
  above).
- `CLAUDE.md` (root) plus `src/sim/CLAUDE.md`, `src/net/CLAUDE.md`, `server/CLAUDE.md`,
  `src/ui/hud/CLAUDE.md`, `tests/CLAUDE.md`.

## Starter Prompt

```
This is Phase 03 of the Professions 2.0 feature: Host-parity bug fixes.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Goal: fix the two known host-parity data bugs so instances and corpse claims are truthful
everywhere.

STEP 0 - PRE-FLIGHT:
- Sync with the LATEST release branch FIRST: git fetch origin "+refs/heads/release/*:refs/remotes/origin/release/*"; pick
  the newest by version sort (git branch -r --list "origin/release/*" | sort -V | tail -1). If this phase
  starts a fresh branch or worktree, base it on that branch; if the feature branch already exists, merge
  that release branch into it NOW, resolve conflicts, and run the release-merge-audit skill on the merge
  before proceeding. Never base work on main or an older release branch than the newest.
- Verify `git status` is clean before starting. If not, ask the user (a concurrent session may
  share this checkout).
- Verify the any-signed masterwork amendment (the 2026-07-17 design-review ruling in
  state.md, shipped as its own pre-phase code change) has landed on the release branch:
  grep for MASTERWORK_SIGNED_CHANCE in src/sim/professions/masterwork.ts. If it is absent,
  the amendment PR is still open: land or merge it FIRST (never re-implement it inline),
  then proceed.
- Memory scan (if you use Claude Code memory): check your MEMORY.md index and any entries
  relevant to this phase's domain (suggested topics: combo-recipes-broken-online, the #2033
  ClientWorld stub trap; node25-breaks-jsdom-gate, run the gate under Node 24; PR 2039 state,
  the professions foundation this packet builds on).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn an Explore agent to read and summarize:
- docs/professions-2/state.md (locked decisions, validation matrix, key existing surfaces)
- docs/professions-2/progress.md (Phase 3 status + deliverable checklist)
- docs/professions-2/phase-03-parity-bug-fixes.md (this prompt); verify the agent has the same
  understanding
- src/sim/social/trade.ts (where the removePreferFungible return is discarded)
- src/sim/bags.ts (removePreferFungible and the instance-preserving grant path)
- server/game.ts (wireEntity and how existing terse keys are delta-guarded)
- src/net/online.ts (where harvestClaimedBy is hardcoded null; how cprof/prof/gprof/ncd/tfocus
  mirror into ClientWorld)
- src/ui/hud/loot/loot_window_controller.ts (how the corpse picker filters candidates)
- src/sim/professions/combo_eligibility.ts (the shared combo gate)
- tests/trade.test.ts, tests/corpse_harvest_sim.test.ts, tests/snapshots.test.ts (the
  ALL_DELTA_KEYS / TERSE_TO_IWORLD pins)
- CLAUDE.md (root) + src/sim/CLAUDE.md, src/net/CLAUDE.md, server/CLAUDE.md,
  src/ui/hud/CLAUDE.md, tests/CLAUDE.md
The agent must return: exactly where trade.ts discards the removePreferFungible return and what
that return contains; the full ItemInstancePayload shape (signer, charges, rolled, boundTo) and
the instance-preserving grant helpers in bags.ts; the recipe for adding a sparse per-entity terse
wire key (dynamicFields emit in server/game.ts, ClientWorld mirror; ALL_DELTA_KEYS +
TERSE_TO_IWORLD are for SELF keys only, see the deviation note at the top); how the corpse picker
sources harvestClaimedBy; how the crafting view consumes
combo_eligibility today in each host; and the existing test patterns in the three suites.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Spawn three agents in parallel (explicit fan-out; Opus 4.8 will not self-initiate it). Give
each agent ONLY the Explore summary plus its own file list, never the raw planning docs. Fix
bugs test-first (the extract-and-test skill): reproduce each bug with a failing test that
exercises the real code path, then make the smallest change that turns it green.

Agent trade (sim) deliverables:
- Trade carries ItemInstancePayload end to end: thread the consumed payloads from
  removePreferFungible in src/sim/social/trade.ts into instance-preserving grants on the
  receiving side, in BOTH trade directions.
- A regression test in tests/trade.test.ts that trades an enchanted + signed + masterwork
  instance and asserts full payload survival (signer, rolled, charges, boundTo intact after
  the trade). Cover a mixed offer too: fungible stacks alongside instanced items in one trade,
  with the right payloads landing on the right granted items.

Agent wire (server + net) deliverables:
- harvestClaimedBy rides the wire: a new terse key (hcb), sparse-emitted from wireEntity's
  dynamicFields in server/game.ts (as landed; NOT the self-key registries, see the deviation
  note at the top), pinned by the snapshots round-trip suite.
- ClientWorld mirrors hcb in src/net/online.ts, replacing the hardcoded null.
- The corpse picker in src/ui/hud/loot/loot_window_controller.ts no longer offers claimed
  corpses online, with a test against a ClientWorld-shaped stub.

Agent tests deliverables:
- A liveness test asserting the crafting view's combo gating consumes the shared
  combo_eligibility result identically in Sim-shaped and ClientWorld-shaped inputs (the 2033
  stub trap: assert live values flow, not just that the member exists).
- Verify no wire pin, parity pin, or bandwidth pin is left stale by the other two agents'
  changes; extend tests/corpse_harvest_sim.test.ts where the claim behavior gained a wire
  surface.

INVARIANTS THIS PHASE MUST KEEP:
- Prime directive: nothing existing breaks. Trades of plain fungible stacks, offline corpse
  harvesting, and every existing wire consumer keep working unchanged.
- Server authority: the server resolves all trade and claim outcomes; the client only mirrors
  and renders (the picker filters on mirrored truth, it never decides claims).
- Wire parity pins: every new SELF terse key lands in ALL_DELTA_KEYS and TERSE_TO_IWORLD in the
  same change; a per-entity dynamicFields key (hcb, as landed) is pinned by its round-trip suite
  instead; tests/snapshots.test.ts, tests/bandwidth.test.ts, and tests/world_api_parity.test.ts
  stay green; hcb is sparse-emitted and cheap.
- IWorld both worlds: any read the UI consumes exists on the facet and behaves identically in
  Sim and ClientWorld; verify liveness, not just member shape.
- Determinism: all randomness via Rng; no Math.random, Date.now, or performance.now anywhere
  in src/sim/; grant ordering in trade resolution stays deterministic.
- i18n: this phase should add no player-visible text; if any string does become player-visible,
  it is a t() key added in ENGLISH ONLY to the matching src/ui/i18n.catalog/<domain>.ts module,
  and any sim/server player text gets a matcher rule in src/ui/sim_i18n.ts or
  src/ui/server_i18n.ts in the SAME change (the S3 guard enforces it).

Out of scope (do NOT do in this phase):
- Mail and market instance carriage (wave 2, #1146): mail and market keep refusing instanced
  items; do not touch their refusal paths.
- boundTo semantics (commissions, #1298): carry the field verbatim; do not interpret it.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
- Run the net/wire row of the validation matrix in docs/professions-2/state.md plus the phase
  suites:
  npx vitest run tests/trade.test.ts tests/snapshots.test.ts tests/bandwidth.test.ts
    tests/corpse_harvest_sim.test.ts tests/world_api_parity.test.ts
  npx vitest run tests/env_protocol.test.ts (the remaining net/wire row member)
  npx vitest run tests/architecture.test.ts (sim files changed)
  npx tsc --noEmit
  npm run ci:changed
- Spawn review agents per the Review Dispatch Matrix in
  docs/professions-2/implementation-plan.md; check git diff --name-only against the phase-start
  commit and spawn ONLY matching rows (this diff will likely match cross-platform-sync,
  architecture-reviewer, privacy-security-review, and frontend-seam-reviewer; dispatch from the
  actual diff, not this guess).
- Prompt each agent you spawn for COVERAGE not filtering: report every issue including
  low-severity and uncertain ones; ranking happens in a later step.
- Resume any agent that truncates with: "Stop reading more files. Output the full report now
  based on what you've already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX /
  NICE-TO-HAVE / VERDICT."
- Do not commit while any BLOCKING finding stands.

STEP 4 - COMMIT CADENCE:
Aim for 3 commits with these headlines (Conventional Commits with a scope; EXPLICIT paths,
never git add -A; every commit carries a body saying what changed and why; no em dashes or
emojis):
- fix(sim): trade preserves item instance payloads end to end
- fix(net): mirror corpse harvest claims online via the hcb wire key
- test(ui): pin combo gating liveness across Sim and ClientWorld shapes

STEP 5 - ACCEPTANCE CRITERIA (do not mark complete until all check):
- [ ] Traded instances keep signer, rolled, charges, and boundTo, in both trade directions,
      including a mixed fungible + instanced offer (regression test green)
- [ ] harvestClaimedBy rides the wire as hcb (delta-omitted) and ClientWorld mirrors it; the
      online corpse picker matches sim truth and no longer offers claimed corpses (stub test
      green)
- [ ] The combo-gating liveness test passes with Sim-shaped and ClientWorld-shaped inputs
- [ ] hcb pinned per its as-landed shape (per-entity dynamicFields key: the snapshots round-trip
      suite incl. the sparse-absence assertion; deliberately absent from ALL_DELTA_KEYS and
      TERSE_TO_IWORLD); tests/snapshots.test.ts, tests/bandwidth.test.ts, and
      tests/world_api_parity.test.ts green
- [ ] tests/trade.test.ts, tests/corpse_harvest_sim.test.ts, tests/env_protocol.test.ts,
      tests/architecture.test.ts, npx tsc --noEmit, and npm run ci:changed all green
- [ ] Mail and market still refuse instanced items (untouched)

STEP 6 - DOC UPDATES + MEMORY:
- Update docs/professions-2/progress.md: mark Phase 3 status and check its deliverable boxes;
  note any deferrals.
- Update docs/professions-2/state.md: flip the Phase 3 line under "New surfaces per phase" from
  planned to landed (the hcb wire key with its pin locations, the trade payload carriage path
  in trade.ts/bags.ts, and the liveness test file name); update the "Key existing surfaces"
  instances bullet (trade no longer strips payloads).
- If you use Claude Code memory, record any surprising rules or current-state notes for the
  next session.

STEP 7 - FINAL RESPONSE FORMAT:
End your turn with: phase status, files touched, validation results, review-agent verdicts,
any deferred items, and a one-line handoff for the Phase 3 QA session.

STOPPING RULES:
- No phase-specific stopping rules. Packet defaults apply: stop and ask the user if a fix would
  force a backwards-incompatible wire change or a persisted characters.state shape change, and
  stop if any BLOCKING review finding cannot be resolved inside this phase's scope.
```
