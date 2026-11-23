// What TrashEngineFx (trash_engine_fx.ts) lends its layers (engine_hazards,
// engine_walls, engine_walkers, engine_nova, engine_use, engine_body_fx,
// engine_quench): its root (so every mesh rides the one compile-gated
// attach), its telegraph kit, its pooled particles and rings, the ice shards,
// the world and the catalog. A type-only seam, so the layers never import the
// coordinator.

import type * as THREE from 'three';
import type { IWorld } from '../../world_api';
import type { TelegraphKit } from '../floor_telegraph';
import type { SanctumPuffOptions } from '../gravewyrm_sanctum_fx/sanctum_fx_core';
import type { SanctumShards } from '../gravewyrm_sanctum_fx/sanctum_shards';
import type { EngineCatalog } from './trash_engine_fx_core';

export interface TrashEngineHost {
  readonly root: THREE.Group;
  readonly kit: TelegraphKit;
  readonly world: IWorld;
  readonly catalog: EngineCatalog;
  /** 1 on the full effects tier, thinner on the low tier (cosmetic only). */
  readonly density: number;
  readonly uTime: { value: number };
  /** The soft radial glow sprite (null without a DOM). */
  readonly glowTex: THREE.Texture | null;
  readonly shards: SanctumShards;
  groundY(x: number, z: number): number;
  puff(x: number, y: number, z: number, n: number, o: SanctumPuffOptions): void;
  shockRing(x: number, z: number, color: number, radius: number, seconds: number): void;
  rand(): number;
  reducedMotion(): boolean;
  shake(amount: number): void;
  /** The drawn height of a body (yards). */
  bodyHeight(e: { templateId: string; scale: number; kind: string }): number;
}
