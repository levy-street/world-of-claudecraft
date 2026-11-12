// Bankshot (skill event 13, owner card 2026-11-12): a field of standing stones
// fought on hearts. Your bolt is harmless while it flies straight; it wounds
// only after it has bounced off stone (or the field's wall) at least once, and
// then it takes a heart from the FIRST fighter it touches, its owner included.
//
//   bolt   an aimed shot along your facing, BOLT_SPEED yards a second, bouncing
//          up to MAX_BOUNCES times. BOLT_COOLDOWN seconds;
//   brace  a BRACE_WINDOW-second reflect: a bolt that reaches you sends back
//          the way it came, yours now. BRACE_COOLDOWN seconds;
//   dash   a short dodge, DASH_DISTANCE yards. DASH_COOLDOWN seconds.
//
// The stones are drawn once per event from the event's own seeded stream. The
// field closes from the arena's radius to FIELD_MIN_RADIUS over
// FIELD_CLOSE_SECONDS and brings the stones in with it (their offsets scale
// with the field). The stones and the wall are solid to fighters: anyone
// inside a stone or past the wall is set back on its edge every tick. Win: the
// last fighter standing who took at least one heart from someone else with
// their own bolt.

import { relocateSwept } from '../combat/heroic_leap';
import { Rng } from '../rng';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { DT } from '../types';
import { kitFor, verbReady } from './skill_event_kit';
import { heartFighting, lastFighterStandingTick } from './skill_event_last_standing';
import { SKILL_EVENT_RADIUS } from './skill_event_rules';
import type { ActiveSkillEvent, SkillEventRuleSet, SkillEventStance } from './skill_events';

export const BANKSHOT_BOLT_SPEED = 24;
export const BANKSHOT_BOLT_COOLDOWN = 1;
export const BANKSHOT_MAX_BOUNCES = 3;
export const BANKSHOT_BOLT_LIFETIME = 3;
export const BANKSHOT_BRACE_WINDOW = 0.25;
export const BANKSHOT_BRACE_COOLDOWN = 5;
export const BANKSHOT_DASH_DISTANCE = 6;
export const BANKSHOT_DASH_COOLDOWN = 6;
export const BANKSHOT_FIELD_MIN_RADIUS = 9;
export const BANKSHOT_FIELD_CLOSE_SECONDS = 360;
export const BANKSHOT_STONE_COUNT = 7;
export const BANKSHOT_STONE_RADIUS = 1.2;
/** How close a bolt must pass to touch a fighter. */
const HIT_RADIUS = 0.7;
/** A fighter's body against a stone or the wall. */
const BODY_RADIUS = 0.4;
/** Collision substeps per tick: a bolt moves at most 0.4 yd between checks. */
const SUBSTEPS = 3;
/** Where a bolt leaves its shooter, ahead of the body. */
const MUZZLE = 0.9;
/** After a brace a bolt ignores the bracer this long, so it cannot hit them at once. */
const BRACE_IGNORE = 0.2;
/** Stones keep this far apart, and this far inside the starting field's edge. */
const STONE_SPACING = 5;
const STONE_MARGIN = 5;
const STONE_SALT = 0x5b07e5;

/** One stone, as an offset from the arena centre at the full field. */
export interface BankshotStone {
  dx: number;
  dz: number;
  r: number;
}

export interface BankshotBolt {
  id: number;
  owner: number;
  x: number;
  z: number;
  /** Unit direction of flight. */
  dx: number;
  dz: number;
  bounces: number;
  born: number;
  /** A fighter this bolt passes through until `ignoreUntil` (a bracer). */
  ignoreId: number;
  ignoreUntil: number;
}

export interface BankshotBook {
  stones: BankshotStone[];
  bolts: BankshotBolt[];
  nextId: number;
}

/** The event's stones and bolts, drawn on first use. */
export function bankshotBookOf(ctx: SimContext, ev: ActiveSkillEvent): BankshotBook {
  if (!ev.bankshot) {
    ev.bankshot = { stones: placeStones(ctx, ev.ordinal), bolts: [], nextId: 1 };
  }
  return ev.bankshot;
}

/** The stone field for an event: rejection-sampled from a private stream, so
 *  every host draws the same field and no shared draw order moves. */
