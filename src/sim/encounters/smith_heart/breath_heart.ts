// The Guardian of the Breath's Mythic mechanic (docs/design/raid/smith_heart.md
// section 7.2, the row "The Knotted Gale"; the working name was the Storm
// Heart, hence the ids' `heart`, the `stormHeart` rule and the dev verb):
//
//   The ball      a Knotted Gale drops far from the gaps; a 20 s fuse, then it
//                 bursts and wipes the raid.
//   The portals   two non-tanks are marked; after 5 s Portal A and Portal B open
//                 exactly where each stands (a body that fell through a gap
//                 opens it at the lip it left). No second chance.
//   The carrier   a third player walks onto the ball and takes it up: a crawl,
//                 and no wind, pull, blast or throw moves them (heldFast).
//   The crossing  anyone walking into either portal comes out at the other, ball
//                 or no ball: the carrier may go out empty-handed for a far ball
//                 and come back with it. Once per walk in: a body must step clear
//                 before it can cross again.
//   The throw     the interact press at the lip of ANY gap ends that ball (the
//                 Iron Cage's seam: no new wire command). A carrier who goes
//                 over a lip takes it with them: that counts as thrown.
//   A dead carrier drops it where they fell, still ticking, for anyone but the
//                 marked to take up.
//   When          phase 1: up to three times, a start waiting out the indrawn
//                 breath; phase 2: two balls, still one pair of portals, about
//                 every 60 s, never during the barrage. Thessaly's circles do
//                 not change: an anchored player still walks through a portal.
//
// A group too small to spare a third player (a dev run alone) may carry on a
// marked player's back, and a missing Portal B opens at the nearest lip, so the
// round can still be played: a raid never meets either rule.
//
// Deterministic: zero rng (the picks are hashed). Every visible state rides the
// wire as it is: the balls and portals are objects, the fuse is in the ball's
// template, the marks and the load are auras, and the load's slow is read by
// the shared motion kernel (player_motion.ts moveSpeedMult), so the online
// client predicts it; the crossing is the shared displacement, which the
// server's movement epoch reconciles as a discontinuity.

import { BREATH } from '../../content/smith_heart_layout';
import { displacePlayer } from '../../displacement';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import { WIND_DRIFT_AURA, WIND_PULL_AURA } from '../../wind_drift';
import { windBlowing } from './breath_gale';
import { atGapLip, gapDistance, inBreathArena, knotSpot, nearestLipSpot } from './breath_geometry';
import {
  BREATH_AURAS,
  BREATH_CUES,
  BREATH_NAMES,
  BREATH_OBJECTS,
  KNOT_HOP_TEXT,
  KNOT_NOT_AT_LIP_ERROR,
  knotTemplate,
  BREATH_TUNING as T,
} from './breath_ids';
import {
  auraOf,
  type BreathScope,
  corniceListeners,
  cornicePlayers,
  dropAura,
  dropBreathObject,
  local,
  moveBreathObject,
  pickMarks,
  putMarker,
  raidWarn,
  spawnBreathObject,
} from './breath_scope';
import type { BreathFightState, BreathHeart, BreathKnot } from './breath_state';

type Side = 'A' | 'B';

const MARK_AURA = { A: BREATH_AURAS.portalA, B: BREATH_AURAS.portalB } as const;

// ---- the round's start --------------------------------------------------------------------

/** A body standing on the Cornice's floor (not falling, not gone). */
function onFloor(p: Entity, at: { x: number; z: number }): boolean {
  return !p.dead && inBreathArena(at.x, at.z) && p.pos.y > BREATH.cornice.h - 3;
}

function cue(s: BreathScope, ability: string, lx: number, lz: number, r: number): void {
  const o = s.ctx.instanceOriginOf(s.inst);
  s.ctx.emit({
    type: 'spellfxAt',
    x: o.x + lx,
    z: o.z + lz,
    school: 'nature',
    fx: 'burst',
    radius: r,
    ability,
  });
}

