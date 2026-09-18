// The Book of Deeds, Reliquary, and account-ledger heavy self keys, moved
// whole out of GameServer.broadcastSnapshots (the monolith ratchet; the
// appendFarmPlotsWire precedent). All four ride the heavy self gate:
// deedUnlocked, reliquaryUnlock, and relicRecorded are HEAVY_SELF_EVENTS
// members, so an unlock, a fill, or a ledger record re-diffs on the next
// snapshot, and a sibling session's earn marks this one heavy dirty through
// AccountLedgerService. DELIBERATE freshness floor: a stat bump that crosses
// no unlock threshold re-wires only on the staggered safety refresh (<=2s),
// never per increment; flushing per kill would re-serialize every heavy field
// each combat tick, the exact cost the gate exists to avoid.
import { accountLedgerWireJson } from '../src/sim/account_ledger';
import { reliquaryWireJson } from '../src/sim/reliquary';
import type { PlayerMeta } from '../src/sim/sim';

export function appendBookOfDeedsWire(
  meta: PlayerMeta,
  maybe: (key: string, value: unknown) => void,
  maybeRaw: (key: string, serialized: string) => void,
): void {
  // The earned map (deed id -> utcDay) and the COMPLETE lifetime stat block.
  // Maps and Sets do not survive JSON.stringify, so both wire as plain
  // objects/arrays and ClientWorld rebuilds them on apply (src/net/book_wire.ts).
  maybe('deeds', Object.fromEntries(meta.deedsEarned));
  maybe('dstats', {
    counters: meta.deedStats.counters,
    itemsDiscovered: [...meta.deedStats.itemsDiscovered],
    visited: [...meta.deedStats.visited],
    dungeonClears: meta.deedStats.dungeonClears,
  });
  // Reliquary sparse blob only: firstFind (with its folded obtain tally) /
  // illuminatedPages / marks / recent, omit-empty. Item ownership stays on
  // dstats.itemsDiscovered; never a second full discovery array. maybeRaw, not
  // maybe: the same shape the realm readouts use, a value serialized ONCE by a
  // memo (reliquaryWireJson caches on the state's own revision) instead of per
  // session per tick; byte-identical to the JSON.stringify path it replaced,
  // so lastSent comparisons are unchanged.
  maybeRaw('reliq', reliquaryWireJson(meta.reliquary));
  // The account ledger (src/sim/account_ledger.ts): which characters on the
  // account earned each deed and found each relic, memoized per ledger
  // revision on the same doctrine.
  maybeRaw('acct', accountLedgerWireJson(meta.accountLedger));
}
