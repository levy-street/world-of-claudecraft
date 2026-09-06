import * as THREE from 'three';
import { drapeFanLocalY, drapeStrideFor, fanVertexSpacing } from '../drape_lod_core';
import { drapedBoundingSphere, drapeExtent } from '../draped_bounds_core';
import type { VfxAnchorResolver } from '../vfx_anchor';
import { DRAPE_AXIS_Y, DRAPED_VERTEX_SHADER } from './draped_shader';
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
// wearer moved or the breath rescaled the disc.
//
// The drape is its own SINGLE-FLOAT attribute (`aDrape`, added to the disc's
// local up-axis in the vertex shader), not a rewrite of the position buffer.
// Three things follow from that. The nine slot geometries share ONE position,
// uv and index buffer instead of cloning the disc nine times. A re-drape
// uploads 42 floats through one update range instead of re-uploading the whole
// 126-float position buffer with no range, which a moving wearer paid every
// frame, per band. And because the flat shape is now permanent, the bounding
// sphere is a closed form of it (../draped_bounds_core), so these discs are
// frustum-CULLED again rather than opted out of culling against a sphere the
// drape would have made stale.
//
// One material for the family, too: the per-slot colour, opacity, spin and
// annulus shape are pushed through onBeforeRender (three re-uploads a
// ShaderMaterial's uniforms whenever uniformsNeedUpdate is set, whatever the
// material-change check decided), so nine cloned materials, nine program
// lookups and nine material-state switches collapse to one.
//
// Bands: band 0 is the primary disc (~1.3 yd); each further concurrent buff
// wears a thinner concentric ring stepped +0.25 yd out. A fourth+ buff maps
// onto the outermost band, whose hue blends toward the newcomer.

const AURA_SLOTS = 9;
const AURA_SEGMENTS = 40;
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
// still and the breath scale drift stays small. The scale threshold is
// RELATIVE, and deliberately wider than the breath's own peak-to-peak swing
// (+-5% at 0.4 Hz): under the old absolute 0.02 yard threshold a character
// standing perfectly still re-draped all 42 vertices several times a second,
// forever, per band, to correct heights by (drift x radius x slope), which is
// centimetres on anything walkable. Now the drape settles once the disc has
// finished growing in and the breath rides it. Movement still re-drapes at a
// centimetre, because that IS real new terrain under the disc.
const DRAPE_MOVE_EPS = 0.01;
const DRAPE_SCALE_REL_EPS = 0.12;

interface AuraSlot {
  mesh: THREE.Mesh;
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
  // Per-slot shader state, pushed into the SHARED material by onBeforeRender.
  color: THREE.Color;
  opacity: number;
  spinPhase: number;
  shape: THREE.Vector4;
  // The live drape attribute (one float per vertex, added to the disc's local
  // up-axis in the vertex shader) + the anchor the current drape was computed
  // for (Infinity = never draped since activation)
  drape: THREE.BufferAttribute;
  drapeY: Float32Array;
  drapeX: number;
  drapeZ: number;
  drapeScale: number;
}

const colorScratch = new THREE.Color();
// Per-frame anchor scratch (see ../vfx_anchor.ts): update() resolves the wearer
// once per live band and consumes the reading inside that iteration.
const anchorScratch = new THREE.Vector3();

