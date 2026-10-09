// The Gravewyrm Sanctum's lights: the cult's braziers in the Keystone Court,
// the soul brazier on the Sledge Road, the Thaw Works' soul pyres (the only
// warm place in the dungeon) and the vault's three thaw pyres roaring
// violet-green on their stacks in the meltwater. Every point light rides the
// renderer's budgeted carriers (pushed to the fire-light sink, at most eight
// per light zone: tests/gravewyrm_sanctum_lights.test.ts); the fire itself is
// sanctum_fire.ts's flipbook tongues, embers and soul wisps (one instanced
// draw); halos and floor pools are emissive cards, never lights. The dusk
// itself is the `gravewyrmSanctum` state of interior_light_rig.ts.

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { FireLightSink } from '../point_light_budget';
import { markSharedGeometry, markSharedMaterial } from '../shared_resource';
import { radialGlowTexture } from '../textures';
import { buildSanctumFires } from './sanctum_fire';
import type { SanctumFireDraw } from './sanctum_fire_core';
import { planSanctumLights, SANCTUM_FIRE_STYLE, type SanctumFireKind } from './sanctum_plan_core';

export interface SanctumLightDeps {
  lowGfx: boolean;
  flames: THREE.Mesh[];
  fireLights: FireLightSink;
}

/** Where each fire burns above its prop's base: on the coals of the kit's
 *  pieces (docs/design/dungeon-rework/kit/build_gravewyrm_sanctum_kit.py), at
 *  the scale the kit plan draws them. The soul and cult braziers' coals lie
 *  in the bowl at 1.12 of Kit_SoulBrazier (drawn at 1.05); the works' soul
 *  pyres' coals at 0.82 of Kit_Pyre (drawn at 1.4 / 1.1), inside the iron
 *  tripod; the thaw pyres' coals on the grate at 2.7 of Kit_ThawPyre (drawn at
 *  1), inside the four uprights that rise to 6.6. */
export const SANCTUM_FIRE_SEAT: Readonly<Record<SanctumFireKind, number>> = {
  brazier: 1.12 * 1.05,
  pyre: 0.82 * (1.4 / 1.1),
  soulBrazier: 1.12 * 1.05,
  thawPyre: 2.7,
};

/** The fire's size per kind (a tongue's scale, yards): a layered body about
 *  1.8 sizes tall with licks above it. The thaw pyres roar 4 to 5 yd up the
 *  cage of uprights, the works' pyres climb out of their tripods, the
 *  braziers burn a bowl's worth. */
export const SANCTUM_FIRE_SIZE: Readonly<Record<SanctumFireKind, number>> = {
  brazier: 0.78,
  pyre: 1.4,
  soulBrazier: 0.78,
  thawPyre: 3.0,
};

function fireSize(kind: SanctumFireKind): number {
  return SANCTUM_FIRE_SIZE[kind];
}

let poolGeometry: THREE.BufferGeometry | null = null;
const haloMaterials = new Map<SanctumFireKind, THREE.SpriteMaterial>();
const poolMaterials = new Map<SanctumFireKind, THREE.MeshBasicMaterial>();

function haloMaterial(kind: SanctumFireKind): THREE.SpriteMaterial {
  let m = haloMaterials.get(kind);
  if (!m) {
    m = new THREE.SpriteMaterial({
      map: radialGlowTexture(),
      color: SANCTUM_FIRE_STYLE[kind].light,
      transparent: true,
      opacity: SANCTUM_FIRE_STYLE[kind].soul ? 0.5 : 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      name: `gravewyrmSanctumHalo:${kind}`,
    });
    markSharedMaterial(m);
    haloMaterials.set(kind, m);
  }
  return m;
}

function poolMaterial(kind: SanctumFireKind): THREE.MeshBasicMaterial {
  let m = poolMaterials.get(kind);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      map: radialGlowTexture(),
      color: SANCTUM_FIRE_STYLE[kind].light,
      transparent: true,
      // The snow throws the fire back: a warm (or soul-green) stain round
      // every fire, kept faint so a telegraph always reads over it.
      opacity: kind === 'thawPyre' ? 0.06 : SANCTUM_FIRE_STYLE[kind].soul ? 0.16 : 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      name: `gravewyrmSanctumPool:${kind}`,
    });
    markSharedMaterial(m);
    poolMaterials.set(kind, m);
  }
  return m;
}

/** Plant every fire, halo, floor pool and budgeted point light. */
export function buildSanctumLights(
  group: THREE.Group,
  deps: SanctumLightDeps,
  ground: (x: number, z: number) => number,
): void {
  poolGeometry ??= markSharedGeometry(new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2));
  const fires: SanctumFireDraw[] = [];
  for (const spot of planSanctumLights()) {
    const style = SANCTUM_FIRE_STYLE[spot.kind];
    const gy = ground(spot.x, spot.z);
    const y = gy + SANCTUM_FIRE_SEAT[spot.kind];
    const size = fireSize(spot.kind);
    fires.push({
      x: spot.x,
      y: y - 0.1,
      z: spot.z,
      size,
      soul: style.soul,
      roar: spot.kind === 'thawPyre',
    });
    const halo = new THREE.Sprite(haloMaterial(spot.kind));
    halo.position.set(spot.x, y + size * 0.6, spot.z);
    const hs = 2.4 + size * 2.8;
    halo.scale.set(hs, hs, 1);
    group.add(halo);
    const light = new THREE.PointLight(
      style.light,
      deps.lowGfx ? style.intensity * 0.6 : style.intensity,
      deps.lowGfx ? style.range * 0.7 : style.range,
      2,
    );
    // The budget's flicker pass owns the live intensity from this base.
    light.userData.baseIntensity = deps.lowGfx ? style.intensity * 0.6 : style.intensity * 1.5;
    light.position.set(spot.x, y + size * 0.7, spot.z);
    group.add(light);
    deps.fireLights.push(light);
    if (!deps.lowGfx) {
      const pool = new THREE.Mesh(poolGeometry, poolMaterial(spot.kind));
      pool.position.set(spot.x, gy + 0.07, spot.z);
      pool.scale.setScalar(style.range * 0.34);
      // A fire's stain on the floor's own rung: every telegraph paints over it.
      pool.renderOrder = floorVfxRenderOrder('ground', 2);
      group.add(pool);
    }
  }
  const fire = buildSanctumFires(fires, deps.lowGfx);
  if (fire) group.add(fire);
}
