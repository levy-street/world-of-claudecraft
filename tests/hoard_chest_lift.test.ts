// The reward chest of a common or rare Buried Hoard stands on the room's raised
// floor, like every other thing in it. Playtest: the boss fell, the claim prompt
// worked, and no chest was anywhere to be seen, because it spawned at ground
// height under the dais tier.
import { describe, expect, it } from 'vitest';
import { riftInstanceOrigin } from '../src/sim/data';
import { devHoardDestination, enterDevHoard } from '../src/sim/dev/hoard_travel';
import { RIFT_RANK_BASE_LEVEL } from '../src/sim/rift/ranks';
import { generateRiftFloor, riftLiftAt } from '../src/sim/rift/rift_gen';
import type { RiftInstance } from '../src/sim/rift/types';
import { vaultSeedOpen } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function hoard(rarity: 'common' | 'rare' | 'epic' | 'legendary'): {
  sim: Sim;
  inst: RiftInstance;
  boss: Entity;
} {
  const sim = new Sim({ seed: 4242, playerClass: 'warrior', autoEquip: true, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat('/dev god', sim.player.id);
  // The themed bosses hold the open valleys; the caves hold the cave bosses.
  const who = rarity === 'common' || rarity === 'rare' ? 'mushroom' : 'grask';
  sim.chat(`/dev hoard ${who} ${rarity}`, sim.player.id);
  const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null);
  if (!inst || inst.bossId === null) throw new Error('missing hoard');
  const boss = sim.entities.get(inst.bossId);
  if (!boss) throw new Error('missing boss');
  return { sim, inst, boss };
}

/** Kill the boss the ordinary way, then let the room settle. */
function clear(sim: Sim, inst: RiftInstance, boss: Entity): Entity {
  for (const id of inst.mobIds) {
    const mob = sim.entities.get(id);
    if (mob && id !== inst.bossId) sim.ctx.handleDeath(mob, sim.player);
  }
  sim.ctx.handleDeath(boss, sim.player);
  for (let t = 0; t < 40; t++) sim.tick();
  const chestId = inst.vault?.chest?.entityId;
  const chest = chestId === undefined ? undefined : sim.entities.get(chestId);
  if (!chest) throw new Error('no chest');
  return chest;
}

describe('the hoard reward chest', () => {
  it('stands on the room floor, not under it, in a room with a raised tier', () => {
    // A rare cave whose dais sits on the room's raised tier (the tier is rolled
    // per room; it is what this guards).
    const destination = devHoardDestination(
      'mushroom',
      'rare',
      (seed) => generateRiftFloor(seed, RIFT_RANK_BASE_LEVEL.B, 0).platform !== null,
    );
    if (!destination) throw new Error('no raised rare cave in the search');
    const sim = new Sim({ seed: 4242, playerClass: 'warrior', autoEquip: true, devCommands: true });
    sim.chat('/dev level 20', sim.player.id);
    sim.chat('/dev god', sim.player.id);
    enterDevHoard(sim.ctx, sim.player.id, destination);
    const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null);
    if (!inst || inst.bossId === null) throw new Error('missing hoard');
    const boss = sim.entities.get(inst.bossId);
    if (!boss) throw new Error('missing boss');
    const floor = generateRiftFloor(inst.seed, inst.baseLevel, inst.floorIndex);
    const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
    const chest = clear(sim, inst, boss);
    const expected = riftLiftAt(floor, chest.pos.x - origin.x, chest.pos.z - origin.z);
    // The room this playtest found IS raised: without a tier the bug cannot show.
    expect(expected).toBeGreaterThan(0);
    expect(chest.pos.y).toBeCloseTo(expected, 3);
  });

  it('stands on the ground of an open-air hoard, where the tier is flat', () => {
    const { sim, inst, boss } = hoard('legendary');
    const chest = clear(sim, inst, boss);
    expect(chest.pos.y).toBeCloseTo(0, 3);
  });
});

describe('the dev hoard command', () => {
  it('digs the room each rarity really opens: only epic and legendary are open air', () => {
    expect(vaultSeedOpen(devHoardDestination('mushroom', 'common')!.seed)).toBe(false);
    expect(vaultSeedOpen(devHoardDestination('mushroom', 'rare')!.seed)).toBe(false);
    expect(vaultSeedOpen(devHoardDestination('grask', 'epic')!.seed)).toBe(true);
    expect(vaultSeedOpen(devHoardDestination('grask')!.seed)).toBe(true);
    expect(devHoardDestination('mushroom', 'common')!.tier).toBe('C');
    expect(RIFT_RANK_BASE_LEVEL[devHoardDestination('grask', 'epic')!.tier]).toBe(25);
  });
});
