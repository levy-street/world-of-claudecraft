// The Drowned Temple's lights: braziers of pale moonfire, the lamp pillars'
// moon orbs, the tidepools' cyan, the gold breathing from the Great Conch, the
// prism's violet under the Colossus and the altar's silver. Every point light
// rides the renderer's budgeted carriers (pushed to the fire-light sink);
// flames flicker through the renderer's shared flame list. No light is added
// outside that seam. The painter follows the Sunken Bastion's.

import * as THREE from 'three';
import { DROWNED_TEMPLE_VOID_HEIGHT } from '../../sim/content/drowned_temple_layout';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { FireLightSink } from '../point_light_budget';
import { markSharedGeometry, markSharedMaterial } from '../shared_resource';
import { radialGlowTexture } from '../textures';
import {
  planTempleLights,
  TEMPLE_FLAME_KINDS,
  TEMPLE_LIGHT_STYLE,
  type TempleLightKind,
  templeFlamePosition,
} from './temple_plan_core';

export interface TempleLightDeps {
  lowGfx: boolean;
  flames: THREE.Mesh[];
  fireLights: FireLightSink;
}

let flameGeometry: THREE.BufferGeometry | null = null;
let glowGeometry: THREE.BufferGeometry | null = null;
const flameMaterials = new Map<TempleLightKind, THREE.MeshBasicMaterial>();
const glowMaterials = new Map<TempleLightKind, THREE.MeshBasicMaterial>();
const haloMaterials = new Map<TempleLightKind, THREE.SpriteMaterial>();

function flameMaterial(kind: TempleLightKind): THREE.MeshBasicMaterial {
  let m = flameMaterials.get(kind);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: TEMPLE_LIGHT_STYLE[kind].flame,
      transparent: true,
      opacity: 0.95,
      name: `drownedTempleFlame:${kind}`,
    });
    markSharedMaterial(m);
    flameMaterials.set(kind, m);
  }
  return m;
}

function glowMaterial(kind: TempleLightKind): THREE.MeshBasicMaterial {
  let m = glowMaterials.get(kind);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      map: radialGlowTexture(),
      color: TEMPLE_LIGHT_STYLE[kind].color,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      name: `drownedTempleGlow:${kind}`,
    });
    markSharedMaterial(m);
    glowMaterials.set(kind, m);
  }
  return m;
}

function haloMaterial(kind: TempleLightKind): THREE.SpriteMaterial {
  let m = haloMaterials.get(kind);
  if (!m) {
    m = new THREE.SpriteMaterial({
      map: radialGlowTexture(),
      color: TEMPLE_LIGHT_STYLE[kind].flame,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      name: `drownedTempleHalo:${kind}`,
    });
    markSharedMaterial(m);
    haloMaterials.set(kind, m);
  }
  return m;
}

/** Plant every flame, halo, floor glow and budgeted point light. */
export function buildTempleLights(
  group: THREE.Group,
  deps: TempleLightDeps,
  ground: (x: number, z: number) => number,
): void {
  flameGeometry ??= new THREE.ConeGeometry(0.24, 0.8, 7);
  markSharedGeometry(flameGeometry);
  glowGeometry ??= new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
  markSharedGeometry(glowGeometry);
  for (const spot of planTempleLights()) {
    const style = TEMPLE_LIGHT_STYLE[spot.kind];
    const [fx, y, fz] = templeFlamePosition(spot);
    const gy = ground(fx, fz);
    if (TEMPLE_FLAME_KINDS.has(spot.kind)) {
      const flame = new THREE.Mesh(flameGeometry, flameMaterial(spot.kind));
      flame.position.set(fx, y + 0.3, fz);
      flame.scale.setScalar(1.8);
      group.add(flame);
      deps.flames.push(flame);
      const halo = new THREE.Sprite(haloMaterial(spot.kind));
      halo.position.set(fx, y + 0.35, fz);
      const hs = 4.2;
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
    light.position.set(fx, y + (spot.kind === 'palefire' ? 1 : 0), fz);
    group.add(light);
    deps.fireLights.push(light);
    if (!deps.lowGfx && spot.kind !== 'conch' && gy > DROWNED_TEMPLE_VOID_HEIGHT + 1) {
      const glow = new THREE.Mesh(glowGeometry, glowMaterial(spot.kind));
      glow.position.set(fx, gy + 0.06, fz);
      glow.scale.setScalar(style.range * 0.3);
      // A torch pool on the floor's own rung: every telegraph paints over it.
      glow.renderOrder = floorVfxRenderOrder('ground', 1);
      group.add(glow);
    }
  }
}
