import * as THREE from 'three';
import { drapeFanLocalY, drapeStrideFor, fanVertexSpacing } from '../drape_lod_core';
import type { AbilityVfxTextures } from './fx_textures';

// Fading ground decals (scorch embers, frost rime, arcane runes, earth
// cracks, charred sunbursts), ported from
// the gallery's dissolve decal shader (arc_bolt_preview.js, decals section):
// visible where noise > uDissolve, with a bright dissolve edge, so marks etch
// in and burn away instead of alpha-popping. Fixed slot pool, one circle
// geometry clone and one material clone per slot at construction; a spawn only
// rebinds the style's shared texture uniform.
//
// Slope fix (selection-ring idiom, see ground_auras.ts): a flat disc buries
// its uphill half on any slope, so each spawn drapes the disc's vertices over
// the sampled terrain plus a small lift. A decal never moves or rescales, so
// the drape runs exactly once per spawn - zero steady-state work. Those samples
// still thin with camera distance (../drape_lod_core): a far mark samples the
// rim more coarsely and interpolates between, keeping its world position and
// radius exactly as they were.

const DECAL_SLOTS = 12;
const DECAL_SEGMENTS = 24;
const DRAPE_LIFT = 0.06; // yards above the sampled ground, against z-fighting

export type DecalStyle = 'ember' | 'rime' | 'rune' | 'crack' | 'char';

interface DecalSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  age: number;
  dur: number;
  spin: number;
  active: boolean;
  drapeY: Float32Array; // scratch per-vertex drape heights, reused per spawn
}

export class GroundDecals {
  private slots: DecalSlot[] = [];
  private next = 0;
  private maps: Record<DecalStyle, THREE.CanvasTexture>;
  // center-relative XZ of every disc vertex (all slots clone the same base)
  private localXZ: Float32Array;
  // Latest camera position (pushed once a frame from the fx engine) and whether
  // one has ever arrived: before the first frame every drape stays exact.
  private camX = 0;
  private camZ = 0;
  private camKnown = false;

  constructor(
    scene: THREE.Scene,
    tex: AbilityVfxTextures,
    private groundY: (x: number, z: number) => number,
  ) {
    this.maps = {
      ember: tex.ember,
      rime: tex.rime,
      rune: tex.rune,
      crack: tex.crack,
      char: tex.char,
    };
    // Rotation baked into the geometry (instead of mesh.rotation.x) so the
    // position attribute's Y IS the up-axis the drape writes.
    const geo = new THREE.CircleGeometry(1, DECAL_SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const basePos = geo.getAttribute('position') as THREE.BufferAttribute;
    this.localXZ = new Float32Array(basePos.count * 2);
    for (let i = 0; i < basePos.count; i++) {
      this.localXZ[i * 2] = basePos.getX(i);
      this.localXZ[i * 2 + 1] = basePos.getZ(i);
    }
    const proto = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: tex.rune },
        uNoise: { value: tex.noise },
        uColor: { value: new THREE.Color() },
        uDissolve: { value: 1 },
        uHdr: { value: 1.6 },
        uSpin: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform sampler2D uNoise;
        uniform vec3 uColor;
        uniform float uDissolve;
        uniform float uHdr;
        uniform float uSpin;
        varying vec2 vUv;
        void main() {
          vec2 c = vUv - 0.5;
          float cs = cos(uSpin), sn = sin(uSpin);
          vec2 ruv = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + 0.5;
          vec4 tex = texture2D(uMap, ruv);
          float n = texture2D(uNoise, vUv * 2.3).r;
          float body = tex.a * smoothstep(uDissolve, uDissolve + 0.14, n);
          float edge = (smoothstep(uDissolve - 0.02, uDissolve + 0.04, n)
            - smoothstep(uDissolve + 0.08, uDissolve + 0.16, n)) * tex.a;
          vec3 col = tex.rgb * uColor * uHdr + vec3(0.92, 0.95, 1.0) * edge * uHdr * 2.0;
          gl_FragColor = vec4(col, clamp(body + edge, 0.0, 1.0));
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (let i = 0; i < DECAL_SLOTS; i++) {
      const mat = proto.clone();
      mat.uniforms.uNoise.value = tex.noise;
      // own geometry per slot: each spawn drapes it to that spot's terrain
      const mesh = new THREE.Mesh(geo.clone(), mat);
      mesh.visible = false;
      mesh.renderOrder = 3; // over terrain decals, under the shock rings
      mesh.userData.renderCategory = 'vfx';
      // draped geometry: never let a stale bounding sphere cull it on slopes
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.slots.push({
        mesh,
        mat,
        age: 0,
        dur: 3,
        spin: 0,
        active: false,
        drapeY: new Float32Array(basePos.count),
      });
    }
    geo.dispose();
    proto.dispose();
  }

  /** Where the camera is this frame, for the drape distance LOD. */
  setCameraPosition(x: number, z: number): void {
    this.camX = x;
    this.camZ = z;
    this.camKnown = true;
  }

  spawn(
    x: number,
    y: number,
    z: number,
    radius: number,
    colorHex: number,
    style: DecalStyle,
    dur: number,
  ): void {
    const slot = this.slots[this.next];
    this.next = (this.next + 1) % DECAL_SLOTS;
    slot.active = true;
    slot.age = 0;
    slot.dur = dur;
    slot.spin = style === 'rune' ? 0.35 : 0;
    slot.mat.uniforms.uMap.value = this.maps[style];
    (slot.mat.uniforms.uColor.value as THREE.Color).setHex(colorHex);
    slot.mat.uniforms.uDissolve.value = 1;
    slot.mat.uniforms.uSpin.value = 0;
    slot.mesh.position.set(x, y, z);
    slot.mesh.scale.setScalar(radius);
    // drape the disc over the terrain so no arc buries on a slope (the lift
    // dodges z-fighting the old flat +0.04 offset handled)
    const dx = x - this.camX;
    const dz = z - this.camZ;
    drapeFanLocalY(
      this.localXZ,
      x,
      z,
      y,
      radius,
      DRAPE_LIFT,
      this.groundY,
      slot.drapeY,
      // -1 reads as "unknown" to drapeStrideFor, which then drapes exactly. A
      // wide mark's rim vertices are already yards apart, so the spacing cap
      // there refuses to thin it at all.
      drapeStrideFor(
        this.camKnown ? dx * dx + dz * dz : -1,
        fanVertexSpacing(radius, DECAL_SEGMENTS),
      ),
    );
    const pos = slot.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < slot.drapeY.length; i++) pos.setY(i, slot.drapeY[i]);
    pos.needsUpdate = true;
    slot.mesh.visible = true;
  }

  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      const t = slot.age / slot.dur;
      if (t >= 1) {
        slot.active = false;
        slot.mesh.visible = false;
        continue;
      }
      // etch in over the first 18%, hold, then dissolve away over the last 45%
      const dissolve =
        t < 0.18 ? 1 - (t / 0.18) * 0.85 : t < 0.55 ? 0.15 : 0.15 + ((t - 0.55) / 0.45) * 0.85;
      slot.mat.uniforms.uDissolve.value = dissolve;
      if (slot.spin > 0) slot.mat.uniforms.uSpin.value = slot.age * slot.spin;
    }
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.active = false;
      slot.mesh.visible = false;
    }
  }
}