/** A round now: `count` balls and the two marks. Exported for the dev trigger. */
export function startHeart(s: BreathScope, count: number): boolean {
  const st = s.st;
  if (st.heart || s.players.length === 0) return false;
  st.casts++;
  const busy = new Set<number>();
  if (st.cradle) busy.add(st.cradle.playerId);
  if (st.drawn) busy.add(st.drawn.playerId);
  const [a, b] = pickMarks(s, 2, busy);
  const heart: BreathHeart = {
    knots: [],
    mark: T.heartMark,
    markA: a?.id ?? null,
    markB: b?.id ?? null,
    bearers: [a, b].flatMap((p) => (p ? [p.id] : [])),
    portalA: null,
    portalB: null,
    floorSpots: {},
    crossed: [],
    presses: [],
  };
  st.heart = heart;
  st.heartRuns++;
  // Never where the last round's balls fell, nor on Thessaly's live circle,
  // nor on this round's other ball.
  const avoid: { x: number; z: number }[] = [...st.lastKnots];
  if (st.calm) avoid.push({ x: st.calm.x, z: st.calm.z });
  const dropped: { x: number; z: number }[] = [];
  for (let k = 0; k < count; k++) {
    const at = knotSpot(s.boss.id * 31 + st.casts * 7 + k, [...avoid, ...dropped]);
    dropped.push(at);
    const e = spawnBreathObject(
      s.ctx,
      s.inst,
      knotTemplate('free', T.heartFuse),
      BREATH_NAMES.knot,
      at.x,
      at.z,
      T.heartPickR,
    );
    heart.knots.push({ objectId: e.id, x: at.x, z: at.z, fuse: T.heartFuse, carrierId: null });
    cue(s, BREATH_CUES.knotLand, at.x, at.z, T.heartPickR);
  }
  st.lastKnots = dropped;
  if (a) putMarker(a, BREATH_AURAS.portalA, BREATH_NAMES.portalA, T.heartMark, s.boss.id);
  if (b) putMarker(b, BREATH_AURAS.portalB, BREATH_NAMES.portalB, T.heartMark, s.boss.id);
  raidWarn(
    s,
    s.boss,
    'knot',
    'A Knotted Gale falls! Carry it to a gap and throw it into the void!',
  );
  if (a && b)
    raidWarn(s, s.boss, 'knotPortals', `Portal A on ${a.name}, Portal B on ${b.name}!`, {
      a: a.name,
      b: b.name,
    });
  return true;
}

// ---- the portals --------------------------------------------------------------------------

function openPortal(s: BreathScope, heart: BreathHeart, side: Side, at: { x: number; z: number }) {
  const key = side === 'A' ? 'portalA' : 'portalB';
  dropBreathObject(s.ctx, s.inst, heart[key]?.objectId ?? null);
  const e = spawnBreathObject(
    s.ctx,
    s.inst,
    side === 'A' ? BREATH_OBJECTS.portalA : BREATH_OBJECTS.portalB,
    side === 'A' ? BREATH_NAMES.portalA : BREATH_NAMES.portalB,
    at.x,
    at.z,
    T.heartPortalR,
  );
  heart[key] = { objectId: e.id, x: at.x, z: at.z };
  cue(s, BREATH_CUES.portalOpen, at.x, at.z, T.heartPortalR);
  // Whoever it opened under (its own marked player) has not walked in.
  for (const p of s.players) {
    const here = local(s.ctx, s.inst, p);
    if (inPortal(here, heart[key]) && !heart.crossed.includes(p.id)) heart.crossed.push(p.id);
  }
}

function inPortal(at: { x: number; z: number }, portal: BreathHeart['portalA']): boolean {
  return portal !== null && Math.hypot(at.x - portal.x, at.z - portal.z) < T.heartPortalR;
}

/** Everyone on the floor walking into an open portal comes out at the other. */
function stepPortals(s: BreathScope, heart: BreathHeart): void {
  const A = heart.portalA;
  const B = heart.portalB;
  if (!A || !B) return;
  for (const p of s.players) {
    const at = local(s.ctx, s.inst, p);
    const inA = inPortal(at, A);
    if (!inA && !inPortal(at, B)) {
      heart.crossed = heart.crossed.filter((id) => id !== p.id);
      continue;
    }
    if (heart.crossed.includes(p.id) || !onFloor(p, at) || p.carriedBy !== undefined) continue;
    heart.crossed.push(p.id);
    const to = inA ? B : A;
    const o = s.ctx.instanceOriginOf(s.inst);
    displacePlayer(s.ctx, p, { x: o.x + to.x, z: o.z + to.z, facing: p.facing }, KNOT_HOP_TEXT);
    s.ctx.emit({
      type: 'spellfx',
      sourceId: p.id,
      targetId: p.id,
      school: 'nature',
      fx: 'nova',
      ability: BREATH_CUES.portalHop,
    });
  }
}

