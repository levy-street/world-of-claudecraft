import { describe, expect, it, vi } from 'vitest';
import { applyOrDetonateOssuaryMark, recordOssuaryMarkDamage } from '../src/sim/combat/necromancy';
import { TRINKET_AURA, trinketCooldownKey } from '../src/sim/content/trinkets';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { respawnMob } from '../src/sim/mob/lifecycle';
import { Sim } from '../src/sim/sim';
import { EMPTY_TEST_WORLD } from './sim_shared';

function bossParty(playerClass: 'mage' | 'warlock' = 'mage') {
  const sim = new Sim({ seed: 42, playerClass, world: EMPTY_TEST_WORLD });
  sim.setPlayerLevel(20);
  const player = sim.player;
  const allyId = sim.addPlayer('warlock', 'Ally');
  sim.setPlayerLevel(20, allyId);
  const ally = sim.entities.get(allyId)!;
  ally.pos = { ...player.pos };
  sim.partyInvite(allyId, player.id);
  sim.partyAccept(allyId);
  expect(sim.partyOf(player.id)?.members).toHaveLength(2);
  const template = MOBS.nythraxis_scourge_of_thornpeak;
  const boss = createMob(sim.ctx.nextId++, template, template.maxLevel, {
    x: player.pos.x + 3,
    y: player.pos.y,
    z: player.pos.z,
  });
  sim.ctx.addEntity(boss);
  boss.tappedById = player.id;
  boss.hp = 100;
  sim.drainEvents();
  return { sim, player, ally, boss };
}

describe('combat death rewards settle once per life', () => {
  it.each([
    { hit: 100, finishingHit: 'original spell' },
    { hit: 80, finishingHit: 'Echoing Lens' },
  ])('rolls each party member once when $finishingHit kills the boss', ({ hit }) => {
    const { sim, player, ally, boss } = bossParty();
    sim.addItem('echoing_lens', 1);
    sim.equipItem('echoing_lens');
    sim.player.cooldowns.delete(trinketCooldownKey('echoing_lens'));
    sim.useItem('echoing_lens');
    expect(player.auras.some((aura) => aura.id === TRINKET_AURA.echo)).toBe(true);
    sim.drainEvents();
    const chance = vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(false);
    const loot = vi.spyOn(sim.ctx, 'rollLoot');

    sim.ctx.dealDamage(player, boss, hit, false, 'arcane', 'Arcane Blast', 'hit');

    const events = sim.drainEvents();
    expect(boss.dead).toBe(true);
    expect(
      events.some((event) => event.type === 'damage' && event.ability === 'Echoing Lens'),
    ).toBe(true);
    expect(
      events.filter((event) => event.type === 'death' && event.entityId === boss.id),
    ).toHaveLength(1);
    expect(loot).toHaveBeenCalledTimes(1);
    expect(sim.players.get(player.id)!.counters.kills).toBe(1);
    // Other loot chances share the RNG; 0.005 is the normal Crystal Lich roll.
    expect(chance.mock.calls.filter(([probability]) => probability === 0.005)).toHaveLength(2);
    expect(sim.players.get(player.id)!.buddies.pending).toEqual([]);
    expect(sim.players.get(ally.id)!.buddies.pending).toEqual([]);
  });

  it('settles the boss once when another marked death bursts back into its death hooks', () => {
    const { sim, player, ally, boss } = bossParty('warlock');
    sim.setSpec('demonology', player.id);
    sim.setSpec('demonology', ally.id);
    const nearby = createMob(sim.ctx.nextId++, MOBS.forest_wolf, 20, {
      ...boss.pos,
      x: boss.pos.x + 2,
    });
    sim.ctx.addEntity(nearby);
    nearby.hp = 100;
    nearby.tappedById = ally.id;
    for (const [owner, target] of [
      [player, boss],
      [ally, nearby],
    ]) {
      applyOrDetonateOssuaryMark(sim.ctx, owner, target, 15, 0.2, 0.5, 6);
      recordOssuaryMarkDamage(owner, target, 1000, null);
    }
    const chance = vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(false);
    const loot = vi.spyOn(sim.ctx, 'rollLoot');
    sim.drainEvents();

    sim.ctx.dealDamage(player, boss, 100, false, 'physical', null, 'hit');

    const events = sim.drainEvents();
    for (const target of [boss, nearby]) {
      expect(target.dead).toBe(true);
      expect(
        events.filter((event) => event.type === 'death' && event.entityId === target.id),
      ).toHaveLength(1);
      expect(loot.mock.calls.filter(([corpse]) => corpse.id === target.id)).toHaveLength(1);
    }
    expect(chance.mock.calls.filter(([probability]) => probability === 0.005)).toHaveLength(2);
  });

  it('ignores another death call for a corpse but pays again after a real respawn', () => {
    const { sim, player, boss } = bossParty();
    const chance = vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(false);
    const loot = vi.spyOn(sim.ctx, 'rollLoot');
    sim.ctx.dealDamage(player, boss, 100, false, 'physical', null, 'hit');
    sim.drainEvents();
    const draws = chance.mock.calls.length;

    sim.ctx.handleDeath(boss, player);

    expect(sim.drainEvents()).toEqual([]);
    expect(chance).toHaveBeenCalledTimes(draws);
    expect(loot).toHaveBeenCalledTimes(1);
    respawnMob(sim.ctx, boss);
    expect(boss.dead).toBe(false);
    boss.hp = 100;
    boss.tappedById = player.id;
    sim.ctx.dealDamage(player, boss, 100, false, 'physical', null, 'hit');
    expect(loot).toHaveBeenCalledTimes(2);
    expect(sim.players.get(player.id)!.counters.kills).toBe(2);
    expect(chance.mock.calls.filter(([probability]) => probability === 0.005)).toHaveLength(4);
  });
});
