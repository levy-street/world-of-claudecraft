import { describe, expect, it, vi } from 'vitest';
import { updateAuras } from '../src/sim/combat/auras';
import { addGloomtithe } from '../src/sim/combat/priest/vespers';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { type Aura, DT, type Entity, type SimEvent } from '../src/sim/types';
import { abilityDisplayDescription, abilityEffectText } from '../src/ui/ability_description';
import { en } from '../src/ui/i18n.catalog';

const ID = 'vampiric_touch';
const NAME = 'Vampiric Touch';

function fixture(chance = 0) {
  const sim = new Sim({ seed: 2814, playerClass: 'priest', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('shadow')).toBe(true);
  const ctx = (sim as unknown as { ctx: SimContext }).ctx;
  for (const entity of [...sim.entities.values()]) {
    if (entity.id !== sim.playerId) ctx.dropEntity(entity.id);
  }
  sim.tick();
  const p = sim.player;
  p.hitBonus = 1;
  p.resource = p.maxResource;
  ctx.spellCrit = () => chance;
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
  return { sim, ctx, p, target };
}

type Fixture = ReturnType<typeof fixture>;

function ownTouch(target: Entity, sourceId: number): Aura | undefined {
  return target.auras.find((aura) => aura.id === ID && aura.sourceId === sourceId);
}

function land(f: Fixture): Aura {
  f.p.gcdRemaining = 0;
  f.p.resource = f.p.maxResource;
  f.sim.castAbility(ID);
  for (let tick = 0; tick < 32; tick++) f.sim.tick();
  const aura = ownTouch(f.target, f.p.id);
  if (!aura) throw new Error('Vampiric Touch did not land');
  return aura;
}

function tickTouch(f: Fixture, aura: Aura): SimEvent[] {
  aura.tickTimer = DT;
  const observer = vi.spyOn(f.ctx, 'emit');
  updateAuras(f.ctx, f.target);
  const events = observer.mock.calls.map(([event]) => event);
  observer.mockRestore();
  return events;
}

function ally(f: Fixture, name: string, distance: number, grouped = true): Entity {
  const id = f.sim.addPlayer('warrior', name);
  f.sim.setPlayerLevel(20, id);
  const member = f.sim.entities.get(id);
  if (!member) throw new Error('Missing ally');
  member.pos = { ...f.p.pos, x: f.p.pos.x + distance };
  member.hp = Math.floor(member.maxHp / 2);
  if (grouped) {
    f.sim.partyInvite(id, f.p.id);
    f.sim.partyAccept(id);
  }
  return member;
}

const hits = (events: SimEvent[]) =>
  events.filter(
    (event): event is Extract<SimEvent, { type: 'damage' }> =>
      event.type === 'damage' && event.ability === NAME,
  );
const heals = (events: SimEvent[]) =>
  events.filter(
    (event): event is Extract<SimEvent, { type: 'heal2' }> =>
      event.type === 'heal2' && event.ability === NAME,
  );

describe('Vampiric Touch', () => {
  it('is learned at level 16 by Shadow only, without a talent choice', () => {
    for (const spec of ['shadow', 'holy', 'discipline', null]) {
      const mods = computeTalentModifiers('priest', { ...emptyAllocation(), spec }, 20);
      expect(abilitiesKnownAt('priest', 15, mods).some((known) => known.def.id === ID)).toBe(false);
      expect(abilitiesKnownAt('priest', 16, mods).some((known) => known.def.id === ID)).toBe(
        spec === 'shadow',
      );
    }
    expect(ABILITIES[ID]).toMatchObject({
      cost: 60,
      castTime: 1.5,
      cooldown: 0,
      range: 30,
      projectile: false,
    });
    expect(ABILITIES[ID].effects).toEqual([{ type: 'dot', total: 90, duration: 15, interval: 3 }]);
  });

  it('applies at cast completion at 30 yards with no projectile or immediate damage', () => {
    const f = fixture();
    const before = f.p.resource;
    f.sim.castAbility(ID);
    expect(f.p.castingAbility).toBe(ID);
    const events: SimEvent[] = [];
    for (let tick = 0; tick < 29; tick++) events.push(...f.sim.tick());
    expect(ownTouch(f.target, f.p.id)).toBeUndefined();
    events.push(...f.sim.tick());
    expect(ownTouch(f.target, f.p.id)).toMatchObject({
      duration: 15,
      tickInterval: 3,
      kind: 'dot',
    });
    expect(f.p.resource).toBe(before - 60);
    expect(hits(events)).toHaveLength(0);
    expect(
      events.some(
        (event) => event.type === 'spellfx' && event.ability === ID && event.fx === 'tick',
      ),
    ).toBe(true);
    expect(
      events.filter(
        (event) =>
          event.type === 'spellfx' &&
          event.ability === ID &&
          ['projectile', 'heavyBolt', 'beam', 'drainBeam'].includes(event.fx),
      ),
    ).toHaveLength(0);
  });

  it.each([0, 1, 2, 5])(
    'casts with %s charges, consuming exactly two only when available',
    (charges) => {
      const plain = fixture();
      const normalTick = land(plain).value;
      const f = fixture();
      addGloomtithe(f.ctx, f.p, charges);
      const dot = land(f);
      expect(dot.value).toBe(charges >= 2 ? Math.round(normalTick * 1.3) : normalTick);
      expect(f.p.auras.find((aura) => aura.kind === 'gloomtithe')?.stacks ?? 0).toBe(
        charges >= 2 ? charges - 2 : charges,
      );
      tickTouch(f, dot);
      expect(f.p.auras.find((aura) => aura.kind === 'gloomtithe')?.stacks ?? 0).toBe(
        charges >= 2 ? charges - 2 : charges,
      );
    },
  );

  it.each(['cancel', 'resist', 'out of range'] as const)(
    'does not spend charges or apply the DoT on %s',
    (reason) => {
      const f = fixture();
      addGloomtithe(f.ctx, f.p, 5);
      if (reason === 'resist') f.p.hitBonus = -10;
      if (reason === 'out of range') f.target.pos.z = f.p.pos.z + 31;
      f.sim.castAbility(ID);
      if (reason === 'cancel') f.ctx.cancelCast(f.p);
      for (let tick = 0; tick < 35; tick++) f.sim.tick();
      expect(ownTouch(f.target, f.p.id)).toBeUndefined();
      expect(f.p.auras.find((aura) => aura.kind === 'gloomtithe')?.stacks).toBe(5);
    },
  );

  it('applies the charge bonus to the whole Spell Power-scaled snapshot', () => {
    const values: number[] = [];
    for (const power of [0, 100]) {
      const plain = fixture();
      plain.p.spellPower = power;
      const base = land(plain).value;
      const boosted = fixture();
      addGloomtithe(boosted.ctx, boosted.p, 5);
      boosted.sim.tick(); // Settle the bank aura's normal stat recalculation.
      boosted.p.spellPower = power;
      expect(land(boosted).value).toBe(Math.round(base * 1.3));
      values.push(base);
    }
    // Mastery + baseline: 1.25 spell * 1.15 DoT = 1.4375 at level 20.
    // round(90 * 1.4375)/5 rounds to 26; 100 SP adds round(100/5 * 1.4375) = 29.
    expect(values).toEqual([26, 55]);
  });

  it('ignores a foreign caster Gloomtithe bank', () => {
    const plain = fixture();
    const normal = land(plain).value;
    const f = fixture();
    addGloomtithe(f.ctx, f.p, 5);
    const bank = f.p.auras.find((a) => a.kind === 'gloomtithe');
    if (!bank) throw new Error('Missing bank');
    bank.sourceId = 9999;
    expect(land(f).value).toBe(normal);
    expect(bank.stacks).toBe(5);
  });

  it('excludes a hostile duelling member of the same party', () => {
    const f = fixture();
    const member = ally(f, 'Duelist', 5);
    const dot = land(f);
    f.p.inCombat = false;
    f.p.combatTimer = 0;
    f.sim.duelRequest(member.id);
    f.sim.duelAccept(member.id);
    for (let tick = 0; tick < 65; tick++) f.sim.tick();
    expect(f.ctx.isFriendlyTo(f.p, member)).toBe(false);
    f.p.hp = f.p.maxHp;
    member.hp = Math.floor(member.maxHp / 2);
    dot.value = 100;
    expect(heals(tickTouch(f, dot))).toHaveLength(0);
  });

  it('uses the same RNG tail with zero or two healing recipients', () => {
    const run = (injured: boolean) => {
      const f = fixture(0.4);
      const member = ally(f, 'Ally', 5);
      const dot = land(f);
      f.p.hp = injured ? Math.floor(f.p.maxHp / 2) : f.p.maxHp;
      member.hp = injured ? Math.floor(member.maxHp / 2) : member.maxHp;
      dot.value = 100;
      const events = tickTouch(f, dot);
      return { tail: f.ctx.rng.next(), damage: hits(events), heals: heals(events) };
    };
    const full = run(false);
    const hurt = run(true);
    expect(full.heals).toHaveLength(0);
    expect(hurt.heals).toHaveLength(2);
    expect(hurt.tail).toBe(full.tail);
    expect(hurt.damage).toEqual(full.damage);
  });

  it('makes five critical ticks and expires, without generating Gloomtithe', () => {
    const f = fixture(1);
    const aura = land(f);
    const stored = aura.value;
    const events = Array.from({ length: 300 }, () => f.sim.tick()).flat();
    expect(hits(events)).toHaveLength(5);
    expect(hits(events).every((event) => (event as { crit: boolean }).crit)).toBe(true);
    expect(aura.value).toBe(stored);
    expect(ownTouch(f.target, f.p.id)).toBeUndefined();
    expect(f.p.auras.some((a) => a.kind === 'gloomtithe')).toBe(false);
  });

  it('shares one 20% healing budget among injured party members including the caster', () => {
    const f = fixture();
    const near = ally(f, 'Near', 30);
    const far = ally(f, 'Far', 31);
    const full = ally(f, 'Full', 8);
    full.hp = full.maxHp;
    ally(f, 'Stranger', 5, false);
    const dot = land(f);
    dot.value = 100;
    f.p.hp = Math.floor(f.p.maxHp / 2);
    const events = tickTouch(f, dot);
    expect(heals(events)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: f.p.id, targetId: f.p.id, amount: 10, crit: false }),
        expect.objectContaining({ sourceId: f.p.id, targetId: near.id, amount: 10, crit: false }),
      ]),
    );
    expect(heals(events)).toHaveLength(2);
    expect(
      heals(events).some((event) => event.targetId === far.id || event.targetId === full.id),
    ).toBe(false);
  });

  it('heals only the caster subgroup inside a raid, excluding dead members', () => {
    const f = fixture();
    const near = ally(f, 'Own Group', 5);
    const other = ally(f, 'Other Group', 5);
    const dead = ally(f, 'Dead', 5);
    const full = ally(f, 'Full', 5);
    full.hp = full.maxHp;
    f.sim.convertPartyToRaid();
    const party = f.ctx.partyOf(f.p.id);
    if (!party) throw new Error('Missing party');
    expect(party.raid).toBe(true);
    party.raidGroups.set(other.id, 2);
    const dot = land(f);
    dead.dead = true;
    f.p.hp = f.p.maxHp;
    dot.value = 100;
    const events = tickTouch(f, dot);
    expect(heals(events)).toHaveLength(1);
    expect(heals(events)[0]).toMatchObject({ targetId: near.id, amount: 20 });
  });

  it.each([0, 50, 100])('heals from actual health lost after %s damage absorption', (absorb) => {
    const f = fixture();
    const dot = land(f);
    dot.value = 100;
    f.p.hp = Math.floor(f.p.maxHp / 2);
    if (absorb > 0)
      f.target.auras.push({
        id: 'test_absorb',
        name: 'Test absorb',
        kind: 'absorb',
        remaining: 20,
        duration: 20,
        value: absorb,
        sourceId: f.target.id,
        school: 'holy',
      });
    const events = tickTouch(f, dot);
    const expected = Math.round((100 - absorb) * 0.2);
    expect(
      heals(events).reduce((sum, event) => sum + (event as { amount: number }).amount, 0),
    ).toBe(expected);
    if (expected === 0) expect(heals(events)).toHaveLength(0);
  });

  it('increases the healing budget with critical damage and honors healing absorbs', () => {
    const f = fixture(1);
    const dot = land(f);
    dot.value = 100;
    f.p.hp = Math.floor(f.p.maxHp / 2);
    f.p.auras.push({
      id: 'test_heal_absorb',
      name: 'Test heal absorb',
      kind: 'heal_absorb',
      remaining: 20,
      duration: 20,
      value: 10,
      sourceId: f.target.id,
      school: 'shadow',
    });
    const events = tickTouch(f, dot);
    expect(hits(events)[0]).toMatchObject({ amount: 150, crit: true });
    expect(heals(events)[0]).toMatchObject({ amount: 20, absorbed: 10, crit: false });
  });

  it('uses landed damage before reactive healing and clamps away overkill', () => {
    const f = fixture();
    const dot = land(f);
    dot.value = 100;
    f.p.hp = Math.floor(f.p.maxHp / 2);
    f.target.maxHp = 1000;
    f.target.hp = 300;
    f.target.auras.push({
      id: 'test_reactive_heal',
      name: 'Reactive heal',
      kind: 'heal_echo',
      remaining: 20,
      duration: 20,
      value: 200,
      value2: 0.35,
      sourceId: f.p.id,
      school: 'holy',
    });
    expect(heals(tickTouch(f, dot))[0]).toMatchObject({ amount: 20 });
    expect(f.target.hp).toBe(400);
    f.target.hp = 10;
    expect(heals(tickTouch(f, dot))[0]).toMatchObject({ amount: 2 });
  });

  it('does not consume charges when the aura application is rejected', () => {
    const f = fixture();
    addGloomtithe(f.ctx, f.p, 5);
    const apply = f.ctx.applyAura;
    const rejected = vi.spyOn(f.ctx, 'applyAura').mockImplementation((target, aura) => {
      if (aura.id !== ID) apply(target, aura);
    });
    f.sim.castAbility(ID);
    for (let tick = 0; tick < 35; tick++) f.sim.tick();
    expect(ownTouch(f.target, f.p.id)).toBeUndefined();
    expect(f.p.auras.find((a) => a.kind === 'gloomtithe')?.stacks).toBe(5);
    rejected.mockRestore();
  });

  it.each(['dead', 'respecced'] as const)('does not heal from a %s caster', (state) => {
    const f = fixture();
    const dot = land(f);
    const member = ally(f, 'Injured', 5);
    if (state === 'dead') f.p.dead = true;
    else {
      f.p.combatTimer = 0;
      f.p.inCombat = false;
      expect(f.sim.setSpec('holy')).toBe(true);
    }
    dot.value = 100;
    expect(heals(tickTouch(f, dot))).toHaveLength(0);
    expect(member.hp).toBeLessThan(member.maxHp);
  });

  it('gives no healing for an immune target', () => {
    const f = fixture();
    const dot = land(f);
    dot.value = 100;
    f.p.hp = Math.floor(f.p.maxHp / 2);
    f.target.auras.push({
      id: 'ice_block',
      name: 'Cold Coffin',
      kind: 'stasis',
      remaining: 20,
      duration: 20,
      value: 0,
      sourceId: f.target.id,
      school: 'frost',
    });
    const hp = f.target.hp;
    expect(heals(tickTouch(f, dot))).toHaveLength(0);
    expect(f.target.hp).toBe(hp);
  });

  it('refreshes its own snapshot without removing another caster curse', () => {
    const f = fixture();
    const first = land(f);
    const foreign = { ...first, sourceId: 9910, value: 77 };
    f.target.auras.push(foreign);
    addGloomtithe(f.ctx, f.p, 5);
    const refreshed = land(f);
    expect(refreshed).not.toBe(first);
    expect(f.target.auras.filter((a) => a.id === ID && a.sourceId === f.p.id)).toHaveLength(1);
    expect(f.target.auras).toContain(foreign);
    expect(f.p.auras.find((a) => a.kind === 'gloomtithe')?.stacks).toBe(3);
  });

  it('splits remainder deterministically and replays damage, healing and RNG tail', () => {
    const replay = () => {
      const f = fixture(0.4);
      const member = ally(f, 'Injured', 5);
      const dot = land(f);
      dot.value = 105;
      f.p.hp = Math.floor(f.p.maxHp / 2);
      const events = Array.from({ length: 5 }, () => tickTouch(f, dot));
      return { events, hp: [f.p.hp, member.hp, f.target.hp], rng: f.ctx.rng.next() };
    };
    expect(replay()).toEqual(replay());
    const f = fixture();
    const member = ally(f, 'Injured', 5);
    const dot = land(f);
    dot.value = 105;
    f.p.hp = Math.floor(f.p.maxHp / 2);
    f.ctx.partyOf(f.p.id)?.members.reverse();
    expect(heals(tickTouch(f, dot))).toEqual([
      expect.objectContaining({ targetId: f.p.id, amount: 11 }),
      expect.objectContaining({ targetId: member.id, amount: 10 }),
    ]);
  });

  it.each([0, 100])('matches the unboosted tooltip total to combat at %s Spell Power', (power) => {
    const f = fixture();
    f.p.spellPower = power;
    const resolved = f.sim.resolvedAbility(ID);
    if (!resolved) throw new Error('Missing resolved ability');
    const scaling = { spellPower: power, healPower: 0, attackPower: 0, rangedPower: 0 };
    const damageText = abilityEffectText(resolved, scaling);
    const text = abilityDisplayDescription(resolved, damageText, scaling);
    const dot = land(f);
    const events = Array.from({ length: 300 }, () => f.sim.tick()).flat();
    const total = hits(events).reduce(
      (sum, event) => sum + (event as { amount: number }).amount,
      0,
    );
    expect(total).toBe(dot.value * 5);
    const numbers = damageText.match(/\d+/g)?.map(Number) ?? [];
    expect(numbers.reduce((sum, value) => sum + value, 0)).toBe(total);
    expect(text).toContain('20%');
    expect(text).toContain('30%');
    expect(en.entities.abilities[ID].name).toBe(NAME);
  });
});
