// Deterministic private encounter engine. The SimContext adapter owns admission,
// player lifecycle and quest rewards; this leaf never touches shared entities.
import {
  CANNON_ACTIONS,
  CANNON_ENEMIES,
  CANNON_TACTICS,
  CANNON_WAVES,
} from '../content/cannon_encounter';
import {
  type CannonActionId,
  type CannonEncounterState,
  type CannonField,
  type CannonPoint,
  DT,
  TICK_RATE,
} from '../types';

import {
  cannonEndlessAtCap,
  cannonEndlessHpScale,
  cannonEndlessRound,
  cannonEndlessSpeedScale,
  cannonWaveSpawns,
} from './cannon_endless';
import {
  cannonFeedback,
  cannonMarchMultiplier,
  damageCannonEnemies,
  detonateCannonBarrels,
  prepareCannonBarrels,
} from './cannon_tactics';

export const CANNON_COUNTDOWN_TICKS = 3 * TICK_RATE;
export const CANNON_INTERMISSION_TICKS = 5 * TICK_RATE;
export const CANNON_RECOVERY_TICKS = TICK_RATE / 2;
export const CANNON_RETRY_TICKS = 10 * TICK_RATE;

export function createCannonEncounter(): CannonEncounterState {
  return {
    tick: 0,
    phase: 'countdown',
    phaseUntilTick: CANNON_COUNTDOWN_TICKS,
    wave: 0,
    waveStartTick: 0,
    spawnCursor: 0,
    integrity: 100,
    killed: 0,
    breached: 0,
    commanderKilled: false,
    nextId: 1,
    recoveryUntilTick: 0,
    readyAt: { cannonball: 0, grapeshot: 0, incendiary: 0 },
    enemies: [],
    shots: [],
    fires: [],
    barrels: [],
    feedback: [],
    shotsFired: 0,
    shotsHit: 0,
    commanderCharging: false,
  };
}

export function isCannonActionId(value: unknown): value is CannonActionId {
  return value === 'cannonball' || value === 'grapeshot' || value === 'incendiary';
}

export function cannonAimValid(field: CannonField, point: CannonPoint): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.z) &&
    point.x >= field.minX &&
    point.x <= field.maxX &&
    point.z >= field.minZ &&
    point.z <= field.maxZ
  );
}

/** Invalid aim/commands are no-ops, including cooldown and projectile allocation. */
export function fireCannon(
  state: CannonEncounterState,
  field: CannonField,
  action: CannonActionId,
  point: CannonPoint,
): boolean {
  if (
    !isCannonActionId(action) ||
    state.phase !== 'wave' ||
    !cannonAimValid(field, point) ||
    state.tick < state.readyAt[action] ||
    state.tick < state.recoveryUntilTick
  )
    return false;
  const def = CANNON_ACTIONS[action];
  state.shotsFired++;
  cannonFeedback(state, 'shot', point);
  state.readyAt[action] = state.tick + def.cooldownTicks;
  state.recoveryUntilTick = state.tick + CANNON_RECOVERY_TICKS;
  state.shots.push({
    id: state.nextId++,
    action,
    x: point.x,
    z: point.z,
    firedTick: state.tick,
    impactTick: state.tick + def.flightTicks,
  });
  return true;
}

function resolveImpacts(state: CannonEncounterState): void {
  for (const shot of state.shots) {
    if (shot.impactTick > state.tick) continue;
    const def = CANNON_ACTIONS[shot.action];
    cannonFeedback(state, 'impact', shot);
    const hit = damageCannonEnemies(
      state,
      shot,
      def.radius,
      def.damage,
      shot.action,
      def.slowTicks,
    );
    const barrel = detonateCannonBarrels(state, shot, def.radius);
    if (hit || barrel) state.shotsHit++;
    if (def.burnTicks)
      state.fires.push({
        id: shot.id,
        x: shot.x,
        z: shot.z,
        nextPulseTick: state.tick + TICK_RATE,
        expiresTick: state.tick + def.burnTicks,
        hitCredited: hit || barrel,
      });
  }
  state.shots = state.shots.filter((shot) => shot.impactTick > state.tick);
  const burn = CANNON_ACTIONS.incendiary;
  for (const fire of state.fires) {
    if (fire.nextPulseTick <= state.tick && state.tick <= fire.expiresTick) {
      const hit = damageCannonEnemies(state, fire, burn.radius, burn.burnDamage, 'incendiary');
      if (hit && !fire.hitCredited) {
        state.shotsHit++;
        fire.hitCredited = true;
      }
      fire.nextPulseTick += TICK_RATE;
    }
  }
  state.fires = state.fires.filter((fire) => state.tick < fire.expiresTick);
}

