// Authoritative session adapter. Private actors never enter the shared roster.
import { VEHICLE_STATIONS } from './content/vehicle_stations';
import { createGroundObject } from './entity';
import {
  CANNON_INTERMISSION_TICKS,
  CANNON_RETRY_TICKS,
  createCannonEncounter,
  fireCannon,
  tickCannonEncounter,
} from './minigames/cannon_encounter';
import { beginCannonEndless } from './minigames/cannon_endless';
import { cannonResult } from './minigames/cannon_tactics';
import { forceDismount } from './mounts';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import {
  type CannonActionId,
  type CannonPoint,
  type Entity,
  INTERACT_RANGE,
  type VehicleSession,
  type VehicleStationDef,
} from './types';
import { vehicleStationById } from './vehicle_stations';
import { activeWorldQuestsForCycle } from './world_quest_rotation';
import { emitWorldQuestScore } from './world_quest_score_events';
import { completeWorldQuestVehicle } from './world_quests';

/** Lazily created without consuming allocator IDs or changing terrain anchors. */
export function ensureVehicleStation(ctx: SimContext): void {
  if (ctx.cfg.world) return;
  for (const def of VEHICLE_STATIONS) {
    if (ctx.entities.has(def.entityId)) continue;
    const station = createGroundObject(
      def.entityId,
      def.id,
      def.id === 'last_keep_cannon' ? 'The Last Keep Cannon' : 'North Watch Cannon',
      ctx.groundPos(def.x, def.z),
    );
    station.templateId = def.id;
    ctx.addEntity(station);
  }
}

export function ensureActiveVehicleStations(ctx: SimContext, meta: PlayerMeta): void {
  if (activeWorldQuestsForCycle(meta.worldQuestCycle).some((q) => q.objective.type === 'vehicle'))
    ensureVehicleStation(ctx);
}

function eligible(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  station: Readonly<VehicleStationDef>,
): boolean {
  const cycle = meta.devWorldQuestCycle ?? ctx.currentWorldQuestRotation().cycle;
  return (
    !ctx.cfg.world &&
    !meta.leaving &&
    !player.dead &&
    !player.inCombat &&
    meta.worldQuestCycle === cycle &&
    player.level >= 10 &&
    activeWorldQuestsForCycle(meta.worldQuestCycle).some(
      (q) => q.id === station.questId && player.level >= q.minLevel,
    ) &&
    ['active', 'completed'].includes(meta.worldQuestLog.get(station.questId)?.state ?? '')
  );
}

export function enterVehicle(ctx: SimContext, stationId: string, pid?: number): boolean {
  const resolved = ctx.resolve(pid);
  const def = vehicleStationById(stationId);
  if (!resolved || !def) return false;
  const { meta, e: player } = resolved;
  if (
    meta.vehicle ||
    ctx.tickCount < (meta.vehicleRetryAtTick ?? 0) ||
    !eligible(ctx, meta, player, def)
  )
    return false;
  const station = ctx.entities.get(def.entityId);
  if (
    !station ||
    station.templateId !== stationId ||
    Math.hypot(player.pos.x - station.pos.x, player.pos.z - station.pos.z) > INTERACT_RANGE ||
    Math.abs(player.pos.y - station.pos.y) > INTERACT_RANGE ||
    player.leap ||
    player.climb ||
    player.valkyrsCalling ||
    player.chargeTargetId !== null ||
    player.jumping ||
    meta.mountRace ||
    meta.mountTraining?.state === 'IN_PROGRESS'
  )
    return false;
  ctx.cancelCast(player);
  forceDismount(ctx, player);
  player.autoAttack = false;
  player.followTargetId = null;
  player.vx = player.vy = player.vz = 0;
  meta.vehicle = {
    kind: 'cannon',
    stationId,
    cycle: meta.worldQuestCycle,
    origin: { ...player.pos },
    encounter: createCannonEncounter(),
  };
  meta.wireRev++;
  return true;
}

