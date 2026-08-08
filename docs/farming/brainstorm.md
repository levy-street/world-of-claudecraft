# Farming: vision and research brief

## The vision

Farming is the fifth gathering profession and the game's first between-sessions
mechanic: plant at a shared garden patch in a hub, make every decision up front
(compost, farmer's watch, tonic), leave and play the game, and come back whenever you
like to a harvest that never rots. It serves the players who skill rather than quest
or raid, converts logins into progress, and gives the world stewardship: the only
skill where the world holds YOUR state. The fun contract: two visits per cycle, risk
only where the player chose thrift over insurance, yields that visibly climb with
skill, and a rare golden harvest the whole zone hears about.

## Research digest (2026-08-07, four commissioned reports; lessons baked into state.md)

- OSRS Farming (the model): wall-clock offline growth with NO spoilage is the line
  between a beloved check-in ritual and a chore. The farm run is overlay content
  layered on other play. Harvest-lives yield (guaranteed floor, skill-scaled save
  chance, rare highs). Compost and protection payments form an insurance market.
  Vanilla shipping no patch timers made a third-party timer stack de facto mandatory:
  ship the timer UI in-game (the Harvest Journal).
- RS3 Player-Owned Farm and the dailyscape purge (the warning): punishing absence
  (decay) plus best-in-slot rewards turns offline growth into a leash; Jagex nerfed
  POF within a month and later deleted nine daily systems. No daily resets anywhere in
  farming.
- WoW Sunsong Ranch (the warm precedent): a farm in a shared market town, plots grown
  as an earned reward, chore texture with personality, NPC friendship. WoD garrisons
  (the economy killer): removing travel, profession investment, and shared-world
  scarcity while keeping rewards shattered the materials market and emptied the world.
  Farming stays IN the hubs, on a travel circuit, feeding the shared market.
- Stardew Valley (the feel bible): the field is the progress UI (visible growth
  stages, wet soil, harvest pops); chores are bounded so they end before they sour;
  automation is earned and stops before full passivity.
- Wider MMO survey: solve land with abundance (shared patches, per-player state),
  never auctions or housing gates (ArcheAge land rushes, FFXIV housing lottery); bound
  output by patch count and cycle length, not daily budgets or punishment (FarmVille
  wither is the anti-pattern); embodied verbs on a visible plot, never menu farming
  (FFXIV Island Sanctuary's failure); adjacency puzzles add optimizer depth as pure
  data (Palia; parked to wave 2).

Game and system names in this digest are research citations only, never candidate
names for anything in this game (the D17 IP-safety rule).

## What we reuse (verified against release/v0.36.0)

The gathering profession chassis (content record, proficiency map, gain queue, bands,
tools, wield gate, tool effects), the fishing integration shape (own driver module,
own zone side table, own content tables, no GatherNodeType), the wall-clock seam
(`ctx.lockoutNowMs`, the raidLockouts idiom), the pre-rolled hidden-outcome template
(fishing bite delay), the per-viewer patch-state precedent (node readiness), the
elixir aura arm (well-fed), the entity snapshot (the feast), the banner queue and the
`gatherRareEvent` notice shape, the deeds catalog, the work-order cadence and payout
guard, the market, the wiki generator, the procedural icon system, the image-to-glb
pipeline, and the pr-screenshots and i18n toolchains.

## What is genuinely new

The FARM_PATCHES table and its placement guard suite; per-player plot state with
epoch-ms growth deadlines; the plant/harvest command pair and growth script; the
knobs (compost, watch, tonic, husks); the farming rollout arms in R37; a farming
objective arm for quests; the wellfed ItemDef arm; the placeable shared feast; the
Harvest Journal window; farm props and crop growth-stage meshes; the ready notices.

## Design decisions

All locked decisions live in `docs/farming/state.md` (D1 to D24). Do not restate them
here; this file is background.

## OPEN items

See the OPEN list in state.md: crop display-name lore pass, tuning constants
(proposed per phase, maintainer-flagged), the any-profession deed consequence,
seed-back rates, feast charges.

## Wave 2 parking lot (approved directions, explicitly out of this packet)

Crop-adjacency buffs (spatial optimizer depth as pure crop data); cultivated herbs
for alchemy WITH the displacement guardrail (complement wild herbalism, never a second
faucet of the identical item; the garrison lesson); premium compost tiers; per-bed
social presence (a lightweight occupied flag so other players' tending is visible).
