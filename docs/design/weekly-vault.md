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
- World quests: 2, 4 and 8 completions. Every rotating world quest turn-in counts
  once, through the same once-per-cycle claim guard the quest itself uses; story
  quests never count. The row pays the catch-up shelf: every Normal drop of the
  previous raid tier (Nythraxis, item level 29), ungated by raid kills and with no
  Heroic rung, filtered to what the character's class can wear.
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

Landed on the quests integration branch (release v0.44.0, tracker #4086) once
PR #3847 and this vault shared a tree. `creditWorldQuest` calls
`recordWeeklyWorldQuest(ctx, pid)` immediately after writing the quest's
once-per-cycle claim token, so a completion counts exactly once and a replayed
or re-credited quest cannot count again; no client command reaches the counter.
`weeklyLootPool('world')` walks the Nythraxis raid's spawns at Normal difficulty
through the same collector the raid and dungeon rows use, without the raid-kill
gate, and applies the shared usability filter. `worldQuestsAvailable` is true
whenever that pool holds something the character's class can wear (every
shipped class today), so a class with nothing to wear would see the row
unavailable rather than an empty roll. The tier, the per-class usability and
the completion path are pinned by `tests/weekly_vault_world_row.test.ts`.

## Local playtest and render budget

Enter an offline test character and type `/dev weeklyvault`. This teleports to the
hall and replaces that character's ledger with sample current progress and one
completed week with five item choices. Select an item, inspect it, then press
Take selected item. All other choices from that week disappear.

The stone hall uses eight merged meshes, no lights or texture downloads, and the
town's existing reveal and occluder-fade machinery. Its triangles are included in
the town budget. It uses headroom above the soft target while remaining below the
unchanged hard ceiling. Placement and geometry have dedicated regression coverage.

## Opening animation

Clicking a vault runs one choreography, owned by the pure core
`src/ui/weekly_vault_burst_core.ts` (`VAULT_TIMELINE` plus the per-element ray,
star, streak and ring layout) and painted by `attachWeeklyVaultReveal`, which
stamps every number as a `--vault-*` custom property the weekly rewards section of
`src/styles/components.css` animates. In order: light leaks around the door seam
from the inside on the click (and throbs while an online host is still saving the
opening), the latch releases and the heavy door swings, then the burst fires: every
ray, star and highlight streak has its own start, life, reach and drift on a
fast-out, long-settle curve, so they leave the doorway individually. A ray is a
stroke that trims outward through a feathered mask window: its head shoots out
from the centre with a soft edge, then its tail follows the head out, soft too, so
it leaves rather than fading where it lies. Streaks
flicker in place and fade; the stars twinkle and are the last to go. Two shockwave
rings and the core bloom ride the same window. The loot icon and name pop in from
the centre of the doorway (covering the strokes there) as soon as the door has
swung far enough to show it (`doorClearMs`, about two thirds of the swing, proven
against the door's own keyframes by the styles test), while the burst is still
going, through a backwards-filled keyframe, never a transition (a transition cannot start when the
open class lands before the element's first style pass, which is how the item name
once showed over a shut door).

The bank tab repaints once shortly after the click (the ledger now carries the
opened item), which rebuilds the tile; the reveal controller keeps the wall-clock
start of each in-flight opening and stamps `--vault-elapsed` on the rebuilt stage,
and every open-state animation subtracts it from its delay, so the show resumes
where it was instead of restarting. The host marks the reveal complete at
`WEEKLY_REVEAL_DURATION_MS` after the first start (less the elapsed time on a
resumed stage), after everything has settled. The light stays inside the card:
the tile's own overflow clip masks the burst at the card edge exactly as it masks
the swinging door, so nothing crosses into a neighbouring card; on the hinge side
the light container is clipped at the doorway's inner edge, so nothing lit ever
sits behind the open door.
Rarity colouring is untouched: every light element derives from the vault's
`--weekly-vault-glow` token and the loot keeps its `quality-*` class. Bloom and glow
scale with `--fx-shadow`; reduced motion and an already revealed vault show the
resting open state with no replay. Pinned by `tests/weekly_vault_burst_core.test.ts`,
`tests/weekly_vault_reveal_styles.test.ts` and the reveal controller suite.
