// Rite of Tongues (skill event 12, owner card 2026-11-12): no damage at all.
// You score by finishing a chant in full view of everyone, and everyone has an
// interrupt. Inside one TONGUES_CIRCLE-yard circle:
//
//   rite         a CHANT-second chant, standing still. Completing it scores 1.
//                Being moved, rooted, stunned or silenced breaks it;
//   sever        the interrupt, on your target (or the nearest fighter in front
//                of you). It winds up for SEVER_WINDUP seconds where everyone
//                can see it, then lands: on a fighter still chanting it breaks
//                the chant and silences them for SILENCE seconds; on anyone
//                else it silences YOU. SEVER_COOLDOWN seconds;
//   false_start  drops your own chant at no cost: the bait for a Sever;
//   shove        pushes a fighter in reach SHOVE_DISTANCE yards away from you,
//                which breaks a chant. SHOVE_COOLDOWN seconds.
//
// Silenced, you can neither chant nor Sever. A chant needs at least two
// fighters inside the circle (alone, the circle does not form). Leaving the
// circle wipes your count. Win: the first to RITES_TO_WIN completed Rites.
// The Sever wind-up is the one design addition to the card: with an instant
// interrupt a False Start could never bait one.

import { isRooted, isSilenced } from '../combat/cc';
import { relocateSwept } from '../combat/heroic_leap';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { kitFor, type TonguesKitState, verbReady } from './skill_event_kit';
import type { ActiveSkillEvent, SkillEventRuleSet, SkillEventStance } from './skill_events';

export const TONGUES_CIRCLE = 20;
export const TONGUES_CHANT = 3;
export const TONGUES_SEVER_WINDUP = 0.6;
export const TONGUES_SEVER_COOLDOWN = 8;
export const TONGUES_SEVER_RANGE = 40;
export const TONGUES_SILENCE = 3;
export const TONGUES_SHOVE_DISTANCE = 5;
export const TONGUES_SHOVE_RANGE = 5;
export const TONGUES_SHOVE_COOLDOWN = 12;
export const TONGUES_RITES_TO_WIN = 5;
/** Moving more than this from where the chant began breaks it. */
const CHANT_STILL_TOLERANCE = 0.15;
/** Half-angle of the "in front of you" pick when you have no target. */
const FRONT_CONE_COS = Math.cos(Math.PI / 3);

function tonguesState(ev: ActiveSkillEvent, pid: number): TonguesKitState {
  const kit = kitFor(ev, pid);
  if (!kit.tongues) {
    kit.tongues = {
      chantFrom: null,
      chantX: 0,
      chantZ: 0,
      severAt: null,
      severTarget: null,
      silencedUntil: 0,
      rites: 0,
    };
  }
  return kit.tongues;
}

function insideCircle(ev: ActiveSkillEvent, e: Entity): boolean {
  return Math.hypot(e.pos.x - ev.x, e.pos.z - ev.z) <= TONGUES_CIRCLE;
}

/** A participant who can take part right now: alive, a player, in the circle. */
function inRite(ctx: SimContext, ev: ActiveSkillEvent, pid: number): Entity | null {
  const e = ctx.entities.get(pid);
  if (!e || e.dead || e.kind !== 'player' || !ev.participants.includes(pid)) return null;
  return insideCircle(ev, e) ? e : null;
}

function circleFormed(ctx: SimContext, ev: ActiveSkillEvent): boolean {
  let n = 0;
  for (const pid of ev.participants) if (inRite(ctx, ev, pid) && ++n >= 2) return true;
  return false;
}

/** Your target if it is a fighter in reach, else the nearest fighter in front. */
export function tonguesTarget(
  ctx: SimContext,
  ev: ActiveSkillEvent,
  p: Entity,
  range: number,
): Entity | null {
  const within = (t: Entity) => Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z) <= range;
  const targeted = p.targetId !== null ? inRite(ctx, ev, p.targetId) : null;
  if (targeted && targeted.id !== p.id && within(targeted)) return targeted;
  const fx = Math.sin(p.facing);
  const fz = Math.cos(p.facing);
  let best: Entity | null = null;
  let bestD = range;
  for (const pid of ev.participants) {
    if (pid === p.id) continue;
    const t = inRite(ctx, ev, pid);
    if (!t) continue;
    const dx = t.pos.x - p.pos.x;
    const dz = t.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > bestD) continue;
    if (d > 0.01 && (dx * fx + dz * fz) / d < FRONT_CONE_COS) continue;
    best = t;
    bestD = d;
  }
  return best;
}

function silenced(st: TonguesKitState, now: number): boolean {
  return now < st.silencedUntil;
}