export function placeStones(ctx: SimContext, ordinal: number): BankshotStone[] {
  const rng = new Rng((ctx.cfg.seed ^ Math.imul(ordinal + 1, 0x2545f491) ^ STONE_SALT) >>> 0);
  const stones: BankshotStone[] = [];
  const reach = SKILL_EVENT_RADIUS - STONE_MARGIN;
  for (let tries = 0; stones.length < BANKSHOT_STONE_COUNT && tries < 400; tries++) {
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.next()) * reach;
    const dx = Math.cos(a) * d;
    const dz = Math.sin(a) * d;
    if (Math.hypot(dx, dz) < STONE_SPACING / 2) continue; // keep the centre open
    if (stones.some((s) => Math.hypot(s.dx - dx, s.dz - dz) < STONE_SPACING)) continue;
    stones.push({ dx, dz, r: BANKSHOT_STONE_RADIUS });
  }
  return stones;
}

/** The field's radius at `now`: the arena's until the start, closing linearly. */
export function bankshotFieldRadius(ev: ActiveSkillEvent, now: number): number {
  const t = Math.min(1, Math.max(0, (now - ev.startsAt) / BANKSHOT_FIELD_CLOSE_SECONDS));
  return SKILL_EVENT_RADIUS + (BANKSHOT_FIELD_MIN_RADIUS - SKILL_EVENT_RADIUS) * t;
}

/** The stones where they stand at `now` (their offsets scale with the field). */
export function bankshotStonesAt(
  ev: ActiveSkillEvent,
  stones: readonly BankshotStone[],
  now: number,
): { x: number; z: number; r: number }[] {
  const k = bankshotFieldRadius(ev, now) / SKILL_EVENT_RADIUS;
  return stones.map((s) => ({ x: ev.x + s.dx * k, z: ev.z + s.dz * k, r: s.r }));
}

function action(ctx: SimContext, ev: ActiveSkillEvent, pid: number, verb: string): boolean {
  const p = ctx.entities.get(pid);
  if (!heartFighting(ev, p)) return false;
  const kit = kitFor(ev, pid);
  const now = ctx.time;
  switch (verb) {
    case 'bolt': {
      if (!verbReady(kit, 'bolt', now)) return false;
      kit.readyAt.set('bolt', now + BANKSHOT_BOLT_COOLDOWN);
      const book = bankshotBookOf(ctx, ev);
      const dx = Math.sin(p.facing);
      const dz = Math.cos(p.facing);
      book.bolts.push({
        id: book.nextId++,
        owner: pid,
        x: p.pos.x + dx * MUZZLE,
        z: p.pos.z + dz * MUZZLE,
        dx,
        dz,
        bounces: 0,
        born: now,
        ignoreId: pid,
        ignoreUntil: now + BRACE_IGNORE,
      });
      return true;
    }
    case 'brace': {
      if (!verbReady(kit, 'brace', now)) return false;
      kit.readyAt.set('brace', now + BANKSHOT_BRACE_COOLDOWN);
      kit.braceUntil = now + BANKSHOT_BRACE_WINDOW;
      return true;
    }
    case 'dash': {
      if (!verbReady(kit, 'dash', now)) return false;
      relocateSwept(ctx, p, {
        x: p.pos.x + Math.sin(p.facing) * BANKSHOT_DASH_DISTANCE,
        y: p.pos.y,
        z: p.pos.z + Math.cos(p.facing) * BANKSHOT_DASH_DISTANCE,
      });
      kit.readyAt.set('dash', now + BANKSHOT_DASH_COOLDOWN);
      return true;
    }
    default:
      return false;
  }
}

/** Reflect a unit direction off a surface with unit normal (nx, nz). */
function reflect(b: BankshotBolt, nx: number, nz: number): void {
  const dot = b.dx * nx + b.dz * nz;
  b.dx -= 2 * dot * nx;
  b.dz -= 2 * dot * nz;
}

/** Bounce a bolt off any stone or the wall it has crossed; true when it did. */
function bounce(
  b: BankshotBolt,
  ev: ActiveSkillEvent,
  stones: readonly { x: number; z: number; r: number }[],
  field: number,
): boolean {
  for (const s of stones) {
    const ox = b.x - s.x;
    const oz = b.z - s.z;
    const d = Math.hypot(ox, oz);
    if (d >= s.r) continue;
    const nx = d > 1e-6 ? ox / d : -b.dx;
    const nz = d > 1e-6 ? oz / d : -b.dz;
    if (b.dx * nx + b.dz * nz < 0) reflect(b, nx, nz);
    b.x = s.x + nx * (s.r + 0.01);
    b.z = s.z + nz * (s.r + 0.01);
    return true;
  }
  const ox = b.x - ev.x;
  const oz = b.z - ev.z;
  const d = Math.hypot(ox, oz);
  if (d <= field) return false;
  const nx = ox / d;
  const nz = oz / d;
  if (b.dx * nx + b.dz * nz > 0) reflect(b, nx, nz);
  b.x = ev.x + nx * (field - 0.01);
  b.z = ev.z + nz * (field - 0.01);
  return true;
}

