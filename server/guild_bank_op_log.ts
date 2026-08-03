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
// Node-testable without the server: a pure function over plain deltas.

import type { GuildBankOpDelta } from '../src/sim/guild_bank';

/** Key-order-independent serialization, so two structurally equal instance
 *  payloads (one of which may have round-tripped through JSONB) net together.
 *  Mirrors the sim's canonicalJson; kept local because src/sim does not export
 *  it and duplicating five lines beats widening the sim's public surface. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

function identityKey(d: GuildBankOpDelta): string {
  return `${d.itemId ?? ''}|${canonicalJson(d.instance ?? null)}|${d.craftedRecipeId ?? ''}`;
}

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
    if (d.op !== 'deposit' && d.op !== 'withdraw') {
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

/** A REPLAY-ONLY normalization of a log, for the escrow merge's fallback
 *  attempt. Same final book as the ordered replay, with every intermediate dip
 *  removed:
 *
 *   - slot ops keep their order and their absolute ladder witness, but their
 *     treasury CHARGE is lifted out (the ladder is monotone, so the grants are
 *     order independent among themselves);
 *   - item deltas net per identity;
 *   - every copper delta in the log, including the lifted slot charges, nets
 *     into ONE gold delta applied LAST.
 *
 *  The final treasury is base + sum(copperDeltas) either way, and the final
 *  item multiset and ladder position are unchanged, so this is the same
 *  outcome; what it removes is the ORDERING artifact where this session's own
 *  withdraw ran against a live book that held another officer's copper and the
 *  durable replay put that officer's whole log first. Never used for the log
 *  itself (the session's bookkeeping needs one entry per op).
 */
export function netGuildBankOpLogForReplay(log: readonly GuildBankOpDelta[]): GuildBankOpDelta[] {
  const out: GuildBankOpDelta[] = [];
  let copper = 0;
  const items = new Map<string, { sample: GuildBankOpDelta; net: number }>();
  for (const d of log) {
    copper += Number(d.copperDelta) || 0;
    if (isSlotOp(d)) {
      out.push({ ...d, copperDelta: 0 });
      continue;
    }
    if (d.op !== 'deposit' && d.op !== 'withdraw') continue;
    if (typeof d.itemId !== 'string' || d.itemId === '') continue;
    const count = Math.max(0, Math.floor(Number(d.count)) || 0);
    if (count === 0) continue;
    const key = identityKey(d);
    const entry = items.get(key) ?? { sample: d, net: 0 };
    entry.net += d.op === 'deposit' ? count : -count;
    items.set(key, entry);
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
  if (copper !== 0) {
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
  return out;
}
