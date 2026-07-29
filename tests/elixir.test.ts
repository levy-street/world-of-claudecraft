import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function playerWorld() {
  const sim = makeWorld();
  const pid = sim.addPlayer('warrior', 'Aleph');
  sim.tick();
  const p = sim.entities.get(pid)! as Entity;
  return { sim, pid, p };
}

function drink(sim: Sim, pid: number, itemId: string): void {
  sim.addItem(itemId, 1, pid);
  sim.useItem(itemId, pid);
}

function staAuras(p: Entity): Aura[] {
  return p.auras.filter((a) => a.kind === 'buff_sta');
}

function applyAuraOn(sim: Sim, target: Entity, aura: Aura): void {
  (sim as unknown as { applyAura(t: Entity, a: Aura): void }).applyAura(target, aura);
}

describe('battle elixir (Elixir of the Bear)', () => {
  it('grants the stamina buff aura and raises max HP on use', () => {
    const { sim, pid, p } = playerWorld();
    const beforeMaxHp = p.maxHp;

    drink(sim, pid, 'elixir_of_the_bear');

    const aura = p.auras.find((a) => a.id === 'elixir_buff_sta');
    expect(aura, 'elixir aura applied').toBeTruthy();
    expect(aura!.kind).toBe('buff_sta');
    expect(aura!.value).toBe(12);
    expect(aura!.name).toBe('Might of the Bear');
    expect(p.maxHp, 'stamina buff raises max HP').toBeGreaterThan(beforeMaxHp);
  });

  it('consumes one elixir per use', () => {
    const { sim, pid } = playerWorld();

    sim.addItem('elixir_of_the_bear', 2, pid);
    sim.useItem('elixir_of_the_bear', pid);
    expect(sim.countItem('elixir_of_the_bear', pid)).toBe(1);
  });

  it('does nothing when the player has no elixir', () => {
    const { sim, pid, p } = playerWorld();

    sim.useItem('elixir_of_the_bear', pid);
    expect(p.auras.some((a) => a.id === 'elixir_buff_sta')).toBe(false);
  });

  it('re-quaffing refreshes the buff without stacking it', () => {
    const { sim, pid, p } = playerWorld();

    sim.addItem('elixir_of_the_bear', 2, pid);
    sim.useItem('elixir_of_the_bear', pid);
    for (let i = 0; i < 20 * 5; i++) sim.tick(); // let it tick down ~5s
    sim.useItem('elixir_of_the_bear', pid);

    const auras = p.auras.filter((a) => a.id === 'elixir_buff_sta');
    expect(auras.length, 'only one elixir aura, refreshed').toBe(1);
    expect(auras[0].value).toBe(12);
    expect(auras[0].remaining).toBeGreaterThan(890);
  });
});

