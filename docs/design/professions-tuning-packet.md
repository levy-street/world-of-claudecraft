# Professions tuning packet

Status: all seven build phases landed, on one branch, gate green. Base:
`release/v0.32.0` (re-synced; the packet was planned against `release/v0.31.0`).
The packet is NOT finished: the whole-packet review produced the active
worklist, `professions-tuning-packet-review.md` (phases 8 to 18 plus the
rulings ledger), and this record is corrected as those phases land. The two
rulings this header once listed as open are settled there: the derived rod
training fees stand (R8), and purchase-versus-use tool gating closed as
advisory purchase gates with wield-time enforcement (R22, superseding R7's
use arm). The two phase 5 maintainer calls are owned by the worklist too:
the gather-tooltip grade preview by its phase 14 (UX) and the out-tooled
work-order economics by its phase 13 (content).

One packet, seven phases. This document is the agreed scope and the record of
what was measured, so the phases can be built and reviewed against it without
re-deriving anything.

Everything below was measured against the shipped source, not estimated. Where a
number is quoted it came from reading the code or simulating it.

## Why this packet exists

Professions shipped with a source problem, a progression problem, and a
readout problem, and they compound:

- The vendor sells bulk trade goods, so crafting mastery is a shopping trip.
  Full armorcrafting mastery is 150 crafts fed entirely by vendor purchases,
  against the target the record then stated as 10 to 20 focused hours
  (historical diagnosis; the target MOVED to the measured 2-to-5 band in
  the content pass, see the professions.md time-to-master block and the
  review worklist's R52).
- Gathering tools buy almost nothing you can feel, so there is no reason to
  chase one.
- Fishing has no failure state that can fire, and its catch table is chosen by
  zone alone with no skill or rod requirement.
- The character sheet prints proficiency in a way that reads as a level.

## Diagnosis: four premises that did not survive measurement

Recorded so they are not re-litigated.

**Vendor-sold gathered materials already violate a locked ruling.**
`docs/design/professions.md` states, under Locked rulings: "No gathered or
monster material ever gets a vendor buyValue." Five of the nine node yields
(`thorium_ore`, `ashwood_log`, `goldleaf_herb`, `elderwood_log`,
`sunpetal_herb`) are both node-gathered and vendor-stocked. The repo's own test
taxonomy in `tests/recipe_economy.test.ts` already sorts them into `NODE_YIELDS`
while keeping a separate `VENDOR_REAGENTS` list. So the delist is not a new
design direction, it is restoring a ruling the content drifted away from.

**No harvest has ever granted a level.** `gatherActionXp` in
`src/sim/professions/profession_xp.ts` pays `10 + 2 * nodeLevel` through a
green/gray falloff. Only three node levels ship, so the entire reachable range
is 3 to 53 XP per harvest, against 400 XP for the cheapest level in the game.
Gathering is roughly 10 percent of the whole 1-to-20 climb; the 85
non-repeatable quests are 109 percent of it on their own.

**Fishing grants zero character XP on every branch.** `completeFishing` in
`src/sim/professions/fishing.ts` never calls `ctx.grantXp`. There are exactly
five `grantXp` sites in the codebase (mob kill, quest turn-in, delve clear,
craft, harvest) and fishing is not one of them.

**The reported "every ore gives me a level" is a readout artifact,** with
three causes: the character sheet prints proficiency as a bare integer with no
denominator while it moves +1.00 per action for the first 25 harvests; deed
unlocks fire the same banner element, colour and lifetime as a real level-up,
and three or more of a new character's first five gathering actions trip a deed;
and level 1 to 2 genuinely is about 20 Eastbrook harvests, which are all
takeable back to back.

## Settled decisions

| # | Decision |
|---|---|
| D1 | Delist the vendor rows for the five gathered materials, in one move. **Keep `buyValue`** on the item defs. |
| D2 | Restate the ruling as "no NPC ever **stocks** a gathered or monster material". |
| D3 | Grant starter tools through `requiredItems` on all four gather quests. |
| D4 | Add a node placement validation test and fix the misplaced nodes. |
| D5 | Expand nodes for coverage, target 6 per type per zone. |
| D6 | Close the relog exploit by persisting node readiness. Respawn stays **per-player**. |
| D7 | Gate tool purchase on gathering proficiency, on the vendor row. AMENDED BY R22: the purchase gate becomes advisory and enforcement moves to wield time (the harvest gate); see the phase 7 closeout. |
| D8 | Better tools yield better materials: 9 new `fine_` variants. |
| D9 | Fishing difficulty is skill-versus-zone, not reaction time. |
| D10 | Wire the parked `TOOL_EFFECTS` system as the rare-tool hook. |
| D11 | Fishing keeps granting zero character XP, documented as deliberate. |
| D12 | No XP or proficiency gain constant changes anywhere in this packet. One authorized exception, R19 (the review worklist's rulings ledger): the fishing teaching ceiling composes a zone-tier gray-out onto the untouched `FISHING_GAIN_SCHEDULE`, extending this scope for that one mechanic with the maintainer's sign-off. Every gain a legal water grants is still the schedule's own number. |

### D1: why `buyValue` stays

Removing `buyValue` flips **28 recipes gold-positive** against the ECONOMY
INVARIANT in `tests/recipe_economy.test.ts`, because `reagentUnitValue` falls
back to `sellValue` and all five materials are priced at exactly 4x. Two
independent passes derived this and a third reproduced it from scratch. The
field stays as the economy basis; only the vendor rows go.

This is why D2 restates the ruling. "Never gets a `buyValue`" is not
implementable; "no NPC ever stocks it" is, and it is what the ruling means.

`arcanite_bar` keeps its rows (refined, no node). The five staples
(`smithing_flux`, `spool_of_thread`, `tanning_agent`, `cooking_salt`,
`glass_vial`) keep theirs (vendor-only by design, no node, no drop, no recipe).

Scope note (review ruling R15): D2 governs SHIPPED content. A custom map
document (an editor-only surface today) can put any item id on an NPC's
counter and sits outside the never-stocked guards by design; the R37 rollout
guard keeps shipped zones and maps inside the ruling.

### D6: why per-player, not shared

BUILT IN PHASE 9 of the review worklist, not by the original seven phases:
the pass-1 review found no phase had scheduled the persistence work while
this section promised it, and phase 3's 240 s respawn had doubled what a
relog erases. Landed as `src/sim/professions/node_persist.ts` plus the
optional `CharacterState.nodeHarvestCooldowns` field (zero-default
omission), with the load re-anchor in `addPlayer` filtered to live node
ids; `tests/professions_node_persist.test.ts` pins the round trip, the
freeze, and the retired-id drop.

`src/sim/cooldown_persist.ts` already solved this exact bug class for ability
cooldowns, and states the pattern: persist remaining-time deltas, not wall-clock
expiry, so timers freeze across a logout and resume on load. Node readiness is
the same shape. The freeze happens at the logout frame (the leave-time
`serializeCharacter`). A linkdead drop's immediate safety-flush save freezes
at drop time too, but the character stays in the world with timers counting
in live sim time, so the ~30 s autosave (it covers linkdead sessions, and
under load it stretches longer, never shorter) and
then the grace-expiry save each overwrite that snapshot with a smaller
remaining; a crash inside the grace window makes whichever save landed last
durable. For every timer running at a save, the freeze errs toward a longer
wait. The one corner outside that guarantee: a gather cast still in flight
at the drop resolves during grace, and a crash before the next save loses
its timer together with the harvest's yield and proficiency grant, a
value-neutral rollback of the whole harvest rather than a free reset that
keeps the loot.

The freeze is more player-visible on a 240 s node than on an ability
cooldown: a player who logs out mid-route and returns days later still owes
up to 240 s on every node they last worked, a wait staying online would have
run out. Accepted: it is the anti-exploit direction, and the only one
available in a clock-agnostic sim short of adding a wall-clock stamp to the
save.

Shared depletion was considered and rejected for this packet. It would reverse a
deliberate documented position (`src/sim/professions/gathering.ts` states the
per-viewer model exists so there is no gather rush or node camping), it degrades
with population worst in the starter zone, it makes gathering bots compete
directly with humans rather than costing them nothing, and the denial string a
losing player sees is the client-side `hudChrome.gathering.notReady`, which
says "for you" and is already filled in every locale.

Shared depletion scoped to tier 2 and tier 3 stays on the roadmap, gated on
telemetry, not in this packet.

### D9: why skill-versus-zone

Both reference games put fishing difficulty in skill versus spot, not in
reflexes. Classic-era fishing above a zone requirement fails constantly while
the reaction click stays generous; RuneScape has no reaction test at all and
rolls per-attempt success against level and tool.

The failure path already exists and is wired: `updateCasting` in
`src/sim/combat/casting_lifecycle.ts` emits `fishingGotAway` past the reel
deadline. It simply cannot fire at a 3.00 to 4.50 second window.

Expressing the skill-versus-zone failure as **empty-hook weight in the existing
table draw** costs zero new rng draws, so the pinned two-draw contract and the
parity goldens are untouched.

## The real bugs this packet closes

| Bug | Detail |
|---|---|
| Relog resets every node timer | `nodeHarvestReadyAt` was session-only and reset on every `addPlayer`. CLOSED by phase 9 of the review worklist (D6 below): readiness persists as remaining-time deltas and resumes on load |
| Level-1 Thornpeak fishing faucet | Catch table is keyed on zone alone, no level or rod requirement |
| Tier-3 rod is inert | Band 2 requires proficiency 200, which is fishing's cap, so tier-2 and tier-3 rods take an identical number of casts to cap |
| Misplaced nodes | Several sit below the waterline, including all three Eastbrook herb patches on a lake floor; one sits on a near-vertical slope. No test validates a node coordinate |
| Zone-1 tier-5 tool craft | A level-1 can craft a tier-5 pick without leaving Eastbrook, because the only toolworks station sits beside the NPC selling its reagents |
| First quest has no tool | A new character starts with zero copper; `q_prof_intro` says to swing a pick and nothing grants one |
| Vacuous economy guard | The fully-vendor-fed set in `tests/recipe_economy.test.ts` is derived from the vendor tables, so the delist would empty it and its loop would stop asserting silently |
| Stale deed comment | The comment above `prog_tools_of_the_trade` claims it depends on vendor stock; its trigger is `hubCraftsPerformed >= 1`, any station craft |

## Phases

Each phase is independently shippable and revertible, and gated with
`npm run gate`. No phase moved a golden for a DRAW-ORDER reason (the parity
section under "Test and invariant obligations" carries the full accounting):
the branch's golden movement is geometry (solid node bodies shifting mob
paths) plus one new golden, `professions_gather` was re-recorded twice along
the way (phase 2 relocations, then the phase 3 expansion), and phase 6 was
expected to re-record one and did not, for the reason recorded under it.

### Phase 0: readout and banner

No sim change, no wire, no parity. English catalog only.

- Character sheet gathering readout gets a denominator, matching the shape the
  professions window already uses. (`src/ui/char_window.ts`. Note the
  professions window is already correct: it renders a bounded value and a
  continuous fill, not a pip track.)
- Deed unlock banners get their own visual language, distinct from the level-up
  banner they currently share.
- Comment at `completeFishing` recording that zero character XP is deliberate.

### Phase 1: delist and quest tools

Data only. No sim logic, no wire, no parity.

- Remove the vendor rows stocking the five gathered materials.
- `requiredItems` on all four gather quests (`q_prof_intro`,
  `q_prof_attune_smith`, `q_prof_attune_bombardier`, `q_prof_hobby_switch`), so
  `questFallbackGrants` hands out the pick or sickle on accept and re-grants it
  if lost. Two of the four need a sickle, not a pick.
- `noVendorSell` on the three tier-1 starter tools, closing the repeatable-quest
  faucet (`q_prof_hobby_switch` is repeatable with a herb objective).
- Replace the derived fully-vendor-fed set with a counterfactual assertion plus a
  non-vacuity floor.
- Fix the stale `prog_tools_of_the_trade` comment.
- Telemetry counters: copper source, per-band harvest counts. The harvest
  bands were later re-keyed by ZONE (ruling R3): the label values on the
  harvest series changed from the material price bands to the zone ids, the
  old series stop moving at deploy, and any external dashboard or alert
  filtering the old band values must re-point in the same change (the
  exporter pre-seeds the zone series at zero from boot).

### Phase 2: placement validator and node fixes

- `tests/gather_node_placement.test.ts` over the sim-pure terrain API
  (`terrainHeight`, `groundHeight`, `terrainSteepness`, `isInWaterBody`,
  `waterLevelAt`, `nearSteepWalls`, `roadDistance` from `src/sim/world.ts`, plus
  the player movement constants from the pathfinding module).
- Arms: dry land with margin, walkable slope, no collider overlap, a reachable
  stand spot within interact range, reachability from the zone hub, zone
  containment (node yields are keyed by zone, so a mis-zoned node yields the
  wrong material), minimum spacing, and a per-zone coverage floor.
- One arm that is easy to miss: the renderer anchors node props at
  `terrainHeight`, while every other check uses `groundHeight`, which adds the
  Sowfield stand lift and dock plank surfaces. Assert the two agree, or a node
  authored on a dock renders sunk into the platform.
- Move the misplaced nodes to valid ground. No allowlist.

### Phase 3: node expansion

Content only. Still per-player timers.

- Target 6 nodes per type per zone, spread for coverage rather than thickened in
  place. Coverage floor of 40 percent of walkable ground within 40 yards,
  deliberately below the mob-camp figure.
- Keep at least one tier-1 node per type per zone, so a traveler with the
  quest-granted starter tool can still gather outside the first zone.
- Respawn moves to 240 seconds alongside 6 nodes per type. That holds
  EASTBROOK's harvests-per-hour ceiling flat (9 nodes at 120 s and 18 at
  240 s are both 270 per hour) and CUTS the two later zones by 25 percent
  (12 nodes at 120 s was 360; all three land on one 270 ceiling, which the
  placement suite pins as one number per zone). The expansion buys world
  density and a longer circuit, not faster farming. The planning premise
  "every zone circuit is shorter than the respawn, so a large fraction of a
  session is spent standing still" survived measurement only for Eastbrook;
  see the phase 3 closeout below.
