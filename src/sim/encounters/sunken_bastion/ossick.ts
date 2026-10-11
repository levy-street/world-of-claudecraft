// Gaoler Ossick in the Drowning Yard: break the anchor chain before the winch
// hauls its victim into the Drowning Pit, and move the shackled pair together.
//
//   Drowned Anchor   every 24 s (first at 8 s) a 1.8 s bar, the mark growing
//                    under a non-tank player; then the anchor slams down and
//                    its fluke hooks them: the chain tethers them to the winch
//                    (they can move, but never further out than the chain)
//                    and, after 1.5 s of winding taut, reels them toward the
//                    pit in the yard's centre (about 8 s from anywhere in the
//                    yard). Two ways out: any hit on the anchor (the victim's
//                    own too) is one link and 12 break the chain; or the
//                    victim reaches a LIT Mooring Post (within 3 yd), which
//                    takes the chain and frees them, and goes dark for 30 s
//                    (ossick_moorings.ts). Reaching the rim they fall in: 60
//                    percent of their health, stunned 3 s.
//   Shackle Pair     every 28 s (first at 16 s) a 1.2 s bar, then two players
//                    are chained together for 12 s: every second they stand
//                    more than 8 yd apart, both take 40 to 50.
//   Gaoler's Cudgel  every 12 s a 1 s bar, then a heavy blow on the tank (1.5x
//                    melee) and a 30 percent slow for 6 s.
//   Open the Cells   at 60 and 30 percent, three Shackled Prisoners break out.
//   Heroic           Anchor Crash: the anchor's landing strikes everyone within
//                    6 yd of the victim. A heavier chain (16 links) and a
//                    faster haul (7 s), and the pit takes 80 percent. The
//                    shackles bite past 6 yd.
//
// Zero rng in every pick (the victims by the kit's hash over the living
// non-tanks); the only draws are the damage rolls. Every visible state rides
// existing fields: the anchor is a mob whose health is the chain's links, the
// Anchored aura's sourceId names the anchor, and a Shackled aura's sourceId
// names the partner, so the client draws both chains from the auras alone.

import { displaceAlong } from '../../knockback';
import { spawnKitAdd } from '../../mob/trash_kit/spawn';
import { kitHash } from '../../mob/trash_kit/targets';
import { pullHeld } from '../../pull_toward';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, dist2d, type Entity, type OssickFightState } from '../../types';
import {
  claimPlayers,
  clearCastIf,
  dropAuraById,
  dropEncounterBody,
  grantClaimDeed,
  mechanicDamage,
  pickMarkTargets,
  startBar,
} from './claim';
import {
  anchorDragSpeed,
  anchorHits,
  CELL_DOORS,
  DROWNED_ANCHOR_ID,
  OSSICK_ANCHOR,
  OSSICK_ANCHOR_MARK,
  OSSICK_ANCHORED,
  OSSICK_CUDGEL,
  OSSICK_CUDGEL_SLOW,
  OSSICK_KEELHAULED,
  OSSICK_SHACKLE,
  OSSICK_SHACKLED,
  OSSICK_TUNING,
  PIT_RIM,
  SHACKLED_PRISONER_ID,
  shackleRange,
  shackleStrained,
  WINCH,
} from './ids';
import { freshPostDark, relightMooringPosts, stepMooringPosts, tryMoor } from './ossick_moorings';

const T = OSSICK_TUNING;
export const OSSICK_DEED = 'dgn_ossick_moored';
const OUR_CASTS = [OSSICK_ANCHOR, OSSICK_SHACKLE, OSSICK_CUDGEL];
/** The anchor body stands this far ahead of its victim, on the winch side. */
const ANCHOR_LEAD = 1.4;

function freshState(): OssickFightState {
  return {
    kind: 'ossick',
    anchorTimer: T.anchorFirst,
    shackleTimer: T.shackleFirst,
    cudgelTimer: T.cudgelFirst,
    anchors: [],
    shackles: [],
    cellsFired: 0,
    keelhauled: false,
    casts: 0,
    pending: [],
    postDark: freshPostDark(),
  };
}

/** Players already carrying one of Ossick's mechanics (never picked twice). */
function busyPlayers(st: OssickFightState): Set<number> {
  const busy = new Set<number>();
  for (const a of st.anchors) busy.add(a.playerId);
  for (const s of st.shackles) {
    busy.add(s.a);
    busy.add(s.b);
  }
  return busy;
}

