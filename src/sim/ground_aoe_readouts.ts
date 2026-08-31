// IWorld combat-facet readouts over the live ground-AoE list: project the
// persistent ground effects (frost rings, temporal hourglasses,
// consecrations) into the presentation arrays render/ui consume through the
// seam. Every collector is a pure read (no rng, no mutation, no tick-phase
// work); Sim keeps thin getters that delegate here so the IWorld surface
// resolves unchanged.
import type { ActiveConsecration, ActiveFrostRing, ActiveTemporalHourglass } from '../world_api';
import type { GroundAoE } from './entity_roster';

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
): ActiveTemporalHourglass[] {
  const hourglasses: ActiveTemporalHourglass[] = [];
  for (const effect of groundAoEs) {
    const hourglass = effect.temporalHourglass;
    if (!hourglass || effect.remaining <= 0) continue;
    hourglasses.push({
      id: hourglass.id,
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
