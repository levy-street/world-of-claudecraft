// The trash engine's hazard pools (plan: trash_engine_fx_core.ts hazardLook),
// drawn from the encounter objects the sim mirrors (template id = the look,
// scale = the radius, kit_hazard.ts):
//  - Boiling Meltwater (the Scaleguard's heroic breath pool): scalding white
//    blue water on the ice, rolling boils popping across it, thick steam, and
//    an orange-hot rim inside the shared danger ring, so it reads as "out";
//  - Spilled Soulfire (a toppled Soul Brazier, the group's weapon): a
//    violet-green puddle of soulfire licking with flames, with no threat rim
//    (it burns the mobs, never the players), so it never reads as danger;
//  - any other hazard template: a school-tinted swirling disc in the danger
//    ring (players) or a soft friendly edge (mobs).
// The danger footprint is the shared floor telegraph (actionable: every tier);
// the surface, steam, boils and flames are cosmetic and thin on the low tier.
//
// Built once under the host's root before its gated attach; no light; no
// per-frame allocation.

import * as THREE from 'three';
import type { Entity } from '../../sim/types';
import type { TelegraphFan } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { FLAME_HEAT } from '../gravewyrm_sanctum_fx/sanctum_fx_core';
import { drapeDisc, NOISE_GLSL, polarDisc, SURFACE_VERT } from './engine_geometry';
import {
  type HazardLook,
  type HazardStyle,
  hazardLook,
  hazardPresence,
  hazardSpread,
  rgbOf,
} from './trash_engine_fx_core';
import type { TrashEngineHost } from './trash_engine_host';

const SLOTS = 12;
const STYLES: readonly HazardStyle[] = ['meltwater', 'soulfire', 'generic'];

const MELTWATER_FRAG = /* glsl */ `
uniform float uTime;
uniform float uPresence;
uniform float uSeed;
uniform vec3 uTint;
uniform vec3 uHot;
varying vec2 vP;
varying vec3 vWorld;
${NOISE_GLSL}
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  vec2 w = vWorld.xz;
  // Churning water: two noise layers flowing against each other.
  float n = fbm(w * 0.9 + vec2(uTime * 0.6, -uTime * 0.4) + uSeed);
  float m = fbm(w * 1.7 - vec2(uTime * 0.5, uTime * 0.7));
  float caustic = pow(max(1.0 - abs(n - m) * 2.0, 0.0), 6.0);
  vec3 deep = vec3(0.32, 0.62, 0.82);
  vec3 col = mix(deep, uTint, 0.45 + 0.4 * n) + caustic * vec3(0.7, 0.9, 1.0) * 0.8;
  // Rolling boils: a cell grid, each cell a bubble that swells and pops.
  vec2 g = w * 1.25;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float hb = h21(id + uSeed);
  float ph = fract(uTime * (0.9 + hb * 1.3) + hb * 7.0);
  vec2 c = (vec2(h21(id + 3.1), h21(id + 5.7)) - 0.5) * 0.5;
  float d = length(f - c);
  float br = ph * 0.32;
  float bubble = (1.0 - smoothstep(br - 0.05, br, d)) * smoothstep(br - 0.12, br - 0.04, d);
  float pop = ph > 0.85 ? (1.0 - smoothstep(0.0, 0.2, abs(d - br * 1.2))) * (1.0 - ph) * 6.0 : 0.0;
  col += vec3(1.0) * (bubble * 0.8 + pop * 0.6) * step(0.25, hb);
  // White steam-whitened centre, scalding orange creeping in from the rim.
  col = mix(col, vec3(0.95, 0.98, 1.0), (1.0 - smoothstep(0.0, 0.55, r)) * 0.25);
  float hotBand = smoothstep(0.7, 0.93, r);
  float flick = 0.75 + 0.25 * sin(uTime * 9.0 + atan(vP.y, vP.x) * 5.0 + uSeed);
  col = mix(col, uHot * 1.35, hotBand * 0.75 * flick);
  float edge = 1.0 - smoothstep(0.93, 1.0, r);
  float a = (0.82 + 0.15 * n) * edge * uPresence;
  gl_FragColor = vec4(col, a);
}
`;