// ---- the Drowned Anchor ---------------------------------------------------------------

/** Start a Drowned Anchor bar now (the dev trigger and the cadence share it). */
export function startDrownedAnchor(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: OssickFightState,
): boolean {
  const target = pickMarkTargets(boss, claimPlayers(ctx, inst), 1, st.casts, busyPlayers(st))[0];
  if (!target) return false;
  st.casts++;
  st.anchorTimer = T.anchorEvery;
  startBar(boss, OSSICK_ANCHOR, T.anchorCast, target.id);
  st.pending = [target.id];
  ctx.applyAura(target, {
    id: OSSICK_ANCHOR_MARK,
    name: 'Drowned Anchor',
    // A mark, not a slow: the value leaves the runner at full speed.
    kind: 'slow',
    remaining: T.anchorCast,
    duration: T.anchorCast,
    value: 1,
    // Heroic: the Anchor Crash's reach round the mark (the client rings it).
    ...(inst.difficulty === 'heroic' ? { value2: T.crashRadius } : {}),
    sourceId: boss.id,
    school: 'physical',
    undispellable: true,
  });
  return true;
}

function landAnchor(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: OssickFightState,
  p: Entity,
): void {
  dropAuraById(p, OSSICK_ANCHOR_MARK);
  const heroic = inst.difficulty === 'heroic';
  // Anchor Crash (heroic): the landing strikes everyone near the victim.
  if (heroic) {
    for (const q of claimPlayers(ctx, inst)) {
      if (q.id === p.id || dist2d(q.pos, p.pos) > T.crashRadius) continue;
      ctx.dealDamage(
        boss,
        q,
        mechanicDamage(ctx, boss, T.crashMin, T.crashMax),
        false,
        'physical',
        'Anchor Crash',
        'hit',
        true,
      );
    }
  }
  const anchor = spawnKitAdd(ctx, inst, boss, DROWNED_ANCHOR_ID, p.pos.x, p.pos.z, null);
  if (!anchor) return;
  const links = anchorHits(heroic);
  anchor.maxHp = links;
  anchor.hp = links;
  anchor.facing = Math.atan2(p.pos.x - boss.pos.x, p.pos.z - boss.pos.z);
  anchor.prevFacing = anchor.facing;
  const o = ctx.instanceOriginOf(inst);
  const hookX = p.pos.x - o.x;
  const hookZ = p.pos.z - o.z;
  const chain = Math.hypot(hookX - WINCH.x, hookZ - WINCH.z);
  st.anchors.push({ playerId: p.id, anchorId: anchor.id, held: 0, chain, hookX, hookZ });
  ctx.applyAura(p, {
    id: OSSICK_ANCHORED,
    name: 'Drowned Anchor',
    // A tether, not a root: the victim keeps their feet (to reach a post) and
    // the chain holds them in (stepAnchors). An authoritative displacement
    // state, so no slow or root immunity shrugs it off.
    kind: 'forced_move',
    remaining: 60,
    duration: 60,
    value: 0,
    // The anchor, not Ossick: the client draws the chain from the winch to it.
    sourceId: anchor.id,
    school: 'physical',
    unbreakableControl: true,
    undispellable: true,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: anchor.id,
    school: 'physical',
    fx: 'detonate',
    ability: OSSICK_ANCHOR,
  });
}

/** The chain is gone (broken, or its victim fell or died): the anchor goes. */
function releaseAnchor(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: OssickFightState,
  playerId: number,
  anchorId: number,
  broken: boolean,
): void {
  st.anchors = st.anchors.filter((a) => a.anchorId !== anchorId);
  const p = ctx.entities.get(playerId);
  if (p) dropAuraById(p, OSSICK_ANCHORED);
  if (broken) {
    ctx.emit({
      type: 'spellfx',
      sourceId: anchorId,
      targetId: p?.id ?? anchorId,
      school: 'physical',
      fx: 'nova',
      ability: OSSICK_ANCHORED,
    });
  }
  dropEncounterBody(ctx, inst, boss, anchorId);
}

