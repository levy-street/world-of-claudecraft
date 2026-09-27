import { isCannonActionId } from '../sim/minigames/cannon_encounter';
import type { CannonEncounterState, CannonEnemyKind, VehicleSession } from '../sim/types';
import { vehicleStationById } from '../sim/vehicle_stations';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
}
function integer(value: unknown): value is number {
  return finite(value) && Number.isSafeInteger(value) && value >= 0;
}
function enemyKind(value: unknown): value is CannonEnemyKind {
  return (
    value === 'infantry' ||
    value === 'runner' ||
    value === 'armored' ||
    value === 'commander' ||
    value === 'sapper'
  );
}

/** Reject the entire malformed session; never retain a stale control lock. */
export function decodeVehicleSession(value: unknown): VehicleSession | null {
  if (
    !record(value) ||
    value.kind !== 'cannon' ||
    typeof value.stationId !== 'string' ||
    !vehicleStationById(value.stationId) ||
    typeof value.cycle !== 'string' ||
    value.cycle.length > 32 ||
    !record(value.origin) ||
    !finite(value.origin.x) ||
    !finite(value.origin.y) ||
    !finite(value.origin.z) ||
    !record(value.encounter)
  )
    return null;
  const source = value.encounter;
  const phase = source.phase;
  if (
    phase !== 'countdown' &&
    phase !== 'wave' &&
    phase !== 'intermission' &&
    phase !== 'won' &&
    phase !== 'failed'
  )
    return null;
  const numeric = [
    'tick',
    'phaseUntilTick',
    'wave',
    'waveStartTick',
    'spawnCursor',
    'integrity',
    'killed',
    'breached',
    'nextId',
    'recoveryUntilTick',
  ] as const;
  for (const key of numeric) if (!integer(source[key])) return null;
  // Endless play (minigames/cannon_endless.ts) runs the wave index well past the
  // three authored waves; the cap bounds a forged payload, not the game.
  const endless = source.endless ?? false;
  const wavesCleared = source.wavesCleared;
  const victoryMedal = source.victoryMedal;
  if (
    (source.wave as number) > 200 ||
    (source.integrity as number) > 100 ||
    typeof source.commanderKilled !== 'boolean' ||
    typeof endless !== 'boolean' ||
    (wavesCleared !== undefined &&
      (!integer(wavesCleared) ||
        (wavesCleared as number) < 0 ||
        (wavesCleared as number) > 1000)) ||
    (victoryMedal !== undefined &&
      victoryMedal !== null &&
      victoryMedal !== 'bronze' &&
      victoryMedal !== 'silver' &&
      victoryMedal !== 'gold') ||
    !record(source.readyAt) ||
    !integer(source.readyAt.cannonball) ||
    !integer(source.readyAt.grapeshot) ||
    !integer(source.readyAt.incendiary) ||
    !Array.isArray(source.enemies) ||
    source.enemies.length > 32 ||
    !Array.isArray(source.shots) ||
    source.shots.length > 4 ||
    !Array.isArray(source.fires) ||
    source.fires.length > 2
  )
    return null;
  const enemies: CannonEncounterState['enemies'] = [];
  for (const row of source.enemies) {
    if (
      !record(row) ||
      !integer(row.id) ||
      !enemyKind(row.kind) ||
      !finite(row.x) ||
      !finite(row.z) ||
      !integer(row.hp) ||
      row.hp > 800 ||
      !integer(row.slowUntilTick) ||
      (row.armorBroken !== undefined && typeof row.armorBroken !== 'boolean')
    )
      return null;
    enemies.push({
      id: row.id,
      kind: row.kind,
      x: row.x,
      z: row.z,
      hp: row.hp,
      slowUntilTick: row.slowUntilTick,
      ...(row.armorBroken === undefined ? {} : { armorBroken: row.armorBroken as boolean }),
    });
  }
  const shots: CannonEncounterState['shots'] = [];
  for (const row of source.shots) {
    if (
      !record(row) ||
      !integer(row.id) ||
      !isCannonActionId(row.action) ||
      !finite(row.x) ||
      !finite(row.z) ||
      !integer(row.firedTick) ||
      !integer(row.impactTick)
    )
      return null;
    shots.push({
      id: row.id,
      action: row.action,
      x: row.x,
      z: row.z,
      firedTick: row.firedTick,
      impactTick: row.impactTick,
    });
  }
  const fires: CannonEncounterState['fires'] = [];
  for (const row of source.fires) {
    if (
      !record(row) ||
      !integer(row.id) ||
      !finite(row.x) ||
      !finite(row.z) ||
      !integer(row.nextPulseTick) ||
      !integer(row.expiresTick) ||
      (row.hitCredited !== undefined && typeof row.hitCredited !== 'boolean')
    )
      return null;
    fires.push({
      id: row.id,
      x: row.x,
      z: row.z,
      nextPulseTick: row.nextPulseTick,
      expiresTick: row.expiresTick,
      ...(row.hitCredited === undefined ? {} : { hitCredited: row.hitCredited as boolean }),
    });
  }
  const barrels: CannonEncounterState['barrels'] = [];
  const feedback: CannonEncounterState['feedback'] = [];
  const barrelRows = source.barrels ?? [];
  const feedbackRows = source.feedback ?? [];
  const shotsFired = source.shotsFired ?? 0,
    shotsHit = source.shotsHit ?? 0;
  const commanderCharging = source.commanderCharging ?? false;
  if (
    !Array.isArray(barrelRows) ||
    barrelRows.length > 3 ||
    !Array.isArray(feedbackRows) ||
    feedbackRows.length > 64 ||
    !integer(shotsFired) ||
    !integer(shotsHit) ||
    shotsHit > shotsFired ||
    typeof commanderCharging !== 'boolean'
  )
    return null;
  for (const row of barrelRows) {
    if (
      !record(row) ||
      !integer(row.id) ||
      !finite(row.x) ||
      !finite(row.z) ||
      typeof row.active !== 'boolean'
    )
      return null;
    barrels.push({ id: row.id, x: row.x, z: row.z, active: row.active });
  }
  for (const row of feedbackRows) {
    if (
      !record(row) ||
      !integer(row.id) ||
      !integer(row.tick) ||
      !finite(row.x) ||
      !finite(row.z) ||
      (row.enemyId !== undefined && !integer(row.enemyId)) ||
      typeof row.kind !== 'string' ||
      !['shot', 'impact', 'barrel', 'armor', 'charge', 'death'].includes(row.kind)
    )
      return null;
    feedback.push({
      id: row.id,
      tick: row.tick,
      x: row.x,
      z: row.z,
      kind: row.kind as CannonEncounterState['feedback'][number]['kind'],
      ...(row.enemyId === undefined ? {} : { enemyId: row.enemyId as number }),
    });
  }
  const counters = Object.fromEntries(numeric.map((key) => [key, source[key]])) as Pick<
    CannonEncounterState,
    (typeof numeric)[number]
  >;
  return {
    kind: 'cannon',
    stationId: value.stationId,
    cycle: value.cycle,
    origin: { x: value.origin.x, y: value.origin.y, z: value.origin.z },
    encounter: {
      ...counters,
      phase,
      commanderKilled: source.commanderKilled,
      readyAt: {
        cannonball: source.readyAt.cannonball,
        grapeshot: source.readyAt.grapeshot,
        incendiary: source.readyAt.incendiary,
      },
      enemies,
      shots,
      fires,
      barrels,
      feedback,
      shotsFired,
      shotsHit,
      commanderCharging,
      ...(endless ? { endless: true } : {}),
      ...(wavesCleared === undefined ? {} : { wavesCleared: wavesCleared as number }),
      ...(victoryMedal === undefined
        ? {}
        : { victoryMedal: victoryMedal as CannonEncounterState['victoryMedal'] }),
    },
  };
}
