// The Sunken Bastion's lights: the ship's lanterns and fire baskets (the only
// warm, living light at storm dusk), the sick green fog-fire in the gaol, and
// the Fogbeacon's great lamp. Every point light rides the renderer's budgeted
// carriers (pushed to the fire-light sink); flames flicker through the
// renderer's shared flame list. No light is added outside that seam.

import * as THREE from 'three';
import { SUNKEN_BASTION_VOID_HEIGHT } from '../../sim/content/sunken_bastion_layout';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { FireLightSink } from '../point_light_budget';
import { markSharedGeometry, markSharedMaterial } from '../shared_resource';
import { radialGlowTexture } from '../textures';
import {
  BASTION_FLAME_KINDS,
  BASTION_LIGHT_STYLE,
  type BastionLightKind,
  bastionFlamePosition,
  SUNKEN_BASTION_LIGHTS,
} from './bastion_plan_core';

export interface BastionLightDeps {
  lowGfx: boolean;
  flames: THREE.Mesh[];
  fireLights: FireLightSink;
}

let flameGeometry: THREE.BufferGeometry | null = null;
let glowGeometry: THREE.BufferGeometry | null = null;
const flameMaterials = new Map<BastionLightKind, THREE.MeshBasicMaterial>();
const glowMaterials = new Map<BastionLightKind, THREE.MeshBasicMaterial>();
const haloMaterials = new Map<BastionLightKind, THREE.SpriteMaterial>();

function flameMaterial(kind: BastionLightKind): THREE.MeshBasicMaterial {
  let m = flameMaterials.get(kind);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: BASTION_LIGHT_STYLE[kind].flame,
      transparent: true,
      opacity: 0.95,
      name: `sunkenBastionFlame:${kind}`,
    });
    markSharedMaterial(m);
    flameMaterials.set(kind, m);
  }
  return m;
}

function glowMaterial(kind: BastionLightKind): THREE.MeshBasicMaterial {
  let m = glowMaterials.get(kind);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      map: radialGlowTexture(),
      color: BASTION_LIGHT_STYLE[kind].color,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      name: `sunkenBastionGlow:${kind}`,
    });
    markSharedMaterial(m);
    glowMaterials.set(kind, m);
  }
  return m;
}

function haloMaterial(kind: BastionLightKind): THREE.SpriteMaterial {
  let m = haloMaterials.get(kind);
  if (!m) {
    m = new THREE.SpriteMaterial({
      map: radialGlowTexture(),
      color: BASTION_LIGHT_STYLE[kind].flame,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      name: `sunkenBastionHalo:${kind}`,
    });
    markSharedMaterial(m);
    haloMaterials.set(kind, m);
  }
  return m;
}

/** Plant every flame, halo, floor glow and budgeted point light. */
export function buildBastionLights(
  group: THREE.Group,
  deps: BastionLightDeps,
  ground: (x: number, z: number) => number,
): void {
  flameGeometry ??= new THREE.ConeGeometry(0.24, 0.8, 7);
  markSharedGeometry(flameGeometry);
  glowGeometry ??= new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
  markSharedGeometry(glowGeometry);
  for (const spot of SUNKEN_BASTION_LIGHTS) {
    const style = BASTION_LIGHT_STYLE[spot.kind];
    const [fx, y, fz] = bastionFlamePosition(spot);
    const gy = ground(fx, fz);
    if (BASTION_FLAME_KINDS.has(spot.kind)) {
      const flame = new THREE.Mesh(flameGeometry, flameMaterial(spot.kind));
      flame.position.set(fx, y + (spot.kind === 'lantern' ? 0 : 0.3), fz);
      flame.scale.setScalar(spot.kind === 'lantern' ? 0.55 : 2.1);
      group.add(flame);
      deps.flames.push(flame);
      const halo = new THREE.Sprite(haloMaterial(spot.kind));
      halo.position.set(fx, y + 0.35, fz);
      const hs = spot.kind === 'lantern' ? 2.4 : 4.6;
      halo.scale.set(hs, hs, 1);
      group.add(halo);
    }
    const light = new THREE.PointLight(
      style.color,
      deps.lowGfx ? style.intensity * 0.6 : style.intensity,
      deps.lowGfx ? style.range * 0.7 : style.range,
      2,
    );
    if (!deps.lowGfx) light.userData.baseIntensity = style.intensity * 1.8;
    light.position.set(fx, y + (spot.kind === 'beacon' ? 0 : 1), fz);
    group.add(light);
    deps.fireLights.push(light);
    if (!deps.lowGfx && spot.kind !== 'beacon' && gy > SUNKEN_BASTION_VOID_HEIGHT + 1) {
      const glow = new THREE.Mesh(glowGeometry, glowMaterial(spot.kind));
      glow.position.set(fx, gy + 0.06, fz);
      glow.scale.setScalar(style.range * 0.3);
      // A torch pool on the floor's own rung: every telegraph paints over it.
      glow.renderOrder = floorVfxRenderOrder('ground', 1);
      group.add(glow);
    }
  }
}
