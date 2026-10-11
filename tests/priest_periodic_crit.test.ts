import { describe, expect, it } from 'vitest';
import { shadowPeriodicHit } from '../src/sim/combat/priest/periodic_crit';
import { bindEffigy } from '../src/sim/combat/priest/vespers';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { SimEvent } from '../src/sim/types';

function fixture(spec = 'shadow', chance = 1) {
  const sim = new Sim({ seed: 2803, playerClass: 'priest', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec(spec)).toBe(true);
  const ctx = (sim as unknown as { ctx: SimContext }).ctx;
  for (const entity of [...sim.entities.values()]) {
    if (entity.id !== sim.playerId) ctx.dropEntity(entity.id);
  }
  sim.tick();
  const p = sim.player;
  p.hitBonus = 1;
  p.resource = p.maxResource;
  ctx.spellCrit = () => chance;
  const target = createMob(9900, MOBS.training_dummy, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 8,
  });
  target.hostile = true;
  target.maxHp = target.hp = 100000;
  ctx.addEntity(target);
  sim.targetEntity(target.id);
  return { sim, ctx, p, target };
}

const damageEvents = (events: SimEvent[], name: string) =>
  events.filter((event) => event.type === 'damage' && event.ability === name);

describe('Shadow periodic critical strikes', () => {
  it.each(['shadow_word_pain', 'mind_flay'])(
    'uses spell critical chance and damage bonus for %s',
    (id) => {
      const { ctx, p } = fixture();
      p.critDmgSpellBonus = 0.25;
      expect(shadowPeriodicHit(ctx, p, id, 100)).toEqual({ amount: 175, crit: true });
      ctx.spellCrit = () => 0;
      expect(shadowPeriodicHit(ctx, p, id, 100)).toEqual({ amount: 100, crit: false });
    },
  );

  it('keeps unrelated spells, other specs, missing sources, and guardians out of its RNG stream', () => {
    const { ctx, p, target } = fixture();
    const rng = new Rng(123);
    const control = new Rng(123);
    const gatedCtx = { ...ctx, rng } as SimContext;
    expect(shadowPeriodicHit(gatedCtx, p, 'drain_life', 100).crit).toBe(false);
    expect(shadowPeriodicHit(gatedCtx, target, 'shadow_word_pain', 100).crit).toBe(false);
    expect(shadowPeriodicHit(gatedCtx, { ...p, kind: 'mob' }, 'shadow_word_pain', 100).crit).toBe(
      false,
    );
    expect(shadowPeriodicHit(gatedCtx, null, 'mind_flay', 100).crit).toBe(false);
    expect(shadowPeriodicHit(gatedCtx, p, 'shadow_word_pain', 0)).toEqual({
      amount: 0,
      crit: false,
    });
    const withoutMeta = { ...gatedCtx, players: new Map() } as SimContext;
    expect(shadowPeriodicHit(withoutMeta, p, 'shadow_word_pain', 100).crit).toBe(false);
    const meta = ctx.players.get(p.id);
    if (!meta) throw new Error('Missing priest metadata');
    meta.cls = 'warlock';
    expect(shadowPeriodicHit(gatedCtx, p, 'shadow_word_pain', 100).crit).toBe(false);
    meta.cls = 'priest';
    meta.talents.spec = 'holy';
    expect(shadowPeriodicHit(gatedCtx, p, 'shadow_word_pain', 100).crit).toBe(false);
    expect(rng.range(0, 1)).toBe(control.range(0, 1));
  });

  it('lets Dirge crit without changing its stored tick or granting extra Gloomtithe', () => {
    const { sim, ctx, p, target } = fixture();
    sim.castAbility('shadow_word_pain');
    for (let tick = 0; tick < 30; tick++) sim.tick();
    expect(bindEffigy(ctx, p, target)).toBe(true);
    const dot = target.auras.find((aura) => aura.id === 'shadow_word_pain');
    if (!dot) throw new Error('Dirge did not land');
    dot.value = 100;
    const events = Array.from({ length: 60 }, () => sim.tick()).flat();
    const hits = damageEvents(events, 'Dirge of Decay');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sourceId: p.id, targetId: target.id, crit: true, amount: 150 });
    expect(dot.value).toBe(100);
    expect(p.auras.find((aura) => aura.kind === 'gloomtithe')?.stacks).toBe(1);
  });

  it('uses the caster current crit chance on each Dirge tick without compounding damage', () => {
    const { sim, ctx, target } = fixture('shadow', 0);
    sim.castAbility('shadow_word_pain');
    for (let tick = 0; tick < 30; tick++) sim.tick();
    const dot = target.auras.find((aura) => aura.id === 'shadow_word_pain');
    if (!dot) throw new Error('Dirge did not land');
    dot.value = 100;
    const regular = damageEvents(
      Array.from({ length: 60 }, () => sim.tick()).flat(),
      'Dirge of Decay',
    );
    expect(regular).toHaveLength(1);
    expect(regular[0]).toMatchObject({ amount: 100, crit: false });
    ctx.spellCrit = () => 1;
    for (let pulse = 0; pulse < 2; pulse++) {
      const critical = damageEvents(
        Array.from({ length: 60 }, () => sim.tick()).flat(),
        'Dirge of Decay',
      );
      expect(critical).toHaveLength(1);
      expect(critical[0]).toMatchObject({ amount: 150, crit: true });
      expect(dot.value).toBe(100);
    }
  });

  it.each([0, 100])(
    'allows all Litany ticks to crit at %s Spell Power with normal spell scaling',
    (power) => {
      function channel(chance: number) {
        const { sim, p } = fixture('shadow', chance);
        p.spellPower = power;
        sim.castAbility('mind_flay');
        return damageEvents(Array.from({ length: 100 }, () => sim.tick()).flat(), 'Litany of Woe');
      }
      const regular = channel(0);
      const critical = channel(1);
      expect(regular).toHaveLength(3);
      expect(critical).toHaveLength(3);
      for (let index = 0; index < 3; index++) {
        expect(regular[index]).toMatchObject({ crit: false, amount: power === 0 ? 17 : 57 });
        expect(critical[index]).toMatchObject({
          crit: true,
          amount: Math.round((regular[index] as { amount: number }).amount * 1.5),
        });
      }
    },
  );

  it.each(['holy', 'discipline'])('preserves noncritical Dirge and Litany for %s', (spec) => {
    const { sim } = fixture(spec);
    sim.castAbility('shadow_word_pain');
    for (let tick = 0; tick < 35; tick++) sim.tick();
    sim.castAbility('mind_flay');
    const events = Array.from({ length: 100 }, () => sim.tick()).flat();
    for (const name of ['Dirge of Decay', 'Litany of Woe']) {
      const hits = damageEvents(events, name);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((hit) => (hit as { crit: boolean }).crit === false)).toBe(true);
    }
  });
});
