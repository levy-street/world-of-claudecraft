# Phase 04: Materials backbone

### Starter Prompt
```
This is Phase 04 of the Masterwrought feature: the three shared chase materials and their
faucets.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: not needed for this phase.

Goal: Wyrmfall Core, Sundered Essence, and Maker's Ember exist with their faucets, gates,
and persistence, in both hosts, fully tested. Every later phase consumes what lands here.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean; then SYNC RELEASE: git fetch origin, merge the newest origin/release/**
  into feature/masterwrought, run the release-merge-audit skill on the merge.
- Memory scan: MEMORY.md entries on daily gates and cooldown persistence, JSONB
  back-compat, rng draw-order, caches/memos, test-pin traps.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (rulings R4, R9; delivery contract; "Key existing
  seams": heroic_mark + awardHeroicMarks, rift hooks, binding, ItemInstancePayload)
- docs/prd/masterwrought/progress.md (Phase 04 row)
- src/sim/instances/dungeons.ts (heroic_mark, awardHeroicMarks, final-boss kill hooks),
  src/sim/content/rift/items.ts + src/sim/rift/types.ts (rift clear/rank hooks),
  PlayerMeta and the CharacterState JSONB serialize/deserialize path (locate it), the
  shared profession cast seam (how crafting casts pace an action), the Heroic
  Quartermaster vendor content, how daily/weekly reset boundaries are computed today,
  src/sim/CLAUDE.md + server/CLAUDE.md.
Return: where final-boss awards fan out per participant, where rift first-clear rank is
known, how PlayerMeta fields persist and default, which reset seam exists for daily and
weekly boundaries, how the quartermaster prices rows.

STEP 2 - EXECUTE (parallel fan-out, explicitly):
Agent 1 (Wyrmfall Core):
- Item def: tradable, kind junk, quality rare, stackSize 20.
- Faucets: 1 to 3 dropped per final-boss kill in the raid and the heroic five-mans,
  per-participant via the awardHeroicMarks pattern; rift A and S rank FIRST clears grant
  once per character per day (R9; a new daily gate on PlayerMeta); sold by the Heroic
  Quartermaster for Heroic Marks (pick the price from the existing mark-price family,
  record it in state.md).
Agent 2 (Sundered Essence + Maker's Ember):
- Sundered Essence: soulbound; a new disenchant-adjacent extraction action available on
  any RAID-sourced epic of the tier (source-level check), cast-paced on the shared
  profession cast seam; yields recorded in state.md.
- Maker's Ember: soulbound keystone, 1 per week per character, BANKABLE (missed weeks
  accrue, R4): an accrual field on PlayerMeta, persisted; the weekly grant fires on the
  first eligible endgame completion of the week (raid boss, heroic final boss, or rift
  A/S clear).
Agent 3 (persistence + tests):
- Optional CharacterState fields with defaults (old saves load unchanged); both hosts.
- tests/masterwrought_materials.test.ts: each faucet caps correctly; the rift daily gate
  refuses a second grant the same day and resets next day; weekly Ember accrual across
  the reset boundary (a missed week accrues); extraction refuses non-raid-sourced epics;
  JSONB round-trip of the new fields.

INVARIANTS IN PLAY: all drop-count randomness through ctx.rng at documented positions;
draw-order neutrality (grants append draws, never insert mid-sequence; run parity when a
draw site lands); server authority (all grants and the extraction resolve server-side);
soulbound via ItemDef.soulbound; new persisted fields optional-with-defaults; every
player-visible grant/refusal line gets its sim_i18n matcher in the SAME change; no new
unbounded server table (if one appears it needs the retention story, but none is expected).

Out of scope: apex recipes consuming these materials (phases 07 to 10); pattern drops and
vendor patterns (phase 11); Perfecting's consumption of Ember/Essence (phase 12); the
Quickening Catalyst (phase 07).

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
npx tsc --noEmit; npx vitest run tests/masterwrought_materials.test.ts
tests/architecture.test.ts tests/localization_fixes.test.ts; the parity suite (new rng
draw sites); wire suites (tests/snapshots.test.ts tests/env_protocol.test.ts
tests/bandwidth.test.ts) if wire fields changed; npm run ci:changed.
Review Dispatch Matrix (implementation-plan.md): architecture-reviewer +
cross-platform-sync (sim behavior + events); migration-safety (characters.state JSONB
shape); privacy-security-review and database-performance-reviewer only if server/ or a
DB call site changed. COVERAGE prompts; apply ALL findings.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- feat(sim): wyrmfall core faucets and the rift daily gate
- feat(sim): sundered essence extraction and the makers ember keystone
- test(sim): pin faucet caps, weekly accrual, and the daily gate

STEP 5 - ACCEPTANCE:
- [ ] All three materials exist with the ruled binding, stacking, and tradability;
      faucets grant per spec in BOTH hosts
- [ ] Rift daily gate holds across portal cycles; Ember accrues across missed weeks and
      the reset boundary
- [ ] Old saves load with defaults; JSONB round-trip pinned; no new unbounded table
- [ ] Quartermaster price and essence yields recorded in state.md; listed suites plus
      parity green; ci:changed clean

STEP 6 - DOCS: progress.md Phase 04 row; state.md ledger (new item ids, PlayerMeta
fields, i18n keys + matchers, prices/yields, new tests); memory note if anything
surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, handoff line
for Phase 04 QA.

STOPPING RULES: stop and ask if no existing weekly-reset seam can anchor the Ember grant
(do not invent a new clock), or if per-participant final-boss awards cannot reuse the
awardHeroicMarks pattern without perturbing the loot roll draw order.
```
