# Masterwrought: implementation plan

The endgame professions expansion, in two halves that ship as one system. The CRAFTING
half: epic (apex) craftable gear near raid power for all ten crafting professions, the
global "Masterwrought (2)" equip cap, tradable pattern drops, the raid-material economy
(Wyrmfall Core, Sundered Essence, Maker's Ember), the Perfecting stage that pushes a bound
piece slightly over raid, and the orange promotion. The GATHERING half: the completion of
the gathering tier, so every gathering skill feeds the craft economy and every gathering
skill has real content at every rung instead of only at the bottom of its ladder. Full
vision and research record: `brainstorm.md`. Locked rulings and numbers: `state.md`.

The packet also carries FARMING, the fifth gathering profession, absorbed whole from
`feature/farming-plan` (14 completed phases on a parallel F axis; see "The farming absorb"
below). With that absorb the packet ships fifteen professions of content as one system:
five gathering (mining, logging, herbalism, fishing, farming) and ten crafting. Farming's
own planning record lives at `docs/prd/masterwrought/farming/`.

Seven rulings govern the gathering half and the player-pain block. Every phase below cites
them by number; `state.md` holds their full text beside R1 to R16, plus the standing rule
on the ruling-number collision with the Professions 2.0 R series (short version: packet
numbers never renumber, but any R-number written into `src/`, `server/`, `tests/`, a
`CLAUDE.md`, or `docs/design/` reads "masterwrought R<n>" in full, because a bare R-number in
those files means the other series, permanently; `docs/design/professions.md` is the sharpest
case, since it is that series' own authority file).

- R17 THE PROVISIONER RULE. Farm produce feeds the CONSUMABLE professions (cooking and
  alchemy) at every rung, and NEVER the gear chain, the Perfecting materials, or
  `recipe_quickening_catalyst` (the packet's one pacing gate). Grain and vegetables are the
  third gathering input family beside meat/fish and herbs.
- R18 NEED THE OUTPUT, NEVER THE SLOT (the demand engine). Everyone needs what professions
  make; nobody needs to have TAKEN a profession to equip, enter, or complete anything.
  Needing the slot is a tax players resent and games refund; needing the output is the
  largest possible market, because the buyers are everyone. Mechanically: every farm
  produce item stays market-listable `kind: 'junk'`, tiers 1 and 2 vendor-stocked, so a
  raider buys grain the way they buy `sunpetal_herb`. Farming rows are ADDED to bills
  alongside herbs, never substituted for them, which is also how farming's D24 displacement
  guardrail is honored: herbalism loses nothing.
- R19 FARMING IS A LONG-HAUL SKILL. Its gain curve is deliberately slower than the other
  gathering professions because harvests are wall-clock gated, and it is tuned against a
  MEASURED calendar-days-to-100 model built from real bed counts and cycle times, never
  from feel. Slower pacing never becomes punishment: no daily reset, no decay, a late
  harvest still costs only opportunity, and farming's anti-chore contract holds absolutely.
- R20 EVERY GATHERING PROFESSION REACHES THE ENDGAME. No gathering profession may be
  absent from recipes at skillReq 100 or above, nor from any 25-point band below it. This
  is enforced by a test, not by intention.
- R21 DEMAND-SIDE DESIGN. Every profession's output must be CONSUMED at a rate that
  sustains a market. R20 is the supply half of one invariant, R21 the demand half: R20
  proves every gathering profession feeds the crafts, R21 proves the world eats what the
  crafts make. A profession feeding a recipe nobody buys is still dead content, and only
  the demand half catches it. The line it does not cross is R5's envelope: prepared is
  meaningfully stronger, unprepared is behind and never locked out.
- R22 NO MATERIAL IS GEOGRAPHICALLY TRAPPED. Every mapped corpse-harvest family reaches a
  floor of templates, zones, and at least two level bands, and no template carries a tag
  absent from `HARVEST_COMPONENT_ITEMS`. The floor is measured in REACHABILITY, not
  membership: met by tagging a raid boss, it is the same bug with a passing test.
- R23 A VENDOR IS A FLOOR, NEVER A COMPETITOR. No vendor item sits within the decided
  margin of a crafted equivalent, and the margin WIDENS as the rungs climb. The floor is
  created by lowering the vendor line, never by raising the crafted line, so R5's ceiling
  stays where it was measured. A floor is not a cliff: a player with no crafter and no
  market access must still be able to buy something that works.

EVERY DESIGN GATE IN THIS PACKET IS SETTLED (2026-08-20, the full delegation, plus the
same-day reconcile pass that swept every file against it, plus the same-day quality-review
adoption pass, rows 117 to 133). No phase file still asks the
maintainer to pick anything: each gate now reads as an instruction the session executes, and
the ONE collection point for every answer is `state.md`, section "Decisions closed 2026-08-20
(the full delegation)", which records the rulings with their reasons, the rejected
alternatives, the cross-checks between rulings, and the new work they imply. Exactly ONE item
is not answered there, and it is not a design question: ip-17-PUSH, the push and the PR,
which needs the maintainer's own word at the time. (ip-NAME-BORDERLINE was formerly the
second open item; it was CLOSED 2026-08-20 by the maintainer, narrowly, at state.md row 114:
Phase 16 renames the ONE profession-related entry, the 'Enchant <Slot> - <Stat>' scheme,
inside its merged naming-registry pass, and the zone families and coins are never renamed by
any phase. An earlier revision of this paragraph said two items stayed open and that no
phase may act on ip-NAME-BORDERLINE; both claims were stale against row 114 and were
corrected by the adoption pass, state.md row 132.)
Where a phase file and that record disagree, the disagreement is doc drift to fix before any
edit, never a licence to pick.

STANDING DELIVERY RULE (maintainer, 2026-08-20, binds every phase including 17): NOTHING IS
PUSHED AND NO PULL REQUEST IS OPENED until the maintainer says so, in words, at the end. No
phase pushes. No phase opens a PR. Phase 17 prepares the PR body and then ASKS; it does not
open it. A green gate is not consent, and neither is a completed checklist. This supersedes
any "push and open the PR" line anywhere in this packet or in the absorbed farming files.

Delivery contract: everything ships in ONE branch (`feature/masterwrought`) and ONE PR,
farming included. Nothing is deferred to a future PR; an item is in this packet or cut.
`feature/farming-plan` becomes an ancestor of `feature/masterwrought` through a real merge
commit and is never delivered separately, so farming's D22 (local-only, no push, no PR)
and its addendum (B) no longer describe delivery. Every "per D22: no push, no PR" line
inside `farming/` is the historical record of how that phase ran, not a live rule; where a
farming phase file and this contract disagree, this contract wins.

## Canonical Team Workflow (every phase session follows this; phase files reference it)

Every phase runs as its own fresh session at xhigh effort; add `ultracode` for the
batch-heavy phases the table marks. Steps:

0. PRE-FLIGHT: WORKTREE GUARD first (the user runs multiple concurrent sessions): if pwd
   is not `~/Documents/wocc-masterwrought`, switch this session into it with the
   EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought), or stop and
   ask the user to relaunch there; phase work never runs from the main checkout. Then
   `git status` clean in `~/Documents/wocc-masterwrought`. Then SYNC THE
   RELEASE BRANCH (maintainer directive, every phase, no exceptions): `git fetch origin
   --prune`, then DISCOVER the newest release branch by version sort, never by assuming
   the branch's current upstream or the last phase's target is still it:
   `git branch -r | grep 'origin/release/' | sort -V | tail -1`
   (the packet started on release/v0.36.0; when a release/v0.37.0 or later appears, THAT
   is the merge target from that phase on). Merge that branch into `feature/masterwrought`,
   resolve, and run the `release-merge-audit` skill on the merge before any phase work.
   SYNC MID-PHASE RULE: if the pending jump is a minor version or more, or the
   release-delta intersection with the packet footprint reaches triple digits, that absorb
   runs as its OWN phase before the next feature or QA phase, so an absorb of that size
   never shares a diff with feature work. Scan memory (`MEMORY.md` index) for entries
   matching the phase domain.
1. LOAD CONTEXT via an Explore agent (never read planning docs or coordinator monoliths in
   the main loop): `state.md`, `progress.md`, this phase's file, and the phase's listed
   source files. The agent returns a focused summary.
2. EXECUTE with the lightest orchestration that fits (parallel Agent fan-out by vertical
   slice; `ultracode` Workflow for the marked batch phases). Request fan-out explicitly.
3. VALIDATE per the matrix in `state.md`, then spawn review agents per the Review Dispatch
   Matrix below (only rows the diff touches; prompt for COVERAGE, not filtering). No
   commit while any BLOCKING finding stands. Apply ALL findings: blocking, should-fix,
   and nits (maintainer standing rule). Read the gate LOG, never just its exit code: a
   printed FAIL marker overrides a zero exit.
4. COMMIT with explicit paths (never `git add -A`), Conventional Commits with scope and a
   body, no em dashes or emojis, no session trailers. Phase-boundary merges are `--no-ff`,
   so every phase stays one readable boundary in the history.
5. UPDATE `progress.md` + `state.md` (ledger sections) and memory, then end with the
   standard phase report and a one-line handoff for the QA session.

Four of those rules (newest-release re-resolution by version sort, the sync mid-phase
rule, `--no-ff` phase-boundary merges, and the gate log-marker discipline) come from
farming's D22 absorb discipline. D22 no longer governs delivery, but this half of it
survives the absorb and is now the packet rule for every remaining phase.

Code hygiene every phase: module-first behind existing seams (`SimContext`, `IWorld`
facets, content tables, view-core + painter); new code gets tests; determinism (all
randomness via `Rng`); i18n English-only catalog keys + sim/server matcher rules in the
same change; dead-code and import cleanup; no generated-file hand-edits; classic-era
formulas only. UI work follows `DESIGN.md` (the interface design-language standard):
this system must be beautiful and a pleasure to use, not just correct.

## Review Dispatch Matrix (the one canonical copy; phase files reference it)

| Agent | Spawn ONLY when the diff touches | Skip it for |
|-------|----------------------------------|-------------|
| `privacy-security-review` | `server/`, `src/admin/`, `src/net/`, deploy/secret files, SQL/auth, or nondeterminism introduced in `src/sim/` | pure ui/render/game/content/docs/test changes |
| `migration-safety` | `server/db.ts`, `server/*_db.ts`, or a `characters.state` JSONB serialize/deserialize path | no DDL and no persisted-shape change |
| `database-performance-reviewer` | SQL/database call sites, indexes, query cadence, pool/lock/timeout, stored-data growth | diffs that cannot change database work |
| `cross-platform-sync` | `src/world_api/**`, `src/sim/` behavior/`SimEvent`, `src/net/online.ts`, `server/game.ts` wire, the i18n matchers, or the RL surface | pure i18n catalog refactors |
| `architecture-reviewer` | any `src/sim/` change (determinism, rng draw order, tick phases, the `SimContext` seam) | non-sim or pure data/test changes |
| `frontend-seam-reviewer` | `src/ui/`, `src/render/`, `src/game/`, `src/styles/` | no frontend surface |
| `qa-checklist` | a phase's deliverable set is COMPLETE | mid-phase work |

## Phase summary

| Phase | Title | ultracode? | Origin | Size | Surface |
|---|---|---|---|---|---|
| 01 | Masterwrought equip cap | no | UNCHANGED | done | sim, world_api, ui, net |
| 02 | Pattern items and recipe learning | no | UNCHANGED | done | sim, world_api, ui, net |
| 03 | IP naming sweep | yes (audit) | UNCHANGED | done | content, ui i18n, docs |
| 04 | Materials backbone | no | UNCHANGED | done | sim, content, server |
| 05 | Jewelcrafting base catalog | yes (content) | UNCHANGED | done | content, ui |
| 06 | Inscription base catalog | yes (content) | UNCHANGED | done | content, sim, ui |
| 07 | Intermediates and the Quickening Catalyst | yes (content) | UNCHANGED | done | content, sim |
| 08 | Apex armor catalogs | yes (content) | UNCHANGED | done | content, tests |
| 09 | Apex weapons, jewelry, gadgets | yes (content) | UNCHANGED | done | content, tests |
| 10 | Apex consumables and enchants | no | UNCHANGED | done | content, sim |
| 11 | Pattern drops and vendors | no | UNCHANGED | done | content, sim, server |
| F01-F14 | Farming foundation through final polish | n/a | ABSORBED | done | the fifth gathering profession |
| **11b** | **Farming absorb** | no | **NEW** | L | 160 conflicts, docs move, type-union port |
| **11c** | **Food and feast reconciliation** | no | **NEW** | M | 22 semantic files, 5 locale overlays |
| **11d** | **Derived artifacts, pins, and the merge audit** | no | **NEW** | M | 67 goldens, 27 generated, 13 pins, 4 ceilings |
| **11e** | **A true skill, farming's mastery curve and crop roster** | no | **NEW** | M | content: gain curve, crops, seed vendors, deeds |
| **11f** | **Farming joins the drop economy** | yes (content) | **NEW** | L | content: recipes 75 to 125, patterns, loot rows |
| **11g** | **The provisioning supply line, leveling tier** | yes (content) | **NEW** | L | content: cooking and alchemy bills 0 to 50 |
| **11h** | **The provisioning supply line, apex tier** | yes (content) | **NEW** | L | content: bills 75 to 125, fine twins, zero new ids |
| **11i** | **The angler's endgame** | yes (content) | **NEW** | L | content: fish in bills, catch bands, skill 200 |
| **11j** | **The gathering completion pass** | no | **NEW** | M | content, tests: R20 enforcement, apex tool family |
| **11k** | **The provisioning capstone and prestige** | no | **NEW** | M | content: the three apex feasts, signatures, deeds |
| **11l** | **The trophy economy** | yes (content) | **NEW** | M | content: 21 junk drops gain consumers, zero new ids |
| **11m** | **Harvest geography and material sinks** | yes (audit) | **NEW** | M | content, tests: tag spread, orphan tags, R22 |
| **11n** | **The vendor floor** | no | **NEW** | S | content, tests: vendor line nerf, R23 |
| **11o** | **The leveling crafter** | no | **NEW** | S | content, tests: recipe.level re-derive, engineering on-ramp, 150 re-tier |
| 12 | The Perfecting stage | no | AMENDED | L | sim, world_api, net, server, db |
| 13 | Orange promotion | no | AMENDED | L | sim, world_api, ui, render |
| 14 | Crafting UX beauty pass | no | AMENDED (heaviest) | L | ui, game, styles |
| 15 | Power verification | yes (audit) | AMENDED | M | tests, docs |
| 16 | Polish and content surfaces | yes (sweep) | AMENDED | M | render, ui, guide, admin |
| 17 | Final integration QA and PR | no | AMENDED | M | everything |

Origin reads: UNCHANGED is a masterwrought phase that already shipped as authored;
ABSORBED is farming's completed work, recorded here and not re-run; NEW is work the absorb
creates; AMENDED is an existing phase that keeps its number, title, and every forward
carry and grows a farming arm (the "Farming arm" paragraph in its section below).

Each phase 01 to 16 is followed by its own QA session (`phase-NN-qa.md`), and so are the
fourteen inserted ones (`phase-11b-qa.md` through `phase-11o-qa.md`). Phase 17 is the
packet-closing QA and PR phase, and offers packet teardown before the PR.

### The player-pain block (11l, 11m, 11n)

Ten of the fourteen inserted phases exist because of the absorb. Three exist
because of reported player pain, admitted by the maintainer on 2026-08-20, and they share a
method worth stating once: PERCEPTION IS RELIABLE ABOUT *THAT* SOMETHING IS WRONG AND
UNRELIABLE ABOUT *WHY*, so every reported item is re-measured before it becomes a
deliverable. The worked example is the "Homespun Cloth drops too much" report: the felt
problem is real, and there is no drop RATE to nerf because the mechanism is component-tag
membership. The fix is to raise the floor under the scarce tag, not to thin the abundant
one.

They run in order after 11k, since all three edit the item and recipe tables the 11-block
leaves behind, and 11m hands its vendor-potion finding to 11n.

### The quality-review phase (11o)

The fourteenth inserted phase comes from neither the absorb nor a player report: it is the
output of the packet's own standing quality review (`professions-quality-review.md`), whose
first run (2026-08-20, against the plan) the maintainer adopted in full ("I want to do
EVERYTHING you mentioned"). `phase-11o-leveling-crafter.md` + `phase-11o-qa.md` own the
three measured defects that had no owner anywhere in 01 to 17: the required-level cliff
that locks every crafted rung-50/75 rare out of levels 14 to 19 (recipe.level 20 on all of
them; state.md row 118), the engineering on-ramp (nothing craftable below skillReq 75 and
unattuned engineering cannot gain a point; row 119), and the three grandfathered skill-150
tool recipes sitting above engineering's own reachable cap (row 120). It runs after 11n
and MUST land before Phase 15, which measures a settled world. The same adoption pass also
amended, in their own files: 11i and its QA twin (the fishing pacing arm, row 121), 11l
(the output doctrine and corrected counts, rows 122 and 123), 11m and its QA twin (the
spread and census repairs, rows 124 to 126), 11n (the widened scope, row 127), Phase 12
(the Perfecting cadence criterion, row 129), Phase 15 (the shelf premise and the
gray-grind record, rows 118 and 128), Phase 16 (the gate-model paragraph, row 133), plus
smaller corrections in 11d, 11e, 11f, 11g-qa, 11h, 11j, decisions-index.md and
brainstorm.md (rows 130 to 132); the full file list is in
professions-quality-review.md's first-run record.

### GATE (CLOSED 2026-08-20, ADMITTED): the three player-pain phases

This gate is ANSWERED. The maintainer admitted all three on 2026-08-20, so they are in the
table above, in the README list, and in the `progress.md` status table, and an admitted
phase may depend on them. The record is kept because the reasoning is still the reasoning,
and because a later CUT would need it. What was admitted:

- `phase-11l-trophy-economy.md` + `phase-11l-qa.md`. The 21 junk-kind mob drops that feed
  no recipe today gain profession consumers. Zero new item ids, so it carries no art, M16,
  or naming cost.
- `phase-11m-harvest-geography.md` + `phase-11m-qa.md`. Harvest geography and material
  sinks: no material forces a leveled player back into a starter zone, no component tag
  yields nothing. Pure data edits over shipped content.
- `phase-11n-vendor-floor.md` + `phase-11n-qa.md`. A vendor is a floor, never a competitor:
  every vendor consumable becomes visibly and structurally worse than its crafted
  counterpart, with the margin widening as the rungs climb. 11m's vendor-potion report is
  explicitly handed to this phase.

THE REASONING BEHIND THE ADMISSION, kept for the record: all three are data work over
shipped content, all three serve the stated goal that every skill has real content at all
levels, and the delivery contract allows only "in the packet or explicitly CUT". 11l in
particular carries no art, M16, or naming cost at all, which makes it the cheapest content
in the whole program.

RE-CONFIRMED 2026-08-20 under the full delegation (ip-GATE-PAIN, recorded in `state.md`).
No CUT is taken, so neither dependent amendment below is needed. The three phases' own
decisions are settled with them: DECISION 11 at 11l-D-11 / 11l-HOLDOUT / 11l-SELL /
11l-RUNG, DECISION 12 at 11m-D-12 / 11m-ORPHAN / 11m-FLOOR, and DECISION 13 at 11n-D-13 /
11n-BOTH. The one piece of residual work the admission left behind was DOC DRIFT, not scope,
and it is now CLEARED: `phase-11m-harvest-geography.md` said "NOT YET ADMITTED" and
`decisions-index.md`'s NNb/NNc row said the same and said "ten inserted phases". Both are
corrected (11m-ADMIT; NEW WORK N2 discharged by the 2026-08-20 reconcile pass), and Phase 11d
unit 7 now VERIFIES both rows against the merged tree rather than authoring them.

IF ONE IS EVER CUT: delete its two files and record the cut here, so nothing is left
orphaned in the directory. A CUT of 11n also requires amending 11m's vendor-potion line,
which points at it. A CUT of 11m requires amending 11j, whose demand-coverage arm cites
11m's reagent sweep as its worked example.

## The farming absorb

`feature/farming-plan` is absorbed by a real merge commit, never a squash, so farming's
397 commits stay reachable and the release-merge convention keeps working. Its 14
completed phases are recorded on a parallel F axis, its docs move wholesale to
`docs/prd/masterwrought/farming/`, and FOURTEEN b-suffix phases land between the completed
Phase 11 and the planned Phase 12 (ten from the absorb, the three player-pain phases
11l, 11m and 11n admitted 2026-08-20, and the quality-review phase 11o admitted the same
day). Three of them do the absorb itself: 11b merges the
trees, 11c reconciles the one genuine design collision (Well Fed and the feasts), and 11d
re-derives every self-minting artifact with an audit that can actually detect a bad
resolution. The seven after them are the gathering half of the packet, 11e through 11k,
each with its own section below: farming's measured mastery curve and its crop roster
(11e, which also discharges the seed gate), farming's entry into the drop economy (11f),
the provisioning supply line at the leveling and apex tiers (11g and 11h), the angler's
endgame (11i), the completion pass that enforces R20 (11j), and the provisioning capstone
and its prestige (11k).

Two numbering axes, and neither is renumbered. Masterwrought stays bare `01` through `17`
at `docs/prd/masterwrought/phase-NN-*.md`, because its ledgers cite forward carries by
number into unstarted phases and four screenshot cone rows are keyed to them. Farming is
cited as `F01` through `F14` (with `F06b` and `F09b`) from every merged doc, while the
farming file bodies keep saying "Phase 11" exactly as written and are never rewritten:
they are a historical record, not a live plan. New work appends on the masterwrought axis
with the b-suffix idiom both packets already use: `11b` through `11n`. Phases 12 to
17 keep their numbers, their titles, and every forward carry.

Decision namespaces do not collide and are not renumbered either. `R1` to `R16` are
masterwrought rulings in `state.md`, cited from shipped source (`apex_patterns.ts` for R8,
`types.ts` for the R14 corollary, `masterwrought_materials.ts` for R4 and R9). `D1` to
`D24` are farming decisions in `farming/state.md`, cited from `docs/design/deeds.md` and
four test comments. Farming's deviation letters `(a)` through `(ca)` are one global
append-only sequence distributed through its per-phase ledgers; the next letter is `(cb)`
and nothing is ever resequenced. `decisions-index.md` is the one-page key to all five
namespaces, the fifth being the COLLIDING Professions 2.0 `R` series that shipped source
cites.

Ledger histories do not merge; status tables do. `progress.md` keeps THE table and gains
16 farming rows as `F01` to `F14` (including `F06b` and `F09b`) with status "complete
(absorbed)" and a Record column pointing at `farming/progress.md`; farming's row bodies
are not copied, since several run 1000 to 2000 characters of dense verdict text.
`state.md` remains the file every phase session loads. `farming/state.md` is demoted to
the farming design authority and becomes the packet's ONE open-item collection point,
because its 117-row handoff table has a real status vocabulary and this packet has no
equivalent (masterwrought's open decisions are scattered inside the Phase 10 ledger).
Masterwrought's open decisions append there as new rows at the end, never interleaved. Until
that file exists, the delegated answers live in `state.md`'s dated append-only block
"Decisions closed 2026-08-20 (the full delegation)" at the end of the file, and 11b STEP 6
MIGRATES that block into `farming/state.md`'s handoff table in the SAME commit as the doc
move, leaving a one-line pointer behind (state-COLLECT, and NEW WORK N3: the migration step
is not in 11b's current STEP 6 and is added there).
GATE 1 in that table (the D11/(bo) tier 3 and 4 seed bootstrap) is a BLOCKER on this
packet's single PR and is discharged in Phase 11e. ITS ANSWER IS SETTLED (11b-D-1 and
state-GATE-7): vendor-stock every tier 3 and tier 4 seed at `farmer_hollis` and
`farmer_verbena` on the D11 tier 1/2 pattern, once, in 11e, priced per 11e-D-D, which is
EIGHT rows after the roster grows. It stays flagged as the blocker until a phase VERIFIES
the rows by reading the merged `vendorItems` arrays in code; a ledger row is never the proof.

### The ordering rule for every append-only table

Three tiers, stated once here and applied to `src/sim/content/deeds.ts`,
`src/sim/content/recipes.ts`, `src/sim/content/profession_items.ts`,
`src/sim/content/reliquary.ts`, `src/ui/i18n.catalog/items.ts`,
`src/ui/i18n.catalog/hud_chrome.ts`, and the `tests/architecture.test.ts` allowlist:

1. RELEASE rows first, always, so the eventual merge back to release stays a pure tail
   append.
2. Masterwrought's committed rows next, positions frozen. Never re-sorted to sit beside
   their families, never interleaved with farming's.
3. Farming's block last, appended whole and contiguous, because farming is frozen at 14
   phases while masterwrought still appends through Phase 17. Putting the frozen block
   first would force every remaining phase to insert mid-table.

Two consequences are expected, re-derived, and never chosen: `DEED_ORDER[len-1] ===
'prog_farming_100'` until Phase 11e appends after it, and a merged `FROZEN_CATALOG_SHA256`
that matches neither parent. Any list the file itself keeps sorted stays sorted; the tier
rule governs append-only tables only.

---

## Phase 01: Masterwrought equip cap

Goal: the global counted equip family that every apex piece will join.

Deliverables:
- `ItemDef.masterwrought?: boolean` plus a counted-family rule beside (not inside)
  `isUniqueEquipped` in `src/sim/equipment_rules.ts`: at most 2 equipped items with the
  flag, and at most 1 whose effective quality is legendary (the R3 sub-cap), evaluated in
  `uniqueEquipConflictSlot` style with `ignoreSlots` handling for swaps and two-hander
  displacement (R6: a 2H counts as one).
- Equip refusal error line (sim emit + `sim_i18n.ts` matcher) and the tooltip tag
  "Unique-Equipped: Masterwrought (2)" as a `t()` key, rendered for flagged items.
- Drag/drop and equip-command coverage in both hosts: `Sim` equip path and `ClientWorld`
  mirror, plus `src/ui/equip_drop_core.ts`.
- Tests: a dedicated `tests/masterwrought_cap.test.ts` (cap at 2, sub-cap at 1 orange,
  swap/displacement edge cases, 2H counts one, duplicate copies allowed per R16), plus the
  world_api parity pin update if a facet member is added.

QA focus: cap unenforceable paths (bank/mail/trade equip routes, load-time state with 3
flagged items already equipped must not brick a save: tolerate and refuse next equip).

## Phase 02: Pattern items and recipe learning

Goal: recipes as tradable items, learned on use.

Deliverables:
- A pattern item representation: either a new `ItemKind 'recipe'` or a use-handler item
  kind decision (record in `state.md`); item defs carry `teachesRecipeId`.
- Use flow: profession gate, tier gate (`tierForSkill(skill) >= tierForSkill(skillReq)`),
  already-known refusal, then `acquireRecipe(ctx, pid, id, 'drop')`; consumes the item.
  Bind on learn is automatic (the item is consumed).
- Tooltips: taught-item preview, profession + skill requirement lines, already-known
  state; all `t()` keys.
- Both hosts + tests (`tests/recipe_pattern_items.test.ts`): learn, refusals, consume-on-
  learn, market listability of patterns.

QA focus: the learn path draws no rng; pattern items respect the frozen-id golden; S3
matcher coverage for every refusal line.

## Phase 03: IP naming sweep (ultracode audit)

Goal: no shipped or new name reuses a coined term or full item name distinctive to
another game (maintainer directive; its own phase).

Deliverables:
- A web-verified audit of EVERY shipped player-visible proper noun (items, materials,
  recipes, zones stay as-is unless collision) against WoW, RuneScape, FFXIV, GW2, ESO,
  Diablo, PoE wikis via a Workflow (multi-modal sweep + adversarial verify), producing
  `docs/prd/masterwrought/naming-audit.md` with per-name verdicts.
- Display-name-only renames for confirmed collisions (known: arcanite bar, silverleaf
  herb; the audit decides the full list). Ids NEVER change. English catalog + sim_i18n
  matcher + wiki regen in the same change; M16 non-Latin fills for wordy renames.
- The new-name registry in `state.md` confirmed or amended per verdict.

QA focus: no id changed anywhere; `tests/shipped_item_ids.test.ts` untouched-green; the
S3 guard green; wiki regenerated.

## Phase 04: Materials backbone

Goal: the three shared chase materials and their faucets.

Deliverables:
- "Wyrmfall Core": tradable (kind junk, quality rare, stackSize 20), dropped 1 to 3 per
  final-boss kill in the raid and heroic five-mans (per-participant, `awardHeroicMarks`
  pattern), from rift A/S first clears once per character per day (R9; new daily gate on
  `PlayerMeta`), and sold by the Heroic Quartermaster for Heroic Marks (price recorded in
  `state.md`).
- "Sundered Essence": soulbound, extracted via a new disenchant-adjacent action available
  on any RAID-sourced epic of the tier (source-level check), cast-paced on the shared
  profession cast seam; yields recorded in `state.md`.
- "Maker's Ember": soulbound keystone, 1 per week per character, bankable (accrual field
  on `PlayerMeta`, persisted; weekly grant on the first eligible endgame completion of the
  week: raid boss, heroic final boss, or rift A/S clear).
- Persistence (optional `CharacterState` fields with defaults), both hosts, tests for
  faucet caps, weekly accrual across the reset boundary, and the rift daily gate.

QA focus: draw-order neutrality of grants; DB JSONB back-compat; the rift gate cannot be
farmed across portal cycles; retention story for any new server table (none expected).

## Phase 05: Jewelcrafting base catalog (ultracode content)

Goal: jewelcrafting exists (today it has zero recipes).

Deliverables:
- The 0/25/50 rungs: rings and necklaces (common/uncommon/rare) consuming existing ores,
  gems-from-salvage, and vendor flux; budgets exactly formula-derived; economy invariant
  (`tests/recipe_economy.test.ts`) green with an EMPTY exception list.
- Station/training decision: new station type or explicit `stationType` on each recipe
  (record in `state.md`); trainer rows + fees per the existing tier table.
- Icons (icon-system rows), English names in the items catalog, wiki regen.

QA focus: no rating allocations beyond same-band vendor jewelry (R14); itemization
coverage tests; profession XP curve sanity on the new rungs.

## Phase 06: Inscription base catalog (ultracode content)

Goal: inscription exists, power-safe.

Deliverables:
- The 0/25/50 rungs: offhand tomes (caster stat pieces) and buff scrolls. Scrolls share
  the elixir aura families via `exclusive_aura.ts` so they are an alternative source,
  never a stack (R14 corollary; pinned by test).
- Station/training decision recorded; icons, names, wiki as phase 05.
- NO glyph system, NO ability modifiers: explicitly out of scope for the whole packet.

QA focus: the exclusivity pin is decisive (scroll + elixir of the same family never both
apply); tome budgets formula-derived.

## Phase 07: Intermediates and the Quickening Catalyst (ultracode content)

Goal: the skill-75 rung for all ten professions.

Deliverables:
- One intermediate per profession (naming registry in `state.md`): Duskforged Billet,
  Forgefold Plating, Wyrmhide Cording, Sunspun Bolt, Prismglass Setting, Precision
  Chassis, Seasoned Stock, Lucent Reagent, plus cooking/alchemy inputs; each consumes
  gathered mats + 1 Quickening Catalyst; each is consumed by that profession's apex
  recipes (every material has a consumer, per `docs/design/professions.md`).
- "Quickening Catalyst": alchemy skill 75, one craft per day per character (daily
  cooldown field, persisted like node readiness), tradable. The bottom-of-chain time gate.
- Recipe rows, trainer wiring, icons, names, economy-invariant compliance, tests.

QA focus: the daily cooldown survives logout (cooldown_persist scheme); catalyst demand
math recorded in `state.md` (intermediates per apex piece) so phase 08/09 stay consistent.

## Phase 08: Apex armor catalogs (ultracode content)

Goal: the armor-craft apex pieces, slot-audited.

Deliverables:
- FIRST: a slot coverage audit (which slots per armor class have the weakest raid/heroic
  coverage), written to `state.md`; final slot picks come from it (plan default: chest,
  legs, waist for armorcrafting; chest, shoulders, feet for leatherworking; robe,
  leggings, gloves for tailoring).
- 9 apex pieces (`recipe.level: 25`, quality epic, skillReq 100, `masterwrought: true`,
  acquisition per R8) + the tailoring apex bag (best capacity, no cap flag).
- Reagents: intermediates + Wyrmfall Cores + gathered mats (quantities in `state.md`).
- The apex budget sweep test (`tests/masterwrought_budget.test.ts`): every apex item's
  primary stat sum EQUALS the formula budget; rating allocations pinned to same-band raid
  equivalents.

QA focus: stat-shape audit per piece (no scarce-stat outlier per the Lionheart/Lariat
rule); frozen-id and English-name gates.

## Phase 09: Apex weapons, jewelry, gadgets (ultracode content)

Goal: the remaining cap-pool pieces.

Deliverables:
- Weaponcrafting: 1H, "Ridgebreaker" 2H (TWOHAND mults, R6), shield; dps from
  `weaponDpsBudget`.
- Jewelcrafting: necklace + two rings, pure primary stats + stamina (R14).
- Engineering: "Gyrelens Array" offhand gadget (stats + cosmetic use), "Master's Field
  Forge" (apex mobile station, party-usable, mobile_station seam), apex tool charm (one
  rung over the existing charm ladder).
- Inscription: "Voidbound Grimoire" offhand tome.
- All join the budget sweep test; all flagged `masterwrought: true` except the field forge
  and charm.

QA focus: weapon dps within curve; the field forge respects station radius rules; charm
respects the R47/R30 price family.

## Phase 10: Apex consumables and enchants

Goal: the consumable professions' apex rung and the bounded enchant line.

Deliverables:
- Alchemy: three flasks (tank/physical/caster), persist through death, one active,
  exclusive with elixir pairs, ONE increment over the rare elixir line; "Grand Cauldron"
  (skill 125, places a party-interactable dispenser).
- Cooking: three role foods (one increment over current best, well-fed exclusive);
  "The Laden Hearth" feast (skill 125, party-wide).
- Enchanting: "Lucent Reagent" intermediate; three apex enchants (weapon, chest, boots)
  as flat stat increments one rung over existing enchants, stats only (R7); "Lucent
  Infusion" (skill 125, applicable only to Perfected pieces; lands with phase 12's
  instance flag but authored here behind a guard).
- Exclusivity + increment pins in tests; enchant application rides the existing
  enchanting cast seam.

QA focus: every consumable's aura family membership pinned; no stacking path (scroll +
flask + food all in distinct-or-shared families exactly as designed in `state.md`).

