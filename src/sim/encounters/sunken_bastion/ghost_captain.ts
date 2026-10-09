// The captain's threats are locked, replicated objects, never client predictions.
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity, type GhostCaptainFightState } from '../../types';
import {
  claimPlayers,
  clearCastIf,
  dropEncounterObject,
  grantClaimDeed,
  localOf,
  mechanicDamage,
  pickMarkTargets,
  spawnEncounterObject,
  startBar,
} from './claim';
import {
  GHOST_ANCHOR_DRAG,
  GHOST_ANCHOR_LANE,
  GHOST_ANCHOR_WIDTH,
  GHOST_BOARDING_LANE,
  GHOST_BOARDING_SLASH,
  GHOST_BOARDING_WIDTH,
  GHOST_BROADSIDE_FIRE,
  GHOST_BROADSIDE_LANE,
  GHOST_BROADSIDE_SHIP,
  GHOST_BROADSIDE_WIDTH,
  GHOST_CAPTAIN_ANCHOR,
  GHOST_CAPTAIN_BOARDING,
  GHOST_CAPTAIN_BROADSIDE,
  type GhostCaptainMove,
  inGhostLane,
  GHOST_CAPTAIN_TUNING as T,
} from './ghost_captain_ids';

export const TURRETBACK_DEED = 'dgn_turretback';
const CAST = {
  broadside: GHOST_CAPTAIN_BROADSIDE,
  anchor: GHOST_CAPTAIN_ANCHOR,
  boarding: GHOST_CAPTAIN_BOARDING,
};
const NAME = {
  broadside: 'Spectral Broadside',
  anchor: 'Cursed Anchor',
  boarding: 'Phantom Boarding',
};
const WARN = {
  broadside: GHOST_BROADSIDE_LANE,
  anchor: GHOST_ANCHOR_LANE,
  boarding: GHOST_BOARDING_LANE,
};
const ACTIVE = {
  broadside: GHOST_BROADSIDE_FIRE,
  anchor: GHOST_ANCHOR_DRAG,
  boarding: GHOST_BOARDING_SLASH,
};
const WIDTH = {
  broadside: GHOST_BROADSIDE_WIDTH,
  anchor: GHOST_ANCHOR_WIDTH,
  boarding: GHOST_BOARDING_WIDTH,
};
const LENGTH = { broadside: T.broadsideLength, anchor: T.anchorLength, boarding: T.boardingLength };
const WARNING = {
  broadside: T.broadsideWarning,
  anchor: T.anchorWarning,
  boarding: T.boardingWarning,
};
const ORDER: readonly GhostCaptainMove[] = ['broadside', 'anchor', 'boarding'];

function nearbyPlayers(ctx: SimContext, inst: InstanceSlot, boss: Entity): Entity[] {
  return claimPlayers(ctx, inst).filter(
    (p) =>
      Math.hypot(p.pos.x - boss.pos.x, p.pos.z - boss.pos.z) <= 40 &&
      Math.abs(p.pos.y - boss.pos.y) <= 6 &&
      ctx.hasLineOfSight(boss, p),
  );
}

function clearObjects(ctx: SimContext, inst: InstanceSlot, st: GhostCaptainFightState): void {
  for (const id of st.action?.objects ?? []) dropEncounterObject(ctx, inst, id);
  st.action = null;
}

/** Start a mechanic; also used by deterministic encounter previews and tests. */
export function startGhostCaptainMove(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  move: GhostCaptainMove,
): boolean {
  const st = boss.bastionFight;
  if (st?.kind !== 'ghostCaptain' || st.action || boss.dead || boss.castingAbility !== null)
    return false;
  const target = pickMarkTargets(boss, nearbyPlayers(ctx, inst, boss), 1, st.next + 37)[0];
  if (!target) return false;
  const spot = localOf(ctx, inst, boss);
  const targetSpot = localOf(ctx, inst, target);
  const yaw = Math.atan2(targetSpot.x - spot.x, targetSpot.z - spot.z);
  const action: NonNullable<GhostCaptainFightState['action']> = {
    move,
    stage: 'warning',
    elapsed: 0,
    seconds: WARNING[move],
    x: spot.x,
    z: spot.z,
    yaw,
    objects: [],
    hit: [],
  };
  st.action = action;
  boss.facing = yaw;
  startBar(boss, CAST[move], action.seconds, target.id);
  const make = (template: string, x: number, z: number, length: number) => {
    const obj = spawnEncounterObject(ctx, inst, template, NAME[move], x, z, yaw, length);
    // The existing wire only serializes cast clocks while a cast id is present.
    // Objects never run mob casting; this is their replicated presentation clock.
    obj.castingAbility = CAST[move];
    obj.castTotal = action.seconds + (template === GHOST_BROADSIDE_SHIP ? T.flashSeconds : 0);
    obj.castRemaining = obj.castTotal;
    action.objects.push(obj.id);
  };
  if (move === 'broadside') {
    // Start behind the captain: all five parallel lanes cross his position.
    const x = spot.x - Math.sin(yaw) * 8;
    const z = spot.z - Math.cos(yaw) * 8;
    for (const offset of T.broadsideOffsets)
      make(WARN[move], x + Math.cos(yaw) * offset, z - Math.sin(yaw) * offset, LENGTH[move]);
    make(GHOST_BROADSIDE_SHIP, x, z, 1);
  } else make(WARN[move], spot.x, spot.z, LENGTH[move]);
  return true;
}

