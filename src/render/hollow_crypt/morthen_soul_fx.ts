// Morthen's Gravecall (host: morthen_rite_fx.ts; plan:
// morthen_rite_fx_core.ts): the Bound Souls are the trash engine's G5 walkers
// (sim: encounters/hollow_crypt/morthen_gravecall.ts), so the engine draws
// each orb (its soul-green core, halo, floor glow and the heading chevrons a
// player body-blocks along: trash_engine_fx/engine_walkers.ts, sized and
// tinted by WALKER_LOOKS) and its intercept and empower beats. This layer
// makes them his:
//  - the soul tearing out of its sarcophagus alcove: a column of soul light,
//    ghost fire bursting off the floor, wisps spiralling up (the Gravecall
//    spellfx on the new orb);
//  - each soul in flight: a big ghost-fire spirit, tongues of soul fire
//    licking up off it, wisps twisting round it and a long wake of fire and
//    smoke left behind along its path;
//  - its arrival: a surge through him (ghost fire bursting from his ribs, his
//    hoarded souls flaring), the deeper soul fire each Gorged stack lights
//    being morthen_fx.ts's; an interception: a burst of ghost fire on the body
//    that took it.
//
// The orb itself is the engine's (actionable, every tier); everything here is
// cosmetic and thins on the low tier.

import {
  MORTHEN_GRAVECALL,
  MORTHEN_SOUL_TEMPLATE,
  RITE_ALCOVE_SPOTS,
} from '../../sim/encounters/hollow_crypt/morthen_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { orbFollow, orbHover } from '../trash_engine_fx/trash_engine_fx_core';
import { cryptSlotOrigin } from './crypt_boss_fx_core';
import { MORTHEN_RIBS, morthenAnchor } from './morthen_fx_core';
import { BOUND_SOUL_LOOK, soulRise } from './morthen_rite_fx_core';
import type { RiteFxHost, RiteGlowMesh, RitePainter } from './morthen_rite_host';

const SOUL_SLOTS = 6;
const RISE_SLOTS = 4;
const WALKER_EMPOWER = 'trash_walker_empower';
const WALKER_INTERCEPT = 'trash_walker_intercept';

interface SoulSlot {
  orbId: number;
  x: number;
  y: number;
  z: number;
  seed: number;
  wake: number;
  heart: RiteGlowMesh;
}

interface RiseSlot {
  born: number;
  x: number;
  z: number;
  alive: boolean;
  column: RiteGlowMesh;
}

export class MorthenSoulFx implements RitePainter {
  private readonly souls: SoulSlot[] = [];
  private readonly rises: RiseSlot[] = [];
  /** The last souls whose tearing-out was drawn (a soul first seen without
   *  its cue, a late joiner's or a cue that raced its object, tears out then). */
  private readonly risen: number[] = [];
  /** Souls already spent (their orb can linger a snapshot after the beat). */
  private readonly retired: number[] = [];

  constructor(private readonly h: RiteFxHost) {
    for (let i = 0; i < SOUL_SLOTS; i++)
      this.souls.push({
        orbId: -1,
        x: 0,
        y: 0,
        z: 0,
        seed: i * 1.7,
        wake: 0,
        heart: h.halo(0xb8ff9a, 29),
      });
    for (let i = 0; i < RISE_SLOTS; i++)
      this.rises.push({ born: 0, x: 0, z: 0, alive: false, column: h.column(0x9dff7a, 23) });
  }

  // ------------------------------------------------------------------ events

  handleEvent(ev: SimEvent, world: IWorld): void {
    if (ev.type !== 'spellfx' || !ev.ability) return;
    if (ev.ability === MORTHEN_GRAVECALL) {
      const orb = world.entities.get(ev.targetId);
      if (orb) this.tearOut(orb);
      return;
    }
    if (ev.ability !== WALKER_EMPOWER && ev.ability !== WALKER_INTERCEPT) return;
    const slot = this.souls.find((s) => s.orbId === ev.sourceId);
    if (!slot) return;
    const target = world.entities.get(ev.targetId);
    if (ev.ability === WALKER_EMPOWER && target) this.surge(target, slot);
    else if (target) this.taken(target, slot);
    this.retired.push(slot.orbId);
    if (this.retired.length > 8) this.retired.shift();
    slot.orbId = -1;
    slot.heart.mesh.visible = false;
  }

  private atAlcove(e: Entity): boolean {
    const o = cryptSlotOrigin(e.pos.x, e.pos.z);
    for (const a of RITE_ALCOVE_SPOTS)
      if (Math.hypot(e.pos.x - o.x - a.x, e.pos.z - o.z - a.z) < 2.5) return true;
    return false;
  }

