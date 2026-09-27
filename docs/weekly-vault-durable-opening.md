# Weekly Vault opening and persistence

## Contract

Weekly reset records earned slots and their boss-unlock eligibility, without rolling items. `prepareWeeklyRewardOpen` validates every selected loot table and the player-level limit and rolls a requested slot once. Existing fixed legacy rewards keep their item. The online `dispatchWeeklyRewardCommand` saves the character through the existing lease-fenced character FIFO and shared background database permit before acknowledging the opening.

`pendingSave` and `opening` are runtime flags on the live choice. Character serialization strips both but keeps `tableId`, `itemId` and `opened: true`. The owner-only weekly snapshot sends an item only when it is opened and no save acknowledgment is pending. Account exports also omit unopened legacy items. Opening animations wait for this acknowledged item.

On false, thrown, cancelled, or ambiguous save results, the table and item stay fixed and the item stays concealed. Retrying saves the same item even if a different table is submitted. Loading a committed character blob restores the same opened item. Claims require every slot in the oldest week to be opened and acknowledged or have no remaining level-eligible unique items; any pending save still blocks claiming. Claiming consumes exactly one week for one item.

New rolls exclude item IDs already fixed anywhere in the same weekly batch, including unacknowledged saves and hidden legacy rewards. This is selection without replacement within the deduplicated union of selected tables, with one RNG draw per new item and none for retries. Other weeks do not restrict the roll. Existing saved rewards are never rewritten, even if they contain duplicates from before this rule. An exhausted table refuses a new roll instead of falling back to a duplicate; exhausting every eligible table allows the player to finish claiming an already revealed item.

## Bounds

World vaults use the previous raid tier's Normal equipment without requiring boss
clears. They share the same per-week duplicate exclusion as raid vaults; an
exhausted world pool does not block claiming another saved reward. The owner-only
`fixed` hint also covers concealed world and PvP items, preventing the UI from
mistaking a previously rolled item for an exhausted slot. It is not persisted.

- One opening save per character in flight, including repeated clicks.
- Invalid or already opened requests produce no save.
- Failed saves have a two-second retry cooldown; no automatic retry loop.
- A fifteen-second abort signal bounds queued/active persistence through the existing save path. Admission remains held until that operation settles.
- The existing backlog limit remains 520 weeks with at most twelve slots per week.

Offline and headless hosts use the same opening rules without a remote database barrier. Their serialized character state retains opened rewards, but the disposable offline browser session does not promise database durability.

## Compatibility and deployment

Old saves containing fixed items but no `opened` flag remain valid. Those items stay hidden until explicitly opened and saved; they are never replaced by a new roll.

Boss history is bounded by the authored encounter catalog. New batches snapshot the
highest cleared tier for each boss. Missing legacy history imports only proven
final-boss clears from dungeon deeds and legacy raid unlocks; an explicitly empty
batch snapshot stays empty. Legacy batches without a snapshot use verified lifetime
clears until their first new roll freezes them. Normal boss tables include uncommon
equipment so early dungeon clears still have valid rewards.

Deploy matching server and client code together. Older binaries can discard unopened slots, uncommon boss rewards or boss eligibility fields on save. Do not roll back to those readers after writing the new format without a compatible reader/backport or a reviewed migration that preserves earned slots. No SQL schema change or extra database call is required.

## Verification

Behavior tests live in `tests/weekly_rewards.test.ts`, `tests/server/weekly_reward_open.test.ts`, `tests/weekly_rewards_wire.test.ts`, `tests/account_export_state.test.ts`, and the weekly claim/reveal controller suites. They cover concealment before save, retries without rerolls, duplicate requests, stale sessions, interrupted saves, saved-state recovery, and UI animation/selection gates.

Disposable PostgreSQL lock contention, lost-commit-acknowledgment, and concurrent autosave/leave tests remain a release verification requirement. The local Docker engine was unavailable during this implementation; deferred-save unit tests do not replace that database evidence.

## Multi-table selection and level requirements

New openings require a bounded nonempty `tables` array (legacy scalar `table` is
accepted as a single selection). Dungeon IDs represent the union of cleared bosses
at the earned difficulty; raid IDs remain boss IDs. World/PvP use their pool IDs.
Every ID must be eligible, and duplicates never increase item probability. Equip
requirements use `requiredLevelFor(item) <= player.level + 3` on the authoritative
open path. No item is minted until opening. Requests retain existing FIFO admission
and save-before-publish behavior.

Only the actual attributed source is stored in `tableId`; selections are transient.
The sanitizer retains legacy boss source IDs as well as grouped dungeon IDs. Saved
items bypass new eligibility checks on retry so crashes or leveling cannot reroll.
Owner info adds only the current `playerLevel` scalar. When no level-eligible loot
remains in a slot, it does not block claiming another revealed reward; claiming
still consumes the week. Waiting instead preserves the unopened slot for leveling.
