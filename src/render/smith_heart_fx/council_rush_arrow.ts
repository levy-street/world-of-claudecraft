// Mountain's Rush's red arrow over the marked player (plan: council_mechanic_look_core.ts
// rushArrowLook, RUSH_ARROW; docs/design/raid/smith_heart.md 7.1), a part of CouncilFx:
// for the whole of the mark's bar a big glowing red arrow floats over the marked player's
// head pointing down at them, bobbing and pulsing faster as the bar runs out, so the WHOLE
// raid sees who the Guardian will charge and the marked player finds their own mark from
// any camera (the owner's playtest of 2026-11-12). Read off the mark aura on the player
// (IWorld's mirrored auras), so offline and online show the same.
//
// The arrow is a billboard (it always faces the camera, so it reads as an arrow from the
// raid's steep camera as well as from the ground), drawn as a signed-distance shape: a
// ruby rim, a fill heating from a deep red tail to a white-hot tip, a shine climbing it,
// and a red glow round it that breathes with the pulse.
//
// Actionable, so it draws on EVERY tier, the static preset included, and never through
// the FPS governor; reduced motion holds the bob and pulse (the arrow stays, lit full).
// It draws over the world (no depth test, the transparent pass's top render order), so a
// pillar or a boss never hides the mark. Built in the constructor under the host's root
// (one gated attach, the same as the soak's beacon): a fixed pool, one shared quad, one
// draw per arrow, no light, no per-frame allocation.

import * as THREE from 'three';
import type { Entity } from '../../sim/types';
import { fxAnchor } from '../attached_fx_anchor';
import { COUNCIL_AURAS } from './council_fx_core';
import { RUSH_ARROW, type RushArrowLook, rushArrowLook } from './council_mechanic_look_core';

/** Marked players at once (one Rush at a time; two covers a mark handing over). */
const POOL = 2;
/** Over the world's own effects (the floor ladder tops out far below). */
const RENDER_ORDER = 9000;
const CORE_COLOR = 0xff2412;
const HOT_COLOR = 0xffc49a;
const RIM_COLOR = 0x3a0606;

const f = (n: number) => n.toFixed(3);

const ARROW_VERT = /* glsl */ `
uniform vec2 uSize;
varying vec2 vP;
void main() {
  // Yards on the card, x across, y up from the card's foot (the tip sits a margin above it).
  vP = (uv - vec2(0.5, 0.0)) * uSize;
  // A billboard: the card's corners laid out in view space round the mesh's origin, its
  // own scale carried (the pulse's swell).
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  // Far off it keeps its size on screen (RUSH_ARROW.holdFrom), growing up from its tip.
  float s = length(modelMatrix[0].xyz) * max(1.0, -mv.z / ${f(RUSH_ARROW.holdFrom)});
  // The mesh's origin is the arrow's tip (the card's foot a margin under it).
  mv.xy += (vP - vec2(0.0, ${f(RUSH_ARROW.margin)})) * s;
  gl_Position = projectionMatrix * mv;
}
`;
/** The arrow as a signed distance (yards): a head (a triangle) over a shaft (a box). */
const ARROW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHot;
uniform vec3 uRim;
uniform float uGlow;
uniform float uTime;
varying vec2 vP;
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
  vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 q0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 q1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 q2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(q0, q0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(q1, q1), s * (v1.x * e1.y - v1.y * e1.x))),
                   vec2(dot(q2, q2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
void main() {
  float tip = ${f(RUSH_ARROW.margin)};
  float len = ${f(RUSH_ARROW.length)};
  float headY = tip + len * 0.46;
  float hw = ${f(RUSH_ARROW.width * 0.5)};
  float d = sdTri(vP, vec2(0.0, tip), vec2(-hw, headY), vec2(hw, headY));
  float shaftHalf = hw * 0.38;
  vec2 shaftC = vec2(0.0, (headY - 0.05 + tip + len) * 0.5);
  vec2 shaftB = vec2(shaftHalf, (tip + len - headY + 0.05) * 0.5);
  d = min(d, sdBox(vP - shaftC, shaftB) - 0.04);
  float fill = 1.0 - smoothstep(-0.025, 0.025, d);
  // How far up the arrow (0 at the tip, 1 at the tail).
  float h = clamp((vP.y - tip) / len, 0.0, 1.0);
  vec3 col = mix(uHot, uColor, smoothstep(0.0, 0.55, h));
  // Brighter in its heart, darker to the edge, a ruby rim inside the outline.
  col *= 0.7 + 0.55 * smoothstep(0.0, -0.32, d);
  float shine = smoothstep(0.1, 0.0, abs(fract(h * 0.9 - uTime * 0.9) - 0.5) - 0.42);
  col += uHot * shine * 0.35;
  float rim = 1.0 - smoothstep(0.035, 0.09, abs(d + 0.06));
  col = mix(col, uRim, rim * 0.85);
  // The glow outside it, breathing with the pulse.
  float glow = exp(-max(d, 0.0) * 5.5) * (1.0 - fill) * (0.45 + 0.55 * uGlow);
  vec3 rgb = col * (0.85 + 0.35 * uGlow) * fill + uColor * 1.5 * glow;
  float a = clamp(fill + glow * 0.9, 0.0, 1.0);
  if (a < 0.003) discard;
  gl_FragColor = vec4(rgb / max(a, 0.001), a);
  #include <colorspace_fragment>
}
`;

interface ArrowSlot {
  playerId: number;
  seen: boolean;
  card: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

const _look: RushArrowLook = { y: 0, glow: 1, scale: 1 };

function markOf(e: Entity | undefined) {
  if (!e || e.dead) return null;
  const auras = e.auras;
  for (let i = 0; i < auras.length; i++)
    if (auras[i].id === COUNCIL_AURAS.rushMark) return auras[i];
  return null;
}

/** The card's size in yards: the arrow plus its glow's margin all round. */
const CARD_W = RUSH_ARROW.width + RUSH_ARROW.margin * 2;
const CARD_H = RUSH_ARROW.length + RUSH_ARROW.margin * 2;

export class CouncilRushArrow {
  private readonly slots: ArrowSlot[] = [];

  constructor(
    root: THREE.Group,
    uTime: { value: number },
    geometries: THREE.BufferGeometry[],
    materials: THREE.Material[],
  ) {
    // One quad; the vertex shader lays it out in view space from its uvs.
    const quad = new THREE.PlaneGeometry(1, 1, 1, 1);
    geometries.push(quad);
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartRushArrow',
        uniforms: {
          uSize: { value: new THREE.Vector2(CARD_W, CARD_H) },
          uColor: { value: new THREE.Color(CORE_COLOR) },
          uHot: { value: new THREE.Color(HOT_COLOR) },
          uRim: { value: new THREE.Color(RIM_COLOR) },
          uGlow: { value: 1 },
          uTime,
        },
        vertexShader: ARROW_VERT,
        fragmentShader: ARROW_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      materials.push(mat);
      const card = new THREE.Mesh(quad, mat);
      card.name = 'smithHeartRushArrow';
      card.visible = false;
      card.frustumCulled = false;
      card.renderOrder = RENDER_ORDER;
      root.add(card);
      this.slots.push({ playerId: -1, seen: false, card, mat });
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
      // The mesh's origin is the tip, over the player's drawn feet.
      s.card.position.set(at.x, at.y + _look.y, at.z);
      s.card.scale.setScalar(_look.scale);
      s.mat.uniforms.uGlow.value = _look.glow;
      s.card.visible = true;
    }
  }

  private free(s: ArrowSlot): void {
    s.playerId = -1;
    s.card.visible = false;
  }
}
