// The Buried Hoard reward chest (src/sim/rift/hoard_reward_chest.ts): the final
// boss falls, exactly one chest appears, each entrant opens it for their share,
// and nobody can lose that share by leaving or by the hoard being torn down.
import { describe, expect, it } from 'vitest';
import {
  clearHoardRewardChest,
  HOARD_REWARD_CHEST_OPEN_TEMPLATE,
  HOARD_REWARD_CHEST_RANGE,
  HOARD_REWARD_CHEST_TEMPLATE,
  openHoardRewardChest,
  spawnHoardRewardChest,
} from '../src/sim/rift/hoard_reward_chest';
import type { RiftInstance } from '../src/sim/rift/types';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

function makeHoard(rarity: 'common' | 'rare' | 'epic' | 'legendary' = 'epic') {
  const sim = new Sim({ seed: 6120, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat('/dev god', sim.player.id);
  const portal = { ...sim.player, id: -1, vaultOwnerPid: sim.player.id, vaultRarity: rarity };
  sim.enterRift(makeVaultSeed(2, 77), 22, sim.player.id, undefined, portal);
  const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null);
  if (!inst || inst.bossId === null) throw new Error('missing hoard');
  const boss = sim.entities.get(inst.bossId);
  if (!boss) throw new Error('missing boss');
  sim.drainEvents();
  return { sim, inst, boss };
}

function killBoss(sim: Sim, boss: Entity): SimEvent[] {
  sim.player.pos = { ...boss.pos, z: boss.pos.z - 2 };
  boss.hp = 1;
  sim.ctx.dealDamage(sim.player, boss, 9999, false, 'physical', 'Test Blow', 'hit', true);
  const events: SimEvent[] = [];
  for (let step = 0; step < 40; step++) {
    sim.tick();
    events.push(...sim.drainEvents());
  }
  return events;
}

const chestOf = (sim: Sim, inst: RiftInstance): Entity | undefined =>
  inst.vault?.chest ? sim.entities.get(inst.vault.chest.entityId) : undefined;

const paid = (events: readonly SimEvent[]): number =>
  events.filter((event) => event.type === 'treasureVaultLooted' && !event.capped).length;

describe('Buried Hoard reward chest', () => {
  it('appears only when the boss dies, once, carrying the map rarity, and pays nothing yet', () => {
    const { sim, inst, boss } = makeHoard('legendary');
    expect(inst.vault?.chest).toBeUndefined();
    const events = killBoss(sim, boss);
    const chest = chestOf(sim, inst);
    expect(chest?.templateId).toBe(HOARD_REWARD_CHEST_TEMPLATE);
    expect(chest?.kind).toBe('object');
    expect(chest?.lootable).toBe(true);
    expect(chest?.vaultRarity).toBe('legendary');
    expect(inst.vault?.chest?.eligible).toEqual([sim.player.id]);
    // The kill itself no longer pays: the chest does.
    expect(paid(events)).toBe(0);

    // A duplicated completion or a second spawn call never makes a second chest.
    const before = chest?.id;
    spawnHoardRewardChest(sim.ctx, inst, [sim.player.id], { x: chest?.pos.x ?? 0, z: 0 });
    for (let step = 0; step < 20; step++) sim.tick();
    expect(inst.vault?.chest?.entityId).toBe(before);
    expect(
      [...sim.entities.values()].filter((e) => e.templateId === HOARD_REWARD_CHEST_TEMPLATE),
    ).toHaveLength(1);
  });

  it('pays the opener their share once, from close range, and swings the lid open', () => {
    const { sim, inst, boss } = makeHoard();
    killBoss(sim, boss);
    const chest = chestOf(sim, inst);
    if (!chest) throw new Error('no chest');

    sim.player.pos = { ...chest.pos, x: chest.pos.x + HOARD_REWARD_CHEST_RANGE + 3 };
    openHoardRewardChest(sim.ctx, chest.id, sim.player.id);
    expect(paid(sim.drainEvents())).toBe(0);
    expect(chest.templateId).toBe(HOARD_REWARD_CHEST_TEMPLATE);

    sim.player.pos = { ...chest.pos, x: chest.pos.x + 1.5 };
    const copperBefore = sim.ctx.players.get(sim.player.id)?.copper ?? 0;
    // Through the ordinary interact key, the way a player opens it.
    sim.player.targetId = chest.id;
    sim.interact(sim.player.id);
    const events = sim.drainEvents();
    expect(paid(events)).toBe(1);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'treasureVaultLooted', rarity: 'epic', capped: false }),
    );
    expect(sim.ctx.players.get(sim.player.id)?.copper ?? 0).toBeGreaterThan(copperBefore);
    expect(chest.templateId).toBe(HOARD_REWARD_CHEST_OPEN_TEMPLATE);
    // Nothing left for anyone: it is no longer an interact target.
    expect(chest.lootable).toBe(false);

    openHoardRewardChest(sim.ctx, chest.id, sim.player.id);
    expect(paid(sim.drainEvents())).toBe(0);
  });

  it('opens from the interact key and from a click: both reach the sim as pickUpObject', () => {
    // The client never calls the sim's interact() for an object: the F key
    // (src/game/nearby_interaction.ts) and a click (src/game/interactions.ts)
    // both send pickUpObject, offline and over the wire. A chest that only
    // answered interact() looked fine in a test and could not be opened in game.
    const { sim, inst, boss } = makeHoard();
    killBoss(sim, boss);
    const chest = chestOf(sim, inst);
    if (!chest) throw new Error('no chest');
    sim.player.pos = { ...chest.pos, z: chest.pos.z - 2.5 };
    sim.player.targetId = null;
    expect(sim.pickUpObject(chest.id, sim.player.id)).toBe(true);
    expect(paid(sim.drainEvents())).toBe(1);
    expect(chest.templateId).toBe(HOARD_REWARD_CHEST_OPEN_TEMPLATE);
  });

  it('settles an unopened share when its owner leaves, so walking out costs nothing', () => {
    const { sim, inst, boss } = makeHoard();
    killBoss(sim, boss);
    expect(inst.vault?.chest?.claimed).toEqual([]);
    sim.leaveRift(sim.player.id);
    const events = sim.drainEvents();
    expect(paid(events)).toBe(1);
    // ...and never twice.
    clearHoardRewardChest(sim.ctx, inst);
    expect(paid(sim.drainEvents())).toBe(0);
  });

  it('settles everyone and removes the chest when the hoard is torn down', () => {
    const { sim, inst, boss } = makeHoard();
    killBoss(sim, boss);
    const chestId = inst.vault?.chest?.entityId ?? -1;
    sim.player.targetId = chestId;
    clearHoardRewardChest(sim.ctx, inst);
    expect(paid(sim.drainEvents())).toBe(1);
    expect(sim.entities.has(chestId)).toBe(false);
    expect(inst.vault?.chest).toBeUndefined();
    expect(sim.player.targetId).toBeNull();
  });

  it('never appears in an ordinary rift', () => {
    const sim = new Sim({ seed: 5, playerClass: 'warrior', devCommands: true });
    sim.chat('/dev level 20', sim.player.id);
    sim.enterRift(424242, 20, sim.player.id);
    const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null);
    if (!inst) throw new Error('missing rift');
    spawnHoardRewardChest(sim.ctx, inst, [sim.player.id], { x: 0, z: 0 });
    expect(inst.vault).toBeNull();
    expect(
      [...sim.entities.values()].some((e) => e.templateId === HOARD_REWARD_CHEST_TEMPLATE),
    ).toBe(false);
  });
});
