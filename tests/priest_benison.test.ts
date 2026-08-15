import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type DealDamage = (
  source: Entity | null,
  target: Entity,
  amount: number,
  crit: boolean,
  school: string,
  ability: string | null,
  kind: 'hit' | 'miss' | 'dodge',
) => void;

function benisonPriest(): { sim: Sim; priest: Entity } {
  const sim = new Sim({ seed: 2802, playerClass: 'priest', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('holy')).toBe(true);
  sim.tick();
  sim.player.resource = sim.player.maxResource;
  return { sim, priest: sim.player };
}

function addAlly(sim: Sim, name: string, distance: number): Entity {
  const id = sim.addPlayer('warrior', name);
  sim.setPlayerLevel(20, id);
  const ally = sim.entities.get(id);
  if (!ally) throw new Error('ally missing');
  ally.pos.x = sim.player.pos.x + distance;
  ally.pos.z = sim.player.pos.z;
  return ally;
}

function castVigil(sim: Sim, priest: Entity, ally: Entity): void {
  priest.gcdRemaining = 0;
  priest.resource = priest.maxResource;
  priest.cooldowns.delete('seraphic_vigil');
  sim.targetEntity(ally.id, priest.id);
  sim.castAbility('seraphic_vigil', priest.id);
  sim.tick();
}

describe('Benison baseline loop', () => {
  it('pins Choirmend and Sunburst Canticle as group recovery spells', () => {
    expect(ABILITIES.prayer_of_healing.name).toBe('Choirmend');
    expect(ABILITIES.prayer_of_healing.castTime).toBe(3);
    expect(ABILITIES.prayer_of_healing.effects.some((effect) => effect.type === 'aoeHeal')).toBe(
      true,
    );
    expect(ABILITIES.holy_nova.name).toBe('Sunburst Canticle');
    expect(ABILITIES.holy_nova.castTime).toBe(0);
    expect(ABILITIES.holy_nova.effects.some((effect) => effect.type === 'aoeHeal')).toBe(true);
  });

  it('executes Choirmend as a committed cast and Sunburst as immediate recovery', () => {
    const { sim, priest } = benisonPriest();
    const ally = addAlly(sim, 'Choir Ally', 4);
    sim.partyInvite(ally.id, priest.id);
    sim.partyAccept(ally.id);
    ally.hp = Math.floor(ally.maxHp * 0.3);
    const beforeChoir = ally.hp;

    priest.gcdRemaining = 0;
    priest.resource = priest.maxResource;
    sim.castAbility('prayer_of_healing', priest.id);
    expect(priest.castingAbility).toBe('prayer_of_healing');
    for (let tick = 0; tick < 61; tick++) sim.tick();
    expect(ally.hp).toBeGreaterThan(beforeChoir);

    ally.hp = Math.floor(ally.maxHp * 0.3);
    const beforeSunburst = ally.hp;
    priest.gcdRemaining = 0;
    priest.resource = priest.maxResource;
    sim.castAbility('holy_nova', priest.id);
    expect(priest.castingAbility).toBeNull();
    expect(ally.hp).toBeGreaterThan(beforeSunburst);
  });

  it('moves one source-owned Seraphic Vigil between allies', () => {
    const { sim, priest } = benisonPriest();
    const first = addAlly(sim, 'First Vigil', 4);
    const second = addAlly(sim, 'Second Vigil', 6);

    castVigil(sim, priest, first);
    expect(first.auras.some((a) => a.id === 'seraphic_vigil' && a.sourceId === priest.id)).toBe(
      true,
    );

    castVigil(sim, priest, second);
    expect(first.auras.some((a) => a.id === 'seraphic_vigil' && a.sourceId === priest.id)).toBe(
      false,
    );
    expect(second.auras.some((a) => a.id === 'seraphic_vigil' && a.sourceId === priest.id)).toBe(
      true,
    );
  });

  it('consumes Vigil to restore an ally who crosses its unsafe threshold', () => {
    const { sim, priest } = benisonPriest();
    const ally = addAlly(sim, 'Watched Ally', 4);
    castVigil(sim, priest, ally);
    ally.hp = Math.ceil(ally.maxHp * 0.36);
    const before = ally.hp;

    (sim as unknown as { dealDamage: DealDamage }).dealDamage(
      priest,
      ally,
      Math.ceil(ally.maxHp * 0.03),
      false,
      'shadow',
      'Test Hit',
      'hit',
    );

    expect(ally.hp).toBeGreaterThan(before);
    expect(ally.auras.some((a) => a.id === 'seraphic_vigil' && a.sourceId === priest.id)).toBe(
      false,
    );

    const afterTrigger = ally.hp;
    (sim as unknown as { dealDamage: DealDamage }).dealDamage(
      priest,
      ally,
      1,
      false,
      'shadow',
      'Second Test Hit',
      'hit',
    );
    expect(ally.hp).toBe(afterTrigger - 1);
  });

  it('bases Living Covenant on the resolved critical heal, not the raw roll', () => {
    const sim = new Sim({ seed: 2812, playerClass: 'priest', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: 'holy', rows: { 14: 'pri_r14_pain_and_suffering' } })).toBe(
      true,
    );
    sim.tick();
    const priest = sim.player;
    const ally = addAlly(sim, 'Resolved Overheal', 4);
    sim.partyInvite(ally.id, priest.id);
    sim.partyAccept(ally.id);
    priest.spellPower = 0;
    priest.auras.push({
      id: 'test_guaranteed_spell_crit',
      name: 'Guaranteed spell crit',
      kind: 'buff_spellcrit',
      remaining: 10,
      duration: 10,
      value: 1,
      sourceId: priest.id,
      school: 'holy',
    });
    ally.maxHp = 5_000;
    ally.hp = ally.maxHp - 1;

    priest.gcdRemaining = 0;
    priest.resource = priest.maxResource;
    sim.castAbility('prayer_of_healing', priest.id);
    for (let tick = 0; tick < 61; tick++) sim.tick();

    const covenant = ally.auras.find((aura) => aura.id === 'priest_living_covenant');
    expect(covenant?.value).toBeGreaterThanOrEqual(149);
  });

  it('replays the same Vigil trigger state and event stream for the same seed', () => {
    const run = () => {
      const { sim, priest } = benisonPriest();
      const ally = addAlly(sim, 'Repeat Vigil', 4);
      castVigil(sim, priest, ally);
      ally.hp = Math.ceil(ally.maxHp * 0.36);
      sim.drainEvents();
      (sim as unknown as { dealDamage: DealDamage }).dealDamage(
        priest,
        ally,
        Math.ceil(ally.maxHp * 0.03),
        false,
        'shadow',
        'Repeat Hit',
        'hit',
      );
      return { hp: ally.hp, auras: ally.auras, events: sim.drainEvents() };
    };

    expect(run()).toEqual(run());
  });
});
