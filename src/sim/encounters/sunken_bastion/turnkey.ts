// The Gaol Turnkey, the Sunken Gaol's miniboss: the drowned jailer locks one
// player at a time in an Iron Cage that the prisoner must break out of.
//
//   Iron Cage        every 24 s (first at 9 s) a 1.6 s bar, a cage shadow
//                    growing under a non-tank player; then an iron cage drops
//                    over them. The prisoner is locked in (a stun nothing
//                    breaks) and BREAKS FREE by pressing the interact key again
//                    and again: every counted press breaks one point of the
//                    cage (16 points), counted presses are at least 0.12 s
//                    apart (anything faster is ignored), and the cage mends a
//                    point every 0.6 s. Teammates free them faster: any hit
//                    (a player's or a pet's) on the cage breaks two points.
//                    Nobody broke it in 10 s: the cage crushes its prisoner
//                    for 30 percent of their health and bursts.
//   Open the Cells   at half health the lantern goes up and two prisoners
//                    break out (the template's summonAdds).
//   Heroic           Two cages at once, 20 points each, a crush of 45 percent,
//                    and the brine rises inside: 2 percent of the prisoner's
//                    health on the first second, one more every second after.
//
// The press is the ordinary interact command (sim.interact): a caged player's
// interact is claimed here before anything else, so no new wire command, and
// the whole rate limit is authoritative (the server runs this same sim). Every
// visible state rides existing fields: the cage is a mob whose health IS the
// escape progress, and the Caged aura's sourceId names the cage. Zero rng in
// every pick, and no rng draw at all (the crush and flood are shares).

import { spawnKitAdd } from '../../mob/trash_kit/spawn';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity, type GaolCageState, type TurnkeyFightState } from '../../types';
import {
  claimPlayers,
  clearCastIf,
  dropAuraById,
  dropEncounterBody,
  grantClaimDeed,
  pickMarkTargets,
  startBar,
} from './claim';
import {
  cageDropHeight,
  cageFloodShare,
  cageHits,
  GAOL_CAGE_ID,
  TURNKEY_CAGE_MARK,
  TURNKEY_CAGED,
  TURNKEY_IRON_CAGE,
  TURNKEY_TUNING,
} from './ids';

const T = TURNKEY_TUNING;
export const TURNKEY_DEED = 'dgn_turnkey_cage';

function freshState(): TurnkeyFightState {
  return {
    kind: 'turnkey',
    cageTimer: T.cageFirst,
    casts: 0,
    pending: [],
    cageIds: [],
    crushed: false,
  };
}

function cageStateOf(cage: Entity | undefined): GaolCageState | null {
  return cage?.bastionFight?.kind === 'cage' ? cage.bastionFight : null;
}

/** Is this player locked in an Iron Cage? */
export function cagedBy(p: Entity): number | null {
  for (const a of p.auras) if (a.id === TURNKEY_CAGED) return a.sourceId;
  return null;
}

/** Lock `p` in a fresh cage dropped where they stand. */
function dropCage(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: TurnkeyFightState,
  p: Entity,
): void {
  dropAuraById(p, TURNKEY_CAGE_MARK);
  const cage = spawnKitAdd(ctx, inst, boss, GAOL_CAGE_ID, p.pos.x, p.pos.z, null);
  if (!cage) return;
  const hits = cageHits(inst.difficulty === 'heroic');
  cage.maxHp = hits;
  cage.hp = hits;
  cage.facing = boss.facing;
  cage.prevFacing = cage.facing;
  const floorY = cage.pos.y;
  cage.bastionFight = {
    kind: 'cage',
    prisonerId: p.id,
    ownerId: boss.id,
    age: 0,
    pressAt: -Infinity,
    presses: 0,
    mend: T.mendEvery,
    flooded: 0,
    floorY,
  };
  // It drops from above: the body starts high and falls onto its prisoner.
  cage.pos.y = floorY + cageDropHeight(0);
  cage.prevPos = { ...cage.pos };
  ctx.grid.update(cage);
  st.cageIds.push(cage.id);
  ctx.applyAura(p, {
    id: TURNKEY_CAGED,
    name: 'Iron Cage',
    kind: 'stun',
    // The cage owns the clock (it crushes at cageMax); the aura only outlives it.
    remaining: T.cageMax + 1,
    duration: T.cageMax + 1,
    value: 0,
    // The cage, not the Turnkey: the client finds the cage (and its health,
    // the escape progress) from this aura.
    sourceId: cage.id,
    school: 'physical',
    unbreakableControl: true,
    undispellable: true,
  });
}