## Phase 11: Pattern drops and vendors

Goal: recipes reach players through the three pillars (R8).

Deliverables:
- Pattern items for every apex recipe (phase 02 machinery); raid + rift patterns in loot
  tables (rollGroup-safe append-only entries; rates in `state.md`), tradable.
- Heroic five-man patterns on the Heroic Quartermaster for Heroic Marks (prices in
  `state.md`).
- Market category/search handling for patterns and the new materials
  (`market_query.ts` and the ui browse surfaces).
- Drop-rate documentation and the deterministic catch-up valve note (the marks vendor IS
  the valve, live from day one).

QA focus: loot draw-order parity (append-only, rollGroup rules); no pattern is
unobtainable; every pattern's recipe exists and vice versa (referential test).

## The gathering half: phases 11e to 11k

11b, 11c, and 11d are the absorb, defined in "The farming absorb" above. 11l, 11m and 11n are
the player-pain block, defined in "The player-pain block (11l, 11m, 11n)" above, and they run
after 11k; 11o is the quality-review phase, defined in "The quality-review phase (11o)"
above, and it runs after 11n. The seven phases below are the gathering half of the packet. They run in order and each depends on the one
before it, because each certifies a ladder the next one builds on. Two rules bind all
seven. Every new proper noun any of them mints is web-verified at authoring against the
major game wikis and recorded in the naming registry in `state.md` (R15, and farming's
D17). Every new content id carries its full same-change obligations: committed WebP art,
which needs the maintainer's master SHA, so new ids park in `ITEM_ART_PENDING`; non-Latin
name fills for wordy English (M16); `npm run wiki:content` plus any new `guide.*` prose;
`src/ui/world_entity_i18n.ts` rows for named entities; Book of Deeds records for
conquerable content and Reliquary pages for conquerable unique loot; and a recomputed
`tests/recipe_economy.test.ts`, whose sorted literal pins BOTH packets edit and which is
never hand-merged.

