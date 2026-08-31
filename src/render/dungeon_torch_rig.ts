// Shared torch fire assembly for dungeon interiors: the animated flame cone,
// the budgeted PointLight, and the baked floor glow pool, extracted from
// dungeon.ts (monolith ratchet) so the kit pillar torches and the Ignivar
// dressing plan's placed torches build the same fire from one place.
// KEEPS the renderer contract: flame cone -> sink.flames (the renderer
// animates them), PointLight -> sink.fireLights with userData.baseIntensity
// on the budgeted tier (budgetFireLights keeps the nearest GFX allowance
// shining; a light without baseIntensity stays always-on for the low tier).
import * as THREE from 'three';
import type { IgnivarPropPlacement } from './ignivar_dressing_plan_core';
import type { FireLightSink } from './point_light_budget';
import { markSharedGeometry } from './shared_resource';
import { addTorchGlowDecal } from './torch_glow_decal';

export interface TorchFireSink {
  group: THREE.Group;
  flames: THREE.Mesh[];
  fireLights: FireLightSink;
}

export interface TorchFireColors {
  flame: number;
  emissive: number;
  light: number;
}

export interface TorchFireTuning {
  flameEmissive: number;
  lightDistance: number;
  /** budgeted (high) tier only; omitted keeps the light always-on (low) */
  lightBaseIntensity?: number;
  glow: boolean;
}

let flameGeometry: THREE.BufferGeometry | null = null;

export function resetDungeonTorchRigCaches(): void {
  flameGeometry = null;
}

export function addTorchFire(
  sink: TorchFireSink,
  opts: {
    flame: [number, number, number];
    flameScale?: number;
    light: [number, number, number];
    colors: TorchFireColors;
    tuning: TorchFireTuning;
    /** floor glow pool position; skipped when tuning.glow is false */
    glowAt?: [number, number];
    glowScale?: number;
  },
): void {
  flameGeometry ??= markSharedGeometry(new THREE.ConeGeometry(0.22, 0.6, 6));
  const flame = new THREE.Mesh(
    flameGeometry,
    new THREE.MeshLambertMaterial({
      color: opts.colors.flame,
      emissive: opts.colors.emissive,
      emissiveIntensity: opts.tuning.flameEmissive,
      transparent: true,
      opacity: 0.92,
    }),
  );
  flame.position.set(...opts.flame);
  if (opts.flameScale !== undefined) flame.scale.setScalar(opts.flameScale);
  sink.group.add(flame);
  sink.flames.push(flame);

  const light = new THREE.PointLight(opts.colors.light, 10, opts.tuning.lightDistance, 2);
  if (opts.tuning.lightBaseIntensity !== undefined)
    light.userData.baseIntensity = opts.tuning.lightBaseIntensity;
  light.position.set(...opts.light);
  sink.group.add(light);
  sink.fireLights.push(light);

  // The glow decal is canvas-backed: skip in DOM-less hosts (the dressing
  // builders unit-test in Node), same guard as the dressing glow pools.
  if (opts.tuning.glow && opts.glowAt && typeof document !== 'undefined')
    addTorchGlowDecal(
      sink.group,
      opts.glowAt[0],
      opts.glowAt[1],
      opts.colors.light,
      undefined,
      opts.glowScale ?? 1,
    );
}

/** The basket anchor measured from torch_mounted.glb's canonical frame
 *  (long axis on X, seated at y 0): the top-band vertex centroid sits
 *  centred in x/z at 0.99 canonical units up. */
const TORCH_BASKET_Y = 0.99;
/** The kit pillar torches place the model at scale 1.6; placed flames and
 *  glows scale relative to that so a same-size placed torch matches them. */
const TORCH_KIT_SCALE = 1.6;

/** Fire for every 'torch' placement in an Ignivar dressing plan. The mount
 *  mesh itself rides the ordinary env-prop instancing; this adds the flame,
 *  light, and floor pool at the basket. Returns how many torches got fire. */
export function addIgnivarPlacedTorchFires(
  sink: TorchFireSink,
  placements: readonly IgnivarPropPlacement[],
  colors: TorchFireColors,
  tuning: TorchFireTuning,
): number {
  let added = 0;
  for (const placement of placements) {
    if (placement.key !== 'torch') continue;
    const rel = placement.scale / TORCH_KIT_SCALE;
    const basketY = placement.y + TORCH_BASKET_Y * placement.scale;
    addTorchFire(sink, {
      flame: [placement.x, basketY + 0.18 * rel, placement.z],
      flameScale: rel,
      light: [placement.x, basketY + 0.4 * rel, placement.z],
      colors,
      tuning,
      glowAt: [placement.x, placement.z],
      glowScale: Math.min(1.5, Math.max(0.75, rel)),
    });
    added++;
  }
  return added;
}
