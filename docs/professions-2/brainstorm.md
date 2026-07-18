# Professions 2.0: brainstorm and vision

The approved design for completing the professions system, distilled from the
2026-07-16 maintainer brainstorm. This file is the WHY behind the packet; the
phase files are the HOW. Locked decisions also appear in `state.md` (the
cross-phase cheat sheet); when in doubt, `state.md` wins.

## Vision

A WoW-and-RuneScape hybrid professions system with an identity of its own:

> You become a Smith by smithing. The game notices, writes you a letter, and a
> named master in the world takes you on. Your work carries your mark, your
> masterworks get celebrated in chat, and the things you gather and cook and
> forge feed every other player in the game.

Fun for every audience: skillers get a visible ladder, milestones, and income;
questers get lore quests and guild letters; explorers get rare nodes and
far-flung stations; combat players get gear, consumables, and monster
harvesting that feeds it all.

## The five pillars

1. **Identity emerges from play.** Specialization is offered by the game in
   response to what you craft, never picked from a menu. Titles are earned.
2. **RNG on the way in, determinism on the way out.** Luck lives in gathering
   (rare fish, pristine veins, rare components). Crafting output is
   deterministic; a rare masterwork proc can only add, so no craft ever rolls
   badly.
3. **Stations are people.** Field recipes craft anywhere (the T window stays);
   everything uncommon and up happens at a named master NPC's station in the
   world, who also teaches recipes, sells supplies, and gives quests.
4. **Players trade with players.** Gatherers sell to crafters, crafters sell to
   everyone; NPCs only sink gold. Consumables are the economy's engine; raids
   keep the power summit.
5. **Nothing breaks.** The prime directive for every phase: existing items,
   deeds, quests, saves, and muscle memory keep working.

## Locked design decisions (maintainer rulings, 2026-07-16)

- **Pacing: fast early, slow top.** Common and uncommon tiers in hours, rare in
  days, epic and legendary gated by scarce adventure materials over weeks.
  Scarcity is the clock; there is still NO skillReq admission gate on known
  recipes (the documented no-gate rule stands).
- **Economy scale: about 100 concurrent players and growing.** Real
  player-to-player interdependence with graceful small-population fallbacks.
- **Gathering feel: ambient plus rare events.** Base harvesting stays one
  click; rare spawns and events add texture. No forced minigame per node.
