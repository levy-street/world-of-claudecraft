// Fire and Fly seat: the `turret` kind of PlayerMeta.vehicle, dispatched from
// vehicles.ts. Seating lends the tank as the player's mount, the per-tick hook
// drives the pure engine with a probe bound to the world, engine events feed an
// owner-scoped SimEvent and the feedback ring, and the read-only view is cloned
// once per revision. Open world only. Draws no world rng.

import { resolveMovement } from './colliders';
import { TURRET_TANK_MOUNT } from './content/turret_defense';
import { DUNGEON_X_THRESHOLD } from './data';
import { gliderActionsLocked } from './glider_action_lock';
import type { ThrowProbe } from './minigames/thrown_body';
import {
  createTurretDefense,
  fireTurret,
  type TurretDefenseState,
  type TurretEvent,
  tickTurretDefense,
  turretMonstersLeft,
} from './minigames/turret_defense';
import { resolveTurretPlan } from './minigames/turret_defense_plan';
import { turretSessionSeed } from './minigames/turret_defense_rng';
import { recordTurretFeedback, type TurretFeedback } from './minigames/turret_feedback';
import { applySeatMount, forceDismount, mountRideAllowed } from './mounts';
import { shadowActionsLocked } from './shadow_action_lock';
import { onShipDeck } from './ship_deck_presence';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { arenaMatchFor } from './social/arena';
import { bgInMatch } from './social/battleground';
import type { CannonPoint, Entity, TurretSession, Vec3 } from './types';
import { wispMazeActionsLocked } from './wisp_maze_action_lock';
import { groundHeight, waterLevelAt } from './world';
import { hasWorldQuestDeliveryCargo } from './world_quest_delivery';

export type TurretSeatRefusal =
  | 'missing'
  | 'leaving'
  | 'dead'
  | 'seated'
  | 'combat'
  | 'match'
  | 'instance'
  | 'busy'
  | 'water'
  | 'cargo';

type ReadonlyDeep<T> = T extends readonly (infer U)[]
  ? readonly ReadonlyDeep<U>[]
  : T extends object
    ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> }
    : T;

/**
 * The engine state minus its clock (`tick` advances outside the revision; read
 * `IWorld.turretClock`) and minus its seed (it would predict spawns and throws).
 */
export type TurretDefenseView = ReadonlyDeep<Omit<TurretDefenseState, 'tick' | 'seed'>>;

export interface TurretSessionView {
  readonly origin: Readonly<Vec3>;
  readonly defense: TurretDefenseView;
  /** `defense.wave` is the 0-based index into these. */
  readonly waveCount: number;
  /** Living monsters plus the current wave's unspawned ones. */
  readonly monstersLeft: number;
  /** The newest engine events, oldest first; consume by `seq` (turretFeedbackSince). */
  readonly feedback: readonly TurretFeedback[];
}

const SEAT_TOLERANCE = 0.1;
// resolveMovement rebuilds an unblocked target from its steps, so an exact
// comparison would read float noise as a contact.
const SWEEP_BLOCK_EPS = 1e-4;
// Feet this high above the ground clear every rail the fence test knows (a village
// rail tops out near 0.95 yd, the tallest race oxer at 1.85 yd), which is otherwise
// a 2D segment test that would reverse a high throw mid-air.
const FENCE_CLEARANCE = 2;

const views = new WeakMap<TurretSession, { rev: number; seq: number; view: TurretSessionView }>();

/**
 * The world the thrown bodies fly through: the ground mobs stand on, water, and
 * static colliders. A body whose feet clear a low collider's top (a rock, a crate)
 * or a fence passes over it; full-height colliders (trees, buildings, wells) block
 * at any height, so a body thrown into the forest bounces off the trunks.
 */
export function turretWorldProbe(seed: number): ThrowProbe {
  return {
    ground: (x, z) => groundHeight(x, z, seed),
    water: (x, z) => {
      const level = waterLevelAt(x, z, seed);
      return Number.isFinite(level) ? level : null;
    },
    sweep: (fx, fz, tx, tz, radius, fromY, toY) => {
      const feet = Math.min(fromY, toY);
      const overFences =
        feet > Math.max(groundHeight(fx, fz, seed), groundHeight(tx, tz, seed)) + FENCE_CLEARANCE;
      const mover = { y: feet, lift: 0 };
      const to = resolveMovement(seed, fx, fz, tx, tz, radius, overFences, undefined, mover);
      return {
        x: to.x,
        z: to.z,
        blocked: Math.hypot(to.x - tx, to.z - tz) > SWEEP_BLOCK_EPS,
      };
    },
  };
}

/**
 * Fail closed: the delve registry answers presence the position may not show yet,
 * and every instanced band (dungeons, raids, delves, rifts, arenas, battlegrounds)
 * lies east of the dungeon threshold (the vault craft gate states the constants).
 */
function outsideOpenWorld(ctx: SimContext, player: Entity): boolean {
  const { x, z } = player.pos;
  return (
    !Number.isFinite(x) ||
    !Number.isFinite(z) ||
    x > DUNGEON_X_THRESHOLD ||
    ctx.delveRunForPlayer(player.id) !== null
  );
}

