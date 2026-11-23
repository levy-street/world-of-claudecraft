// Morthen's entrance at the Rite Ring. He is not in his arena when the group
// climbs the Bone Stair: he lies ENTOMBED under the ritual circle (hidden from
// every client, non-hostile, immune: nothing can target, hit or pull him).
// The first living player to step into the ring wakes the rite:
//
//   wakes     3 s    the circle ignites over him (the rite's cast bar)
//   rise      6 s    he breaks the floor and rises slowly into the sky
//   proclaim  3.5 s  he hangs over the ring and speaks
//   descend   2.5 s  he comes down onto his spot at the altar
//   land      1.2 s  the landing throws the close clear; then he fights
//
// Through the whole entrance he is untouchable (Grave Ascension): held by the
// encounter (Entity.encounterHeld, so the mob AI never pulls or moves him),
// non-hostile (no attack, spell, pet or AoE can reach him) and damage immune.
// Only when he lands is he handed back hostile and he engages the nearest
// player in the ring. The whole entrance is driven by fixed DT countdowns on
// his entity (cast bar, height, auras), so every client, a late joiner
// included, sees the same moment of it. Zero rng. Plays once per claim: after
// a wipe he simply stands at the altar.

import { applyKnockback } from '../../knockback';
import { emitMobYell } from '../../mob/yells';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { angleTo, type CryptRiteState, DT, dist2d, type Entity } from '../../types';
import { claimPlayers, clearCastOf, startCast } from './claim';
import {
  CRYPT_ENTOMBED,
  CRYPT_GRAVE_ASCENSION,
  MORTHEN_DESCEND,
  MORTHEN_LANDING,
  MORTHEN_PROCLAIM,
  MORTHEN_RISE,
  MORTHEN_RISE_TUNING,
  MORTHEN_RITE_WAKES,
  MORTHEN_SPOT,
  morthenEntranceHeight,
  RITE_RING,
} from './ids';

const T = MORTHEN_RISE_TUNING;

/** What he says over the ring (sim English, re-localized by the client's
 *  EXACT matcher: log.hollowCryptMorthenRise in src/ui/sim_i18n.ts). */
export const MORTHEN_RISE_YELL =
  'You climbed the Bone Stair to find me? Then your names are already in my ledger!';

export function freshRite(): CryptRiteState {
  return {
    phase: 'dormant',
    t: 0,
    finale: 'none',
    ft: 0,
    wyrmId: null,
    pyreObjectId: null,
  };
}

function hasAura(e: Entity, id: string): boolean {
  return e.auras.some((a) => a.id === id);
}

/** Put (or keep) a permanent marker aura on an encounter-held entity. */
export function markAura(e: Entity, id: string, name: string): void {
  if (hasAura(e, id)) return;
  e.auras.push({
    id,
    name,
    kind: 'buff_dr',
    remaining: 3600,
    duration: 3600,
    permanent: true,
    value: 0,
    sourceId: e.id,
    school: 'shadow',
  });
}

export function dropAura(e: Entity, id: string): void {
  if (hasAura(e, id)) e.auras = e.auras.filter((a) => a.id !== id);
}

/** Hold a mob for a scripted entrance: inert, non-hostile, immune. */
export function holdForEntrance(e: Entity): void {
  e.encounterHeld = true;
  e.damageImmune = true;
  e.hostile = false;
  e.inCombat = false;
  e.aggroTargetId = null;
  e.aiState = 'idle';
  e.autoAttack = false;
}

/** Hand a held mob back to the fight: hostile and vulnerable again. */
export function releaseFromEntrance(e: Entity): void {
  e.encounterHeld = false;
  e.damageImmune = false;
  e.hostile = true;
  dropAura(e, CRYPT_ENTOMBED);
  dropAura(e, CRYPT_GRAVE_ASCENSION);
}

/** His spot's floor height, in world yards. */
function spotFloor(ctx: SimContext, inst: InstanceSlot): { x: number; y: number; z: number } {
  const o = ctx.instanceOriginOf(inst);
  const g = ctx.groundPos(o.x + MORTHEN_SPOT.x, o.z + MORTHEN_SPOT.z);
  return { x: o.x + MORTHEN_SPOT.x, y: g.y, z: o.z + MORTHEN_SPOT.z };
}

/** Is a living claim player standing in the ring (on its floor, inside the rim)? */
export function playerInRing(ctx: SimContext, inst: InstanceSlot): Entity | null {
  const o = ctx.instanceOriginOf(inst);
  const floor = spotFloor(ctx, inst).y;
  for (const p of claimPlayers(ctx, inst)) {
    const d = Math.hypot(p.pos.x - o.x - RITE_RING.x, p.pos.z - o.z - RITE_RING.z);
    if (d <= RITE_RING.r - T.triggerInset && p.pos.y > floor - 4) return p;
  }
  return null;
}

function place(ctx: SimContext, inst: InstanceSlot, boss: Entity, up: number): void {
  const spot = spotFloor(ctx, inst);
  boss.pos.x = spot.x;
  boss.pos.z = spot.z;
  boss.pos.y = spot.y + up;
  ctx.grid.update(boss);
}

function enter(boss: Entity, st: CryptRiteState, phase: CryptRiteState['phase']): void {
  st.phase = phase;
  st.t = 0;
}

