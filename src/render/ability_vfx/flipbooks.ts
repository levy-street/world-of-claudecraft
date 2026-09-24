import * as THREE from 'three';
import { boundQuadSize, IMPACT_QUAD_MAX_SCREEN_FRACTION } from '../vfx_screen_bounds_core';
import { type ContactSheet, contactTexture, isContactSheet } from './contact_assets';
import { FLIPBOOK_GRID, FLIPBOOK_STYLES, type FlipbookStyle, flipbookSheet } from './fx_textures';
import {
  WARRIOR_FLASH_GLSL,
  WARRIOR_IMPACT_REACH,
  type WarriorFlashStyle,
  warriorFlashStyle,
} from './warrior_flash';

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
  duration: number;
  rotation: number;
  aspect: number;
  size: number;
  worldDirected: boolean;
  strikeAxis: THREE.Vector3;
  projectedRoll: number;
  active: boolean;
}

export function asFlipbookStyle(s: string): FlipbookStyle {
  return (FLIPBOOK_STYLES as readonly string[]).includes(s) ? (s as FlipbookStyle) : 'electric';
}

export class ImpactFlipbooks {
  private slots: FlipSlot[] = [];
  private next = 0;
  private readonly geometry: THREE.PlaneGeometry;
  private disposed = false;
  private readonly cameraInverse = new THREE.Quaternion();
  private readonly projectedStrike = new THREE.Vector3();
  private readonly projectedDown = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.geometry = new THREE.PlaneGeometry(1, 1);
    const proto = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: null },
        uFrame: { value: 0 },
        uOpacity: { value: 1 },
        uTint: { value: new THREE.Color(1, 1, 1) },
        uHdr: { value: 1 },
        uInset: { value: 0 },
        uWarriorStyle: { value: 0 },
        uWarriorPhase: { value: 0 },
        uWarriorDown: { value: new THREE.Vector2(0, -1) },
        uLowRangeTarget: { value: 1 },
        uWarriorFloor: { value: -1e6 },
        uWarriorFloorBlend: { value: 0.85 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying float vWorldY;
        void main() {
          vUv = uv;
          vWorldY = (modelMatrix * vec4(position, 1.0)).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        ${WARRIOR_FLASH_GLSL}
        uniform sampler2D uMap;
        uniform float uFrame;
        uniform float uOpacity;
        uniform vec3 uTint;
        uniform float uHdr;
        uniform float uInset;
        uniform float uLowRangeTarget;
        varying vec2 vUv;
        varying float vWorldY;
        uniform float uWarriorFloor;
        uniform float uWarriorFloorBlend;
        vec4 cell(float f) {
          f = clamp(f, 0.0, 63.0);
          float col = mod(f, 8.0);
          float row = floor(f / 8.0);
          vec2 uv = (clamp(vUv, vec2(uInset), vec2(1.0-uInset)) + vec2(col, 7.0 - row)) / 8.0;
          return texture2D(uMap, uv);
        }
        void main() {
          if (uWarriorStyle > .5) {
            gl_FragColor = warriorFlash(vUv, uWarriorPhase, uTint, uHdr) * uOpacity;
            float floorFade = smoothstep(uWarriorFloor + .03, uWarriorFloor + uWarriorFloorBlend, vWorldY);
            gl_FragColor.rgb *= floorFade;
            if (uWarriorStyle > 1.5 && uWarriorStyle < 2.5) gl_FragColor.a *= floorFade;
          } else {
            float fi = floor(uFrame);
            vec4 a = cell(fi);
            vec4 b = cell(fi + 1.0);
            vec4 s = mix(a, b, fract(uFrame));
            gl_FragColor = vec4(s.rgb * uTint * uHdr, s.a) * uOpacity;
          }
          if (uWarriorStyle > .5 || uInset > 0.) {
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          } else if (gl_FragColor.a < .004) discard;
          // Preserve the previous source-alpha additive RGB for ordinary
          // effects, using one fixed blend state prepared before any cast.
          if (uWarriorStyle < 1.5 || uWarriorStyle > 2.5) {
            // Fixed-point targets clamp a source before hardware blending.
            // Preserve that ordering on the non-HDR quality paths as well.
            if (uLowRangeTarget > .5) gl_FragColor.rgb = clamp(gl_FragColor.rgb, 0., 1.);
            gl_FragColor.rgb *= gl_FragColor.a;
            gl_FragColor.a = 0.;
          }
        }`,
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
      depthWrite: false,
    });
    for (let i = 0; i < FLIP_SLOTS; i++) {
      const mat = proto.clone();
      const mesh = new THREE.Mesh(this.geometry, mat);
      mesh.visible = false;
      mesh.renderOrder = 8; // over the shock rings: the sheet IS the impact
      mesh.userData.renderCategory = 'vfx';
      mesh.onBeforeRender = (renderer, _scene, _camera, _geometry, material) => {
        const target = renderer.getRenderTarget();
        (material as THREE.ShaderMaterial).uniforms.uLowRangeTarget.value =
          !target || target.texture.type === THREE.UnsignedByteType ? 1 : 0;
      };
      scene.add(mesh);
      this.slots.push({
        mesh,
        mat,
        age: 0,
        duration: FLIP_DUR,
        rotation: 0,
        aspect: 1,
        size: 1,
        worldDirected: false,
        strikeAxis: new THREE.Vector3(),
        projectedRoll: 0,
        active: false,
      });
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
    style: FlipbookStyle | ContactSheet | WarriorFlashStyle,
    duration = FLIP_DUR,
    rotation = 0,
    aspect = 1,
    groundY = Number.NaN,
    worldFacing = Number.NaN,
  ): void {
    if (this.disposed) return;
    const warrior = warriorFlashStyle(style);
    const texture = warrior
      ? contactTexture('contact_cut')
      : isContactSheet(style)
        ? contactTexture(style)
        : flipbookSheet(style as FlipbookStyle);
    if (!texture) return;
    const slot = this.slots[this.next];
    this.next = (this.next + 1) % FLIP_SLOTS;
    slot.active = true;
    slot.age = 0;
    slot.size = size;
    slot.duration = Number.isFinite(duration) ? Math.max(0.05, duration) : FLIP_DUR;
    slot.rotation = Number.isFinite(rotation) ? rotation : 0;
    slot.projectedRoll = slot.rotation;
    slot.worldDirected = warrior > 0 && Number.isFinite(worldFacing);
    slot.strikeAxis.set(
      slot.worldDirected ? Math.cos(worldFacing) * Math.cos(slot.rotation) : 0,
      slot.worldDirected ? Math.sin(slot.rotation) : 0,
      slot.worldDirected ? -Math.sin(worldFacing) * Math.cos(slot.rotation) : 0,
    );
    slot.aspect = Number.isFinite(aspect) ? Math.max(0.25, Math.min(4, aspect)) : 1;
    slot.mat.uniforms.uMap.value = texture;
    slot.mat.uniforms.uInset.value =
      warrior || isContactSheet(style)
        ? 4 / Math.max(64, (texture.image as { width?: number })?.width ?? 512)
        : 0;
    (slot.mat.uniforms.uTint.value as THREE.Color).setHex(colorHex);
    slot.mat.uniforms.uHdr.value = hdr;
    slot.mat.uniforms.uFrame.value = 0;
    slot.mat.uniforms.uWarriorStyle.value = warrior;
    slot.mat.uniforms.uWarriorPhase.value = 0;
    (slot.mat.uniforms.uWarriorDown.value as THREE.Vector2).set(0, -1);
    slot.mat.uniforms.uWarriorFloor.value = warrior && Number.isFinite(groundY) ? groundY : -1e6;
    // Keep a low landing core bright while softening the wider body-height bursts.
    slot.mat.uniforms.uWarriorFloorBlend.value =
      warrior && Number.isFinite(groundY)
        ? Math.min(0.85, Math.max(0.12, (y - groundY) * 1.5))
        : 0.85;
    slot.mat.uniforms.uOpacity.value = 1;
    slot.mesh.position.set(x, y, z);
    slot.mesh.scale.setScalar(size * 0.65 * (warrior ? WARRIOR_IMPACT_REACH : 1));
    slot.mesh.visible = true;
  }

  // Boot-only: build every cached sheet and bind one per slot (FLIP_SLOTS
  // matches the style count), so the prewarm's texture walk uploads all six
  // and the compile pass links the shader before the first real impact.
  prewarm(x: number, y: number, z: number): void {
    for (const style of FLIPBOOK_STYLES) this.spawn(x, y, z, 1, 0xffffff, 1, style);
  }

  /**
   * `camPos` and `tanHalfVFov` bound the quad to a fraction of the screen
   * (../vfx_screen_bounds_core.ts). An impact sheet is authored at 5 to 12
   * yards across and always faces the camera, so at melee range one quad is
   * effectively fullscreen additive fill that the composer bloom then re-reads.
   * The bound sits far above any ordinary camera distance, so it only trims the
   * degenerate close-range case; a host that cannot supply the camera (a test,
   * an orthographic viewport) omits both and keeps the unbounded size.
   */
  update(
    dt: number,
    camQuat: THREE.Quaternion,
    camPos?: THREE.Vector3,
    tanHalfVFov?: number,
    reducedMotion = false,
  ): void {
    if (this.disposed) return;
    this.cameraInverse.copy(camQuat).invert();
    this.projectedDown.set(0, -1, 0).applyQuaternion(this.cameraInverse);
    const bounded = camPos !== undefined && tanHalfVFov !== undefined && tanHalfVFov > 0;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      const t = Math.min(1, slot.age / slot.duration);
      slot.mat.uniforms.uFrame.value = t * LAST_FRAME;
      slot.mat.uniforms.uWarriorPhase.value = reducedMotion ? 0.32 : t;
      slot.mat.uniforms.uOpacity.value = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      if (slot.mat.uniforms.uWarriorStyle.value) {
        const scale =
          slot.size *
          (slot.mat.uniforms.uWarriorStyle.value ? WARRIOR_IMPACT_REACH : 1) *
          (0.65 +
            0.55 * easeOutCubic(reducedMotion && slot.mat.uniforms.uWarriorStyle.value ? 0.32 : t));
        slot.mesh.scale.set(scale * slot.aspect, scale, scale);
      } else {
        const grown = slot.size * (0.65 + 0.55 * easeOutCubic(t));
        slot.mesh.scale.setScalar(
          bounded
            ? boundQuadSize(
                grown,
                slot.mesh.position.distanceTo(camPos as THREE.Vector3),
                tanHalfVFov as number,
                IMPACT_QUAD_MAX_SCREEN_FRACTION,
              )
            : grown,
        );
      }
      slot.mesh.quaternion.copy(camQuat);
      let roll = slot.rotation;
      if (slot.worldDirected) {
        const direction = this.projectedStrike
          .copy(slot.strikeAxis)
          .applyQuaternion(this.cameraInverse);
        // End-on cuts have no meaningful screen direction. Retain the last
        // valid roll, initially authored, rather than magnifying projection noise.
        if (direction.x * direction.x + direction.y * direction.y > 0.0001)
          slot.projectedRoll = Math.atan2(direction.y, direction.x);
        roll = slot.projectedRoll;
      }
      if (roll) slot.mesh.rotateZ(roll);
      const c = Math.cos(roll),
        s = Math.sin(roll),
        down = this.projectedDown;
      // Gravity remains world-down even as the blade and camera rotate. Undo
      // the billboard roll and its aspect stretch before applying UV drift.
      (slot.mat.uniforms.uWarriorDown.value as THREE.Vector2).set(
        (c * down.x + s * down.y) / slot.aspect,
        -s * down.x + c * down.y,
      );
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    for (const slot of this.slots) {
      slot.mesh.removeFromParent();
      slot.mat.dispose();
    }
    this.geometry.dispose();
  }
}
