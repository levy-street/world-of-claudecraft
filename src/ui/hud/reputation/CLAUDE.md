# src/ui/hud/reputation/ - the Reputation tab

The character window's Reputation tab: one row per allied faction (World Quests
Stage 1, section 04 of the scope), the day summary and the faction title.

- `reputation_view.ts` is the pure core (`UI_PURE_CORES`): rows, the day summary
  and the tier order, computed from `IWorld.factions`, the player level, the world
  quest log and the expiry. It re-derives nothing the sim owns: tiers, thresholds,
  the tier-internal progress and the level-15 cap all come from
  `src/sim/factions.ts` (`standingProgress`, `maxStandingForLevel`).
- `reputation_tab_html.ts` is the thin painter: a cold string builder the window
  calls on render. Faction names, hub names, tier labels and the per-faction
  standing titles are catalog keys (`hudChrome.reputation.*`), never the English
  identifiers the sim carries; the sim's `factionDisplayName` and
  `factionTierTitle` are for the sim's own text, not this tab.
- Tier colours are CSS classes (`char-rep-tier-<tier>`) mapped to the quality
  ramp tokens in `components.css`, so the ladder reads like item quality: poor,
  common, uncommon, rare, epic, legendary.
- The reset countdown reuses `worldQuestTimeRemainingText` from
  `world_quest_view.ts` so the tab and the map tooltip never disagree.
- Standing reaches the online client through the `fac` owner key
  (`src/net/faction_snapshot_wire.ts`); the tab reads `IWorld` only.
