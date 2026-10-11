import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import {
  ORBITAL_LIGHTNING,
  orbitalShotTime,
  orbitalTarget,
  orbitalWaveWarningTime,
} from './hoard_orbital_lightning_core';
import type { HoardBossCue, HoardBossState, RiftInstance } from './types';

export function startHoardOrbitalLightning(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  emit: (ctx: SimContext, inst: RiftInstance, cue: HoardBossCue) => void,
): void {
  const carrier: HoardBossCue = {
    id: state.nextCueId++,
    kind: 'sweep',
    variant: 'storm-orbital',
    x: boss.pos.x,
    z: boss.pos.z,
    facing: boss.facing,
    radius: ORBITAL_LIGHTNING.orbitRadius,
    halfAngle: Math.PI,
    remaining: ORBITAL_LIGHTNING.totalDuration,
    total: ORBITAL_LIGHTNING.totalDuration,
    orbitalNextWave: 1,
  };
  state.cues.push(carrier);
  emit(ctx, inst, carrier);
  state.cues.push(...createHoardOrbitalWave(ctx, inst, state, carrier, 0, emit));
}

function createHoardOrbitalWave(
  ctx: SimContext,
  inst: RiftInstance,
  state: HoardBossState,
  carrier: Extract<HoardBossCue, { kind: 'sweep' }>,
  wave: number,
  emit: (ctx: SimContext, inst: RiftInstance, cue: HoardBossCue) => void,
): HoardBossCue[] {
  const elapsed = carrier.total - carrier.remaining;
  const cues: HoardBossCue[] = [];
  for (let index = 0; index < ORBITAL_LIGHTNING.orbCount; index++) {
    const target = orbitalTarget(index, carrier.facing, wave);
    const duration = Math.max(0, orbitalShotTime(index, wave) - elapsed);
    const cue: HoardBossCue = {
      id: state.nextCueId++,
      kind: 'mark',
      variant: 'storm-orbital-impact',
      phase: 'warning',
      x: carrier.x + target.x,
      z: carrier.z + target.z,
      radius: ORBITAL_LIGHTNING.impactRadius,
      remaining: duration,
      total: duration,
    };
    cues.push(cue);
    emit(ctx, inst, cue);
  }
  return cues;
}

/** Spawns only the next six warnings, keeping future waves off the floor. */
export function tickHoardOrbitalCarrier(
  ctx: SimContext,
  inst: RiftInstance,
  state: HoardBossState,
  carrier: Extract<HoardBossCue, { kind: 'sweep' }>,
  emit: (ctx: SimContext, inst: RiftInstance, cue: HoardBossCue) => void,
): HoardBossCue[] {
  const spawned: HoardBossCue[] = [];
  let wave = carrier.orbitalNextWave ?? ORBITAL_LIGHTNING.waveCount;
  const elapsed = carrier.total - carrier.remaining;
  while (wave < ORBITAL_LIGHTNING.waveCount && elapsed + 1e-8 >= orbitalWaveWarningTime(wave)) {
    spawned.push(...createHoardOrbitalWave(ctx, inst, state, carrier, wave, emit));
    wave++;
  }
  carrier.orbitalNextWave = wave;
  return spawned;
}

/** Scoped to the actual Hoard boss, after normal target/leash validation. */
export function holdHoardOrbitalLightning(ctx: SimContext, mob: Entity): boolean {
  if (mob.templateId !== 'rift_boss_storm') return false;
  const inst = ctx.riftInstances.find(
    (entry) => entry.vault && entry.partyKey !== null && entry.bossId === mob.id,
  );
  const cue = inst?.hoardBoss?.cues.find(
    (entry) => entry.variant === 'storm-orbital' && entry.remaining > 0,
  );
  if (cue?.kind !== 'sweep') return false;
  mob.pos.x = cue.x;
  mob.pos.z = cue.z;
  mob.facing = cue.facing;
  return true;
}
