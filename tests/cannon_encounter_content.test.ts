import { expect, it } from 'vitest';
import { CANNON_ACTIONS, CANNON_ENEMIES, CANNON_WAVES } from '../src/sim/content/cannon_encounter';
import { NORTH_WATCH_CANNON } from '../src/sim/content/vehicle_stations';
import { TICK_RATE } from '../src/sim/types';

it('compresses only the introductory intervals by 15% without changing the weapon kit', () => {
  expect([...new Set(CANNON_WAVES[0].map((spawn) => spawn.atTick))]).toEqual([0, 136, 306, 544]);
  expect(CANNON_WAVES[0].every((spawn) => spawn.kind === 'infantry')).toBe(true);
  expect(Object.values(CANNON_ACTIONS).map((a) => [a.damage, a.cooldownTicks])).toEqual([
    [100, 40],
    [60, 120],
    [30, 240],
  ]);
});

it('pairs each second-wave sapper with armored attackers on the opposite flank', () => {
  const wave = CANNON_WAVES[1];
  const sappers = wave.filter((spawn) => spawn.kind === 'sapper');
  expect(sappers).toHaveLength(2);
  for (const sapper of sappers) {
    expect(sapper.lane).toBeGreaterThan(0.7);
    expect(
      wave.filter(
        (spawn) => spawn.atTick === sapper.atTick && spawn.kind === 'armored' && spawn.lane < 0.3,
      ),
    ).toHaveLength(2);
  }
});

it('introduces the commander with two armored escorts and a sapper', () => {
  const wave = CANNON_WAVES[2];
  const commander = wave.find((spawn) => spawn.kind === 'commander')!;
  expect(
    wave
      .filter((spawn) => spawn.atTick === commander.atTick)
      .map((spawn) => spawn.kind)
      .sort(),
  ).toEqual(['armored', 'armored', 'commander', 'sapper']);
});

it('triples ordinary attackers while keeping one commander and increases every march speed by 40%', () => {
  expect(CANNON_WAVES.map((wave) => wave.length)).toEqual([27, 33, 31]);
  expect(CANNON_WAVES.flat().filter((spawn) => spawn.kind === 'commander')).toHaveLength(1);
  const previous = { infantry: 1.5, runner: 2.7, armored: 1, commander: 0.7 };
  for (const kind of ['infantry', 'runner', 'armored', 'commander'] as const) {
    expect(CANNON_ENEMIES[kind].speed).toBeCloseTo(previous[kind] * 1.4);
  }
});

it('cannot exceed the 32-enemy wire/visual capacity even with permanent maximum slowing', () => {
  const depth = NORTH_WATCH_CANNON.field.maxZ - NORTH_WATCH_CANNON.field.minZ;
  for (const wave of CANNON_WAVES) {
    expect(wave.map((spawn) => spawn.atTick)).toEqual(
      wave.map((spawn) => spawn.atTick).sort((a, b) => a - b),
    );
    for (const boundary of wave) {
      // Kills can only reduce this upper bound. Continuous slow is stricter than real cooldowns.
      const living = wave.filter(
        (spawn) =>
          spawn.atTick <= boundary.atTick &&
          boundary.atTick - spawn.atTick <=
            (depth / (CANNON_ENEMIES[spawn.kind].speed * CANNON_ACTIONS.grapeshot.slowMultiplier)) *
              TICK_RATE,
      );
      expect(living.length).toBeLessThanOrEqual(32);
      // Fixed prepared rigs must never hide an actionable enemy of an exhausted kind.
      const capacity = { infantry: 27, runner: 9, armored: 12, commander: 1, sapper: 2 };
      for (const kind of ['infantry', 'runner', 'armored', 'commander', 'sapper'] as const)
        expect(living.filter((spawn) => spawn.kind === kind).length).toBeLessThanOrEqual(
          capacity[kind],
        );
    }
  }
});

it('separates simultaneous bodies by at least one yard rather than overlapping clones', () => {
  const width = NORTH_WATCH_CANNON.field.maxX - NORTH_WATCH_CANNON.field.minX;
  for (const wave of CANNON_WAVES)
    for (let i = 0; i < wave.length; i++) {
      for (const other of wave.slice(i + 1)) {
        if (wave[i].atTick === other.atTick)
          expect(Math.abs(wave[i].lane - other.lane) * width).toBeGreaterThanOrEqual(1);
      }
    }
});
