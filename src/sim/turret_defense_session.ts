// Fire and Fly seat: the `turret` kind of PlayerMeta.vehicle, dispatched from
// vehicles.ts. Seating takes the player from the open world onto the tower
// roof of their own arena (turret_arena_session.ts), the per-tick hook drives
// the pure engine with a probe bound to the world, engine events feed an
// owner-scoped SimEvent and the feedback ring, and the read-only view is cloned
// once per revision. Ending the seat leaves the arena. Draws no world rng.

import { resolveMovement } from './colliders';
import { TURRET_DEFAULT_SCENARIO } from './content/fire_and_fly_scenarios';
import { DUNGEON_X_THRESHOLD } from './data';
import { gliderActionsLocked } from './glider_action_lock';
import type { ThrowProbe } from './minigames/thrown_body';
import {
  createTurretDefense,
  fireTurret,
  type TurretDefenseState,
  type TurretEvent,
  type TurretMonster,
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
import { claimTurretArena, enterTurretArena, exitTurretArena } from './turret_arena_session';
import type { CannonPoint, Entity, TurretScenarioDef, TurretSession, Vec3 } from './types';
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
  | 'cargo'
  | 'full';

type ReadonlyDeep<T> = T extends readonly (infer U)[]
  ? readonly ReadonlyDeep<U>[]
  : T extends object
    ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> }
    : T;

// Engine bookkeeping no reader draws from (the throw and airtime stats, the bowling pair
// guard, the spawn and id cursors); the online wire would otherwise carry it every revision.
type TurretMonsterBookkeeping = 'airSince' | 'throwX' | 'throwZ' | 'throwOpen' | 'knocked';
type TurretDefenseBookkeeping =
  | 'spawnCursor'
  | 'nextSpawnTick'
  | 'nextShotId'
  | 'nextMonsterId'
  | 'nextBarrelId';

export type TurretMonsterView = ReadonlyDeep<Omit<TurretMonster, TurretMonsterBookkeeping>>;

/**
 * The engine state minus its clock (`tick` advances outside the revision; read
 * `IWorld.turretClock`), its seed (it would predict spawns and throws) and its bookkeeping.
 */
export type TurretDefenseView = ReadonlyDeep<
  Omit<TurretDefenseState, 'tick' | 'seed' | 'monsters' | TurretDefenseBookkeeping>
> & { readonly monsters: readonly TurretMonsterView[] };

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

/**
 * Takes an eligible open-world player onto the tower roof of their own arena,
 * on foot, and seats them there for a run of `scenario`: the tower under their
 * feet is the center. The eligibility is read here, before the move, so the
 * arena itself never has to pass the open-world rule.
 */
export function seatTurret(
  ctx: SimContext,
  pid: number,
  scenario: Readonly<TurretScenarioDef> = TURRET_DEFAULT_SCENARIO,
): TurretSeatRefusal | null {
  const resolved = ctx.resolve(pid);
  if (!resolved) return 'missing';
  const { meta, e: player } = resolved;
  const refusal = turretSeatRefusal(ctx, meta, player);
  if (refusal) return refusal;
  const arena = claimTurretArena(ctx, meta.entityId);
  if (!arena) return 'full';
  const returnTo = { x: player.pos.x, y: player.pos.y, z: player.pos.z, facing: player.facing };
  ctx.cancelCast(player);
  player.autoAttack = false;
  player.followTargetId = null;
  player.vx = player.vy = player.vz = 0;
  const priorMountKey = player.mountKey;
  forceDismount(ctx, player);
  const origin = enterTurretArena(ctx, meta, player, arena);
  const start = ctx.tickCount;
  meta.vehicle = {
    kind: 'turret',
    origin,
    defense: createTurretDefense(
      resolveTurretPlan(scenario),
      { x: origin.x, z: origin.z },
      turretSessionSeed(ctx.cfg.seed, meta.entityId, start),
      start,
    ),
    priorMountKey,
    returnTo,
    feedback: [],
    nextFeedbackSeq: 1,
  };
  meta.wireRev++;
  return null;
}

/** False once the seat must end: the same eject rules as the cannon, on foot. */
function stillSeated(meta: PlayerMeta, player: Entity, session: TurretSession): boolean {
  return (
    !meta.leaving &&
    !player.dead &&
    !player.ghost &&
    !player.inCombat &&
    player.mountKey === '' &&
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
  const first = session.nextFeedbackSeq;
  const tick = ctx.tickCount;
  session.nextFeedbackSeq = recordTurretFeedback(session.feedback, first, tick, events);
  for (let i = 0; i < events.length; i++)
    ctx.emit({ type: 'turretDefense', pid, seq: first + i, tick, event: events[i] });
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

/** One shot at a ground point; the player faces its shot. Refusals are silent (the HUD shows the cooldown). */
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
 * Leaves the arena, back where the player stood, then gives a player who was
 * alive and out of combat at the end the prior mount again when they still
 * hold its reins; the dead, the fighting, and anyone whose reins left their
 * bags end on foot. A player some other path took out of the arena (a
 * battleground pop, a teleport) is not remounted where it put them, and a
 * mount some other path put them on is left alone.
 */
export function endTurretSeat(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  session: TurretSession,
): void {
  const alive = !player.dead && !player.ghost;
  const home = exitTurretArena(ctx, meta, player, session.returnTo);
  const prior = session.priorMountKey;
  if (!home || !alive || player.inCombat || !prior || player.mountKey !== '') return;
  if (!mountRideAllowed(meta, prior)) return;
  applySeatMount(ctx, player, prior);
}

function monsterView(m: TurretMonster): TurretMonsterView {
  const {
    airSince: _air,
    throwX: _throwX,
    throwZ: _throwZ,
    throwOpen: _open,
    knocked: _knocked,
    seg,
    ...shown
  } = m;
  return { ...shown, seg: { ...seg } };
}

function cloneView(session: TurretSession): TurretSessionView {
  const defense = session.defense;
  const {
    tick: _clock,
    seed: _seed,
    spawnCursor: _cursor,
    nextSpawnTick: _nextSpawn,
    nextShotId: _nextShot,
    nextMonsterId: _nextMonster,
    nextBarrelId: _nextBarrel,
    plan,
    shots,
    monsters,
    barrels,
    stats,
    ...scalars
  } = defense;
  return {
    origin: { ...session.origin },
    defense: {
      ...scalars,
      plan,
      shots: shots.map((shot) => ({ ...shot })),
      monsters: monsters.map(monsterView),
      barrels: barrels.map((barrel) => ({ ...barrel })),
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
