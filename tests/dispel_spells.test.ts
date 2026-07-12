// Choice-row dispel spells (Talents 2.0 counterplay): Cleansing Verdict (paladin) purges
// a harmful magic debuff off an ally and heals; Voidfeast (warlock) devours a beneficial
// magic buff off an enemy and heals the caster. Physical auras are never dispellable.
import { describe, expect, it } from 'vitest';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

function magicDebuff(sourceId: number): Aura {
  return {
    id: 'test_curse',
    name: 'Test Curse',
    kind: 'slow',
    remaining: 30,
    duration: 30,
    value: 0.5,
    sourceId,
    school: 'shadow',
  } as Aura;
}
function magicBuff(sourceId: number): Aura {
  return {
    id: 'test_blessing',
    name: 'Test Blessing',
    kind: 'buff_spellpower',
    remaining: 30,
    duration: 30,
    value: 40,
    sourceId,
    school: 'holy',
  } as Aura;
}

function resolve(sim: Sim, target: Entity, abilityId: string): void {
  const p = sim.entities.get(sim.playerId) as Entity;
  const meta = (sim as unknown as { players: Map<number, unknown> }).players.get(sim.playerId);
  // These spells are only known via a choice-row pick; build a ResolvedAbility straight
  // from the def so the test drives runEffects without allocating the row.
  const def = ABILITIES[abilityId];
  const res = {
    def,
    rank: 1,
    cost: def.cost,
    castTime: def.castTime,
    cooldown: def.cooldown,
    effects: def.effects,
    threatFlat: 0,
    threatMult: 1,
  };
  (
    sim as unknown as {
      ctx: { runEffects(p: Entity, meta: unknown, target: Entity, res: unknown): void };
    }
  ).ctx.runEffects(p, meta, target, res);
}

describe('choice-row dispel spells', () => {
  it("Cleansing Verdict purges an ally's magic debuff and heals them", () => {
    const sim = new Sim({ seed: 1, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    // A friendly pet-like ally (players are hard to make friendly without a party); use a
    // mob flagged non-hostile so isHostileTo(caster, ally) is false -> defensive dispel.
    const ally = createMob(
      (sim as unknown as { nextId: number }).nextId++,
      MOBS.ridge_stalker,
      20,
      {
        x: sim.player.pos.x,
        y: sim.player.pos.y,
        z: sim.player.pos.z + 2,
      },
    );
    ally.hostile = false;
    ally.maxHp = 1000;
    ally.hp = 500;
    ally.auras.push(magicDebuff(999));
    // Also a physical debuff that must NOT be dispelled.
    ally.auras.push({
      ...magicDebuff(999),
      id: 'bleed',
      name: 'Bleed',
      school: 'physical',
    } as Aura);
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(ally);

    resolve(sim, ally, 'cleansing_verdict');

    expect(ally.auras.some((a) => a.id === 'test_curse')).toBe(false); // magic debuff purged
    expect(ally.auras.some((a) => a.id === 'bleed')).toBe(true); // physical stays
    expect(ally.hp).toBeGreaterThan(500); // healed
  });

  it("Voidfeast devours an enemy's magic buff and heals the caster", () => {
    const sim = new Sim({ seed: 2, playerClass: 'warlock', autoEquip: true });
    sim.setPlayerLevel(20);
    const p = sim.entities.get(sim.playerId) as Entity;
    p.hp = Math.round(p.maxHp * 0.5);
    const enemy = createMob(
      (sim as unknown as { nextId: number }).nextId++,
      MOBS.ridge_stalker,
      20,
      {
        x: p.pos.x,
        y: p.pos.y,
        z: p.pos.z + 2,
      },
    );
    enemy.hostile = true;
    enemy.auras.push(magicBuff(enemy.id));
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(enemy);

    const hpBefore = p.hp;
    resolve(sim, enemy, 'voidfeast');

    expect(enemy.auras.some((a) => a.id === 'test_blessing')).toBe(false); // buff devoured
    expect(p.hp).toBeGreaterThan(hpBefore); // caster healed
  });

  it("Spellsteal takes an enemy's magic buff and transfers it to the caster", () => {
    const sim = new Sim({ seed: 3, playerClass: 'mage', autoEquip: true });
    sim.setPlayerLevel(20);
    const p = sim.entities.get(sim.playerId) as Entity;
    const enemy = createMob(
      (sim as unknown as { nextId: number }).nextId++,
      MOBS.ridge_stalker,
      20,
      {
        x: p.pos.x,
        y: p.pos.y,
        z: p.pos.z + 2,
      },
    );
    enemy.hostile = true;
    enemy.auras.push(magicBuff(enemy.id));
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(enemy);

    resolve(sim, enemy, 'spellsteal');

    expect(enemy.auras.some((a) => a.id === 'test_blessing')).toBe(false); // stripped off enemy
    const stolen = p.auras.find((a) => a.id === 'test_blessing');
    expect(stolen).toBeTruthy(); // re-applied to the caster
    expect(stolen?.sourceId).toBe(p.id); // now owned by the mage
  });

  it('the paladin and warlock level-8 rows offer the dispel spell, not an interrupt', () => {
    const pal = CHOICE_ROWS.paladin.rows.find((r) => r.level === 8);
    const wlk = CHOICE_ROWS.warlock.rows.find((r) => r.level === 8);
    const mag = CHOICE_ROWS.mage.rows.find((r) => r.level === 8);
    expect(pal?.options.some((o) => o.effect.grant?.ability === 'cleansing_verdict')).toBe(true);
    expect(pal?.options.some((o) => o.effect.grant?.ability === 'rebuke')).toBe(false);
    expect(wlk?.options.some((o) => o.effect.grant?.ability === 'voidfeast')).toBe(true);
    expect(wlk?.options.some((o) => o.effect.grant?.ability === 'spell_lock')).toBe(false);
    expect(mag?.options.some((o) => o.effect.grant?.ability === 'spellsteal')).toBe(true);
    expect(mag?.options.some((o) => o.effect.grant?.ability === 'counterspell')).toBe(false);
  });
});
