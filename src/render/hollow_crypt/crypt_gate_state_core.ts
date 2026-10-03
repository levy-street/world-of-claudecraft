// The renderer's memory of each in-dungeon gate: the state its mirrored gate
// entity last showed, and when that changed, so the gate structures in the
// interior can play their reveal (a portcullis grinding up, a bridge knitting
// itself bone by bone) instead of popping. The FIRST observation of a gate
// snaps (a party arriving at an already-open gate sees it open, no replay).
//
// Pure and Three-free: the gate object view reports observations, the gate
// painter reads openness each frame.

import { type DungeonGateState, dungeonGateStateOf } from '../../sim/instances/dungeon_gates';
import { gateOpenness } from './crypt_plan_core';

interface GateMemory {
  state: DungeonGateState;
  from: number;
  to: number;
  changedAt: number;
}

const memory = new Map<string, GateMemory>();

export function gateMemoryKey(ox: number, oz: number, gateId: string): string {
  return `${Math.round(ox)}|${Math.round(oz)}|${gateId}`;
}

/** How open a state is on screen (sealed and closed both block). */
export function stateOpenness(state: DungeonGateState): number {
  return state === 'open' ? 1 : 0;
}

/** Record what a gate entity currently shows, at render time `now` (seconds). */
export function observeGate(key: string, templateId: string, now: number): void {
  const state = dungeonGateStateOf(templateId);
  if (state === null) return;
  const prev = memory.get(key);
  if (!prev) {
    const o = stateOpenness(state);
    memory.set(key, { state, from: o, to: o, changedAt: now });
    return;
  }
  if (prev.state === state) return;
  const current = gateOpenness(prev.from, prev.to, now - prev.changedAt);
  memory.set(key, { state, from: current, to: stateOpenness(state), changedAt: now });
}

export interface GateView {
  state: DungeonGateState;
  openness: number;
  /** Seconds since the last state change (the reveal clock). */
  since: number;
}

/** The gate's on-screen state; closed and snapped until first observed. */
export function gateView(key: string, now: number): GateView {
  const m = memory.get(key);
  if (!m) return { state: 'closed', openness: 0, since: 999 };
  return {
    state: m.state,
    openness: gateOpenness(m.from, m.to, now - m.changedAt),
    since: now - m.changedAt,
  };
}

/** Forget every gate (tests; a fresh page starts empty anyway). */
export function clearGateMemoryForTest(): void {
  memory.clear();
}
