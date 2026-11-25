// The Guardian of the Heat's Live Coals on screen (plan: heat_coal_fx_core.ts;
// the sim is encounters/smith_heart/heat_coal.ts; docs/design/raid/
// smith_heart.md section 7.4), a part of HeatFightFx over its root, particles
// and floor telegraph kit:
//  - the arrow: a molten arrowhead over every bearer's head pointing down at
//    them, a dark basalt rim round white-gold fire and a live coal throbbing
//    in its heart, faster as the fuse runs down; its bearer's own half again
//    as large. Every tier, every viewer (it is who to keep away from and who
//    to heal: the graphics settings never hide it);
//  - the leap ring: the sim's exact leap reach at the bearer's feet, a quiet
//    line in the Hearth's molten paint (every tier);
//  - the burst's reach: the sim's exact radius over the fuse's last seconds,
//    filling to the burst (every tier);
//  - the cues: the coal carried out of the wellspring onto its bearer, the
//    leap's sparks, the coal going out in a puff of ash, the burst's ring of
//    fire; the embers off a carried coal thin on the low tier.
//
// Built in the constructor under the host's root (one gated attach), fixed
// pools, no per-frame allocation, no light.

import * as THREE from 'three';
import { HEAT_AURAS, HEAT_TUNING as T } from '../../sim/encounters/smith_heart/heat_ids';
import type { Aura, Entity } from '../../sim/types';
import { fxAnchor } from '../attached_fx_anchor';
import {
  TELEGRAPH_THREAT_COLORS,
  type TelegraphFan,
  type TelegraphPaint,
} from '../floor_telegraph';
import { coalLook, type HeatCoalLook } from './heat_coal_fx_core';
import { HEAT_FIGHT_COLORS as C } from './heat_fight_fx_core';
import type { HeatFxHost } from './heat_fx_host';
import { setTelegraphFinal } from './heat_telegraph';
import { heatTelegraphFinal } from './heat_telegraph_core';

/** Bearers drawn at once: two coals a set, room for a stray. */
export const COAL_SLOTS = 4;

const DANGER = { color: TELEGRAPH_THREAT_COLORS.danger, accent: C.accent };
const PAINT: TelegraphPaint = { fill: 0, clock: 0, range: 0 };
const LOOK: HeatCoalLook = { size: 0, height: 0, glow: 0, burstFill: 0, burstShown: false };
/** A leap ring or burst reach re-drapes on the floor once its bearer has
 *  slid this far (between, it slides: telegraph_kit.ts placeFan). */
const REDRAPE = 0.5;

const EMBER = {
  speed: 0.6,
  up: 2.4,
  life: 0.7,
  size: [0.35, 0.06] as [number, number],
  color: C.ember,
  alpha: 0.95,
  pool: 'glow' as const,
  radius: 0.3,
};
const SPARK = {
  speed: 7,
  up: 3,
  life: 0.55,
  size: [0.4, 0.08] as [number, number],
  color: C.spark,
  alpha: 1,
  pool: 'glow' as const,
  gravity: 8,
  radius: 0.8,
};
const ASH = {
  speed: 0.8,
  up: 1.6,
  life: 1.4,
  size: [0.8, 2] as [number, number],
  color: C.smoke,
  alpha: 0.35,
  drag: 0.7,
  radius: 0.6,
};

/** A true billboard: the plane laid in view space round its anchor, so the
 *  arrow faces the camera however it orbits (a plane turned to the player's
 *  facing goes edge-on under a camera drag: the reviews of 2026-11-24). */
