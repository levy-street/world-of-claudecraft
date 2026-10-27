// Soul in the Stone's behaviours (plan: council_fx_core.ts; docs/design/raid/
// smith_heart.md 5.18 and 7.1, Mythic), a part of CouncilFx (council_fx.ts,
// which owns the root, the particles, the debris and the floor telegraph and
// hands them in as the host). The soul pillar itself (its lit cracks, its
// sheath of light, its soul pips, the Walking Slab's drag) is the pillars'
// part (council_pillars_fx.ts); this part draws what each soul DOES:
//  - the Guardian's Echo of Wrath: while the pillar's own bar runs, a lethal
//    ring out to the Echo's reach filling with it and a dark shelter wedge
//    behind every other pillar (the only cover: a soul pillar casts none),
//    the pillar drawing embers in; on landing, rings racing out, dust, a
//    flash and a shake;
//  - the Slabwright's Walking Slab: its two footprints riding with it, the
//    crush (lethal) and the grind (danger); a crush's impact on its player;
//  - the Seam Singer's Endless Song: a ring on the floor round the pillar
//    that widens and brightens with every pulse sung, a clock ring closing
//    on the pillar until the next one, and the pulse's sound rings racing out
//    over the whole Quarry, more and brighter as the song grows.
// Every footprint, wedge and ring draws on every tier (the floor telegraph's
// rule); the embers, motes and dust thin with the host's density; reduced
// motion drops the shakes. Built in the constructor under the host's root
// (one gated attach), no light, fixed pools, no per-frame allocation.

import * as THREE from 'three';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  type CouncilRole,
  councilPillarRadius,
  COUNCIL_TUNING as T,
} from '../../sim/encounters/smith_heart/council_ids';
import type { Entity } from '../../sim/types';
import type { TelegraphFan } from '../floor_telegraph';
import { TELEGRAPH_THREAT_COLORS } from '../floor_telegraph/telegraph_look_core';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  COUNCIL_FX_COLORS as C,
  ECHO_SPEC,
  COUNCIL_FX_POOLS as POOLS,
  SOUL_COLORS,
  songLook,
  songPulsesOf,
} from './council_fx_core';
import type { CouncilFxHost, CouncilPillarsFx } from './council_pillars_fx';
import type { CouncilShelters } from './council_shelter_fx';

const RING_VERT = /* glsl */ `
varying vec2 vXZ;
void main() {
  vXZ = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** A floor ring of `uNotches` dashes turning with time (0: whole). */
const RING_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
uniform float uNotches;
uniform float uSpin;
uniform vec3 uColor;
varying vec2 vXZ;
void main() {
  float a = atan(vXZ.x, vXZ.y);
  float t = fract(a / 6.2831853 + 0.5 + uTime * uSpin);
  float dash = uNotches > 0.5 ? step(0.3, fract(t * uNotches)) : 1.0;
  gl_FragColor = vec4(uColor, uAlpha * mix(0.2, 1.0, dash));
  #include <colorspace_fragment>
}
`;

interface SoulSlot {
  pillarId: number;
  role: CouncilRole | null;
  seen: boolean;
  /** The Echo's ring (guardian) or the grind's (slabwright). */
  outer: TelegraphFan;
  /** The crush's ring (slabwright). */
  inner: TelegraphFan;
  /** The song's ring on the floor and its clock (singer). */
  floor: THREE.Mesh;
  floorMat: THREE.ShaderMaterial;
  clock: THREE.Mesh;
  clockMat: THREE.ShaderMaterial;
  /** The Echo's bar this slot last laid out (its start, the host clock). */
  echoAt: number;
  /** Where the slab's fans were last draped (NaN: not yet). */
  drapedX: number;
  drapedZ: number;
  embers: number;
}

/** Per-frame scratch (the frame allocates nothing). */
const _paint = { fill: 0, clock: 0, range: 0, fade: 1 };
const _rgb: [number, number, number] = [1, 1, 1];
const _ember = {
  speed: 0,
  up: 0.4,
  life: 0.7,
  size: [0.5, 0.1] as const,
  color: _rgb as readonly [number, number, number],
  alpha: 0.95,
  pool: 'glow' as const,
  dir: [0, 0, 0] as [number, number, number],
  spread: 0.12,
};

const _wave = {
  speed: 14,
  up: 0.6,
  life: 1.8,
  size: [2.5, 6] as const,
  color: C.dust,
  alpha: 0.5,
  drag: 1.1,
  dir: [0, 0.05, 0] as [number, number, number],
  spread: 0.1,
};

function setRgb(hex: number): readonly [number, number, number] {
  _rgb[0] = ((hex >> 16) & 255) / 255;
  _rgb[1] = ((hex >> 8) & 255) / 255;
  _rgb[2] = (hex & 255) / 255;
  return _rgb;
}

