import { describe, expect, it } from 'vitest';
import { SPIRIT_BOMB_PROGRESS_ID } from '../src/sim/combat/priest/spirit_bomb';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';

describe('Measured Faith with Vampiric Touch', () => {
  it('counts accepted VT casts, discounts the next VT, and does not generate bomb charges', () => {
    const sim = new Sim({ seed: 2814, playerClass: 'priest', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: 'shadow', rows: { 14: 'pri_r11_meditation' } })).toBe(true);
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    for (const entity of [...sim.entities.values()]) {
      if (entity.id !== sim.playerId) ctx.dropEntity(entity.id);
    }
    sim.tick();
    const p = sim.player;
    p.hitBonus = 1;
    ctx.spellCrit = () => 0;
    ctx.lineOfSightBlocked = () => false;
    const target = createMob(9900, MOBS.training_dummy, 20, { ...p.pos, z: p.pos.z + 20 });
    target.hostile = true;
    target.maxHp = target.hp = 100000;
    ctx.addEntity(target);
    sim.targetEntity(target.id);
    for (let cast = 0; cast < 3; cast++) {
      p.gcdRemaining = 0;
      p.resource = p.maxResource;
      const before = p.resource;
      sim.castAbility('vampiric_touch');
      for (let tick = 0; tick < 32; tick++) sim.tick();
      expect(before - p.resource).toBe(60);
      expect(target.auras.some((aura) => aura.id === 'vampiric_touch')).toBe(true);
      if (cast < 2) expect(p.auras.some((aura) => aura.id === 'pri_measured_faith')).toBe(false);
    }
    expect(p.auras).toContainEqual(
      expect.objectContaining({ id: 'pri_measured_faith', kind: 'next_cast_cheap', value: 0.5 }),
    );
    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    const before = p.resource;
    sim.castAbility('vampiric_touch');
    for (let tick = 0; tick < 32; tick++) sim.tick();
    expect(before - p.resource).toBe(30);
    expect(p.auras.some((aura) => aura.id === 'pri_measured_faith')).toBe(false);
    expect(p.auras.some((aura) => aura.id === SPIRIT_BOMB_PROGRESS_ID)).toBe(false);
  });
});
