# Phase 11c: Food and feast reconciliation

### Starter Prompt
```
This is Phase 11c of the Masterwrought feature: the one genuine design collision in the
farming absorb, resolved in code.

Both packets independently shipped a Well Fed food buff. Both mint it in the SAME
`if (c.remaining <= 0)` block of src/sim/combat/auras.ts updateRegen, with byte-identical
ctx.applyAura calls, the same payload shape, the same 'Well Fed' display string, and the
same zero-rng and transient-across-save claims. They disagree on six things: the aura id,
the def field and where it lives, the module the mint lives in, the clear-versus-grant
order, the tooltip view, and the power ladder. Phase 11b merged them into one tree that
compiles. This phase makes them one SYSTEM.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: not needed for this phase.

Goal: one field, one module, one mint order, one aura id, one tooltip view, one five-rung
ladder whose apex strictly dominates every farming rung on BOTH axes, and two feasts that
stop sharing a word by accident. The endgame consumable kit stays at flask 15 plus food 6
equals 21 stamina, exactly the number R5 was measured against, so Phase 15 needs no
re-measurement.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean, and 11b COMMITTED with `npx tsc --noEmit` clean and
  tests/architecture.test.ts green. This phase never starts on a half-resolved merge.
- SYNC RELEASE: git fetch origin --prune, discover the newest origin/release/** by version
  sort, merge it in, run the release-merge-audit skill on the merge.
- Memory scan: the test-pin trap index (READ it before authoring or judging any pin;
  constant-self-comparison and "prove the tests RAN" both bite here), the i18n
  reword-staleness and locale-overlay entries, and the parity-golden gotchas.
- DECISION 2 IS SETTLED (2026-08-20, the full delegation) and is recorded in the dated
  delegated-rulings block at the end of docs/prd/masterwrought/state.md. Copy it into this
  phase's ledger row as answered and EXECUTE it. Do not ask for it and do not re-open it.

DECISION 2, SETTLED 2026-08-20 (the well-fed unification and the power ladder; integration
plan section 5). EXECUTE the unification with the re-tuned ladder, all six axes: one aura id
'well_fed'; masterwrought's FoodItemDef.wellFed field typed TimedStatBuffPayload;
masterwrought's clear-then-grant mint order; farming's src/sim/wellfed.ts module and
farming's tooltip view; the ladder re-tuned to farming 2/3/4/5 at 600s with the three apex
role foods at 6/900. Everything below in this file is written against exactly that answer.

WHY: the merge as shipped is a power INVERSION, measured. Farming's
evergarden_braised_greens pays buff_sta 12 for 900s from a cooking-50 trainer recipe while
the cooking-100 drop-taught stonepot_stew pays 6 for 600s, and a trainer dish beating a raid
plate on both axes breaks R5 before Phase 15 can measure anything. The re-tune makes the
apex strictly dominant on stat AND duration, the endgame kit stays at 21 stamina so R5's
measurement survives untouched, and the single 'well_fed' id restores the classic
one-food-buff rule that farming's per-kind wellfed_<kind> namespace quietly abandoned.
Farming loses nothing observable today (all four dishes are buff_sta, so they were already
mutually exclusive) and gains masterwrought's painted well_fed icon over the generic
fallback. The four numbers being re-tuned are already marked "VALUES ARE PROPOSED AND
FLAGGED FOR THE MAINTAINER" in src/sim/content/profession_items.ts: they were authored to be
tuned.

REJECTED, recorded so neither is re-proposed:
- CUTTING farming's four wellFed payloads to leave plain foodHp dishes. It pays four real
  costs to avoid re-tuning four literals: it deletes a shipped, QA'd farming deliverable
  rather than reconciling it; it strips the well-fed consumer off every crop rung, which is
  the stated reason those four dishes exist; it guts D16's showcase, because the Harvest
  Feast pays its buff by pointing at evergarden_braised_greens and would then pay a restore
  only; and it strands farming's wiki effect prose keys plus their five non-Latin fills.
  This is a refusal, not a fallback: it is not available to this phase.
- LIFTING the apex to 8 or more to sit above farming's shipped numbers. It breaks the R5 kit
  arithmetic (flask 15 plus food 6 equals 21 stamina) that Phase 15 is built to measure,
  forces a full re-measurement through docs/design/spell-balance-framework.md, and lets a
  trainer-taught dish tie the apex at rung 3.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs or coordinator monoliths in
the main loop):
- docs/prd/masterwrought/state.md (R5, the Power placement numbers, the phase 10 apex
  consumable ledger); progress.md (the Phase 11c row); farming/state.md (D15, D16, deviation
  (bx), and the OPEN handoff row "Well-fed ladder magnitudes: capstone at the elixir
  ceiling, 24-stam stacking, twins stat-identity, tier-1 inversion", which the settled
  decision 2 closes); decisions-index.md (minted in 11b: R is masterwrought, D is farming, (x) is a
  farming deviation, never renumber, amend in place).
- Sim: src/sim/types.ts (TimedStatBuffPayload, FoodItemDef and its doc comment, Consuming,
  and whatever 11b did with farming's feast? field), src/sim/combat/auras.ts updateRegen,
  src/sim/wellfed.ts, src/sim/items.ts useItem's food/drink arm,
  src/sim/professions/feast.ts consumeFeastAction, src/sim/combat/aura_stacking.ts
  auraReplacementConflicts, src/sim/content/profession_items.ts (the three apex role foods,
  the four farm buff dishes, harvest_feast), src/sim/content/items.ts laden_hearth,
  src/sim/professions/mobile_station.ts and stations.ts plus STATION_TYPE_BY_CRAFT in
  src/sim/content/professions.ts.
- UI: src/ui/elixir_tooltip_view.ts, wellfed_tooltip_view.ts, wellfed_stat_keys.ts,
  feast_tooltip_view.ts, icons.ts (the AURA_RECIPES map), sim_i18n.ts (the AURA_NAME_KEY row
  for 'Well Fed'), i18n.catalog/items.ts, i18n.catalog/guide.ts (the cooking route body),
  hud.ts ONLY at its well-fed import and call lines, src/guide/pages/professions_craft.ts,
  scripts/wiki/build_content.mjs (its def read and the effect payload type).
- Tests: wellfed, flask_consumables, masterwrought_budget, aura_icons, aura_icon_view,
  wellfed_tooltip_view, feast_tooltip_view, crafted_item_tooltip_coverage, party_frames,
  party_frames_painter, professions_feast, mobile_station_party, farm_recipes, and
  tests/parity/scenarios.ts (the farming_session beats labelled wellfed-eating,
  wellfed-dish-minted, feast-placed, feast-bitten, feast-wellfed-minted, feast-expired).
Return: every site that reads or writes a well-fed payload after the merge; every site that
constructs a Consuming; which key pair each tooltip view calls; and whether 11b left ONE or
TWO well-fed lines wired into the hud item tooltip.

STEP 2 - EXECUTE (parallel fan-out, explicitly):

Agent 1 (one field, one module, one id, one mint order):
- ONE FIELD. masterwrought's FoodItemDef.wellFed survives. Farming's BaseItemDef.wellfed is
  DELETED, and with it the runtime `if (consumed.kind !== 'food') return;` guard in
  src/sim/wellfed.ts, which becomes unrepresentable once the field is kind-scoped (types
  beat guards; FoodItemDef's own doc comment states that this is exactly why it exists).
  Rename every surviving reader to `wellFed`: feast.ts, feast_tooltip_view.ts (it reads
  items[feast.dishItemId]?.wellfed DIRECTLY, a third site beyond the two obvious views),
  wellfed_tooltip_view.ts, and scripts/wiki/build_content.mjs (the generator's def read,
  never the generated file).
- ONE MODULE. farming's src/sim/wellfed.ts survives; masterwrought's inline block in
  auras.ts is deleted (module-first beats an inline block in a hot coordinator both sides
  edited). Change the signature to take the CARRIED payload instead of re-reading the
  catalog:
    export const WELL_FED_AURA_ID = 'well_fed';
    export function applyWellFedOnMealComplete(
      ctx: SimContext, p: Entity, wellFed: TimedStatBuffPayload | undefined,
    ): void
  The ITEMS import and the kind guard both disappear. REWRITE the NAMESPACE header: it
  currently documents the wellfed_<kind> rule being retired, and a stale load-bearing
  comment is worse than none. The new header states the single-id rule, why it is the
  stronger one, and that elixir coexistence still holds for free because 'well_fed' never
  equals 'elixir_<kind>'.
- ONE MINT ORDER, masterwrought's clear-then-grant, in updateRegen:
    const wellFed = c.wellFed;
    p[slot] = null;
    applyWellFedOnMealComplete(ctx, p, wellFed);
  Keep its reason comment: the meal is over from every reader's point of view when applyAura
  runs, which stays correct if anything ever consults isConsuming on the apply path.
- ONE AURA ID, 'well_fed', kind-agnostic, no <kind> suffix. Replacement rides
  auraReplacementConflicts, which keys purely on aura.id plus sourceId, and Well Fed is
  self-sourced, so no group registration and no new mechanism is needed. Do NOT convert
  src/ui/icons.ts to a computed key: AURA_RECIPES is a literal-keyed
  Record<string, IconRecipe> feeding AURA_RECIPE_IDS and the prewarm list, and one computed
  row among hundreds of literals buys what a pin already gives.
- TESTS. Rewrite tests/wellfed.test.ts against the unified rule. The "food-kind guard" case
  DIES (unrepresentable) and the "content rule: every wellfed carrier is kind food" case
  becomes a type-level fact; both are replaced by a FoodItemDef narrowing pin. The
  elixir-isolation describe keeps passing but its rationale text is wrong: rewrite it to say
  the ids cannot collide by construction. TWO NEW EXCLUSIVITY CASES ARE OWED: the three role
  foods are mutually exclusive with each other (stew, then skewers, then chowder: exactly one
  well_fed aura, the newest kind), and a farming dish and a role food are mutually exclusive
  IN BOTH ORDERS. One identity pin asserts WELL_FED_AURA_ID equals the hard-coded 'well_fed'
  and that hasAuraRecipe(WELL_FED_AURA_ID) is true; every other site references the constant
  rather than re-typing the string, which is what keeps that pin from being a
  constant-self-comparison.
- THE AURA-EXCLUSIVITY PIN, owed here because this phase is what makes it TRUE, and nobody
  else owns it. Author one pin spanning 'well_fed' and 'elixir_<kind>': they coexist by
  construction (the ids can never collide), the food family is one-at-a-time, and
  `wellfed_<kind>` exists NOWHERE in src/, scripts/ or tests/ after this phase. Phase 15
  reads this pin as the proof the unification actually landed rather than leaving a dead
  second namespace behind.

Agent 2 (THE CARRIED PAYLOAD; this phase's highest-value guard, and it does not get folded
into another slice):
- The defect, stated exactly. consumeFeastAction builds
  `p.eating = { itemId, kind, hpPer2s, manaPer2s, remaining, ticksElapsed }` (line 298 on
  the farming tip; it moves in the merge) with NO wellFed field, because farming's mint
  re-read ITEMS at completion. Adopt the carried-payload design without touching it and the
  feast SILENTLY loses its buff: the bite still restores health, the meal still completes,
  the entity still despawns, the ledger still marks the eater, and nobody is ever Well Fed.
  It fails no existing test on either branch. This is the live proof of the merge's top risk
  (a tree that is green because it is self-consistent, not because it is correct), and it is
  the one instance found by hand in one file.
- THE FIX, SETTLED 2026-08-20: kill the defect CLASS. The `wellFed: dish.wellFed` copy is
  mandatory either way and is NOT the deliverable. EXTRACT a host-agnostic
  src/sim/consuming.ts exporting a builder that turns a food or drink def into the Consuming
  record (itemId, kind, hpPer2s and manaPer2s off CONSUME_TICKS, remaining off
  CONSUME_DURATION, ticksElapsed 0, and the wellFed carry), and route BOTH real writers
  through it: src/sim/items.ts useItem's food/drink arm and src/sim/professions/feast.ts's
  bite. ACCEPTANCE: no writer outside the builder constructs a Consuming, and a Vitest
  imports the builder directly. WHY: the bite's own comment says it is "the items.ts
  food-arm construction verbatim", so this is a defect CLASS (two hand-built copies of one
  shape) rather than one missing line, and the repo's module-first rule answers it: the
  builder is a pure function needing no coordinator state, which makes it a sibling module
  by the deciding question. REJECTED: the bare field copy on its own, because a third writer
  can forget the field again.
- NEW WORK THIS RULING CREATES, and no other phase owns it: src/sim/consuming.ts needs its
  position considered against tests/monolith_budget.test.ts in the same change (a new sim
  module either sits outside MONOLITHS or is priced there deliberately, never by accident),
  and the Vitest that imports the builder directly is authored HERE, not left to a
  coordinator-level test.
- THE TWO DELIBERATE NON-WRITERS. src/sim/sim.ts builds two synthetic zero-rate meals for
  dev scenarios ('dev_cascade_freeze', 'dev_sandbox_freeze') purely to trip the natural-regen
  freeze. They have no item def, must never mint a buff, and do NOT go through the builder.
  Name both in the ledger so a later reader does not "fix" them.
- THE PIN. tests/professions_feast.test.ts (or a sibling) gains a case asserting a feast bite
  and a BAGGED dish of the same id mint an IDENTICAL aura: id, kind, value, duration, name,
  school, sourceId, asserted as a whole record and not merely as presence. Drive it through
  the real tick path (place, bite, ride the 18s drain), because the defect lives in what the
  bite WRITES, not in what the mint reads.
- THE WIRE, verified so nobody re-audits it: the Consuming payload never leaves the server.
  server/game.ts ships `eat: p.eating ? { remaining } : null` and src/net/online.ts mirrors
  exactly that, so the rename has ZERO wire surface and neither tests/snapshots.test.ts nor
  tests/bandwidth.test.ts has a stake in it.

Agent 3 (one ladder, and the budget pins that hold it):
- Re-tune the four farming dish rows in src/sim/content/profession_items.ts. foodHp and
  sellValue are untouched; only the payload moves, and every duration becomes 600:
    eastbrook_glazed_carrots   buff_sta 3 / 600  ->  2 / 600
    fenbridge_rice_pudding     buff_sta 6 / 900  ->  3 / 600
    highwatch_barley_porridge  buff_sta 9 / 900  ->  4 / 600
    evergarden_braised_greens  buff_sta 12 / 900 ->  5 / 600
  Move all three apex role foods to 6 / 900 (stonepot_stew buff_sta, warspice_skewers
  buff_ap, sageleaf_chowder buff_int). Values stay 6; only the duration literal moves.
- The derivation, so no number here is magic. The apex VALUE 6 is unchanged and is still
  elixir_of_the_boar's value, the consumable family's own entry rung, which is what
  masterwrought's ladder comment claims and what R5 measured. The apex DURATION is the entry
  rung's duration plus the elixir ladder's own duration step, read live:
  venomfire_elixir.duration minus elixir_of_the_boar.duration is 300, and 600 plus 300 is
  900. The farming rungs step one point per crop tier and top out at 5, one below the apex,
  at the entry duration of 600. Result: the apex strictly dominates every farming rung on
  BOTH axes, and the kit stays at flask 15 plus food 6 equals 21 stamina.
- THE ONE THING A REVIEWER WILL CHALLENGE, answered here so it is a decided position and not
  an oversight: this row RAISES a crafted duration, 600 to 900, on the three apex plates, and
  masterwrought R23 says a floor is created "by lowering the vendor line, never by raising the
  crafted line, so R5's ceiling stays where it was measured". The two do not collide, for two
  reasons, and both go in the ledger. FIRST, R5's ceiling does not move: the MAGNITUDE stays 6,
  and ip-15-KIT sets Phase 15's premise to "the best available food, ALWAYS ON, delivered by
  feast", so an always-on measurement is indifferent to 600 versus 900. SECOND, R23 governs the
  vendor-versus-crafted MARGIN, and no vendor item grants Well Fed at all: the catalog's one
  vendor-sold buff is elixir_of_the_bear, which 11n-BOTH pulls from Alchemist Verane's counter,
  and the vendor food line carries foodHp only. This change is ladder ORDERING inside the
  crafted line, not floor creation, and it is not a licence for any later phase to raise a
  crafted magnitude. Farming's flagged
  24-stamina stacking read drops to 17 (dish 5 plus elixir 12), and its flagged tier-1
  inversion (a 90-hp common dish carrying 3 stamina) resolves at 2.
- Rewrite both ladder header comments. Farming's states the retired distinct-namespace rule
  and the "at or below the elixir budget ceiling" calibration that produced the inversion;
  masterwrought's claims Well Fed "enters at the consumable family's own entry rung" without
  qualification, and now the VALUE does while the duration takes the ladder's next step. Both
  become one five-rung story: four levelling and pre-raid rungs, then the apex plate, one
  aura id, last eaten wins.
- tests/masterwrought_budget.test.ts, the case "the role foods clear the shipped food ceiling,
  and Well Fed enters at the elixir entry rung", is RE-AUTHORED, not patched. The
  shippedCeiling arm stays green untouched: the derivation excludes only APEX_FOOD_IDS and
  farming's top dish is foodHp 980, exactly the existing ceiling, so it is still 980 and every
  apex plate still clears it at 1392. The entry-VALUE assertion stays. The entry-DURATION
  assertion is replaced by the derived form (entry duration plus the ladder's duration step,
  computed live, with 900 as the twin literal the file's own idiom already uses). A NEW arm is
  owed: the apex strictly dominates every non-apex well-fed food on both axes, swept over the
  LIVE catalog rather than a hand-listed set, so a fifth dish authored later reds here the day
  it ships. Check that the wellFedOf helper's kind narrowing still resolves after the field
  deletion.
- tests/aura_icons.test.ts needs no rewrite and gains coverage for free: its distinctness
  sweep already maps over every ITEMS def's wellFed.kind, so it starts traversing farming's
  four dishes automatically and its "at least three stat kinds" floor still holds.
  tests/farm_recipes.test.ts carries the dish magnitudes; re-derive rather than paste.
- WIKI CONSEQUENCE, free and worth stating: farming's generator emits an effect block for any
  def carrying the payload and masterwrought's emits none, so after the rename that arm covers
  masterwrought's three apex role foods too and the merged wiki gains three Well Fed effect
  cells at zero cost. The prose keys it needs (guide.profPages.effectWellFed and
  effectWellFedAura) already exist and are already filled in all five non-Latin overlays, so
  no new key and no new fill is owed. The regen itself is 11d's.

Agent 4 (one tooltip view, one key pair, one feast vocabulary):
- ONE VIEW. farming's src/ui/wellfed_tooltip_view.ts plus its pure leaf
  src/ui/wellfed_stat_keys.ts survive; masterwrought's wellFedTooltipLines inside
  elixir_tooltip_view.ts is DELETED. The leaf exists because the guide bundle consumes it and
  cannot reach the sim_i18n import graph under the spoiler-containment pin, so folding
  farming's view into the elixir module would re-break that, and masterwrought had put a
  mechanic its own types.ts comment says is deliberately NOT an elixir inside the elixir's
  module. Rename farming's export to wellFedTooltipLines for one spelling.
- EXACTLY ONE LINE PER TOOLTIP. A real hazard, not a tidy-up: masterwrought wires its view
  into the hud item tooltip and farming wires its own, at different import and call lines,
  under different names, so tsc is silent if 11b kept both. The moment the field is unified,
  BOTH views read the same record and every buff dish renders the Well Fed sentence TWICE, in
  two wordings, from two different key pairs. Delete one import and one call, and PIN it:
  compose the real item tooltip for one farming dish and one apex role food and assert exactly
  one well-fed description line in each.
- ONE KEY PAIR, SETTLED 2026-08-20: MASTERWROUGHT'S PAIR SURVIVES,
  itemUi.tooltip.wellFed plus itemUi.tooltip.wellFedAura. DELETE farming's
  itemUi.tooltip.useWellfed and useWellfedAura plus their TEN overlay rows (two each in
  ja_JP, ko_KR, ru_RU, zh_CN and zh_TW) in the same change;
  translation_keys.generated.ts regenerates in 11d, never by hand. WHY: locale-fill coverage
  is a measured TIE (each pair carries exactly two overlay rows in each of the five non-Latin
  overlays and zero rows in every Latin overlay), so nothing is lost or gained on coverage
  and the tie-break goes to COPY. Masterwrought's English already states BOTH the completion
  trigger that docs/design/tooltip-writing.md requires AND the one-at-a-time rule, while
  farming's states the trigger only, and under the unified id there is exactly ONE aura, so
  the one-at-a-time rule is now a true statement about the whole food family and the tooltip
  has to say it. REJECTED: retiring masterwrought's pair (it would ship the weaker copy on
  the stronger rule).
  THE PLACEHOLDER HALF IS LOAD-BEARING AND IS NOT A HALF-SWAP. The surviving VALUE carries
  both facts, and the surviving VIEW supplies exactly THE SURVIVING KEY's placeholder set,
  read off src/ui/i18n.catalog/items.ts at authoring rather than assumed. The two pairs do
  not share one set: measured on the merged tree, masterwrought's wellFed takes
  {stat}, {value}, {minutes} and its wellFedAura takes {aura}, {minutes}, while farming's
  retired useWellfed takes {aura}, {value}, {stat}, {minutes}. So farming's VIEW, which
  survives under the ONE VIEW ruling, must be re-pointed to feed the surviving key's set and
  its aura argument routed to the aura fallback line, or the tooltip ships a placeholder
  hole. Re-read both key values in code before wiring; the memory entry on i18n placeholder
  host-token scanning is the trap here.
- DELIBERATE NON-ACTION, recorded so a reviewer does not re-raise it: elixir_tooltip_view.ts
  keeps its private ELIXIR_STAT_KEYS map even though it is byte-identical to WELLFED_STAT_KEYS.
  That is two copies, which the rule of three leaves alone, and the leaf is named for well-fed
  because of the guide's containment constraint; collapsing the elixir map into it would
  misname the module to save five lines.
- TWO FEASTS, BOTH KEPT. They share a word and nothing else. laden_hearth is kind 'tool',
  quality epic, cooking's skill-125 capstone and the grand_cauldron twin: using it is not
  consumption, it writes a MobileCraftingStation scalar onto PlayerMeta with partyShared true
  for MOBILE_CRAFTING_STATION_DURATION_TICKS, served inside STATION_RADIUS, with no world
  entity, no render seam and no wire object. harvest_feast is kind 'junk', quality rare, is
  CONSUMED, and spawns a real farm_feast entity with charges, a tick-domain expiry and a
  per-player eatenBy ledger. Merging them in either direction is refused: D16 already found
  that the mobile-station scalar cannot carry a shared world object, and absorbing the Hearth
  into the feast would delete a shipped skill-125 capstone to solve a vocabulary problem. A
  cook can place both at once and that is correct.
- THE VOCABULARY FIX, SETTLED 2026-08-20, is one merged reword of the cooking route body in
  src/ui/i18n.catalog/guide.ts, which both packets edited. Take masterwrought's body (it
  supersedes farming's now-false "past 75 no higher dish ships yet" clause with the apex
  kitchen paragraph) and write the Laden Hearth clause VERBATIM as: "a mobile field kitchen
  so dinner gets cooked at the dungeon door". Flag that row on the Phase 17 release-tier fill
  worklist BY KEY as a reword-staleness obligation, because the string is already filled in
  every locale. WHY: it is a one-word substitution that frees the word "feast" for the real
  placed-entity mechanic, and a reworded English value leaves every locale silently stale, so
  the flag is the deliverable and not a nicety. DOWNSTREAM DEPENDENCY, recorded here because
  it is invisible from the other end: 11h and 11k may use "feast" in names ONLY because of
  this reword, so if this edit slips, 11k's three apex feast names wait for it.
  REJECTED: keeping "the feast" in the Hearth sentence and disambiguating later in prose.
- THE PAIRING IS ALREADY TRUE, VERIFIED, AND FREE. recipe_harvest_feast carries
  stationType 'kitchens'; STATION_TYPE_BY_CRAFT maps cooking to kitchens; the Laden Hearth
  places a mobile station whose craftId is cooking; and crafting.ts satisfies a recipe's
  station gate from stationTypeForCraft(meta.mobileStation.craftId). So on the merged tree a
  cook already cooks the Harvest Feast at a placed Laden Hearth away from Eastbrook, and party
  members inside STATION_RADIUS do too. Zero content change. Say it in the guide prose, which
  already promises exactly that flavor, and PIN it: a cook holding a live Laden Hearth crafts
  recipe_harvest_feast away from any physical kitchen.
- THE FIVE-GATHERING SENTENCE, SETTLED 2026-08-20 and OWED TO THIS PHASE, in the same
  guide.ts edit and the same release-tier fill batch. 11b took ours under RULE 3c, so the
  shipped prose still says four gathering trades when the merged truth is five. Write it
  here: "five gathering trades ... and a ring of ten crafts" around guide.profPages, with
  the same edit moving the second paragraph's "all four gathering professions" to five, plus
  its five non-Latin overlays. WHY: this phase already owns a guide.ts plus five-overlay
  reword obligation, so the extra sentence costs nothing here and would cost Phase 16 a
  second pass over the same file. Phase 16's arm is now VERIFY (no shipped string says four
  gathering), never author. REJECTED: leaving it to whichever phase lands first.
- OWNERSHIP BOUNDARY, so two phases do not both skip it: farming's farm route prose still says
  the top of the dish ladder and the feast itself "comes within reach with a later patch's
  deeper fields". That becomes FALSE when 11e lands the tier 3 and 4 seed faucet. It is 11e's
  to correct. Do not touch it here; record the carry.

INVARIANTS IN PLAY: one aura id and one mint site for Well Fed, kind-agnostic; the mint draws
ZERO rng and the payload rides no wire; sim purity (no DOM, Three or ui import under
src/sim/); every player-visible string is a t() key in the matching catalog domain and any
retired key's overlay rows die in the SAME change; the S3 rule holds (sim and server stay
language-agnostic, emits keep their matcher rows); content ids are append-only and NOTHING
here adds, removes or renames an item id; generated artifacts are never hand-edited (i18n
bundles, translation_keys.generated.ts, src/guide/content.generated.ts and every parity golden
belong to 11d); the monolith ratchet applies to hud.ts here only as a REDUCTION, one import
and one call deleted, never added.

Out of scope: the merge itself and the ItemDef union port including where farming's feast?
field lands (11b); every generated artifact, count pin, golden re-record and ceiling decision
(11d); the tier 3 and 4 seed faucet, the apex Harvest Feasts and any bill edit (11e); the R5
envelope measurement (15); the professions interface family and the consumable tray (14); the
merged wiki regen and the cross-profession guide coherence pass (16), MINUS the gathering
count sentence, which this phase writes under the 2026-08-20 ruling and Phase 16 only
verifies.

NAMED REDS THIS PHASE HANDS TO 11d (listed and expected; never "fixed" by regenerating early,
because running a generator before this phase is final means running it twice):
- tests/guide.test.ts freshness, because the dish effect prose and the cooking route body both
  moved. 11d owns `npm run wiki:content`.
- The resolved i18n bundles and translation_keys.generated.ts, because one tooltip key pair is
  retired. 11d owns `npm run i18n:gen`.
- tests/parity/golden/farming_session.json. Hand 11d the PREDICTED composition so the
  re-record is checked instead of pasted. The scenario eats evergarden_braised_greens and then
  bites a harvest_feast pointing at the same dish, so in the wellfed-dish-minted and
  feast-wellfed-minted frames the readable aura row moves exactly this much: id
  wellfed_buff_sta to well_fed, value 12 to 5, duration 900 to 600, remaining down by exactly
  300 from its recorded value, name "Well Fed" and school "nature" unchanged. draws stays 110
  and drawDigest stays byte-identical, because the mint draws no rng. And the load-bearing
  one: the aura row must still be PRESENT in the feast-wellfed-minted frame. If the re-record
  drops it, that is Agent 2's carry missing, not a re-record.

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
npx tsc --noEmit; npx vitest run tests/wellfed.test.ts tests/flask_consumables.test.ts
tests/masterwrought_budget.test.ts tests/aura_icons.test.ts tests/aura_icon_view.test.ts
tests/wellfed_tooltip_view.test.ts tests/feast_tooltip_view.test.ts
tests/crafted_item_tooltip_coverage.test.ts tests/party_frames.test.ts
tests/party_frames_painter.test.ts tests/professions_feast.test.ts tests/feast_online.test.ts
tests/farm_recipes.test.ts tests/recipe_economy.test.ts tests/mobile_station_party.test.ts
tests/item_instance_tooltip.test.ts tests/architecture.test.ts
tests/localization_fixes.test.ts; then the parity suite, expecting exactly the farming_session
movement predicted above and nothing else; then npm run ci:changed.
Three pins move and must be re-pointed rather than deleted. tests/flask_consumables.test.ts
patches ctx.applyAura and asserts the clear-then-grant order: the call still rides the ctx seam
inside src/sim/wellfed.ts so the patch survives, but its message names the old site and the
order claim must be re-pinned AT the new one or the case passes while proving nothing.
tests/aura_icon_view.test.ts INVERTS: it asserts today that the food buff resolves to the
generic aura_buff_sta, and under the unified id it resolves to masterwrought's painted well_fed
recipe, a player-visible improvement, so rewrite the case and its comment to assert the
identity recipe, never delete it. tests/party_frames.test.ts and
tests/party_frames_painter.test.ts each carry a wellfed_buff_sta or well_fed case: keep one, on
the unified id.
Review Dispatch Matrix (implementation-plan.md): architecture-reviewer (the sim mint, module
seam, determinism), cross-platform-sync (the field rename across sim, ui, the guide generator
and the matcher rows), frontend-seam-reviewer (tooltip views, icon resolution, guide copy),
content-obligations-reviewer (the content diff: dish rows, wiki regen debt, tooltip copy, i18n
keys), qa-checklist when the deliverable set is complete. Skip privacy-security-review,
migration-safety and database-performance-reviewer: no server, no persisted shape and no SQL
call site is touched, and Well Fed is transient across save by design. COVERAGE prompts; apply
ALL findings, blocking, should-fix and nits.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- refactor(sim): one Well Fed field, module, aura id, and mint order
- fix(sim): carry the Well Fed payload through the feast bite
- feat(content): the five-rung Well Fed ladder, apex dominant on both axes
- refactor(ui): one Well Fed tooltip view, one key pair, one feast vocabulary
- docs(i18n): five gathering trades in the professions overview prose
- test(sim): well-fed exclusivity, feast-versus-bag aura identity, and the ladder pins

STEP 5 - ACCEPTANCE:
- [ ] Decision 2 recorded in this phase's state.md ledger row as SETTLED (2026-08-20) and
      executed as written, with no gate in this file left reading confirm-at-STEP-0
- [ ] Exactly one well-fed field (FoodItemDef.wellFed), one module (src/sim/wellfed.ts), one
      exported WELL_FED_AURA_ID, one mint site, one aura id
- [ ] No `wellfed` identifier survives in src/, scripts/ or tests/, only in historical ledger
      prose
- [ ] src/sim/consuming.ts exists and BOTH real Consuming writers construct through it, with
      a Vitest importing the builder directly and its monolith-budget position considered;
      the two dev-scenario freezes deliberately do not go through it and are named in the
      ledger
- [ ] A feast bite and a bagged dish of the same id mint a byte-identical aura, pinned through
      the real tick path
- [ ] Two new exclusivity cases green: role food versus role food, and farming dish versus
      role food in both orders
- [ ] The aura-exclusivity pin spans 'well_fed' and 'elixir_<kind>' and asserts
      `wellfed_<kind>` exists NOWHERE in src/, scripts/ or tests/ after this phase
- [ ] Apex strictly dominates every non-apex well-fed food on magnitude AND duration, swept
      over the live catalog; kit stays flask 15 plus food 6 equals 21 stamina
- [ ] Exactly one well-fed line renders per item tooltip, pinned for a farming dish and a role
      food
- [ ] Masterwrought's itemUi.tooltip.wellFed plus wellFedAura survive; farming's useWellfed
      and useWellfedAura and all ten of their overlay rows are deleted in the same change;
      the surviving view supplies exactly the surviving keys' placeholder sets, read from
      the catalog, with no unfilled placeholder in either line
- [ ] The Laden Hearth cooks recipe_harvest_feast away from a physical kitchen, pinned; the
      cooking route body carries "a mobile field kitchen so dinner gets cooked at the
      dungeon door" verbatim, and the professions overview says FIVE gathering trades, both
      flagged by key on the release-tier reword worklist
- [ ] All listed suites green; ci:changed clean; the ONLY reds are the three NAMED reds handed
      to 11d, each listed by name in the phase report

STEP 6 - DOCS: progress.md Phase 11c row. state.md ledger: decision 2 as settled 2026-08-20, the
final ladder, the derivation for the apex 900, the WELL_FED_AURA_ID seam, the retired key pair
and why, the Consuming builder (or the plain field copy) plus the two dev non-writers, the
Laden Hearth pairing pin, and the exact predicted farming_session composition handed to 11d.
In docs/prd/masterwrought/farming/state.md: amend D15 IN PLACE with a dated banner (its timing
half and its food-path half stand; its wellfed_<kind> namespace half and its BaseItemDef field
half are superseded by decision 2; deviation (bx) is unaffected), and close the open handoff
row "Well-fed ladder magnitudes" with the ruling. Never renumber, never delete. Memory note if
anything surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, the three named
reds handed to 11d with their predicted movement, and the handoff line for Phase 11c QA.

STOPPING RULES: decision 2 is SETTLED (2026-08-20) and is never a stop; stop only if the
state.md delegated-rulings block is missing or disagrees with this file, because that means
two records exist and one is wrong. This phase still picks NO power number of its own: the
four farming magnitudes and the apex duration come from the ruling and its derivation, and
inventing a fifth voids R5 downstream. Stop if the merged tree carries a well-fed reader
nobody enumerated that cannot be
re-pointed without a design call; if deleting the second hud tooltip call would change what any
OTHER tooltip family renders; or if the parity suite moves anything beyond the predicted
farming_session frames, because a moved draw count or a moved digest in a scenario neither
packet touched is a determinism regression, not a re-record.
```