export function leaveVehicle(ctx: SimContext, pid?: number): void {
  const resolved = ctx.resolve(pid);
  if (!resolved?.meta.vehicle) return;
  resolved.meta.vehicle = null;
  resolved.meta.wireRev++;
}

function remainsAtStation(player: Entity, session: VehicleSession): boolean {
  return (
    Math.hypot(player.pos.x - session.origin.x, player.pos.z - session.origin.z) <= 0.1 &&
    Math.abs(player.pos.y - session.origin.y) <= 0.1
  );
}

export function useVehicleAction(
  ctx: SimContext,
  action: CannonActionId,
  point: CannonPoint,
  pid?: number,
): boolean {
  const resolved = ctx.resolve(pid);
  const session = resolved?.meta.vehicle;
  const station = session && vehicleStationById(session.stationId);
  if (
    !resolved ||
    !session ||
    !station ||
    !eligible(ctx, resolved.meta, resolved.e, station) ||
    session.cycle !== resolved.meta.worldQuestCycle ||
    !remainsAtStation(resolved.e, session)
  )
    return false;
  return fireCannon(session.encounter, station.field, action, point);
}

export function tickVehicle(ctx: SimContext, meta: PlayerMeta, player: Entity): void {
  const session = meta.vehicle;
  if (!session) return;
  const station = vehicleStationById(session.stationId);
  if (
    !station ||
    !eligible(ctx, meta, player, station) ||
    session.cycle !== meta.worldQuestCycle ||
    !remainsAtStation(player, session)
  ) {
    leaveVehicle(ctx, meta.entityId);
    return;
  }
  tickCannonEncounter(session.encounter, station.field);
  if (session.encounter.phase === 'won') {
    // The authored victory: quest credit, result and medal exactly as before,
    // then the defender keeps the line in endless play until they leave or fall.
    completeWorldQuestVehicle(ctx, meta, session.stationId);
    const result = cannonResult(session.encounter);
    ctx.emit({ type: 'cannonResult', pid: meta.entityId, ...result });
    emitWorldQuestScore(
      ctx,
      meta.entityId,
      station.questId,
      result.medal,
      result.wavesCleared ?? 0,
    );
    beginCannonEndless(session.encounter, result.medal, CANNON_INTERMISSION_TICKS);
    ctx.emit({ type: 'worldQuestBanner', banner: 'endlessBegins', pid: meta.entityId });
  } else if (session.encounter.phase === 'failed') {
    const fall = cannonResult(session.encounter);
    ctx.emit({ type: 'cannonResult', pid: meta.entityId, ...fall });
    // Only a breached ENDLESS line is a ladder row: the medal was earned at the
    // victory, and the waves held past it are what the board ranks.
    if (session.encounter.endless)
      emitWorldQuestScore(ctx, meta.entityId, station.questId, fall.medal, fall.wavesCleared ?? 0);
    // The encounter's local clock freezes at failure; retry uses the live Sim clock.
    // A fall in endless play is not a failed defense: no retry lockout.
    if (!session.encounter.endless) meta.vehicleRetryAtTick = ctx.tickCount + CANNON_RETRY_TICKS;
    leaveVehicle(ctx, meta.entityId);
  }
}

/** Boundary clone: a UI/host caller cannot mutate authoritative actors. */
export function vehicleSessionFor(ctx: SimContext, pid?: number): VehicleSession | null {
  const session = ctx.resolve(pid)?.meta.vehicle;
  if (!session) return null;
  const encounter = session.encounter;
  return {
    ...session,
    origin: { ...session.origin },
    encounter: {
      ...encounter,
      readyAt: { ...encounter.readyAt },
      enemies: encounter.enemies.map((enemy) => ({ ...enemy })),
      shots: encounter.shots.map((shot) => ({ ...shot })),
      fires: encounter.fires.map((fire) => ({ ...fire })),
      barrels: encounter.barrels.map((barrel) => ({ ...barrel })),
      feedback: encounter.feedback.map((effect) => ({ ...effect })),
    },
  };
}
