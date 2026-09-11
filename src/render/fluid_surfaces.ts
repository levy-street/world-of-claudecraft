// Fluid pool surfaces (lava/acid/spectral/water): the visible ellipse surface
// for every 'fluid/<kind>' volume, plus per-pool ambience ? an attached point
// light (ranked into the shared fireLights budget), bubble/smoke particles
// through the pooled Vfx cloud, and a cheap haze disc. Geometry and placement
// derive from the SAME FluidVolume records the sim damage tick reads
// (sim/fluid_volumes.ts), so what burns you is what you see.
//
// Performance: one mesh (+ optional haze disc) per pool, a scrolling normal
// map animated by uniform offset only, particle emission distance-gated to
// pools near the camera and rate-scaled by footprint area with a hard cap.

import * as THREE from 'three';
import { getActiveWorldContent } from '../sim/data';
import {
  FLUID_FX_BUBBLES,
  FLUID_FX_HAZE,
  FLUID_FX_LIGHT,
  FLUID_FX_SMOKE,
} from '../sim/fluid_volumes';
import type { FluidVolume } from '../sim/types';
import { terrainHeight } from '../sim/world';
import { loadTexture } from './assets/loader';
import type { Vfx } from './vfx';

const SEGMENTS = 48;
const FX_RANGE = 90; // yards from camera before a pool's particles emit
const MAX_EMIT_RATE = 14; // per-pool particle cap (rate/sec at full quality)

// Domain-warped value-noise FBM, injected into the lava surface material so the
// bright orange veins churn and crawl (see applyLavaFlow). Kept dependency-free
// GLSL so it drops straight into the MeshStandardMaterial fragment shader.
const LAVA_NOISE_GLSL = `
float lavaHash(vec2 p){
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float lavaNoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = lavaHash(i);
  float b = lavaHash(i + vec2(1.0, 0.0));
  float c = lavaHash(i + vec2(0.0, 1.0));
  float d = lavaHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float lavaFbm(vec2 p){
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++){
    v += amp * lavaNoise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return v;
}
`;

interface PoolEntry {
  volume: FluidVolume;
  surfaceY: number;
  mesh: THREE.Mesh;
  haze: THREE.Mesh | null;
  light: THREE.PointLight | null;
  material: THREE.MeshStandardMaterial;
  emitRate: number;
  bubbleColor: number;
  smokeColor: number;
}

function surfaceColor(v: FluidVolume): THREE.Color {
  const h = (((v.hue % 360) + 360) % 360) / 360;
  return new THREE.Color().setHSL(
    h,
    v.kind === 'lava' ? 0.95 : 0.7,
    Math.min(0.85, Math.max(0.08, v.lum)),
  );
}

let normalTex: THREE.Texture | null = null;
function waterNormals(): THREE.Texture | null {
  if (normalTex) return normalTex;
  void loadTexture('/textures/water/waternormals.jpg', { srgb: false, repeat: true }).then((t) => {
    normalTex = t;
  });
  return normalTex;
}

export class FluidSurfaces {
  readonly group = new THREE.Group();
  /** Pool lights the renderer ranks into its shared point-light budget. */
  readonly lights: THREE.PointLight[] = [];
  private pools: PoolEntry[] = [];
  private time = 0;
  // Shared clock uniform handed to every lava pool's flow shader; advanced once
  // per frame in update() so all molten surfaces churn in step.
  private readonly lavaTime = { value: 0 };

  constructor(private readonly seed: number) {
    this.group.name = 'fluids';
    this.rebuild();
  }

  /** (Re)build every pool from `volumes` (the editor's live placement set)
   *  or, when omitted, the active world's fluids. Lights added on rebuild are
   *  picked up by the renderer's ranked budget each frame. */
  rebuild(volumes?: readonly FluidVolume[]): void {
    for (const p of this.pools) {
      this.group.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.material.dispose();
      if (p.haze) {
        this.group.remove(p.haze);
        p.haze.geometry.dispose();
        (p.haze.material as THREE.Material).dispose();
      }
      if (p.light) this.group.remove(p.light);
    }
    this.pools = [];
    this.lights.length = 0;
    const fluids = volumes ?? getActiveWorldContent().fluids;
    if (!fluids || fluids.length === 0) return;
    for (const v of fluids) this.pools.push(this.buildPool(v));
  }

