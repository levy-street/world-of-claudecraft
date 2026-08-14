# Phase 10: Apex consumables and enchants

### Starter Prompt
```
This is Phase 10 of the Masterwrought feature: the consumable professions' apex rung
and the bounded enchant line.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: not needed for this phase.

Goal: three flasks, three role foods, three apex enchants (all exactly one rung over
the shipped lines, all in existing aura families), the two skill-125 capstone
placements (Grand Cauldron, The Laden Hearth), and the guarded Perfected-only Lucent
Infusion.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean (Phase 09 QA closed at 11d9d147a8, gate all 8 PASS there; expect the
  branch there or later). Then SYNC RELEASE: git fetch origin, merge the newest
  origin/release/** line CONTAINING v0.38.0 (a hotfix fork is a poison target), run the
  release-merge-audit skill on the merge. After the merge: set any composed count pin
  (IWorld, command schema) from SUITE RUNS, never by arithmetic (the pin has composed
  silently at three consecutive syncs); if the merge brought locale fill rows, run the
  three naming guards (ip_scrub, overlay_ip_scrub, originality_renames) BEFORE the gate.
- Memory scan: MEMORY.md entries on aura/exclusivity, cooldown persistence, the
  test-pin trap index (40 traps, READ before any pin work), station/placement gotchas,
  item-art-ownership-batch-xor-entries, new-item-content-hidden-obligations.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (rulings R7, R13, R14, R15; the phase 06 scroll
  family decisions; the phase 07 Lucent Reagent ledger entry; validation matrix)
- docs/prd/masterwrought/progress.md (Phase 10 row)
- The consumable exclusivity machinery, PREMISE CORRECTED at phase 09 QA: it is the
  elixir_${kind} aura-id scheme in src/sim/items.ts (~line 941; applyAura same-id
  replacement, newest wins, weaker included; useElixir/useElixirAura, which the phase
  06 scrolls joined). src/sim/combat/exclusive_aura.ts EXISTS but is the ABILITY
  exclusiveGroup engine (aspects/shouts via effect_dispatch), NOT the consumable path;
  do not route flasks or foods through it.
- The rare elixir line and current-best food rows in src/sim/content/ (increment
  baselines), src/sim/content/enchants.ts + src/sim/professions/enchanting.ts (the
  enchant defs and the application cast seam, incl the #2415 confirmReplace /
  already_enchanted / same_enchant arms), src/sim/professions/mobile_station.ts (the
  phase 09 placement family the cauldron/hearth reuse: the ONE transient
  PlayerMeta.mobileStation slot with mutual clobber pinned, partyShared, the shared
  eachPartyStationInRange walker both the craft gate and the set resolver ride, the
  set-valued activeMobileStationCrafts readout), src/sim/professions/CLAUDE.md's
  mobile_station row, src/sim/CLAUDE.md.
Return: how aura families exclude, the exact rare-elixir and best-food numbers the
increments build on, how an enchant applies today, what a placement needs.

STEP 2 - EXECUTE (parallel fan-out, explicitly):
Agent 1 (alchemy): three flasks (tank/physical/caster): persist through death, one
active at a time, exclusive with their elixir pairs via the exclusive_aura families,
exactly ONE increment over the rare elixir line (R14: stat increments, no new proc
effects). "Grand Cauldron": alchemy skill 125 (R13 capstone), places a
party-interactable flask dispenser; reuse the phase 09 mobile_station placement family
(FAMILY reuse before bespoke).
Agent 2 (cooking): three role foods, one increment over the current best, well-fed
exclusive; "The Laden Hearth" feast, cooking skill 125, party-wide, same placement
family.
PLACEMENT DECISIONS both capstone agents must respect (phase 09 QA carries): the
mobile_station family is TRANSIENT by design (tick-domain expiry, never persisted);
a capstone meant to survive a realm restart would be the packet's first persisted
station state, a schema-shape decision, NOT a reuse: if the design needs that, STOP
and ask. The family has ONE per-player slot (PlayerMeta.mobileStation, mutual
clobber pinned), so a player placing a cauldron or hearth OVERWRITES their own field
forge; either record and pin that same-slot semantics deliberately, or a second slot
is a recorded design decision, not a drive-by field.
Agent 3 (enchanting): confirm the Lucent Reagent intermediate from phase 07 feeds this
line (author it here ONLY if the phase 07 ledger lacks it). Three apex enchants
(weapon, chest, boots) as FLAT stat increments one rung over the existing enchants,
stats only; boots per R7: stats only, NO movement speed. "Lucent Infusion": enchanting
skill 125, applicable ONLY to Perfected pieces: authored now behind a guard that
refuses every current item (phase 12's instance flag turns it live); application rides
the existing enchanting cast seam. Refusal lines: sim emit + sim_i18n matcher in the
SAME change (S3 guard).
Agent 4 (tests): exclusivity pins (a flask and an elixir of the paired family never
both apply; scroll/flask/food land in distinct-or-shared families EXACTLY as designed);
increment pins (exactly one rung vs the shipped values); flask death-persistence; the
infusion guard (no current item accepts it).
Record in state.md: the full aura-family design (which families flasks, foods, and the
phase 06 scrolls share), every increment value, and the infusion guard shape phase 12
must flip.

INVARIANTS IN PLAY: R14 (stat increments in existing aura families; no new proc effects
anywhere); R7 (boots enchant stats only, no movement speed: rift racing); R13 (apex
products at 100, capstones at 125); R15 (any new proper noun web-verified; Grand
Cauldron, The Laden Hearth, Lucent Infusion are already registered); determinism (any
draw via Rng at a documented site); i18n emit + matcher same change; ids append-only;
masterwork.ts untouched.

Out of scope: the Perfecting stage itself and the instance flag (phase 12: the infusion
stays inert here); patterns and drop wiring (phase 11); UI beauty work (phase 14).

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
npx tsc --noEmit; npx vitest run tests/progression.test.ts tests/recipe_economy.test.ts
tests/itemization_coverage.test.ts tests/item_level.test.ts tests/architecture.test.ts
tests/localization_fixes.test.ts tests/shipped_item_ids.test.ts plus the new
exclusivity/increment/guard tests; npm run ci:changed. THE PHASE 09 LESSON,
non-negotiable: before calling ANY review round done, run the FULL suite
(npx vitest run --maxWorkers=5), never only a curated battery; twelve census reds hid
outside every curated battery at phase 09. EXPECTED RED: tests/professions_blob_growth
WILL red on the tracking band (~160 bytes slack, recorded by design); re-MEASURE the
adversarial load and re-band around the new settled bytes as a same-change obligation,
never widen blindly (the structural 12288 ceiling should hold, ~1150 bytes spare).
Other standing facts: new suites declaring >300s of vitest timeouts need a
tests/suite_duration_budget.test.ts ledger row; sweep appends ride the family tables
(masterwrought_budget arm 2 unions APEX_ARMOR_RECIPES + APEX_GEAR_RECIPES; a new
APEX_CONSUMABLE_RECIPES-style array must join a completeness arm or be excluded with
written rationale); src/render/renderer.ts sits at EXACTLY its 13708 monolith ceiling
(zero headroom; touching it requires an extraction that lowers the ceiling); a content
phase moves the stills bundle graph, so the portrait manifest re-bless happens at the
genuinely FINAL code tip via the receipt flow, proven with --check. Review Dispatch
Matrix (implementation-plan.md): architecture-reviewer (aura families, cast seam,
placements are sim behavior); cross-platform-sync if a SimEvent, wire field, or
matcher rule was added for the placements; content-obligations-reviewer (new item ids:
WebP art with EXACTLY ONE mapping.json owner per the batch-XOR rule, M16 non-Latin
fills for the wordy names, wiki regen, deed/reliquary posture per the phase 08
crafted-tradables precedent and the OPEN curation decision); frontend-seam-reviewer
only if src/ui logic changed; qa-checklist when the deliverable set is complete.
COVERAGE prompts; apply ALL findings.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- feat(content): apex flasks and role foods one rung over the shipped lines
- feat(sim): grand cauldron and laden hearth party placements
- feat(content): apex enchant line and the guarded lucent infusion
- test(sim): exclusivity, increment, and infusion-guard pins

STEP 5 - ACCEPTANCE:
- [ ] Flasks persist through death, one active, exclusive with elixir pairs; foods
      well-fed exclusive; every increment exactly one rung
- [ ] Boots enchant has NO movement speed (R7); no new proc effect anywhere (R14)
- [ ] Lucent Infusion inert (guard refuses every current item); guard shape in state.md
- [ ] Cauldron and Hearth party-usable in BOTH hosts on the placement family
- [ ] Aura-family design recorded in state.md; all suites green; ci:changed clean

STEP 6 - DOCS: progress.md Phase 10 row; state.md ledger (new ids, i18n keys, the
family design, increments, the guard shape); memory note if anything surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, handoff
line for Phase 10 QA.

STOPPING RULES: stop and ask if the elixir_${kind} aura-id scheme cannot express the
flask/elixir pairing without behavior-changing edits to shipped aura ids, if a
capstone is meant to survive a realm restart (the persisted-station schema decision),
if the infusion guard cannot be authored without phase 12 machinery, or if the release
merge conflicts inside items.ts's elixir arm or enchanting.ts.
```
