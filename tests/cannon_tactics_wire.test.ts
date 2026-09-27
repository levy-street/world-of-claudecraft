import { expect, it } from 'vitest';
import { decodeVehicleSession } from '../src/net/vehicle_session_wire';
import { LAST_KEEP_CANNON } from '../src/sim/content/vehicle_stations';
import { createCannonEncounter } from '../src/sim/minigames/cannon_encounter';
import type { VehicleSession } from '../src/sim/types';

function session(): VehicleSession {
  return {
    kind: 'cannon',
    stationId: 'north_watch_cannon',
    cycle: 'wq3_8',
    origin: { x: 0, y: 0, z: 0 },
    encounter: createCannonEncounter(),
  };
}
it('accepts the second registered station and rejects unknown or malformed station identities', () => {
  const s = { ...session(), stationId: LAST_KEEP_CANNON.id };
  expect(decodeVehicleSession(s)).toEqual(s);
  for (const stationId of ['missing_cannon', '__proto__', null, 9400011]) {
    expect(decodeVehicleSession({ ...s, stationId })).toBeNull();
  }
});
it('round-trips tactics by value, including sapper, armor, charge and shot statistics', () => {
  const s = session();
  s.encounter.enemies = [
    { id: 1, kind: 'sapper', hp: 80, x: 0, z: 0, slowUntilTick: 0 },
    { id: 2, kind: 'armored', hp: 120, x: 0, z: 0, slowUntilTick: 0, armorBroken: true },
  ];
  s.encounter.barrels = [{ id: 3, active: true, x: 5, z: 20 }];
  s.encounter.feedback = [{ id: 4, kind: 'armor', tick: 1, x: 0, z: 0, enemyId: 2 }];
  s.encounter.commanderCharging = true;
  s.encounter.shotsFired = 2;
  s.encounter.shotsHit = 1;
  const decoded = decodeVehicleSession(JSON.parse(JSON.stringify(s)));
  expect(decoded).toEqual(s);
  expect(decoded?.encounter.barrels).not.toBe(s.encounter.barrels);
});
it('rejects malformed or oversized tactical state', () => {
  const s = session();
  s.encounter.shotsHit = 1;
  expect(decodeVehicleSession(s)).toBeNull();
  s.encounter.shotsHit = 0;
  s.encounter.barrels = Array.from({ length: 4 }, (_, id) => ({ id, x: 0, z: 0, active: true }));
  expect(decodeVehicleSession(s)).toBeNull();
  s.encounter.barrels = [];
  s.encounter.feedback = Array.from({ length: 65 }, (_, id) => ({
    id,
    tick: 0,
    x: 0,
    z: 0,
    kind: 'shot',
  }));
  expect(decodeVehicleSession(s)).toBeNull();
  const forged = {
    ...session(),
    encounter: {
      ...session().encounter,
      feedback: [{ id: 1, tick: 0, x: 0, z: 0, kind: ['shot'] }],
    },
  };
  expect(decodeVehicleSession(forged)).toBeNull();
});
