// /dev heart final quarter <zone> (src/sim/dev/smith_heart_final_dev.ts,
// phase 2K) over a REAL Sim: the Masterless Strength stands in the middle of
// the named quarter (the geometry core reads that quarter there), it stays
// put a while (its home moved with it), `ring` sets it on the centre and
// pulls it onto the player, an unknown zone prints the help, outside a run it
// refuses, and a non-dev world never runs it.

import { describe, expect, it } from 'vitest';
import { SMITH_HEART_DUNGEON, SMITH_HEART_FINAL_BOSS } from '../src/sim/content/smith_heart';
import { HEART_ROOM } from '../src/sim/content/smith_heart_layout';
import {
  HEART_QUARTER_ORDER,
  heartQuarterAt,
  heartQuarterSpot,
} from '../src/sim/content/smith_heart_quarters';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { handleSmithHeartDevChat } from '../src/sim/dev/smith_heart_dev';
import { smithHeartFinalBoss } from '../src/sim/dev/smith_heart_final_dev';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

const DUNGEON = DUNGEONS[SMITH_HEART_DUNGEON];

function devSim(devCommands = true) {
  const sim = new Sim({ seed: 23, playerClass: 'warrior', autoEquip: false, devCommands });
  const dev = (line: string) => handleSmithHeartDevChat(sim.ctx, line, sim.player.id);
  const claim = (): InstanceSlot | null =>
    sim.ctx.instances.find((inst) => {
      if (inst.dungeonId !== SMITH_HEART_DUNGEON || inst.partyKey === null) return false;
      if (inst.exitId === null) return false;
      const o = instanceOrigin(DUNGEON.index, inst.slot);
      return Math.abs(sim.player.pos.x - o.x) < 300 && Math.abs(sim.player.pos.z - o.z) < 250;
    }) ?? null;
  return { sim, dev, claim };
}

const said = (events: SimEvent[]) =>
  events.flatMap((e) => (e.type === 'log' || e.type === 'error' ? [e.text] : []));

describe('/dev heart final quarter', () => {
  it('stands the boss in the middle of each quarter, where the core reads that quarter', () => {
    const { sim, dev, claim } = devSim();
    sim.setPlayerLevel(20);
    expect(dev('/dev heart tp heartroom')).toBe(true);
    const inst = claim();
    if (!inst) throw new Error('no claim');
    const o = instanceOrigin(DUNGEON.index, inst.slot);
    sim.tick();
    for (const zone of HEART_QUARTER_ORDER) {
      expect(dev(`/dev heart final quarter ${zone}`)).toBe(true);
      expect(said(sim.tick()).some((l) => l.includes(`${zone} quarter`))).toBe(true);
      const boss = smithHeartFinalBoss(sim.ctx, inst);
      if (!boss) throw new Error('no boss');
      const lx = boss.pos.x - o.x;
      const lz = boss.pos.z - o.z;
      const spot = heartQuarterSpot(zone);
      expect(lx).toBeCloseTo(spot.x, 3);
      expect(lz).toBeCloseTo(spot.z, 3);
      expect(heartQuarterAt(lx, lz)).toBe(zone);
      expect(boss.spawnPos.x).toBeCloseTo(boss.pos.x, 6);
      expect(boss.spawnPos.z).toBeCloseTo(boss.pos.z, 6);
      // It stays where it was set down (the raid stands far off on the terrace).
      for (let i = 0; i < 40; i++) sim.tick();
      expect(heartQuarterAt(boss.pos.x - o.x, boss.pos.z - o.z)).toBe(zone);
    }
  });

  it('ring sets it on the centre and turns it on the player', () => {
    const { sim, dev, claim } = devSim();
    sim.setPlayerLevel(20);
    dev('/dev heart tp heartroom');
    const inst = claim();
    if (!inst) throw new Error('no claim');
    const o = instanceOrigin(DUNGEON.index, inst.slot);
    sim.player.maxHp = 1e6;
    sim.player.hp = 1e6;
    expect(dev('/dev heart final quarter ring')).toBe(true);
    const lines = said(sim.tick());
    expect(lines.some((l) => l.includes('central ring'))).toBe(true);
    const boss = smithHeartFinalBoss(sim.ctx, inst);
    if (!boss) throw new Error('no boss');
    expect(boss.inCombat).toBe(true);
    expect(
      Math.hypot(boss.spawnPos.x - o.x - HEART_ROOM.x, boss.spawnPos.z - o.z - HEART_ROOM.z),
    ).toBeLessThan(0.01);
  });

  it('prints the help for an unknown zone and refuses outside a run', () => {
    const { sim, dev } = devSim();
    expect(dev('/dev heart final quarter north')).toBe(true);
    // Not inside a run yet.
    expect(said(sim.tick()).some((l) => l.includes('Not inside'))).toBe(true);
    dev('/dev heart tp heartroom');
    sim.tick();
    expect(dev('/dev heart final quarter north')).toBe(true);
    expect(said(sim.tick()).some((l) => l.includes('final quarter <'))).toBe(true);
    expect(dev('/dev heart final')).toBe(true);
    expect(said(sim.tick()).some((l) => l.includes('final quarter <'))).toBe(true);
  });

  it('does nothing in a world without dev commands', () => {
    const { sim, claim } = devSim(false);
    sim.chat('/dev heart final quarter hammer', sim.player.id);
    sim.tick();
    expect(claim()).toBeNull();
    const boss = [...sim.ctx.entities.values()].find(
      (e) => e.templateId === SMITH_HEART_FINAL_BOSS,
    );
    // No claim, so no boss ever spawned or moved.
    expect(boss).toBeUndefined();
  });
});
