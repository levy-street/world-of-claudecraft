// The Wildheart Basin's lights: the Sunbone braziers (warm troll fire in their
// ochre bowls at the Idol Maw, the Upper Convergence and the shrine) and the
// jade spirit flame burning in the stone jaguar's eyes. Every point light
// rides the renderer's budgeted carriers (pushed to the fire-light sink, at
// most eight per light zone: tests/wildheart_basin_render_core.test.ts);
// the fire itself is basin_fire.ts's flipbook tongues and embers (one
// instanced draw); halos and floor pools are emissive cards, never lights.
// The daylight itself is the
// `wildheartBasin` state of interior_light_rig.ts.

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { FireLightSink } from '../point_light_budget';
import { markSharedGeometry, markSharedMaterial } from '../shared_resource';
import { radialGlowTexture } from '../textures';
import { buildBasinFires } from './basin_fire';
import {
  BASIN_LIGHT_STYLE,
  type BasinLightKind,
  JAGUAR_EYES,
  planBasinLights,
} from './basin_plan_core';

export interface BasinLightDeps {
  lowGfx: boolean;
  flames: THREE.Mesh[];
  fireLights: FireLightSink;
}

let poolGeometry: THREE.BufferGeometry | null = null;
const haloMaterials = new Map<BasinLightKind, THREE.SpriteMaterial>();
const poolMaterials = new Map<BasinLightKind, THREE.MeshBasicMaterial>();

function haloMaterial(kind: BasinLightKind): THREE.SpriteMaterial {
  let m = haloMaterials.get(kind);
  if (!m) {
    m = new THREE.SpriteMaterial({
      map: radialGlowTexture(),
      color: BASIN_LIGHT_STYLE[kind].flame,
      transparent: true,
      opacity: kind === 'eyes' ? 0.85 : 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      name: `wildheartHalo:${kind}`,
    });
    markSharedMaterial(m);
    haloMaterials.set(kind, m);
  }
  return m;
}

function poolMaterial(kind: BasinLightKind): THREE.MeshBasicMaterial {
  let m = poolMaterials.get(kind);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      map: radialGlowTexture(),
      color: BASIN_LIGHT_STYLE[kind].color,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      name: `wildheartPool:${kind}`,
    });
    markSharedMaterial(m);
    poolMaterials.set(kind, m);
  }
  return m;
}

function addLight(
  group: THREE.Group,
  deps: BasinLightDeps,
  kind: BasinLightKind,
  x: number,
  y: number,
  z: number,
): void {
  const style = BASIN_LIGHT_STYLE[kind];
  const light = new THREE.PointLight(
    style.color,
    deps.lowGfx ? style.intensity * 0.6 : style.intensity,
    deps.lowGfx ? style.range * 0.7 : style.range,
    2,
  );
  if (!deps.lowGfx) light.userData.baseIntensity = style.intensity * 1.5;
  light.position.set(x, y, z);
  group.add(light);
  deps.fireLights.push(light);
}

/** Plant every flame, halo, floor pool and budgeted point light. */
export function buildBasinLights(
  group: THREE.Group,
  deps: BasinLightDeps,
  ground: (x: number, z: number) => number,
): void {
  poolGeometry ??= new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
  markSharedGeometry(poolGeometry);
  const fires: { x: number; y: number; z: number }[] = [];
  for (const spot of planBasinLights()) {
    const gy = ground(spot.x, spot.z);
    const y = gy + spot.lift;
    // The bowl's fire: flipbook tongues, a hot core and embers (basin_fire.ts),
    // one draw for every brazier, gathered below.
    fires.push({ x: spot.x, y: y - 0.15, z: spot.z });
    const halo = new THREE.Sprite(haloMaterial(spot.kind));
    halo.position.set(spot.x, y + 0.5, spot.z);
    halo.scale.set(4.6, 4.6, 1);
    group.add(halo);
    addLight(group, deps, spot.kind, spot.x, y + 1, spot.z);
    if (!deps.lowGfx) {
      const pool = new THREE.Mesh(poolGeometry, poolMaterial(spot.kind));
      pool.position.set(spot.x, gy + 0.06, spot.z);
      pool.scale.setScalar(BASIN_LIGHT_STYLE[spot.kind].range * 0.32);
      // A fire pool on the floor's own rung: every telegraph paints over it.
      pool.renderOrder = floorVfxRenderOrder('ground', 1);
      group.add(pool);
    }
  }
  const fire = buildBasinFires(fires, deps.lowGfx);
  if (fire) group.add(fire);
  // The jaguar's eyes: a jade glow card in each socket and one light between
  // them, cast forward onto the brow and the head's face (never the arena).
  for (const eye of JAGUAR_EYES) {
    const halo = new THREE.Sprite(haloMaterial('eyes'));
    halo.position.set(eye.x, eye.y, eye.z);
    halo.scale.set(11, 7, 1);
    group.add(halo);
  }
  const mid = JAGUAR_EYES.reduce(
    (a, e) => ({
      x: a.x + e.x / JAGUAR_EYES.length,
      y: a.y + e.y / JAGUAR_EYES.length,
      z: a.z + e.z / JAGUAR_EYES.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
  addLight(group, deps, 'eyes', mid.x, mid.y, mid.z - 5);
}
