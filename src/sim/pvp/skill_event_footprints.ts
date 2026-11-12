// Footprints in Ash (skill event 11, owner card 2026-11-12): every fighter is
// unseen, and all anyone can see of the others is the footprints they leave in
// the ash. Fought on hearts:
//
//   sweep   a short cone in front: a hit takes one heart and reveals BOTH
//           fighters for REVEAL seconds; a miss reveals only you;
//   hush    walk without leaving prints for HUSH seconds;
//   pebble  throw a line of false footprints PEBBLE_LENGTH yards long, laid as
//           if someone had just walked away from you.
//
// Footprints fade after MARK_LIFETIME seconds. A fighter who stands still for
// BREATH_AFTER seconds shows a breath plume every second. The ash field closes
// from the arena's radius to FIELD_MIN_RADIUS over FIELD_CLOSE_SECONDS, and a
// fighter outside it is seen by everyone. Win: the last fighter with hearts
// left, who landed at least one Sweep.
//
// Unseen is a flag on the entity (`eventUnseen`): the server's interest scan
// stops sending the fighter to anyone else (server/entity_observation.ts), and
// offline the renderer hides the model. The marks reach each fighter on their
// own self wire, only the ones new since the last send (server/world_pvp_wire.ts).

import type { SkillEventMark } from '../../world_api/world_pvp';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { type FootprintsKitState, kitFor, verbReady } from './skill_event_kit';
import { heartFighting, lastFighterStandingTick } from './skill_event_last_standing';
import { SKILL_EVENT_RADIUS } from './skill_event_rules';
import type { ActiveSkillEvent, SkillEventRuleSet } from './skill_events';

export const FOOTPRINTS_SWEEP_RANGE = 4;
export const FOOTPRINTS_SWEEP_RECOVERY = 1;
export const FOOTPRINTS_REVEAL = 2;
export const FOOTPRINTS_HUSH = 3;
export const FOOTPRINTS_HUSH_COOLDOWN = 15;
export const FOOTPRINTS_PEBBLE_LENGTH = 20;
export const FOOTPRINTS_PEBBLE_COOLDOWN = 10;
export const FOOTPRINTS_BREATH_AFTER = 4;
/** How long a mark stays readable (the card: footprints fade after 3 seconds). */
export const SKILL_EVENT_MARK_LIFETIME = 3;
export const FOOTPRINTS_FIELD_MIN_RADIUS = 6;
export const FOOTPRINTS_FIELD_CLOSE_SECONDS = 360;
/** Yards walked between two prints: one stride. */
const PRINT_STRIDE = 1.5;
/** A print sits this far off the walking line, left or right foot. */
const FOOT_OFFSET = 0.3;
/** Moving less than this from where you stopped still counts as standing. */
const STILL_TOLERANCE = 0.3;
const BREATH_INTERVAL = 1;
/** The pace a thrown trail pretends to (yards a second): a walk. */
const PEBBLE_PACE = 7;
/** Where a thrown trail starts, ahead of the thrower. */
const PEBBLE_START = 2;
/** Half-angle of the Sweep cone in front of the fighter. */
const SWEEP_CONE_COS = Math.cos(Math.PI / 3);
/** A hard cap on live marks, far above what a full arena leaves in 3 seconds. */
const MAX_MARKS = 512;

/** The event's ash: every live mark, oldest first by sequence. */
export interface FootprintsBook {
  marks: SkillEventMark[];
  nextSeq: number;
}

export function footprintsBookOf(ev: ActiveSkillEvent): FootprintsBook {
  if (!ev.footprints) ev.footprints = { marks: [], nextSeq: 1 };
  return ev.footprints;
}

function footState(ev: ActiveSkillEvent, p: Entity, now: number): FootprintsKitState {
  const kit = kitFor(ev, p.id);
  if (!kit.footprints) {
    kit.footprints = {
      hushUntil: 0,
      revealUntil: 0,
      lastPrintX: p.pos.x,
      lastPrintZ: p.pos.z,
      leftFoot: false,
      stillX: p.pos.x,
      stillZ: p.pos.z,
      stillSince: now,
      lastBreathAt: 0,
    };
  }
  return kit.footprints;
}

/** The ash field's radius at `now`: the arena's until the start, closing
 *  linearly to FIELD_MIN_RADIUS over FIELD_CLOSE_SECONDS. */
export function footprintsFieldRadius(ev: ActiveSkillEvent, now: number): number {
  const t = Math.min(1, Math.max(0, (now - ev.startsAt) / FOOTPRINTS_FIELD_CLOSE_SECONDS));
  return SKILL_EVENT_RADIUS + (FOOTPRINTS_FIELD_MIN_RADIUS - SKILL_EVENT_RADIUS) * t;
}

function addMark(
  book: FootprintsBook,
  x: number,
  z: number,
  heading: number,
  kind: SkillEventMark['kind'],
  at: number,
): void {
  if (book.marks.length >= MAX_MARKS) book.marks.shift();
  book.marks.push({ seq: book.nextSeq++, x, z, heading, kind, at });
}

/** One footprint at (x, z) on the walking line, nudged to the foot's side. */
function addPrint(
  book: FootprintsBook,
  x: number,
  z: number,
  heading: number,
  leftFoot: boolean,
  at: number,
): void {
  const side = leftFoot ? FOOT_OFFSET : -FOOT_OFFSET;
  // Perpendicular to the heading (facing convention: forward is sin, cos).
  addMark(book, x + Math.cos(heading) * side, z - Math.sin(heading) * side, heading, 'step', at);
}