/** Start the entrance now (the ring trigger, or `/dev crypt rise`). */
export function wakeRite(ctx: SimContext, inst: InstanceSlot, boss: Entity): boolean {
  const st = boss.cryptRite;
  if (!st || st.phase !== 'dormant' || boss.dead) return false;
  enter(boss, st, 'wakes');
  startCast(boss, MORTHEN_RITE_WAKES, T.wakeSeconds, null, true);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'windup',
    ability: MORTHEN_RITE_WAKES,
  });
  place(ctx, inst, boss, morthenEntranceHeight('wakes', 0));
  return true;
}

/** Skip the entrance: he stands ready at the altar (dev helpers and tests). */
export function finishRite(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  if (!boss.cryptRite) boss.cryptRite = freshRite();
  const st = boss.cryptRite;
  for (const id of [MORTHEN_RITE_WAKES, MORTHEN_RISE, MORTHEN_PROCLAIM, MORTHEN_DESCEND])
    clearCastOf(boss, id);
  st.phase = 'risen';
  st.t = 0;
  releaseFromEntrance(boss);
  if (!boss.dead) place(ctx, inst, boss, 0);
}

/** The landing: anyone standing under him is thrown clear, and he fights. */
function land(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  place(ctx, inst, boss, 0);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'nova',
    ability: MORTHEN_LANDING,
  });
  for (const p of claimPlayers(ctx, inst)) {
    if (dist2d(p.pos, boss.pos) <= T.landingReach) applyKnockback(ctx, boss, p, T.landingKnockback);
  }
}

/** Hand him to the fight on the nearest living player in the ring. */
function engage(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  releaseFromEntrance(boss);
  let best: Entity | null = null;
  let bestD: number = T.engageRange;
  for (const p of claimPlayers(ctx, inst)) {
    const d = dist2d(p.pos, boss.pos);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  if (best) {
    boss.facing = angleTo(boss.pos, best.pos);
    boss.prevFacing = boss.facing;
    ctx.aggroMob(boss, best, false);
  }
}

/** One tick of Morthen's entrance. Returns true once he has risen. */
export function tickMorthenRite(ctx: SimContext, inst: InstanceSlot, boss: Entity): boolean {
  if (!boss.cryptRite) boss.cryptRite = freshRite();
  const st = boss.cryptRite;
  if (st.phase === 'risen') return true;
  if (boss.dead) {
    // Slain mid-entrance (a dev kill): never leave a hidden, untouchable corpse.
    finishRite(ctx, inst, boss);
    return true;
  }
  holdForEntrance(boss);
  if (st.phase === 'dormant' || st.phase === 'wakes') markAura(boss, CRYPT_ENTOMBED, 'Entombed');
  else dropAura(boss, CRYPT_ENTOMBED);
  markAura(boss, CRYPT_GRAVE_ASCENSION, 'Grave Ascension');
  if (st.phase === 'dormant') {
    place(ctx, inst, boss, morthenEntranceHeight('dormant', 0));
    if (playerInRing(ctx, inst)) wakeRite(ctx, inst, boss);
    return false;
  }
  st.t += DT;
  const castId =
    st.phase === 'wakes'
      ? MORTHEN_RITE_WAKES
      : st.phase === 'rise'
        ? MORTHEN_RISE
        : st.phase === 'proclaim'
          ? MORTHEN_PROCLAIM
          : st.phase === 'descend'
            ? MORTHEN_DESCEND
            : null;
  if (castId && boss.castingAbility === castId)
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
  place(ctx, inst, boss, morthenEntranceHeight(st.phase, st.t));
  switch (st.phase) {
    case 'wakes':
      if (st.t >= T.wakeSeconds) {
        clearCastOf(boss, MORTHEN_RITE_WAKES);
        enter(boss, st, 'rise');
        startCast(boss, MORTHEN_RISE, T.riseSeconds, null, true);
        ctx.emit({
          type: 'spellfx',
          sourceId: boss.id,
          targetId: boss.id,
          school: 'shadow',
          fx: 'nova',
          ability: MORTHEN_RISE,
        });
      }
      break;
    case 'rise':
      if (st.t >= T.riseSeconds) {
        clearCastOf(boss, MORTHEN_RISE);
        enter(boss, st, 'proclaim');
        startCast(boss, MORTHEN_PROCLAIM, T.proclaimSeconds, null, true);
        emitMobYell(ctx, boss, MORTHEN_RISE_YELL);
      }
      break;
    case 'proclaim': {
      // He turns to look down on whoever woke him.
      const p = playerInRing(ctx, inst);
      if (p) boss.facing = angleTo(boss.pos, p.pos);
      if (st.t >= T.proclaimSeconds) {
        clearCastOf(boss, MORTHEN_PROCLAIM);
        enter(boss, st, 'descend');
        startCast(boss, MORTHEN_DESCEND, T.descendSeconds, null, true);
      }
      break;
    }
    case 'descend':
      if (st.t >= T.descendSeconds) {
        clearCastOf(boss, MORTHEN_DESCEND);
        enter(boss, st, 'land');
        land(ctx, inst, boss);
      }
      break;
    case 'land':
      if (st.t >= T.landSeconds) {
        enter(boss, st, 'risen');
        engage(ctx, inst, boss);
        return true;
      }
      break;
  }
  return false;
}