function fallIntoPit(
  ctx: SimContext,
  boss: Entity,
  st: OssickFightState,
  p: Entity,
  heroic: boolean,
): void {
  st.keelhauled = true;
  const share = heroic ? T.pitShareHeroic : T.pitShare;
  ctx.dealDamage(
    boss,
    p,
    Math.max(1, Math.round(p.maxHp * share)),
    false,
    'frost',
    'Drowning Pit',
    'hit',
    true,
  );
  if (!p.dead) {
    ctx.applyAura(p, {
      id: OSSICK_KEELHAULED,
      name: 'Keelhauled',
      kind: 'stun',
      remaining: T.keelhaulStun,
      duration: T.keelhaulStun,
      value: 0,
      sourceId: boss.id,
      school: 'frost',
    });
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: p.id,
    school: 'frost',
    fx: 'nova',
    ability: OSSICK_KEELHAULED,
  });
}

/** Is `p` still inside the claim (the claim roster's own bounds)? */
function inClaim(p: Entity, o: { x: number; z: number }): boolean {
  return Math.abs(p.pos.x - o.x) < 120 && Math.abs(p.pos.z - o.z) < 250;
}

/** The winch hauls every anchored player one tick toward the pit: the chain
 *  holds them inside its length, which reels in once it has settled, unless a
 *  lit Mooring Post in reach takes it. */
function stepAnchors(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: OssickFightState,
): void {
  if (st.anchors.length === 0) return;
  const heroic = inst.difficulty === 'heroic';
  const o = ctx.instanceOriginOf(inst);
  const wx = o.x + WINCH.x;
  const wz = o.z + WINCH.z;
  for (const a of [...st.anchors]) {
    const anchor = ctx.entities.get(a.anchorId);
    const p = ctx.entities.get(a.playerId);
    if (!anchor || anchor.dead || anchor.hp <= 0) {
      releaseAnchor(ctx, inst, boss, st, a.playerId, a.anchorId, true);
      continue;
    }
    if (!p || p.dead || !p.auras.some((x) => x.id === OSSICK_ANCHORED)) {
      releaseAnchor(ctx, inst, boss, st, a.playerId, a.anchorId, false);
      continue;
    }
    // Gone from the claim (out of the dungeon, a teleport, a summons): the
    // chain lets go rather than drag them back across the world.
    if (!inClaim(p, o)) {
      releaseAnchor(ctx, inst, boss, st, a.playerId, a.anchorId, false);
      continue;
    }
    a.held += DT;
    anchor.swingTimer = Math.max(anchor.swingTimer, 5);
    // The chain never pays out: a step toward the winch takes up its slack, and
    // once settled it reels in at the haul's pace (a victim standing still is
    // hauled exactly as by a straight drag). A hold against pulls (the Mooring
    // Stone, an Ice Block) stops the REEL, never the tether: the chain's
    // length is a limit, so no shield, blink or charge carries its victim out
    // past it (they are drawn straight back in, through the collider sweep).
    const d = Math.hypot(p.pos.x - wx, p.pos.z - wz);
    a.chain = Math.min(a.chain, d);
    if (a.held > T.anchorSettle && !pullHeld(ctx, p))
      a.chain = Math.max(PIT_RIM - 0.05, a.chain - anchorDragSpeed(a.chain, heroic) * DT);
    if (d > a.chain + 1e-6) {
      displaceAlong(ctx, p, (wx - p.pos.x) / d, (wz - p.pos.z) / d, d - a.chain);
      // A wall or a post the sweep stopped them at: the chain hangs no shorter
      // than they stand, so no slack piles up to be paid out in one snap.
      a.chain = Math.max(a.chain, Math.hypot(p.pos.x - wx, p.pos.z - wz));
    }
    // A lit Mooring Post in reach takes the chain: the victim is freed.
    if (tryMoor(ctx, inst, st, p, a.hookX, a.hookZ) >= 0) {
      releaseAnchor(ctx, inst, boss, st, a.playerId, a.anchorId, true);
      continue;
    }
    // The anchor rides its victim a step toward the winch, flukes toward them.
    const toWinch = Math.atan2(wx - p.pos.x, wz - p.pos.z);
    anchor.pos.x = p.pos.x + Math.sin(toWinch) * ANCHOR_LEAD;
    anchor.pos.z = p.pos.z + Math.cos(toWinch) * ANCHOR_LEAD;
    anchor.pos.y = p.pos.y;
    anchor.facing = toWinch + Math.PI;
    ctx.grid.update(anchor);
    if (Math.hypot(p.pos.x - wx, p.pos.z - wz) <= PIT_RIM) {
      releaseAnchor(ctx, inst, boss, st, a.playerId, a.anchorId, false);
      fallIntoPit(ctx, boss, st, p, heroic);
    }
  }
}

