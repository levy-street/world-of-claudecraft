# Factions and standing

The reputation layer the world quests feed. Three factions, each owning a
group of zones, earn standing from world-quest turn-ins; standing climbs a
tier ladder that unlocks a quartermaster's stock, records deeds, and shows on
the character sheet. This page is the design contract; the code anchors are
`src/sim/factions.ts` (factions, zone map, tiers, thresholds, the award
function), `src/sim/content/faction_vendors.ts` (the quartermasters, the
taskmaster and their stock) and `tests/factions.test.ts` (the pinned rules).

## The factions

| Faction | Hub | Quartermaster | Zones |
|---|---|---|---|
| Rift Watch | Drifthaven | Quartermaster Vaelen | the Rift Watch group of `ZONE_TO_FACTION` |
| Church Order | Brother Aldric, Eastbrook Vale | Templar Althea (the Eastbrook chapel) | the Church Order group |
| Automatons | Wyrmwatch | Artificer Tobrin | the Automaton group |

`ZONE_TO_FACTION` in `src/sim/factions.ts` is the one map from a zone to its
faction; `worldQuestFaction` resolves a world quest to its faction (an explicit
override on the quest record, else the zone). Faction and tier display names are
`t()` keys under `hudChrome.reputation` (still marked provisional pending
narrative's final names).

## Earning standing

- The only standing source is a world-quest turn-in (`awardWorldQuest` in
  `src/sim/world_quests.ts`), plus the `/dev rep` command behind
  `ALLOW_DEV_COMMANDS` for testing. Every world quest counts toward the faction
  of its zone, so all three factions progress at once.
- `worldQuestStandingReward` sets the award per quest and per level bracket so
  that a full daily circuit lands the same standing on every faction; the exact
  amounts are pinned by `tests/factions.test.ts` ("synchronized daily reward
  math"), never restated here.
- `awardFactionReputation` is the single mutation: it adds, clamps to the level
  cap (`maxStandingForLevel`: the lower bracket pauses at Trusted, the upper
  bracket runs to Champion), and reports the tier before and after so a caller
  can tell a tier from a plain gain.
- One confirmed reroll per day, from the map's World Quests board
  (`src/sim/world_quest_reroll.ts`); Taskmaster Kaelen's dialog opens the board.
- The second source is the weekly emissary's commendation
  (`commendWeeklyQuest` in `src/sim/weekly_quests.ts`,
  `WEEKLY_QUEST_REWARD.commendationStanding`): once the week's charge is
  finished, the owner names ONE faction from the emissary's window and it
  receives the commendation through `awardFactionReputation`. One claim a
  week, recorded on the weekly pick (`commended`), so it rides the `wkq` self
  key and the character save; a faction with no headroom at the level cap is
  refused and the choice stays open rather than being wasted.

## Tiers

Six tiers, `STANDING_TIERS` with `STANDING_THRESHOLDS`: Unknown, Recognized,
Trusted, Proven, Vanguard, Champion. Each faction names them with its own
flavor titles (`FACTION_TIER_TITLES`); `factionTierTitle` is the one resolver
and the character sheet shows the current title.

## What standing unlocks

- **Quartermaster stock.** Each quartermaster sells one gated row per tier
  (`FACTION_VENDOR_GATES`, one item per gate), refused with the
  `hudChrome.reputation.vendorGate` line until the buyer's standing meets it.
  Faction jewelry is tuned to sit BELOW the crafted rungs and the raid pieces on
  every line: standing stock is a convenience for the leveling character, never
  a best-in-slot path (the dev kit, practice dummy, rogue and druid probes pin
  that they keep their release loadouts).
- **Deeds.** Reaching Trusted with a faction and Champion with a faction each
  record a Book of Deeds entry, and Champion with all three is its own capstone
  deed; the Champion deeds grant a title. They read standing through the
  `standing*` deed meters (`src/sim/deeds.ts`), which the award site marks
  dirty so the grant lands on the same tick as the turn-in.
- **Titles.** The per-tier flavor titles are display text on the Reputation
  tab; wearable titles come from the Champion deeds through the Book of Deeds
  title picker, like every other title.

## Surfacing

- **Reputation tab** of the character sheet (`src/ui/hud/reputation/`): one
  card per faction with the standing pill, tier bar, next-tier line and the
  faction title; the "standing pauses at {tier}" line for the lower bracket.
- **Chat log.** Every gain lands a loot-channel line naming the faction and the
  amount.
- **Tier reached.** Crossing into a new tier shows the deed-class celebration
  plate (tier and faction, the faction title as subtext), a gold chat line, the
  polite announce and the achievement chime. It is a state-diff observer over
  `IWorld.factions` (`faction_tier_celebration_view.ts`), not a sim event, so it
  works identically offline and online with no wire work; it gates on the same
  sync flag as the profession observers because `fac` ships in the same self
  snapshot, and it baselines silently so a login never toasts history.
- **Online.** `meta.factions` rides the `fac` self key (server
  `quest_snapshot_wire.ts`, client `faction_snapshot_wire.ts`), sanitized by
  the same `sanitizeFactionReputation` the save/load boundary uses.
- **Guide.** The public wiki page (`src/guide/pages/factions.ts`) explains the
  factions, tiers, titles and quartermasters spoiler-safe: names and roles only,
  never thresholds, amounts, stats or prices.

## Open design decisions

- The pace to Champion in the upper bracket is a maintainer call; the daily
  synchronization rule is fixed, the amounts are the knob.
- Further standing sources (regular quests, dungeon kills) stay open; any new
  source goes through `awardFactionReputation` and marks deeds dirty exactly
  like the world-quest site and the weekly commendation.