function spawnDue(state: CannonEncounterState, field: CannonField): void {
  const wave = cannonWaveSpawns(state);
  const hpScale = cannonEndlessHpScale(cannonEndlessRound(state));
  while (state.spawnCursor < wave.length) {
    const spawn = wave[state.spawnCursor];
    if (state.tick - state.waveStartTick < spawn.atTick) break;
    state.enemies.push({
      id: state.nextId++,
      kind: spawn.kind,
      hp: Math.round(CANNON_ENEMIES[spawn.kind].hp * hpScale),
      x: field.minX + spawn.lane * (field.maxX - field.minX),
      z: field.minZ,
      slowUntilTick: 0,
    });
    state.spawnCursor++;
  }
}

/** Exactly one fixed sim tick. Terminal states are frozen for owner readouts. */
export function tickCannonEncounter(state: CannonEncounterState, field: CannonField): void {
  if (state.phase === 'won' || state.phase === 'failed') return;
  state.tick++;
  state.feedback = state.feedback.filter(
    (e) => state.tick - e.tick <= CANNON_TACTICS.feedbackTicks,
  );
  if (state.phase !== 'wave') {
    if (state.tick < state.phaseUntilTick) return;
    if (state.phase === 'intermission') state.wave++;
    state.phase = 'wave';
    state.waveStartTick = state.tick;
    state.spawnCursor = 0;
    prepareCannonBarrels(state, field);
  }
  spawnDue(state, field);
  // Impact before movement makes a hit on the defense line save the cannon.
  resolveImpacts(state);
  const speedScale = cannonEndlessSpeedScale(cannonEndlessRound(state));
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    const def = CANNON_ENEMIES[enemy.kind];
    const slow = enemy.slowUntilTick > state.tick ? CANNON_ACTIONS.grapeshot.slowMultiplier : 1;
    enemy.z += def.speed * speedScale * slow * cannonMarchMultiplier(state, enemy.kind) * DT;
    if (enemy.z >= field.maxZ) {
      state.integrity = Math.max(0, state.integrity - def.breachDamage);
      state.breached++;
      enemy.hp = 0;
    }
  }
  state.enemies = state.enemies.filter((enemy) => enemy.hp > 0);
  if (state.integrity <= 0) {
    state.phase = 'failed';
    state.shots = [];
    state.fires = [];
    return;
  }
  if (state.spawnCursor < cannonWaveSpawns(state).length || state.enemies.length) return;
  state.shots = [];
  state.fires = [];
  if (state.endless) {
    // Endless play: every held wave counts; the run ends only at the wall or the cap.
    state.wavesCleared = (state.wavesCleared ?? CANNON_WAVES.length) + 1;
    if (cannonEndlessAtCap(state)) {
      state.phase = 'failed';
      return;
    }
    state.phase = 'intermission';
    state.phaseUntilTick = state.tick + CANNON_INTERMISSION_TICKS;
    return;
  }
  if (state.wave === CANNON_WAVES.length - 1) {
    state.phase = state.commanderKilled ? 'won' : 'failed';
    if (state.phase === 'won') state.wavesCleared = CANNON_WAVES.length;
  } else {
    state.phase = 'intermission';
    state.phaseUntilTick = state.tick + CANNON_INTERMISSION_TICKS;
  }
}