// ---- the Shackle Pair -------------------------------------------------------------------

/** Start a Shackle Pair bar now (the dev trigger and the cadence share it). */
export function startShacklePair(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: OssickFightState,
): boolean {
  const players = claimPlayers(ctx, inst);
  const busy = busyPlayers(st);
  let pair = pickMarkTargets(boss, players, 2, st.casts + 101, busy);
  // Short of two free non-tanks, the tank makes up the pair.
  if (pair.length < 2) {
    const rest = players.filter((p) => !busy.has(p.id) && !pair.includes(p));
    pair = [...pair, ...rest].slice(0, 2);
  }
  if (pair.length < 2) return false;
  st.casts++;
  st.shackleTimer = T.shackleEvery;
  startBar(boss, OSSICK_SHACKLE, T.shackleCast, pair[0].id);
  st.pending = pair.map((p) => p.id);
  return true;
}

function shacklePair(
  ctx: SimContext,
  boss: Entity,
  st: OssickFightState,
  a: Entity,
  b: Entity,
  heroic: boolean,
): void {
  for (const [p, partner] of [
    [a, b],
    [b, a],
  ] as const) {
    ctx.applyAura(p, {
      id: OSSICK_SHACKLED,
      name: 'Shackle Pair',
      // A mark, not a slow: the chain only bites when it is stretched.
      kind: 'slow',
      remaining: T.shackleSeconds,
      duration: T.shackleSeconds,
      value: 1,
      // The chain's reach (the client rings it round the pair).
      value2: shackleRange(heroic),
      // The partner, not Ossick: the client draws the chain between the two.
      sourceId: partner.id,
      school: 'physical',
      undispellable: true,
    });
  }
  st.shackles.push({ a: a.id, b: b.id, remaining: T.shackleSeconds, tick: 1 });
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: a.id,
    school: 'physical',
    fx: 'beam',
    ability: OSSICK_SHACKLE,
  });
}

function unshackle(ctx: SimContext, s: { a: number; b: number }): void {
  for (const id of [s.a, s.b]) {
    const p = ctx.entities.get(id);
    if (p) dropAuraById(p, OSSICK_SHACKLED);
  }
}

function stepShackles(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: OssickFightState,
): void {
  if (st.shackles.length === 0) return;
  const heroic = inst.difficulty === 'heroic';
  for (const s of [...st.shackles]) {
    s.remaining -= DT;
    const a = ctx.entities.get(s.a);
    const b = ctx.entities.get(s.b);
    if (s.remaining <= 0 || !a || !b || a.dead || b.dead) {
      unshackle(ctx, s);
      st.shackles = st.shackles.filter((x) => x !== s);
      continue;
    }
    s.tick -= DT;
    if (s.tick > 0) continue;
    s.tick += 1;
    if (!shackleStrained(dist2d(a.pos, b.pos), heroic)) continue;
    for (const p of [a, b]) {
      ctx.dealDamage(
        boss,
        p,
        mechanicDamage(ctx, boss, T.strainMin, T.strainMax),
        false,
        'physical',
        'Shackle Strain',
        'hit',
        true,
      );
    }
  }
}

// ---- the cudgel and the cells -------------------------------------------------------------

function landCudgel(ctx: SimContext, boss: Entity, targetId: number | null): void {
  const tank = targetId !== null ? ctx.entities.get(targetId) : undefined;
  if (!tank || tank.dead || dist2d(tank.pos, boss.pos) > 9) return;
  const w = boss.weapon;
  const amount = Math.max(1, Math.round(ctx.rng.range(w.min, w.max) * T.cudgelMult));
  ctx.dealDamage(boss, tank, amount, false, 'physical', "Gaoler's Cudgel", 'hit', true);
  if (tank.dead) return;
  ctx.applyAura(tank, {
    id: OSSICK_CUDGEL_SLOW,
    name: "Gaoler's Cudgel",
    kind: 'slow',
    remaining: T.cudgelSlowSeconds,
    duration: T.cudgelSlowSeconds,
    value: T.cudgelSlow,
    sourceId: boss.id,
    school: 'physical',
  });
}

