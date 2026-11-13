<!-- src/ui/hud/rewards/: the Rewards hub. Don't repeat root / src/ui /
     src/ui/hud / src/ui/hud/hub CLAUDE.md, reference them. -->

# src/ui/hud/rewards/: the Rewards hub

Menu consolidation step 7 (2026-11-06): one window behind its own rail button
(`#mm-rewards`, a claimable pill, no default key, the rebindable `rewards`
action) for the time-gated rewards that lived in three places. It is a hub in
the `src/ui/hud/hub/` sense: three member windows, one shown at a time.

| Tab | Member | Was |
|---|---|---|
| Vault | `weekly_vault_window.ts` (`#weekly-vault-window`) over the unchanged `WeeklyRewardsTab` | painted TWICE: the Bank's Rewards tab and the Dungeon Finder's read-only Vault tab |
| Weekly Quest | `src/ui/weekly_quests_window.ts` (`#weekly-quests-window`) | the emissary's NPC-only window |
| World Quests | `world_quests_window.ts` (`#world-quests-window`) over the board's own view and markup in `src/ui/hud/map/` | a section of the World Map rail |

## Load-bearing rules
- **The pill counts only what is waiting to be claimed, from the tabs' own reads.**
  `rewardsClaimCounts` (`rewards_view.ts`) takes the Vault's `readyWeeks` and the
  weekly charge's finished-and-unclaimed rule (the commendation strip's own
  rule). World Quests adds nothing: a world quest pays on completion, so a
  finished one has nothing left to claim. Never count from a second source.
- **The pick stays where the sim gates it.** `chooseWeeklyQuest` needs the
  emissary in talk range, so only the emissary's talk event opens the Weekly
  Quest member with live Choose buttons (`open(true)`); any hub open paints the
  cards read-only with the emissary's zone and a Show on Map. Commendation has
  no range gate in the sim, so it works from the hub.
- **Claiming the Vault stays at the keeper** (`weeklyRewardInfo.canClaim`).
  The keeper's talk event (`weekly_rewards`) opens the hub on the Vault tab.
- **The World Quests selection is the map's.** Row selection and the daily
  replacement share `MapMarkerInteractionController`'s selected world quest,
  so a pin picked on the map is the row the replacement acts on here.
