import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errorText(events: SimEvent[]): string | undefined {
  const e = events.find((ev) => ev.type === 'error');
  return e && e.type === 'error' ? e.text : undefined;
}

describe('/gear command', () => {
  it('lists equipped slots in a fixed order and marks empty ones', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    // A fresh warrior starts with a main hand and a chest piece, no legs/feet.
    sim.tick();
    sim.chat('/gear', a);
    const text = errorText(sim.tick());
    expect(text).toBeDefined();
    expect(text).toMatch(/^Equipped \(2\/8\):/);
    expect(text).toContain('Main Hand:');
    expect(text).toContain('Chest:');
    expect(text).toContain('Helmet: (empty)');
    expect(text).toContain('Shoulder: (empty)');
    expect(text).toContain('Waist: (empty)');
    expect(text).toContain('Legs: (empty)');
    expect(text).toContain('Gloves: (empty)');
    expect(text).toContain('Feet: (empty)');
    // fixed slot order: main hand before chest before legs before feet
    expect(text!.indexOf('Main Hand')).toBeLessThan(text!.indexOf('Chest'));
    expect(text!.indexOf('Chest')).toBeLessThan(text!.indexOf('Legs'));
    expect(text!.indexOf('Legs')).toBeLessThan(text!.indexOf('Feet'));
  });

  it('reflects newly equipped gear and resolves item names', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const meta = sim.players.get(a)!;
    meta.equipment = {
      mainhand: 'worn_sword',
      helmet: 'cryptbone_helm',
      shoulder: 'cryptbone_pauldrons',
      chest: 'recruit_tunic',
      waist: 'mistveil_cord',
      legs: 'quilted_trousers',
      gloves: 'mistveil_grips',
      feet: 'oiled_boots',
    };
    sim.tick();
    sim.chat('/gear', a);
    const text = errorText(sim.tick());
    expect(text).toMatch(/^Equipped \(8\/8\):/);
    expect(text).toContain('Pitted Shortsword');
    expect(text).toContain('Quilted Trousers');
    expect(text).not.toContain('(empty)');
  });

  it('reports nothing equipped when every slot is empty', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const meta = sim.players.get(a)!;
    meta.equipment = {};
    sim.tick();
    sim.chat('/gear', a);
    expect(errorText(sim.tick())).toBe('You have nothing equipped.');
  });

  it('is reachable via the /equip and /equipment aliases', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    for (const alias of ['/equip', '/equipment']) {
      sim.chat(alias, a);
      expect(errorText(sim.tick())).toMatch(/^Equipped /);
    }
  });

  it('does not emit a chat event or broadcast to others', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.addPlayer('mage', 'Bet');
    sim.tick();
    const sent = sim.chat('/gear', a);
    expect(sent).toBeNull();
    expect(sim.tick().some((e) => e.type === 'chat')).toBe(false);
  });
});