export function turretSeatRefusal(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
): TurretSeatRefusal | null {
  if (meta.leaving) return 'leaving';
  if (player.dead || player.ghost) return 'dead';
  if (meta.vehicle) return 'seated';
  if (player.inCombat) return 'combat';
  if (bgInMatch(ctx, player.id) || arenaMatchFor(ctx, player.id) || ctx.duels.has(player.id))
    return 'match';
  if (outsideOpenWorld(ctx, player)) return 'instance';
  if (
    meta.mountRace ||
    meta.mountTraining?.state === 'IN_PROGRESS' ||
    player.leap ||
    player.climb ||
    player.valkyrsCalling ||
    player.chargeTargetId !== null ||
    player.jumping ||
    wispMazeActionsLocked(meta.worldQuestLog) ||
    shadowActionsLocked(meta.worldQuestLog) ||
    gliderActionsLocked(meta.worldQuestLog)
  )
    return 'busy';
  if (ctx.isSwimming(player) || onShipDeck(ctx, player)) return 'water';
  if (hasWorldQuestDeliveryCargo(player)) return 'cargo';
  return null;
}

/** Seats the player where they stand and lends the tank; the feet position is the center. */
export function seatTurret(ctx: SimContext, pid: number): TurretSeatRefusal | null {
  const resolved = ctx.resolve(pid);
  if (!resolved) return 'missing';
  const { meta, e: player } = resolved;
  const refusal = turretSeatRefusal(ctx, meta, player);
  if (refusal) return refusal;
  ctx.cancelCast(player);
  player.autoAttack = false;
  player.followTargetId = null;
  player.vx = player.vy = player.vz = 0;
  const origin = { ...player.pos };
  const priorMountKey = player.mountKey;
  forceDismount(ctx, player);
  const start = ctx.tickCount;
  meta.vehicle = {
    kind: 'turret',
    origin,
    defense: createTurretDefense(
      resolveTurretPlan(),
      { x: origin.x, z: origin.z },
      turretSessionSeed(ctx.cfg.seed, meta.entityId, start),
      start,
    ),
    lentMountKey: TURRET_TANK_MOUNT,
    priorMountKey,
    feedback: [],
    nextFeedbackSeq: 1,
  };
  applySeatMount(ctx, player, TURRET_TANK_MOUNT);
  meta.wireRev++;
  return null;
}

/** False once the seat must end: the same eject rules as the cannon, plus the lent tank. */
function stillSeated(meta: PlayerMeta, player: Entity, session: TurretSession): boolean {
  return (
    !meta.leaving &&
    !player.dead &&
    !player.ghost &&
    !player.inCombat &&
    player.mountKey === session.lentMountKey &&
    Math.hypot(player.pos.x - session.origin.x, player.pos.z - session.origin.z) <=
      SEAT_TOLERANCE &&
    Math.abs(player.pos.y - session.origin.y) <= SEAT_TOLERANCE
  );
}

function emitTurretEvents(
  ctx: SimContext,
  pid: number,
  session: TurretSession,
  events: readonly TurretEvent[],
): void {
  if (!events.length) return;
  session.nextFeedbackSeq = recordTurretFeedback(
    session.feedback,
    session.nextFeedbackSeq,
    ctx.tickCount,
    events,
  );
  for (const event of events) ctx.emit({ type: 'turretDefense', pid, event });
}

/** Advances the seat one sim tick; false when the caller must end it. */
export function tickTurretSeat(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  session: TurretSession,
): boolean {
  if (!stillSeated(meta, player, session)) return false;
  const events = tickTurretDefense(session.defense, ctx.tickCount, turretWorldProbe(ctx.cfg.seed));
  emitTurretEvents(ctx, meta.entityId, session, events);
  return true;
}

/** One shot at a ground point; the tank faces its shot. Refusals are silent (the HUD shows the cooldown). */
export function fireTurretSeat(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  session: TurretSession,
  point: CannonPoint,
): boolean {
  if (!stillSeated(meta, player, session)) return false;
  const defense = session.defense;
  const out = fireTurret(defense, ctx.tickCount, point.x, point.z, turretWorldProbe(ctx.cfg.seed));
  if (!out.ok) return false;
  player.facing = Math.atan2(out.shot.x - defense.cx, out.shot.z - defense.cz);
  emitTurretEvents(ctx, meta.entityId, session, out.events);
  return true;
}

/**
 * Hands the tank back. A living player gets the prior mount again when they still
 * hold it, even if something took the tank first (a profession action dismounts
 * directly); the dead, and anyone whose prior reins left their bags, end on foot.
 */
export function endTurretSeat(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  session: TurretSession,
): void {
  if (player.mountKey !== session.lentMountKey && player.mountKey !== '') return;
  const prior = session.priorMountKey;
  const alive = !player.dead && !player.ghost;
  const next = alive && prior && mountRideAllowed(meta, prior) ? prior : '';
  if (player.mountKey !== next) applySeatMount(ctx, player, next);
}

function cloneView(session: TurretSession): TurretSessionView {
  const defense = session.defense;
  const { tick: _clock, seed: _seed, plan, shots, monsters, stats, ...scalars } = defense;
  return {
    origin: { ...session.origin },
    defense: {
      ...scalars,
      plan,
      shots: shots.map((shot) => ({ ...shot })),
      monsters: monsters.map((m) => ({ ...m, seg: { ...m.seg }, knocked: m.knocked.slice() })),
      stats: { ...stats },
    },
    waveCount: plan.waves.length,
    monstersLeft: turretMonstersLeft(defense),
    feedback: session.feedback.slice(),
  };
}

/** The same object until the engine revision or the feedback ring moves; the plan and
 *  the ring's frozen entries are shared, never cloned. */
export function turretSessionView(session: TurretSession): TurretSessionView {
  const rev = session.defense.rev;
  const seq = session.nextFeedbackSeq;
  const cached = views.get(session);
  if (cached && cached.rev === rev && cached.seq === seq) return cached.view;
  const view = cloneView(session);
  views.set(session, { rev, seq, view });
  return view;
}