- **Doc-vs-code forks resolve per the synthesis report recommendations**, most
  importantly:
  - Adopt the design doc's ring order in `CRAFT_RING` (the wave-one pairs force
    this geometry: alchemy must neighbor both cooking and engineering). Do it
    inside PR 2039's merge window, while zero players hold archetype state.
  - Combos REQUIRE the matching attunement (deny when `activeArchetype` is
    null); the pre-attunement rare-cap pass is retired.
  - Archetypes are pair-named identities (Smith, Outfitter, Apothecary,
    Bombardier), replacing single-craft practitioner titles.
  - Keep the no-admission-gate rule and the self-signed reagent-quantity bonus.
  - Jack of All Trades returns later (wave 2, issue #1296), not in this packet.
- **Wave-one crafts (six deep + toolmaker):** weaponcrafting + armorcrafting
  (Smith), tailoring + leatherworking (Outfitter), cooking + alchemy
  (Apothecary; alchemy + engineering also enables Bombardier), engineering as
  the toolmaker line. Jewelcrafting, inscription, and enchanting stay shallow
  on the wheel as future content beats (enchanting keeps its existing enchant
  line and becomes reachable in this packet).
- **Feeders:** mining, herbalism (live today), fishing (joins the gathering
  framework, keeping its minigame), and corpse harvesting (hide, silk, meat,
  components: the adventurer's feeder).
- **Masterwork replaces the five-way quality roll.** Every craft yields the
  deterministic, budgeted item. A proc (scaling with skill, signed
  materials, and specialization; amended 2026-07-17 from self-signed-only to
  any player's signature, see the addendum below) yields a masterwork:
  bounded bonus stats via
  the existing item-budget machinery, maker's mark, toast plus zone-chat
  celebration. Power ladder: baseline crafted < dungeon drops; masterwork
  rivals dungeon drops and stays below the raid floor; raids keep the summit.
- **Tools: base tools only.** Pick/axe/sickle/rod tier gating ships; the
  slotted-effect/charge/recharge layer stays parked (its tested pure modules
  remain dormant) and returns later reframed as enchanting content.
- **Identity costs: cheap to try, meaningful to keep.** First attunement free
  and celebrated; first switch cheap; repeat switching escalates (the existing
  5 + 3 per prior switch machinery). Requires per-archetype attunement history
  on `ArchetypeState` (the current state cannot express lore-vs-amends).
- **Deeds: basic and universal only.** First craft, first masterwork, first
  attunement, tier milestones, the rare fish. No archetype-exclusive deed
  trees. Cosmetic only, as always.
- **UX bar: the Book of Deeds.** The professions window and crafting-window
  upgrades follow the deeds window's quality and patterns, styled per the root
  DESIGN.md design language, fully responsive desktop and mobile.
- **Designer asset slots.** Placeholder art ships procedural (per the existing
  icon system); every needed image is cataloged in `asset-manifest.json` with
  purpose, usage, size, and format so designers can replace them later.

## Current state (from the 2026-07-16 six-agent audit)

Full detail lives in the audit and blueprint artifacts (maintainer has links);
the load-bearing facts:

- The sim already implements most hard mechanics, tested: the ten-craft ring
  with adjacency/opposite math, additive-only skill, the archetype ceiling
  (2 majors / hobby at rare / common floor), escalating make-amends, quality
  rolls, signed materials, the self-signed reagent bonus, specialization perks
  (material discount live), a complete tool layer, salvage, disenchant, enchant
  application, focus re-spec costs, battlefield experience (one hook).
- Almost none of it is player-reachable: 8 tested subsystems have no call
  path; no UI shows a craft skill number; the identity half was stubbed online
  until PR 2039 (in review at packet-creation time: cprof wire + shared combo
  eligibility; 5 should-fix review items posted).
- 21 recipes exist (9 common, 6 tool, 3 caster-hub, 3 combo), all auto-known;
  jewelcrafting and inscription have zero.
- Known bugs: trade strips `ItemInstancePayload` (silent data loss);
  `harvestClaimedBy` never mirrored online (corpse picker offers claimed
  corpses); two stale/weak test pins (tool no-op premise; the
  one-recipe-per-craft test that only asserts a count).
- Node harvests grant placeholder junk; the rarity roll rides an event nobody
  consumes; nodes carry no tier; monster-harvest rarity uses a fixed baseline.
- Corpse component rewards collide with quest items (a wolf hide advances a
  boar quest); unmapped tags consume the claim for nothing.
- The S3 localization scanner does not scan `src/sim/quests/quest_commands.ts`
  (new quest player text can ship unlocalized without failing gates).

## What we are NOT doing (this packet)

- Wave 2+: market/mail carriage for instanced goods (#1146), commissions and
  boundTo semantics (#1298), Jack of All Trades (#1296), monster-harvest
  proficiency, battlefield experience expansion, item biographies,
  tool effects, jewelcrafting/inscription depth. These stay filed on the
  epic. (Salvage UI left this list on 2026-07-17: its wiring joins Phase 13
  per the design-review amendments below.)
- Growing or shrinking the ten-craft wheel. Growth routes through gathering
  skills and off-wheel systems per the design doc's fragility rules.
- Any admission gate on known recipes, client-decided outcomes, or
  graphics-tier gameplay differences.

## Open items

- PR 2039 must merge (with its 5 should-fix items addressed) before or
  alongside Phase 1; the ring adoption lands inside that window.
- Exact masterwork bonus curve and economy tuning numbers are named targets
  with placeholder values in `state.md`, tuned in Phase 15 against live data.
- Cloth material sourcing: humanoid corpse components plus a plant fiber from
  herbalism (decided in brainstorm; exact item list lands in Phase 10).

## 2026-07-17 design-review amendments (approved)

After Phase 2 landed, the maintainer reviewed an external design review of
the packet (the Codex review) and approved a set of amendments. state.md
records them as binding rulings under "2026-07-17 design-review amendments";
each owning phase file carries the updated deliverables. In one line each:

- The masterwork signed-reagent proc term counts ANY player's signature
  (rewarding trade with gatherers, not vertical self-sufficiency); the
  self-signed reagent-quantity discount stays self-only.
- Recipe training is skill-tier gated at the masters, with locked rows
  always visible in the Train view: the RuneScape-style unlock ladder,
  delivered on the LEARNING side; known recipes are never use-gated.
- Masters spread across the three zone hubs (every archetype keeps a zone 1
  anchor; the tannery and apothecary root in Fenbridge and Highwatch),
  delivering the vision's far-flung-stations promise.
- The Phase 4 rare event ships per-node-type flavors (pristine vein,
  ancient heartwood, moonlit bloom); corpse harvesting gains the perfect
  specimen component in Phase 10, so every gathering family has a jackpot.
- Salvage wiring joins Phase 13, giving obsolete crafted gear a wave-one
  destination.
- Profession deeds carry titles and marquee-tier renown, so the deeds
  pipeline (nameplates, marquee broadcast, Renown board) celebrates
  professions; a Specialist deed marks the 75-skill threshold.
- Masters gain recurring pull: cadence-capped work-order quests and
  tier-crossing congratulation mail (Phase 14).
- Phase 6 resolves the masterwork broadcast audience (zone-visible via the
  Phase 4 soft-zone mechanism), extends the identity wire so masterworks
  are inspectable online, and adds tier-up toasts.
- End of Phase 7 is the vertical-slice checkpoint: the Phase 7 QA session
  plays the eight-step journey end to end before wave one begins.
