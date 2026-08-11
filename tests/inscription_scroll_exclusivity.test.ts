// The Masterwrought phase 06 exclusivity pin: a buff scroll is an ALTERNATIVE
// SOURCE of the battle-elixir stamina family, never a stack (ruling R14
// corollary). The mechanism under test is the aura id scheme in
// src/sim/items.ts: every elixir AND scroll of one effect kind applies the
// SAME `elixir_${kind}` aura id, so applyAura same-id replacement makes the
// two sources mutually exclusive in BOTH application orders, weaker included
// (classic overwrite, last applied wins). No exclusive_aura.ts machinery is
// involved; that module serves ability self-buffs only.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, SimEvent } from '../src/sim/types';

function playerWorld() {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('warrior', 'Aleph');
  sim.tick();
  const p = sim.entities.get(pid)! as Entity;
  return { sim, pid, p };
}

function use(sim: Sim, pid: number, itemId: string): void {
  sim.addItem(itemId, 1, pid);
  sim.useItem(itemId, pid);
}

function familyAuras(p: Entity): Aura[] {
  return p.auras.filter((a) => a.id === 'elixir_buff_sta');
}

// The three scroll/elixir band pairs. Every case below runs over ALL pairs so
// no band's membership can silently drift out of the family.
const BAND_PAIRS = [
  { scroll: 'silverleaf_scroll', elixir: 'elixir_of_the_boar', value: 6 },
  { scroll: 'goldleaf_scroll', elixir: 'venomfire_elixir', value: 9 },
  { scroll: 'sunpetal_scroll', elixir: 'elixir_of_the_serpent', value: 12 },
] as const;

