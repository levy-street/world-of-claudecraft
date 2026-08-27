// The crafting-moment Discord activity card emit (masterwork procs, and since
// Masterwrought phase 13 the legendary forging), extracted from game.ts
// detectActivity as a move-not-rewrite (server/CLAUDE.md module-first; the
// monolith ratchet): the dedupe/opt-out/release body is byte-identical to the
// masterwork arm it came from, parameterized by kind. game.ts keeps thin
// per-event calls that resolve the session and the card's item name.
//
// The contract the body carries (R60 and the fix-round P1):
// - The ACCOUNT-scoped dedupe key (`<kind>:<accountId>`, unlike rareloot's
//   per-drop rollId) collapses a session's repeats to at most one card per
//   dedupe TTL, and it is claimed SYNCHRONOUSLY, ahead of the opt-out read:
//   these moments repeat, and a check inside the enqueue would fire one db
//   read per proc while all but one card is provably discarded (a same-tick
//   burst would even pass a plain pre-check together). Claimed = this moment
//   owns the TTL window; the enqueue then carries a null key.
// - The card rides the deed_broadcasts opt-out (the deed fan-out's gate):
//   masterwork procs REPEAT (3 to 15 percent of crafts), so unlike the
//   once-ever levelup/rareloot arms, publishing them to a third-party channel
//   needs the player-controllable gate. A legendary forging is rarer but the
//   same channel and the same consent question, so it rides the same gate.
// - Fire-and-forget off the loop (the fanOutDeedUnlock shape); identity is
//   captured by the caller before the await. A FAILED opt-out read releases
//   the claim with the claim stamp, so one db blip cannot silently drop the
//   account's cards for the whole TTL, and the release re-stamps with a short
//   retry backoff rather than deleting outright (R60).
//
// For the legendary kind, `itemName` is the PLAYER-CHOSEN name (the phase 13
// wire decision): player-authored text carried as DATA end to end; the bot
// renders it as plain embed text at masterwork parity (bot/logic.ts).
import { getDeedBroadcasts } from './deeds_db';
import { claimDedupeKey, enqueueActivity, releaseDedupeKey } from './discord_activity';

export function emitCraftActivityCard(opts: {
  kind: 'masterwork' | 'legendary';
  accountId: number;
  name: string;
  itemName: string;
  realm: string;
  now: number;
  profileUrlFor: (name: string) => string | null;
}): void {
  const { kind, accountId, name, itemName, realm, now } = opts;
  if (!claimDedupeKey(`${kind}:${accountId}`, now)) return;
  const profileUrl = opts.profileUrlFor(name);
  void getDeedBroadcasts(accountId)
    .then((enabled) => {
      if (!enabled) return;
      enqueueActivity(
        {
          kind,
          accountIds: [accountId],
          names: [name],
          realm,
          profileUrl,
          itemName,
        },
        null,
        now,
      );
    })
    .catch((err) => {
      // The claim gated work that FAILED: release it, or one db blip
      // silently drops this account's cards for the whole TTL. The
      // claim stamp rides along so a LATE rejection cannot delete a
      // window a newer claimant owns, and the release re-stamps with
      // a short retry backoff rather than deleting outright (R60).
      releaseDedupeKey(`${kind}:${accountId}`, now);
      console.error(`${kind} activity failed:`, err);
    });
}
