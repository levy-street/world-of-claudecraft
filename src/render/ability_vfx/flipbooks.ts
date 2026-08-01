import * as THREE from 'three';
import { FLIPBOOK_GRID, FLIPBOOK_STYLES, type FlipbookStyle, flipbookSheet } from './fx_textures';

// Camera-facing impact flipbooks, ported from the gallery's spawnFlipbook /
// updateFlipbooks (arc_bolt_preview.js): one additive quad stepping an 8x8
// per-school explosion sheet over its life, cross-fading adjacent frames in
// the shader. The hero of every big impact (fireball, pyroblast, meteor,
// execute), tier-0-only spectacle, fired by the sequencer's impact hook.
// Fixed slot pool: one shared unit plane, one material clone per slot at
// construction; a spawn only rebinds the style's cached sheet uniform.

const FLIP_SLOTS = 6;
// Sheet life: the gallery impact sheet runs 0.5s; a touch longer holds the
// hot frame through the measured aftermath window without a third sheet.
const FLIP_DUR = 0.55;
const LAST_FRAME = FLIPBOOK_GRID * FLIPBOOK_GRID - 1;

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

interface FlipSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  age: number;
  size: number;
  active: boolean;
}

export function asFlipbookStyle(s: string): FlipbookStyle {
  return (FLIPBOOK_STYLES as readonly string[]).includes(s) ? (s as FlipbookStyle) : 'electric';
}

export class ImpactFlipbooks {
  private slots: FlipSlot[] = [];
  private next = 0;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const proto = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: null },
        uFrame: { value: 0 },
        uOpacity: { value: 1 },
        uTint: { value: new THREE.Color(1, 1, 1) },
        uHdr: { value: 1 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform float uFrame;
        uniform float uOpacity;
        uniform vec3 uTint;
        uniform float uHdr;
        varying vec2 vUv;
        vec4 cell(float f) {
          f = clamp(f, 0.0, 63.0);
          float col = mod(f, 8.0);
          float row = floor(f / 8.0);
          vec2 uv = (vUv + vec2(col, 7.0 - row)) / 8.0;
          return texture2D(uMap, uv);
        }
        void main() {
          float fi = floor(uFrame);
          vec4 a = cell(fi);
          vec4 b = cell(fi + 1.0);
          vec4 s = mix(a, b, fract(uFrame));
          gl_FragColor = vec4(s.rgb * uTint * uHdr, s.a) * uOpacity;
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (let i = 0; i < FLIP_SLOTS; i++) {
      const mat = proto.clone();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 8; // over the shock rings: the sheet IS the impact
      mesh.userData.renderCategory = 'vfx';
      scene.add(mesh);
      this.slots.push({ mesh, mat, age: 0, size: 1, active: false });
    }
    proto.dispose();
  }

  spawn(
    x: number,
    y: number,
    z: number,
    size: number,
    colorHex: number,
    hdr: number,
    style: FlipbookStyle,
  ): void {
    const slot = this.slots[this.next];
    this.next = (this.next + 1) % FLIP_SLOTS;
    slot.active = true;
    slot.age = 0;
    slot.size = size;
    slot.mat.uniforms.uMap.value = flipbookSheet(style);
    (slot.mat.uniforms.uTint.value as THREE.Color).setHex(colorHex);
    slot.mat.uniforms.uHdr.value = hdr;
    slot.mat.uniforms.uFrame.value = 0;
    slot.mat.uniforms.uOpacity.value = 1;
    slot.mesh.position.set(x, y, z);
    slot.mesh.scale.setScalar(size * 0.65);
    slot.mesh.visible = true;
  }

  // Boot-only: build every cached sheet and bind one per slot (FLIP_SLOTS
  // matches the style count), so the prewarm's texture walk uploads all six
  // and the compile pass links the shader before the first real impact.
  prewarm(x: number, y: number, z: number): void {
    for (const style of FLIPBOOK_STYLES) this.spawn(x, y, z, 1, 0xffffff, 1, style);
  }

  update(dt: number, camQuat: THREE.Quaternion): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      const t = Math.min(1, slot.age / FLIP_DUR);
      slot.mat.uniforms.uFrame.value = t * LAST_FRAME;
      slot.mat.uniforms.uOpacity.value = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      slot.mesh.scale.setScalar(slot.size * (0.65 + 0.55 * easeOutCubic(t)));
      slot.mesh.quaternion.copy(camQuat);
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