/** Where a mark's portal opens: at its player's feet; if they have left the
 *  floor, the last spot they stood on it (the lip they fell from). */
function markSpot(s: BreathScope, heart: BreathHeart, id: number | null): { x: number; z: number } {
  const p = id === null ? undefined : s.ctx.entities.get(id);
  if (p) {
    const at = local(s.ctx, s.inst, p);
    if (onFloor(p, at)) return at;
  }
  const last = id === null ? undefined : heart.floorSpots[id];
  if (last) return last;
  return { x: heart.knots[0]?.x ?? BREATH.cornice.x, z: heart.knots[0]?.z ?? BREATH.cornice.z };
}

/** Every marked player's and carrier's last spot on the floor. */
function noteFloorSpots(s: BreathScope, heart: BreathHeart): void {
  const note = (id: number | null) => {
    if (id === null) return;
    const p = s.ctx.entities.get(id);
    if (!p) return;
    const at = local(s.ctx, s.inst, p);
    if (onFloor(p, at)) heart.floorSpots[id] = at;
  };
  note(heart.markA);
  note(heart.markB);
  for (const k of heart.knots) note(k.carrierId);
}

function endMarks(s: BreathScope, heart: BreathHeart): void {
  const sideOf = (side: Side, id: number | null) => {
    const p = id === null ? undefined : s.ctx.entities.get(id);
    if (p) dropAura(p, MARK_AURA[side]);
  };
  sideOf('A', heart.markA);
  sideOf('B', heart.markB);
  if (!heart.portalA) openPortal(s, heart, 'A', markSpot(s, heart, heart.markA));
  if (!heart.portalB) {
    if (heart.markB !== null) openPortal(s, heart, 'B', markSpot(s, heart, heart.markB));
    else {
      // Nobody left to mark (a group of one): the nearest lip, so the round plays.
      const a = heart.portalA as { x: number; z: number };
      openPortal(s, heart, 'B', nearestLipSpot(a.x, a.z));
    }
  }
  heart.markA = null;
  heart.markB = null;
}

// ---- the ball -----------------------------------------------------------------------------

function freeKnot(s: BreathScope, k: BreathKnot, carrier: Entity | undefined, at?: typeof k): void {
  if (carrier) dropAura(carrier, BREATH_AURAS.laden);
  k.carrierId = null;
  if (at) {
    k.x = at.x;
    k.z = at.z;
    const e = s.ctx.entities.get(k.objectId);
    if (e) moveBreathObject(s.ctx, s.inst, e, k.x, k.z);
  }
}

/** The ball is gone: into the void, carried or thrown. */
function loseKnot(s: BreathScope, heart: BreathHeart, k: BreathKnot, carrier?: Entity): void {
  cue(s, BREATH_CUES.knotThrow, k.x, k.z, T.heartPickR);
  if (carrier) dropAura(carrier, BREATH_AURAS.laden);
  dropBreathObject(s.ctx, s.inst, k.objectId);
  heart.knots = heart.knots.filter((o) => o !== k);
}

function takeKnot(s: BreathScope, k: BreathKnot, p: Entity): void {
  k.carrierId = p.id;
  const a = putMarker(p, BREATH_AURAS.laden, BREATH_NAMES.laden, k.fuse, s.boss.id, {
    value: T.heartWalkMult,
  });
  a.duration = T.heartFuse;
  // The load holds from this tick: no wind left over to carry them a step.
  dropAura(p, WIND_DRIFT_AURA);
  dropAura(p, WIND_PULL_AURA);
  cue(s, BREATH_CUES.knotTake, k.x, k.z, T.heartPickR);
  raidWarn(s, s.boss, 'knotTaken', `${p.name} takes up the Knotted Gale!`, { player: p.name });
}