/** Open a cage: its prisoner walks free and the cage is gone. */
function openCage(
  ctx: SimContext,
  inst: InstanceSlot,
  st: TurnkeyFightState | null,
  cage: Entity,
  owner: Entity | null,
): void {
  const cs = cageStateOf(cage);
  const p = cs ? ctx.entities.get(cs.prisonerId) : undefined;
  if (p) dropAuraById(p, TURNKEY_CAGED);
  if (st) st.cageIds = st.cageIds.filter((id) => id !== cage.id);
  ctx.emit({
    type: 'spellfx',
    sourceId: cage.id,
    targetId: p?.id ?? cage.id,
    school: 'physical',
    fx: 'nova',
    ability: TURNKEY_CAGED,
  });
  dropEncounterBody(ctx, inst, owner, cage.id);
}

/**
 * A caged player's escape press, claimed from sim.interact before any other
 * interaction. Returns true when the player is caged (the press is spent here,
 * counted or not). Server-validated: only the prisoner of a live cage counts,
 * and a press closer than `pressGap` to the last counted one is ignored.
 */
export function tryCageStruggle(ctx: SimContext, p: Entity): boolean {
  const cageId = cagedBy(p);
  if (cageId === null) return false;
  const cage = ctx.entities.get(cageId);
  const cs = cageStateOf(cage);
  if (!cage || !cs || cage.dead || cs.prisonerId !== p.id) return true;
  if (ctx.time - cs.pressAt < T.pressGap - 1e-9) return true;
  cs.pressAt = ctx.time;
  cs.presses++;
  cage.hp = Math.max(0, cage.hp - T.pressPoints);
  return true;
}

/** One tick of every cage: mend, flood, crush, or open. */
function stepCages(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: TurnkeyFightState): void {
  const heroic = inst.difficulty === 'heroic';
  for (const id of [...st.cageIds]) {
    const cage = ctx.entities.get(id);
    const cs = cageStateOf(cage);
    if (!cage || !cs) {
      st.cageIds = st.cageIds.filter((c) => c !== id);
      continue;
    }
    const p = ctx.entities.get(cs.prisonerId);
    // Broken (by the prisoner or the group), or nobody left inside.
    if (cage.dead || cage.hp <= 0 || !p || p.dead || cagedBy(p) !== cage.id) {
      openCage(ctx, inst, st, cage, boss);
      continue;
    }
    const wasFalling = cs.age < T.dropSeconds;
    cs.age += DT;
    if (wasFalling) {
      cage.pos.y = cs.floorY + cageDropHeight(cs.age);
      ctx.grid.update(cage);
      // The slam: bars bite the flags round the prisoner.
      if (cs.age >= T.dropSeconds) {
        ctx.emit({
          type: 'spellfx',
          sourceId: boss.id,
          targetId: cage.id,
          school: 'physical',
          fx: 'detonate',
          ability: TURNKEY_IRON_CAGE,
        });
      }
    }
    cage.facing = cage.prevFacing;
    cage.swingTimer = Math.max(cage.swingTimer, 5);
    // A shove never carries the prisoner out through the bars.
    if (Math.hypot(p.pos.x - cage.pos.x, p.pos.z - cage.pos.z) > 0.9) {
      p.pos.x = cage.pos.x;
      p.pos.z = cage.pos.z;
      p.pos.y = cs.floorY;
      ctx.grid.update(p);
    }
    cs.mend -= DT;
    if (cs.mend <= 0) {
      cs.mend += T.mendEvery;
      cage.hp = Math.min(cage.maxHp, cage.hp + 1);
    }
    if (heroic && cs.age >= cs.flooded + 1) {
      cs.flooded += 1;
      const amount = Math.max(1, Math.round(p.maxHp * cageFloodShare(cs.flooded)));
      ctx.dealDamage(boss, p, amount, false, 'frost', 'Brine Flood', 'hit', true);
    }
    if (cs.age >= T.cageMax) {
      st.crushed = true;
      const share = heroic ? T.crushShareHeroic : T.crushShare;
      if (!p.dead) {
        const amount = Math.max(1, Math.round(p.maxHp * share));
        ctx.dealDamage(boss, p, amount, false, 'physical', 'Crushing Irons', 'hit', true);
      }
      openCage(ctx, inst, st, cage, boss);
    }
  }
}