function strike(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: GhostCaptainFightState,
  before: number,
): void {
  const a = st.action;
  if (!a) return;
  const min =
    a.move === 'broadside' ? T.broadsideMin : a.move === 'anchor' ? T.anchorMin : T.boardingMin;
  const max =
    a.move === 'broadside' ? T.broadsideMax : a.move === 'anchor' ? T.anchorMax : T.boardingMax;
  for (const p of nearbyPlayers(ctx, inst, boss)) {
    if (a.hit.includes(p.id)) continue;
    for (const id of a.objects) {
      const obj = ctx.entities.get(id);
      if (!obj || obj.templateId === GHOST_BROADSIDE_SHIP) continue;
      const lane = {
        x: obj.pos.x,
        z: obj.pos.z,
        yaw: obj.facing,
        length: obj.scale,
        width: WIDTH[a.move],
      };
      const from =
        a.move === 'anchor'
          ? Math.max(0, lane.length * (1 - a.elapsed / a.seconds) - WIDTH.anchor / 2)
          : 0;
      const to =
        a.move === 'anchor'
          ? Math.min(lane.length, lane.length * (1 - before / a.seconds) + WIDTH.anchor / 2)
          : lane.length;
      if (!inGhostLane(lane, p.pos.x, p.pos.z, from, to)) continue;
      // Solid fortification still shields players when a lane crosses a wall.
      if (!ctx.hasLineOfSight(boss, p)) continue;
      a.hit.push(p.id);
      if (a.move === 'broadside') st.struck = true;
      ctx.dealDamage(
        boss,
        p,
        mechanicDamage(ctx, boss, min, max),
        false,
        'frost',
        CAST[a.move],
        'hit',
        true,
      );
      break;
    }
  }
}

/** Existing entity fields mirror every tell, and all ephemeral objects die with the pull. */
export function tickGhostCaptain(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  engaged: boolean,
): void {
  let st = boss.bastionFight?.kind === 'ghostCaptain' ? boss.bastionFight : undefined;
  // Losing sight briefly is counterplay, not a fresh pull or a cleared deed failure.
  if (!engaged || claimPlayers(ctx, inst).length === 0) {
    if (st) {
      if (boss.dead && !st.struck) grantClaimDeed(ctx, inst, TURRETBACK_DEED);
      clearObjects(ctx, inst, st);
      clearCastIf(boss, ...Object.values(CAST));
      boss.bastionFight = undefined;
    }
    return;
  }
  if (!st) {
    st = { kind: 'ghostCaptain', next: 0, timer: T.first, struck: false, action: null };
    boss.bastionFight = st;
  }
  const a = st.action;
  if (!a) {
    st.timer -= DT;
    if (
      st.timer <= 0 &&
      !ctx.isStunned(boss) &&
      startGhostCaptainMove(ctx, inst, boss, ORDER[st.next % ORDER.length])
    )
      st.next++;
    return;
  }
  const o = ctx.instanceOriginOf(inst);
  // Hold warnings and the anchor haul at their authored position, after the AI tick.
  const g = ctx.groundPos(o.x + a.x, o.z + a.z);
  boss.pos = g;
  boss.facing = a.yaw;
  boss.swingTimer = Math.max(boss.swingTimer, 0.6);
  ctx.grid.update(boss);
  if (a.stage === 'warning' && (boss.castingAbility !== CAST[a.move] || ctx.isStunned(boss))) {
    clearCastIf(boss, ...Object.values(CAST));
    clearObjects(ctx, inst, st);
    st.timer = T.recovery;
    return;
  }
  const before = a.elapsed;
  a.elapsed = Math.min(a.seconds, a.elapsed + DT);
  if (a.stage === 'warning') boss.castRemaining = Math.max(0, a.seconds - a.elapsed);
  for (const id of a.objects) {
    const obj = ctx.entities.get(id);
    if (obj)
      obj.castRemaining = Math.max(
        0,
        a.seconds -
          a.elapsed +
          (obj.templateId === GHOST_BROADSIDE_SHIP && a.stage === 'warning' ? T.flashSeconds : 0),
      );
  }
  if (a.stage === 'active' && a.move === 'anchor') strike(ctx, inst, boss, st, before);
  if (a.elapsed < a.seconds - 1e-6) return;
  if (a.stage === 'warning') {
    clearCastIf(boss, ...Object.values(CAST));
    a.stage = 'active';
    a.elapsed = 0;
    a.seconds = a.move === 'anchor' ? T.anchorSeconds : T.flashSeconds;
    for (const id of a.objects) {
      const obj = ctx.entities.get(id);
      if (!obj) continue;
      if (obj.templateId !== GHOST_BROADSIDE_SHIP) {
        obj.templateId = ACTIVE[a.move];
        obj.castTotal = a.seconds;
      }
      obj.castRemaining = a.seconds;
    }
    if (a.move !== 'anchor') strike(ctx, inst, boss, st, 0);
    if (a.move === 'boarding') {
      // Mist step is collision-resolved; the saber still lands on the locked tell.
      const end = ctx.groundPos(
        g.x + Math.sin(a.yaw) * T.boardingLength,
        g.z + Math.cos(a.yaw) * T.boardingLength,
      );
      ctx.moveToward(boss, end, T.boardingLength / DT);
      const resolved = boss.pos;
      a.x = resolved.x - o.x;
      a.z = resolved.z - o.z;
      boss.pos = resolved;
      boss.prevPos = { ...resolved };
      ctx.grid.update(boss);
    }
  } else {
    clearObjects(ctx, inst, st);
    st.timer = T.recovery;
  }
}
