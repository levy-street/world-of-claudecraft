// Compaction for a session's unflushed guild-bank op log (the escrow root fix,
// docs/guild-bank/escrow-fix-plan.md section 3.7).
//
// The log is the escrow save's WRITE PAYLOAD, so it can never be dropped: a
// dropped log silently discards committed-intent work. The
// GUILD_BANK_UNFLUSHED_OP_CAP is therefore a COMPACTION trigger, not a drop
// trigger, and compaction carries a positive obligation:
//
//   If the original log replays cleanly onto a book, the compacted log
//   replays cleanly onto the SAME book and leaves it in the SAME state.
//
// (Pinned in tests/guild_bank_persistence.test.ts.) Slot ops are the only
// order-sensitive entries (each carries an absolute before/after ladder
// witness), so the log is split into segments AROUND them and only the gold
// and item entries inside a segment are netted. Within one segment:
//
//   - every gold delta collapses into at most ONE net copperDelta entry;
//   - item deltas collapse per (itemId, canonical instance, craftedRecipeId),
//     the same three-dimensional identity the replay and the inverse match on
//     and the same key server/bank_ledger.ts guildSlotKey already uses.
//
// A 500-entry log therefore compacts to roughly (slot ops) x (1 + distinct
// item identities), which makes the cap effectively unreachable instead of
// destructive.
//
// The obligation above is stated over the FORWARD replay, which is what the
// log is a payload for. The same log is also the reconcile's undo list, and
// there the compacted form is not merely equal but strictly better behaved: a
// run like [withdraw 5, deposit 5] nets to nothing, so undoing it moves
// nothing, where undoing the original against a live book another officer has
// since emptied would clamp on the removal and then GRANT 5 back. Compaction
// therefore cannot make the inverse worse; it removes a clamped residue.
//
// The replay-EQUIVALENT netting the escrow merge falls back to is deliberately
// NOT here: it must stay locked to applyGuildBankDeltasTo's semantics (rung 0
// moves purse copper the book never held, so its charge must not be netted in),
// so it lives beside the applier as netGuildBankOpLogForReplay.
//
// Node-testable without the server: a pure function over plain deltas.

import { type GuildBankOpDelta, guildBankDeltaIdentityKey } from '../src/sim/guild_bank';

// The identity to net on is the sim's, imported rather than re-derived: a
// second copy that canonicalized a payload even slightly differently would net
// entries here that the replay and the inverse treat as distinct.
const identityKey = guildBankDeltaIdentityKey;

const isSlotOp = (d: GuildBankOpDelta): boolean => d.op === 'open_bank' || d.op === 'buy_slots';
const isGoldOp = (d: GuildBankOpDelta): boolean =>
  d.op === 'deposit_gold' || d.op === 'withdraw_gold';

/** Net one segment (no slot ops inside) into at most one gold entry plus one
 *  entry per item identity. Insertion order of the identities is preserved so
 *  the output is deterministic. */
function compactSegment(segment: readonly GuildBankOpDelta[]): GuildBankOpDelta[] {
  let copper = 0;
  let sawGold = false;
  const items = new Map<string, { sample: GuildBankOpDelta; net: number }>();
  const passthrough: GuildBankOpDelta[] = [];
  for (const d of segment) {
    if (isGoldOp(d)) {
      copper += Number(d.copperDelta) || 0;
      sawGold = true;
      continue;
    }
    // admin_purge (the operator escape hatch) is a REMOVAL exactly like a
    // withdraw, so it nets with one rather than falling through to the
    // passthrough: same three-dimensional identity, same forward replay, same
    // inverse. Netting it keeps the compacted log's revert identical to the
    // original's, which a reordered passthrough would only accidentally be.
    if (d.op !== 'deposit' && d.op !== 'withdraw' && d.op !== 'admin_purge') {
      // Not a shape this compactor understands: carry it through verbatim
      // rather than dropping it (never lose committed-intent work).
      passthrough.push(d);
      continue;
    }
    if (typeof d.itemId !== 'string' || d.itemId === '') {
      passthrough.push(d);
      continue;
    }
    const count = Math.max(0, Math.floor(Number(d.count)) || 0);
    if (count === 0) continue;
    const key = identityKey(d);
    const entry = items.get(key) ?? { sample: d, net: 0 };
    entry.net += d.op === 'deposit' ? count : -count;
    items.set(key, entry);
  }
  const out: GuildBankOpDelta[] = [];
  if (sawGold && copper !== 0) {
    out.push({
      op: copper > 0 ? 'deposit_gold' : 'withdraw_gold',
      itemId: null,
      count: null,
      instance: null,
      craftedRecipeId: null,
      copperDelta: copper,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 0,
    });
  }
  for (const { sample, net } of items.values()) {
    if (net === 0) continue;
    out.push({
      op: net > 0 ? 'deposit' : 'withdraw',
      itemId: sample.itemId,
      count: Math.abs(net),
      instance: sample.instance ?? null,
      craftedRecipeId: sample.craftedRecipeId ?? null,
      copperDelta: 0,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 0,
    });
  }
  out.push(...passthrough);
  return out;
}

/** Compact a session's unflushed op log, semantics-preserving (see the header).
 *  Pure: the input is never mutated. */
export function compactGuildBankOpLog(log: readonly GuildBankOpDelta[]): GuildBankOpDelta[] {
  const out: GuildBankOpDelta[] = [];
  let segment: GuildBankOpDelta[] = [];
  for (const d of log) {
    if (isSlotOp(d)) {
      out.push(...compactSegment(segment));
      segment = [];
      // Slot ops stay verbatim and in place: each carries an absolute ladder
      // witness (before/after) that both the replay and the inverse depend on,
      // and a book only ever climbs seven rungs in its whole lifetime, so they
      // are not a growth term.
      out.push(d);
      continue;
    }
    segment.push(d);
  }
  out.push(...compactSegment(segment));
  return out;
}
