import { expect, it } from 'vitest';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { rollLoot } from '../src/sim/loot/loot_roll';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';

it('Nythraxis pays exactly two distinct equipment items on both difficulties', () => {
  const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('warrior', 'Raider');
  const meta = sim.ctx.players.get(pid)!;
  for (const heroic of [false, true]) {
    for (let seed = 0; seed < 100; seed++) {
      sim.rng = new Rng(seed);
      const mob = createMob(-1, MOBS.nythraxis_scourge_of_thornpeak, 20, { x: 0, y: 0, z: 0 });
      sim.ctx.instances.length = 0;
      if (heroic)
        sim.ctx.instances.push({
          id: -1,
          dungeonId: 'nythraxis_boss_arena',
          difficulty: 'heroic',
          partyKey: 'raid',
          mobIds: [mob.id],
        } as unknown as (typeof sim.ctx.instances)[number]);
      rollLoot(sim.ctx, mob, meta);
      const gear = (mob.loot?.items ?? []).filter((s) =>
        ['armor', 'weapon', 'held_offhand'].includes(ITEMS[s.itemId].kind),
      );
      expect(gear.length, `heroic=${heroic} seed=${seed}`).toBe(2);
      expect(new Set(gear.map((s) => s.itemId)).size).toBe(2);
      if (heroic) {
        const exclusives = HEROIC_BOSS_LOOT.nythraxis_scourge_of_thornpeak
          .filter((e) => e.rollGroup === 'nythraxis_heroic_weapon')
          .map((e) => e.itemId);
        expect(gear.filter((s) => exclusives.includes(s.itemId))).toHaveLength(1);
      }
    }
  }
});
