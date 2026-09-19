# Weekly Vault opening and persistence

## Contract

Weekly reset records earned slots and their raid-unlock eligibility, without rolling items. `prepareWeeklyRewardOpen` rolls a requested slot once. Existing fixed legacy rewards keep their item. The online `dispatchWeeklyRewardCommand` saves the character through the existing lease-fenced character FIFO and shared background database permit before acknowledging the opening.

`pendingSave` and `opening` are runtime flags on the live choice. Character serialization strips both but keeps `itemId` and `opened: true`. The owner-only weekly snapshot sends an item only when it is opened and no save acknowledgment is pending. Account exports also omit unopened legacy items. Opening animations wait for this acknowledged item.

On false, thrown, cancelled, or ambiguous save results, the item stays fixed and concealed. Retrying saves the same item. Loading a committed character blob restores the same opened item. Claims require every slot in the oldest week to have been opened and acknowledged; claiming still consumes exactly one week for one item.

## Bounds

- One opening save per character in flight, including repeated clicks.
- Invalid or already opened requests produce no save.
- Failed saves have a two-second retry cooldown; no automatic retry loop.
- A fifteen-second abort signal bounds queued/active persistence through the existing save path. Admission remains held until that operation settles.
- The existing backlog limit remains 520 weeks with at most twelve slots per week.

Offline and headless hosts use the same opening rules without a remote database barrier. Their serialized character state retains opened rewards, but the disposable offline browser session does not promise database durability.

## Compatibility and deployment

Old saves containing fixed items but no `opened` flag remain valid. Those items stay hidden until explicitly opened and saved; they are never replaced by a new roll.

Deploy matching server and client code together. Older binaries require every saved choice to have `itemId` and can discard new unopened slots on load. Do not roll back to that reader after writing the new format without a compatible reader/backport or a reviewed migration that preserves earned slots. No SQL schema change is required.

## Verification

Behavior tests live in `tests/weekly_rewards.test.ts`, `tests/server/weekly_reward_open.test.ts`, `tests/weekly_rewards_wire.test.ts`, `tests/account_export_state.test.ts`, and the weekly claim/reveal controller suites. They cover concealment before save, retries without rerolls, duplicate requests, stale sessions, interrupted saves, saved-state recovery, and UI animation/selection gates.

Disposable PostgreSQL lock contention, lost-commit-acknowledgment, and concurrent autosave/leave tests remain a release verification requirement. The local Docker engine was unavailable during this implementation; deferred-save unit tests do not replace that database evidence.
