// An authored-immobile mob (moveSpeed 0: the Broodmother egg clutch) that is
// shoved off its spawn point and then enters the evade state could never walk
// home: a zero step never arrives, so the egg stayed in 'evade' forever and every
// hit on it reported Evade (the "invincible Broodmother Egg" report). The evade
// arm now snaps an immobile mob back onto its spawn point and runs the shared
// reset, so the clutch is attackable again on the very next tick.
import { describe, expect, it } from 'vitest';
import { dealDamage } from '../src/sim/combat/damage';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { immobileEvadeSnapsHome } from '../src/sim/mob/immobile_evade';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { placePlayerInOpenField } from './helpers/open_field';

const QUEST = 'q_broodmother';

function questerSim(): { sim: Sim; p: Entity; meta: PlayerMeta } {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(12);
  placePlayerInOpenField(sim);
  const p = sim.player;
  const meta = sim.players.get(p.id);
  if (!meta) throw new Error('test player metadata missing');
  meta.questLog.set(QUEST, { questId: QUEST, counts: [0, 0], state: 'active' });
  return { sim, p, meta };
}

function spawnEgg(sim: Sim, p: Entity): Entity {
  const egg = createMob(sim.nextId++, MOBS.spider_egg, 10, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 2,
  });
  egg.hostile = true;
  egg.aiState = 'idle';
  sim.addEntity(egg);
  return egg;
}

describe('immobile mob evade (the invincible Broodmother Egg)', () => {
  it('an egg shoved off its spawn point recovers from evade and takes damage again', () => {
    const { sim, p } = questerSim();
    const egg = spawnEgg(sim, p);
    expect(MOBS.spider_egg.moveSpeed).toBe(0);
    // A quester's hit pulls the egg into combat; a shove (aoeKnockback) leaves
    // it a yard off its spawn point.
    dealDamage(sim.ctx, p, egg, 10, false, 'physical', 'Heroic Strike', 'hit');
    expect(egg.aiState).toBe('chase');
    egg.pos.x += 1;
    // The quester runs off: the egg's hate table empties and it evades home.
    p.pos.x += 300;
    for (let i = 0; i < 20 * 30; i++) sim.tick();
    expect(egg.aiState).toBe('idle');
    expect(egg.pos.x).toBe(egg.spawnPos.x);
    expect(egg.pos.z).toBe(egg.spawnPos.z);
    expect(egg.hp).toBe(egg.maxHp);
    // Back on the quest: the clutch takes damage again instead of an Evade.
    p.pos.x -= 300;
    expect(dealDamage(sim.ctx, p, egg, 10, false, 'physical', 'Heroic Strike', 'hit')).toBe(10);
    expect(egg.hp).toBe(egg.maxHp - 10);
  });

  it('an evading egg that is exactly on its spawn point still resets (unchanged)', () => {
    const { sim, p } = questerSim();
    const egg = spawnEgg(sim, p);
    dealDamage(sim.ctx, p, egg, 10, false, 'physical', 'Heroic Strike', 'hit');
    p.pos.x += 300;
    for (let i = 0; i < 20 * 30; i++) sim.tick();
    expect(egg.aiState).toBe('idle');
    expect(egg.hp).toBe(egg.maxHp);
  });

  it('a mobile mob is not snapped: it still walks home', () => {
    const wolf = createMob(1, MOBS.forest_wolf, 5, { x: 0, y: 0, z: 0 });
    wolf.pos.x = 5;
    expect(immobileEvadeSnapsHome(wolf)).toBe(false);
    expect(wolf.pos.x).toBe(5);
  });

  it('the pure snap puts an immobile mob back on its spawn point', () => {
    const egg = createMob(2, MOBS.spider_egg, 10, { x: 3, y: 1, z: 4 });
    egg.pos.x = 4.5;
    egg.pos.z = 2;
    expect(immobileEvadeSnapsHome(egg)).toBe(true);
    expect(egg.pos).toEqual(egg.spawnPos);
    expect(egg.pos).not.toBe(egg.spawnPos); // a copy, never the shared object
  });
});
