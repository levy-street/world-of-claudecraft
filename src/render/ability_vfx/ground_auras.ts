import * as THREE from 'three';
import { drapeRingLocalY } from '../selection_ring';
import type { AbilityVfxTextures } from './fx_textures';

// Soft additive ground annuli at a buffed character's feet: the DEFAULT read
// for a held buff aura (the whole-rig emissive tint is reserved for cast
// windups, morph/ultimate rims, and brief application pulses). Rendering
// follows the decal idiom (circle at the feet, additive, noise-shimmered
// shader) while the lifecycle follows the shell idiom (per-entity
// find-or-allocate, frame-stamped hold each frame the aura lives, un-stamped
// slots auto-release as a short fade). Fixed slot pool, one geometry clone and
// one material clone per slot at construction; zero steady-state allocation.
//
// Slope fix: a flat disc at foot height sinks into the uphill side of any
// slope, so part of the annulus is always cut off there. The discs follow the
// selection-ring idiom instead (drapeRingLocalY): every vertex rides its own
// sampled ground height plus a small lift, re-draped in place only when the
// wearer moved or the breath rescaled the disc. The per-slot geometry clones
// and scratch drape arrays exist so the deform never touches a shared buffer.
//
// Bands: band 0 is the primary disc (~1.3 yd); each further concurrent buff
// wears a thinner concentric ring stepped +0.25 yd out. A fourth+ buff maps
// onto the outermost band, whose hue blends toward the newcomer.

const AURA_SLOTS = 9;
export const GROUND_AURA_BANDS = 3;
const BAND_RADIUS = [1.3, 1.55, 1.8];
// Peak additive opacity: noticeable when you look, invisible when you fight.
const BAND_OPACITY = [0.18, 0.2, 0.2];
// Annulus mask stops (smoothstep in/out over normalized radius): the primary
// band is a wide soft ring, the stacked bands are thin outlines.
const BAND_SHAPE: [number, number, number, number][] = [
  [0.3, 0.62, 0.78, 0.97],
  [0.72, 0.86, 0.9, 0.99],
  [0.72, 0.86, 0.9, 0.99],
];
const GROW_IN = 0.4;
const FADE_OUT = 0.5;
const BREATH_HZ = 0.4;
const SPIN_RATE = 0.25;
// Per-vertex height above the sampled terrain (the selection ring's 0.08
// anti-z-fight distance), stepped slightly per band so stacked rings never
// coincide exactly.
const DRAPE_LIFT = 0.08;
const BAND_LIFT_STEP = 0.015;
// Re-drape thresholds: skip the per-vertex resample while the wearer stands
// still and the breath scale drift stays under ~1.5% (the residual height
// error at that drift is millimeters).
const DRAPE_MOVE_EPS = 0.01;
const DRAPE_SCALE_EPS = 0.02;

interface AuraSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  entityId: number;
  band: number;
  age: number;
  // Infinity = held open by a live aura (refreshed by stamp each frame);
  // finite = releasing, deactivates when age passes it
  release: number;
  stamp: number;
  spin: boolean;
  phase: number;
  active: boolean;
  // scratch drape Y (one float per vertex, reused) + the anchor the current
  // drape was computed for (Infinity = never draped since activation)
  drapeY: Float32Array;
  drapeX: number;
  drapeZ: number;
  drapeScale: number;
}

const colorScratch = new THREE.Color();

export class GroundAuras {
  private slots: AuraSlot[] = [];
  // center-relative XZ of every disc vertex (all slots clone the same base)
  private localXZ: Float32Array;

