// measureHoardRoom (src/sim/rift/hoard_room.ts): the room in front of a hoard
// boss, which the bone boss's scythe and Hoarfrost's pillars are both laid into.
import { describe, expect, it } from 'vitest';
import { measureHoardRoom } from '../src/sim/rift/hoard_room';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';

function hoard() {
  const sim = new Sim({ seed: 5150, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.enterRift(makeVaultSeed(3, 183), 23, sim.player.id, undefined, {
    ...sim.player,
    id: -1,
    vaultOwnerPid: sim.player.id,
    vaultRarity: 'rare',
  });
  const inst = sim.riftInstances.find((entry) => entry.partyKey !== null);
  if (!inst || inst.bossId === null) throw new Error('missing hoard');
  const boss = sim.entities.get(inst.bossId);
  if (!boss) throw new Error('missing boss');
  return { inst, boss };
}

describe('measureHoardRoom', () => {
  it('opens away from the wall the boss stands against, as wide as asked and no deeper', () => {
    const { inst, boss } = hoard();
    const room = measureHoardRoom(inst, boss, 8, 40);
    expect(Math.abs(room.forwardSign)).toBe(1);
    expect(room.halfWidth).toBeGreaterThanOrEqual(8);
    expect(room.clearDepth).toBeGreaterThan(10);
    expect(room.clearDepth).toBeLessThanOrEqual(40);
    // The walk is in two yard steps and stops at the depth it was given.
    expect(room.clearDepth % 2).toBe(0);
    expect(measureHoardRoom(inst, boss, 8, 12).clearDepth).toBeLessThanOrEqual(12);
    // Same floor, same answer: it regenerates the layout from the seed, no rng.
    expect(measureHoardRoom(inst, boss, 8, 40)).toEqual(room);
  });

  it('measures off where the boss STANDS: dragged aside, the room narrows by as much', () => {
    const { inst, boss } = hoard();
    const centred = measureHoardRoom(inst, boss, 4, 30);
    boss.pos.x += 6;
    const aside = measureHoardRoom(inst, boss, 4, 30);
    expect(aside.halfWidth).toBeLessThan(centred.halfWidth);
    expect(centred.halfWidth - aside.halfWidth).toBeGreaterThan(3);
    expect(aside.forwardSign).toBe(centred.forwardSign);
  });

  it('falls back to the width asked for, and no depth, when nothing is that wide', () => {
    const { inst, boss } = hoard();
    expect(measureHoardRoom(inst, boss, 500, 40)).toMatchObject({ halfWidth: 500, clearDepth: 0 });
    // A demand the room meets only near him ends the clear run early.
    const wide = measureHoardRoom(inst, boss, 8, 40);
    const greedy = measureHoardRoom(inst, boss, wide.halfWidth + 0.5, 40);
    expect(greedy.clearDepth).toBeLessThan(wide.clearDepth);
  });
});
