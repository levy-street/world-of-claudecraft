// Cantor Ilvane and the Hollow Choir on the Choir Loft: the parish cantor who
// sang the dead to rest, now singing them awake (the third Hollow Crypt boss).
// The fight's coordinator; tuning and the kit's summary in ilvane_ids.ts.
//
//   Dirge of the Hollow  every 16 s (first at 9 s) a 2.5 s bar a kick cuts
//                        (Kick, Pummel, Counterspell: mob/healer_channel.ts);
//                        if it completes, 105 to 125 shadow and a 4 s silence on
//                        every player within 45 yd who can SEE her: the choir
//                        pillars break her sight. The line-of-sight blast is the
//                        trash engine's G6 nova (mob/trash_kit/kit_nova.ts
//                        novaVictims), shared, not copied.
//   Harmony              each living Chorister takes 30 percent off the damage
//                        she takes (a buff_dr aura, retuned as they fall).
//   Bone Organ           every 26 s (first at 18 s) she walks to the organ's
//                        keys and plays: two waves of note lanes down the loft
//                        (ilvane_organ.ts), 100 to 115 shadow in a lane.
//   Crescendo            below 30 percent: a 1.8 s Dirge every 11 s, a third
//                        wave of notes, a quicker gather.
//   Heroic               Encore: a Chorister dead 10 s while its partner lives
//                        rises again. Unbroken Verse: every third Dirge runs
//                        under a cast id no interrupt table knows (hide from it).
//
// Zero rng in every pick; the only draws are damage rolls in claim-player order.

import { isLockedOut } from '../../combat/cc';
import { restoreCastHold } from '../../mob/trash_kit/cast_hold';
import { novaVictims } from '../../mob/trash_kit/kit_nova';
import { spawnKitAdd } from '../../mob/trash_kit/spawn';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, dist2d, type Entity } from '../../types';
import type { IlvaneFightState } from './boss_state';
import {
  claimPlayers,
  clearCastIf,
  dropAuraById,
  grantClaimDeed,
  localOf,
  mechanicDamage,
  pickMarkTargets,
  startBar,
} from './claim';
import {
  CHORISTER_ID,
  dirgeCastIdFor,
  harmonyShare,
  ILVANE_CRESCENDO,
  ILVANE_DIRGE,
  ILVANE_DIRGE_CUT,
  ILVANE_DIRGE_SILENCE,
  ILVANE_ENCORE,
  ILVANE_HARMONY,
  ILVANE_TUNING,
  ILVANE_UNBROKEN_DIRGE,
  NOTE_LANE_YAW,
} from './ilvane_ids';
import { beginOrgan, endOrgan, stepOrgan } from './ilvane_organ';

const T = ILVANE_TUNING;
export const ILVANE_DEED = 'dgn_ilvane_hush';
/** Her Choristers stand within this of her when the fight begins. */
const CHOIR_REACH = 30;

const DIRGE_IDS: readonly string[] = [ILVANE_DIRGE, ILVANE_UNBROKEN_DIRGE];

function freshState(ctx: SimContext, inst: InstanceSlot, boss: Entity): IlvaneFightState {
  const choristerIds: number[] = [];
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (!e || e.dead || e.templateId !== CHORISTER_ID) continue;
    if (dist2d(e.pos, boss.pos) <= CHOIR_REACH) choristerIds.push(id);
  }
  return {
    kind: 'ilvane',
    dirgeTimer: T.dirgeFirst,
    organTimer: T.organFirst,
    dirges: 0,
    kickable: null,
    quiet: 0,
    organ: null,
    choristerIds,
    fallen: [],
    crescendo: false,
    struck: false,
  };
}

function living(ctx: SimContext, st: IlvaneFightState): Entity[] {
  const out: Entity[] = [];
  for (const id of st.choristerIds) {
    const e = ctx.entities.get(id);
    if (e && !e.dead) out.push(e);
  }
  return out;
}

/** Harmony follows the living Choristers (written only on a change). */
function stepHarmony(ctx: SimContext, boss: Entity, st: IlvaneFightState): void {
  const share = harmonyShare(living(ctx, st).length);
  const a = boss.auras.find((x) => x.id === ILVANE_HARMONY);
  if (share <= 0) {
    if (a) dropAuraById(boss, ILVANE_HARMONY);
    return;
  }
  if (a) {
    if (a.value !== share) a.value = share;
    a.remaining = 3600;
    return;
  }
  boss.auras.push({
    id: ILVANE_HARMONY,
    name: 'Harmony',
    kind: 'buff_dr',
    remaining: 3600,
    duration: 3600,
    value: share,
    sourceId: boss.id,
    school: 'shadow',
    undispellable: true,
  });
}