/** Start an Iron Cage bar now (the dev trigger and the cadence share it). */
export function startIronCage(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: TurnkeyFightState,
): boolean {
  const count = inst.difficulty === 'heroic' ? T.cagesHeroic : 1;
  const busy = new Set<number>();
  for (const p of claimPlayers(ctx, inst)) if (cagedBy(p) !== null) busy.add(p.id);
  const targets = pickMarkTargets(boss, claimPlayers(ctx, inst), count, st.casts, busy);
  if (targets.length === 0) return false;
  st.casts++;
  st.cageTimer = T.cageEvery;
  startBar(boss, TURNKEY_IRON_CAGE, T.cageCast, targets[0].id);
  st.pending = targets.map((t) => t.id);
  for (const t of targets) {
    ctx.applyAura(t, {
      id: TURNKEY_CAGE_MARK,
      name: 'Iron Cage',
      // A mark, not a slow: the value leaves the runner at full speed.
      kind: 'slow',
      remaining: T.cageCast,
      duration: T.cageCast,
      value: 1,
      sourceId: boss.id,
      school: 'physical',
      undispellable: true,
    });
  }
  return true;
}

/** The fight ended: every cage opens, the marks come off. */
export function resetTurnkey(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  const st = boss.bastionFight?.kind === 'turnkey' ? boss.bastionFight : null;
  if (st) {
    for (const id of [...st.cageIds]) {
      const cage = ctx.entities.get(id);
      if (cage) openCage(ctx, inst, st, cage, boss);
    }
    for (const id of st.pending) {
      const p = ctx.entities.get(id);
      if (p) dropAuraById(p, TURNKEY_CAGE_MARK);
    }
  }
  clearCastIf(boss, TURNKEY_IRON_CAGE);
  boss.bastionFight = undefined;
}

/** One tick of the Turnkey's fight. */
export function tickTurnkey(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  engaged: boolean,
): void {
  let st = boss.bastionFight?.kind === 'turnkey' ? boss.bastionFight : null;
  if (boss.dead) {
    if (st) {
      if (!st.crushed) grantClaimDeed(ctx, inst, TURNKEY_DEED);
      resetTurnkey(ctx, inst, boss);
    }
    return;
  }
  if (!engaged) {
    if (st) resetTurnkey(ctx, inst, boss);
    return;
  }
  if (!st) {
    st = freshState();
    boss.bastionFight = st;
  }
  stepCages(ctx, inst, boss, st);
  st.cageTimer -= DT;
  if (boss.castingAbility === TURNKEY_IRON_CAGE) {
    boss.swingTimer = Math.max(boss.swingTimer, 0.6);
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
    const target = boss.castTargetId !== null ? ctx.entities.get(boss.castTargetId) : undefined;
    if (target && !target.dead)
      boss.facing = Math.atan2(target.pos.x - boss.pos.x, target.pos.z - boss.pos.z);
    if (boss.castRemaining > 0) return;
    clearCastIf(boss, TURNKEY_IRON_CAGE);
    for (const id of st.pending) {
      const p = ctx.entities.get(id);
      if (p && !p.dead && cagedBy(p) === null) dropCage(ctx, inst, boss, st, p);
    }
    st.pending = [];
    return;
  }
  if (ctx.isStunned(boss) || boss.castingAbility !== null) return;
  if (st.cageTimer <= 0) startIronCage(ctx, inst, boss, st);
}