function action(ctx: SimContext, ev: ActiveSkillEvent, pid: number, verb: string): boolean {
  const p = inRite(ctx, ev, pid);
  if (!p) return false;
  const kit = kitFor(ev, pid);
  const st = tonguesState(ev, pid);
  const now = ctx.time;
  switch (verb) {
    case 'rite': {
      if (st.chantFrom !== null || st.severAt !== null || silenced(st, now)) return false;
      if (isRooted(p) || isSilenced(p) || !circleFormed(ctx, ev)) return false;
      st.chantFrom = now;
      st.chantX = p.pos.x;
      st.chantZ = p.pos.z;
      return true;
    }
    case 'false_start': {
      if (st.chantFrom === null) return false;
      st.chantFrom = null;
      return true;
    }
    case 'sever': {
      if (st.severAt !== null || silenced(st, now) || !verbReady(kit, 'sever', now)) return false;
      const t = tonguesTarget(ctx, ev, p, TONGUES_SEVER_RANGE);
      if (!t) return false;
      st.chantFrom = null; // you cannot chant and sever at once
      st.severAt = now + TONGUES_SEVER_WINDUP;
      st.severTarget = t.id;
      kit.readyAt.set('sever', now + TONGUES_SEVER_COOLDOWN);
      return true;
    }
    case 'shove': {
      if (!verbReady(kit, 'shove', now)) return false;
      const t = tonguesTarget(ctx, ev, p, TONGUES_SHOVE_RANGE);
      if (!t) return false;
      const dx = t.pos.x - p.pos.x;
      const dz = t.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      const ux = d > 0.01 ? dx / d : Math.sin(p.facing);
      const uz = d > 0.01 ? dz / d : Math.cos(p.facing);
      relocateSwept(ctx, t, {
        x: t.pos.x + ux * TONGUES_SHOVE_DISTANCE,
        y: t.pos.y,
        z: t.pos.z + uz * TONGUES_SHOVE_DISTANCE,
      });
      kit.readyAt.set('shove', now + TONGUES_SHOVE_COOLDOWN);
      return true;
    }
    default:
      return false;
  }
}

/** A Sever lands: it reads the target's chant at this instant. */
function landSever(ctx: SimContext, ev: ActiveSkillEvent, st: TonguesKitState): void {
  const now = ctx.time;
  const targetId = st.severTarget;
  st.severAt = null;
  st.severTarget = null;
  const target = targetId === null ? null : (ev.kits.get(targetId)?.tongues ?? null);
  if (target && target.chantFrom !== null) {
    target.chantFrom = null;
    target.silencedUntil = now + TONGUES_SILENCE;
  } else {
    st.chantFrom = null;
    st.silencedUntil = now + TONGUES_SILENCE;
  }
}

function everyTick(ctx: SimContext, ev: ActiveSkillEvent): void {
  const now = ctx.time;
  for (const pid of ev.participants) {
    const st = ev.kits.get(pid)?.tongues;
    if (!st) continue;
    const p = inRite(ctx, ev, pid);
    if (!p) {
      // Out of the circle (or dead): the count is wiped, and nothing carries on.
      st.rites = 0;
      st.chantFrom = null;
      st.severAt = null;
      st.severTarget = null;
      continue;
    }
    if (st.severAt !== null) {
      if (isRooted(p)) {
        st.severAt = null; // a stun or root stops a wind-up too
        st.severTarget = null;
      } else if (now >= st.severAt) {
        landSever(ctx, ev, st);
      }
    }
    if (st.chantFrom === null) continue;
    const moved = Math.hypot(p.pos.x - st.chantX, p.pos.z - st.chantZ) > CHANT_STILL_TOLERANCE;
    if (moved || isRooted(p) || isSilenced(p) || silenced(st, now)) {
      st.chantFrom = null;
      continue;
    }
    if (now - st.chantFrom >= TONGUES_CHANT) {
      st.chantFrom = null;
      st.rites++;
      if (st.rites >= TONGUES_RITES_TO_WIN && ev.winner === null) ev.winner = pid;
    }
  }
}

/** The tell every client sees on a fighter's cast bar. */
function stanceOf(
  ctx: SimContext,
  ev: ActiveSkillEvent,
  pid: number,
): SkillEventStance | undefined {
  const st = ev.kits.get(pid)?.tongues;
  if (!st) return undefined;
  const now = ctx.time;
  if (st.chantFrom !== null) {
    return { stance: 'chant', fill: Math.min(1, (now - st.chantFrom) / TONGUES_CHANT) };
  }
  if (st.severAt !== null) {
    const left = Math.max(0, st.severAt - now);
    return { stance: 'sever', fill: 1 - left / TONGUES_SEVER_WINDUP };
  }
  if (silenced(st, now)) return { stance: 'silenced' };
  return undefined;
}

function scoreFor(
  ev: ActiveSkillEvent,
  pid: number,
): { yours: number; best: number; toWin: number } {
  let best = 0;
  for (const kit of ev.kits.values()) best = Math.max(best, kit.tongues?.rites ?? 0);
  return { yours: ev.kits.get(pid)?.tongues?.rites ?? 0, best, toWin: TONGUES_RITES_TO_WIN };
}

/** Every fighter starts the chant book at zero. */
function start(_ctx: SimContext, ev: ActiveSkillEvent): void {
  for (const pid of ev.participants) tonguesState(ev, pid);
}

export const TONGUES_RULES: SkillEventRuleSet = {
  killsToWin: Number.POSITIVE_INFINITY,
  noDamage: true,
  start,
  action: (ctx, ev, pid, verb) => {
    tonguesState(ev, pid); // a late joiner's book
    return action(ctx, ev, pid, verb);
  },
  everyTick,
  stanceOf,
  scoreFor,
  fieldRadius: () => TONGUES_CIRCLE,
};
