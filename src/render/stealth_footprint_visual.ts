// Stealth Rework footprints: the ground prints an enemy stealther leaves, read
// from IWorld.stealthFootprints (already filtered to what this player may see:
// enemies only, at least 2 sec old, within the read radius). Each print is a
// dent in the ground, not a stain: a flat foot-shaped decal whose normals
// carry a shallow cup and a raised lip (stealth_footprint_core.ts), shaded by
// the scene's live key light (the sun by day, the moon at night: the renderer
// publishes it per frame, scene_sampling.ts sceneKeyLightUniform) against flat
// ground and MULTIPLIED onto the ground already drawn, so a print always wears
// the colours of the ground it is on (grass, sand, snow), the side facing away
// from the sun darkens, the side facing it lightens, and flat ground shows
// through untouched. One instanced mesh per fade bucket, every material built
// at construction and the whole root attached through the compile gate, so
// nothing links in a live frame. Identical on every graphics tier: the prints
// are actionable information.

import * as THREE from 'three';
import { FOOTPRINT_VIEW_CAP } from '../sim/stealth_footprints';
import type { VisibleFootprint } from '../world_api';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { attachSceneGroupGated } from './gated_scene_attach';
import { SUN_DIR } from './gfx';
import { sceneKeyLightUniform } from './scene_sampling';
import {
  FOOTPRINT_FADE_BUCKETS,
  FOOTPRINT_FADE_OPACITY,
  FOOTPRINT_HALF_LENGTH,
  FOOTPRINT_HALF_WIDTH,
  footprintCraterNormalInto,
  footprintPlacementInto,
  newFootprintPlacement,
} from './stealth_footprint_core';

/** How strongly the dent's shading departs from flat ground: the shadow side
 *  darkens the ground by this much per unit of lost light, the lit side
 *  brightens it less. */
const SHADE_GAIN = 1.6;
const LIGHT_GAIN = 0.7;
/** Rings and segments of the print's grid: enough for a smooth cup and lip. */
const RINGS = 10;
const SEGMENTS = 24;

const VERTEX = /* glsl */ `
varying vec3 vNormalW;
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
    m = modelMatrix * instanceMatrix;
  #endif
  vNormalW = normalize(mat3(m) * normal);
  gl_Position = projectionMatrix * viewMatrix * (m * vec4(position, 1.0));
}`;

// Light on the dent over light on flat ground: below 1 is shadow, above 1 is
// light-facing, and that ratio (eased by the gains and the fade) is the factor
// the ground's own colour is multiplied by; 1 leaves the ground untouched.
const FRAGMENT = /* glsl */ `
uniform vec3 uSunDir;
uniform float uOpacity;
varying vec3 vNormalW;
void main() {
  float flatLight = max(uSunDir.y, 0.15);
  float light = max(dot(normalize(vNormalW), uSunDir), 0.0) / flatLight;
  float d = light - 1.0;
  float k = d < 0.0 ? d * ${SHADE_GAIN.toFixed(2)} : d * ${LIGHT_GAIN.toFixed(2)};
  // The factor the ground under the print is multiplied by: below 1 in the
  // shade, above 1 in the light, 1 (untouched) where the dent is flat. Written
  // as half colour plus half alpha because the blend computes
  // ground * (colour + alpha), so a factor up to 2 fits in [0, 1] outputs.
  float f = mix(1.0, clamp(1.0 + k, 0.15, 1.85), uOpacity);
  gl_FragColor = vec4(vec3(f * 0.5), f * 0.5);
}`;

/** The print's flat grid at its real size, long axis +Z, with the dent's
 *  normals baked per vertex. */