  /** The soul tears out of its alcove (once per soul). */
  private tearOut(orb: Entity): void {
    if (this.risen.includes(orb.id)) return;
    this.risen.push(orb.id);
    if (this.risen.length > 8) this.risen.shift();
    const h = this.h;
    const now = h.clock();
    const r = this.rises.find((q) => !q.alive) ?? this.rises[0];
    r.alive = true;
    r.born = now;
    r.x = orb.pos.x;
    r.z = orb.pos.z;
    r.column.mesh.visible = true;
    const gy = h.groundY(orb.pos.x, orb.pos.z);
    h.wave(orb.pos.x, orb.pos.z, 5, 0.5, 0x9dff7a, 0.3);
    h.flash(orb.pos.x, gy + 1.6, orb.pos.z, 7, 0.45, 0xb8ff9a);
    const n = Math.round(80 * h.density);
    for (let i = 0; i < n; i++) {
      const a = h.rand() * Math.PI * 2;
      const rr = h.rand() * 1.4;
      {
        const ps = h.ps();
        ps.x = orb.pos.x + Math.sin(a) * rr;
        ps.y = gy + 0.1;
        ps.z = orb.pos.z + Math.cos(a) * rr;
        ps.vx = Math.sin(a) * 1.2;
        ps.vy = 4 + h.rand() * 5;
        ps.vz = Math.cos(a) * 1.2;
        ps.ay = 1.5;
        ps.life = 0.7 + h.rand() * 0.5;
        ps.drag = 0.9;
        ps.size0 = 0.9;
        ps.size1 = 2.2 + h.rand() * 1.5;
        ps.r = 0.95 + h.rand() * 0.15;
        ps.g = 0;
        ps.b = 0;
        ps.a = 0.9;
        h.fire.emit(now + h.rand() * 0.2, ps);
      }
      if (i % 2 === 0) {
        const tang = a + Math.PI / 2;
        {
          const ps = h.ps();
          ps.x = orb.pos.x + Math.sin(a) * 1.2;
          ps.y = gy + 0.4;
          ps.z = orb.pos.z + Math.cos(a) * 1.2;
          ps.vx = Math.sin(tang) * 3;
          ps.vy = 3 + h.rand() * 4;
          ps.vz = Math.cos(tang) * 3;
          ps.life = 1.2 + h.rand() * 0.6;
          ps.drag = 0.6;
          ps.size0 = 0.32;
          ps.size1 = 0.06;
          ps.r = 0.65;
          ps.g = 1;
          ps.b = 0.55;
          ps.a = 1;
          h.glow.emit(now + h.rand() * 0.3, ps);
        }
      }
    }
    {
      const ps = h.ps();
      ps.x = orb.pos.x;
      ps.y = gy + 0.8;
      ps.z = orb.pos.z;
      ps.vx = 0;
      ps.vy = 1.2;
      ps.vz = 0;
      ps.life = 1.8;
      ps.drag = 0.6;
      ps.size0 = 2.5;
      ps.size1 = 6;
      ps.r = 0.14;
      ps.g = 0.18;
      ps.b = 0.15;
      ps.a = 0.45;
      h.dust.emit(now, ps);
    }
    h.shakeAt(orb.pos.x, orb.pos.z, 0.12);
  }

