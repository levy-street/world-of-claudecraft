import { describe, expect, it, vi } from 'vitest';
import { spiritBombProgress } from '../src/sim/combat/priest/spirit_bomb';
import { addGloomtithe } from '../src/sim/combat/priest/vespers';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';

const ID = 'void_rupture';

function fixture(stacks = 5) {
  const sim = new Sim({ seed: 2814, playerClass: 'priest', autoEquip: true });
  sim.setPlayerLevel(20);
  sim.setSpec('shadow');
  const ctx = (sim as unknown as { ctx: SimContext }).ctx;
  for (const entity of [...sim.entities.values()]) {
    if (entity.id !== sim.playerId) ctx.dropEntity(entity.id);
  }
  sim.tick();
  const p = sim.player;
  p.hitBonus = 1;
  p.resource = 0;
  ctx.spellCrit = () => 0;
  ctx.lineOfSightBlocked = () => false;
  const target = createMob(9900, MOBS.training_dummy, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 30,
  });
  target.hostile = true;
  target.maxHp = target.hp = 100000;
  ctx.addEntity(target);
  sim.targetEntity(target.id);
  addGloomtithe(ctx, p, stacks);
  const events = vi.spyOn(ctx, 'emit');
  const errors = vi.spyOn(ctx, 'error');
  return { sim, ctx, p, target, events, errors };
}

function bank(f: ReturnType<typeof fixture>) {
  return f.p.auras.find((aura) => aura.kind === 'gloomtithe' && aura.sourceId === f.p.id);
}

