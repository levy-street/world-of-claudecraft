import { describe, expect, it } from 'vitest';
import { runOwnedClassDpsProbe, runOwnedHealerProbe } from '../scripts/owned_class_balance_probe';
import type { Sim } from '../src/sim/sim';

describe('owned balance probe custom equipment setup', () => {
  it('runs a DPS setup once after the fixed equipment and talents are ready', () => {
    const observations: unknown[] = [];
    const probe = runOwnedClassDpsProbe as (...args: unknown[]) => unknown;
    expect(() =>
      probe(
        'warspirit',
        { targets: 1, seconds: 15, window: 'burst' },
        29900,
        'test',
        undefined,
        'pbe',
        (sim: Sim) => {
          observations.push({
            level: sim.player.level,
            chest: sim.equipment.chest,
            spec: sim.talents.spec,
          });
          throw new Error('setup observed');
        },
      ),
    ).toThrow('setup observed');
    expect(observations).toEqual([{ level: 20, chest: 'deathlord_warplate', spec: 'enhancement' }]);
  });

  it('runs a healer setup once after the fixed equipment and talents are ready', () => {
    const observations: unknown[] = [];
    const probe = runOwnedHealerProbe as (...args: unknown[]) => unknown;
    expect(() =>
      probe('doctrine', 1, 29900, 'test', undefined, 1, (sim: Sim) => {
        observations.push({
          level: sim.player.level,
          chest: sim.equipment.chest,
          spec: sim.talents.spec,
        });
        throw new Error('setup observed');
      }),
    ).toThrow('setup observed');
    expect(observations).toEqual([
      { level: 20, chest: 'shroud_of_the_gravewyrm', spec: 'discipline' },
    ]);
  });
});