- Replace the per-node circle loop in the quest-objective map painter with the
  enclosing-circle pattern already in that file, or the map carpets.

#### What phase 3 measured (closeout)

The circuit-idle premise was measured after the build (the full table lives
above the node table in `src/sim/content/gather_nodes.ts` and this is its
summary). Modelling a circuit as a nearest-neighbour tour at run speed plus
the cast ceiling, working all of a zone's nodes: Eastbrook went from a 69 s
circuit at 43 percent idle to 160 s at 33 percent; Mirefen from 109 s at 9
percent idle to 207 s at 14; Thornpeak from 113 s at 6 percent to 197 s at
18. So the starting zone, where the complaint came from, improves; the two
later zones get slightly worse, because their circuits were already nearly
respawn-length and the premise was only substantially true of Eastbrook. The
density half of the goal is real everywhere; the idle half is delivered only
in zone 1.

### Phase 4: the tool gate

Zero wire, zero parity. `vendorItems` is static content rebuilt client-side, and
gathering proficiency already rides an existing delta as an `IWorld` member in
both hosts.

- A `VendorRowGate` side table plus one pure resolver, mirroring the delve shop
  gate: evaluated authoritatively in the buy path and advisorily in the vendor
  view core, so the row renders locked with a requirement line rather than
  disappearing.