describe('Void Rupture', () => {
  it('is a base Shadow ability learned with Vampiric Touch at level 16', () => {
    for (const spec of ['shadow', 'holy', 'discipline', null]) {
      const mods = computeTalentModifiers('priest', { ...emptyAllocation(), spec }, 20);
      expect(abilitiesKnownAt('priest', 15, mods).some((known) => known.def.id === ID)).toBe(false);
      expect(abilitiesKnownAt('priest', 16, mods).some((known) => known.def.id === ID)).toBe(
        spec === 'shadow',
      );
    }
    expect(ABILITIES[ID]).toMatchObject({
      cost: 0,
      castTime: 0,
      cooldown: 0,
      range: 30,
      projectile: false,
      effects: [{ type: 'directDamage', min: 36, max: 36 }],
    });
  });

  it.each([0, 1, 2])('refuses %s gems without damage, mana payment, or GCD', (stacks) => {
    const f = fixture(stacks);
    f.sim.castAbility(ID);
    expect(f.target.hp).toBe(f.target.maxHp);
    expect(bank(f)?.stacks ?? 0).toBe(stacks);
    expect(f.p.resource).toBe(0);
    expect(f.p.gcdRemaining).toBe(0);
    expect(f.errors).toHaveBeenCalledWith(f.p.id, 'That ability is not ready yet.');
  });

  it.each([3, 4, 5])(
    'spends exactly 3 of %s gems instantly without an Effigy or mana',
    (stacks) => {
      const f = fixture(stacks);
      f.sim.castAbility(ID);
      expect(f.target.hp).toBeLessThan(f.target.maxHp);
      expect(bank(f)?.stacks ?? 0).toBe(stacks - 3);
      expect(f.p.resource).toBe(0);
      expect(f.p.gcdRemaining).toBeGreaterThan(0);
      expect(f.p.castingAbility).toBeNull();
      expect(f.p.cooldowns.get(ID) ?? 0).toBe(0);
      expect(spiritBombProgress(f.p)).toBe(stacks);
      expect(f.target.auras).toHaveLength(0);
      expect(
        f.events.mock.calls.some(([event]) => event.type === 'damage' && event.abilityId === ID),
      ).toBe(true);
      f.sim.castAbility(ID);
      expect(bank(f)?.stacks ?? 0).toBe(stacks - 3);
    },
  );

  it('ignores foreign banks both for admission and payment', () => {
    const f = fixture(2);
    const own = bank(f)!;
    const foreign = { ...own, sourceId: 12345, stacks: 5 };
    f.p.auras.unshift(foreign);
    f.sim.castAbility(ID);
    expect(f.target.hp).toBe(f.target.maxHp);
    own.stacks = 5;
    f.sim.castAbility(ID);
    expect(own.stacks).toBe(2);
    expect(foreign.stacks).toBe(5);
  });

  it.each(['missing', 'range', 'dead', 'friendly', 'line of sight'] as const)(
    'preserves gems for a rejected %s target',
    (reason) => {
      const f = fixture();
      if (reason === 'missing') f.sim.targetEntity(null);
      if (reason === 'range') f.target.pos.z += 1;
      if (reason === 'dead') f.target.dead = true;
      if (reason === 'friendly') f.sim.targetEntity(f.p.id);
      if (reason === 'line of sight') f.ctx.lineOfSightBlocked = () => true;
      f.sim.castAbility(ID);
      expect(bank(f)?.stacks).toBe(5);
      expect(f.target.hp).toBe(f.target.maxHp);
      expect(f.p.gcdRemaining).toBe(0);
    },
  );

  it('casts during movement and can cast again after the GCD with new gems', () => {
    const f = fixture();
    f.sim.moveInput.forward = true;
    f.sim.tick();
    f.sim.castAbility(ID);
    const after = f.target.hp;
    expect(after).toBeLessThan(f.target.maxHp);
    expect(f.p.castingAbility).toBeNull();
    addGloomtithe(f.ctx, f.p, 1);
    f.p.gcdRemaining = 0;
    f.sim.castAbility(ID);
    expect(f.target.hp).toBeLessThan(after);
    expect(bank(f)).toBeUndefined();
    expect(spiritBombProgress(f.p)).toBe(6);
  });

  it('pays its gems on a resisted cast without awarding bomb progress', () => {
    const f = fixture();
    f.p.hitBonus = -10;
    f.sim.castAbility(ID);
    expect(f.target.hp).toBe(f.target.maxHp);
    expect(bank(f)?.stacks).toBe(2);
    expect(spiritBombProgress(f.p)).toBe(5);
    expect(
      f.events.mock.calls.some(([event]) => event.type === 'damage' && event.kind === 'resist'),
    ).toBe(true);
  });

  it('leaves two gems for an empowered Vampiric Touch from a five-gem bank', () => {
    const castTouch = (f: ReturnType<typeof fixture>) => {
      f.p.gcdRemaining = 0;
      f.p.resource = f.p.maxResource;
      f.sim.castAbility('vampiric_touch');
      for (let tick = 0; tick < 32; tick++) f.sim.tick();
      return f.target.auras.find((aura) => aura.id === 'vampiric_touch')?.value;
    };
    const normal = castTouch(fixture(0));
    expect(normal).toBeGreaterThan(0);
    const f = fixture();
    f.sim.castAbility(ID);
    expect(bank(f)?.stacks).toBe(2);
    expect(castTouch(f)).toBe(Math.round((normal ?? 0) * 1.3));
    expect(bank(f)).toBeUndefined();
    expect(spiritBombProgress(f.p)).toBe(5);
  });

  it('lets the pet consume the remaining two gems after Rupture', () => {
    const f = fixture();
    f.target.auras.push({
      id: 'shadow_word_pain',
      name: 'Dirge of Decay',
      kind: 'dot',
      remaining: 60,
      duration: 60,
      tickInterval: 60,
      tickTimer: 60,
      value: 1,
      sourceId: f.p.id,
      school: 'shadow',
    });
    f.sim.castAbility(ID);
    f.p.gcdRemaining = 0;
    f.p.resource = f.p.maxResource;
    f.sim.castAbility('summon_tithefiend');
    const pet = [...f.sim.entities.values()].find(
      (entity) => entity.ownerId === f.p.id && entity.guardianState?.key === 'tithefiend',
    );
    expect(pet?.guardianState).toMatchObject({ remaining: 8, minDamage: 28, maxDamage: 32 });
    expect(bank(f)).toBeUndefined();
    expect(spiritBombProgress(f.p)).toBe(5);
  });

  it('replays identically for the same seed and actions', () => {
    const replay = () => {
      const f = fixture();
      f.sim.castAbility(ID);
      return { hp: f.target.hp, auras: f.p.auras, events: f.events.mock.calls };
    };
    expect(replay()).toEqual(replay());
  });
});