/** The wind never moves a carrier, but with it at their back (a blow or a
 *  gust blowing within `heartTailCone` of where they face) the load walks a
 *  little faster (Jose's playtest). The pace rides the load aura's value,
 *  which the wire mirrors and the shared motion kernel reads, so the online
 *  client predicts it. */
function tailwind(s: BreathScope, p: Entity): void {
  const load = auraOf(p, BREATH_AURAS.laden);
  if (!load) return;
  let pace: number = T.heartWalkMult;
  if (windBlowing(s.st)) {
    const heading = (s.st.wind.bearing * Math.PI) / 180;
    const off = Math.abs(Math.atan2(Math.sin(p.facing - heading), Math.cos(p.facing - heading)));
    if (off <= (T.heartTailCone * Math.PI) / 180) pace = T.heartTailMult;
  }
  if (load.value !== pace) load.value = pace;
}

/** Each carrier's tick: dead, gone or over a lip, else the ball rides with them
 *  (through a portal too: stepPortals has already moved them). */
function stepCarriers(s: BreathScope, heart: BreathHeart): void {
  for (const k of [...heart.knots]) {
    if (k.carrierId === null) continue;
    const p = s.ctx.entities.get(k.carrierId);
    const last = heart.floorSpots[k.carrierId];
    if (!p) {
      freeKnot(s, k, undefined, last ? { ...k, ...last } : undefined);
      continue;
    }
    const at = local(s.ctx, s.inst, p);
    if (p.dead) {
      freeKnot(s, k, p, last ? { ...k, ...last } : undefined);
      raidWarn(s, s.boss, 'knotDropped', `${p.name} falls! The Knotted Gale is free again!`, {
        player: p.name,
      });
      continue;
    }
    if (!onFloor(p, at)) {
      // Over a gap's lip: gone with them, which counts as thrown. Anywhere
      // else (a hearth, a teleport) it stays where they last stood.
      if (gapDistance(at.x, at.z) <= T.heartLipReach) {
        raidWarn(s, s.boss, 'knotFell', `${p.name} takes the Knotted Gale into the void!`, {
          player: p.name,
        });
        loseKnot(s, heart, k, p);
      } else freeKnot(s, k, p, last ? { ...k, ...last } : undefined);
      continue;
    }
    tailwind(s, p);
    const now = local(s.ctx, s.inst, p);
    if (now.x !== k.x || now.z !== k.z) {
      k.x = now.x;
      k.z = now.z;
      const e = s.ctx.entities.get(k.objectId);
      if (e) moveBreathObject(s.ctx, s.inst, e, k.x, k.z);
    }
  }
}

/** The throw presses since the last tick: at any lip, the ball is gone. */
function stepThrows(s: BreathScope, heart: BreathHeart): void {
  if (heart.presses.length === 0) return;
  const presses = heart.presses;
  heart.presses = [];
  for (const id of presses) {
    const k = heart.knots.find((o) => o.carrierId === id);
    const p = s.ctx.entities.get(id);
    if (!k || !p || p.dead || s.ctx.isStunned(p)) continue;
    const at = local(s.ctx, s.inst, p);
    if (!atGapLip(at.x, at.z)) {
      s.ctx.error(p.id, KNOT_NOT_AT_LIP_ERROR);
      continue;
    }
    raidWarn(s, s.boss, 'knotThrown', `${p.name} hurls the Knotted Gale into the void!`, {
      player: p.name,
    });
    loseKnot(s, heart, k, p);
  }
}

/** Anyone free standing on a free ball takes it up, in roster order. */
function stepPickups(s: BreathScope, heart: BreathHeart): void {
  if (heart.knots.every((k) => k.carrierId !== null)) return;
  const carrying = new Set(heart.knots.map((k) => k.carrierId));
  const anyFree = s.players.some(
    (p) => !p.dead && !heart.bearers.includes(p.id) && !carrying.has(p.id),
  );
  for (const k of heart.knots) {
    if (k.carrierId !== null) continue;
    for (const p of s.players) {
      if (p.dead || carrying.has(p.id) || p.carriedBy !== undefined) continue;
      // The marked never carry, unless nobody else stands on the Cornice.
      if (heart.bearers.includes(p.id) && anyFree) continue;
      const at = local(s.ctx, s.inst, p);
      if (Math.hypot(at.x - k.x, at.z - k.z) > T.heartPickR) continue;
      takeKnot(s, k, p);
      carrying.add(p.id);
      break;
    }
  }
}

