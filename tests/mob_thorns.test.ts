// Innate "spiked hide" mobs (bristleback boars) reflect flat damage onto
// anyone who melees them — the mob-side analogue of the druid Thorns aura.
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
}

// drop a fresh mob of `templateId` right next to the player and register it
function spawnMob(sim: Sim, templateId: string, level: number): Entity {
  const tpl = MOBS[templateId];
  const id = (sim as any).nextId++;
  const mob = createMob(id, tpl, level, { x: 1, y: 0, z: 0 });
  mob.maxHp = 100000; // survive the scripted swings (death wipes state)
  mob.hp = mob.maxHp;
  sim.entities.set(id, mob);
  return mob;
}

// swing the player at the mob until `n` swings connect (ignoring miss/dodge)
function connectSwings(sim: Sim, attacker: Entity, target: Entity, n: number) {
  let landed = 0;
  for (let i = 0; i < n * 20 && landed < n; i++) {
    if ((sim as any).meleeSwing(attacker, target, 0, null, {})) landed++;
  }
  return landed;
}

describe('innate mob thorns (Bristled Hide)', () => {
  it('reflects flat damage onto a player who melees a wild boar', () => {
    const sim = makeSim();
    const player = sim.player;
    player.maxHp = 100000;
    player.hp = player.maxHp;
    const boar = spawnMob(sim, 'wild_boar', 3);

    const before = player.hp;
    const landed = connectSwings(sim, player, boar, 10);

    expect(landed).toBe(10);
    // wild_boar reflects 2 per connecting swing
    expect(before - player.hp).toBe(landed * MOBS.wild_boar.thorns!.value!);
  });

  it('a mob without the trait reflects nothing', () => {
    const sim = makeSim();
    const player = sim.player;
    player.maxHp = 100000;
    player.hp = player.maxHp;
    const wolf = spawnMob(sim, 'forest_wolf', 2);
    expect(MOBS.forest_wolf.thorns).toBeUndefined();

    const before = player.hp;
    const landed = connectSwings(sim, player, wolf, 10);

    expect(landed).toBe(10);
    expect(player.hp).toBe(before);
  });
});
