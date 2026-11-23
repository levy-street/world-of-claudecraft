// The Great Saurian's loose end and its deed (docs/design/dungeon-rework/
// wildheart_basin.md sections 4.3 and 9; src/sim/encounters/wildheart_basin/
// great_saurian.ts and index.ts): once the pull is over (the Saurian down or
// walking home) its Howdah Hexcaller never idles in the ford, and Toppled
// Titan is earned when the Saurian and its rider fall within 20 s of each
// other. On a real claimed Basin with a real party.

import { describe, expect, it } from 'vitest';
import {
  GREAT_SAURIAN_ID,
  HOWDAH_HEXCALLER_ID,
  SAURIAN_DEED,
  SAURIAN_DEED_WINDOW,
  SAURIAN_TUNING,
} from '../src/sim/encounters/wildheart_basin';
import type { Entity } from '../src/sim/types';
import {
  boss,
  earned,
  engage,
  type Fight,
  fight,
  live,
  put,
  run,
  tick,
} from './helpers/wildheart_fight';

function pull(f: Fight): { saurian: Entity; rider: Entity } {
  const saurian = boss(f, GREAT_SAURIAN_ID);
  put(f, saurian, -18, -109);
  put(f, f.tank, -18, -103);
  for (const p of f.others) put(f, p, -30, -100);
  engage(f, saurian, 1e6);
  tick(f);
  f.sim.chat('/dev wildheart trigger howdah', f.tank.id);
  tick(f);
  // Mid-leap: the rider lands on the HowdahBreak clip's beat, not at the break.
  expect(live(f, HOWDAH_HEXCALLER_ID)).toHaveLength(0);
  run(f, SAURIAN_TUNING.riderLandDelay);
  const [rider] = live(f, HOWDAH_HEXCALLER_ID);
  if (!rider) throw new Error('no rider');
  return { saurian, rider };
}

function evade(e: Entity): void {
  e.inCombat = false;
  e.aggroTargetId = null;
  e.aiState = 'evade';
}

describe('the Howdah Hexcaller never idles in the ford', () => {
  it('the Saurian falls, the group wipes: the rider climbs away', () => {
    const f = fight('normal', 3, 'mage', [GREAT_SAURIAN_ID]);
    const { saurian, rider } = pull(f);
    f.sim.ctx.handleDeath(saurian, f.tank);
    tick(f);
    expect(f.sim.ctx.entities.has(rider.id)).toBe(true);
    evade(rider);
    tick(f);
    expect(f.sim.ctx.entities.has(rider.id)).toBe(false);
    expect(f.inst.mobIds.includes(rider.id)).toBe(false);
  });

  it('the group wipes on a living Saurian: the rider goes with the reset', () => {
    const f = fight('normal', 3, 'mage', [GREAT_SAURIAN_ID]);
    const { saurian, rider } = pull(f);
    evade(saurian);
    evade(rider);
    tick(f);
    expect(f.sim.ctx.entities.has(rider.id)).toBe(false);
  });

  it('while the rider still fights a dead Saurian, it stays', () => {
    const f = fight('normal', 3, 'mage', [GREAT_SAURIAN_ID]);
    const { saurian, rider } = pull(f);
    f.sim.ctx.handleDeath(saurian, f.tank);
    run(f, 1);
    expect(rider.dead).toBe(false);
    expect(f.sim.ctx.entities.has(rider.id)).toBe(true);
  });
});

describe('Toppled Titan', () => {
  it('the Saurian and its rider within 20 s of each other: the deed', () => {
    const f = fight('normal', 3, 'mage', [GREAT_SAURIAN_ID]);
    const { saurian, rider } = pull(f);
    f.sim.ctx.handleDeath(rider, f.tank);
    run(f, 5);
    f.sim.ctx.handleDeath(saurian, f.tank);
    tick(f);
    expect(earned(f, f.tank, SAURIAN_DEED)).toBe(true);
  });

  it('the Saurian falls while its rider is mid-leap: it still lands, and counts', () => {
    const f = fight('normal', 3, 'mage', [GREAT_SAURIAN_ID]);
    const saurian = boss(f, GREAT_SAURIAN_ID);
    put(f, saurian, -18, -109);
    put(f, f.tank, -18, -103);
    for (const p of f.others) put(f, p, -30, -100);
    engage(f, saurian, 1e6);
    tick(f);
    f.sim.chat('/dev wildheart trigger howdah', f.tank.id);
    tick(f);
    f.sim.ctx.handleDeath(saurian, f.tank);
    run(f, SAURIAN_TUNING.riderLandDelay);
    const [rider] = live(f, HOWDAH_HEXCALLER_ID);
    expect(rider).toBeDefined();
    f.sim.ctx.handleDeath(rider, f.tank);
    tick(f);
    expect(earned(f, f.tank, SAURIAN_DEED)).toBe(true);
  });

  it('the rider last, inside the window, also counts', () => {
    const f = fight('normal', 3, 'mage', [GREAT_SAURIAN_ID]);
    const { saurian, rider } = pull(f);
    f.sim.ctx.handleDeath(saurian, f.tank);
    run(f, 8);
    f.sim.ctx.handleDeath(rider, f.tank);
    tick(f);
    expect(earned(f, f.tank, SAURIAN_DEED)).toBe(true);
  });

  it('more than 20 s apart: no deed', () => {
    const f = fight('normal', 3, 'mage', [GREAT_SAURIAN_ID]);
    const { saurian, rider } = pull(f);
    f.sim.ctx.handleDeath(rider, f.tank);
    run(f, SAURIAN_DEED_WINDOW + 1);
    f.sim.ctx.handleDeath(saurian, f.tank);
    tick(f);
    expect(earned(f, f.tank, SAURIAN_DEED)).toBe(false);
  });
});
