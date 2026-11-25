// The Smith's Heart's tank buster warning in the sim (tank_buster_ids.ts holds
// the table): one quiet marker laid on the tank as a buster begins, so its
// client (offline or online, the aura mirrors like any other) can show that
// one player the hit and its countdown. A marker changes nothing the fight
// resolves: no stat, no rng, never cleansed, gone with its countdown.

import type { Entity } from '../../types';
import { dropAura, putMarker } from './fight_kit';
import { type HeartBusterKey, heartTankBuster, TANK_BUSTER_AURA } from './tank_buster_ids';

/** Tell `tank` that `boss`'s `key` lands on it in `seconds`. */
export function warnTankBuster(
  tank: Entity | null | undefined,
  boss: Entity,
  key: HeartBusterKey,
  seconds: number,
): void {
  if (!tank || tank.dead || tank.kind !== 'player' || seconds <= 0) return;
  const b = heartTankBuster(key);
  putMarker(tank, TANK_BUSTER_AURA, b.name, seconds, boss.id, {
    value: b.code,
    school: 'physical',
  });
}

/** The warning on `tank` is over (the hit was avoided, the bar cut). Only
 *  `key`'s own marker goes. */
export function endTankBuster(tank: Entity | null | undefined, key: HeartBusterKey): void {
  if (!tank) return;
  const code = heartTankBuster(key).code;
  if (tank.auras.some((a) => a.id === TANK_BUSTER_AURA && a.value === code))
    dropAura(tank, TANK_BUSTER_AURA);
}