function openCells(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: OssickFightState): void {
  const share = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1;
  while (st.cellsFired < T.cells.length && share <= T.cells[st.cellsFired]) {
    st.cellsFired++;
    const players = claimPlayers(ctx, inst);
    const o = ctx.instanceOriginOf(inst);
    for (let k = 0; k < T.prisonersPerCell; k++) {
      const door = CELL_DOORS[k % CELL_DOORS.length];
      const victim =
        players.length > 0
          ? players[kitHash(boss.id, st.cellsFired * 5 + k) % players.length]
          : null;
      spawnKitAdd(ctx, inst, boss, SHACKLED_PRISONER_ID, o.x + door.x, o.z + door.z, victim);
    }
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'physical',
      fx: 'shout',
      ability: 'bastion_open_the_cells',
    });
  }
}

/** The fight ended: the anchors drop, the shackles fall away, the posts relight. */
export function resetOssick(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  const st = boss.bastionFight?.kind === 'ossick' ? boss.bastionFight : null;
  if (st) {
    for (const a of [...st.anchors])
      releaseAnchor(ctx, inst, boss, st, a.playerId, a.anchorId, false);
    for (const s of st.shackles) unshackle(ctx, s);
    st.shackles = [];
    for (const id of st.pending) {
      const p = ctx.entities.get(id);
      if (p) dropAuraById(p, OSSICK_ANCHOR_MARK);
    }
  }
  relightMooringPosts(ctx, inst, st);
  clearCastIf(boss, ...OUR_CASTS);
  boss.bastionFight = undefined;
}

/** One tick of Ossick's fight. */
export function tickOssick(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  engaged: boolean,
): void {
  let st = boss.bastionFight?.kind === 'ossick' ? boss.bastionFight : null;
  if (boss.dead) {
    if (st) {
      if (!st.keelhauled) grantClaimDeed(ctx, inst, OSSICK_DEED);
      resetOssick(ctx, inst, boss);
    }
    return;
  }
  if (!engaged) {
    if (st) resetOssick(ctx, inst, boss);
    return;
  }
  if (!st) {
    st = freshState();
    boss.bastionFight = st;
  }
  stepMooringPosts(ctx, inst, st);
  stepAnchors(ctx, inst, boss, st);
  stepShackles(ctx, inst, boss, st);
  openCells(ctx, inst, boss, st);
  // The cadences run on through a bar; a ready one starts when he is free.
  st.anchorTimer -= DT;
  st.shackleTimer -= DT;
  st.cudgelTimer -= DT;
  // A running bar of ours: count it down, land it at the end.
  const cast = boss.castingAbility;
  if (cast !== null && OUR_CASTS.includes(cast)) {
    boss.swingTimer = Math.max(boss.swingTimer, 0.6);
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
    const target = boss.castTargetId !== null ? ctx.entities.get(boss.castTargetId) : undefined;
    if (target && !target.dead)
      boss.facing = Math.atan2(target.pos.x - boss.pos.x, target.pos.z - boss.pos.z);
    if (boss.castRemaining > 0) return;
    const targetId = boss.castTargetId;
    clearCastIf(boss, ...OUR_CASTS);
    if (cast === OSSICK_CUDGEL) {
      landCudgel(ctx, boss, targetId);
    } else if (cast === OSSICK_ANCHOR) {
      const p = st.pending[0] !== undefined ? ctx.entities.get(st.pending[0]) : undefined;
      if (p && !p.dead) landAnchor(ctx, inst, boss, st, p);
      else if (p) dropAuraById(p, OSSICK_ANCHOR_MARK);
    } else {
      const [a, b] = st.pending.map((id) => ctx.entities.get(id));
      if (a && b && !a.dead && !b.dead)
        shacklePair(ctx, boss, st, a, b, inst.difficulty === 'heroic');
    }
    st.pending = [];
    return;
  }
  if (ctx.isStunned(boss) || boss.castingAbility !== null) return;
  if (st.anchorTimer <= 0 && startDrownedAnchor(ctx, inst, boss, st)) return;
  if (st.shackleTimer <= 0 && startShacklePair(ctx, inst, boss, st)) return;
  if (st.cudgelTimer <= 0 && boss.aggroTargetId !== null) {
    st.cudgelTimer = T.cudgelEvery;
    startBar(boss, OSSICK_CUDGEL, T.cudgelCast, boss.aggroTargetId);
  }
}