/** The nearest living fighter in front of `p` within Sweep range, or null. */
export function sweepTarget(ctx: SimContext, ev: ActiveSkillEvent, p: Entity): Entity | null {
  const fx = Math.sin(p.facing);
  const fz = Math.cos(p.facing);
  let best: Entity | null = null;
  let bestD = FOOTPRINTS_SWEEP_RANGE;
  for (const pid of ev.hearts.keys()) {
    if (pid === p.id) continue;
    const t = ctx.entities.get(pid);
    if (!heartFighting(ev, t)) continue;
    const dx = t.pos.x - p.pos.x;
    const dz = t.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > bestD) continue;
    if (d > 0.01 && (dx * fx + dz * fz) / d < SWEEP_CONE_COS) continue;
    best = t;
    bestD = d;
  }
  return best;
}

function action(ctx: SimContext, ev: ActiveSkillEvent, pid: number, verb: string): boolean {
  const p = ctx.entities.get(pid);
  if (!heartFighting(ev, p)) return false;
  const kit = kitFor(ev, pid);
  const now = ctx.time;
  const st = footState(ev, p, now);
  switch (verb) {
    case 'sweep': {
      if (!verbReady(kit, 'sweep', now)) return false;
      kit.readyAt.set('sweep', now + FOOTPRINTS_SWEEP_RECOVERY);
      // Every swing is a bet with your own position: hit or miss, you show.
      st.revealUntil = now + FOOTPRINTS_REVEAL;
      const t = sweepTarget(ctx, ev, p);
      if (!t) return true;
      footState(ev, t, now).revealUntil = now + FOOTPRINTS_REVEAL;
      ev.verbHitFrom = p.id;
      try {
        ctx.dealDamage(p, t, 1, false, 'physical', null, 'hit');
      } finally {
        ev.verbHitFrom = null;
      }
      return true;
    }
    case 'hush': {
      if (!verbReady(kit, 'hush', now)) return false;
      st.hushUntil = now + FOOTPRINTS_HUSH;
      kit.readyAt.set('hush', now + FOOTPRINTS_HUSH_COOLDOWN);
      return true;
    }
    case 'pebble': {
      if (!verbReady(kit, 'pebble', now)) return false;
      kit.readyAt.set('pebble', now + FOOTPRINTS_PEBBLE_COOLDOWN);
      const book = footprintsBookOf(ev);
      const fx = Math.sin(p.facing);
      const fz = Math.cos(p.facing);
      let left = true;
      // Laid as a walk away from the thrower: the far end is the freshest.
      for (let d = PEBBLE_START; d <= FOOTPRINTS_PEBBLE_LENGTH + 1e-6; d += PRINT_STRIDE) {
        const at = now - (FOOTPRINTS_PEBBLE_LENGTH - d) / PEBBLE_PACE;
        addPrint(book, p.pos.x + fx * d, p.pos.z + fz * d, p.facing, left, at);
        left = !left;
      }
      return true;
    }
    default:
      return false;
  }
}

/** Prints, breath and the unseen flag, every tick. */
function everyTick(ctx: SimContext, ev: ActiveSkillEvent): void {
  const now = ctx.time;
  const book = footprintsBookOf(ev);
  const field = footprintsFieldRadius(ev, now);
  for (const pid of ev.participants) {
    const p = ctx.entities.get(pid);
    if (!p) continue;
    if (p.dead || (ev.hearts.get(pid) ?? 0) <= 0) {
      delete p.eventUnseen;
      continue;
    }
    const st = footState(ev, p, now);
    const dx = p.pos.x - st.lastPrintX;
    const dz = p.pos.z - st.lastPrintZ;
    const stride = Math.hypot(dx, dz);
    if (stride >= PRINT_STRIDE) {
      if (now >= st.hushUntil) {
        addPrint(book, p.pos.x, p.pos.z, Math.atan2(dx, dz), st.leftFoot, now);
        st.leftFoot = !st.leftFoot;
      }
      st.lastPrintX = p.pos.x;
      st.lastPrintZ = p.pos.z;
    }
    if (Math.hypot(p.pos.x - st.stillX, p.pos.z - st.stillZ) > STILL_TOLERANCE) {
      st.stillX = p.pos.x;
      st.stillZ = p.pos.z;
      st.stillSince = now;
    } else if (
      now - st.stillSince >= FOOTPRINTS_BREATH_AFTER &&
      now - st.lastBreathAt >= BREATH_INTERVAL
    ) {
      st.lastBreathAt = now;
      addMark(book, p.pos.x, p.pos.z, p.facing, 'breath', now);
    }
    const outside = Math.hypot(p.pos.x - ev.x, p.pos.z - ev.z) > field;
    if (now < st.revealUntil || outside) delete p.eventUnseen;
    else p.eventUnseen = true;
  }
  // Drop faded marks from the front (thrown trails are backdated, so a pass
  // over the whole list is the honest prune; it is a few hundred at most).
  const cutoff = now - SKILL_EVENT_MARK_LIFETIME;
  if (book.marks.length > 0 && book.marks.some((m) => m.at < cutoff)) {
    book.marks = book.marks.filter((m) => m.at >= cutoff);
  }
}

/** The event is over: everyone shows again. */
function end(ctx: SimContext, ev: ActiveSkillEvent): void {
  for (const pid of ev.participants) {
    const e = ctx.entities.get(pid);
    if (e) delete e.eventUnseen;
  }
  if (ev.footprints) ev.footprints.marks = [];
}

export const FOOTPRINTS_RULES: SkillEventRuleSet = {
  killsToWin: Number.POSITIVE_INFINITY,
  action,
  everyTick,
  tick: lastFighterStandingTick,
  end,
  fieldRadius: footprintsFieldRadius,
};
