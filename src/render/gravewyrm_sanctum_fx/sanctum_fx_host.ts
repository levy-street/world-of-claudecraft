// What SanctumFx (sanctum_fx.ts) lends its creature layers (tusker_fx.ts,
// sanctum_trash_fx.ts): its fx root (so every mesh rides the same
// compile-gated attach), its telegraph kit, its pooled particles, its shock
// rings and its ice shards. A type-only seam, so the layers never import the
// coordinator.

import type * as THREE from 'three';
import type { TelegraphKit } from '../floor_telegraph';
import type { SanctumPuffOptions } from './sanctum_fx_core';
import type { SanctumShards } from './sanctum_shards';

export interface SanctumFxHost {
  readonly root: THREE.Group;
  readonly kit: TelegraphKit;
  /** 1 on the full effects tier, thinner on the low tier (cosmetic only). */
  readonly density: number;
  readonly uTime: { value: number };
  groundY(x: number, z: number): number;
  puff(x: number, y: number, z: number, n: number, o: SanctumPuffOptions): void;
  shockRing(x: number, z: number, color: number, radius: number, seconds: number): void;
  rand(): number;
  reducedMotion(): boolean;
  shake(amount: number): void;
  /** A presentation gesture to an entity's view (the renderer's triggerAttack). */
  gesture(entityId: number, gesture: string): void;
  /** The shared ice shards (the toss's block, the Shatter, the sweep's ice). */
  readonly shards: SanctumShards;
}