  /** A soul reaches him: it surges through his ribs. */
  private surge(m: Entity, slot: SoulSlot): void {
    const h = this.h;
    const now = h.clock();
    const s = m.scale || 1;
    const ribs = morthenAnchor(m.pos, m.facing, s, MORTHEN_RIBS);
    h.flash(ribs.x, ribs.y, ribs.z, 8 * s, 0.5, 0xb8ff9a);
    const n = Math.round(90 * h.density);
    for (let i = 0; i < n; i++) {
      const a = h.rand() * Math.PI * 2;
      const el = (h.rand() - 0.2) * 1.4;
      const sp = 3 + h.rand() * 5;
      {
        const ps = h.ps();
        ps.x = ribs.x;
        ps.y = ribs.y;
        ps.z = ribs.z;
        ps.vx = Math.sin(a) * Math.cos(el) * sp;
        ps.vy = Math.sin(el) * sp + 2;
        ps.vz = Math.cos(a) * Math.cos(el) * sp;
        ps.ay = 1.5;
        ps.life = 0.6 + h.rand() * 0.4;
        ps.drag = 1.4;
        ps.size0 = 0.7 * s;
        ps.size1 = (1.4 + h.rand()) * s;
        ps.r = 1.05;
        ps.g = 0;
        ps.b = 0;
        ps.a = 0.9;
        h.fire.emit(now + h.rand() * 0.15, ps);
      }
    }
    // The last of the soul streaking into him.
    const dx = ribs.x - slot.x;
    const dy = ribs.y - slot.y;
    const dz = ribs.z - slot.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    for (let i = 0; i < Math.round(24 * h.density); i++) {
      const ps = h.ps();
      ps.x = slot.x;
      ps.y = slot.y;
      ps.z = slot.z;
      ps.vx = (dx / d) * d * 3 + (h.rand() - 0.5);
      ps.vy = (dy / d) * d * 3 + (h.rand() - 0.5);
      ps.vz = (dz / d) * d * 3 + (h.rand() - 0.5);
      ps.life = 0.33;
      ps.drag = 0.2;
      ps.size0 = 0.5;
      ps.size1 = 0.2;
      ps.r = 0.75;
      ps.g = 1;
      ps.b = 0.6;
      ps.a = 1;
      h.glow.emit(now, ps);
    }
    h.shakeAt(m.pos.x, m.pos.z, 0.18);
  }

  /** A soul broken on the body that stood in its path. */
  private taken(p: Entity, slot: SoulSlot): void {
    const h = this.h;
    const now = h.clock();
    const gy = h.groundY(p.pos.x, p.pos.z);
    const n = Math.round(40 * h.density);
    for (let i = 0; i < n; i++) {
      const a = h.rand() * Math.PI * 2;
      {
        const ps = h.ps();
        ps.x = p.pos.x;
        ps.y = gy + 1.2;
        ps.z = p.pos.z;
        ps.vx = Math.sin(a) * 3.5;
        ps.vy = 1 + h.rand() * 2.5;
        ps.vz = Math.cos(a) * 3.5;
        ps.life = 0.5 + h.rand() * 0.3;
        ps.drag = 1.8;
        ps.size0 = 0.7;
        ps.size1 = 1.6;
        ps.r = 1;
        ps.g = 0;
        ps.b = 0;
        ps.a = 0.9;
        h.fire.emit(now, ps);
      }
    }
    h.flash(slot.x, slot.y, slot.z, 5, 0.3, 0xd8ffc0);
  }

  // ------------------------------------------------------------------- frame

  update(world: IWorld, dt: number): void {
    const h = this.h;
    const now = h.clock();
    for (const r of this.rises) {
      if (!r.alive) continue;
      const k = soulRise(now - r.born);
      if (k <= 0 && now - r.born > 0.2) {
        r.alive = false;
        r.column.mesh.visible = false;
        continue;
      }
      const gy = h.groundY(r.x, r.z);
      r.column.mesh.position.set(r.x, gy, r.z);
      r.column.mesh.scale.set(
        1.3 + 0.6 * k,
        16 * (0.4 + 0.6 * Math.min(1, (now - r.born) / 0.3)),
        1.3 + 0.6 * k,
      );
      r.column.mat.uniforms.uAlpha.value = 0.9 * k;
    }
    // Claim the souls the scan sees (its orb starts where it is: the alcove).
    for (const id of h.scan.souls) {
      let skip = false;
      for (let k = 0; k < this.retired.length; k++) if (this.retired[k] === id) skip = true;
      let slot: SoulSlot | null = null;
      for (const s of this.souls) {
        if (s.orbId === id) skip = true;
        else if (!slot && s.orbId < 0) slot = s;
      }
      if (skip) continue;
      const e = world.entities.get(id);
      if (!e || e.templateId !== MORTHEN_SOUL_TEMPLATE || !slot) continue;
      slot.orbId = id;
      slot.x = e.pos.x;
      slot.z = e.pos.z;
      slot.y = h.groundY(e.pos.x, e.pos.z) + BOUND_SOUL_LOOK.hover;
      slot.wake = 0;
      slot.heart.mesh.visible = true;
      // A soul first seen still at its alcove whose cue never came.
      if (this.atAlcove(e)) this.tearOut(e);
    }
    const k = orbFollow(dt);
    for (const s of this.souls) {
      if (s.orbId < 0) continue;
      const e = world.entities.get(s.orbId);
      if (!e) {
        s.orbId = -1;
        s.heart.mesh.visible = false;
        continue;
      }
      // Follow the orb the engine draws (the same smoothing and bob).
      const px = s.x;
      const pz = s.z;
      const gyT = h.groundY(e.pos.x, e.pos.z);
      s.x += (e.pos.x - s.x) * k;
      s.y += (gyT + orbHover(now, s.seed, BOUND_SOUL_LOOK.hover) - s.y) * k;
      s.z += (e.pos.z - s.z) * k;
      const vx = dt > 0 ? (s.x - px) / dt : 0;
      const vz = dt > 0 ? (s.z - pz) / dt : 0;
      s.heart.mesh.position.set(s.x, s.y, s.z);
      s.heart.mesh.scale.setScalar(BOUND_SOUL_LOOK.size * (2.4 + 0.3 * Math.sin(now * 7 + s.seed)));
      s.heart.mat.uniforms.uAlpha.value = 0.75;
      this.spirit(s, vx, vz, dt);
    }
  }