/** Heroic Encore: a Chorister that has lain dead too long while its partner
 *  lives climbs back up where it fell. */
function stepEncore(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: IlvaneFightState): void {
  const o = ctx.instanceOriginOf(inst);
  // Note the newly fallen.
  for (const id of st.choristerIds) {
    const e = ctx.entities.get(id);
    if (e && !e.dead) continue;
    if (st.fallen.some((f) => f.id === id)) continue;
    const at = e ? localOf(ctx, inst, e) : { x: 0, z: 0 };
    st.fallen.push({ id, t: 0, x: at.x, z: at.z });
  }
  const standing = living(ctx, st).length > 0;
  if (!standing) {
    // Both down together: the verse is broken for good.
    st.fallen = [];
    return;
  }
  const keep: IlvaneFightState['fallen'] = [];
  // The risen sing at their own level and pricing (a twin of the spawn-list
  // Chorister, not a softer summoned add).
  const level = living(ctx, st)[0]?.level ?? boss.level;
  for (const f of st.fallen) {
    f.t += DT;
    if (f.t < T.encoreSeconds - 1e-6) {
      keep.push(f);
      continue;
    }
    const victim = pickMarkTargets(boss, claimPlayers(ctx, inst), 1, st.dirges * 5 + 3)[0] ?? null;
    const risen = spawnKitAdd(ctx, inst, boss, CHORISTER_ID, o.x + f.x, o.z + f.z, victim, {
      level,
    });
    st.choristerIds = st.choristerIds.filter((id) => id !== f.id);
    if (!risen) continue;
    st.choristerIds.push(risen.id);
    ctx.emit({
      type: 'spellfx',
      sourceId: risen.id,
      targetId: risen.id,
      school: 'shadow',
      fx: 'nova',
      ability: ILVANE_ENCORE,
    });
  }
  st.fallen = keep;
}

/** The way she faces to sing: toward the middle of her living Choristers,
 *  else down the loft toward its rail (where her choir stood). Pure read. */
function choirFacing(ctx: SimContext, boss: Entity, st: IlvaneFightState): number {
  let x = 0;
  let z = 0;
  let n = 0;
  for (const c of living(ctx, st)) {
    x += c.pos.x;
    z += c.pos.z;
    n++;
  }
  if (n > 0) {
    const dx = x / n - boss.pos.x;
    const dz = z / n - boss.pos.z;
    if (dx * dx + dz * dz > 1) return Math.atan2(dx, dz);
  }
  return NOTE_LANE_YAW;
}

/** Start a Dirge (the cadence and the dev trigger). */
export function startDirge(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: IlvaneFightState,
): boolean {
  if (st.organ || boss.castingAbility !== null) return false;
  const castId = dirgeCastIdFor(st.dirges, inst.difficulty === 'heroic');
  st.dirges++;
  st.kickable = castId === ILVANE_DIRGE ? castId : null;
  startBar(boss, castId, st.crescendo ? T.dirgeCastCrescendo : T.dirgeCast, null);
  // She sings planted: the spot the bar began on, turned to her choir, held
  // for the whole bar however her foe moves (mob/trash_kit/cast_hold.ts).
  boss.facing = choirFacing(ctx, boss, st);
  boss.castHold = { castId, x: boss.pos.x, y: boss.pos.y, z: boss.pos.z, facing: boss.facing };
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'windup',
    ability: castId,
  });
  st.dirgeTimer = st.crescendo ? T.dirgeEveryCrescendo : T.dirgeEvery;
  return true;
}

/** The Dirge completes: every player who can see her is struck and silenced. */
function landDirge(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: IlvaneFightState,
  castId: string,
): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'nova',
    ability: castId,
  });
  const victims = novaVictims(ctx, boss, T.dirgeRadius, claimPlayers(ctx, inst));
  if (victims.length > 0) st.struck = true;
  for (const p of victims) {
    ctx.dealDamage(
      boss,
      p,
      mechanicDamage(ctx, boss, T.dirgeMin, T.dirgeMax),
      false,
      'shadow',
      'Dirge of the Hollow',
      'hit',
      true,
    );
    if (p.dead) continue;
    ctx.applyAura(p, {
      id: ILVANE_DIRGE_SILENCE,
      name: 'Dirge of the Hollow',
      kind: 'silence',
      remaining: T.dirgeSilence,
      duration: T.dirgeSilence,
      value: 0,
      sourceId: boss.id,
      school: 'shadow',
    });
  }
}

