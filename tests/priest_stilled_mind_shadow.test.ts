import { describe, expect, it, vi } from 'vitest';
import { STILLED_MIND_CRIT_AURA_ID } from '../src/sim/combat/priest/stilled_mind';
import { addGloomtithe } from '../src/sim/combat/priest/vespers';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';

function fixture(spec: 'shadow' | 'holy' | 'discipline' = 'shadow', enabled = true) {
  const sim = new Sim({ seed: 2814, playerClass: 'priest', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: { 14: 'pri_r11_inner_focus' } })).toBe(true);
  const ctx = (sim as unknown as { ctx: SimContext }).ctx;
  for (const entity of [...sim.entities.values()]) {
    if (entity.id !== sim.playerId) ctx.dropEntity(entity.id);
  }
  sim.tick();
  const p = sim.player;
  p.hitBonus = 1;
  p.resource = p.maxResource;
  ctx.spellCrit = () => 0;
  ctx.lineOfSightBlocked = () => false;
  const target = createMob(9900, MOBS.training_dummy, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 20,
  });
  target.hostile = true;
  target.maxHp = target.hp = 100000;
  ctx.addEntity(target);
  sim.targetEntity(target.id);
  addGloomtithe(ctx, p, 5);
  if (enabled) sim.castAbility('inner_focus');
  p.gcdRemaining = 0;
  const events = vi.spyOn(ctx, 'emit');
  return { sim, ctx, p, target, events };
}
type Fixture = ReturnType<typeof fixture>;
function charge(f: Fixture) {
  return f.p.auras.find(
    (aura) => aura.id === STILLED_MIND_CRIT_AURA_ID && aura.sourceId === f.p.id,
  );
}
function cast(f: Fixture, id: string) {
  f.p.gcdRemaining = 0;
  f.sim.castAbility(id);
  for (let tick = 0; tick < 65; tick++) f.sim.tick();
  return f.events.mock.calls
    .map(([event]) => event)
    .find((event) => event.type === 'damage' && event.abilityId === id && event.kind === 'hit');
}

describe('Shadow Stilled Mind critical reservation', () => {
  it.each(['mind_blast', 'void_rupture'])(
    'guarantees only the next %s using normal critical damage',
    (id) => {
      const normal = fixture('shadow', false);
      const baseline = cast(normal, id);
      const empowered = fixture();
      const result = cast(empowered, id);
      expect(baseline).toMatchObject({ type: 'damage', crit: false });
      expect(result).toMatchObject({ type: 'damage', crit: true });
      if (baseline?.type !== 'damage' || result?.type !== 'damage') throw new Error('missing hits');
      expect(result.amount).toBeCloseTo(
        baseline.amount * (1.5 + empowered.p.critDmgSpellBonus),
        -1,
      );
      expect(charge(empowered)).toBeUndefined();
      if (id === 'void_rupture') {
        expect(empowered.p.auras.find((aura) => aura.kind === 'gloomtithe')?.stacks).toBe(2);
      }
      empowered.p.cooldowns.clear();
      addGloomtithe(empowered.ctx, empowered.p, 3);
      empowered.events.mockClear();
      expect(cast(empowered, id)).toMatchObject({ crit: false });
    },
  );

  it('preserves the critical charge after another spell spends the free mana and shield perks', () => {
    const f = fixture();
    f.p.resource = 0;
    f.sim.targetEntity(f.p.id);
    f.sim.castAbility('renew');
    expect(f.p.auras.some((aura) => aura.id === 'renew')).toBe(true);
    expect(f.p.resource).toBe(0);
    expect(f.p.auras.some((aura) => aura.id === 'inner_focus')).toBe(false);
    expect(charge(f)).toBeDefined();
    f.sim.targetEntity(f.target.id);
    expect(cast(f, 'void_rupture')).toMatchObject({ crit: true });
  });

  it.each(['holy', 'discipline'] as const)('adds no critical charge for %s', (spec) => {
    const f = fixture(spec);
    expect(charge(f)).toBeUndefined();
    expect(
      f.p.auras
        .filter((aura) => aura.id.startsWith('inner_focus'))
        .map((aura) => aura.kind)
        .sort(),
    ).toEqual(['cast_shield', 'next_cast_free']);
  });

  it('preserves the charge on failed admission and a cancelled Mindfracture', () => {
    const f = fixture();
    f.target.pos.z += 100;
    f.sim.castAbility('void_rupture');
    expect(charge(f)).toBeDefined();
    f.target.pos.z -= 100;
    f.sim.castAbility('mind_blast');
    expect(f.p.castingAbility).toBe('mind_blast');
    f.ctx.cancelCast(f.p);
    expect(charge(f)).toBeDefined();
  });

  it.each(['mind_blast', 'void_rupture'])('consumes the charge when %s is resisted', (id) => {
    const f = fixture();
    f.p.hitBonus = -10;
    expect(cast(f, id)).toBeUndefined();
    expect(f.target.hp).toBe(f.target.maxHp);
    expect(charge(f)).toBeUndefined();
    expect(
      f.events.mock.calls.some(([event]) => event.type === 'damage' && event.kind === 'resist'),
    ).toBe(true);
  });

  it('does not use expired or foreign critical charges', () => {
    const f = fixture();
    const own = charge(f)!;
    f.p.auras.unshift({ ...own, sourceId: 12345 });
    own.remaining = 0;
    expect(cast(f, 'void_rupture')).toMatchObject({ crit: false });
    expect(
      f.p.auras.some((aura) => aura.id === STILLED_MIND_CRIT_AURA_ID && aura.sourceId === 12345),
    ).toBe(true);
  });

  it('does not waive Rupture gem admission and expires after its own 60 second window', () => {
    const f = fixture();
    f.p.auras = f.p.auras.filter((aura) => aura.kind !== 'gloomtithe');
    f.sim.castAbility('void_rupture');
    expect(f.target.hp).toBe(f.target.maxHp);
    expect(f.p.gcdRemaining).toBe(0);
    expect(charge(f)).toBeDefined();
    for (let tick = 0; tick < 1201; tick++) f.sim.tick();
    expect(charge(f)).toBeUndefined();
    addGloomtithe(f.ctx, f.p, 3);
    expect(cast(f, 'void_rupture')).toMatchObject({ crit: false });
  });

  it('leaves Vampiric Touch gem empowerment unchanged without spending or extending the critical charge', () => {
    const f = fixture();
    const before = charge(f)!.remaining;
    cast(f, 'vampiric_touch');
    expect(f.target.auras.some((aura) => aura.id === 'vampiric_touch')).toBe(true);
    expect(f.p.auras.find((aura) => aura.kind === 'gloomtithe')?.stacks).toBe(3);
    expect(charge(f)?.remaining).toBeLessThan(before);
    expect(charge(f)?.remaining).toBeGreaterThan(55);
    expect(f.events.mock.calls.some(([event]) => event.type === 'damage' && event.crit)).toBe(
      false,
    );
  });

  it('clears the reserved critical charge when the talent is removed', () => {
    const f = fixture();
    expect(charge(f)).toBeDefined();
    expect(f.sim.applyTalents({ spec: 'shadow', rows: {} })).toBe(true);
    expect(charge(f)).toBeUndefined();
  });
});
