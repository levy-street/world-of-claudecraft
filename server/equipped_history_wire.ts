// The worn tracked copies' public history for the inspect window: the terse
// `eqh` identity key, `{ [slot]: ItemProvenance }`, one entry per worn copy
// that carries a provenance record (docs/design/item-tracking.md). Each entry
// is publicProvenanceView: names, dates, source and zone, the owner chain
// (at most MAX_ITEM_OWNER_HISTORY hands) and the transfer count; never a
// character id, never the parent guid, and never the copy's own guid, which
// stays a server and operator fact.
//
// A SIBLING of the eqi allowlist (equipped_instance_wire.ts), not a field in
// it: eqi stays pinned to publicInstanceView field for field, and the history
// is the heaviest thing a worn copy can carry, so it is built and serialized
// ONCE per worn set and spliced into the cached identity JSON
// (GameServer.wireCacheFor, the `app` precedent) instead of riding the
// per-entity, per-tick identity stringify.
//
// The memo: Entity.equippedInstances is replaced wholesale by every stat
// recalc (recalcPlayerStats deep-clones the owner's payloads; nothing mutates
// the mirror in place), so its object identity is the O(1) per-tick check. A
// recalc that changed nothing about the worn tracked copies hands back the
// SAME string (the content key below), so the identity diff stays quiet and
// no viewer is re-sent a full record. A copy's public record is a function of
// that key: source and zone are fixed at the mint, and the owner chain only
// grows with `transfers`.

import { publicProvenanceView } from '../src/sim/item_provenance';
import type { Entity, ItemProvenance } from '../src/sim/types';

type WornInstances = Entity['equippedInstances'];

interface EquippedHistoryMemo {
  src: WornInstances;
  key: string;
  json: string | null;
}

const memos = new WeakMap<object, EquippedHistoryMemo>();

/** The content key of the worn set's tracked copies: one segment per slot
 *  whose copy carries a provenance record. */
function historyKey(worn: WornInstances): string {
  let key = '';
  for (const [slot, inst] of Object.entries(worn)) {
    const p = inst?.provenance;
    if (!p) continue;
    key += `${slot}|${inst.guid ?? ''}|${p.at}|${p.by}|${p.source}|${p.transfers ?? 0};`;
  }
  return key;
}

/** The `eqh` object for a worn set, or null when no worn copy is tracked.
 *  Exported for the wire tests; the broadcaster reads the memoized JSON. */
export function equippedHistoryWire(worn: WornInstances): Record<string, ItemProvenance> | null {
  let out: Record<string, ItemProvenance> | null = null;
  for (const [slot, inst] of Object.entries(worn)) {
    if (!inst?.provenance) continue;
    out ??= {};
    out[slot] = publicProvenanceView(inst.provenance);
  }
  return out;
}

/** The serialized `eqh` value for this entity (null when nothing worn is
 *  tracked), minted at most once per distinct worn set. */
export function equippedHistoryJson(e: Pick<Entity, 'equippedInstances'>): string | null {
  const src = e.equippedInstances;
  const memo = memos.get(e);
  if (memo?.src === src) return memo.json;
  const key = historyKey(src);
  if (memo && memo.key === key) {
    memo.src = src;
    return memo.json;
  }
  const wire = equippedHistoryWire(src);
  const json = wire === null ? null : JSON.stringify(wire);
  memos.set(e, { src, key, json });
  return json;
}