const BILLBOARD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 scale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  mv.xy += position.xy * scale;
  gl_Position = projectionMatrix * mv;
}
`;
/** The arrow: a downward arrowhead and its shaft as one signed distance, a
 *  dark basalt rim, molten fire inside hottest along its spine, and the live
 *  coal (uGlow) burning white in the head. */
const ARROW_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGlow;
varying vec2 vUv;
float sdTri(vec2 p, vec2 q) {
  p.x = abs(p.x);
  vec2 a = p - q * clamp(dot(p, q) / dot(q, q), 0.0, 1.0);
  vec2 b = p - q * vec2(clamp(p.x / q.x, 0.0, 1.0), 1.0);
  float s = -sign(q.y);
  vec2 d = min(vec2(dot(a, a), s * (p.x * q.y - p.y * q.x)), vec2(dot(b, b), s * (p.y - q.y)));
  return -sqrt(d.x) * sign(d.y);
}
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  // The head: its tip at the bottom, its base across the middle.
  float head = sdTri(p - vec2(0.0, -0.94), vec2(0.72, 1.0));
  float shaft = sdBox(p - vec2(0.0, 0.47), vec2(0.2, 0.43));
  float d = min(head, shaft);
  float edge = fwidth(d) + 0.015;
  float body = 1.0 - smoothstep(-edge, edge, d);
  // A soft halo just past the rim, so it reads over bright fire and dark rock.
  float halo = (1.0 - smoothstep(0.0, 0.16, d)) * (1.0 - body);
  // Inside: the rim dark basalt, the fire hotter toward the spine.
  float inner = clamp(-d / 0.12, 0.0, 1.0);
  float spine = 1.0 - smoothstep(0.0, 0.5, abs(p.x));
  float flick = 0.85 + 0.15 * sin(uTime * 7.0 + p.y * 9.0);
  vec3 basalt = vec3(0.09, 0.07, 0.06);
  vec3 amber = vec3(0.98, 0.5, 0.12);
  vec3 gold = vec3(1.0, 0.8, 0.38);
  vec3 col = mix(basalt, mix(amber, gold, spine * flick), smoothstep(0.25, 0.75, inner));
  // The coal in the head's heart, throbbing with the fuse.
  float coal = 1.0 - smoothstep(0.08, 0.3, length(p - vec2(0.0, -0.32)));
  col = mix(col, vec3(1.0, 0.97, 0.86) * (1.1 + 0.5 * uGlow), coal * uGlow * body);
  vec3 haloCol = vec3(1.0, 0.62, 0.22) * (0.55 + 0.45 * uGlow);
  float a = max(body, halo * 0.55);
  gl_FragColor = vec4(mix(haloCol, col, smoothstep(0.0, 0.5, body)), a);
  #include <colorspace_fragment>
}
`;

interface CoalSlot {
  id: number;
  arrow: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  glow: THREE.Sprite;
  leap: TelegraphFan;
  burst: TelegraphFan;
  /** Where each fan was last draped (NaN: not yet). */
  leapAt: { x: number; z: number };
  burstAt: { x: number; z: number };
  emberIn: number;
}

export class HeatCoalFx {
  private readonly slots: CoalSlot[] = [];

  constructor(private readonly host: HeatFxHost) {
    const plane = new THREE.PlaneGeometry(1, 1);
    host.geometries.push(plane);
    const glowMat = host.sprite(0xffb050, 'smithHeartHeatCoalGlow');
    for (let i = 0; i < COAL_SLOTS; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartHeatCoalArrow',
        uniforms: { uTime: host.uTime, uGlow: { value: 0 } },
        vertexShader: BILLBOARD_VERT,
        fragmentShader: ARROW_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      host.materials.push(mat);
      const arrow = new THREE.Mesh(plane, mat);
      arrow.name = 'smithHeartHeatCoalArrow';
      arrow.frustumCulled = false;
      // Over the fight's other transparent marks (the hunted's chevron).
      arrow.renderOrder = 12;
      arrow.visible = false;
      host.root.add(arrow);
      const glow = new THREE.Sprite(glowMat);
      glow.name = 'smithHeartHeatCoalGlow';
      glow.visible = false;
      host.root.add(glow);
      const leap = host.telegraphs.fan('coalLeap');
      host.kit.layOutFan(leap, 360, DANGER);
      leap.group.visible = false;
      const burst = host.telegraphs.fan('cinderReach');
      host.kit.layOutFan(burst, 360, DANGER);
      burst.group.visible = false;
      this.slots.push({
        id: -1,
        arrow,
        mat,
        glow,
        leap,
        burst,
        leapAt: { x: Number.NaN, z: 0 },
        burstAt: { x: Number.NaN, z: 0 },
        emberIn: 0,
      });
    }
  }

  /** One frame: every bearer's arrow, ring and reach. */
  update(bearerIds: readonly number[], clock: number, dt: number): void {
    const world = this.host.world;
    if (!world) return;
    let n = 0;
    for (const id of bearerIds) {
      if (n >= this.slots.length) break;
      const p = world.entities.get(id);
      if (!p || p.dead) continue;
      const coal = coalAura(p);
      if (coal === null) continue;
      const s = this.slots[n++];
      s.id = id;
      this.paint(s, p, coal, id === world.playerId, clock, dt);
    }
    for (let i = n; i < this.slots.length; i++) this.release(this.slots[i]);
  }

