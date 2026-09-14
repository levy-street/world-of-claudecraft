# Weekly Vault

A dedicated stone hall stands at (21, -119), facing west toward Eastbrook.
The Vault Keeper at (12, -119) opens weekly rewards through Talk or Interact.
The level entrance joins a short detour in the coast road. Pale stone columns,
slate pavilion roofs, a carved portal and gold trim frame the large steel door.
Bursar Fernando and all bank storage remain at the Gilded Strongbox. The vault
occupies most of the screen and closes bags; opening bags closes the vault.

## Weekly choices

Activities unlock candidate items, not additional item grants. At the Crucible's
weekly reset, one item is generated for every unlocked slot. The player inspects
these fixed items and chooses ONE across all four rows. Confirming an item consumes
all other candidates from that earned week. Current-week progress stays separate.
Older unclaimed weeks retain their choices; collecting one reveals the next week.
Opening, reconnecting, saving and loading never reroll an existing batch.

This follows Blizzard's [Great Vault carryover rules](https://eu.support.blizzard.com/en/article/279635)
and [raid pool unlock rules](https://worldofwarcraft.blizzard.com/en-us/news/23935248).
Modern WoW replaced PvP with world activities, as described in its
[War Within overview](https://worldofwarcraft.blizzard.com/en-us/news/24025828).
This implementation retains the owner's four requested rows, with WoC's own
content and equipment tiers:

- Raids: 1, 2 and 3 unique final encounters. This release has only three raid
  bosses, so WoW's 2/4/6 thresholds would be unreachable. Normal and Heroic share
  credit; a Heroic kill upgrades its encounter. Defeating a raid unlocks its loot
  at that difficulty for future vaults.
- Dungeons: 1, 4 and 8 clears. The first, fourth and eighth best clears determine
  each choice's difficulty. WoC supports Normal and Heroic tiers.
- World quests: 2, 4 and 8 completions, reserved until PR #3847 lands.
- PvP: 1, 3 and 5 ranked arena or rated battleground wins. Practice matches,
  developer-ended battlegrounds and forfeits do not count.

The window shows actual candidates with quality, item level and tooltips; current
progress and exact eligible loot pools remain below. Each eligible item has equal
probability within its pool. Equipment must be usable by the character's class.
Legendary chase drops, quest items and non-equipment are excluded.

## Reset and persistence

Both the vault and Crucible call `SimContext.weeklyRaidResetMs`, injected by the
host. Online uses the realm time zone; offline uses the same default calendar:
Tuesday at 03:00 realm time, with DST. The countdown uses that exact stored boundary.
No additional scheduler or database queries are introduced.

`weekly_rewards.ts` owns current progress, persistent raid unlocks and completed
weekly batches. A claim validates proximity, life state, the active batch's choice
key, the echoed sequence and bag capacity before consuming a batch and granting its
fixed item. Inventory and the ledger share the existing character save. An unclean
crash can roll back unsaved gameplay, like other inventory operations.

Storage is bounded to 520 earned weeks with at most 12 candidates per week. At this
ten-year backlog limit existing choices are protected and new completed weeks cannot
be stored; the UI warns to collect rewards. Calendar progress still advances. The
wire exposes only the oldest set and backlog count, never the entire history.

Prototype `pending` roll counters convert once into one legacy choice set, capped
at three candidates per row. Those counters did not retain week identities. The
optional `CharacterState.weeklyRewards` field supports old characters. Servers
predating this field drop it on save; deployment rollback requires preservation.

## World quest integration

Base: release v0.43.0, tracker #3966. Per the owner's decision, PR #3847 is not
merged. The row remains visibly unavailable and ordinary quests do not count.
When that PR lands, call `recordWeeklyWorldQuest(ctx, pid)` after the once-only
`creditWorldQuest` guard, register its equipment in `weeklyLootPool`, and enable
`worldQuestsAvailable`. Test repeated completion and rotation behavior.

## Local playtest and render budget

Enter an offline test character and type `/dev weeklyvault`. This teleports to the
hall and replaces that character's ledger with sample current progress and one
completed week with five item choices. Select an item, inspect it, then press
Take selected item. All other choices from that week disappear.

The stone hall uses eight merged meshes, no lights or texture downloads, and the
town's existing reveal and occluder-fade machinery. Its triangles are included in
the town budget. It uses headroom above the soft target while remaining below the
unchanged hard ceiling. Placement and geometry have dedicated regression coverage.
