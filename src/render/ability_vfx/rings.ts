import * as THREE from 'three';
import { drapeRingLocalY } from '../selection_ring';
import type { AbilityVfxTextures } from './fx_textures';

// Expanding shockwave rings, ported from the gallery's shock-ring shader
// (arc_bolt_preview.js). Fixed slot pool (the renderer's aoeRings idiom): one
// unit-plane clone and one material clone per slot at construction, nothing
// cloned or disposed per spawn. Ground rings lie on the terrain; vertical
// rings billboard the camera (impact halos).
//
// Slope fix (selection-ring idiom, see ground_auras.ts): a flat quad buries
// its uphill half on any slope, cutting the wavefront to a downhill arc. The
// plane is subdivided and each GROUND spawn drapes its vertices over the
// sampled terrain; position and scale are fixed for a ring's whole life (only
// the shader's uProgress animates), so the drape runs once per spawn - zero
// steady-state work. A vertical spawn flattens the plane back (only when the
// slot's previous life draped it) so the billboard stays planar.

const RING_SLOTS = 16;
// 8x8 subdivisions: enough interior vertices for the footprint to follow the
// terrain at the big shout radii without a meaningful raster cost.
const RING_SEGMENTS = 8;

const easeOutQuart = (t: number): number => 1 - (1 - t) ** 4;

interface RingSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  age: number;
  dur: number;
  vertical: boolean;
  active: boolean;
  draped: boolean; // this slot's geometry currently carries a terrain drape
  drapeZ: Float32Array; // scratch per-vertex drape heights, reused per spawn
}

export class ShockRings {
  private slots: RingSlot[] = [];
  private next = 0;
  // Center-relative ground-plane XZ of every vertex. The mesh lies flat via
  // rotation.x = -PI/2, which maps local (x, y, z) to world offsets
  // (x, z, -y): the plane's local X/Y span the ground (world Z = -local y)
  // and its local Z is the up-axis the drape writes. The cached pairs are
  // (x, -y) so drapeRingLocalY samples the right world spot directly.
  private localXZ: Float32Array;

  constructor(
    scene: THREE.Scene,
    tex: AbilityVfxTextures,
    private groundY: (x: number, z: number) => number,
  ) {
    const geo = new THREE.PlaneGeometry(1, 1, RING_SEGMENTS, RING_SEGMENTS);
    const basePos = geo.getAttribute('position') as THREE.BufferAttribute;
    this.localXZ = new Float32Array(basePos.count * 2);
    for (let i = 0; i < basePos.count; i++) {
      this.localXZ[i * 2] = basePos.getX(i);
      this.localXZ[i * 2 + 1] = -basePos.getY(i);
    }
    const proto = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 },
        uColor: { value: new THREE.Color() },
        uIntensity: { value: 1 },
        uNoise: { value: tex.noise },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uProgress;
        uniform vec3 uColor;
        uniform float uIntensity;
        uniform sampler2D uNoise;
        varying vec2 vUv;
        void main() {
          vec2 d2 = vUv - 0.5;
          float d = length(d2) * 2.0;
          float ang = atan(d2.y, d2.x + 1e-6); // guarded: atan(0,0) would NaN into bloom
          float band = smoothstep(uProgress - 0.32, uProgress - 0.06, d)
            * (1.0 - smoothstep(uProgress - 0.03, uProgress, d));
          float n = texture2D(uNoise, vec2(ang * 0.6366, d * 1.4 - uProgress * 0.35)).r;
          band *= smoothstep(0.18, 0.62, n + (1.0 - uProgress) * 0.45);
          // Softer decay than the original 1.35 pow: the wavefront stays
          // readable through the back half of its life (the front-loaded
          // easeOutQuart otherwise kills the band visually by ~40% age).
          float fade = pow(1.0 - uProgress, 1.05);
          vec3 col = uColor * uIntensity * (0.6 + 1.6 * band);
          gl_FragColor = vec4(col * band * fade, band * fade);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < RING_SLOTS; i++) {
      const mat = proto.clone();
      mat.uniforms.uNoise.value = tex.noise;
      // own geometry per slot: each ground spawn drapes it to that terrain
      const mesh = new THREE.Mesh(geo.clone(), mat);
      mesh.visible = false;
      mesh.renderOrder = 5;
      mesh.userData.renderCategory = 'vfx';
      // draped geometry: never let a stale bounding sphere cull it on slopes
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.slots.push({
        mesh,
        mat,
        age: 0,
        dur: 1,
        vertical: false,
        active: false,
        draped: false,
        drapeZ: new Float32Array(basePos.count),
      });
    }
    geo.dispose();
    proto.dispose();
  }

  spawn(
    x: number,
    y: number,
    z: number,
    maxR: number,
    dur: number,
    colorHex: number,
    intensity: number,
    vertical = false,
  ): void {
    const slot = this.slots[this.next];
    this.next = (this.next + 1) % RING_SLOTS;
    slot.active = true;
    slot.age = 0;
    slot.dur = dur;
    slot.vertical = vertical;
    (slot.mat.uniforms.uColor.value as THREE.Color).setHex(colorHex);
    slot.mat.uniforms.uIntensity.value = intensity;
    slot.mat.uniforms.uProgress.value = 0;
    slot.mesh.position.set(x, y, z);
    slot.mesh.rotation.set(vertical ? 0 : -Math.PI / 2, 0, 0);
    const scale = maxR * 2;
    slot.mesh.scale.setScalar(scale);
    const pos = slot.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (!vertical) {
      // Drape the footprint over the terrain so the wavefront survives on
      // slopes. The caller's y already carries its intended lift above the
      // center's ground height; recovering it keeps every vertex at that same
      // height above its own sampled terrain (flat ground reproduces the old
      // planar quad exactly). Local z is the up-axis under the -PI/2 tilt.
      const lift = y - this.groundY(x, z);
      drapeRingLocalY(this.localXZ, x, z, y, scale, lift, this.groundY, slot.drapeZ);
      for (let i = 0; i < slot.drapeZ.length; i++) pos.setZ(i, slot.drapeZ[i]);
      pos.needsUpdate = true;
      slot.draped = true;
    } else if (slot.draped) {
      // a billboard must be planar again after a previous ground life
      for (let i = 0; i < slot.drapeZ.length; i++) pos.setZ(i, 0);
      pos.needsUpdate = true;
      slot.draped = false;
    }
    slot.mesh.visible = true;
  }

  update(dt: number, camQuat: THREE.Quaternion): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      const t = Math.min(1, slot.age / slot.dur);
      slot.mat.uniforms.uProgress.value = easeOutQuart(t);
      if (slot.vertical) slot.mesh.quaternion.copy(camQuat);
      if (t >= 1) {
        slot.active = false;
        slot.mesh.visible = false;
      }
    }
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.active = false;
      slot.mesh.visible = false;
    }
  }
}