function paint(fill: number, clock: number, range: number, fade = 1): typeof _paint {
  _paint.fill = fill;
  _paint.clock = clock;
  _paint.range = range;
  _paint.fade = fade;
  return _paint;
}

/** The Endless Song's pulses sung, off its aura's multiplier (online, a
 *  stack count of one is never on the wire; the value always is). */
function songPulses(e: Entity): number {
  const auras = e.auras;
  for (let i = 0; i < auras.length; i++)
    if (auras[i].id === COUNCIL_AURAS.endlessSong) return songPulsesOf(auras[i].value);
  return 0;
}
const _song = { mult: 1, rings: 1, bright: 0, floor: 0 };

export class CouncilSoulFx {
  private readonly slots: SoulSlot[] = [];
  constructor(
    private readonly h: CouncilFxHost,
    private readonly pillars: CouncilPillarsFx,
    private readonly shelters: CouncilShelters,
  ) {
    const ringGeo = new THREE.RingGeometry(0.9, 1, 120, 1).rotateX(-Math.PI / 2);
    this.h.geometries.push(ringGeo);
    const ringMat = (name: string, notches: number, spin: number) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: {
          uAlpha: { value: 0 },
          uTime: this.h.uTime,
          uNotches: { value: notches },
          uSpin: { value: spin },
          uColor: { value: new THREE.Color(SOUL_COLORS.singer.hex) },
        },
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      this.h.materials.push(m);
      return m;
    };
    for (let i = 0; i < POOLS.souls; i++) {
      const outer = this.h.kit.fan(16);
      const inner = this.h.kit.fan(18);
      outer.group.visible = false;
      inner.group.visible = false;
      const floorMat = ringMat('smithHeartSongFloor', 18, 0.04);
      const floor = new THREE.Mesh(ringGeo, floorMat);
      floor.name = 'smithHeartSongFloor';
      floor.renderOrder = floorVfxRenderOrder('encounter', 22);
      floor.visible = false;
      floor.frustumCulled = false;
      this.h.root.add(floor);
      const clockMat = ringMat('smithHeartSongClock', 0, 0);
      const clock = new THREE.Mesh(ringGeo, clockMat);
      clock.name = 'smithHeartSongClock';
      clock.renderOrder = floorVfxRenderOrder('encounter', 23);
      clock.visible = false;
      clock.frustumCulled = false;
      this.h.root.add(clock);
      this.slots.push({
        pillarId: -1,
        role: null,
        seen: false,
        outer,
        inner,
        floor,
        floorMat,
        clock,
        clockMat,
        echoAt: -99,
        drapedX: Number.NaN,
        drapedZ: Number.NaN,
        embers: 0,
      });
    }
  }

  beginScan(): void {
    for (const s of this.slots) s.seen = false;
  }

  /** A soul pillar seen by the scan. */
  seeSoul(e: Entity, role: CouncilRole): void {
    let s = this.slots.find((q) => q.pillarId === e.id);
    if (!s) {
      s = this.slots.find((q) => q.pillarId < 0);
      if (!s) return;
      s.pillarId = e.id;
      s.role = role;
      s.echoAt = -99;
      s.drapedX = Number.NaN;
      s.drapedZ = Number.NaN;
      if (role === 'slabwright') {
        this.h.kit.layOutFan(s.outer, 360, {
          color: TELEGRAPH_THREAT_COLORS.danger,
          accent: SOUL_COLORS.slabwright.hex,
        });
        this.h.kit.layOutFan(s.inner, 360, {
          color: TELEGRAPH_THREAT_COLORS.lethal,
          accent: SOUL_COLORS.slabwright.hex,
        });
        s.outer.group.visible = true;
        s.inner.group.visible = true;
      } else if (role === 'guardian') {
        this.h.kit.layOutFan(s.outer, 360, { color: ECHO_SPEC.color, accent: ECHO_SPEC.accent });
      } else {
        (s.floorMat.uniforms.uColor.value as THREE.Color).setHex(SOUL_COLORS.singer.hex);
        (s.clockMat.uniforms.uColor.value as THREE.Color).setHex(0xeaf6ff);
        s.floor.visible = true;
      }
    }
    s.seen = true;
  }

  endScan(): void {
    for (const s of this.slots) if (s.pillarId >= 0 && !s.seen) this.free(s);
  }

  private free(s: SoulSlot): void {
    if (s.role === 'guardian') this.freeWedges();
    this.pillars.charge.delete(s.pillarId);
    s.pillarId = -1;
    s.role = null;
    s.outer.group.visible = false;
    s.inner.group.visible = false;
    s.floor.visible = false;
    s.clock.visible = false;
  }

  private freeWedges(): void {
    this.shelters.hide('echo');
  }

  /** Lay the Echo's real shadows behind every soulless pillar it reaches. */
  private layWedges(x: number, z: number): void {
    this.shelters.lay('echo', x, z, ECHO_SPEC.radius);
  }

  // ---- the frame ----------------------------------------------------------------------------

  update(dt: number, clock: number): void {
    for (const s of this.slots) {
      if (s.pillarId < 0) continue;
      const e = this.h.entity(s.pillarId);
      const at = this.pillars.standing(s.pillarId);
      if (!e || !at) continue;
      if (s.role === 'guardian') this.updateEcho(s, e, at, clock, dt);
      else if (s.role === 'slabwright') this.updateSlab(s, e, at, clock);
      else this.updateSong(s, e, at, clock);
    }
  }

  private updateEcho(
    s: SoulSlot,
    e: Entity,
    at: { x: number; y: number; z: number; height: number; radius: number },
    clock: number,
    dt: number,
  ): void {
    const casting = e.castingAbility === COUNCIL_CASTS.echo && e.castTotal > 0;
    if (!casting) {
      if (s.outer.group.visible) {
        s.outer.group.visible = false;
        this.freeWedges();
      }
      this.pillars.charge.set(s.pillarId, 0);
      return;
    }
    if (!s.outer.group.visible) {
      // The bar began: the ring and the shelters, laid once (the cover is
      // re-laid on each scan below, so a pillar falling mid-bar is dropped).
      this.h.kit.drapeFan(s.outer, this.h.groundY, at.x, at.y, at.z, 0, ECHO_SPEC.radius);
      s.outer.group.visible = true;
      s.echoAt = clock;
      this.layWedges(at.x, at.z);
    } else if (clock - s.echoAt > 0.25) {
      s.echoAt = clock;
      this.layWedges(at.x, at.z);
    }
    const fill = Math.max(0, Math.min(1, 1 - e.castRemaining / e.castTotal));
    this.h.kit.paintFan(s.outer, paint(fill, clock, ECHO_SPEC.radius));
    // The shelters fade in over the bar's first moments.
    this.shelters.paint('echo', Math.min(0.92, 0.45 + fill * 2));
    this.pillars.charge.set(s.pillarId, fill);
    // Embers drawn in from the floor round it.
    if (this.h.density > 0.5) {
      s.embers += dt * (20 + fill * 50);
      setRgb(fill > 0.75 ? 0xfff0c8 : SOUL_COLORS.guardian.hex);
      while (s.embers >= 1) {
        s.embers -= 1;
        const a = this.h.rand() * Math.PI * 2;
        const r = at.radius + 3 + this.h.rand() * 7;
        _ember.speed = 6 + fill * 6;
        _ember.dir[0] = -Math.sin(a);
        _ember.dir[1] = 0.25;
        _ember.dir[2] = -Math.cos(a);
        this.h.particles.puff(
          at.x + Math.sin(a) * r,
          at.y + 0.5 + this.h.rand() * 2,
          at.z + Math.cos(a) * r,
          1,
          _ember,
        );
      }
    }
  }

  private updateSlab(
    s: SoulSlot,
    e: Entity,
    at: { x: number; y: number; z: number; radius: number },
    clock: number,
  ): void {
    // The sim's own footprint (its wall's radius), never the model's: a
    // walking soul pillar's template ends in its pips, its kind before them.
    const r = councilPillarRadius(e.templateId.charAt(e.templateId.length - 3) !== 'c');
    const grind = r + T.slabGrindReach;
    const crush = r + T.slabCrushReach;
    // Re-drape once it has walked a stride; between, the fans ride along.
    if (!(Math.abs(at.x - s.drapedX) <= 0.6 && Math.abs(at.z - s.drapedZ) <= 0.6)) {
      this.h.kit.drapeFan(s.outer, this.h.groundY, at.x, at.y, at.z, 0, grind);
      this.h.kit.drapeFan(s.inner, this.h.groundY, at.x, at.y, at.z, 0, crush);
      s.drapedX = at.x;
      s.drapedZ = at.z;
    } else {
      s.outer.group.position.x = at.x;
      s.outer.group.position.z = at.z;
      s.inner.group.position.x = at.x;
      s.inner.group.position.z = at.z;
    }
    this.h.kit.paintFan(s.outer, paint(1, clock, grind, 0.8));
    this.h.kit.paintFan(s.inner, paint(1, clock, crush));
  }

  private updateSong(
    s: SoulSlot,
    e: Entity,
    at: { x: number; y: number; z: number; radius: number },
    clock: number,
  ): void {
    const look = songLook(songPulses(e), _song);
    s.floor.position.set(at.x, at.y + 0.08, at.z);
    s.floor.scale.setScalar(at.radius + look.floor);
    s.floorMat.uniforms.uAlpha.value = look.bright * (0.75 + 0.25 * Math.sin(clock * 5));
    const singing = e.castingAbility === COUNCIL_CASTS.endlessSong && e.castTotal > 0;
    const left = singing ? Math.max(0, Math.min(1, e.castRemaining / e.castTotal)) : 0;
    s.clock.visible = singing;
    if (singing) {
      // The clock ring closes on the stone; the pulse leaves as it lands.
      s.clock.position.set(at.x, at.y + 0.1, at.z);
      s.clock.scale.setScalar(at.radius + look.floor + 0.4 + left * 9);
      s.clockMat.uniforms.uAlpha.value = 0.35 + 0.6 * (1 - left);
    }
    this.pillars.charge.set(s.pillarId, singing ? (1 - left) * 0.7 : 0);
  }

  // ---- the moments ------------------------------------------------------------------------

  /** `heart_echo_of_wrath_blast`: the Echo lands. */
  echoBlast(pillarId: number): void {
    const at = this.pillars.standing(pillarId);
    if (!at) return;
    const { x, y, z } = at;
    this.h.particles.shockRing(x, z, TELEGRAPH_THREAT_COLORS.lethal, ECHO_SPEC.radius, 0.9);
    this.h.particles.shockRing(x, z, SOUL_COLORS.guardian.hex, ECHO_SPEC.radius * 0.55, 0.6);
    this.h.particles.shockRing(x, z, 0xfff0c8, at.radius + 5, 0.35);
    this.h.particles.puff(x, y + at.height * 0.6, z, 30, {
      speed: 8,
      up: 1,
      life: 0.6,
      size: [2.5, 7],
      color: setRgb(0xffb070),
      alpha: 0.85,
      pool: 'glow',
      radius: at.radius,
    });
    // The wave of dust rolling out over the floor.
    const n = Math.round(36 * this.h.density);
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2 + this.h.rand() * 0.2;
      _wave.dir[0] = Math.sin(a);
      _wave.dir[2] = Math.cos(a);
      this.h.particles.puff(
        x + Math.sin(a) * (at.radius + 1),
        y + 0.6,
        z + Math.cos(a) * (at.radius + 1),
        1,
        _wave,
      );
    }
    this.h.shakeNear(x, z, 0.8, 55);
  }

  /** `heart_endless_song_pulse`: the song pulses over the whole Quarry. */
  songPulse(pillarId: number): void {
    const at = this.pillars.standing(pillarId);
    const e = this.h.entity(pillarId);
    if (!at || !e) return;
    const look = songLook(Math.max(0, songPulses(e) - 1), _song);
    for (let i = 0; i < look.rings; i++) {
      const r = 50 - i * 9;
      this.h.particles.shockRing(
        at.x,
        at.z,
        i === 0 ? 0xeaf6ff : SOUL_COLORS.singer.hex,
        r,
        1.1 + i * 0.15,
      );
    }
    this.h.particles.shockRing(at.x, at.z, SOUL_COLORS.singer.hex, at.radius + 3, 0.4);
    this.h.particles.puff(at.x, at.y + at.height * 0.75, at.z, Math.round(10 + look.bright * 16), {
      speed: 4,
      up: 1.5,
      life: 0.8,
      size: [1.2, 0.3],
      color: setRgb(SOUL_COLORS.singer.hex),
      alpha: 0.9,
      pool: 'glow',
      radius: at.radius,
    });
    this.h.shakeNear(at.x, at.z, 0.08 + 0.12 * look.bright, 50);
  }

  /** `heart_walking_slab_crush`: the slab runs a player down. */
  slabCrush(targetId: number): void {
    const p = this.h.entity(targetId);
    if (!p) return;
    const y = this.h.groundY(p.pos.x, p.pos.z);
    const n = Math.round(30 * this.h.density);
    for (let i = 0; i < n; i++) {
      const a = this.h.rand() * Math.PI * 2;
      const sp = 3 + this.h.rand() * 7;
      this.h.debris.throw(
        p.pos.x,
        y + 0.8,
        p.pos.z,
        Math.sin(a) * sp,
        3 + this.h.rand() * 5,
        Math.cos(a) * sp,
        0.2 + this.h.rand() * 0.5,
      );
    }
    this.h.particles.shockRing(p.pos.x, p.pos.z, TELEGRAPH_THREAT_COLORS.lethal, 3.5, 0.35);
    this.h.particles.puff(p.pos.x, y + 0.8, p.pos.z, 14, {
      speed: 4,
      up: 1,
      life: 1.4,
      size: [1.5, 4],
      color: C.dust,
      alpha: 0.5,
    });
    // A heavy stone running a player down: the ground itself jolts.
    this.h.shakeNear(p.pos.x, p.pos.z, 0.75, 30);
  }
}
