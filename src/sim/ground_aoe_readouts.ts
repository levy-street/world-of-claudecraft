// IWorld combat-facet readouts over the live ground-AoE list: project the
// persistent ground effects (frost rings, temporal hourglasses,
// consecrations) into the presentation arrays render/ui consume through the
// seam. Every collector is a pure read (no rng, no mutation, no tick-phase
// work); Sim keeps thin getters that delegate here so the IWorld surface
// resolves unchanged.
import type {
  ActiveBlizzard,
  ActiveConsecration,
  ActiveFrostRing,
  ActiveHunterTrap,
  ActiveRuneOfPower,
  ActiveTemporalHourglass,
  RuneOfPowerDisposition,
  TemporalHourglassDisposition,
} from '../world_api';
import type { GroundAoE } from './entity_roster';

export function collectActiveRunesOfPower(
  groundAoEs: readonly GroundAoE[],
  dispositionFor: (sourceId: number) => RuneOfPowerDisposition,
): ActiveRuneOfPower[] {
  const rows: ActiveRuneOfPower[] = [];
  for (const ground of groundAoEs) {
    const rune = ground.runeOfPower;
    if (!rune || ground.remaining <= 0) continue;
    rows.push({
      id: rune.id,
      sourceId: ground.sourceId,
      disposition: dispositionFor(ground.sourceId),
      x: ground.pos.x,
      z: ground.pos.z,
      radius: ground.radius,
      duration: rune.duration,
      remaining: Math.min(rune.duration, ground.remaining),
    });
  }
  return rows;
}

export function collectActiveHunterTraps(groundAoEs: readonly GroundAoE[]): ActiveHunterTrap[] {
  const traps: ActiveHunterTrap[] = [];
  for (const effect of groundAoEs) {
    const trap = effect.hunterTrap;
    if (!trap || trap.triggered || effect.remaining <= 0) continue;
    traps.push({
      id: trap.id,
      sourceId: effect.sourceId,
      abilityId: trap.abilityId,
      x: effect.pos.x,
      z: effect.pos.z,
      radius: effect.radius,
      duration: trap.duration,
      remaining: Math.min(trap.duration, effect.remaining),
      armTime: trap.armTime,
      armRemaining: Math.max(0, Math.min(trap.armTime, trap.armRemaining)),
    });
  }
  return traps;
}

export function collectActiveFrostRings(groundAoEs: readonly GroundAoE[]): ActiveFrostRing[] {
  const rings: ActiveFrostRing[] = [];
  for (const effect of groundAoEs) {
    const ring = effect.frostRing;
    if (!ring || effect.remaining <= 0) continue;
    rings.push({
      id: ring.id,
      x: effect.pos.x,
      z: effect.pos.z,
      radius: effect.radius,
      innerRadius: ring.innerRadius,
      duration: ring.duration,
      remaining: effect.remaining,
    });
  }
  return rings;
}

export function collectActiveTemporalHourglasses(
  groundAoEs: readonly GroundAoE[],
  dispositionFor: (sourceId: number) => TemporalHourglassDisposition,
): ActiveTemporalHourglass[] {
  const hourglasses: ActiveTemporalHourglass[] = [];
  for (const effect of groundAoEs) {
    const hourglass = effect.temporalHourglass;
    if (!hourglass || effect.remaining <= 0) continue;
    hourglasses.push({
      id: hourglass.id,
      sourceId: effect.sourceId,
      disposition: dispositionFor(effect.sourceId),
      x: effect.pos.x,
      z: effect.pos.z,
      radius: effect.radius,
      duration: hourglass.groundDuration,
      remaining: effect.remaining,
    });
  }
  return hourglasses;
}

export function collectActiveConsecrations(groundAoEs: readonly GroundAoE[]): ActiveConsecration[] {
  const consecrations: ActiveConsecration[] = [];
  for (const effect of groundAoEs) {
    const consecration = effect.consecration;
    if (!consecration || effect.remaining <= 0) continue;
    consecrations.push({
      id: consecration.id,
      x: effect.pos.x,
      z: effect.pos.z,
      radius: effect.radius,
      duration: consecration.duration,
      remaining: effect.remaining,
    });
  }
  return consecrations;
}

export function collectActiveBlizzards(
  groundAoEs: readonly GroundAoE[],
  isActive: (sourceId: number) => boolean,
): ActiveBlizzard[] {
  const rows: ActiveBlizzard[] = [];
  for (const ground of groundAoEs) {
    if (!ground.blizzard || ground.remaining <= 0) continue;
    rows.push({
      id: ground.blizzard.id,
      sourceId: ground.sourceId,
      active: isActive(ground.sourceId),
      x: ground.pos.x,
      z: ground.pos.z,
      radius: ground.radius,
      duration: ground.blizzard.duration,
      remaining: Math.min(ground.blizzard.duration, ground.remaining),
    });
  }
  return rows;
}
