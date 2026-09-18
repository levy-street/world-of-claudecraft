import { describe, expect, it } from 'vitest';
import { CANNON_ENEMIES, CANNON_TACTICS } from '../src/sim/content/cannon_encounter';
import {
  createCannonEncounter,
  fireCannon,
  tickCannonEncounter,
} from '../src/sim/minigames/cannon_encounter';
import {
  cannonFeedback,
  cannonMarchMultiplier,
  cannonResult,
  damageCannonEnemies,
  detonateCannonBarrels,
  prepareCannonBarrels,
} from '../src/sim/minigames/cannon_tactics';
import { type CannonEncounterState, TICK_RATE } from '../src/sim/types';

const field = { minX: 0, maxX: 30, minZ: 0, maxZ: 40 };
const point = { x: 15, z: 20 };
describe('cannon tactical decisions', () => {
  it('provides three, two, then one fresh barrel through the actual wave transition', () => {
    const s = createCannonEncounter();
    for (let wave = 0; wave < 3; wave++) {
      if (wave > 0) {
        s.phase = 'intermission';
        s.phaseUntilTick = s.tick + 1;
      }
      while (s.phase !== 'wave') tickCannonEncounter(s, field);
      expect(s.wave).toBe(wave);
      expect(s.barrels.map((b) => b.x)).toEqual([[7.5, 15, 22.5], [7.5, 22.5], [15]][wave]);
      expect(s.barrels.every((b) => b.active)).toBe(true);
      detonateCannonBarrels(s, point, 50);
    }
  });
  it('carries an unlit barrel into the next wave and never doubles an occupied spot', () => {
    const runToWave = (s: CannonEncounterState) => {
      while (s.phase !== 'wave') tickCannonEncounter(s, field);
    };
    const s = createCannonEncounter();
    runToWave(s);
    expect(s.barrels).toHaveLength(3);
    // Spend only the flanks; the centre barrel (x 15) stays untouched into wave two.
    s.barrels[0].active = false;
    s.barrels[2].active = false;
    const keptId = s.barrels[1].id;
    s.phase = 'intermission';
    s.phaseUntilTick = s.tick + 1;
    runToWave(s);
    expect(s.wave).toBe(1);
    expect(s.barrels.map((b) => b.x).sort((a, b) => a - b)).toEqual([7.5, 15, 22.5]);
    expect(s.barrels.every((b) => b.active)).toBe(true);
    expect(s.barrels.find((b) => b.x === 15)?.id).toBe(keptId);
    // Wave three authors only the centre: the kept centre wins, nothing is added.
    s.barrels = s.barrels.filter((b) => b.x === 15);
    s.phase = 'intermission';
    s.phaseUntilTick = s.tick + 1;
    runToWave(s);
    expect(s.wave).toBe(2);
    expect(s.barrels).toHaveLength(1);
    expect(s.barrels[0].id).toBe(keptId);
  });
  it('detonates only the targeted barrel and does not chain-explode neighboring barrels', () => {
    const s = createCannonEncounter();
    prepareCannonBarrels(s, field);
    expect(s.barrels).toHaveLength(3);
    detonateCannonBarrels(s, s.barrels[0], 1);
    expect(s.barrels[0].active).toBe(false);
    expect(s.barrels[1].active).toBe(true);
    expect(s.barrels[2].active).toBe(true);
  });
  it('credits a missed initial incendiary impact once when later burn pulses hit', () => {
    const s = createCannonEncounter();
    s.phase = 'wave';
    s.waveStartTick = 10000;
    fireCannon(s, field, 'incendiary', point);
    for (let i = 0; i < 16; i++) tickCannonEncounter(s, field);
    expect(s.shotsHit).toBe(0);
    s.enemies = [{ id: 99, kind: 'commander', hp: 800, slowUntilTick: 0, ...point }];
    for (let i = 0; i < 3 * TICK_RATE; i++) tickCannonEncounter(s, field);
    expect(s.shotsHit).toBe(1);
    expect(s.fires[0].hitCredited).toBe(true);
  });
  it('resists fire until a cannonball breaks armor, then doubles fire damage', () => {
    const s = createCannonEncounter();
    s.enemies = [{ id: 99, kind: 'armored', hp: 220, slowUntilTick: 0, ...point }];
    damageCannonEnemies(s, point, 6, 20, 'incendiary');
    expect(s.enemies[0].hp).toBe(210);
    damageCannonEnemies(s, point, 6, 100, 'cannonball');
    expect(s.enemies[0]).toMatchObject({ hp: 110, armorBroken: true });
    damageCannonEnemies(s, point, 6, 20, 'incendiary');
    expect(s.enemies[0].hp).toBe(70);
    damageCannonEnemies(s, point, 6, 100, 'cannonball');
    damageCannonEnemies(s, point, 6, 100, 'cannonball');
    expect(s.killed).toBe(1);
    expect(s.feedback.filter((e) => e.kind === 'armor')).toHaveLength(1);
    expect(s.feedback.filter((e) => e.kind === 'death')).toHaveLength(1);
  });
  it('detonates targeted barrels independently and refreshes their positions for a new wave', () => {
    const s = createCannonEncounter();
    s.barrels = [0, 1, 2].map((i) => ({ id: 100 + i, active: true, x: i * 7, z: 20 }));
    s.enemies = [{ id: 99, kind: 'infantry', hp: 100, slowUntilTick: 0, x: 5, z: 20 }];
    expect(detonateCannonBarrels(s, { x: 0, z: 20 }, 1)).toBe(true);
    expect(s.barrels[0].active).toBe(false);
    expect(s.barrels[1].active).toBe(true);
    expect(s.barrels[2].active).toBe(true);
    expect(s.killed).toBe(1);
    expect(s.feedback.filter((e) => e.kind === 'barrel')).toHaveLength(1);
    expect(detonateCannonBarrels(s, { x: 7, z: 20 }, 1)).toBe(true);
    expect(s.barrels[1].active).toBe(false);
    expect(s.barrels[2].active).toBe(true);
    expect(detonateCannonBarrels(s, { x: 14, z: 20 }, 1)).toBe(true);
    expect(s.barrels[2].active).toBe(false);
    expect(detonateCannonBarrels(s, point, 50)).toBe(false);
    prepareCannonBarrels(s, field);
    expect(s.barrels).toHaveLength(3);
    expect(s.barrels.every((b) => b.active && b.x >= 0 && b.x <= 30 && b.z > 0 && b.z < 40)).toBe(
      true,
    );
  });
  it('triggers one charge at 65% health, speeds the escort, and ends the order on death', () => {
    const s = createCannonEncounter();
    s.enemies = [{ id: 99, kind: 'commander', hp: 522, slowUntilTick: 0, ...point }];
    damageCannonEnemies(s, point, 6, 1, 'cannonball');
    expect(s.commanderCharging).toBe(false);
    damageCannonEnemies(s, point, 6, 1, 'cannonball');
    expect(s.commanderCharging).toBe(true);
    expect(cannonMarchMultiplier(s, 'commander')).toBe(CANNON_TACTICS.commanderChargeSpeed);
    expect(cannonMarchMultiplier(s, 'infantry')).toBe(CANNON_TACTICS.troopChargeSpeed);
    damageCannonEnemies(s, point, 6, 1, 'cannonball');
    expect(s.feedback.filter((e) => e.kind === 'charge')).toHaveLength(1);
    damageCannonEnemies(s, point, 6, 520, 'cannonball');
    expect(cannonMarchMultiplier(s, 'infantry')).toBe(1);
  });
  it('sappers race toward the line and inflict their larger breach penalty', () => {
    const s = createCannonEncounter();
    s.phase = 'wave';
    s.waveStartTick = 1000;
    s.enemies = [{ id: 99, kind: 'sapper', hp: 80, slowUntilTick: 0, x: 15, z: 39.99 }];
    tickCannonEncounter(s, field);
    expect(s.integrity).toBe(100 - CANNON_ENEMIES.sapper.breachDamage);
    expect(s.breached).toBe(1);
  });
  it('counts one accuracy hit per projectile, not per victim or burn pulse', () => {
    const s = createCannonEncounter();
    s.phase = 'wave';
    s.waveStartTick = 10000;
    s.enemies = [1, 2].map((id) => ({
      id: 100 + id,
      kind: 'infantry' as const,
      hp: 100,
      slowUntilTick: 0,
      x: 15,
      z: 18,
    }));
    fireCannon(s, field, 'incendiary', point);
    for (let i = 0; i < 6 * TICK_RATE; i++) tickCannonEncounter(s, field);
    expect(s.shotsFired).toBe(1);
    expect(s.shotsHit).toBe(1);
    fireCannon(s, field, 'cannonball', { x: 0, z: 0 });
    for (let i = 0; i < TICK_RATE; i++) tickCannonEncounter(s, field);
    expect(s.shotsFired).toBe(2);
    expect(s.shotsHit).toBe(1);
  });
  it.each([
    [95, 4, 5, 'gold'],
    [94, 4, 5, 'silver'],
    [95, 79, 100, 'silver'],
    [90, 3, 4, 'silver'],
    [60, 1, 2, 'silver'],
    [59, 1, 2, 'bronze'],
    [100, 0, 0, 'bronze'],
    [100, 1, 4, 'bronze'],
  ] as const)(
    'scores integrity %s and %s/%s accuracy as %s',
    (integrity, shotsHit, shotsFired, medal) => {
      const s = createCannonEncounter();
      Object.assign(s, { phase: 'won', integrity, shotsHit, shotsFired });
      expect(cannonResult(s).medal).toBe(medal);
      s.phase = 'failed';
      expect(cannonResult(s).medal).toBeNull();
    },
  );
  it('bounds feedback history and removes expired presentation events', () => {
    const s = createCannonEncounter();
    for (let i = 0; i < 1000; i++) cannonFeedback(s, 'impact', point);
    expect(s.feedback).toHaveLength(64);
    for (let i = 0; i < 21; i++) tickCannonEncounter(s, field);
    expect(s.feedback).toEqual([]);
  });
});
