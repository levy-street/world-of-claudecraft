import { describe, expect, it } from 'vitest';
import type { Sim } from '../src/sim/sim';
import { GATHER_CAST_ID, type SimEvent } from '../src/sim/types';
import { expectDefined } from './helpers/defined';
import { EMPTY_TEST_WORLD, makeScopedSim } from './sim_shared';

// Direct tests for the Field Kit's use.type 'harvestPreference' arm, driven
// through the real Sim.useItem entry point (never the ctx/items.ts internals),
// on EMPTY_TEST_WORLD so no npc/mob/camp content is built and no whole-world
// tick is needed: the item settings action is a single command, not a scene.

function addTestPlayer(sim: Sim, name = 'Aleph') {
  const pid = sim.addPlayer('warrior', name);
  const meta = expectDefined(sim.players.get(pid), 'player meta');
  meta.inventory.length = 0;
  const p = expectDefined(sim.entities.get(pid), 'player entity');
  return { pid, p, meta };
}

function errorTexts(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

function harvestPreferenceOpenEvents(
  events: SimEvent[],
): Extract<SimEvent, { type: 'harvestPreferenceOpen' }>[] {
  return events.filter(
    (e): e is Extract<SimEvent, { type: 'harvestPreferenceOpen' }> =>
      e.type === 'harvestPreferenceOpen',
  );
}

describe('Field Kit use (harvestPreference)', () => {
  it('emits exactly one pid-scoped text-free harvestPreferenceOpen event and touches nothing else', () => {
    const sim = makeScopedSim(EMPTY_TEST_WORLD);
    const { pid, meta } = addTestPlayer(sim);
    sim.addItem('field_kit', 1, pid);
    meta.copper = 500;
    // A real, already-chosen non-All preference: the use must open the
    // picker without ever choosing FOR the player, so this must survive
    // byte-identical.
    meta.harvestPreference = { kind: 'material', itemId: 'rough_hide' };
    sim.drainEvents();
    const draws: number[] = [];
    sim.rng.setObserver((v) => draws.push(v));

    sim.useItem('field_kit', pid);

    sim.rng.setObserver(null);
    const events = sim.drainEvents();
    expect(events).toEqual([{ type: 'harvestPreferenceOpen', pid }]);
    // Never chosen, never spent, never charged, never rng-touched.
    expect(meta.harvestPreference).toEqual({ kind: 'material', itemId: 'rough_hide' });
    expect(sim.countItem('field_kit', pid)).toBe(1);
    expect(meta.copper).toBe(500);
    expect(draws).toEqual([]);
  });

  it('opens via the selected-slot path when the copy at that slot is the field kit', () => {
    const sim = makeScopedSim(EMPTY_TEST_WORLD);
    const { pid, meta } = addTestPlayer(sim);
    sim.addItem('baked_bread', 1, pid);
    sim.addItem('field_kit', 1, pid);
    const slotIndex = meta.inventory.findIndex((slot) => slot.itemId === 'field_kit');
    expect(slotIndex).toBeGreaterThanOrEqual(0);
    sim.drainEvents();

    sim.useItem('field_kit', pid, slotIndex);

    const events = sim.drainEvents();
    expect(harvestPreferenceOpenEvents(events)).toEqual([{ type: 'harvestPreferenceOpen', pid }]);
    expect(sim.countItem('field_kit', pid)).toBe(1);
  });

  it('refuses id-only use when the player holds no field kit at all', () => {
    const sim = makeScopedSim(EMPTY_TEST_WORLD);
    const { pid } = addTestPlayer(sim);
    sim.drainEvents();

    sim.useItem('field_kit', pid);

    const events = sim.drainEvents();
    expect(harvestPreferenceOpenEvents(events)).toEqual([]);
    expect(errorTexts(events)).toEqual(["You don't have that item."]);
  });

  it('refuses a wrong selected slot even though another copy sits elsewhere in the bag', () => {
    const sim = makeScopedSim(EMPTY_TEST_WORLD);
    const { pid, meta } = addTestPlayer(sim);
    sim.addItem('baked_bread', 1, pid);
    sim.addItem('field_kit', 1, pid);
    const breadIndex = meta.inventory.findIndex((slot) => slot.itemId === 'baked_bread');
    expect(breadIndex).toBeGreaterThanOrEqual(0);
    sim.drainEvents();

    // Name the bread's slot while asking to use the field kit: a genuinely
    // owned copy sits at a DIFFERENT index, and the explicit selection must
    // still be refused rather than silently falling back to it.
    sim.useItem('field_kit', pid, breadIndex);

    const events = sim.drainEvents();
    expect(harvestPreferenceOpenEvents(events)).toEqual([]);
    expect(errorTexts(events)).toEqual(["You don't have that item."]);
    expect(sim.countItem('field_kit', pid)).toBe(1);
    expect(sim.countItem('baked_bread', pid)).toBe(1);
  });

  it('refuses an out-of-range selected slot', () => {
    const sim = makeScopedSim(EMPTY_TEST_WORLD);
    const { pid } = addTestPlayer(sim);
    sim.addItem('field_kit', 1, pid);
    sim.drainEvents();

    sim.useItem('field_kit', pid, 99);

    const events = sim.drainEvents();
    expect(harvestPreferenceOpenEvents(events)).toEqual([]);
    expect(errorTexts(events)).toEqual(["You don't have that item."]);
    expect(sim.countItem('field_kit', pid)).toBe(1);
  });

  it('opens while dead, in combat, and mid a non-spell busy cast, leaving cast state untouched', () => {
    const sim = makeScopedSim(EMPTY_TEST_WORLD);
    const { pid, p } = addTestPlayer(sim);
    sim.addItem('field_kit', 1, pid);
    p.dead = true;
    p.inCombat = true;
    p.castingAbility = GATHER_CAST_ID;
    p.castRemaining = 2.5;
    p.castTotal = 5;
    sim.drainEvents();

    sim.useItem('field_kit', pid);

    const events = sim.drainEvents();
    expect(harvestPreferenceOpenEvents(events)).toEqual([{ type: 'harvestPreferenceOpen', pid }]);
    // The authoritative harvest-start gates are separate: a settings action
    // like this one never touches real gameplay cast state.
    expect(p.castingAbility).toBe(GATHER_CAST_ID);
    expect(p.castRemaining).toBe(2.5);
    expect(p.castTotal).toBe(5);
    expect(p.dead).toBe(true);
    expect(p.inCombat).toBe(true);
  });

  it('scopes the event to the acting player only, leaving a second player untouched', () => {
    const sim = makeScopedSim(EMPTY_TEST_WORLD);
    const first = addTestPlayer(sim, 'Aleph');
    const second = addTestPlayer(sim, 'Beth');
    sim.addItem('field_kit', 1, first.pid);
    second.meta.copper = 12;
    sim.drainEvents();

    sim.useItem('field_kit', first.pid);

    const events = sim.drainEvents();
    expect(events).toEqual([{ type: 'harvestPreferenceOpen', pid: first.pid }]);
    expect(events[0].pid).not.toBe(second.pid);
    expect(sim.countItem('field_kit', second.pid)).toBe(0);
    expect(second.meta.copper).toBe(12);
  });
});
