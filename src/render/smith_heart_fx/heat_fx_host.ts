// What the Guardian of the Heat's fight painter (heat_fight_fx.ts) lends its
// parts (heat_well_fx.ts, heat_cinder_fx.ts): its one
// gated root, its particles and floor telegraph kit (and the kit's molten
// dressing, heat_telegraph.ts, on the fight's rungs), the shared clock, the
// tier's detail, the ground, a deterministic draw, the shake and the lists of
// what the parts build (disposed by the host). A type-only seam: no state.

import type * as THREE from 'three';
import type { IWorld } from '../../world_api';
import type { TelegraphKit } from '../floor_telegraph';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import type { HeatTelegraphs } from './heat_telegraph';

export interface HeatFxHost {
  readonly root: THREE.Group;
  readonly particles: EngineParticles;
  readonly kit: TelegraphKit;
  /** The kit's fans and lanes in the Hearth's molten paint (every Heat
   *  warning draws through it, never through the kit's flat footprint). */
  readonly telegraphs: HeatTelegraphs;
  readonly uTime: { value: number };
  /** The cosmetic layers are on (off on the low tier). */
  readonly detail: boolean;
  /** The particles' density (thinned on the low tier). */
  readonly density: number;
  readonly glowTex: THREE.Texture | null;
  readonly geometries: THREE.BufferGeometry[];
  readonly materials: THREE.Material[];
  readonly world?: IWorld;
  groundY(x: number, z: number): number;
  rand(): number;
  shakeNear(x: number, z: number, amount: number, reach?: number): void;
  /** An additive glow sprite material (registered for disposal). */
  sprite(color: number, name: string): THREE.SpriteMaterial;
}