## Phase 11e: A true skill, farming's mastery curve and crop roster

Goal: farming stops being a provisional curve over a short crop shelf and becomes a skill
with content at every rung.

`FARMING_GAIN_SCHEDULE` (1 / 0.5 / 0.1 / 0.02 by band, marked in source as "TUNING,
PROVISIONAL, FLAGGED FOR THE MAINTAINER") is replaced by a curve derived from a MEASURED
calendar-days-to-100 model built from real bed counts and cycle times per R19, with the
model itself recorded in `state.md` so the tune is reproducible from the doc rather than
felt. The model's one free parameter is settled (11e-D-A): about 10 weeks, 70 to 75 days,
for the reference farmer, with a floor of about 5 weeks at maximum dedication. The four gain
VALUES are DERIVED from the model and recorded, never pasted; the four `belowProficiency`
BOUNDARIES (25/50/75/100) are FROZEN, because `farmingTeachingCeilingFor` derives each crop
tier's teaching ceiling from them. The crop roster grows by +4 crops and 12 new item ids
(11e-D-B), with exactly one of the two new tier-3 crops a LEAF and no tier repeating a plant
class, so every 25-point band has something worth planting, and with every gate DERIVED from
tier through the shared 25-point band math and never hand-set (a crop gated at an arbitrary
skill like 90 is not available, and the invariant that a crop can never disagree with the
profession's ladder holds). The phase also discharges GATE 1 by vendor-stocking the tier 3
and tier 4 seeds (11b-D-1, at eight rows once the roster grows, priced at 32 and 64 per
11e-D-D), which un-dorms three trainer-visible recipes and two parked deeds in one content
edit, and it does that here rather than later because Phase 15 must measure a settled world. Depends on 11d: this is the first phase to
append to the tables 11d just re-derived, so it does not start until the export and symbol
census is green, since a dropped merge hunk found after 11e is indistinguishable from an
11e authoring bug.

## Phase 11f: Farming joins the drop economy (ultracode content)

Goal: farming's recipe ladder stops ending at trainer rows and skillReq 50.

All 14 farming recipes are `acquisition: ['trainer']` with zero drop rows, and the ladder
tops out at skillReq 50 (4 rows at 0, 3 at 25, 7 at 50, nothing at 75, 100, or 125), while
masterwrought ships 28 `acquisition: ['drop']` recipes; this phase re-tiers the ladder
band-complete to 0/25/50/75/100 and STOPS there (11f-GATE-A: the band table becomes 0:4,
25:3, 50:1, 75:2, 100:4, 125:0, still exactly 14 rows, with `recipe_harvest_feast` climbing
to cooking 100 and NOT 125, and `recipe_highwatch_barley_bannock` held at 50 as the band-50
anchor), and it puts a share of the new upper rows behind the three pillars R8 already defines
(raid and rift pattern drops, with the Heroic Quartermaster as the deterministic catch-up
valve). The pattern items ride Phase 02's machinery unchanged and the loot entries append
under the rollGroup-safe append-only rule, so no shipped drop rate moves and the
referential pin (every pattern's recipe exists and vice versa) extends rather than
changes. Depends on 11e, because a recipe at 100 is only real if the crop it consumes
exists at 100, and on Phase 11 for the vendor and market surfaces it reuses. Marked
ultracode for the batch: recipes, pattern items, loot rows, trainer wiring, and the tests
across four content tables.

## Phase 11g: The provisioning supply line, leveling tier (ultracode content)

Goal: farm produce becomes a real reagent family at the rungs players actually level
through.

The whole cooking tree uses 17 distinct reagents today and NOT ONE is a vegetable or a
grain; this phase puts grain and vegetable rows into cooking and alchemy bills at skillReq
0, 25, and 50 (the WHOLE-GAME census runs 32, 28, and 23 recipes at those rungs across all
ten crafts; the cooking and alchemy subset this phase actually edits is what the phase file
pins by row, about a dozen main-tree rows plus the absorbed farm dishes), so tier 1 and
tier 2 produce has a buyer from the first rung and R17's third input family becomes real. Every row is
ADDED alongside the herb or the meat it sits with and never substituted for one (R18),
which is also how farming's D24 displacement guardrail is honored: herbalism loses
nothing, and produce stays market-listable `kind: 'junk'` with tiers 1 and 2
vendor-stocked so a player who never farms buys grain the way they buy `sunpetal_herb`.
It also owns ONE row above its own band: `recipe_seasoned_stock`, the 75-rung choke point
every apex dish already consumes, takes `marsh_rice` 2 plus `bog_beet` 2 here (11g-D-C, and
11h-GATE-F drops it from 11h), because exactly one phase may edit a choke point and coupling
it to two tier-2 crops spreads the choke across two supply lines. Depends on 11e for the
roster and on 11c for the settled food and feast ladder, since a bill edit under an
unsettled Well Fed resolution would have to be re-priced twice. Marked ultracode: it is a
wide, low-judgment edit across three rungs of two professions, with one economy-invariant
recomputation at the end.

## Phase 11h: The provisioning supply line, apex tier (ultracode content)

Goal: the same supply line at the rungs this packet's own thesis is about.

Extends R17 through skillReq 75, 100 and 125, which is where the two tier-4 fine twins
(`fine_gilded_sunmelon`, `fine_evergarden_greens`) finally get the consumer they lack
today. The 75 rung is VERIFY ONLY: `recipe_seasoned_stock` belongs to 11g under
11h-GATE-F (11g-D-C lands `marsh_rice` 2 plus `bog_beet` 2 there, so one choke point feeding
the whole cooking apex tier spreads across two supply lines instead of one paddy), and this
phase reads the merged bill, re-derives the arithmetic above it, and edits the row for
nothing. The 150 rung is NOT 11h's and is not assumable (11h-150): it belongs to the
engineering tool ladder, and the R17 gathering-tool carve-out that reaches it is settled at
11j-D-F, scoped by text to the hoe ladder alone. R17's exclusion binds hardest here: produce
never enters the gear chain, the Perfecting materials, or `recipe_quickening_catalyst`,
which stays the packet's one pacing gate. THE
APEX FEAST BILLS' REAGENTS LAND HERE; THE FEASTS THEMSELVES ARE 11k (11h-GATE-E, CUT from
this phase 2026-08-20, because 11k owns every piece of machinery a placeable feast needs and
at cooking 125 the bill can take both tier-4 fine twins plus 11i's new high-band catch). The
consequence is worth stating plainly: 11h mints ZERO new item ids and still changes what the
game's four best consumable families are made of. The three role plates (`stonepot_stew`
buff_sta, `warspice_skewers` buff_ap, `sageleaf_chowder` buff_int) stop having byte-identical
bills, which no test pins today, and the amended `APEX_CONSUMABLE_RECIPES` header states the
new rule precisely: the food family's bills differ by exactly one crop row and are identical
in every other reagent, while the flask family stays byte-identical (11h-GATE-A). Depends on 11g (one ladder, authored bottom up) and on Phase 10's apex consumables,
and it must land before Phase 15, whose R5 kit definition now reads "the best available
food, always on, delivered by feast".

## Phase 11i: The angler's endgame (ultracode content)

Goal: fishing stops feeding only itself.

Endgame bills (skillReq >= 75) per gathering profession run mining 21, herbalism 15,
skinning 11, logging 6, and FISHING 1, and that one is `recipe_tidewrought_fishing_rod`,
so fishing's entire contribution to the endgame is a fishing rod; this phase puts fish
into the consumable bills they should already be in, beginning with
`recipe_sageleaf_chowder`, a CHOWDER whose five reagents (`seasoned_stock`, `prime_cut`,
`game_meat`, `sunpetal_herb`, `cooking_salt`) contain no fish at all. It also gives the
climb something to find: six raw fish exist across THREE catch bands and rod tier 3 already
reaches the last band, so the ladder grows THREE new bands (3, 4, 5) plus a tier-6 apex rod
(11i-GATE-A), which retroactively gives the shipped `stormreel_fishing_rod` and
`tidewrought_fishing_rod` a reason to exist, and the new bands gate on their own leaf
`FISHING_CATCH_BAND_THRESHOLDS` rather than on the shared proficiency array that also drives
land gathering (11i-GATE-B). And it gives skill 200 a payout larger than `prog_master_angler`
(the Master Angler title plus 25 renown is the entire reward for 150 points of grind today)
without minting combat power, since deeds are cosmetic-only: exactly ONE new deed, the apex
rod CRAFT at renown 10 with no title, because the shipped gathering ladder spaces its rungs
5 / 10 / 25 and has no 50 or 150 rung anywhere (11i-DEED). Depends on 11h for the apex
bills the fish enter and on 11g for the leveling bills below them. Marked ultracode: new
catch content, bill edits at both tiers, and the reward arm are three independent slices.

## Phase 11j: The gathering completion pass

Goal: R20 enforced by a test rather than by intention.

Sweeps all five gathering professions band by band and fills what the sweep finds, then
lands the test that fails the moment a hole reopens: no gathering profession absent from
recipes at skillReq 100 or above, and none absent from any 25-point band below it. It also
closes the one remaining hole in the apex gathering-tool family, which is
engineering-crafted at `arcanite_mining_pick` 150, `elderwood_axe` 150, `sunpetal_sickle`
150, and `tidewrought_fishing_rod` 125 while farming's ladder ends at `osmium_hoe`,
engineering skillReq 75, making farming the only gap in an otherwise complete family. HOW
THAT GAP CLOSES IS SETTLED, not a STEP 0 gate: a fifth hoe rung, `evergarden_hoe` at
engineering skillReq 125, acquisition `['trainer']`, `stationType: 'toolworks'`, on the
`recipe_tidewrought_fishing_rod` precedent, consuming `fine_evergarden_greens` 2 plus
`osmium_hoe` 1 (11j-D-A, 11j-TWIN, 11j-NAME). The 150 rung is HISTORY and not a target:
engineering's cap of 125 resolves to tier 5, so a trainer-taught row at 150 would ship a
recipe no player can ever learn, and the three rows that sit there are grandfathered in the
frozen `PRE_TRAINING_RECIPE_IDS` (and are re-tiered to 125 by Phase 11o afterward,
qr-11o-150, state.md row 120; 11j records the reading as it stands at its own runtime). Both hoe rungs also join `DELVE_SHOPS.drowned_litany` at
the shipped 24 and 56 mark points (11j-D-B), so the gathering family's one non-crafter route
covers farming too. The R17 carve-out that lets a hoe consume a fine twin STANDS, scoped by
text to the hoe ladder alone and recorded as a clarification beside R17 (11j-D-F). The thin ladders the sweep exposes (logging's 6
endgame bills are the known one) are topped up here and not later, because a bill added
after Phase 15 forces a re-measurement of R5. Depends on 11f through 11i, since the pass
can only certify a ladder those phases have finished building.

## Phase 11k: The provisioning capstone and prestige

Goal: the gathering half gets a capstone that is a role rather than a stat.

Closes the arc with the capstone objects and the prestige that names their maker. THIS PHASE
MINTS THE THREE APEX FEASTS at cooking 125, one per shipped role plate, on three new
templateIds drawn with the shipped `farm_feast` prop and reached through ONE exported
membership helper in `src/sim/professions/feast.ts` (11h-GATE-E moved them here, and
11k-D-K1 is why: 11k owns every keyed site a placeable feast touches). They serve the role
plates through the `feast.dishItemId` indirection farming already ships, so a feast re-tunes
when its dish re-tunes and mints no buff of its own, and they inherit the shipped
`harvest_feast` numbers, charges 10 and durationTicks 3600, unchanged (11k-D-K5). The
rare-or-better craft-signing path that already ships carries the provisioner's name onto what
the raid eats, and deeds and titles record the conquerable parts of it, all cosmetic and never
power per `docs/design/deeds.md`; no Reliquary page, because a consumable feast is not
conquerable unique loot (11k-VERDICT), and no storefront achievement row for any deed this
packet adds (11k-D-K3). It mints the cross-packet deed `prog_field_to_feast`, which only a
player who farmed the produce and cooked the feast can earn, and it states R18 in
player-visible copy, so the anti-compulsion position is something a player can read rather
than a rule only the docs know. One thing is CUT rather than carried: the crafter's signature
is not propagated onto a feast a stranger places, and the prestige claim narrows to what is
true, that the signature is on the item instance and the placer's name is on the entity
(11k-CUT). Depends on 11h for the apex reagent lines the feast bills draw from, on 11i for
the high-band catch those bills take, and on 11j for the certified ladder underneath them. It is the last
content phase before Phase 12, so it also carries the single reconciliation pass over
every id the seven phases minted: art parked in `ITEM_ART_PENDING` against the merged
pending allowlist, M16 fills, `world_entity_i18n` rows, deeds and Reliquary records, one
`npm run wiki:content`, and the recomputed economy invariant.

## Phase 12: The Perfecting stage

Goal: the bound, fail-forward, above-raid upgrade (R1/R2/R5).

Deliverables:
- New sim module `src/sim/professions/perfecting.ts` behind `SimContext` (masterwork.ts
  untouched): eligibility (apex piece, crafter skill 125 in the making craft, wearer
  supplies materials), per-attempt consume (1 Maker's Ember + Sundered Essence + 1
  Prismglass Setting), a rank track to Perfected (counts DERIVED against the qr-12-CADENCE
  criterion, state.md row 129: first piece Perfected in 4 to 6 weeks for the reference
  one-ember-per-week character, both cap slots in 10 to 12, a masterwork head start worth
  about one week; the derivation and counts recorded in `state.md`),
  fail-forward only, binds the piece on the first attempt (Maker's Bond `boundTo` reuse),
  bonus stats via `rolled.stats` at the R5 delta, masterwork-proc head start hook.
- `IWorld` facet members for the flow (read state + command), both hosts, wire fields,
  persistence in `ItemInstancePayload` (server-side sanitize like `sanitizeRiftGearInstance`).
- Rng discipline: draws via `ctx.rng` at a documented position; parity scenario in
  `tests/parity`.
- Tests: attempt lifecycle, binding, fail-forward (piece never harmed), rank math, budget
  delta exactness, save/load round-trip.

QA focus: server authority (client never resolves an attempt), draw-order golden, JSONB
back-compat, the cap still counts a Perfected piece (phase 01 interlock).

Farming arm: Perfecting writes new `ItemInstancePayload` fields into the same
`characters.state` JSONB that farming already writes `farmPlots` into, so the
`database-performance-reviewer` trigger changes from "only if a SQL call site changed" to
"the blob grew", and this phase owes a merged size bound measured against farming's own
numbers (empty character 1499 B compressed / 2059 B raw, 23 beds planted 3261 / 7831,
about 251 B raw per plot, TOAST past 2 KB, WAL plus 1.5 to 3 KB per 30 s autosave). Add
the reverse-compat direction neither packet covered: what an older server does with a blob
carrying both writers, which is exactly the shape a revert of this PR produces on a live
realm. The item-lock premise re-points at farming's shared `countRawInSlots` export from
`src/sim/item_lock.ts` rather than the helper shapes this packet's phase file names. This
is the first phase to add sim lines after the merge, so it inherits 11d's `sim.ts` ceiling
re-derivation discipline, and its QA gains a determinism arm: the farming draw-count
contract still holds and `farming_session` did not move.

## Phase 13: Orange promotion

Goal: the legendary capstone as process and prestige (R3).

Deliverables:
- Final Perfecting rank consumes a "Deed of Making" (inscription skill 125 recipe, also
  authored here) and promotes the INSTANCE to legendary presentation: rolled quality
  override, unique player-chosen name via the codex flow (validated, profanity-filtered
  server-side), crafter signature retained, sub-cap enforcement (phase 01).
- Celebration: zone broadcast + personal event + Discord activity card (masterwork event
  family parity), deed records (append-only `DEEDS` entries + `deedStats` sites; zero
  Renown for anything luck-gated per `docs/design/deeds.md`).
- Naming UX: the name renders in tooltips in both hosts; i18n-safe (player-authored text
  handled like other player text surfaces, never through `t()`).

QA focus: unique-equipped interplay (legendary instance under the existing
quality-derived rule AND the Masterwrought sub-cap); moderation surface for names;
append-only deeds pins.

Farming arm: this phase's new deeds append after farming's block under the ordering rule
above, against the pins 11d already moved. Player-authored text now has a second shipped
pattern to reconcile: this phase mints a player-chosen item name rendered outside `t()`,
while farming already ships "{name}'s Harvest Feast" as a `t()` key with the name as a
value, so state which is canonical rather than minting a third and cover both in the
`privacy-security-review` arm. The celebration family is shared now, so the zone broadcast
plus personal event plus Discord card must not double-announce alongside farming's
`golden_harvest` beat, and serialize-once discipline applies to a broadcast set that grew.

## Phase 14: Crafting UX beauty pass

Goal: the system feels wonderful (maintainer directive; DESIGN.md governs).

Deliverables:
- Crafting window: apex recipes surfaced with pattern-source hints, reagent availability,
  cast/batch integration; the Perfecting flow gets its own window/panel (progress track,
  materials, bind warning, celebration moment) as a view-core + painter pair per
  `src/ui/CLAUDE.md`.
- Cap visibility: character panel + tooltip indicators for Masterwrought slots in use.
- Commission quality signaling: crafter masterwork/Perfecting record surfaced in the
  commission flow, plus a minimum-fee floor (the two fields the research showed ARE the
  feature); undo paths verified (enchant replace flow, no-downgrade guarantees stated in
  ui copy).
- SFX cues for Perfecting attempt/success/orange (sfx pipeline conformance), mobile
  layouts + touch targets, screenshots per `pr-screenshots`.

QA focus: hud_perf_budget buckets for any per-frame painter; write elision; i18n sinks
classified; mobile safe areas; DESIGN.md rollout-phase compliance.

Farming arm (the heaviest amendment in the packet): this phase stops being "dress the
Perfecting flow" and becomes "make one professions interface out of two independently
designed families", because farming's entire doc set contains ZERO references to
`DESIGN.md` and the Harvest Journal, the plant sheet, the bed verbs, the feast tooltip,
and `farm_event_feedback` were built and QA'd without the standard ever being cited. The module-placement call is
SETTLED (ip-14-UI, 2026-08-20): MINT AND MIGRATE. Create `src/ui/hud/professions/` with an
`index.ts` barrel and a local `CLAUDE.md` and move the whole family behind it,
masterwrought's roughly 20 root-level professions modules plus farming's five, as its OWN
commit of pure moves plus import re-points and zero logic change. The repo rule is explicit
that HUD-domain components live in `src/ui/hud/<domain>/` behind a barrel, and about 25
root-level modules is the shape that rule exists to prevent; keeping them at root and
recording a deviation would document the violation rather than fix it. REJECTED: keeping the
panel at root with a recorded deviation. The migration does NOT count toward the `hud.ts`
payback target, because a file move relocates zero lines out of `hud.ts`. Unify one token
set, one window chrome and empty-state, one denial-line pattern (`farm_event_feedback`
versus `craft_denial_line_view`), one timer presentation (farming's growth countdown and
the Perfecting rank track are the same visual problem solved twice), and one placement-verb
copy pattern; reuse farming's a11y patterns (single-select rows as a radiogroup,
`aria-busy` on in-flight sends, `aria-live` on flip-to-ready) rather than reinventing
them, join the mobile body-class family farming fixed, and re-cut the consumable tray,
which already truncated at 6 with 6 kinds competing before farming added four dishes, a
feast, and the tonic. This phase also pays back the `hud.ts` ceiling raise taken in 11d by
extraction, and the target is a number rather than a direction (11d-U6-PAYBACK):
masterwrought's 19445 AT MINIMUM. Phase 14's acceptance does not pass until
`tests/monolith_budget.test.ts`'s `hud.ts` row reads 19445 or lower and the ceiling is
LOWERED in the same change; the professions-module migration above is excluded from that
count. Its QA states `DESIGN.md` compliance for the farming windows with evidence, since
they have no prior statement at all.

## Phase 15: Power verification (ultracode audit)

Goal: prove R5 before anything merges beyond this point.

Deliverables:
- The measured before/after pass per `docs/design/spell-balance-framework.md`: a
  full-kit character (2 Perfected pieces, apex enchants, flask, and the best available
  food always on, delivered by feast) vs
  pre-packet raid BiS, against heroic raid and S-rift tuning targets; results recorded in
  `power-verification.md` with the 5 percent envelope verdict.
- Adversarial audit workflow: stat-shape review of every apex item (scarce-stat and
  stat-light-slot rules), rating pin completeness, exclusivity pin completeness,
  budget-sweep completeness (no apex item missing from the sweep).
- Any breach fixed by tuning numbers DOWN in this phase (never by widening the envelope).
- The gray-grind record (qr-GRAY, state.md row 128): print, per craft, the crafts-to-cap
  count for the cheapest below-band spam path beside the intended band-matched path, as a
  recorded measurement only; no gain-curve change lands in this packet, and the revisit
  lives in brainstorm.md's future-tier block.
- Premise check (qr-11o-WEAR, row 118): Phase 11o re-leveled the rung-50/75 crafted rares
  before this phase runs, so the level-20 shelf this phase measures against must be shown
  UNMOVED by that change (re-derive the shelf, do not assume it).

QA focus: the envelope math is reproducible from the doc alone; every claim has a pinned
test or a recorded measurement.

Farming arm (settled at ip-15-KIT; the re-authoring happens BEFORE this phase runs, not
inside it): two of this phase's premises are falsified by the merge and are re-authored
before it runs. The "food" term in R5's kit doubles and must name the specific aura and
magnitude, and the feast premise dropped by ruling (4) of the Phase 10 QA is UN-dropped,
because `harvest_feast` and 11k's three apex feasts are real feast buff sources:
deviation (e) is re-recorded with a new outcome, both live edits are reverted, and R5's
kit definition becomes "the best available food, always on, delivered by feast", which is
strictly stronger than what the phase was written to measure. It owes a new
aura-exclusivity pin spanning `well_fed` and `elixir_<kind>` that also asserts
`wellfed_<kind>` exists nowhere after 11c: that assertion is the pin that PROVES the
unification landed rather than leaving a dead second namespace behind, and 11c is its natural
home since 11c is what makes it true (NEW WORK N14).
The 11c ladder is SETTLED at 11c-D-2 (farming 2/3/4/5 at 600 s, the three apex role plates
at 6/900), and on that ladder this phase's arithmetic is unchanged from what it was authored
against (flask 15 plus food 6 equals 21 sta). If the merged tree lands anything else, that is
a code-versus-ruling mismatch and this phase trips its own stopping rule: it re-opens 11c-D-2
in the record rather than silently re-tuning a settled magnitude. The measurement models the
GEARED INDIVIDUAL at full food uptime, never the raid aggregate (ip-15-ACCESS), which is what
"always on, delivered by feast" already means.

## Phase 16: Polish and content surfaces (ultracode sweep)

Goal: everything around the system shines.

Deliverables:
- Orange visual identity: render-side treatment (glow/particle via a
  `src/render/<thing>.ts` module, graphics-settings-fairness compliant: cosmetic only).
- Icons for every new item (icon-system rows); guide/wiki content + `guide.*` prose keys
  + `npm run wiki:content`; admin dashboard market metrics for cores/patterns/essence
  (admin i18n included); M16 non-Latin fills for wordy English keys.
- Before/after screenshots (desktop + mobile) committed under `docs/screenshots` for the
  PR body.
- The gate-model paragraph in `docs/design/professions.md` (qr-GATE-DOC, state.md row 133):
  document that crafting deliberately has NO skillReq admission gate and that bands gate
  teaching, skill gain, and the masterwork ceiling, citing crafting.ts, with any packet
  R-number written "masterwrought R<n>" in full.

QA focus: guide freshness gate; asset budget; admin surfaces localized; fairness tests.

Farming arm: cite farming's shipped evidence rather than redoing it (its wiki page and
`guide.*` prose, the full-journey screenshot set desktop and mobile, the D17 IP-safe
naming audit, `docs/design/farming-asset-manifest.json`, and the graphics-fairness row
that timers and ready notices are actionable and never shed). Newly owed: ONE wiki regen
on the merged tree, because neither branch's committed regen is valid post-merge and the
freshness gate binds merged content; cross-profession guide coherence, now VERIFY rather
than author, because 11c writes the merged overview sentence ("five gathering trades ... and
a ring of ten crafts", plus "all four gathering professions" to five) with its five
non-Latin overlays in the same fill batch as its Laden Hearth reword (11b-R3c-2), so this
phase's job is to confirm no shipped string still says four gathering professions; and one
merged pass over the naming registry, where the "Well Fed" generic-with-caveat row is
AMENDED rather than re-judged, because the 11c unification leaves ONE Well Fed (one aura id,
one mechanic, one ladder) and retires the caveat's second clause with the date and the
reason (state-OPEN-WELLFED).
THE ICON DOCTRINE IS SETTLED (ip-16-ICON): PARK. Masterwrought's items park against the
merged table and the merged pending allowlist exactly like farming's 44. This packet ships no
committed WebP art; every new id carries a pending row with exactly one `mapping.json` owner,
and the art wave is a maintainer-scheduled follow-up after the packet. Say it explicitly in
the Phase 16 record. The merged `tests/item_icons.test.ts` keeps farming's art-subject split
shape with re-derived literals (11b-PARK-1), so the pending set has a positive pinned size
rather than masterwrought's asserted-empty 0.
THE FOUR SURFACES no research lane covered are also settled, as four written verdicts rather
than deferrals (ip-16-SURFACES):
- STOREFRONT ACHIEVEMENTS: CUT, in ONE packet-level record covering every deed this packet
  adds (the 13 absorbed farming deeds plus 11e-D-E's roster deed, 11i-DEED's rod-craft deed
  and `prog_field_to_feast`). No `ACHIEVEMENT_MAP` row in `server/steam/` or `server/epic/`;
  `tests/epic_achievement_map.test.ts` stays pinned at 84 against the soft cap of 100;
  `privacy-security-review` is not triggered. The launch set is curated rather than a catalog
  mirror, and the exhaustive coverage arm is scoped to `col_reliquary_*`, so an unmapped deed
  goes green silently and only this written record catches it.
- DISCORD ACTIVITY FEED: ADD, capped at TWO cards. Add the farming member to `bot/logic.ts`'s
  closed kind union with cards for the two signals the packet already emits, the Harvestmaster
  title and `golden_harvest`. No third card and no per-placement noise. This is new work in a
  directory no phase touches today: the union member, two card renderers, the bot's own tests,
  and an entry in `bot/CLAUDE.md` (NEW WORK N10).
- THE RL HOST: CUT, explicitly, with the reason recorded in `headless/CLAUDE.md`: farming
  growth resolves against `ctx.lockoutNowMs()`, so any episode that plants is non-replayable,
  which is structurally outside the env's determinism contract. The five wire commands and the
  eight-member facet stay out with it, because half an action space that can never complete a
  harvest is worse than none. Re-admission needs a virtual clock and is a separate program
  (NEW WORK N11).
- ADMIN MARKET METRICS: WIDEN to cover produce, seeds and compost. If the widening genuinely
  does not fit this phase's budget, state the scope in the dashboard copy through `t()`
  (operators are users, so the copy is a `t()` key), and record which was done. Shipping
  metrics for half a professions economy is worse than shipping none (NEW WORK N12).

## Phase 17: Final integration QA and PR

Goal: close the packet, one green PR.

Deliverables:
- The whole-feature matrix in `qa-checklist.md` executed (three-host parity, determinism,
  i18n completeness, persistence, performance, classic fidelity, copy review).
- Final release-branch sync + `release-merge-audit`; full `npm run gate` (release-tier
  since content will merge to a release branch) green; `/qa` fan-out with all findings
  applied.
- PR body per `.github/PULL_REQUEST_TEMPLATE.md` with screenshots. PACKET TEARDOWN IS CUT
  FROM THIS PR (ip-17-TEARDOWN) and recorded as a post-merge chore with its shape fixed now,
  so nothing is left implicit: when taken, `docs/prd/masterwrought/` and
  `docs/prd/masterwrought/farming/` go as ONE decision over both trees, the eleven screenshot
  cone rows are re-homed in the same change, and `docs/design/farming-asset-manifest.json` is
  deliberately preserved. The packet docs are the review evidence for a seventeen-phase PR,
  and deleting them in the same PR removes the reviewer's map at the exact moment it is needed.
- WHAT DOES LAND IN THE PACKET, unconditionally, because live tests cite them by path:
  promote `naming-audit.md` and `power-verification.md` to `docs/design/` and re-point every
  citation (`tests/originality_renames.test.ts`, `tests/ip_scrub.test.ts`), and re-home the
  cone rows `tests/ci_workflow.test.ts` guards. A deletion is visible to the sparse-cone guard
  where a move is not, so this is owed regardless of the teardown decision (NEW WORK N13).
- Push and PR only when the maintainer says so (ip-17-PUSH; standing rule: new branches stay
  local until okayed, no merge without approval). This is the ONE item in the whole packet a
  session cannot answer, and not because the design is unresolved: the packet is COMPLETE when
  Phase 17 closes and `node scripts/gate_select.mjs` passes on the committed tree, and the push
  is a one-word input that does not exist yet.

Farming arm: this phase executes the UNION of both `qa-checklist.md` matrices, not
masterwrought's alone, which today has no farming rows. Farming's matrix contributes
sections this packet lacks entirely (the anti-chore audit: two visits per cycle, nothing
rots, absence never punished, risk opt-in, honest timers; offline-degradation parity;
server authority for plant, harvest, knob, and feast), plus three rows neither packet has
today: well-fed unification pinned, every monolith ceiling both packets touched re-derived
once on the merged tree, and 11d's export and symbol census re-run as a delivery gate.
Release-tier i18n is a combined and materially larger pass (masterwrought's 60 Latin
pending rows plus its Phase 11 reword obligations plus farming's deferred rows plus the
second v0.39.0 deed-locale fill of 15 manifest rows), run by the maintainer through the
`i18n-locale-fill` skill and never hand-filled, so it is a real scheduled line item and
not a checkbox. The teardown offer covers `docs/prd/masterwrought/` and
`docs/prd/masterwrought/farming/` as ONE decision with the eleven screenshot cone rows
re-homed in the same change and `docs/design/farming-asset-manifest.json` deliberately
preserved, and the PR body references R1-R23 (the gathering half is R17 to R20, the player-pain block R21 to R23), farming's
D1-D24 and deviations (a) through (ca), two screenshot subtrees, and one R5 verdict
covering both consumable systems.

ANSWERED (ip-GATE-17, 2026-08-20), and recorded in `decisions-index.md` and the packet record
before the closing matrix runs: YES, farming's "accepted-by-design" handoff rows already
constitute an explicit record and therefore satisfy the delivery contract's CUT requirement.
This phase closes the 51 maintainer-gated rows and NOT the 44 accepted ones;
`phase-17-final-qa.md` records the ruling and pins the acceptance. The contract's requirement
is that nothing be implicit, and a dated row saying "accepted by design, here is why" is the
most explicit form a record takes; re-closing 44 already-recorded decisions would nearly
double the closing phase to produce a second copy of an existing record. Same ruling as
11b-D-3's second half.