/** A ball out of time: lethal whatever shields them (as council_prison.ts's
 *  crush: the damage path caps a huge hit), game masters excepted. */
function burst(s: BreathScope): void {
  const o = s.ctx.instanceOriginOf(s.inst);
  const heart = s.st.heart;
  const k = heart?.knots[0];
  s.ctx.emit({
    type: 'spellfxAt',
    x: o.x + (k?.x ?? BREATH.cornice.x),
    z: o.z + (k?.z ?? BREATH.cornice.z),
    school: 'nature',
    fx: 'nova',
    radius: BREATH.cornice.rx,
    ability: BREATH_CUES.knotBurst,
  });
  raidWarn(s, s.boss, 'knotBurst', 'The Knotted Gale bursts!');
  for (const p of cornicePlayers(s.ctx, s.inst)) {
    if (p.gm || (p.profilerInvulnerable && s.ctx.devCommands)) continue;
    s.ctx.dealDamage(
      s.boss,
      p,
      p.hp + p.maxHp * 10,
      false,
      'nature',
      BREATH_NAMES.knot,
      'hit',
      true,
    );
    if (!p.dead) s.ctx.handleDeath(p, s.boss, BREATH_NAMES.knot);
  }
  clearHeart(s.ctx, s.inst, s.st);
}

// ---- the tick -----------------------------------------------------------------------------

function stepLive(s: BreathScope, heart: BreathHeart): void {
  noteFloorSpots(s, heart);
  if (heart.mark > 0) {
    heart.mark -= DT;
    if (heart.mark <= 1e-9) {
      heart.mark = 0;
      endMarks(s, heart);
    }
  }
  stepPortals(s, heart);
  stepCarriers(s, heart);
  stepThrows(s, heart);
  stepPickups(s, heart);
  let out = false;
  for (const k of heart.knots) {
    k.fuse -= DT;
    if (k.fuse <= 1e-9) out = true;
    // The fuse rides the template in half seconds (the wire's only change).
    const e = s.ctx.entities.get(k.objectId);
    const shown = knotTemplate(k.carrierId === null ? 'free' : 'held', Math.ceil(k.fuse * 2) / 2);
    if (e && e.templateId !== shown) e.templateId = shown;
  }
  if (out) {
    burst(s);
    return;
  }
  if (heart.knots.length === 0) clearHeart(s.ctx, s.inst, s.st);
}

/** Phase 1's clock: never into the indrawn breath, nor so near it that a whole
 *  fuse would run into it. */
function windClear(st: BreathFightState): boolean {
  const ph = st.wind.phase;
  if (ph === 'inhale' || ph === 'exhale') return false;
  return st.inhaleTimer > T.heartFuse + 1 && st.heartRuns < T.heartWindRuns;
}

/** One tick of the Knotted Gale (mythic's row only: every other tier returns at
 *  once, so it never changes by one rng draw). */
export function stepHeart(s: BreathScope): void {
  const st = s.st;
  if (!s.rules.stormHeart) {
    // A dev switch took mythic away mid-round.
    if (st.heart) clearHeart(s.ctx, s.inst, st);
    return;
  }
  if (st.heart) stepLive(s, st.heart);
  // The storm's break and its barrage hold the clock at its phase-2 start.
  if (st.half === 'break' || st.barrage) {
    st.heartTimer = T.heartStormFirst;
    return;
  }
  st.heartTimer -= DT;
  if (st.heart || st.heartTimer > 1e-9) return;
  if (st.half === 'wind') {
    if (windClear(st) && startHeart(s, 1)) st.heartTimer = T.heartEvery;
  } else if (startHeart(s, 2)) st.heartTimer = T.heartStormEvery;
}

/** The round off the Cornice: balls, portals, marks, loads (a wipe, the kill,
 *  the round's end). */