  constructor(scene: THREE.Scene, tex: AbilityVfxTextures) {
    // Rotation is baked into the geometry (instead of mesh.rotation.x) so the
    // position attribute's Y IS the up-axis the drape writes.
    const geo = new THREE.CircleGeometry(1, 40);
    geo.rotateX(-Math.PI / 2);
    const basePos = geo.getAttribute('position') as THREE.BufferAttribute;
    this.localXZ = new Float32Array(basePos.count * 2);
    for (let i = 0; i < basePos.count; i++) {
      this.localXZ[i * 2] = basePos.getX(i);
      this.localXZ[i * 2 + 1] = basePos.getZ(i);
    }
    const proto = new THREE.ShaderMaterial({
      uniforms: {
        uNoise: { value: tex.noise },
        uColor: { value: new THREE.Color() },
        uOpacity: { value: 0 },
        uSpin: { value: 0 },
        uShape: { value: new THREE.Vector4(0.3, 0.62, 0.78, 0.97) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D uNoise;
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform float uSpin;
        uniform vec4 uShape;
        varying vec2 vUv;
        void main() {
          vec2 c = vUv - 0.5;
          float r = length(c) * 2.0;
          float band = smoothstep(uShape.x, uShape.y, r)
            * (1.0 - smoothstep(uShape.z, uShape.w, r));
          float cs = cos(uSpin), sn = sin(uSpin);
          vec2 ruv = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + 0.5;
          float n = texture2D(uNoise, ruv * 1.6).r;
          vec3 col = uColor * (1.2 + 0.8 * n);
          gl_FragColor = vec4(col, band * uOpacity * (0.7 + 0.6 * n));
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (let i = 0; i < AURA_SLOTS; i++) {
      const mat = proto.clone();
      mat.uniforms.uNoise.value = tex.noise;
      // own geometry per slot: the drape deforms it to this slot's terrain
      const mesh = new THREE.Mesh(geo.clone(), mat);
      mesh.visible = false;
      mesh.renderOrder = 4; // over ground decals (3), under the shock rings (5)
      mesh.userData.renderCategory = 'vfx';
      // the drape deforms the geometry every re-anchor; a stale bounding
      // sphere must never cull it on steep slopes (selection-ring precedent)
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.slots.push({
        mesh,
        mat,
        entityId: -1,
        band: 0,
        age: 0,
        release: 0,
        stamp: 0,
        spin: false,
        phase: 0,
        active: false,
        drapeY: new Float32Array(basePos.count),
        drapeX: Number.POSITIVE_INFINITY,
        drapeZ: Number.POSITIVE_INFINITY,
        drapeScale: Number.POSITIVE_INFINITY,
      });
    }
    geo.dispose();
    proto.dispose();
  }

  // Hold one band open this frame. Returns true when this call CREATED the
  // band (the aura-gain moment), so the painter can pop the gain swirl. A
  // second hold on the same band in the same frame (a 4th+ concurrent buff
  // overflowing onto the outermost ring) blends the band's hue toward the
  // newcomer instead of stealing the slot.
  hold(entityId: number, band: number, colorHex: number, spin: boolean, frame: number): boolean {
    const b = Math.min(GROUND_AURA_BANDS - 1, Math.max(0, band));
    let slot: AuraSlot | undefined;
    for (const s of this.slots) {
      if (s.active && s.entityId === entityId && s.band === b) {
        slot = s;
        break;
      }
    }
    if (slot) {
      if (slot.stamp === frame) {
        (slot.mat.uniforms.uColor.value as THREE.Color).lerp(colorScratch.setHex(colorHex), 0.5);
      } else {
        (slot.mat.uniforms.uColor.value as THREE.Color).setHex(colorHex);
        slot.spin = spin;
        slot.release = Number.POSITIVE_INFINITY; // resume if it was fading out
      }
      slot.stamp = frame;
      return false;
    }
    slot = this.slots.find((s) => !s.active);
    if (!slot) return false;
    slot.active = true;
    slot.entityId = entityId;
    slot.band = b;
    slot.age = 0;
    slot.release = Number.POSITIVE_INFINITY;
    slot.stamp = frame;
    slot.spin = spin;
    slot.drapeX = Number.POSITIVE_INFINITY; // force a fresh drape on first update
    slot.phase = ((entityId * 2654435761 + b * 97) % 628) / 100;
    (slot.mat.uniforms.uColor.value as THREE.Color).setHex(colorHex);
    (slot.mat.uniforms.uShape.value as THREE.Vector4).fromArray(BAND_SHAPE[b]);
    slot.mat.uniforms.uOpacity.value = 0;
    slot.mesh.visible = true;
    return true;
  }

  update(
    dt: number,
    time: number,
    frame: number,
    anchor: (id: number, frac: number) => { x: number; y: number; z: number } | null,
    groundY: (x: number, z: number) => number,
  ): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      if (slot.release === Number.POSITIVE_INFINITY && slot.stamp !== frame) {
        // the aura dropped: release as a short fade
        slot.release = slot.age + FADE_OUT;
      }
      slot.age += dt;
      const at = slot.age < slot.release ? anchor(slot.entityId, 0) : null;
      if (!at || slot.age >= slot.release) {
        slot.active = false;
        slot.mesh.visible = false;
        continue;
      }
      const grow = Math.min(1, slot.age / GROW_IN);
      const growEase = grow * grow * (3 - 2 * grow);
      const fade =
        slot.release === Number.POSITIVE_INFINITY
          ? 1
          : Math.min(1, Math.max(0, (slot.release - slot.age) / FADE_OUT));
      const breath = Math.sin(2 * Math.PI * BREATH_HZ * time + slot.phase);
      const scale = BAND_RADIUS[slot.band] * (0.85 + 0.15 * growEase) * (1 + 0.05 * breath);
      const baseY = groundY(at.x, at.z);
      slot.mesh.position.set(at.x, baseY, at.z);
      slot.mesh.scale.setScalar(scale);
      // Drape the disc over the terrain (see the header): re-sample only when
      // the wearer moved or the scale drifted past the epsilons, so a
      // standing character costs nothing between breath steps.
      if (
        Math.abs(at.x - slot.drapeX) > DRAPE_MOVE_EPS ||
        Math.abs(at.z - slot.drapeZ) > DRAPE_MOVE_EPS ||
        Math.abs(scale - slot.drapeScale) > DRAPE_SCALE_EPS
      ) {
        slot.drapeX = at.x;
        slot.drapeZ = at.z;
        slot.drapeScale = scale;
        drapeRingLocalY(
          this.localXZ,
          at.x,
          at.z,
          baseY,
          scale,
          DRAPE_LIFT + slot.band * BAND_LIFT_STEP,
          groundY,
          slot.drapeY,
        );
        const pos = slot.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < slot.drapeY.length; i++) pos.setY(i, slot.drapeY[i]);
        pos.needsUpdate = true;
      }
      slot.mat.uniforms.uOpacity.value =
        BAND_OPACITY[slot.band] * growEase * fade * (0.85 + 0.15 * breath);
      slot.mat.uniforms.uSpin.value = slot.spin ? time * SPIN_RATE + slot.phase : slot.phase;
    }
  }

  // Dev probe: how many bands are currently HELD open for one entity
  // (releasing fades don't count).
  countOf(entityId: number): number {
    let n = 0;
    for (const s of this.slots) {
      if (s.active && s.entityId === entityId && s.release === Number.POSITIVE_INFINITY) n++;
    }
    return n;
  }

  sleepEntity(entityId: number): void {
    for (const slot of this.slots) {
      if (!slot.active || slot.entityId !== entityId) continue;
      slot.active = false;
      slot.mesh.visible = false;
    }
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.active = false;
      slot.mesh.visible = false;
    }
  }
}
