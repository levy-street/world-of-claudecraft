// Per-entity wire fragment caches for the snapshot broadcaster (server/game.ts):
// the cache record shapes plus the three allocation-free JSON splicers that
// assemble a full or lite entity record from its cached identity and dynamic
// fragments. Moved out of the coordinator (the monolith ratchet: extract, then
// lower); the caches themselves are still owned and refreshed by GameServer.

import type { StableAuraWireCache } from './snapshot_timer_wire';

// Per-entity wire fragments, refreshed lazily at most once per tick and
// shared by every recipient. The version counters bump only when the
// serialized form actually changes, making per-session diffing O(1).
export interface EntityWireVariantCache {
  tick: number;
  idVer: number;
  dynJson: string;
  dynVer: number;
  auraVer: number;
  builtIdVer: number;
  builtDynVer: number;
  builtAuraVer: number;
  fullJson: string;
  liteJson: string;
  fullAuraJson: string;
  liteAuraJson: string;
}

export interface EntityWireCache {
  tick: number;
  /** identityFields() as JSON, WITHOUT the authored look: the string actually
   *  diffed for identity changes. Kept beside idJson so the appearance splice
   *  below only re-runs when the rest of the identity moves. */
  baseIdJson: string;
  idJson: string;
  /** The authored modular look, serialized ONCE for this entity (null when it
   *  has none). Immutable for the session, so it is minted on first use and
   *  spliced, never re-stringified. */
  appJson: string | null;
  baseDynJson: string;
  idVer: number;
  baseDynVer: number;
  auraCache: StableAuraWireCache;
  legacy: EntityWireVariantCache;
  stable: EntityWireVariantCache;
}

export interface EntityWireView {
  idVer: number;
  dynVer: number;
  auraVer: number;
  fullJson: string;
  liteJson: string;
  fullAuraJson: string;
  liteAuraJson: string;
}

export function emptyWireVariant(): EntityWireVariantCache {
  return {
    tick: -1,
    idVer: 0,
    dynJson: '',
    dynVer: 0,
    auraVer: 0,
    builtIdVer: -1,
    builtDynVer: -1,
    builtAuraVer: -1,
    fullJson: '',
    liteJson: '',
    fullAuraJson: '',
    liteAuraJson: '',
  };
}

export function fullEntityJson(id: number, idJson: string, dynJson: string): string {
  return `{"id":${id},${idJson.slice(1, -1)},${dynJson.slice(1, -1)}}`;
}

export function liteEntityJson(id: number, dynJson: string): string {
  return `{"id":${id},${dynJson.slice(1, -1)}}`;
}