  private buildPool(v: FluidVolume): PoolEntry {
    const surfaceY = terrainHeight(v.x, v.z, this.seed) + v.offsetY;
    const color = surfaceColor(v);
    const emissive = color.clone().multiplyScalar(v.glow);
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive,
      emissiveIntensity: v.glow > 0 ? 0.9 : 0,
      transparent: v.kind !== 'lava',
      opacity: v.kind === 'lava' ? 1 : v.kind === 'spectral' ? 0.72 : 0.82,
      roughness: v.kind === 'lava' ? 0.55 : 0.15,
      metalness: 0,
      depthWrite: v.kind === 'lava',
    });
    // Each pool clones the shared normals texture: offset scroll speed is
    // per-pool (lava crawls, water ripples), and THREE textures share the
    // underlying image so the clone costs nothing.
    const nm = waterNormals();
    if (nm) {
      material.normalMap = nm.clone();
      material.normalMap.needsUpdate = true;
      material.normalScale = new THREE.Vector2(0.6, 0.6);
    }
    // Lava gets an animated magma shader: the orange flows and the crust glows.
    if (v.kind === 'lava') {
      this.applyLavaFlow(material, color, new THREE.Vector2(v.halfX, v.halfZ));
    }
    const geo = new THREE.CircleGeometry(1, SEGMENTS).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, material);
    mesh.scale.set(v.halfX, 1, v.halfZ);
    mesh.rotation.y = v.rotY;
    mesh.position.set(v.x, surfaceY, v.z);
    mesh.renderOrder = 2;
    this.group.add(mesh);

    // Haze: a soft translucent dome-tinted disc floating just above the pool.
    let haze: THREE.Mesh | null = null;
    if (v.fx & FLUID_FX_HAZE) {
      const hazeMat = new THREE.MeshBasicMaterial({
        color: color.clone().offsetHSL(0, -0.25, 0.18),
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
      });
      haze = new THREE.Mesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), hazeMat);
      haze.scale.set(v.halfX * 1.05, 1, v.halfZ * 1.05);
      haze.rotation.y = v.rotY;
      haze.position.set(v.x, surfaceY + 0.9, v.z);
      haze.renderOrder = 3;
      this.group.add(haze);
    }

    let light: THREE.PointLight | null = null;
    if (v.fx & FLUID_FX_LIGHT) {
      const range = Math.min(48, Math.max(10, Math.max(v.halfX, v.halfZ) * 2.4));
      light = new THREE.PointLight(v.lightColor, v.lightIntensity, range, 1.8);
      light.position.set(v.x, surfaceY + 1.2, v.z);
      light.userData.baseIntensity = v.lightIntensity;
      light.userData.steady = v.kind !== 'lava'; // lava joins the fire flicker
      this.group.add(light);
      this.lights.push(light);
    }

    // Particle rate scales with footprint area, hard-capped per pool.
    const area = Math.PI * v.halfX * v.halfZ;
    const emitRate = Math.min(MAX_EMIT_RATE, 2 + area * 0.035);
    const bubbleColor = color.clone().offsetHSL(0, 0, 0.22).getHex();
    const smokeColor =
      v.kind === 'lava' ? 0x2c2320 : color.clone().offsetHSL(0, -0.3, -0.1).getHex();
    return { volume: v, surfaceY, mesh, haze, light, material, emitRate, bubbleColor, smokeColor };
  }

  /** Turn a lava pool's standard material into flowing magma: domain-warped FBM
   *  drives bright emissive veins that crawl over a dark crust, so the orange
   *  visibly moves. Vein/crust colors derive from the pool's tint; the shared
   *  `lavaTime` uniform (advanced in update) scrolls every lava pool together. */
  private applyLavaFlow(
    material: THREE.MeshStandardMaterial,
    base: THREE.Color,
    feat: THREE.Vector2,
  ): void {
    // We key the noise off vUv. three only emits that varying when a uv-mapped
    // feature is defined, and the normalMap loads async — so force USE_UV on to
    // guarantee vUv exists whether or not the normal map is present yet.
    material.defines = { ...(material.defines ?? {}), USE_UV: '' };
    // onBeforeCompile bypasses the default program cache key; give lava its own
    // (varying by normalMap presence, which flips when the texture streams in)
    // so pools never share a mismatched compiled program.
    material.customProgramCacheKey = () => `fluid-lava-flow:${material.normalMap ? 1 : 0}`;
    const hot = base.clone().offsetHSL(0.015, 0, 0.3); // white-hot vein
    const mid = base.clone().offsetHSL(0, 0, 0.06); // molten orange
    const cool = base.clone().offsetHSL(-0.03, -0.12, -0.42); // cooled crust
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uLavaTime = this.lavaTime;
      shader.uniforms.uLavaHot = { value: hot };
      shader.uniforms.uLavaMid = { value: mid };
      shader.uniforms.uLavaCool = { value: cool };
      shader.uniforms.uLavaFeat = { value: feat };
      shader.fragmentShader =
        `uniform float uLavaTime;
uniform vec3 uLavaHot;
uniform vec3 uLavaMid;
uniform vec3 uLavaCool;
uniform vec2 uLavaFeat;
${LAVA_NOISE_GLSL}
` +
        shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
{
  // Yard-space coordinate across the disc (vUv spans 0..1 over its bbox).
  vec2 lp = (vUv - 0.5) * 2.0 * uLavaFeat / 7.0;
  float t = uLavaTime * 0.09;
  // Domain warp: two FBM lookups shove the sample point so veins churn/flow.
  vec2 warp = vec2(lavaFbm(lp + vec2(0.0, t)), lavaFbm(lp + vec2(5.2, -t)));
  float n = lavaFbm(lp + warp * 1.35 + vec2(t * 0.6, t));
  float crust = smoothstep(0.22, 0.62, n);
  float veins = smoothstep(0.58, 0.9, n);
  vec3 lavaCol = mix(uLavaCool, uLavaMid, crust);
  lavaCol = mix(lavaCol, uLavaHot, veins);
  // Breathing pulse keyed off the noise so hotspots throb out of phase.
  float pulse = 0.85 + 0.15 * sin(uLavaTime * 1.6 + n * 6.2831);
  diffuseColor.rgb = mix(diffuseColor.rgb, lavaCol, 0.9);
  totalEmissiveRadiance = lavaCol * (0.45 + 1.5 * veins + 0.35 * crust) * pulse;
}`,
        );
    };
    material.needsUpdate = true;
  }

  /** Per-frame ambience: scroll the surface normals, bob the haze, and emit
   *  bubbles/smoke for pools near the camera. */
  update(dt: number, camX: number, camZ: number, vfx: Vfx | null): void {
    this.time += dt;
    this.lavaTime.value = this.time;
    const nm = waterNormals();
    for (const p of this.pools) {
      const v = p.volume;
      if (nm && !p.material.normalMap) {
        p.material.normalMap = nm.clone();
        p.material.normalMap.needsUpdate = true;
        p.material.normalScale = new THREE.Vector2(0.6, 0.6);
        p.material.needsUpdate = true;
      }
      // Lava crawls slowly; lighter fluids ripple a touch faster.
      const speed = v.kind === 'lava' ? 0.006 : 0.02;
      if (p.material.normalMap) {
        p.material.normalMap.offset.set(this.time * speed, this.time * speed * 1.3);
      }
      if (p.haze) {
        p.haze.position.y = p.surfaceY + 0.9 + Math.sin(this.time * 0.6) * 0.12;
        (p.haze.material as THREE.MeshBasicMaterial).opacity =
          0.11 + 0.05 * (0.5 + 0.5 * Math.sin(this.time * 0.9));
      }
      if (!vfx) continue;
      const dx = v.x - camX;
      const dz = v.z - camZ;
      if (dx * dx + dz * dz > FX_RANGE * FX_RANGE) continue;
      // Random point inside the (rotated) ellipse footprint.
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random());
      const lx = Math.cos(a) * r * v.halfX;
      const lz = Math.sin(a) * r * v.halfZ;
      const c = Math.cos(-v.rotY);
      const s = Math.sin(-v.rotY);
      const px = v.x + lx * c - lz * s;
      const pz = v.z + lx * s + lz * c;
      if (v.fx & FLUID_FX_BUBBLES)
        vfx.fluidBubble(px, p.surfaceY, pz, p.bubbleColor, dt, p.emitRate);
      if (v.fx & FLUID_FX_SMOKE)
        vfx.fluidSmoke(px, p.surfaceY, pz, p.smokeColor, dt, p.emitRate * 0.5);
      // Lava always sheds heat: rising embers and shimmering hot air.
      if (v.kind === 'lava') vfx.fluidHeat(px, p.surfaceY, pz, dt, p.emitRate);
    }
  }
}
