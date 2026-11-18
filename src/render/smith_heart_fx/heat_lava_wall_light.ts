// The lava waves' wall of fire lighting the raid (heat_lava_wall_fx.ts; the
// plan heat_lava_wall_core.ts wallLightAt): one point light per standing ring,
// riding the ring at the local player's bearing, flickering with the flames,
// so a player (and the raid round them) glows orange as a wall comes on.
// Cosmetic: every light is a dynamic source of the renderer's point-light
// budget (adoptDynamicBudgetLight, point_light_budget.ts), never one three
// gathers itself, so the lit programs never relink and the budget may shed it.
// Built once in the constructor, each light in its own holder (the budget
// ranks a light by its ancestors' visibility: a dark one is hidden).

import * as THREE from 'three';
import { adoptDynamicBudgetLight, type BudgetPointLightRegistry } from '../point_light_budget';
import { WALL_LIGHT, wallLightAt } from './heat_lava_wall_core';

const _at = { x: 0, z: 0, k: 0 };

/** A standing ring as the lights read it. */
export interface WallLightRing {
  front: number;
  gaps: readonly number[];
  half: number;
  rise: number;
}

export class HeatWallLights {
  private readonly lights: THREE.PointLight[] = [];
  private readonly holders: THREE.Group[] = [];
  private lit = false;

  constructor(
    root: THREE.Object3D,
    count: number,
    private readonly registry: BudgetPointLightRegistry | null = null,
  ) {
    for (let i = 0; i < count; i++) {
      const light = new THREE.PointLight(
        WALL_LIGHT.color,
        0,
        WALL_LIGHT.distance,
        WALL_LIGHT.decay,
      );
      light.name = `smithHeartHeatWallLight${i}`;
      light.castShadow = false;
      // Marked as a carrier source before it can ever be gathered.
      adoptDynamicBudgetLight(light, registry);
      const holder = new THREE.Group();
      holder.name = `smithHeartHeatWallLightHolder${i}`;
      holder.visible = false;
      holder.add(light);
      root.add(holder);
      this.holders.push(holder);
      this.lights.push(light);
    }
  }

  /** One frame: the standing rings, the local player's spot (local yards; null
   *  when there is none), the claim's origin, the floor's height, the clock. */
  update(
    rings: readonly WallLightRing[],
    me: { x: number; z: number } | null,
    origin: { x: number; z: number },
    floorY: number,
    t: number,
  ): void {
    this.lit = false;
    for (let i = 0; i < this.lights.length; i++) {
      const ring = rings[i];
      const holder = this.holders[i];
      if (!ring || !me) {
        holder.visible = false;
        continue;
      }
      const at = wallLightAt(ring, ring.rise, me.x, me.z, _at);
      if (at.k < 0.02) {
        holder.visible = false;
        continue;
      }
      const flick = 0.86 + 0.1 * Math.sin(t * 13.1 + i * 2.3) + 0.06 * Math.sin(t * 31.7 + i);
      const light = this.lights[i];
      light.intensity = WALL_LIGHT.peak * at.k * flick;
      light.position.set(origin.x + at.x, floorY + WALL_LIGHT.lift, origin.z + at.z);
      holder.visible = true;
      this.lit = true;
    }
  }

  /** Any light on this frame (the tests read it). */
  get anyLit(): boolean {
    return this.lit;
  }

  /** The lights (the tests read them). */
  get all(): readonly THREE.PointLight[] {
    return this.lights;
  }

  hide(): void {
    for (const h of this.holders) h.visible = false;
    this.lit = false;
  }

  /** Terminal: every light out of the budget and the scene. */
  dispose(): void {
    for (const light of this.lights) this.registry?.release(light);
    for (const h of this.holders) h.removeFromParent();
    this.lights.length = 0;
    this.holders.length = 0;
  }
}