const SOULFIRE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uPresence;
uniform float uSeed;
uniform vec3 uTint;
uniform vec3 uHot;
varying vec2 vP;
varying vec3 vWorld;
${NOISE_GLSL}
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  vec2 w = vWorld.xz;
  float ang = atan(vP.y, vP.x);
  // A slow swirl of burning soul-stuff, veins of green fire through violet.
  vec2 q = vec2(cos(ang + uTime * 0.35 + r * 2.5), sin(ang + uTime * 0.35 + r * 2.5)) * r * 2.4;
  float n = fbm(q + w * 0.6 + uSeed);
  float vein = pow(max(1.0 - abs(fbm(w * 1.4 + vec2(0.0, -uTime * 0.8)) - 0.5) * 2.0, 0.0), 8.0);
  vec3 col = mix(uTint * 0.55, uTint * 1.4, n);
  col = mix(col, uHot * 1.6, vein * 0.85);
  // Embers: dark coals glowing through.
  float coal = smoothstep(0.62, 0.8, vnoise(w * 3.0 + uSeed * 2.0));
  col = mix(col, vec3(0.08, 0.04, 0.12), coal * 0.6);
  col += uHot * pow(max(1.0 - r, 0.0), 2.0) * 0.6;
  // A glowing violet-green lip where it eats the ice.
  float lip = smoothstep(0.8, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
  col += mix(uHot, uTint, 0.4) * lip * 1.6;
  float a = (0.78 + 0.2 * n) * (1.0 - smoothstep(0.96, 1.0, r)) * uPresence;
  gl_FragColor = vec4(col, a);
}
`;

const GENERIC_FRAG = /* glsl */ `
uniform float uTime;
uniform float uPresence;
uniform float uSeed;
uniform vec3 uTint;
uniform vec3 uHot;
varying vec2 vP;
varying vec3 vWorld;
${NOISE_GLSL}
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  float ang = atan(vP.y, vP.x);
  vec2 q = vec2(cos(ang + uTime * 0.5), sin(ang + uTime * 0.5)) * r * 2.0;
  float n = fbm(q + vWorld.xz * 0.5 + uSeed);
  vec3 col = uTint * (0.6 + 0.9 * n);
  float lip = smoothstep(0.82, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
  col += uHot * lip * 1.4;
  float a = (0.55 + 0.25 * n) * (1.0 - smoothstep(0.96, 1.0, r)) * uPresence;
  gl_FragColor = vec4(col, a);
}
`;

interface HazardSlot {
  objectId: number;
  look: HazardLook | null;
  radius: number;
  since: number;
  emit: number;
  x: number;
  y: number;
  z: number;
  /** One surface per style, each on its own draped copy of the disc. */
  surfaces: Record<HazardStyle, THREE.Mesh>;
  mats: Record<HazardStyle, THREE.ShaderMaterial>;
  ring: TelegraphFan;
}

export class EngineHazards {
  private readonly slots: HazardSlot[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private clock = 0;

  constructor(private readonly host: TrashEngineHost) {
    const frag: Record<HazardStyle, string> = {
      meltwater: MELTWATER_FRAG,
      soulfire: SOULFIRE_FRAG,
      generic: GENERIC_FRAG,
    };
    for (let i = 0; i < SLOTS; i++) {
      const surfaces = {} as Record<HazardStyle, THREE.Mesh>;
      const mats = {} as Record<HazardStyle, THREE.ShaderMaterial>;
      for (const style of STYLES) {
        const geo = polarDisc(6, 56);
        this.geometries.push(geo);
        const mat = new THREE.ShaderMaterial({
          name: `trashEngineHazard_${style}`,
          uniforms: {
            uTime: host.uTime,
            uPresence: { value: 0 },
            uSeed: { value: i * 3.7 },
            uTint: { value: new THREE.Color() },
            uHot: { value: new THREE.Color() },
          },
          vertexShader: SURFACE_VERT,
          fragmentShader: frag[style],
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          // The soulfire burns: additive over the floor; the water and the
          // generic disc are a surface of their own.
          blending: style === 'soulfire' ? THREE.AdditiveBlending : THREE.NormalBlending,
        });
        this.materials.push(mat);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.visible = false;
        // Over the danger ring's floor (encounter 16), under its curtain (18).
        mesh.renderOrder = floorVfxRenderOrder('encounter', 17);
        host.root.add(mesh);
        surfaces[style] = mesh;
        mats[style] = mat;
      }
      this.slots.push({
        objectId: -1,
        look: null,
        radius: 0,
        since: 0,
        emit: 0,
        x: 0,
        y: 0,
        z: 0,
        surfaces,
        mats,
        ring: host.kit.fan(16),
      });
    }
  }

  /** A hazard object seen by the scan: claim a slot for it. */
  scan(e: Entity): void {
    const def = this.host.catalog.hazards.get(e.templateId);
    if (!def) return;
    if (this.slots.some((s) => s.objectId === e.id)) return;
    const slot = this.slots.find((s) => s.objectId < 0);
    if (!slot) return;
    const look = hazardLook(e.templateId, def);
    slot.objectId = e.id;
    slot.look = look;
    slot.radius = e.scale > 0 ? e.scale : def.radius;
    slot.since = this.clock;
    slot.emit = 0;
    const mat = slot.mats[look.style];
    (mat.uniforms.uTint.value as THREE.Color).setHex(look.tint);
    (mat.uniforms.uHot.value as THREE.Color).setHex(look.accent);
    slot.surfaces[look.style].visible = true;
    if (look.danger) {
      this.host.kit.layOutFan(slot.ring, 360, { color: look.rim, accent: look.accent });
      slot.ring.group.visible = true;
    }
    this.rehome(slot, e);
    this.spill(slot);
  }

  /** Stand the pool's surface and ring on the floor at its object's spot. */
  private rehome(slot: HazardSlot, e: Entity): void {
    const look = slot.look;
    if (!look) return;
    slot.x = e.pos.x;
    slot.z = e.pos.z;
    slot.y = this.host.groundY(slot.x, slot.z);
    const surface = slot.surfaces[look.style];
    // Inside the danger ring's rim band; a friendly pool fills its radius.
    const r = look.danger ? slot.radius * 0.93 : slot.radius;
    drapeDisc(surface.geometry, this.host.groundY, slot.x, slot.y, slot.z, r);
    surface.position.set(slot.x, slot.y, slot.z);
    if (look.danger)
      this.host.kit.drapeFan(slot.ring, this.host.groundY, slot.x, slot.y, slot.z, 0, slot.radius);
  }

  update(dt: number, clock: number): void {
    this.clock = clock;
    const world = this.host.world;
    for (const slot of this.slots) {
      if (slot.objectId < 0 || !slot.look) continue;
      const obj = world.entities.get(slot.objectId);
      if (!obj) {
        this.lift(slot);
        this.release(slot);
        continue;
      }
      const look = slot.look;
      const age = clock - slot.since;
      const presence = hazardPresence(age, look.seconds);
      const spread = hazardSpread(age, 1);
      // A pool rides its mirrored spot (it never moves; a resend only).
      if (obj.pos.x !== slot.x || obj.pos.z !== slot.z) this.rehome(slot, obj);
      const surface = slot.surfaces[look.style];
      const s = spread * (look.danger ? slot.radius * 0.93 : slot.radius);
      surface.scale.set(s, 1, s);
      slot.mats[look.style].uniforms.uPresence.value = presence;
      if (look.danger) {
        this.host.kit.paintFan(slot.ring, {
          fill: 1,
          clock,
          range: slot.radius,
          fade: Math.max(0.55, presence),
        });
      }
      this.emit(slot, dt, presence);
    }
  }

  /** The pool's cosmetic life: steam and boils, or licking soulfire. */
  private emit(slot: HazardSlot, dt: number, presence: number): void {
    const look = slot.look;
    if (!look) return;
    const h = this.host;
    const r = slot.radius;
    slot.emit +=
      dt *
      (look.style === 'soulfire' ? 34 : look.style === 'meltwater' ? 24 : 12) *
      h.density *
      presence;
    while (slot.emit >= 1) {
      slot.emit -= 1;
      if (look.style === 'meltwater') {
        // Thick steam rolling off the scalding water.
        h.puff(slot.x, slot.y + 0.2, slot.z, 1, {
          speed: 0.35,
          up: 1.5,
          life: 2.4,
          size: [1.2, 3.4],
          color: [0.9, 0.94, 0.97],
          alpha: 0.32,
          radius: r * 0.85,
          drag: 0.8,
        });
        if (h.rand() < 0.45)
          // A boil bursting: a white fleck thrown up.
          h.puff(slot.x, slot.y + 0.12, slot.z, 2, {
            speed: 0.9,
            up: 2.2,
            life: 0.45,
            size: [0.16, 0.05],
            color: [0.92, 0.97, 1],
            alpha: 1,
            pool: 'glow',
            radius: r * 0.8,
            gravity: 7,
          });
        if (h.rand() < 0.18) {
          // Heat at the rim: an orange glint.
          const a = h.rand() * Math.PI * 2;
          h.puff(slot.x + Math.cos(a) * r * 0.9, slot.y + 0.15, slot.z + Math.sin(a) * r * 0.9, 1, {
            speed: 0.2,
            up: 0.9,
            life: 0.7,
            size: [0.35, 0.1],
            color: [1, 0.5, 0.18],
            alpha: 1,
            pool: 'glow',
          });
        }
      } else if (look.style === 'soulfire') {
        h.puff(slot.x, slot.y + 0.05, slot.z, 1, {
          speed: 0.25,
          up: 1.3,
          life: 0.95,
          size: [2.1, 0.7],
          color: FLAME_HEAT,
          alpha: 1,
          pool: 'soulfire',
          radius: r * 0.85,
        });
        if (h.rand() < 0.35)
          h.puff(slot.x, slot.y + 0.5, slot.z, 1, {
            speed: 0.4,
            up: 2.4,
            life: 1.3,
            size: [0.18, 0.05],
            color: [0.56, 0.84, 0.63],
            alpha: 1,
            pool: 'glow',
            radius: r * 0.8,
          });
        if (h.rand() < 0.12)
          h.puff(slot.x, slot.y + 1.2, slot.z, 1, {
            speed: 0.3,
            up: 1.1,
            life: 2.2,
            size: [1, 2.8],
            color: [0.32, 0.22, 0.42],
            alpha: 0.3,
            radius: r * 0.6,
          });
      } else {
        h.puff(slot.x, slot.y + 0.2, slot.z, 1, {
          speed: 0.3,
          up: 1.4,
          life: 1.1,
          size: [0.24, 0.06],
          color: rgbOf(look.tint),
          alpha: 1,
          pool: 'glow',
          radius: r * 0.85,
        });
      }
    }
  }

  /** The moment it spills: a splash of steam or a gout of soulfire. */
  private spill(slot: HazardSlot): void {
    const look = slot.look;
    if (!look) return;
    const h = this.host;
    const r = slot.radius;
    if (look.style === 'meltwater') {
      h.shockRing(slot.x, slot.z, 0xcfefff, r * 1.1, 0.45);
      h.puff(slot.x, slot.y + 0.3, slot.z, 22, {
        speed: 2.4,
        up: 1.6,
        life: 1.6,
        size: [1, 3.2],
        color: [0.93, 0.96, 1],
        alpha: 0.45,
        radius: r * 0.5,
        drag: 2.2,
      });
      h.puff(slot.x, slot.y + 0.2, slot.z, 18, {
        speed: 3.2,
        up: 3,
        life: 0.6,
        size: [0.22, 0.06],
        color: [0.85, 0.95, 1],
        alpha: 1,
        pool: 'glow',
        gravity: 9,
        radius: r * 0.4,
      });
    } else if (look.style === 'soulfire') {
      h.shockRing(slot.x, slot.z, 0x8fd6a0, r * 1.15, 0.5);
      h.puff(slot.x, slot.y + 0.1, slot.z, 26, {
        speed: 1.6,
        up: 2.2,
        life: 0.9,
        size: [2.6, 0.8],
        color: FLAME_HEAT,
        alpha: 1,
        pool: 'soulfire',
        radius: r * 0.6,
      });
    } else {
      h.shockRing(slot.x, slot.z, look.tint, r * 1.1, 0.45);
    }
  }

  /** The pool lifts: a last breath of steam or smoke where it stood. */
  private lift(slot: HazardSlot): void {
    const look = slot.look;
    if (!look) return;
    const steam = look.style === 'meltwater';
    this.host.puff(slot.x, slot.y + 0.2, slot.z, 10, {
      speed: 0.6,
      up: 1.2,
      life: 1.8,
      size: [1, 2.6],
      color: steam ? [0.9, 0.94, 0.97] : [0.3, 0.24, 0.36],
      alpha: 0.3,
      radius: slot.radius * 0.7,
    });
  }

  private release(slot: HazardSlot): void {
    slot.objectId = -1;
    slot.look = null;
    for (const style of STYLES) slot.surfaces[style].visible = false;
    slot.ring.group.visible = false;
  }

  hideAll(): void {
    for (const slot of this.slots) this.release(slot);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
