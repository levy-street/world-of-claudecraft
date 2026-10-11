// Deterministic tactics and scoring; the encounter owns all mutable state.
import {
  CANNON_BARREL_PLACEMENTS,
  CANNON_ENEMIES,
  CANNON_TACTICS,
  CANNON_WAVE_BARREL_INDICES,
} from '../content/cannon_encounter';
import type {
  CannonEncounterState,
  CannonFeedback,
  CannonField,
  CannonPoint,
  CannonResult,
} from '../types';

export function cannonFeedback(
  state: CannonEncounterState,
  kind: CannonFeedback['kind'],
  point: CannonPoint,
  enemyId?: number,
): void {
  state.feedback.push({
    id: state.nextId++,
    tick: state.tick,
    kind,
    x: point.x,
    z: point.z,
    ...(enemyId === undefined ? {} : { enemyId }),
  });
  if (state.feedback.length > CANNON_TACTICS.feedbackLimit)
    state.feedback.splice(0, state.feedback.length - CANNON_TACTICS.feedbackLimit);
}

/** A barrel the player never lit survives into the next wave; only spent ones are
 *  cleared, and a wave adds its authored placements on the spots still empty. */
export function prepareCannonBarrels(state: CannonEncounterState, field: CannonField): void {
  const kept = state.barrels.filter((barrel) => barrel.active);
  for (const index of CANNON_WAVE_BARREL_INDICES[state.wave] ?? []) {
    const x = field.minX + CANNON_BARREL_PLACEMENTS[index].lane * (field.maxX - field.minX);
    const z = field.minZ + CANNON_BARREL_PLACEMENTS[index].depth * (field.maxZ - field.minZ);
    if (kept.some((barrel) => barrel.x === x && barrel.z === z)) continue;
    kept.push({ id: state.nextId++, active: true, x, z });
  }
  state.barrels = kept;
}

export function damageCannonEnemies(
  state: CannonEncounterState,
  point: CannonPoint,
  radius: number,
  damage: number,
  source: 'cannonball' | 'grapeshot' | 'incendiary' | 'barrel',
  slowTicks = 0,
): boolean {
  let hit = false;
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0 || (enemy.x - point.x) ** 2 + (enemy.z - point.z) ** 2 > radius ** 2)
      continue;
    hit = true;
    let amount = damage;
    if (enemy.kind === 'armored') {
      if (!enemy.armorBroken && source === 'cannonball') {
        enemy.armorBroken = true;
        cannonFeedback(state, 'armor', enemy, enemy.id);
      }
      if (!enemy.armorBroken) amount *= CANNON_TACTICS.armorReduction;
      else if (source === 'incendiary') amount *= CANNON_TACTICS.exposedFireMultiplier;
    }
    enemy.hp = Math.max(0, enemy.hp - Math.round(amount));
    if (slowTicks) enemy.slowUntilTick = Math.max(enemy.slowUntilTick, state.tick + slowTicks);
    if (enemy.hp === 0) {
      state.killed++;
      cannonFeedback(state, 'death', enemy, enemy.id);
      if (enemy.kind === 'commander') state.commanderKilled = true;
    } else if (
      enemy.kind === 'commander' &&
      !state.commanderCharging &&
      enemy.hp <= CANNON_ENEMIES.commander.hp * CANNON_TACTICS.chargeHealthFraction
    ) {
      state.commanderCharging = true;
      cannonFeedback(state, 'charge', enemy, enemy.id);
    }
  }
  return hit;
}

/** Only direct shots ignite barrels. Barrels damage enemies but do not chain-ignite other barrels. */
export function detonateCannonBarrels(
  state: CannonEncounterState,
  point: CannonPoint,
  radius: number,
): boolean {
  const pending: CannonPoint[] = [];
  for (const barrel of state.barrels) {
    if (!barrel.active || (barrel.x - point.x) ** 2 + (barrel.z - point.z) ** 2 > radius ** 2)
      continue;
    barrel.active = false;
    pending.push(barrel);
  }
  for (let i = 0; i < pending.length; i++) {
    const barrel = pending[i];
    cannonFeedback(state, 'barrel', barrel);
    damageCannonEnemies(
      state,
      barrel,
      CANNON_TACTICS.barrelRadius,
      CANNON_TACTICS.barrelDamage,
      'barrel',
    );
  }
  return pending.length > 0;
}

export function cannonMarchMultiplier(state: CannonEncounterState, kind: string): number {
  return state.commanderCharging && !state.commanderKilled
    ? kind === 'commander'
      ? CANNON_TACTICS.commanderChargeSpeed
      : CANNON_TACTICS.troopChargeSpeed
    : 1;
}

export function cannonResult(state: CannonEncounterState): CannonResult {
  const accuracy = state.shotsFired > 0 ? state.shotsHit / state.shotsFired : 0;
  // Endless play latches the medal earned at the authored victory: a later fall
  // at the wall never takes it back.
  const medal =
    state.victoryMedal !== undefined
      ? state.victoryMedal
      : state.phase !== 'won'
        ? null
        : state.integrity >= CANNON_TACTICS.goldIntegrity && accuracy >= CANNON_TACTICS.goldAccuracy
          ? 'gold'
          : state.integrity >= CANNON_TACTICS.silverIntegrity &&
              accuracy >= CANNON_TACTICS.silverAccuracy
            ? 'silver'
            : 'bronze';
  return {
    medal,
    integrity: state.integrity,
    shotsFired: state.shotsFired,
    shotsHit: state.shotsHit,
    ...(state.wavesCleared === undefined ? {} : { wavesCleared: state.wavesCleared }),
  };
}
