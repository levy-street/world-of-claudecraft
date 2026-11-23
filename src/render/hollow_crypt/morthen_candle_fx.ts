// The four Remembrance Candles of Morthen's Rite (host: morthen_rite_fx.ts;
// plan: morthen_rite_fx_core.ts), read off the candles' encounter objects
// (their template carries the state), the lighters' relight bars and the
// candle spellfx cues:
//  - DARK: the decor's flame is snuffed (the kit's baked flame and the crypt
//    lamp's cone and halo hidden, its light down to an ember), a thread of
//    smoke curls off the wick and a dim cold glow keeps the candle findable;
//  - NAMED (heroic, the Ledger's next): a pulsing gold guide glow on the
//    candle, a glyph turning at its foot and a beam of light from the open
//    Ledger on the altar's lectern to its wick;
//  - LIT: a tall bright remembrance flame (warm holy fire, the answer to his
//    soul-green ghost fire) and a column of light rising off it, its lamp
//    burning brighter than the decor's;
//  - the relight: a stream of light from the lighter's chest to the wick
//    while the flame there swells with the bar, and the life it costs drawn
//    out of the lighter as dark motes pulled down the stream;
//  - lit: a big ignite burst; snuffed (heroic Name the Dead): the flame torn
//    off in a gout of ghost fire and smoke.
//
// A candle's state, the guide and the relight stream are what a player acts
// on: every tier. Smoke, sparks and motes thin on the low tier. The decor is
// reached through rite_candle_decor.ts (visibility, an instance matrix and a
// light's level: no program changes); no candle object = the decor's own look.

import * as THREE from 'three';
import {
  MORTHEN_CANDLE_LIT,
  MORTHEN_CANDLE_SNUFFED,
  MORTHEN_RELIGHT_CAST,
} from '../../sim/encounters/hollow_crypt/morthen_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { cryptSlotOrigin } from './crypt_boss_fx_core';
import {
  CANDLE_FLAME_TIP_Y,
  CANDLE_TALLOW_RADIUS,
  CANDLE_WICK_Y,
  type CandleLook,
  type CandleState,
  candleIndexAt,
  candleLook,
  candleStateOf,
  drainMoteRate,
  igniteFlash,
  RITE_LEDGER,
  relightFill,
} from './morthen_rite_fx_core';
import {
  placeBeam,
  RITE_MESH_VERT,
  type RiteFxHost,
  type RiteGlowMesh,
  type RitePainter,
} from './morthen_rite_host';

const CANDLES = 4;
const STREAMS = 4;
/** A player's chest over the floor (the stream leaves from here). */
const CHEST = 1.35;

