// Mountain's Rush's red arrow over the marked player (plan: council_mechanic_look_core.ts
// rushArrowLook, RUSH_ARROW; docs/design/raid/smith_heart.md 7.1), a part of CouncilFx:
// for the whole of the mark's bar a big glowing red arrow floats over the marked player's
// head pointing down at them, bobbing and turning, pulsing faster as the bar runs out, so
// the WHOLE raid sees who the Guardian will charge and the marked player finds their own
// mark from any camera (the owner's playtest of 2026-11-12). Read off the mark aura on
// the player (IWorld's mirrored auras), so offline and online show the same.
//
// Actionable, so it draws on EVERY tier, the static preset included, and never through
// the FPS governor; reduced motion holds the bob, spin and pulse (the arrow stays, lit
// full). It draws over the world (no depth test, high render order), so a pillar or a
// boss never hides the mark. Built in the constructor under the host's root (one gated
// attach, the same as the soak's beacon): fixed pool, shared geometry, no light, no
// per-frame allocation.

import * as THREE from 'three';
import type { Entity } from '../../sim/types';
import { fxAnchor } from '../attached_fx_anchor';
import { COUNCIL_AURAS } from './council_fx_core';
import { RUSH_ARROW, type RushArrowLook, rushArrowLook } from './council_mechanic_look_core';

/** Marked players at once (one Rush at a time; two covers a mark handing over). */
const POOL = 2;
/** Over the world's own effects (the floor ladder tops out far below). */
const RENDER_ORDER = 9000;
const CORE_COLOR = 0xff2a1a;
const HOT_COLOR = 0xffd0b0;

const CORE_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  // 0 at the tip (the arrow's local origin), 1 at the tail.
  vH = clamp(position.y / ${RUSH_ARROW.length.toFixed(3)}, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;
/** The arrow's body: a deep red tail heating to a white-hot tip, its rim lit like glass
 *  catching light, a bright band climbing the shaft. */
const CORE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uGlow;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
  float tip = 1.0 - smoothstep(0.0, 0.45, vH);
  float band = smoothstep(0.08, 0.0, abs(fract(vH * 1.5 - uTime * 1.2) - 0.5) - 0.38);
  vec3 col = uColor * (0.75 + 0.55 * uGlow);
  col = mix(col, uHot, tip * 0.55 + rim * 0.35);
  col += uColor * band * 0.6 * uGlow;
  gl_FragColor = vec4(col * (0.85 + 0.5 * uGlow), 1.0);
  #include <colorspace_fragment>
}
`;
const SHELL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uGlow;
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  // A soft halo round the arrow: brightest at its silhouette, fading out.
  float edge = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float a = pow(edge, 1.6) * (0.35 + 0.65 * uGlow);
  gl_FragColor = vec4(uColor * 1.6, a * 0.85);
  #include <colorspace_fragment>
}
`;

interface ArrowSlot {
  playerId: number;
  seen: boolean;
  group: THREE.Group;
  coreMat: THREE.ShaderMaterial;
  shellMat: THREE.ShaderMaterial;
}

const _look: RushArrowLook = { y: 0, spin: 0, glow: 1, scale: 1 };

function markOf(e: Entity | undefined) {
  if (!e || e.dead) return null;
  const auras = e.auras;
  for (let i = 0; i < auras.length; i++)
    if (auras[i].id === COUNCIL_AURAS.rushMark) return auras[i];
  return null;
}

/** The arrow's parts, tip at the origin pointing down (-y), tail up at RUSH_ARROW.length:
 *  a cone head and a shaft. */
function arrowGeometries(): { head: THREE.BufferGeometry; shaft: THREE.BufferGeometry } {
  const len = RUSH_ARROW.length;
  const headH = len * 0.46;
  const head = new THREE.ConeGeometry(0.5, headH, 24, 1)
    .rotateX(Math.PI)
    .translate(0, headH / 2, 0);
  const shaftH = len - headH * 0.9;
  const shaft = new THREE.CylinderGeometry(0.17, 0.17, shaftH, 16, 1).translate(
    0,
    headH * 0.9 + shaftH / 2,
    0,
  );
  return { head, shaft };
}

export class CouncilRushArrow {
  private readonly slots: ArrowSlot[] = [];

  constructor(
    root: THREE.Group,
    uTime: { value: number },
    geometries: THREE.BufferGeometry[],
    materials: THREE.Material[],
  ) {
    const { head, shaft } = arrowGeometries();
    geometries.push(head, shaft);
    for (let i = 0; i < POOL; i++) {
      const coreMat = new THREE.ShaderMaterial({
        name: 'smithHeartRushArrow',
        uniforms: {
          uColor: { value: new THREE.Color(CORE_COLOR) },
          uHot: { value: new THREE.Color(HOT_COLOR) },
          uGlow: { value: 1 },
          uTime,
        },
        vertexShader: CORE_VERT,
        fragmentShader: CORE_FRAG,
        // Sorted with the transparent pass, by render order, so nothing drawn
        // after the opaque world paints over it.
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      const shellMat = new THREE.ShaderMaterial({
        name: 'smithHeartRushArrowGlow',
        uniforms: {
          uColor: { value: new THREE.Color(CORE_COLOR) },
          uGlow: { value: 1 },
        },
        vertexShader: CORE_VERT,
        fragmentShader: SHELL_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      materials.push(coreMat, shellMat);
      const group = new THREE.Group();
      group.name = 'smithHeartRushArrow';
      group.visible = false;
      // The halo first, the body over it.
      for (const geo of [head, shaft]) {
        const shell = new THREE.Mesh(geo, shellMat);
        shell.scale.setScalar(1.45);
        shell.renderOrder = RENDER_ORDER;
        const core = new THREE.Mesh(geo, coreMat);
        core.renderOrder = RENDER_ORDER + 1;
        for (const m of [shell, core]) {
          m.frustumCulled = false;
          group.add(m);
        }
      }
      root.add(group);
      this.slots.push({ playerId: -1, seen: false, group, coreMat, shellMat });
    }
  }

  beginScan(): void {
    for (const s of this.slots) s.seen = false;
  }

  /** The scan saw `playerId` wearing the Rush's mark. */
  see(playerId: number): void {
    let s = this.slots.find((q) => q.playerId === playerId);
    if (!s) {
      s = this.slots.find((q) => q.playerId < 0);
      if (!s) return;
      s.playerId = playerId;
    }
    s.seen = true;
  }

  endScan(): void {
    for (const s of this.slots) if (s.playerId >= 0 && !s.seen) this.free(s);
  }

  /** One frame: each arrow over its player's drawn body, gone the frame its mark is. */
  update(
    entities: { get(id: number): Entity | undefined },
    clock: number,
    reducedMotion: boolean,
  ): void {
    for (const s of this.slots) {
      if (s.playerId < 0) continue;
      const p = entities.get(s.playerId);
      const mark = markOf(p);
      if (!p || !mark) {
        this.free(s);
        continue;
      }
      rushArrowLook(mark.remaining, mark.duration, clock, reducedMotion, _look);
      const at = fxAnchor(p);
      s.group.position.set(at.x, at.y + _look.y, at.z);
      s.group.rotation.y = _look.spin;
      s.group.scale.setScalar(_look.scale);
      s.coreMat.uniforms.uGlow.value = _look.glow;
      s.shellMat.uniforms.uGlow.value = _look.glow;
      s.group.visible = true;
    }
  }

  private free(s: ArrowSlot): void {
    s.playerId = -1;
    s.group.visible = false;
  }
}
