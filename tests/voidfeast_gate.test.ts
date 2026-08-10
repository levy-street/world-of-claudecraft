import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function setup(): { sim: Sim; player: Entity; mob: Entity } {
  const sim = new Sim({ seed: 7, playerClass: 'warlock', autoEquip: true });
  sim.setPlayerLevel(8);
  expect(sim.applyTalents({ spec: null, rows: { 8: 'wlk_r8_voidfeast' } })).toBe(true);
  const player = sim.player;
  const mob = createMob(20_000, MOBS.forest_wolf, 8, {
    x: player.pos.x + 3,
    y: player.pos.y,
    z: player.pos.z,
  });
  mob.hostile = true;
  mob.aiState = 'idle';
  mob.maxHp = 100_000;
  mob.hp = mob.maxHp;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  player.facing = Math.atan2(mob.pos.x - player.pos.x, mob.pos.z - player.pos.z);
  player.resource = player.maxResource;
  return { sim, player, mob };
}

describe('Abyssal Gag level 8 control choice', () => {
  it('unlocks the Warlock interrupt two levels early', () => {
    const untalented = new Sim({ seed: 7, playerClass: 'warlock', autoEquip: true });
    untalented.setPlayerLevel(8);
    expect(untalented.resolvedAbility('spell_lock')).toBeNull();

    const { sim } = setup();
    expect(sim.resolvedAbility('spell_lock')).not.toBeNull();
  });

  it('interrupts the current cast and applies both school lockout and full silence for 4 sec', () => {
    const { sim, player, mob } = setup();
    mob.castingAbility = 'fireball';
    mob.castRemaining = 2;
    mob.castTotal = 2;

    const ability = sim.resolvedAbility('spell_lock');
    const meta = (sim as unknown as { players: Map<number, unknown> }).players.get(player.id);
    expect(ability).not.toBeNull();
    sim.ctx.runEffects(player, meta as never, mob, ability as never);

    expect(mob.castingAbility).toBeNull();
    expect(mob.auras.find((aura) => aura.kind === 'lockout')).toMatchObject({
      remaining: 4,
    });
    expect(mob.auras.find((aura) => aura.kind === 'silence')).toMatchObject({
      remaining: 4,
    });
  });

  it('leaves the level 10 baseline interrupt as a school lockout without the talent silence', () => {
    const sim = new Sim({ seed: 8, playerClass: 'warlock', autoEquip: true });
    sim.setPlayerLevel(10);
    const ability = sim.resolvedAbility('spell_lock');

    expect(ability?.effects).toContainEqual({ type: 'interrupt', lockout: 4 });
    expect(ability?.effects.some((effect) => effect.type === 'silence')).toBe(false);
  });
});