// The four stamina elixirs (Boar / Vipersear / Bear / Serpent) are one alchemy
// ladder for one effect. Elixirs are exclusive PER BUFF KIND, last drunk wins
// (classic overwrite semantics, weaker included): the aura id is derived from
// the elixir's effect kind, so the ordinary same-id replacement in applyAura
// enforces exclusivity. Class buffs (buff_sta_pct) and negative buff_sta
// debuffs ride their own ids and are untouched.
describe('same-stat elixirs are exclusive, last drunk wins', () => {
  it('Bear then Serpent leaves exactly one stamina elixir aura at +12, not +24', () => {
    const { sim, pid, p } = playerWorld();
    const baseSta = p.stats.sta;
    const baseMaxHp = p.maxHp;

    drink(sim, pid, 'elixir_of_the_bear');
    const oneElixirMaxHp = p.maxHp;
    drink(sim, pid, 'elixir_of_the_serpent');

    const auras = staAuras(p);
    expect(auras.length, 'one stamina elixir aura').toBe(1);
    expect(auras[0].id).toBe('elixir_buff_sta');
    expect(auras[0].name).toBe('Might of the Serpent');
    expect(p.stats.sta, 'stamina reflects one +12 elixir').toBe(baseSta + 12);
    expect(p.maxHp, 'HP pool reflects one elixir, not two').toBe(oneElixirMaxHp);
    expect(p.maxHp).toBeGreaterThan(baseMaxHp);
  });

  it('ladder up: Boar then Bear is one aura at +12 with Bear duration', () => {
    const { sim, pid, p } = playerWorld();
    const baseSta = p.stats.sta;

    drink(sim, pid, 'elixir_of_the_boar');
    for (let i = 0; i < 20 * 5; i++) sim.tick(); // tick the Boar buff down ~5s
    drink(sim, pid, 'elixir_of_the_bear');

    const auras = staAuras(p);
    expect(auras.length).toBe(1);
    expect(auras[0].value).toBe(12);
    expect(auras[0].name).toBe('Might of the Bear');
    expect(auras[0].remaining, "Bear's own 900s timer, not Boar's").toBeGreaterThan(890);
    expect(p.stats.sta).toBe(baseSta + 12);
  });

  it('ladder down: Bear then Boar is one aura at +6 (classic overwrite, weaker wins)', () => {
    const { sim, pid, p } = playerWorld();
    const baseSta = p.stats.sta;

    drink(sim, pid, 'elixir_of_the_bear');
    drink(sim, pid, 'elixir_of_the_boar');

    const auras = staAuras(p);
    expect(auras.length).toBe(1);
    expect(auras[0].value).toBe(6);
    expect(auras[0].name).toBe('Might of the Boar');
    expect(p.stats.sta).toBe(baseSta + 6);
  });

  it('a percent stamina class buff (Fortitude-shaped) stacks with an elixir', () => {
    const { sim, pid, p } = playerWorld();
    const baseSta = p.stats.sta;

    drink(sim, pid, 'elixir_of_the_bear');
    applyAuraOn(sim, p, {
      id: 'power_word_fortitude',
      name: 'Power Word: Fortitude',
      kind: 'buff_sta_pct',
      remaining: 1800,
      duration: 1800,
      value: 10,
      sourceId: p.id,
      school: 'holy',
    } as Aura);

    expect(p.auras.some((a) => a.id === 'elixir_buff_sta')).toBe(true);
    expect(p.auras.some((a) => a.id === 'power_word_fortitude')).toBe(true);
    expect(p.stats.sta, 'flat elixir then +10% fold').toBe(Math.round((baseSta + 12) * 1.1));
  });

  it('a negative buff_sta drain debuff and an elixir coexist in both orders', () => {
    const drain: Omit<Aura, 'sourceId'> = {
      id: 'enervate_test_mob',
      name: 'Enervate',
      kind: 'buff_sta',
      remaining: 30,
      duration: 30,
      value: -5,
      school: 'shadow',
    } as Omit<Aura, 'sourceId'>;

    // Drain first, then drink: the elixir must not displace the debuff.
    {
      const { sim, pid, p } = playerWorld();
      const baseSta = p.stats.sta;
      applyAuraOn(sim, p, { ...drain, sourceId: 999999 } as Aura);
      drink(sim, pid, 'elixir_of_the_bear');
      expect(p.auras.some((a) => a.id === 'enervate_test_mob')).toBe(true);
      expect(p.auras.some((a) => a.id === 'elixir_buff_sta')).toBe(true);
      expect(p.stats.sta).toBe(baseSta + 12 - 5);
    }

    // Drink first, then the drain lands: the debuff must not displace the elixir.
    {
      const { sim, pid, p } = playerWorld();
      const baseSta = p.stats.sta;
      drink(sim, pid, 'elixir_of_the_bear');
      applyAuraOn(sim, p, { ...drain, sourceId: 999999 } as Aura);
      expect(p.auras.some((a) => a.id === 'elixir_buff_sta')).toBe(true);
      expect(p.auras.some((a) => a.id === 'enervate_test_mob')).toBe(true);
      expect(p.stats.sta).toBe(baseSta + 12 - 5);
    }
  });

  it('displacing a different-name elixir emits its fade event alongside the gain', () => {
    const { sim, pid } = playerWorld();
    drink(sim, pid, 'elixir_of_the_bear');
    sim.drainEvents();
    drink(sim, pid, 'elixir_of_the_serpent');
    const evs = sim.drainEvents();
    expect(
      evs.some((e) => e.type === 'aura' && e.name === 'Might of the Bear' && e.gained === false),
      'the displaced Bear aura fades visibly in the event stream',
    ).toBe(true);
    expect(
      evs.some((e) => e.type === 'aura' && e.name === 'Might of the Serpent' && e.gained === true),
    ).toBe(true);
  });

  it('a same-item refresh emits no fade event (same name stays silent)', () => {
    const { sim, pid } = playerWorld();
    drink(sim, pid, 'elixir_of_the_bear');
    sim.drainEvents();
    drink(sim, pid, 'elixir_of_the_bear');
    const evs = sim.drainEvents();
    expect(evs.some((e) => e.type === 'aura' && e.gained === false)).toBe(false);
    expect(
      evs.some((e) => e.type === 'aura' && e.name === 'Might of the Bear' && e.gained === true),
    ).toBe(true);
  });

  it('every elixir item in the catalog maps to the shared per-kind aura id', () => {
    // Content-shape pin: a future fifth stamina elixir lands in this loop
    // automatically and cannot silently reintroduce per-item stacking.
    const elixirs = Object.values(ITEMS).filter((d) => d.kind === 'elixir');
    const staElixirIds = elixirs
      .filter((d) => d.elixir?.kind === 'buff_sta')
      .map((d) => d.id)
      .sort();
    // A new stamina elixir must be added here DELIBERATELY: it inherits the
    // shared exclusivity id automatically via the loop below.
    expect(staElixirIds).toEqual([
      'elixir_of_the_bear',
      'elixir_of_the_boar',
      'elixir_of_the_serpent',
      'venomfire_elixir',
    ]);
    for (const def of elixirs) {
      const { sim, pid, p } = playerWorld();
      drink(sim, pid, def.id);
      const aura = p.auras.find((a) => a.id === `elixir_${def.elixir!.kind}`);
      expect(aura, `${def.id} applies the shared elixir_${def.elixir!.kind} aura`).toBeTruthy();
      expect(aura!.value, def.id).toBe(def.elixir!.value);
    }
  });
});