describe('scroll and elixir share one exclusive family (both orders)', () => {
  it('states the premise: each scroll carries EXACTLY its band elixir payload', () => {
    let checked = 0;
    for (const pair of BAND_PAIRS) {
      const scroll = ITEMS[pair.scroll];
      const elixir = ITEMS[pair.elixir];
      expect(scroll?.kind, pair.scroll).toBe('scroll');
      expect(elixir?.kind, pair.elixir).toBe('elixir');
      // toStrictEqual over the whole payload: a retuned elixir whose scroll
      // does not move with it fails here, which is the alternative-source
      // contract (same buff from either source, byte for byte).
      expect(scroll?.elixir, `${pair.scroll} mirrors ${pair.elixir}`).toStrictEqual(elixir?.elixir);
      expect(scroll?.elixir?.value, pair.scroll).toBe(pair.value);
      expect(scroll?.elixir?.kind, pair.scroll).toBe('buff_sta');
      // The authored family ceiling binds scrolls exactly as it binds elixirs.
      expect(scroll?.elixir?.value, `${pair.scroll} ceiling`).toBeLessThanOrEqual(12);
      expect(scroll?.elixir?.duration, `${pair.scroll} ceiling`).toBeLessThanOrEqual(900);
      checked += 1;
    }
    expect(checked).toBe(3);
  });

  it('elixir then scroll: one family aura, the scroll REALLY replaced it', () => {
    for (const pair of BAND_PAIRS) {
      const { sim, pid, p } = playerWorld();
      use(sim, pid, pair.elixir);
      expect(familyAuras(p).length, `${pair.elixir} applied`).toBe(1);
      // Let the elixir tick down before the scroll: within one band the two
      // payloads are identical, so the DURATION is the only observable that
      // separates "the scroll replaced the aura" from "the scroll was a
      // no-op or applied nothing" (the coverage-audit refusal case).
      for (let i = 0; i < 20 * 5; i++) sim.tick();
      const totalBefore = p.auras.length;
      expect(familyAuras(p)[0].remaining, 'the elixir really ticked down').toBeLessThan(
        (ITEMS[pair.elixir]?.elixir?.duration ?? 0) - 4,
      );
      use(sim, pid, pair.scroll);
      const auras = familyAuras(p);
      expect(auras.length, `${pair.scroll} after ${pair.elixir}: never a stack`).toBe(1);
      expect(auras[0].value, `${pair.scroll} owns the slot`).toBe(pair.value);
      expect(auras[0].remaining, `${pair.scroll} refreshed the slot to full`).toBeGreaterThan(
        (ITEMS[pair.scroll]?.elixir?.duration ?? 0) - 1,
      );
      // No second aura appeared ANYWHERE (not only inside the family filter).
      expect(p.auras.length, `${pair.scroll} added no aura beside the slot`).toBe(totalBefore);
      // Same band means the SAME aura name from either source, so the player
      // sees one indistinguishable buff, not a swap.
      expect(auras[0].name).toBe(ITEMS[pair.elixir]?.elixir?.aura);
    }
  });

  it('scroll then elixir: one family aura, the elixir REALLY replaced it', () => {
    for (const pair of BAND_PAIRS) {
      const { sim, pid, p } = playerWorld();
      use(sim, pid, pair.scroll);
      expect(familyAuras(p).length, `${pair.scroll} applied`).toBe(1);
      for (let i = 0; i < 20 * 5; i++) sim.tick();
      const totalBefore = p.auras.length;
      expect(familyAuras(p)[0].remaining, 'the scroll really ticked down').toBeLessThan(
        (ITEMS[pair.scroll]?.elixir?.duration ?? 0) - 4,
      );
      use(sim, pid, pair.elixir);
      const auras = familyAuras(p);
      expect(auras.length, `${pair.elixir} after ${pair.scroll}: never a stack`).toBe(1);
      expect(auras[0].value, `${pair.elixir} owns the slot`).toBe(pair.value);
      expect(auras[0].remaining, `${pair.elixir} refreshed the slot to full`).toBeGreaterThan(
        (ITEMS[pair.elixir]?.elixir?.duration ?? 0) - 1,
      );
      expect(p.auras.length, `${pair.elixir} added no aura beside the slot`).toBe(totalBefore);
    }
  });

  it('quaffing an elixir still logs the quaff line (the else arm of the split emit)', () => {
    // The scroll branch is pinned above; this pins the elixir branch of the
    // same if/else so a mutation of either arm's text or targeting reds.
    const { sim, pid } = playerWorld();
    sim.addItem('elixir_of_the_boar', 1, pid);
    sim.drainEvents();
    sim.useItem('elixir_of_the_boar', pid);
    const events = sim.drainEvents() as SimEvent[];
    const log = events.find((e) => e.type === 'log' && e.text.startsWith('You quaff'));
    expect(log, 'the elixir use logs a quaff, not a read').toBeTruthy();
    expect((log as { text: string }).text).toBe('You quaff Elixir of the Boar.');
    expect((log as { pid?: number }).pid, 'the line targets the drinker').toBe(pid);
  });

  it('cross-band, weaker included: the LAST source always wins the one slot', () => {
    // Strong scroll then weak elixir: classic overwrite, the weak elixir wins.
    const first = playerWorld();
    use(first.sim, first.pid, 'sunpetal_scroll');
    expect(familyAuras(first.p)[0]?.value).toBe(12);
    use(first.sim, first.pid, 'elixir_of_the_boar');
    let auras = familyAuras(first.p);
    expect(auras.length).toBe(1);
    expect(auras[0].value, 'weaker elixir still replaces the stronger scroll').toBe(6);

    // Strong elixir then weak scroll: same rule with the sources swapped.
    const second = playerWorld();
    use(second.sim, second.pid, 'elixir_of_the_serpent');
    expect(familyAuras(second.p)[0]?.value).toBe(12);
    use(second.sim, second.pid, 'silverleaf_scroll');
    auras = familyAuras(second.p);
    expect(auras.length).toBe(1);
    expect(auras[0].value, 'weaker scroll still replaces the stronger elixir').toBe(6);
  });

  it('reading a scroll consumes one unit and logs the read line', () => {
    const { sim, pid } = playerWorld();
    sim.addItem('silverleaf_scroll', 2, pid);
    sim.drainEvents();
    sim.useItem('silverleaf_scroll', pid);
    expect(sim.countItem('silverleaf_scroll', pid)).toBe(1);
    const events = sim.drainEvents() as SimEvent[];
    const log = events.find((e) => e.type === 'log' && e.text.startsWith('You read'));
    expect(log, 'the scroll use logs a read, not a quaff').toBeTruthy();
    expect((log as { text: string }).text).toBe('You read Sheenleaf Scroll.');
  });

  it('the stamina buff is real: reading a scroll raises max HP', () => {
    const { sim, pid, p } = playerWorld();
    const before = p.maxHp;
    use(sim, pid, 'goldleaf_scroll');
    expect(p.maxHp, 'stamina from the scroll reaches derived stats').toBeGreaterThan(before);
  });
});
