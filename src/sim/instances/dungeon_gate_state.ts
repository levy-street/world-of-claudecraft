// The per-slot OPEN gate set every collision reader consults (the collision
// half of instances/dungeon_gates.ts). A dungeon's interior collider list is
// shared by all of its slots, and its gate colliders carry a `gate` id; this
// leaf hands each slot the list minus the colliders of the gates open in THAT
// slot, cached per slot until its set changes.
//
// Who writes it: the authoritative world after every tick (the Sim, via
// dungeon_gates.ts syncDungeonGateCollision) and the online ClientWorld from
// the gate entities it mirrors (net/dungeon_gate_wire.ts). Same shape as the
// ferry's berth gates (transport_gates.ts): process-wide per slot origin, so
// two live worlds in one process running the same slot would contend, and
// each world re-writes its own state every tick. A slot nobody wrote is
// entirely CLOSED, the safe default for a fresh claim.
//
// Pure leaf: no SimContext, no rng, no entity reads.

import type { Collider } from '../colliders';

interface SlotGates {
  open: ReadonlySet<string>;
  version: number;
}

interface FilteredList {
  base: Collider[];
  version: number;
  list: Collider[];
}

const slots = new Map<number, Map<number, SlotGates>>();
const filtered = new Map<number, Map<number, FilteredList>>();
const gatedLists = new WeakMap<Collider[], boolean>();
let versionCounter = 0;

function slotOf(ox: number, oz: number): SlotGates | undefined {
  return slots.get(ox)?.get(oz);
}

/** Replace the open set of the slot anchored at (ox, oz). No-op when equal. */
export function setOpenDungeonGates(ox: number, oz: number, open: Iterable<string>): void {
  const next = new Set(open);
  const cur = slotOf(ox, oz);
  if (cur && cur.open.size === next.size && [...next].every((g) => cur.open.has(g))) return;
  if (!cur && next.size === 0) return;
  let row = slots.get(ox);
  if (!row) {
    row = new Map();
    slots.set(ox, row);
  }
  row.set(oz, { open: next, version: ++versionCounter });
}

/** The open gate ids of a slot (empty when nothing was ever opened there). */
export function openDungeonGatesAt(ox: number, oz: number): ReadonlySet<string> {
  return slotOf(ox, oz)?.open ?? EMPTY;
}

const EMPTY: ReadonlySet<string> = new Set();

/** Forget every slot's state (tests only; a live world simply re-writes). */
export function clearDungeonGateStateForTest(): void {
  slots.clear();
  filtered.clear();
}

function hasGated(base: Collider[]): boolean {
  let known = gatedLists.get(base);
  if (known === undefined) {
    known = base.some((c) => c.gate !== undefined);
    gatedLists.set(base, known);
  }
  return known;
}

/**
 * The slot's view of a shared interior list: `base` itself when it carries
 * no gate colliders (every interior but a gated dungeon, zero cost), else
 * `base` minus the colliders of the gates open in the slot at (ox, oz).
 */
export function slotGatedColliders(base: Collider[], ox: number, oz: number): Collider[] {
  if (!hasGated(base)) return base;
  const state = slotOf(ox, oz);
  const version = state?.version ?? 0;
  let row = filtered.get(ox);
  let cached = row?.get(oz);
  if (cached && cached.base === base && cached.version === version) return cached.list;
  const open = state?.open ?? EMPTY;
  const list =
    open.size === 0 ? base : base.filter((c) => c.gate === undefined || !open.has(c.gate));
  cached = { base, version, list };
  if (!row) {
    row = new Map();
    filtered.set(ox, row);
  }
  row.set(oz, cached);
  return list;
}