### 11b HANDOFF ADDENDUM (2026-08-20, appended by Phase 11b after its QA gate; two obligations the prompt above predates)

The 11b build handed this phase TWO obligations beyond the prompt above; both
sit as open ruling-owed rows in the merged handoff table
(docs/prd/masterwrought/farming/state.md, the appended masterwrought section)
and in the state.md Phase 11b BUILT ledger's carry list (items 4, 7, 14):

1. THE GUIDE SENTENCE, WITH A CONTRADICTION TO RESOLVE (ruling 11b-R3c-2,
   carry items 4 and 14). Write the merged professions-overview reword (the
   five-gathering sentence, the second paragraph's count, guide.profPages,
   the five non-Latin overlays). BUT: farming's guard in tests/guide.test.ts
   ("describes the gathering trades count-free") forbids ANY spelled
   gathering count while the ruling's wording spells "five"; the two cannot
   both stand. Either write the sentence count-free and AMEND the ruling's
   wording in place with a dated line, or spell five and amend the guard with
   the reasoning; RECORD the choice in the ledger, never a silent pick. This
   phase's red list from 11b already carries the guide.test.ts red as
   11c-owned.

2. THE INTERACTION-PRIORITY PIN (ruling 11b-R3c-1, carry item 7). The settled
   order is placed-transient-wins (station or feast above the farm bed); the
   merged tree still has farming's shipped bed-over-feast order, and
   masterwrought's stations take NO interact press at all today
   (proximity-activated via inRangeStationTypes). Reordering the
   tryNearbyInteraction arms and pinning BOTH directions in
   tests/nearby_interaction.test.ts is owned here per the ruling's carry
   clause (the feast arm is in this phase's surface already); if this phase
   judges the press-competition question moot until a station gains a press
   or 11k's apex feasts land, it may re-route the row to 11k, RECORDING the
   re-route in the handoff table rather than leaving the row orphaned.

TWO MORE ROWS, appended 2026-08-21 by the 11b QA audit (carry items 15, 16):

3. THE GUIDE-PAGE COMMENT SWEEP (carry item 15). The stale "the four
   gathering" code comment at src/guide/pages/professions.ts:7 sits outside
   ruling 11b-R3c-2's literal scope and cannot trip Phase 16's verify arm
   (a comment is not a shipped string); sweep it in the same reword pass.

4. THE FEAST-FLOURISH PREWARM TENSION (carry item 16, a recorded design
   call, not a bug fix). The farm-patch feast flourish arms on the FIRST
   sync pass even over an EMPTY entity map (deliberately pinned by
   tests/farm_patches_adapter.test.ts's unarmed-baseline arm), so a
   renderer prewarm pass that runs before the online mirror's first
   snapshot would consume the silent first pass and every standing feast
   would puff at once on the first live read. Closing it means choosing:
   wire age, snapshot-ready gating at the renderer call site, or
   accept-and-record (the module's own scope-reentry paragraph is the
   precedent). Owned by this phase's food/feast UI pass or Phase 14's UI
   beauty pass, whichever opens src/render/farm_patches.ts first.
