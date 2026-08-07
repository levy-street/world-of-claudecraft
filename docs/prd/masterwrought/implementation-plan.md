# Masterwrought: implementation plan

The endgame professions expansion: epic (apex) craftable gear near raid power for all ten
crafting professions, the global "Masterwrought (2)" equip cap, tradable pattern drops, the
raid-material economy (Wyrmfall Core, Sundered Essence, Maker's Ember), the Perfecting
stage that pushes a bound piece slightly over raid, and the orange promotion. Full vision
and research record: `brainstorm.md`. Locked rulings and numbers: `state.md`.

Delivery contract: everything ships in ONE branch (`feature/masterwrought`) and ONE PR.
Nothing is deferred to a future PR; an item is in this packet or cut.

## Canonical Team Workflow (every phase session follows this; phase files reference it)

Every phase runs as its own fresh session at xhigh effort; add `ultracode` for the
batch-heavy phases the table marks. Steps:

0. PRE-FLIGHT: WORKTREE GUARD first (the user runs multiple concurrent sessions): if pwd
   is not `~/Documents/wocc-masterwrought`, switch this session into it with the
   EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought), or stop and
   ask the user to relaunch there; phase work never runs from the main checkout. Then
   `git status` clean in `~/Documents/wocc-masterwrought`. Then SYNC THE
   RELEASE BRANCH (maintainer directive, every phase, no exceptions): `git fetch origin`,
   merge the NEWEST `origin/release/**` into `feature/masterwrought`, resolve, and run the
   `release-merge-audit` skill on the merge before any phase work. Scan memory
   (`MEMORY.md` index) for entries matching the phase domain.
1. LOAD CONTEXT via an Explore agent (never read planning docs or coordinator monoliths in
   the main loop): `state.md`, `progress.md`, this phase's file, and the phase's listed
   source files. The agent returns a focused summary.
2. EXECUTE with the lightest orchestration that fits (parallel Agent fan-out by vertical
   slice; `ultracode` Workflow for the marked batch phases). Request fan-out explicitly.
3. VALIDATE per the matrix in `state.md`, then spawn review agents per the Review Dispatch
   Matrix below (only rows the diff touches; prompt for COVERAGE, not filtering). No
   commit while any BLOCKING finding stands. Apply ALL findings: blocking, should-fix,
   and nits (maintainer standing rule).
4. COMMIT with explicit paths (never `git add -A`), Conventional Commits with scope and a
   body, no em dashes or emojis, no session trailers.
5. UPDATE `progress.md` + `state.md` (ledger sections) and memory, then end with the
   standard phase report and a one-line handoff for the QA session.

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

| Phase | Title | ultracode? | Surface |
|---|---|---|---|
| 01 | Masterwrought equip cap | no | sim, world_api, ui, net |
| 02 | Pattern items and recipe learning | no | sim, world_api, ui, net |
| 03 | IP naming sweep | yes (audit) | content, ui i18n, docs |
| 04 | Materials backbone | no | sim, content, server |
| 05 | Jewelcrafting base catalog | yes (content) | content, ui |
| 06 | Inscription base catalog | yes (content) | content, sim, ui |
| 07 | Intermediates and the Quickening Catalyst | yes (content) | content, sim |
| 08 | Apex armor catalogs | yes (content) | content, tests |
| 09 | Apex weapons, jewelry, gadgets | yes (content) | content, tests |
| 10 | Apex consumables and enchants | no | content, sim |
| 11 | Pattern drops and vendors | no | content, sim, server |
| 12 | The Perfecting stage | no | sim, world_api, net, server, db |
| 13 | Orange promotion | no | sim, world_api, ui, render |
| 14 | Crafting UX beauty pass | no | ui, game, styles |
| 15 | Power verification | yes (audit) | tests, docs |
| 16 | Polish and content surfaces | yes (sweep) | render, ui, guide, admin |
| 17 | Final integration QA and PR | no | everything |

Each phase 01 to 16 is followed by its own QA session (`phase-NN-qa.md`). Phase 17 is the
packet-closing QA and PR phase, and offers packet teardown before the PR.

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
  Forgefold Plating, Wyrmhide Cording, Sunspun Bolt, Prismstone Setting, Precision
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

## Phase 12: The Perfecting stage

Goal: the bound, fail-forward, above-raid upgrade (R1/R2/R5).

Deliverables:
- New sim module `src/sim/professions/perfecting.ts` behind `SimContext` (masterwork.ts
  untouched): eligibility (apex piece, crafter skill 125 in the making craft, wearer
  supplies materials), per-attempt consume (1 Maker's Ember + Sundered Essence + 1
  Prismstone Setting), a rank track to Perfected (counts recorded in `state.md`),
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

## Phase 15: Power verification (ultracode audit)

Goal: prove R5 before anything merges beyond this point.

Deliverables:
- The measured before/after pass per `docs/design/spell-balance-framework.md`: a
  full-kit character (2 Perfected pieces, apex enchants, flask, food, feast) vs
  pre-packet raid BiS, against heroic raid and S-rift tuning targets; results recorded in
  `power-verification.md` with the 5 percent envelope verdict.
- Adversarial audit workflow: stat-shape review of every apex item (scarce-stat and
  stat-light-slot rules), rating pin completeness, exclusivity pin completeness,
  budget-sweep completeness (no apex item missing from the sweep).
- Any breach fixed by tuning numbers DOWN in this phase (never by widening the envelope).

QA focus: the envelope math is reproducible from the doc alone; every claim has a pinned
test or a recorded measurement.

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

QA focus: guide freshness gate; asset budget; admin surfaces localized; fairness tests.

## Phase 17: Final integration QA and PR

Goal: close the packet, one green PR.

Deliverables:
- The whole-feature matrix in `qa-checklist.md` executed (three-host parity, determinism,
  i18n completeness, persistence, performance, classic fidelity, copy review).
- Final release-branch sync + `release-merge-audit`; full `npm run gate` (release-tier
  since content will merge to a release branch) green; `/qa` fan-out with all findings
  applied.
- PR body per `.github/PULL_REQUEST_TEMPLATE.md` with screenshots; packet teardown
  offered (delete `docs/prd/masterwrought/` on explicit confirmation only).
- Push and PR only when the maintainer says so (standing rule: new branches stay local
  until okayed; no merge without approval).