/** Set a fighter back on the edge of any stone they stand in, and inside the wall. */
function keepOutOfStones(
  e: Entity,
  ev: ActiveSkillEvent,
  stones: readonly { x: number; z: number; r: number }[],
  field: number,
): void {
  for (const s of stones) {
    const ox = e.pos.x - s.x;
    const oz = e.pos.z - s.z;
    const d = Math.hypot(ox, oz);
    const min = s.r + BODY_RADIUS;
    if (d >= min) continue;
    const nx = d > 1e-6 ? ox / d : 1;
    const nz = d > 1e-6 ? oz / d : 0;
    e.pos.x = s.x + nx * min;
    e.pos.z = s.z + nz * min;
  }
  const ox = e.pos.x - ev.x;
  const oz = e.pos.z - ev.z;
  const d = Math.hypot(ox, oz);
  const max = field - BODY_RADIUS;
  if (d > max && d > 1e-6) {
    e.pos.x = ev.x + (ox / d) * max;
    e.pos.z = ev.z + (oz / d) * max;
  }
}

/** A harmful bolt reached a fighter: a brace turns it back, anything else is a hit. */
function touch(ctx: SimContext, ev: ActiveSkillEvent, b: BankshotBolt, t: Entity): boolean {
  const now = ctx.time;
  const kit = ev.kits.get(t.id);
  if (kit && now < (kit.braceUntil ?? 0)) {
    b.dx = -b.dx;
    b.dz = -b.dz;
    b.owner = t.id; // the bolt is the bracer's now
    b.ignoreId = t.id;
    b.ignoreUntil = now + BRACE_IGNORE;
    return false;
  }
  const owner = ctx.entities.get(b.owner);
  if (owner) {
    ev.verbHitFrom = owner.id;
    try {
      ctx.dealDamage(owner, t, 1, false, 'physical', null, 'hit');
    } finally {
      ev.verbHitFrom = null;
    }
  }
  return true; // the bolt is spent
}

function everyTick(ctx: SimContext, ev: ActiveSkillEvent): void {
  const book = bankshotBookOf(ctx, ev);
  const now = ctx.time;
  const field = bankshotFieldRadius(ev, now);
  const stones = bankshotStonesAt(ev, book.stones, now);
  const fighters: Entity[] = [];
  for (const pid of ev.hearts.keys()) {
    const e = ctx.entities.get(pid);
    if (heartFighting(ev, e)) {
      keepOutOfStones(e, ev, stones, field);
      fighters.push(e);
    }
  }
  const step = (BANKSHOT_BOLT_SPEED * DT) / SUBSTEPS;
  const live: BankshotBolt[] = [];
  for (const b of book.bolts) {
    let spent = now - b.born > BANKSHOT_BOLT_LIFETIME;
    for (let i = 0; i < SUBSTEPS && !spent; i++) {
      b.x += b.dx * step;
      b.z += b.dz * step;
      if (bounce(b, ev, stones, field) && ++b.bounces > BANKSHOT_MAX_BOUNCES) {
        spent = true;
        break;
      }
      if (b.bounces === 0) continue; // harmless while it flies straight
      for (const f of fighters) {
        if (f.id === b.ignoreId && now < b.ignoreUntil) continue;
        if (Math.hypot(f.pos.x - b.x, f.pos.z - b.z) > HIT_RADIUS) continue;
        if (touch(ctx, ev, b, f)) spent = true;
        break;
      }
    }
    if (!spent) live.push(b);
  }
  book.bolts = live;
}

function stanceOf(
  ctx: SimContext,
  ev: ActiveSkillEvent,
  pid: number,
): SkillEventStance | undefined {
  return ctx.time < (ev.kits.get(pid)?.braceUntil ?? 0) ? { stance: 'brace' } : undefined;
}

function end(_ctx: SimContext, ev: ActiveSkillEvent): void {
  if (ev.bankshot) ev.bankshot.bolts = [];
}

export const BANKSHOT_RULES: SkillEventRuleSet = {
  killsToWin: Number.POSITIVE_INFINITY,
  start: (ctx, ev) => {
    bankshotBookOf(ctx, ev);
  },
  action,
  everyTick,
  tick: lastFighterStandingTick,
  end,
  stanceOf,
  fieldRadius: bankshotFieldRadius,
};