export function clearHeart(ctx: SimContext, inst: InstanceSlot, st: BreathFightState): void {
  const heart = st.heart;
  if (!heart) return;
  st.heart = null;
  for (const k of heart.knots) dropBreathObject(ctx, inst, k.objectId);
  dropBreathObject(ctx, inst, heart.portalA?.objectId ?? null);
  dropBreathObject(ctx, inst, heart.portalB?.objectId ?? null);
  for (const p of corniceListeners(ctx, inst)) {
    dropAura(p, BREATH_AURAS.portalA);
    dropAura(p, BREATH_AURAS.portalB);
    dropAura(p, BREATH_AURAS.laden);
  }
  // A carrier gone from the Cornice's reach (a hearth) loses the load too.
  for (const k of heart.knots) {
    const p = k.carrierId === null ? undefined : ctx.entities.get(k.carrierId);
    if (p) dropAura(p, BREATH_AURAS.laden);
  }
}

// ---- the press ----------------------------------------------------------------------------

/** The interact press of a player carrying a Knotted Gale: claimed here and
 *  resolved in the fight's next tick (sim/interaction.ts, before anything
 *  else). False for anyone else, so their press stays ordinary. */
export function tryThrowKnot(ctx: SimContext, p: Entity): boolean {
  const load = auraOf(p, BREATH_AURAS.laden);
  if (!load) return false;
  const heart = ctx.entities.get(load.sourceId)?.smithHeartBreath?.heart;
  if (!heart || !heart.knots.some((k) => k.carrierId === p.id)) return false;
  if (!heart.presses.includes(p.id)) heart.presses.push(p.id);
  return true;
}

// ---- dev ----------------------------------------------------------------------------------

/** `/dev heart breath heart [2|portal a|portal b|carry|burst]`: the reply. */
export function heartDevTrigger(
  s: BreathScope,
  words: readonly string[],
  pid: number | undefined,
): string {
  const [step, side] = words;
  const st = s.st;
  const me = pid === undefined ? undefined : s.ctx.entities.get(pid);
  if (step === undefined || step === '2' || step === 'two') {
    if (st.heart) clearHeart(s.ctx, s.inst, st);
    const count = step === undefined ? 1 : 2;
    return startHeart(s, count)
      ? `${count === 1 ? 'A Knotted Gale falls' : 'Two Knotted Gales fall'}; the marks open in ${T.heartMark} s.`
      : 'Nobody on the Cornice to mark.';
  }
  const heart = st.heart;
  if (!heart) return 'No Knotted Gale is out (/dev heart breath heart).';
  if (step === 'burst') {
    for (const k of heart.knots) k.fuse = Math.min(k.fuse, DT / 2);
    return 'The Knotted Gale bursts.';
  }
  if (!me) return 'That step needs a player.';
  const at = local(s.ctx, s.inst, me);
  if (step === 'portal') {
    const which: Side | null = side === 'a' ? 'A' : side === 'b' ? 'B' : null;
    if (!which) return 'portal a or portal b.';
    const key = which === 'A' ? 'markA' : 'markB';
    const marked = heart[key];
    const wearer = marked === null ? undefined : s.ctx.entities.get(marked);
    if (wearer) dropAura(wearer, MARK_AURA[which]);
    heart.bearers = heart.bearers.filter((id) => id !== marked);
    heart[key] = null;
    openPortal(s, heart, which, at);
    return `Portal ${which} opens at your feet.`;
  }
  if (step === 'carry') {
    if (heart.knots.some((k) => k.carrierId === me.id)) return 'You already carry one.';
    const free = heart.knots.find((k) => k.carrierId === null);
    if (!free) return 'Every ball is carried.';
    heart.bearers = heart.bearers.filter((id) => id !== me.id);
    if (heart.markA === me.id) {
      dropAura(me, BREATH_AURAS.portalA);
      heart.markA = null;
    }
    if (heart.markB === me.id) {
      dropAura(me, BREATH_AURAS.portalB);
      heart.markB = null;
    }
    freeKnot(s, free, undefined, { ...free, ...at });
    takeKnot(s, free, me);
    return 'You take up the Knotted Gale.';
  }
  return 'heart [2|portal a|portal b|carry|burst].';
}