/** The named candle's glyph turning at its foot (gold). */
const GLYPH_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
varying vec3 vLocal;
void main() {
  float r = length(vLocal.xz);
  float az = atan(vLocal.x, vLocal.z) + uTime * 0.8;
  float ring = (1.0 - smoothstep(0.0, 0.05, abs(r - 0.86))) + (1.0 - smoothstep(0.0, 0.035, abs(r - 0.68))) * 0.7;
  float ticks = (1.0 - smoothstep(0.0, 0.06, abs(fract(az * 1.909859) - 0.5))) * smoothstep(0.66, 0.7, r) * (1.0 - smoothstep(0.84, 0.88, r));
  float wash = (1.0 - smoothstep(0.0, 1.0, r)) * 0.18;
  float a = (ring + ticks * 0.8 + wash) * step(r, 1.0) * uAlpha;
  gl_FragColor = vec4(vec3(1.3, 1.08, 0.6), clamp(a, 0.0, 1.0));
}
`;

interface CandleSlot {
  objectId: number;
  state: CandleState;
  /** The state written into the decor, and the registry generation it went to. */
  index: number;
  /** The claimed slot's origin (its interior's decor is that slot's). */
  ox: number;
  oz: number;
  hasOrigin: boolean;
  /** When it last caught (the ignite flash rides the lamp). */
  litAt: number;
  x: number;
  z: number;
  floor: number;
  guide: RiteGlowMesh;
  ember: RiteGlowMesh;
  column: RiteGlowMesh;
  ledger: RiteGlowMesh;
  glyph: THREE.Mesh;
  glyphMat: THREE.ShaderMaterial;
  smoke: number;
  flame: number;
}

interface StreamSlot {
  playerId: number;
  beam: RiteGlowMesh;
  core: RiteGlowMesh;
  motes: number;
}

export class MorthenCandleFx implements RitePainter {
  private readonly slots: CandleSlot[] = [];
  private readonly streams: StreamSlot[] = [];
  private readonly look: CandleLook = candleLook('default', 0);
  private readonly seen = [false, false, false, false];
  private active = false;

  constructor(private readonly h: RiteFxHost) {
    const glyphGeo = h.own(new THREE.CircleGeometry(1, 64));
    glyphGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < CANDLES; i++) {
      const glyphMat = h.own(
        new THREE.ShaderMaterial({
          uniforms: { uTime: h.uTime, uAlpha: { value: 0 } },
          vertexShader: RITE_MESH_VERT,
          fragmentShader: GLYPH_FRAG,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      const glyph = new THREE.Mesh(glyphGeo, glyphMat);
      glyph.frustumCulled = false;
      glyph.visible = false;
      glyph.renderOrder = floorVfxRenderOrder('encounter', 4);
      h.root.add(glyph);
      this.slots.push({
        objectId: -1,
        state: 'default',
        index: i,
        ox: 0,
        oz: 0,
        hasOrigin: false,
        litAt: -1e6,
        x: 0,
        z: 0,
        floor: 0,
        guide: h.halo(0xffe6a0, 29),
        ember: h.halo(0x8fb6c4, 29),
        column: h.column(0xffe2a0, 23),
        ledger: h.beam(0xffe6a8, 1, 28),
        glyph,
        glyphMat,
        smoke: 0,
        flame: 0,
      });
    }
    for (let i = 0; i < STREAMS; i++) {
      this.streams.push({
        playerId: -1,
        beam: h.beam(0xffd98a, 1.4, 28),
        core: h.halo(0xffe7b0, 29),
        motes: 0,
      });
    }
  }

  // ------------------------------------------------------------------ events

  handleEvent(ev: SimEvent, world: IWorld): void {
    if (ev.type !== 'spellfx') return;
    if (ev.ability !== MORTHEN_CANDLE_LIT && ev.ability !== MORTHEN_CANDLE_SNUFFED) return;
    const obj = world.entities.get(ev.targetId);
    if (!obj) return;
    const slot = this.slotFor(obj);
    if (!slot) return;
    if (ev.ability === MORTHEN_CANDLE_LIT) this.ignite(slot);
    else this.snuff(slot);
  }

  private slotFor(obj: Entity): CandleSlot | null {
    const o = cryptSlotOrigin(obj.pos.x, obj.pos.z);
    const i = candleIndexAt(obj.pos.x - o.x, obj.pos.z - o.z);
    if (i < 0) return null;
    const s = this.slots[i];
    s.ox = o.x;
    s.oz = o.z;
    s.hasOrigin = true;
    s.x = obj.pos.x;
    s.z = obj.pos.z;
    s.floor = this.h.groundY(obj.pos.x, obj.pos.z);
    return s;
  }

  /** The candle catches: a column of holy fire bursts off the wick. */
  private ignite(s: CandleSlot): void {
    const h = this.h;
    const now = h.clock();
    s.litAt = now;
    const wy = s.floor + CANDLE_WICK_Y;
    h.flash(s.x, wy + 0.8, s.z, 9, 0.6, 0xfff0c8);
    h.flash(s.x, wy + 0.4, s.z, 4, 0.3, 0xffffff);
    h.wave(s.x, s.z, 7, 0.55, 0xffd27a, 0.25);
    const n = Math.round(70 * h.density) + 30;
    for (let i = 0; i < n; i++) {
      const a = h.rand() * Math.PI * 2;
      {
        const ps = h.ps();
        ps.x = s.x + Math.sin(a) * 0.3;
        ps.y = wy;
        ps.z = s.z + Math.cos(a) * 0.3;
        ps.vx = Math.sin(a) * 1.4;
        ps.vy = 6 + h.rand() * 6;
        ps.vz = Math.cos(a) * 1.4;
        ps.ay = 1.5;
        ps.life = 0.6 + h.rand() * 0.4;
        ps.drag = 1;
        ps.size0 = 0.8;
        ps.size1 = 2.2 + h.rand() * 1.4;
        ps.r = 1;
        ps.g = 0;
        ps.b = 0;
        ps.a = 0.95;
        h.holy.emit(now + h.rand() * 0.15, ps);
      }
    }
    const g = Math.round(110 * h.density);
    for (let i = 0; i < g; i++) {
      const a = h.rand() * Math.PI * 2;
      const el = h.rand() * 1.3;
      const sp = 4 + h.rand() * 7;
      {
        const ps = h.ps();
        ps.x = s.x;
        ps.y = wy + 0.5;
        ps.z = s.z;
        ps.vx = Math.sin(a) * Math.cos(el) * sp;
        ps.vy = Math.sin(el) * sp + 2;
        ps.vz = Math.cos(a) * Math.cos(el) * sp;
        ps.ay = -3;
        ps.life = 0.9 + h.rand() * 0.7;
        ps.drag = 1.1;
        ps.size0 = 0.3;
        ps.size1 = 0.06;
        ps.r = 1;
        ps.g = 0.85;
        ps.b = 0.45;
        ps.a = 1;
        h.glow.emit(now, ps);
      }
    }
    h.shakeAt(s.x, s.z, 0.22);
  }

  /** Name the Dead: the wrong candle snuffs this one in a gout of ghost fire. */
  private snuff(s: CandleSlot): void {
    const h = this.h;
    const now = h.clock();
    s.litAt = -1e6;
    const wy = s.floor + CANDLE_WICK_Y;
    h.flash(s.x, wy + 0.6, s.z, 6, 0.4, 0x6ad86a);
    h.wave(s.x, s.z, 5, 0.45, 0x8a5bd8, 0.3);
    const n = Math.round(50 * h.density) + 10;
    for (let i = 0; i < n; i++) {
      const a = h.rand() * Math.PI * 2;
      {
        const ps = h.ps();
        ps.x = s.x;
        ps.y = wy + 0.6;
        ps.z = s.z;
        ps.vx = Math.sin(a) * 4;
        ps.vy = 1 + h.rand() * 3;
        ps.vz = Math.cos(a) * 4;
        ps.life = 0.5 + h.rand() * 0.3;
        ps.drag = 2;
        ps.size0 = 0.8;
        ps.size1 = 1.6;
        ps.r = 0.9;
        ps.g = 0;
        ps.b = 0;
        ps.a = 0.9;
        h.fire.emit(now, ps);
      }
      {
        const ps = h.ps();
        ps.x = s.x;
        ps.y = wy + 0.4;
        ps.z = s.z;
        ps.vx = Math.sin(a) * 1.5;
        ps.vy = 1.5 + h.rand() * 2;
        ps.vz = Math.cos(a) * 1.5;
        ps.life = 1.6 + h.rand();
        ps.drag = 1;
        ps.size0 = 0.8;
        ps.size1 = 2.8;
        ps.spin = h.rand() - 0.5;
        ps.r = 0.08;
        ps.g = 0.07;
        ps.b = 0.09;
        ps.a = 0.55;
        h.dust.emit(now, ps);
      }
    }
    h.shakeAt(s.x, s.z, 0.15);
  }

  // ------------------------------------------------------------------- frame

  update(world: IWorld, dt: number): void {
    const h = this.h;
    const now = h.clock();
    const seen = this.seen;
    seen.fill(false);
    for (const id of h.scan.candles) {
      const e = world.entities.get(id);
      if (!e) continue;
      const s = this.slotFor(e);
      if (!s) continue;
      seen[s.index] = true;
      s.objectId = id;
      s.state = candleStateOf(e.templateId);
    }
    let any = false;
    for (let i = 0; i < CANDLES; i++) {
      const s = this.slots[i];
      if (!seen[i]) {
        s.objectId = -1;
        s.state = 'default';
      } else any = true;
    }
    // Outside the Rite (and the fight) the decor is left alone: write it back
    // once and stop.
    if (!any && !this.active) return;
    this.active = any;
    for (const s of this.slots) this.paintCandle(s, now, dt);
    this.stepStreams(world, dt);
  }

  private paintCandle(s: CandleSlot, now: number, dt: number): void {
    const h = this.h;
    const look = candleLook(s.state, now, this.look);
    // The decor: the flame shown or snuffed, the lamp's level (an ignite
    // flares it for a moment).
    const flare = 1 + 2.2 * igniteFlash(now - s.litAt);
    const level = Math.round(look.light * flare * 20) / 20;
    // Written every frame (cheap: the decor only touches what changed), so a
    // kit rebuilt in place under the Rite takes its look at once.
    if (s.hasOrigin) h.decor.set(s.ox, s.oz, s.index, look.decorFlame, level);
    const wy = s.floor + CANDLE_WICK_Y;
    // The dim cold glow of a snuffed wick (it is still found).
    s.ember.mesh.visible = look.ember > 0;
    if (look.ember > 0) {
      s.ember.mesh.position.set(s.x, wy + 0.1, s.z);
      s.ember.mesh.scale.setScalar(1.5);
      s.ember.mat.uniforms.uAlpha.value = look.ember * (0.85 + 0.15 * Math.sin(now * 2.3 + s.x));
    }
    // The guide the Ledger names (heroic).
    const named = look.guide > 0;
    s.guide.mesh.visible = named;
    s.ledger.mesh.visible = named;
    s.glyph.visible = named;
    if (named) {
      s.guide.mesh.position.set(s.x, wy + 0.4, s.z);
      s.guide.mesh.scale.setScalar(4.2 + 1.2 * look.guide);
      s.guide.mat.uniforms.uAlpha.value = 0.7 * look.guide;
      s.glyph.position.set(s.x, s.floor + 0.09, s.z);
      s.glyph.scale.setScalar(3.4);
      s.glyphMat.uniforms.uAlpha.value = 0.55 + 0.45 * look.guide;
      const o = cryptSlotOrigin(s.x, s.z);
      const lx = o.x + RITE_LEDGER.x;
      const lz = o.z + RITE_LEDGER.z;
      const ly = h.groundY(lx, lz) + RITE_LEDGER.y;
      placeBeam(s.ledger, lx, ly, lz, s.x, wy + 0.3, s.z, 0.09 + 0.03 * look.guide);
      s.ledger.mat.uniforms.uAlpha.value = 0.75 + 0.25 * look.guide;
      // Motes travel the beam from the open book to the candle.
      if (h.rand() < 9 * dt) {
        const dx = s.x - lx;
        const dy = wy + 0.3 - ly;
        const dz = s.z - lz;
        const d = Math.hypot(dx, dy, dz) || 1;
        {
          const ps = h.ps();
          ps.x = lx;
          ps.y = ly;
          ps.z = lz;
          ps.vx = (dx / d) * 9;
          ps.vy = (dy / d) * 9;
          ps.vz = (dz / d) * 9;
          ps.life = d / 9;
          ps.drag = 0.001;
          ps.size0 = 0.3;
          ps.size1 = 0.2;
          ps.r = 1;
          ps.g = 0.9;
          ps.b = 0.55;
          ps.a = 1;
          h.glow.emit(now, ps);
        }
      }
    }
    // A snuffed wick's thread of smoke.
    if (look.smoke > 0) {
      s.smoke += 7 * h.density * dt;
      while (s.smoke >= 1) {
        s.smoke -= 1;
        {
          const ps = h.ps();
          ps.x = s.x + (h.rand() - 0.5) * 0.1;
          ps.y = wy + 0.05;
          ps.z = s.z + (h.rand() - 0.5) * 0.1;
          ps.vx = (h.rand() - 0.5) * 0.25;
          ps.vy = 0.7 + h.rand() * 0.4;
          ps.vz = (h.rand() - 0.5) * 0.25;
          ps.life = 2.2 + h.rand();
          ps.drag = 0.3;
          ps.size0 = 0.2;
          ps.size1 = 1.1;
          ps.spin = (h.rand() - 0.5) * 0.8;
          ps.r = 0.32;
          ps.g = 0.33;
          ps.b = 0.34;
          ps.a = 0.3;
          h.dust.emit(now, ps);
        }
      }
    }
    // A relit candle: the tall remembrance flame and its column of light.
    s.column.mesh.visible = look.column > 0;
    if (look.column > 0) {
      s.column.mesh.position.set(s.x, wy + 0.2, s.z);
      s.column.mesh.scale.set(CANDLE_TALLOW_RADIUS * 0.85, 22, CANDLE_TALLOW_RADIUS * 0.85);
      s.column.mat.uniforms.uAlpha.value = 0.55 + 0.1 * Math.sin(now * 1.7 + s.z);
    }
    if (look.flame > 0) this.flame(s, wy, 1, dt, 1);
  }

  /** The remembrance flame on a wick (`k` its strength: a relight's swelling
   *  flame, or a relit candle's full tall one). */
  private flame(s: CandleSlot, wy: number, k: number, dt: number, height: number): void {
    const h = this.h;
    const now = h.clock();
    // The flame is the candle's state: a fixed rate on every tier.
    s.flame += (14 + 22 * k) * dt;
    while (s.flame >= 1) {
      s.flame -= 1;
      {
        const ps = h.ps();
        ps.x = s.x + (h.rand() - 0.5) * 0.25;
        ps.y = wy - 0.05;
        ps.z = s.z + (h.rand() - 0.5) * 0.25;
        ps.vx = (h.rand() - 0.5) * 0.3;
        ps.vy = (1.4 + h.rand() * 1.2) * height;
        ps.vz = (h.rand() - 0.5) * 0.3;
        ps.ay = 1.2 * height;
        ps.life = 0.5 + h.rand() * 0.3;
        ps.drag = 0.8;
        ps.size0 = (0.55 + 0.35 * k) * height;
        ps.size1 = (1 + 0.9 * k + h.rand() * 0.5) * height;
        ps.r = 0.95 + h.rand() * 0.15;
        ps.g = 0;
        ps.b = 0;
        ps.a = 0.6 + 0.35 * k;
        h.holy.emit(now, ps);
      }
    }
    if (h.rand() < 3 * k * h.density * dt) {
      const ps = h.ps();
      ps.x = s.x;
      ps.y = s.floor + CANDLE_FLAME_TIP_Y;
      ps.z = s.z;
      ps.vx = (h.rand() - 0.5) * 0.6;
      ps.vy = 1.4 + h.rand();
      ps.vz = (h.rand() - 0.5) * 0.6;
      ps.life = 1.2;
      ps.drag = 0.4;
      ps.size0 = 0.12;
      ps.size1 = 0.04;
      ps.r = 1;
      ps.g = 0.85;
      ps.b = 0.5;
      ps.a = 1;
      h.glow.emit(now, ps);
    }
  }

  /** The relights: a stream of light from each lighter to the wick, the flame
   *  there swelling with the bar, the lighter's life drawn down the stream. */
  private stepStreams(world: IWorld, dt: number): void {
    const h = this.h;
    const now = h.clock();
    const lighters = h.scan.lighters;
    for (const st of this.streams) {
      if (st.playerId < 0) continue;
      let still = false;
      for (let k = 0; k < lighters.length; k++) if (lighters[k] === st.playerId) still = true;
      if (!still) st.playerId = -1;
    }
    for (let k = 0; k < lighters.length; k++) {
      const id = lighters[k];
      let free: StreamSlot | null = null;
      let held = false;
      for (const st of this.streams) {
        if (st.playerId === id) held = true;
        else if (st.playerId < 0 && !free) free = st;
      }
      if (!held && free) free.playerId = id;
    }
    for (const st of this.streams) {
      const p = st.playerId >= 0 ? world.entities.get(st.playerId) : undefined;
      const body = p?.castTargetId != null ? world.entities.get(p.castTargetId) : undefined;
      const candle = body ? this.nearestCandle(body) : null;
      const on = !!p && !p.dead && !!candle && p.castingAbility === MORTHEN_RELIGHT_CAST;
      st.beam.mesh.visible = on;
      st.core.mesh.visible = on;
      if (!on || !p || !candle) continue;
      const fill = relightFill(p.castRemaining, p.castTotal);
      const gy = h.groundY(p.pos.x, p.pos.z);
      const ax = p.pos.x;
      const ay = gy + CHEST * (p.scale || 1);
      const az = p.pos.z;
      const wy = candle.floor + CANDLE_WICK_Y + 0.25;
      placeBeam(st.beam, ax, ay, az, candle.x, wy, candle.z, 0.07 + 0.08 * fill);
      st.beam.mat.uniforms.uAlpha.value = 0.65 + 0.35 * fill;
      st.core.mesh.position.set(candle.x, wy + 0.2, candle.z);
      st.core.mesh.scale.setScalar(1.6 + 3 * fill);
      st.core.mat.uniforms.uAlpha.value = 0.5 + 0.5 * fill;
      // The flame catching on the wick, swelling with the bar.
      if (candle.state !== 'lit')
        this.flame(candle, wy - 0.25, 0.25 + 0.75 * fill, dt, 0.6 + 0.6 * fill);
      // The price: dark motes drawn out of the lighter and down the stream.
      st.motes += drainMoteRate(fill) * h.density * dt;
      const dx = candle.x - ax;
      const dy = wy - ay;
      const dz = candle.z - az;
      const d = Math.hypot(dx, dy, dz) || 1;
      while (st.motes >= 1) {
        st.motes -= 1;
        const a = h.rand() * Math.PI * 2;
        const r = 0.35 + h.rand() * 0.4;
        const sx = ax + Math.sin(a) * r;
        const sy = gy + 0.3 + h.rand() * 1.6;
        const sz = az + Math.cos(a) * r;
        const speed = 5 + h.rand() * 3;
        {
          const ps = h.ps();
          ps.x = sx;
          ps.y = sy;
          ps.z = sz;
          ps.vx = ((candle.x - sx) / d) * speed;
          ps.vy = ((wy - sy) / d) * speed;
          ps.vz = ((candle.z - sz) / d) * speed;
          ps.life = Math.min(1.4, d / speed);
          ps.drag = 0.05;
          ps.size0 = 0.32;
          ps.size1 = 0.14;
          ps.spin = h.rand() * 3;
          ps.r = 0.16;
          ps.g = 0.02;
          ps.b = 0.08;
          ps.a = 0.75;
          h.dust.emit(now, ps);
        }
        if (h.rand() < 0.35) {
          const ps = h.ps();
          ps.x = sx;
          ps.y = sy;
          ps.z = sz;
          ps.vx = (dx / d) * speed;
          ps.vy = (dy / d) * speed;
          ps.vz = (dz / d) * speed;
          ps.life = Math.min(1.4, d / speed);
          ps.drag = 0.05;
          ps.size0 = 0.16;
          ps.size1 = 0.08;
          ps.r = 0.85;
          ps.g = 0.22;
          ps.b = 0.3;
          ps.a = 0.8;
          h.glow.emit(now, ps);
        }
      }
    }
  }

  /** The candle a relight's usable body stands at (its pillar's foot). */
  private nearestCandle(body: Entity): CandleSlot | null {
    let best: CandleSlot | null = null;
    let bestD = 5;
    for (const s of this.slots) {
      if (s.objectId < 0) continue;
      const d = Math.hypot(body.pos.x - s.x, body.pos.z - s.z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }
}