  private paint(
    s: CoalSlot,
    p: Entity,
    coal: Aura,
    self: boolean,
    clock: number,
    dt: number,
  ): void {
    const look = coalLook(
      coal.remaining,
      coal.duration,
      self,
      clock,
      this.host.reducedMotion(),
      LOOK,
    );
    const at = fxAnchor(p);
    const y = this.host.groundY(at.x, at.z);
    s.arrow.position.set(at.x, at.y + look.height, at.z);
    s.arrow.scale.set(look.size, look.size * 1.25, 1);
    s.mat.uniforms.uGlow.value = look.glow;
    s.arrow.visible = true;
    s.glow.position.set(at.x, at.y + look.height - look.size * 0.2, at.z);
    const g = look.size * (1.6 + 0.4 * look.glow);
    s.glow.scale.set(g, g, 1);
    s.glow.visible = true;
    // The leap ring, the whole time.
    this.drape(s.leap, s.leapAt, at.x, y, at.z, T.coalLeapR);
    PAINT.fill = 1;
    PAINT.clock = clock;
    PAINT.range = T.coalLeapR;
    PAINT.front = 0;
    PAINT.fade = 0.8;
    this.host.kit.paintFan(s.leap, PAINT);
    s.leap.group.visible = true;
    // The burst's reach over the fuse's last seconds.
    if (look.burstShown) {
      this.drape(s.burst, s.burstAt, at.x, y, at.z, T.coalBurstR);
      PAINT.fill = look.burstFill;
      PAINT.clock = clock;
      PAINT.range = T.coalBurstR;
      PAINT.front = undefined;
      PAINT.fade = undefined;
      this.host.kit.paintFan(s.burst, PAINT);
      setTelegraphFinal(s.burst, heatTelegraphFinal(coal.remaining));
      s.burst.group.visible = true;
    } else {
      s.burst.group.visible = false;
      s.burstAt.x = Number.NaN;
    }
    // Embers off the carried coal (cosmetic: thinned on the low tier).
    s.emberIn -= dt;
    if (s.emberIn <= 0) {
      s.emberIn = 0.12 / Math.max(0.2, this.host.density);
      this.host.particles.puff(at.x, at.y + look.height - look.size * 0.4, at.z, 1, EMBER);
    }
  }

  /** Drape `f` at (x, z) once it has slid REDRAPE from its last drape, else
   *  slide it there. */
  private drape(
    f: TelegraphFan,
    last: { x: number; z: number },
    x: number,
    y: number,
    z: number,
    range: number,
  ): void {
    if (Number.isNaN(last.x) || Math.hypot(x - last.x, z - last.z) > REDRAPE) {
      this.host.kit.drapeFan(f, this.host.groundY, x, y, z, 0, range);
      last.x = x;
      last.z = z;
    } else this.host.kit.placeFan(f, x, y, z);
  }

  private release(s: CoalSlot): void {
    if (s.id < 0) return;
    s.id = -1;
    s.leapAt.x = Number.NaN;
    s.burstAt.x = Number.NaN;
    s.arrow.visible = false;
    s.glow.visible = false;
    s.leap.group.visible = false;
    s.burst.group.visible = false;
  }

  /** A coal cue on a body (set, leap, out). */
  cue(kind: 'set' | 'leap' | 'out', dst: Entity | undefined): void {
    if (!dst) return;
    const at = fxAnchor(dst);
    const parts = this.host.particles;
    if (kind === 'set') {
      parts.puff(at.x, at.y + 1.2, at.z, 14, SPARK);
      parts.shockRing(at.x, at.z, C.ringGold, T.coalLeapR + 1, 0.45);
    } else if (kind === 'leap') {
      parts.puff(at.x, at.y + 1.4, at.z, 18, { ...SPARK, speed: 9 });
      parts.shockRing(at.x, at.z, C.ring, T.coalLeapR + 0.5, 0.35);
    } else {
      parts.puff(at.x, at.y + 1.6, at.z, 8, ASH);
      parts.puff(at.x, at.y + 1.6, at.z, 6, { ...SPARK, speed: 3 });
    }
  }

  /** The burst at world (x, z), its reach `r`. */
  burstAt(x: number, z: number, r: number): void {
    const y = this.host.groundY(x, z);
    const parts = this.host.particles;
    parts.shockRing(x, z, C.white, r, 0.7);
    parts.shockRing(x, z, C.ringGold, r * 0.6, 0.5);
    parts.puff(x, y + 1.2, z, 36, { ...SPARK, speed: 12, up: 6, radius: 1.2 });
    parts.puff(x, y + 1.4, z, 10, ASH);
    this.host.shakeNear(x, z, 0.45, 30);
  }

  hide(): void {
    for (const s of this.slots) this.release(s);
  }
}

/** The coal aura on `p` (its fuse), or null. */
function coalAura(p: Entity): Aura | null {
  for (const a of p.auras) if (a.id === HEAT_AURAS.coal) return a;
  return null;
}
