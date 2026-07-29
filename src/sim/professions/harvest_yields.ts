// Pure, host-agnostic core for the corpse-harvest YIELD LEDGER (#2457): the
// list of distinct items one `harvestCorpse` command actually granted, which
// the text-free `harvestResult` SimEvent carries to the client.
//
// Background: corpse harvest is the one profession flow whose single command
// grants MULTIPLE distinct items (one per focused component tag, plus a
// Pristine specimen on a rare-or-better roll, #1145). It reaches the shared
// inventory hub from six call sites inside `src/sim/interaction.ts`, and each
// of those used to print its own "You receive:" line and its own generic ding,
// so one harvest burst a small pile of both. #2430 reduced every other
// profession flow to one line and one cue per grant and deliberately left this
// one alone: standing the hub line down (the `loot` event's `callerLogs` flag)
// with no result event behind it would have made the harvest invisible. This
// ledger is the missing event's payload, so the flags can finally be set.
//
// The ledger records what LANDED, never what was rolled: a signed grant a full
// bag downgraded to a plain top-up is recorded plain, and a specimen the bags
// refused outright contributes no entry at all (the `gatherDowngrade` toast
// owns that half of the feedback and is unchanged). A caller therefore records
// beside each grant call, not from the roll loop.
//
// ONE entry per DISTINCT granted item, never one per grant call: that is the
// #2430 contract restated for a multi-item command, and it is what makes the
// client's line count match the item count. Two component tags mapping to the
// same item id fold into one entry with the summed quantity, matching the
// pre-claim capacity gate in interaction.ts, which already folds that case
// when it reserves stack room (`wanted.find((w) => w.itemId === wantedItemId)`);
// a ledger that disagreed would print two lines for one stack.
//
// DOM/Three-free and rng-free (src/sim purity, tests/architecture.test.ts).

import type { MaterialRarity } from './gathering';

/** Which arm of the harvest produced a ledger entry.
 *  - `plain`: the ordinary fungible component stack, including a signed grant
 *    that a full bag downgraded to an unsigned top-up (the yield survived, the
 *    mark did not).
 *  - `signed`: the component itself granted as an instance stamped with the
 *    harvester's name (#1145), which only a family with no Pristine specimen
 *    reaches.
 *  - `specimen`: the Pristine specimen jackpot, a pure extra granted BESIDE
 *    its family's own plain component. */
export type HarvestYieldKind = 'plain' | 'signed' | 'specimen';

/** One distinct item a corpse harvest landed. Ids and numbers only: the sim
 *  and the server stay language-agnostic, so the client composes the line. */
export interface HarvestYield {
  readonly itemId: string;
  /** Units ACTUALLY granted, post-truncation (`gatherResult.qty` semantics). */
  readonly qty: number;
  /** The rolled material rarity of the component this entry came from, which
   *  is what colors the chat line. Not the item's own def quality: the same
   *  Rough Hide is granted at every roll, so the item LINK inside the line
   *  keeps painting from the def (the `gatherResult` rule). */
  readonly rarity: MaterialRarity;
  readonly kind: HarvestYieldKind;
}

/** Append `entry` to `ledger`, merging into an existing entry for the same
 *  item granted the same way at the same rolled rarity (summing quantities)
 *  rather than adding a second one. Merging on all three keeps a merge from
 *  ever hiding a difference the line would have shown: two grants that would
 *  render differently (a different quantity variant, a different line color,
 *  the specimen's own wording) always keep their own entries. */
export function recordHarvestYield(ledger: HarvestYield[], entry: HarvestYield): void {
  const at = ledger.findIndex(
    (e) => e.itemId === entry.itemId && e.kind === entry.kind && e.rarity === entry.rarity,
  );
  if (at < 0) ledger.push(entry);
  else ledger[at] = { ...ledger[at], qty: ledger[at].qty + entry.qty };
}