function craterGeometry(): THREE.BufferGeometry {
  const positions: number[] = [0, 0, 0];
  const normals: number[] = [0, 1, 0];
  const n = { x: 0, y: 1, z: 0 };
  for (let ring = 1; ring <= RINGS; ring++) {
    const r = ring / RINGS;
    for (let seg = 0; seg < SEGMENTS; seg++) {
      const t = (seg / SEGMENTS) * Math.PI * 2;
      const u = Math.cos(t) * r;
      const v = Math.sin(t) * r;
      positions.push(u * FOOTPRINT_HALF_WIDTH, 0, v * FOOTPRINT_HALF_LENGTH);
      footprintCraterNormalInto(n, u, v);
      normals.push(n.x, n.y, n.z);
    }
  }
  const index: number[] = [];
  const at = (ring: number, seg: number) => 1 + (ring - 1) * SEGMENTS + (seg % SEGMENTS);
  for (let seg = 0; seg < SEGMENTS; seg++) index.push(0, at(1, seg + 1), at(1, seg));
  for (let ring = 1; ring < RINGS; ring++) {
    for (let seg = 0; seg < SEGMENTS; seg++) {
      const a = at(ring, seg);
      const b = at(ring, seg + 1);
      const c = at(ring + 1, seg);
      const d = at(ring + 1, seg + 1);
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setIndex(index);
  return g;
}
/** Lift above the surface so the oval never z-fights it. */
const FOOTPRINT_LIFT = 0.05;
/** The prints are information a player acts on, so they sit near the top of
 *  the player band: over the world's own marks and every class ground effect,
 *  under the click/AoE feedback rung and every encounter telegraph
 *  (docs/design/vfx-floor-layering.md). */
export const FOOTPRINT_RENDER_ORDER = floorVfxRenderOrder('player', 8);
const NO_PRINTS: readonly VisibleFootprint[] = Object.freeze([]);

export class StealthFootprintVisual {
  readonly group = new THREE.Group();
  readonly readyForEntry: Promise<void>;
  private readonly geometry = craterGeometry();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly counts = new Array<number>(FOOTPRINT_FADE_BUCKETS).fill(0);
  private readonly place = newFootprintPlacement();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private last: readonly VisibleFootprint[] | null = null;
  private disposed = false;

  constructor(
    scene: THREE.Object3D,
    private readonly groundAt: (x: number, z: number) => number,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
  ) {
    this.group.name = 'stealth-footprints';
    // The live key light the renderer moves with the day (one shared uniform
    // object); a bare test root has none, so it falls back to the fixed sun.
    const keyLight =
      scene instanceof THREE.Scene ? sceneKeyLightUniform(scene) : { value: SUN_DIR.clone() };
    for (let bucket = 0; bucket < FOOTPRINT_FADE_BUCKETS; bucket++) {
      const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          uSunDir: keyLight,
          uOpacity: { value: FOOTPRINT_FADE_OPACITY[bucket] },
        },
        transparent: true,
        depthWrite: false,
        // A multiply onto what is already drawn, so the dent is always the
        // ground's own colours, darker in the shade and lighter in the light:
        // ground * (src.rgb + src.a). The ground's alpha is left as it is.
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.DstColorFactor,
        blendDst: THREE.SrcAlphaFactor,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
      });
      // Named so a live-program or shader-warm audit entry maps back here; the
      // four differ only in opacity (a uniform), so they share one program.
      material.name = `stealth-footprints:fade-${bucket}`;
      const mesh = new THREE.InstancedMesh(this.geometry, material, FOOTPRINT_VIEW_CAP);
      mesh.name = `stealth-footprints-${bucket}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = FOOTPRINT_RENDER_ORDER;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    this.readyForEntry = attachSceneGroupGated(
      scene,
      this.group,
      compileGate,
      () => this.disposed,
    ).catch(() => {});
  }

  update(prints: readonly VisibleFootprint[] = NO_PRINTS): void {
    // Each snapshot (or offline frame with a trail) hands over a new list; an
    // unchanged list is the common, free case. A world that never received a
    // snapshot (a bare test world) reads as none.
    if (this.disposed || prints === this.last) return;
    this.last = prints;
    this.counts.fill(0);
    for (const print of prints) {
      const place = footprintPlacementInto(this.place, print);
      const mesh = this.meshes[place.bucket];
      const index = this.counts[place.bucket]++;
      if (index >= FOOTPRINT_VIEW_CAP) continue;
      // The print's own height (a bridge, a deck), or the ground under the
      // offset foot if that is higher (a slope).
      const y = Math.max(print.y, this.groundAt(place.x, place.z)) + FOOTPRINT_LIFT;
      this.position.set(place.x, y, place.z);
      this.rotation.setFromAxisAngle(this.up, place.yaw);
      mesh.setMatrixAt(index, this.matrix.compose(this.position, this.rotation, this.scale));
    }
    for (let bucket = 0; bucket < FOOTPRINT_FADE_BUCKETS; bucket++) {
      const mesh = this.meshes[bucket];
      const count = Math.min(this.counts[bucket], FOOTPRINT_VIEW_CAP);
      if (count === 0 && mesh.count === 0) continue;
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      // three computes an instanced mesh's sphere once and keeps it; the
      // transparent sort reads it, so it must follow the prints.
      if (count > 0) mesh.computeBoundingSphere();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.geometry.dispose();
    for (const mesh of this.meshes) {
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}