  /** A soul in flight: its ghost-fire body, the wisps round it and its wake. */
  private spirit(s: SoulSlot, vx: number, vz: number, dt: number): void {
    const h = this.h;
    const now = h.clock();
    const size = BOUND_SOUL_LOOK.size;
    s.wake += 70 * h.density * dt;
    while (s.wake >= 1) {
      s.wake -= 1;
      // Tongues licking up off the soul's body.
      {
        const ps = h.ps();
        ps.x = s.x + (h.rand() - 0.5) * 0.5 * size;
        ps.y = s.y - 0.3 * size + h.rand() * 0.4;
        ps.z = s.z + (h.rand() - 0.5) * 0.5 * size;
        ps.vx = -vx * 0.15;
        ps.vy = 1 + h.rand() * 1.2;
        ps.vz = -vz * 0.15;
        ps.ay = 1.2;
        ps.life = 0.45 + h.rand() * 0.25;
        ps.drag = 0.6;
        ps.size0 = 0.6 * size;
        ps.size1 = (0.9 + h.rand() * 0.5) * size;
        ps.r = 0.95 + h.rand() * 0.2;
        ps.g = 0;
        ps.b = 0;
        ps.a = 0.8;
        h.fire.emit(now, ps);
      }
      // The wake: fire and grave smoke left behind along its path.
      if (h.rand() < 0.55) {
        const ps = h.ps();
        ps.x = s.x + (h.rand() - 0.5) * 0.8;
        ps.y = s.y - 0.5 + h.rand() * 0.6;
        ps.z = s.z + (h.rand() - 0.5) * 0.8;
        ps.vx = 0;
        ps.vy = 0.5 + h.rand() * 0.4;
        ps.vz = 0;
        ps.ay = 0.5;
        ps.life = 0.9 + h.rand() * 0.5;
        ps.drag = 0.5;
        ps.size0 = 0.5 * size;
        ps.size1 = 0.15 * size;
        ps.r = 0.75;
        ps.g = 0;
        ps.b = 0;
        ps.a = 0.6;
        h.fire.emit(now, ps);
      }
      if (h.rand() < 0.25) {
        const ps = h.ps();
        ps.x = s.x;
        ps.y = s.y - 0.4;
        ps.z = s.z;
        ps.vx = (h.rand() - 0.5) * 0.4;
        ps.vy = 0.3;
        ps.vz = (h.rand() - 0.5) * 0.4;
        ps.life = 1.8 + h.rand();
        ps.drag = 0.4;
        ps.size0 = 0.8 * size;
        ps.size1 = 2.2 * size;
        ps.spin = (h.rand() - 0.5) * 0.6;
        ps.r = 0.12;
        ps.g = 0.16;
        ps.b = 0.13;
        ps.a = 0.32;
        h.dust.emit(now, ps);
      }
    }
    // Two wisps twisting round it.
    for (let w = 0; w < 2; w++) {
      if (h.rand() > 18 * h.density * dt) continue;
      const a = now * 5 + w * Math.PI + s.seed;
      {
        const ps = h.ps();
        ps.x = s.x + Math.cos(a) * 0.8 * size;
        ps.y = s.y + Math.sin(now * 3 + w) * 0.4;
        ps.z = s.z + Math.sin(a) * 0.8 * size;
        ps.vx = -Math.sin(a) * 1.5;
        ps.vy = 0.4;
        ps.vz = Math.cos(a) * 1.5;
        ps.life = 0.8;
        ps.drag = 0.4;
        ps.size0 = 0.28;
        ps.size1 = 0.05;
        ps.r = 0.72;
        ps.g = 1;
        ps.b = 0.6;
        ps.a = 1;
        h.glow.emit(now, ps);
      }
    }
  }
}