- Thresholds: tier 2 at gathering 40, tier 3 at gathering 70. **Not 75.**
  Tier-1 nodes stop teaching at exactly 75 and the first zone is all tier-1, so
  75 is a knife edge any future constant change would silently brick.
- Ship a derived-ceiling test that computes the tier-1 teaching ceiling from the
  live constants and asserts every gate sits below it, so a future change fails
  loudly instead.
- Prices 120 and 400. A solo player's entire first-zone quest income, summing
  every zone-1 `copperReward` that is neither repeatable nor group-suggested
  (`suggestedPlayers > 1` excludes the Hollow, the Sexton, and Mogger), is
  3,745 copper, so thousands for a tool would be a wall. This line used to
  quote "around 5,300", a figure that reproduces only if two group quests are
  counted as solo income.
- Zone stocking follows the "hub sells the tiers its own nodes use" rule the
  later zones already follow. Only the first zone over-stocks today.
- Owned tools are never confiscated when a gate arrives. Patch-note line.
  AMENDED BY R22 (LIVE since the review worklist's phase 13): tools stay in
  the bags, but land tools carry use requirements (the wield ladder 40/70
  and the crafted rungs at 85/100), so a pre-gate owner keeps the tool and
  reaches the threshold to wield it, and the purchase gates are advisory
  display. The patch note carries both halves.


Gating on zone alone does not work and is not attempted: there is no level gate,
no quest gate and no travel cost anywhere, the inter-zone ridge has a road pass,
and a ghost-run chain is safe because mobs skip dead entities.

### Phase 5: fine materials

Pure state change, zero new rng draws.

Five forks were settled while building it; recorded here so they are not
re-opened.

1. **Zone tier, not node tier.** The upgrade compares the tool against the
   MATERIAL's zone tier (Eastbrook 1, Mirefen 2, Thornpeak 3), with a second
   arm requiring the vein to carry that tier. Node tier alone would have made
   the tier-4 pick's reagent farmable off a Thornpeak tier-1 vein, and the
   vein arm is what keeps the deliberate lower-tier veins yielding the plain
   material. The tier column is derived from `GATHER_NODES` in the tests.
2. **Completion, not cast start.** The grade is read at the grant. Cast start
   would have needed transient cast state on `Entity` for a difference only a
   mid-cast tool change could see; losing the tool mid-cast costs the upgrade,
   never the harvest.
3. **The tier-4 pick is re-pointed, not exempted.** It consumes the Mirefen
   fine ore, gated on the tier-3 pick it already consumes, which is the shape
   the axe and sickle lines already had.
4. **The tier-5 pick keeps `arcanite_bar` and GAINS the Thornpeak fine
   grade.** Re-pointing off the bar would strand it and its vendor rows; it
   was also the one rung still buyable off a counter.
5. **Downward substitution, a fork the packet did not anticipate.** The fine
   grade replaces the plain yield, and Eastbrook is all tier-1 veins, so a
   tier-2 tool would have made `copper_ore`, `ironbark_log` and
   `silverleaf_herb` ungatherable, blocking two shipped repeatable work orders
   and roughly 19 tier-1 recipes. A fine grade now satisfies a requirement for
   its base (never the reverse) in the craft gate, the craft capacity
   simulation, the craft consumption, and quest collect credit and turn-in.

Two premises in the original scope did not survive contact and are corrected
here: the icons are NOT procedural (the compositor is unreachable for a
non-weapon item, so each grade ships committed original painted art plus provenance),
and eight of the nine names trip M16, so all nine carry non-Latin fills.

Open after review, deliberately not resolved in this phase:

- **The gather-node tooltip does not preview the grade.** A player standing at
  a vein cannot see whether their tool will upgrade it. Everything the check
  needs is already in the tooltip's view core, so it is one boolean plus one
  copy line, but it ADDS a player-facing readout rather than closing a gap in
  what shipped, and the discoverability complaint it answers is now covered
  from two other directions (the item tooltip hint says what a fine grade is
  and where it comes from, the guide tools note states the rule). The call
  landed: the review worklist's phase 14 (UX) builds the preview.
- **Five guide prose keys were reworded, which stales their translations in all
  20 locales with no gate able to see it:** `guide.profPages.toolsNote`,
  `guide.profPages.craftProse.engineering.materialsBody`,
  `guide.profPages.fish.startBody`, `guide.profPages.fish.biteBody` and
  `guide.profPages.fish.tablesNote`. The release fill CANNOT see them on its
  own (it reads pending rows only, and a reword never pends), so the review
  worklist's phase 17 deletes the stale overlay rows to re-pend the keys and
  refills the non-Latin locales; only `toolsNote` got that treatment in the
  packet itself. In every case the English had become factually
  wrong (the first two named retired reagents; the fishing three said any
  water works in every zone, quoted the pre-trim reel windows, and called the
  rare catch flat across bands), so leaving them was not an option.
- **Work-order economics get worse for an out-tooled player.** The three
  repeatable work orders pay a fixed copper reward derived from the BASE
  material's sell value, and a player who can only supply the fine grade hands
  over twice the vendor value for the same coin. They are never blocked (the
  grade substitutes), and base-first consumption spends any plain stock they
  hold first, but the trade is worse than it was. A tuning question, not a
  defect; owned by the review worklist's phase 13 (content).

- Nine `fine_` variants, one per zone and type. A tool one tier above the node
  yields the fine version.
- The six tool recipes are re-specced to consume them, so on the CRAFT path a
  better tool is the only way to the next tool up (phase 7's delve counter
  later added the Marks route beside it). Zero new recipes.
- Naming: `fine_` is a plain English quality adjective. It avoids the `pristine_`
  specimen family, avoids the rare-event flavor vocabulary
  (`pristine_vein` / `ancient_heartwood` / `moonlit_bloom`), and is not a
  distinctive coin of another property. Verify against `tests/ip_scrub.test.ts`
  and `tests/originality_renames.test.ts` before authoring.
- Nine committed original painted icons, each authored against its matching
  base material and peer material family. The fine grade is expressed inside
  the specimen through cleaner facets, selected grain or pristine foliage,
  without the former generic halo treatment.
  `tests/shipped_item_ids.test.ts` is append-only, so these ids are permanent
  once shipped.

### Phase 6: fishing

Planned as the only phase that moves a parity golden, on the assumption the
session cap would have to rise. It did not: see the closeout below.

- Per-zone minimum rod tier, checked beside the existing implement gate and
  denied through the existing text-free denial event. Pre-draw and rng-free.
- Empty-hook weight scales on proficiency versus the zone requirement.
  Planned here as roughly 8 to 12 percent at or above; SHIPPED as the 10/8/6
  surplus taper (at requirement, one band over, two bands over), around 35
  percent one tier under and around 55 two tiers under.
- Junk roughly doubles at low skill and thins as you climb. Every band row must
  still sum to 100 and stay monotone.
- Reel window 3.00 to 2.50 seconds. A light trim only: the difficulty lives in
  the skill-versus-zone axis, and a shorter window is a platform tax on mobile
  once tick quantization and network round trip are counted.
- Session cap must move with the bite delay. If max bite plus max window exceeds
  the cap, the session-complete arm fires first and silently eats a valid reel
  window, which is a fairness defect rather than a difficulty knob.
- Sunglint Koi gets a skill-scaled weight and a use as the tier-4 rod reagent.
  It is currently flat across every band and consumed by zero recipes.
- Tier-4 and tier-5 rods. Note the pre-training recipe list is frozen, so these
  route through trainer acquisition, and the tier-5 recipe must sit at a skill
  requirement inside engineering's cap.

#### What phase 6 settled, and what it left open

- **The parity golden did NOT move, and did not need to.** The premise above was
  that raising the session cap would re-record one trace. The cap held at 15
  seconds: with the reel window trimmed to 2.50 the worst legal session was 271
  ticks of a 300-tick cap as of this phase, even counting the cross-tier case
  (cast on the pole, pick up the tier-5 rod before the bite); phase 7's rarity
  rung later moved the worst case to 286, still inside the cap (its closeout
  below carries the arithmetic). So the cap became a GUARDED constant
  rather than a moved one, and `tests/fishing_zones.test.ts` budgets it in ticks
  against every shipped rod tier. No golden in `tests/parity/` changed.
  Related: a green parity run says nothing about fishing either way, because no
  scenario there ever drives a real cast. That gap is now written down in
  `tests/parity/CLAUDE.md` so the next reader does not mistake green for cover.
- **SETTLED (R8): the two rod training fees stand as derived.** `trainingFeeFor`
  is derived from the recipe's skill tier, so skillReq 75 bills 4 gold and
  skillReq 125 bills 16 gold. These are the first trainer-taught recipes in
  the game to reach either rung: everything else costs 0, 25 silver or 1 gold,
  and the six crafted LAND tools dodge the question entirely by predating
  training. The ruling keeps the curve exception-free: moving a fee means
  moving the fee curve or the skillReq, never a per-recipe exception.
- **Rod access is paced by the WATER, not by the counter.** Phase 4 deferred rod
  gating to this phase, and the answer is that no rod carries a vendor
  proficiency gate. The zone requirement decides where a rod matters and the
  empty-hook schedule decides what skill is worth there, so a purchase gate on
  top would be a third lock on one door. Fenbridge and Highwatch now stock the
  rung their own water asks for, so no zone demands tackle no local counter
  sells.
- **What the gate now sits in front of, beyond the Codfather:** the Mirefen and
  Thornpeak per-zone fishing deeds, the collection deed that needs both, and the
  cooking recipes fed by marsh and peak fish. All are paced rather than blocked
  (the rod is a counter purchase in the same zone), and the set is derived in
  `tests/fishing_zones.test.ts` rather than recited, so a new fishing deed joins
  it automatically.
- **A corpse harvest does not yield a fine grade, and now that is only
  implicit.** The grade table is keyed to the nine node materials
  (`professions/material_grades.ts`), and corpse yields resolve through
  `HARVEST_COMPONENT_ITEMS` instead, so the two paths never meet. That was
  obvious while the fine axis was the newest thing in the tree; after the
  release merge brought the corpse-harvest work alongside it, a reader can
  reasonably wonder whether the omission is a decision or a gap. It is a
  decision: a monster material has no zone tier to outclass, which is the whole
  input to the grade rule.
- **The rod icons are original paintings.** Stormreel and Tidewrought keep the
  shipped rod family's centered diagonal composition, but each has its own
  silhouette, reel, fittings and material language. They no longer inherit a
  recolored Silverstream silhouette.

### Phase 7: tool effects and rare tools

Its own phase because it is the only one that touches persistence and the wire.

- Wire Gatherer's Cache and Artisan's Eye. Park Springback Charm: a
  respawn-speed bonus points the endgame loop back at the starter zone.
- **Depletion must be deterministic.** `depleteEffect` currently draws
  `rng.chance`, which would be a third draw per harvest and break the pinned
  two-draw contract for any player owning a slot. Spend one charge per fire and
  fold the rarity intent into starting durability.
- Tool rarity grants narrow non-gating bonuses: a wider reel window on rods, and
  longer effect durability on land tools. An epic tool opens no node a common
  tool of the same tier cannot. This amends the shipped "rarity is cosmetic and
  value-only" comment, which must be updated in the same change.
- Tier-4 and tier-5 tools added to the delve shop behind clear counts, giving
  non-crafters a route to top tools. **Widen the "never vendor-sold" guard in
  `tests/professions_tools.test.ts` to cover the delve and heroic shops** and
  restate the claim as "never sold for copper", so it asserts what it means
  instead of passing on a technicality.
- Cost: a player meta field, an optional persisted field with a default, an
  `IWorld` member implemented in both hosts with the parity pin updated, a delta
  field with the snapshot pin updated, a slot command, and a HUD row.

#### What phase 7 settled, and what it left open

- **The slot is keyed per GATHERING PROFESSION, not per tool item.** The
  per-instance route was re-examined on the merged tree's facts rather than on
  the stale note that used to sit in `tools.ts` (`ItemInstancePayload` does now
  carry `charges`, is deep-cloned, and ships over the wire). It still loses, for
  a reason that has nothing to do with availability: the live harvest path
  resolves a tool TIER and never a tool, because
  `bestOwnedGatherToolTierOrNone` returns a number and its callers are the node
  gate, the corpse gate and fishing's band cap. Keying per item would mean
  widening all three to carry an item through, and a slot bought for a tier-4
  pick would go inert the moment its owner crafted the tier-5 one. The
  consequence is honored in the UI: a player owning two picks shares ONE mining
  slot, so the window shows one row per profession and never a list per item.
- **Rarity is a COARSENING of tier, not a second axis.** Every shipped gathering
  tool's rarity follows its tier, and tiers 1 and 2 are both common. For LAND
  tools that makes the charge bonus a genuine step function. For RODS it is
  perfectly collinear (2 common, 3 uncommon, 4 rare, 5 epic), so the reel-window
  bonus IS a tier bonus wearing rarity's coat. Both modules say so outright
  rather than leaving a reader to discover it, and the test that proves the reel
  term is real holds the TIER FIXED, since every shipped rod would also pass a
  tier-only implementation.
- **The reel-window rung was sized by the session cap, not by feel.** The cap is
  300 ticks and the worst legal session was 271, leaving 29. At 0.25 s per
  rarity rung the epic rod's three steps cost 15 ticks, landing the worst
  session at 286. 0.5 would not have fitted, and a mutation pass confirms the
  budget reddens at that value rather than silently letting the cap eat a legal
  reel window. Both former inline copies of the window formula in
  `tests/fishing_zones.test.ts` now call `fishReelWindowSecFor`; the budget one
  mattered, because adding the term to the function alone would have widened the
  live world while the budget kept measuring the old sum and stayed green.
- **The tools land on the delve counter, not the heroic quartermaster's.**
  `HEROIC_VENDOR_ITEMS` is a self-contained `ItemDef` registry that never reads
  `ITEMS`, so a tool row there means duplicating a def that already exists, and
  its stock is budget-enforced level-20 jewelry whose stated identity is being
  the only source of necks and rings. A `DelveShopEntry` resolves into `ITEMS`
  directly, and `delveShopGateUnlocked` is already shared by the authoritative
  buy and the client lock badge, so the new rows needed no new gate logic. They
  reuse the shop's existing top two price rungs rather than inventing one,
  because the Litany ladder is pinned as a straight 2x of the Reliquary's tiers.
- **The never-sold guard had a real hole, wider than the packet assumed.** Both
  guards swept `NPCS[*].vendorItems` alone. `NPCS.heroic_quartermaster` carries
  `vendorItems: undefined` and keeps its real stock in `HEROIC_VENDOR_STOCK`,
  and the delve counters keep theirs in `DELVE_SHOPS`, so BOTH tables were
  invisible and a crafted tool added to either would have passed untouched. The
  claim is now "never sold for COPPER", which is what ruling 5 says, and both
  guards sweep all three tables.
- **SETTLED (R22, superseding R7's use arm): purchase gates are ADVISORY and
  enforcement moves to the wield.** Land tools gain RuneScape-shaped use
  requirements (tier 2/3 at gathering 40/70; tiers 4/5 derived in-phase under
  the knife-edge rule), LIVE since the review worklist's phase 13; every counter,
  the delve rows included, sells ahead freely, and the harvest gate is what
  refuses an unearned tool, which also closes the traded-tool bypass. Rods
  stay exempt (the water gate plus the R19 teaching ceiling pace fishing),
  so the delve rows' clears gate remains their only lock, correctly.
- **OPEN at phase 7 close; RESOLVED by the review worklist's phase 12.** The
  acquisition craft shipped: the dev gate and its two-direction pin retired
  with it, slotting consumes a crafted charm through the same resolver, and
  `craftedBy` is written from the consumed charm's signer. The paragraphs
  below stand as the historical record of the scope call and the free-grant
  incident. **As recorded then: the effects have no acquisition path, and
  the wire command is
  DEV-GATED until they do.** `TOOL_EFFECTS` is catalog only (no item, no
  recipe, no `ItemUse` variant), so no player can obtain an effect and every
  HUD row is empty today. That was a deliberate scope call: the cost list above
  names the wiring and not a content source, and minting the three effects
  would open the first enchanting recipes in the game and brush the deferred
  work-order economics.

  The first draft of that claim was FALSE, and six reviewers caught it. Wiring
  `slot_tool_effect` into the server dispatch made the command itself the
  acquisition path: it consumed no item, no copper, no recipe, no station and
  no cooldown, re-sending it refilled the charges, and the bonus is live on the
  harvest path (+1 unit, or +1 to the grade tier that decides fine yields). One
  hand-built frame bought a permanent free bonus and made the entire
  `rechargeCost` / `rechargeEffect` economy unreachable by construction. The
  absence of a HUD button was never a gate.

  The dispatch case is therefore gated on `ALLOW_DEV_COMMANDS`, which is never
  set in production, and `tests/professions_tool_effect_slot_online.test.ts`
  pins BOTH directions so the gate cannot rot into a no-op. Remove it in the
  same change that ships the craft.

- **`prompt` mode is REAL as of the phase 14 confirm flow (R40).** The
  historical refusal (the resolver denied `prompt` while `resolveHarvest`
  passed `confirmed: true` unconditionally, and the HUD badge that
  advertised the mode was removed with it) is retired whole:
  `resolveSlotToolEffect` accepts the union, the harvest command carries the
  per-use consent (`confirmUse`, strict boolean-true, omitted on every
  unconfirmed harvest so the wire stays byte-identical), the cast-start
  capture threads it through both capacity pre-gates and the grant, and
  `applyToolEffectUse` gates the fire. The fail-safe arm is the doctrine: a
  stale bundle that never sends the flag gathers normally, spends nothing,
  and simply never fires its prompt slot.

- **`craftedBy` is left unset at slot time** (as of phase 7; phase 12's craft
  now writes it from the consumed charm's signer, a character name, which is
  restart-stable where the entity id below was not). Its documented meaning is whoever
  produced the effect through the production craft that made it, and no such
  craft exists. Recording the slotter instead would be a lie AND a permanent
  original-crafter recharge discount for every self-slotted effect, and it
  would persist an entity id, which restarts at 1 on every boot and therefore
  stops matching its owner and eventually matches whoever inherits it.

- **Rollback erases newer fields (the shared caveat).** `saveCharacterState`
  writes the whole `characters.state` blob rather than merging, and the load
  path normalizes what it does not recognize, so rolling back to an older
  binary erases anything only the newer binary writes, on the first autosave
  after the rollback. One caveat, several instances, kept together here so a
  rollback decision reads them as one class:
  - `toolEffectSlots`: a binary that predates the field erases the key, and
    this is REAL PLAYER-VALUE LOSS now. The acquisition craft shipped (the
    review worklist's phase 12): a slot costs a crafted charm whose reagents
    price above three hundred copper of arcane materials, plus any recharges
    paid into it, and the slot's `craftedBy` provenance (the original-crafter
    discount) is unrecoverable once erased because the consumed charm no
    longer exists. A rollback across the acquisition-craft boundary therefore
    needs the same restore-from-backup posture as a cap raise, and the
    RELEASE NOTES for the version that ships the craft must carry this
    caveat (the release-cut checklist in docs/design/professions.md lists
    it).
  - The clamp-on-load fields make a future V3 cap raise ROLLBACK-DESTRUCTIVE:
    `normalizeGatheringProficiency` and `normalizeCraftSkills` both clamp a
    loaded value DOWN to the binary's own `maxSkill`, so after a cap raise
    ships and players climb past the old caps, an old binary would clamp the
    raised values on load and persist the loss on its first save. The
    mechanical fix (preserve-over-cap on load, or a versioned clamp) rides
    the first cap raise; until then any rollback across a cap change needs a
    restore-from-backup plan for professions counters.
  - `nodeHarvestCooldowns` (D6): a binary that predates the field erases the
    key, which resets node respawn timers, so the relog exploit D6 closes
    reopens for the duration of the rollback window. No player value is
    lost; noted so the reopened exploit is a known trade, not a surprise.
  - `questedHobbies`: a binary that predates the field erases the key on the
    first autosave, so a make-amends return after the rollback falls back to
    the skill-default hobby instead of the one the player quested for. Small
    value at stake (the choice can be re-quested), listed because this class
    promises to be complete.
  - The inverse direction, recorded here for completeness because it is the
    one irreversible UPGRADE in the set: the `tierMailSent` prune. The first
    load by a pruning binary permanently drops non-major acknowledgements
    from the row (intended: they are what caused retroactive letters), and
    with no down-migration the only recovery is a database backup. A
    conscious one-way heal, not an accident.
- **`guide.profPages.toolsNote` was already stale in all 18 locale overlays, and
  nothing could see it.** The English gained a whole paragraph earlier in this
  packet (`523acb0dd`) and the overlays were not refilled, so every localized
  reader was getting two paragraphs where English has three, missing the
  fine-material axis entirely, plus the "rarity colour is cosmetic" line ruling
  4 falsifies. A reworded English value does not mark its translations stale, so
  the gate was blind to it. The 18 stale rows were REMOVED rather than left: the
  key now falls back to accurate English and re-enters the `pending` set, which
  the release-tier gate hard-fails on, so the release-time locale fill will
  catch it. Wrong text in a player's own language is worse than right text in
  English.

## Test and invariant obligations

- **Parity.** No phase changes rng draw order or count except phase 7, which is
  why depletion is deterministic. Phase 6 was expected to re-record one golden
  for the session cap and did not need to: the cap held.

  The claim here used to be "every golden is byte-identical", which is FALSE of
  the tree and would make the next reader misattribute the release's own churn
  to this packet. The verified numbers: the parkour physics engine (#2527,
  commit `5eb1410bd`) re-recorded **13** goldens, and it is an ancestor of this
  branch's merge base, so it is release-owned and nothing to do with us. **19**
  goldens moved across the whole v0.31.0 cycle for the same reason. The
  v0.32.0 merge brought a SECOND release-owned draw-order event beside it:
  #2514 changed the corpse-harvest draw COUNT (an unmapped family no longer
  burns a tier roll), which moves no golden only because nothing in the
  parity suite drives `harvestCorpse`. This branch
  touched **6** golden files: four combat traces re-recorded in `69a6c9a99`
  (the world gained a solid body at every ore and wood node, so mob pathing
  differs, which is geometry moving the stream rather than draw order changing),
  `professions_gather` re-recorded TWICE (the phase 2 relocations first, then
  the phase 3 expansion), and `professions_gather_fine`, which is a NEW golden
  this branch added.

  The honest statement is therefore: **no golden moved for a draw-order reason,
  and phase 7 moved none at all.** That last part is load-bearing and is why
  `PlayerMeta.toolEffectSlots` is left ABSENT rather than initialized to `{}`:
  an empty object still serializes into the parity state digest. A mutation
  pass confirmed it, initializing the field at construction reddens 62 parity
  tests including the goldens.

  Note also that the parity suite covers no fishing SESSION at all (see
  tests/parity/CLAUDE.md), so green there is not evidence about fishing.
- **The gathering two-draw contract** (2 per granted harvest, 0 on denial) is
  golden-pinned and must hold everywhere.
- **Fishing draws** stay at 2 per landed session, 1 on a miss.
- **`tests/recipe_economy.test.ts`** must not be left with a derived set that can
  empty. Add the non-vacuity floor in the same change as the delist.
- **i18n.** English-only per the PR-tier gate, with locale fills at release.
  Flag: a few new values are wordy enough to need non-Latin fills in the same
  change, and rewording an existing English value stales every locale for that
  key.
- **Screenshots.** Phases 0, 4, 6 and 7 are visual. Desktop and mobile.

## Recorded rulings

Settled with the maintainer during planning. Do not re-litigate.

1. The "gathering 100 in 8 to 12 hours" target means **while you play**, roughly
   23 to 34 harvests per hour picked up opportunistically, not dedicated
   farming. Dedicated farming would need a 3 to 4x harvest-count increase, whose
   only lever is a gain number, which the locked ruling forbids.
2. Character XP falls **inside** the locked "never via smaller gain numbers"
   ruling. No XP constant moves in this packet.
3. Fishing grants zero character XP by design, because it is the only uncapped
   gathering faucet. At equal per-action XP it would be several times the XP per
   hour of every other gathering profession.
4. Tool rarity may grant narrow bonuses that never affect access.
5. Crafted top-tier tools may be sold for delve marks, and the guard is widened
   to say so.
6. The delist lands in one move rather than staged behind telemetry, with the
   telemetry counters shipping alongside in the same phase.
7. Three review-blessed trades, recorded so nobody re-opens them as bugs,
   each with its own ruling: the koi's band-0 weight cut to 1 is deliberate
   skill-scaling, not a nerf to walk back (R4); the reel-window trim's
   roughly 17 percent cost to a tier-1 angler is the accepted price of mobile
   latency headroom (R18); and the Marks-to-copper conversion through
   delve-bought tools (vendor sell 60/150) is a blessed, bounded,
   loss-making conversion, because closing it would flag the shared item
   defs the crafted tools use too (R17).
8. Map-document scope (review ruling R15): D2 governs SHIPPED content. A
   custom map document (an editor-only surface today) can stock any item id
   and sits outside the never-stocked guards; the R37 rollout guard is what
   keeps shipped zones and maps inside the ruling.

## Deferred, with reasons

- **Shared node depletion.** Rejected for this packet, see D6. Revisit scoped to
  tier 2 and 3 only, gated on telemetry.
- **A gathering strike minigame.** The fine-material axis answers the same
  complaint with far less surface. The rejection is now PERMANENT by the
  review's vision ruling (skill identity is content-unique, never
  mechanics-unique), not merely deferred.
- **Raising the gathering skill cap.** The "nothing for a longer bar"
  deferral is RETIRED by the review's vision ruling: the cap rises with
  zones, and fine grades are that content. The rise itself ships with future
  zones, not with this packet.
- **Springback Charm.** See phase 7.
- **The quest XP curve.** The non-repeatable quests alone pay more than the whole
  level climb, which is the actual reason leveling is fast. Out of scope here.
