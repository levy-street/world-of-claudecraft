import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { Entity } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

describe('battle elixir (Elixir of the Bear)', () => {
  it('grants the stamina buff aura and raises max HP on use', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const p = sim.entities.get(pid)! as Entity;
    const beforeMaxHp = p.maxHp;

    sim.addItem('elixir_of_the_bear', 1, pid);
    sim.useItem('elixir_of_the_bear', pid);

    const aura = p.auras.find((a) => a.id === 'elixir_elixir_of_the_bear');
    expect(aura, 'elixir aura applied').toBeTruthy();
    expect(aura!.kind).toBe('buff_sta');
    expect(aura!.value).toBe(12);
    expect(aura!.name).toBe('Might of the Bear');
    expect(p.maxHp, 'stamina buff raises max HP').toBeGreaterThan(beforeMaxHp);
  });

  it('consumes one elixir per use', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.addItem('elixir_of_the_bear', 2, pid);
    sim.useItem('elixir_of_the_bear', pid);
    expect(sim.countItem('elixir_of_the_bear', pid)).toBe(1);
  });

  it('does nothing when the player has no elixir', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const p = sim.entities.get(pid)! as Entity;

    sim.useItem('elixir_of_the_bear', pid);
    expect(p.auras.some((a) => a.id === 'elixir_elixir_of_the_bear')).toBe(false);
  });

  it('re-quaffing refreshes the buff without stacking it', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const p = sim.entities.get(pid)! as Entity;

    sim.addItem('elixir_of_the_bear', 2, pid);
    sim.useItem('elixir_of_the_bear', pid);
    for (let i = 0; i < 20 * 5; i++) sim.tick(); // let it tick down ~5s
    sim.useItem('elixir_of_the_bear', pid);

    const auras = p.auras.filter((a) => a.id === 'elixir_elixir_of_the_bear');
    expect(auras.length, 'only one elixir aura, refreshed').toBe(1);
    expect(auras[0].remaining).toBeGreaterThan(890);
  });
});
