// The server half of the Stealth Rework shimmer band: the per-viewer `ssh`
// snapshot suffix (rules in src/sim/stealth_shimmer.ts).
//
// What a row carries. [x, y, z, fade]: the stealther's position rounded to
// whole yards (feet height to half a yard) and a stepped fade. No id, no name,
// no class, no facing, so a modified client learns no more than an honest
// client draws, and there is nothing to target.
//
// What a viewer is never sent. A stealther this pass already ships to the
// viewer as an entity (`sent`, the session's sentEnts after the entity loop):
// the body is drawn, so a shimmer would be a second marker on it.
//
// Cost and cadence. beginBroadcast walks the player roster once per pass for
// stealthed players (a flag read each); with none, every viewer's suffix is an
// early return after the session's first `[]`. Per viewer, a stealther out of
// shimmer reach is rejected by distance before any hostility check. A list is
// sent only when it changed, and moves at most once per
// SHIMMER_SEND_INTERVAL_TICKS (twice a second). Two changes skip the wait: a
// shimmer whose stealther the viewer is now SENT (the body arrives in this
// snapshot, so the shimmer must not sit on it), and a first shimmer after
// none (no delay on news). With many stealthers the pass buckets them on a
// SHIMMER_MAX_REACH grid once, and a viewer judges only its 3x3 neighbourhood,
// so a realm full of rogues costs each viewer its nearby ones, not all of them. The pacing note lives in a WeakMap on the
// session's lastSent object, so every session reset (lastSent = {}) resets it.
// Rows are sorted by position, so their order carries no identity.
// A paced nonempty session checks only its eight retained rows for urgent
// retirement, before collecting candidates or building JSON. Due rebuilds
// advance the deadline even when their bytes are unchanged. Empty sessions
// keep checking for eager news; lazy grid iteration stops at the output cap.

import {
  forEachShimmer,
  SHIMMER_MAX_REACH,
  SHIMMER_SEND_INTERVAL_TICKS,
  type ShimmerRoster,
  type ShimmerWorld,
  type StealthShimmer,
  shimmerSources,
} from '../src/sim/stealth_shimmer';
import { hasPvpEscapeStealth } from '../src/sim/threat';
import type { Entity } from '../src/sim/types';

export const SHIMMER_WIRE_KEY = 'ssh';

export interface ShimmerSentSet {
  has(id: number): boolean;
}

interface Pacing {
  tick: number;
  rows: { s: StealthShimmer; id: number }[];
}

const pacingBySession = new WeakMap<object, Pacing>();

/** Below this many stealthers a plain walk beats building the grid. */
const GRID_MIN_SOURCES = 12;
const cellOf = (v: number): number => Math.floor(v / SHIMMER_MAX_REACH);
const cellKey = (cx: number, cz: number): number => cx * 1_000_003 + cz;

export class StealthShimmerWire {
  private sources: readonly Entity[] = [];
  private grid: Map<number, Entity[]> | null = null;
  private readonly picked: { s: StealthShimmer; id: number }[] = [];
  private sent: ShimmerSentSet = new Set<number>();
  private readonly seen = (src: Entity): boolean => this.sent.has(src.id);
  private readonly visit = (s: StealthShimmer, src: Entity): void => {
    this.picked.push({ s, id: src.id });
  };

  constructor(
    private readonly world: ShimmerWorld & ShimmerRoster & { readonly tickCount: number },
  ) {}

  /** Refresh the stealthed players; call once per broadcast pass. */
  beginBroadcast(): this {
    this.sources = shimmerSources(this.world);
    this.grid = null;
    if (this.sources.length >= GRID_MIN_SOURCES) {
      this.grid = new Map();
      for (const src of this.sources) {
        const key = cellKey(cellOf(src.pos.x), cellOf(src.pos.z));
        const cell = this.grid.get(key);
        if (cell) cell.push(src);
        else this.grid.set(key, [src]);
      }
    }
    return this;
  }

  /** The viewer's suffix, or '' when there is nothing new to send yet. */
  suffixFor(viewer: Entity, lastSent: Record<string, string>, sent: ShimmerSentSet): string {
    const prior = lastSent[SHIMMER_WIRE_KEY];
    if (this.sources.length === 0 && prior === '[]') return '';
    const tick = this.world.tickCount;
    const pacing = pacingBySession.get(lastSent);
    if (pacing && tick - pacing.tick < SHIMMER_SEND_INTERVAL_TICKS) {
      // Clear escapes immediately, but keep every other row at its LAST SENT
      // position. One escaping source must not bypass the movement cadence for
      // all the nearby sources. At most SHIMMER_VIEW_CAP records per session.
      const kept = pacing.rows.filter(({ id }) => {
        const source = this.world.entities.get(id);
        return source && !source.dead && !hasPvpEscapeStealth(source) && !sent.has(id);
      });
      if (kept.length !== pacing.rows.length) {
        const json = `[${kept.map(({ s }) => `[${s.x},${s.y},${s.z},${s.fade}]`).join(',')}]`;
        lastSent[SHIMMER_WIRE_KEY] = json;
        pacingBySession.set(lastSent, { tick: pacing.tick, rows: kept });
        return `,"${SHIMMER_WIRE_KEY}":${json}`;
      }
      if (pacing.rows.length > 0) return '';
    }
    this.picked.length = 0;
    this.sent = sent;
    forEachShimmer(this.world, viewer, this.candidatesFor(viewer), this.seen, this.visit);
    let json = '[]';
    if (this.picked.length > 0) {
      this.picked.sort((a, b) => a.s.x - b.s.x || a.s.z - b.s.z || a.s.y - b.s.y);
      json = `[${this.picked.map(({ s }) => `[${s.x},${s.y},${s.z},${s.fade}]`).join(',')}]`;
    }
    // Record due rebuilds even if their bytes did not change. Otherwise an
    // unchanged nonempty list would remain due on every following tick.
    pacingBySession.set(lastSent, { tick, rows: this.picked.slice() });
    if (json === prior) return '';
    lastSent[SHIMMER_WIRE_KEY] = json;
    return `,"${SHIMMER_WIRE_KEY}":${json}`;
  }

  /** Every source, or with the grid, those in the viewer's 3x3 cells (a
   *  superset of everything within SHIMMER_MAX_REACH). */
  private *candidatesFor(viewer: Entity): Iterable<Entity> {
    if (!this.grid) {
      yield* this.sources;
      return;
    }
    const cx = cellOf(viewer.pos.x);
    const cz = cellOf(viewer.pos.z);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cell = this.grid.get(cellKey(cx + dx, cz + dz));
        if (cell) yield* cell;
      }
    }
  }
}