/** Below 30 percent: Crescendo (dev trigger too). */
export function beginCrescendo(boss: Entity, st: IlvaneFightState): boolean {
  if (st.crescendo) return false;
  st.crescendo = true;
  st.dirgeTimer = Math.min(st.dirgeTimer, T.dirgeEveryCrescendo);
  boss.auras.push({
    id: ILVANE_CRESCENDO,
    name: 'Crescendo',
    kind: 'buff_haste',
    remaining: 3600,
    duration: 3600,
    value: 1,
    sourceId: boss.id,
    school: 'shadow',
    undispellable: true,
  });
  return true;
}

function stepDirge(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: IlvaneFightState): void {
  // A kickable Dirge that is gone before she finished it was cut (a kick):
  // between two passes only a player interrupt clears her bar (she is CC-immune,
  // an evade or a death resets the fight first, the dev triggers and the organ
  // never start over a running Dirge).
  if (st.kickable !== null && boss.castingAbility !== st.kickable) {
    st.kickable = null;
    st.quiet = T.kickQuiet;
    boss.castHold = undefined;
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'shadow',
      fx: 'nova',
      ability: ILVANE_DIRGE_CUT,
    });
  }
  const casting = boss.castingAbility;
  if (casting === null || !DIRGE_IDS.includes(casting)) return;
  // The mob AI walked and turned her this tick: stand her back on the spot
  // and the facing the bar began with (a bar started before the hold existed
  // takes its hold here).
  if (boss.castHold?.castId !== casting)
    boss.castHold = {
      castId: casting,
      x: boss.pos.x,
      y: boss.pos.y,
      z: boss.pos.z,
      facing: boss.facing,
    };
  restoreCastHold(boss);
  boss.swingTimer = Math.max(boss.swingTimer, 0.6);
  ctx.grid.update(boss);
  boss.castRemaining = Math.max(0, boss.castRemaining - DT);
  if (boss.castRemaining > 1e-6) return;
  st.kickable = null;
  boss.castHold = undefined;
  clearCastIf(boss, casting);
  landDirge(ctx, inst, boss, st, casting);
}

function clearPlayers(ctx: SimContext, inst: InstanceSlot): void {
  for (const p of claimPlayers(ctx, inst)) dropAuraById(p, ILVANE_DIRGE_SILENCE);
}

/** The fight ended (a wipe, an evade, a reset): the notes go, her harmony and
 *  crescendo lift. Risen Choristers belong to the fight and go with it. */
export function resetIlvane(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  const st = boss.cryptBossFight;
  if (st?.kind === 'ilvane') {
    endOrgan(ctx, inst, boss, st);
    for (const id of DIRGE_IDS) clearCastIf(boss, id);
  }
  boss.castHold = undefined;
  boss.auras = boss.auras.filter((a) => a.id !== ILVANE_HARMONY && a.id !== ILVANE_CRESCENDO);
  clearPlayers(ctx, inst);
  boss.cryptBossFight = undefined;
}

function concludeIlvane(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: IlvaneFightState,
): void {
  if (!st.struck) grantClaimDeed(ctx, inst, ILVANE_DEED);
  endOrgan(ctx, inst, boss, st);
  boss.cryptBossFight = undefined;
}

/** One tick of Cantor Ilvane's fight. */
export function tickIlvane(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  engaged: boolean,
): void {
  let st = boss.cryptBossFight?.kind === 'ilvane' ? boss.cryptBossFight : null;
  if (boss.dead) {
    if (st) concludeIlvane(ctx, inst, boss, st);
    return;
  }
  if (!engaged && !(st?.organ && claimPlayers(ctx, inst).length > 0)) {
    if (st) resetIlvane(ctx, inst, boss);
    return;
  }
  if (!st) {
    st = freshState(ctx, inst, boss);
    boss.cryptBossFight = st;
  }
  if (inst.difficulty === 'heroic') stepEncore(ctx, inst, boss, st);
  stepHarmony(ctx, boss, st);
  st.quiet = Math.max(0, st.quiet - DT);
  st.dirgeTimer -= DT;
  st.organTimer -= DT;
  const share = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1;
  if (!st.crescendo && share <= T.crescendoAt) beginCrescendo(boss, st);
  if (stepOrgan(ctx, inst, boss, st)) return;
  stepDirge(ctx, inst, boss, st);
  if (ctx.isStunned(boss) || boss.castingAbility !== null) return;
  // One at a time: the organ first (its walk takes a moment), then the Dirge.
  if (st.organTimer <= 0 && beginOrgan(boss, st)) {
    stepOrgan(ctx, inst, boss, st);
    return;
  }
  if (st.dirgeTimer <= 0 && st.quiet <= 0 && !isLockedOut(boss, 'shadow'))
    startDirge(ctx, inst, boss, st);
}