export class GroundAuras {
  private slots: AuraSlot[] = [];
  private disposed = false;
  // center-relative XZ of every disc vertex (all slots share the same base)
  private localXZ: Float32Array;
  private readonly baseGeometry: THREE.CircleGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, tex: AbilityVfxTextures) {
    // Rotation is baked into the geometry (instead of mesh.rotation.x) so the
    // local Y IS the up-axis the drape attribute displaces along.
    const geo = new THREE.CircleGeometry(1, AURA_SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    this.baseGeometry = geo;
    const basePos = geo.getAttribute('position') as THREE.BufferAttribute;
    this.localXZ = new Float32Array(basePos.count * 2);
    for (let i = 0; i < basePos.count; i++) {
      this.localXZ[i * 2] = basePos.getX(i);
      this.localXZ[i * 2 + 1] = basePos.getZ(i);
    }
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uNoise: { value: tex.noise },
        uColor: { value: new THREE.Color() },
        uOpacity: { value: 0 },
        uSpin: { value: 0 },
        uShape: { value: new THREE.Vector4(0.3, 0.62, 0.78, 0.97) },
        uDrapeAxis: { value: DRAPE_AXIS_Y },
      },
      vertexShader: DRAPED_VERTEX_SHADER,
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
          float a = band * uOpacity * (0.7 + 0.6 * n);
          // An annulus is mostly hole: early-out below the additive floor
          // rather than blend a transparent fragment the bloom re-reads
          // (../vfx.ts / overlay_sprites.ts idiom, depth writes already off).
          if (a < 0.004) discard;
          vec3 col = uColor * (1.2 + 0.8 * n);
          gl_FragColor = vec4(col, a);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (let i = 0; i < AURA_SLOTS; i++) {
      // The slot geometry SHARES the base disc's position, uv and index
      // buffers and owns only its own drape column.
      const slotGeo = new THREE.BufferGeometry();
      slotGeo.setAttribute('position', basePos);
      const baseUv = geo.getAttribute('uv');
      if (baseUv) slotGeo.setAttribute('uv', baseUv);
      slotGeo.setIndex(geo.getIndex());
      const drapeY = new Float32Array(basePos.count);
      const drape = new THREE.BufferAttribute(drapeY, 1).setUsage(THREE.DynamicDrawUsage);
      slotGeo.setAttribute('aDrape', drape);
      slotGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
      const slot: AuraSlot = {
        mesh: new THREE.Mesh(slotGeo, this.material),
        entityId: -1,
        band: 0,
        age: 0,
        release: 0,
        stamp: 0,
        spin: false,
        phase: 0,
        active: false,
        color: new THREE.Color(),
        opacity: 0,
        spinPhase: 0,
        shape: new THREE.Vector4(0.3, 0.62, 0.78, 0.97),
        drape,
        drapeY,
        drapeX: Number.POSITIVE_INFINITY,
        drapeZ: Number.POSITIVE_INFINITY,
        drapeScale: Number.POSITIVE_INFINITY,
      };
      const mesh = slot.mesh;
      mesh.visible = false;
      mesh.renderOrder = 4; // over ground decals (3), under the shock rings (5)
      mesh.userData.renderCategory = 'vfx';
      // Culled again: the flat disc is permanent now, and the sphere is
      // refreshed from the drape extent at every re-drape (see drapeInto).
      mesh.frustumCulled = true;
      // One material for the family: three uploads a ShaderMaterial's uniforms
      // whenever uniformsNeedUpdate is set, whatever its material-change check
      // decided, so each slot writes its own state here right before its draw.
      mesh.onBeforeRender = () => {
        const uniforms = this.material.uniforms;
        (uniforms.uColor.value as THREE.Color).copy(slot.color);
        uniforms.uOpacity.value = slot.opacity;
        uniforms.uSpin.value = slot.spinPhase;
        (uniforms.uShape.value as THREE.Vector4).copy(slot.shape);
        this.material.uniformsNeedUpdate = true;
      };
      scene.add(mesh);
      this.slots.push(slot);
    }
  }

  /** Re-sample this slot's drape, upload only the column, and refresh the
   *  bounding sphere the frustum test now reads. */
  private drapeInto(
    slot: AuraSlot,
    x: number,
    z: number,
    baseY: number,
    scale: number,
    groundY: (gx: number, gz: number) => number,
    stride: number,
  ): void {
    drapeFanLocalY(
      this.localXZ,
      x,
      z,
      baseY,
      scale,
      DRAPE_LIFT + slot.band * BAND_LIFT_STEP,
      groundY,
      slot.drapeY,
      stride,
    );
    slot.drape.clearUpdateRanges();
    slot.drape.addUpdateRange(0, slot.drapeY.length);
    slot.drape.needsUpdate = true;
    const [low, high] = drapeExtent(slot.drapeY);
    const bounds = drapedBoundingSphere(1, low, high);
    const sphere = slot.mesh.geometry.boundingSphere as THREE.Sphere;
    sphere.center.set(0, bounds.center, 0);
    sphere.radius = bounds.radius;
  }

  // Hold one band open this frame. Returns true when this call CREATED the
  // band (the aura-gain moment), so the painter can pop the gain swirl. A
  // second hold on the same band in the same frame (a 4th+ concurrent buff
  // overflowing onto the outermost ring) blends the band's hue toward the
  // newcomer instead of stealing the slot.
  hold(entityId: number, band: number, colorHex: number, spin: boolean, frame: number): boolean {
    if (this.disposed) return false;
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
        slot.color.lerp(colorScratch.setHex(colorHex), 0.5);
      } else {
        slot.color.setHex(colorHex);
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
    slot.color.setHex(colorHex);
    slot.shape.fromArray(BAND_SHAPE[b]);
    slot.opacity = 0;
    slot.mesh.visible = true;
    return true;
  }

  update(
    dt: number,
    time: number,
    frame: number,
    anchor: VfxAnchorResolver,
    groundY: (x: number, z: number) => number,
    camX?: number,
    camZ?: number,
  ): void {
    if (this.disposed) return;
    const camKnown = camX !== undefined && camZ !== undefined;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      if (slot.release === Number.POSITIVE_INFINITY && slot.stamp !== frame) {
        // the aura dropped: release as a short fade
        slot.release = slot.age + FADE_OUT;
      }
      slot.age += dt;
      const at = slot.age < slot.release ? anchor(slot.entityId, 0, anchorScratch) : null;
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
        Math.abs(scale - slot.drapeScale) > slot.drapeScale * DRAPE_SCALE_REL_EPS
      ) {
        slot.drapeX = at.x;
        slot.drapeZ = at.z;
        slot.drapeScale = scale;
        // A moving buffed character re-drapes every frame, per band: thin the
        // sampling with camera distance (../drape_lod_core). Only the vertical
        // fidelity of a faint cosmetic annulus changes; where it sits does not.
        const dx = at.x - (camX ?? 0);
        const dz = at.z - (camZ ?? 0);
        this.drapeInto(
          slot,
          at.x,
          at.z,
          baseY,
          scale,
          groundY,
          drapeStrideFor(camKnown ? dx * dx + dz * dz : -1, fanVertexSpacing(scale, AURA_SEGMENTS)),
        );
      }
      slot.opacity = BAND_OPACITY[slot.band] * growEase * fade * (0.85 + 0.15 * breath);
      slot.spinPhase = slot.spin ? time * SPIN_RATE + slot.phase : slot.phase;
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    for (const slot of this.slots) {
      slot.mesh.onBeforeRender = () => {};
      slot.mesh.removeFromParent();
      slot.mesh.geometry.dispose();
    }
    // The slot geometries share the base disc's buffers, so the base owns the
    // release; the family shares one material, so it is disposed once.
    this.baseGeometry.dispose();
    this.material.dispose();
  }
}
