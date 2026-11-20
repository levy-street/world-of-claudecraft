// Player attack range counts height. A target on a roof straight above you is
// as far away as it looks: before this, range was measured on the ground plane
// only, so a player standing 3 yd out on the street could swing at someone on
// the rooftop over them.
import { describe, expect, it } from 'vitest';
import { startAutoAttack, updatePlayerAutoAttack } from '../src/sim/combat/auto_attack';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { dist2d, dist3d, MELEE_RANGE } from '../src/sim/types';

function wolfAbove(ground: number, height: number) {
  const sim = new Sim({ seed: 771, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  sim.setSpec('arms');
  const player = sim.player;
  const meta = sim.players.get(player.id);
  if (!meta) throw new Error('Warrior metadata missing');
  player.resource = player.maxResource;
  const wolf = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: player.pos.x,
    y: player.pos.y + height,
    z: player.pos.z + ground,
  });
  wolf.maxHp = 1_000_000;
  wolf.hp = wolf.maxHp;
  wolf.stats = { ...wolf.stats, armor: 0 };
  sim.addEntity(wolf);
  sim.targetEntity(wolf.id, player.id);
  return { sim, player, meta, wolf };
}

describe('attack range counts height', () => {
  it('dist3d measures the straight line, dist2d only the ground', () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 3, y: 4, z: 0 };
    expect(dist2d(a, b)).toBe(3);
    expect(dist3d(a, b)).toBe(5);
  });

  it('a target 3 yd out on the ground but 6 yd up is out of melee range', () => {
    const { sim, player, meta, wolf } = wolfAbove(3, 6);
    expect(dist2d(player.pos, wolf.pos)).toBeLessThan(MELEE_RANGE);

    startAutoAttack(sim.ctx, player.id);
    player.swingTimer = 0;
    updatePlayerAutoAttack(sim.ctx, player, meta);
    expect(wolf.aggroTargetId).toBeNull();
    expect(wolf.hp).toBe(wolf.maxHp);

    sim.castAbility('mortal_strike', player.id);
    expect(player.cooldowns.has('mortal_strike')).toBe(false);
    expect(wolf.hp).toBe(wolf.maxHp);
  });

  it('a small height gap inside melee range still lands', () => {
    const { sim, player, meta, wolf } = wolfAbove(3, 1);

    startAutoAttack(sim.ctx, player.id);
    expect(wolf.aggroTargetId).toBe(player.id);
    player.swingTimer = 0;
    for (let attempt = 0; attempt < 20 && wolf.hp === wolf.maxHp; attempt++) {
      updatePlayerAutoAttack(sim.ctx, player, meta);
      player.swingTimer = 0;
    }
    expect(wolf.hp).toBeLessThan(wolf.maxHp);
  });
});
