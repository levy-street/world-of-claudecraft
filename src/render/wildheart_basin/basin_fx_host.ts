// What WildheartFx (basin_fx.ts) lends the boss layer (basin_boss_fx.ts and
// basin_boss_bursts.ts): its fx root (so every boss mesh rides the same
// compile-gated attach), its telegraph kit, its pooled particles and its shock
// rings. A type-only seam, so the boss modules never import the coordinator.

import type * as THREE from 'three';
import type { TelegraphKit } from '../floor_telegraph';
import type { BasinPuffOptions } from './basin_fx_core';
import type { BasinSplash } from './basin_splash';
import type { BasinThorns } from './basin_thorns';

export interface BasinFxHost {
  readonly root: THREE.Group;
  readonly kit: TelegraphKit;
  /** 1 on the full effects tier, thinner on the low tier (cosmetic only). */
  readonly density: number;
  readonly uTime: { value: number };
  groundY(x: number, z: number): number;
  puff(x: number, y: number, z: number, n: number, o: BasinPuffOptions): void;
  shockRing(x: number, z: number, color: number, radius: number, seconds: number): void;
  rand(): number;
  reducedMotion(): boolean;
  shake(amount: number): void;
  /** The shared crowns and ripples (water, sand, goo, acid). */
  readonly splash: BasinSplash;
  /** The shared thorn spikes (the lashes' thorn waves, a sprout's shoots). */
  readonly thorns: BasinThorns;
}
