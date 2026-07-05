// Bug: a druid saved while shapeshifted persisted the FORM bar (bear rage / cat
// energy) into CharacterState.resource. On reload addPlayer sees the class is a
// mana class and clamps that small number into the mana bar, so the druid loads
// with e.g. 35 mana and has to regen back. The parked mana lives in e.savedMana;
// persistence must normalize to it. Forms are auras and are NOT persisted, so the
// reloaded character is always in caster form and the saved resource must be mana.

import { describe, expect, it } from 'vitest';
import { recalcPlayerStats } from '../src/sim/entity';
import { persistedResource } from '../src/sim/serialize_resource';
import { Sim } from '../src/sim/sim';

function makeWorld() {
  return new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
}

// Put a druid into bear form through the real stat path: push the toggle aura,
// then recompute derived stats (which parks mana into savedMana and swaps the
// bar to rage), then simulate combat having built some rage.
function shiftToBear(sim: Sim, pid: number): void {
  const e = sim.entities.get(pid)!;
  const meta = sim.meta(pid)!;
  e.auras.push({
    id: 'bear_form',
    name: 'Bear Form',
    kind: 'form_bear',
    remaining: 3600,
    duration: 3600,
    value: 1,
    sourceId: pid,
    school: 'physical',
  });
  recalcPlayerStats(e, meta.cls, meta.equipment, meta.talentMods);
}

describe('shapeshifted druid resource persistence', () => {
  it('persists parked mana, not the live form bar, so reload restores mana', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('druid', 'Ursa');
    const e = sim.entities.get(pid)!;
    shiftToBear(sim, pid);
    expect(e.resourceType).toBe('rage'); // sanity: we are in form
    const parked = e.savedMana;
    expect(parked).toBeGreaterThan(50); // a real mana pool was set aside
    e.resource = 35; // built up 35 rage in bear form

    const state = sim.serializeCharacter(pid)!;
    // The saved value is the parked mana, never the 35 rage.
    expect(state.resource).toBe(parked);

    const sim2 = makeWorld();
    const pid2 = sim2.addPlayer('druid', 'Ursa', { state });
    const e2 = sim2.entities.get(pid2)!;
    expect(e2.resourceType).toBe('mana'); // reloads in caster form
    expect(e2.resource).toBe(Math.min(e2.maxResource, parked));
    expect(e2.resource).toBeGreaterThan(50); // NOT the 35 form bar
  });

  it('leaves an unshifted mana class untouched (saves live mana)', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('druid', 'Caster');
    const e = sim.entities.get(pid)!;
    e.resource = 42;
    expect(sim.serializeCharacter(pid)!.resource).toBe(42);
  });

  it('leaves a non-mana class untouched (rogue energy round-trips)', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('rogue', 'Sneak');
    const e = sim.entities.get(pid)!;
    e.resource = 77;
    expect(sim.serializeCharacter(pid)!.resource).toBe(77);
  });
});

describe('persistedResource (pure)', () => {
  it('returns parked mana for a shifted mana class', () => {
    expect(persistedResource('mana', 'rage', 35, 480)).toBe(480);
    expect(persistedResource('mana', 'energy', 100, 320)).toBe(320);
  });
  it('returns the live resource when the bar already matches the class', () => {
    expect(persistedResource('mana', 'mana', 250, 0)).toBe(250);
    expect(persistedResource('energy', 'energy', 77, 0)).toBe(77);
    expect(persistedResource('rage', 'rage', 40, 0)).toBe(40);
  });
  it('is identity for null-resource classes', () => {
    expect(persistedResource(null, null, 0, 0)).toBe(0);
  });
});
