// The class power tuner's server runtime: the shipped-baseline catalog snapshot,
// the boot install, and the saved-versus-running state the dashboard renders.
// Paired module: server/class_tuning.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadClassTuning: vi.fn(),
  saveClassTuningChange: vi.fn(),
  listClassTuningHistory: vi.fn(),
}));

vi.mock('../server/class_tuning_db', () => ({
  loadClassTuning: mocks.loadClassTuning,
  saveClassTuningChange: mocks.saveClassTuningChange,
  listClassTuningHistory: mocks.listClassTuningHistory,
}));

import {
  classTuningCatalog,
  classTuningState,
  installRealmClassTuning,
  resetClassTuningRuntimeForTests,
  saveRealmClassTuning,
} from '../server/class_tuning';
import { ABILITIES } from '../src/sim/content/classes';
import { emptyClassTuningDocument, installClassTuning } from '../src/sim/tuning';

beforeEach(() => {
  mocks.loadClassTuning.mockReset();
  mocks.saveClassTuningChange.mockReset();
  mocks.listClassTuningHistory.mockReset();
  resetClassTuningRuntimeForTests();
});

afterEach(() => {
  // The install mutates the process-wide ability table; put it back so suite
  // ordering cannot leak a tuned def into an unrelated test.
  installClassTuning(emptyClassTuningDocument());
  resetClassTuningRuntimeForTests();
});

describe('the catalog snapshot', () => {
  it('covers every class with its specs and abilities', () => {
    const catalog = classTuningCatalog();
    expect(catalog.classes).toHaveLength(9);
    for (const entry of catalog.classes) {
      expect(entry.specs.length).toBeGreaterThan(0);
      expect(entry.abilities.length).toBeGreaterThan(0);
    }
  });

  it('is memoized, so boot can freeze the SHIPPED numbers before installing', async () => {
    const shipped = classTuningCatalog();
    mocks.loadClassTuning.mockResolvedValue({
      data: { version: 1, abilities: { thorns: { damage_reflect: 3 } } },
      updatedAt: '2026-08-01T00:00:00.000Z',
      updatedBy: 7,
    });
    await installRealmClassTuning();
    // Same object, and still the authored 3: a slider at 1.0 must keep meaning
    // "as shipped" on a realm that has already installed a tuning document.
    expect(classTuningCatalog()).toBe(shipped);
    const thorns = shipped.classes
      .find((entry) => entry.id === 'druid')
      ?.abilities.find((ability) => ability.id === 'thorns');
    const reflect = thorns?.channels.find((channel) => channel.channel === 'damage_reflect');
    expect(reflect?.sites[0].value).toBe(3);
    // ...while the live table really did move.
    expect((ABILITIES.thorns.effects[0] as { value: number }).value).toBe(9);
  });
});

describe('the boot install', () => {
  it('installs the realm document and reports it as running', async () => {
    mocks.loadClassTuning.mockResolvedValue({
      data: { version: 1, abilities: { thorns: { damage_reflect: 2 } } },
      updatedAt: '2026-08-01T00:00:00.000Z',
      updatedBy: 7,
    });
    const state = await installRealmClassTuning();
    expect(state.pendingRestart).toBe(false);
    expect(state.tunedAbilities).toBe(1);
    expect(state.tunedChannels).toBe(1);
    expect(state.savedAt).toBe('2026-08-01T00:00:00.000Z');
    expect((ABILITIES.thorns.effects[0] as { value: number }).value).toBe(6);
  });

  it('sanitizes the stored document before it reaches the world', async () => {
    mocks.loadClassTuning.mockResolvedValue({
      data: { abilities: { thorns: { damage_reflect: 999, bogus_channel: 2 } } },
      updatedAt: null,
      updatedBy: null,
    });
    const state = await installRealmClassTuning();
    expect(state.saved.abilities.thorns).toEqual({ damage_reflect: 3 });
    expect((ABILITIES.thorns.effects[0] as { value: number }).value).toBe(9);
  });

  it('boots on the shipped numbers when the tuning row cannot be read', async () => {
    // A balance document must never be able to keep a realm down.
    const shipped = ABILITIES.thorns;
    mocks.loadClassTuning.mockRejectedValue(new Error('db down'));
    const state = await installRealmClassTuning();
    expect(state.saved.abilities).toEqual({});
    expect(state.pendingRestart).toBe(false);
    expect(ABILITIES.thorns).toBe(shipped);
  });

  it("boots cleanly when the stored row carries a 'constructor' ability id", async () => {
    // The round-two CRITICAL on PR #3337: ABILITIES['constructor'] answers the
    // inherited Object function through the prototype chain, so before the
    // reserved-id gate this row passed the shipped-def check and threw inside
    // the walker at EVERY restart until the row was hand-edited out.
    mocks.loadClassTuning.mockResolvedValue({
      data: {
        version: 1,
        abilities: { constructor: { cooldown: 1.5 }, thorns: { damage_reflect: 2 } },
        weapons: { constructor: { swing_damage: 2 } },
      },
      updatedAt: '2026-08-01T00:00:00.000Z',
      updatedBy: 7,
    });
    const state = await installRealmClassTuning();
    expect(state.pendingRestart).toBe(false);
    // the reserved row is gone, the legitimate one still installed (hasOwn,
    // because `.constructor` on a plain object answers the inherited function)
    expect(Object.hasOwn(state.saved.abilities, 'constructor')).toBe(false);
    expect(state.tunedAbilities).toBe(1);
    expect(state.tunedWeapons).toBe(0);
    expect((ABILITIES.thorns.effects[0] as { value: number }).value).toBe(6);
  });
});

describe('saving', () => {
  it('persists the sanitized document and marks a restart pending', async () => {
    mocks.loadClassTuning.mockResolvedValue({ data: {}, updatedAt: null, updatedBy: null });
    await installRealmClassTuning();
    mocks.saveClassTuningChange.mockResolvedValue({
      changed: true,
      updatedAt: '2026-08-02T00:00:00.000Z',
    });

    const outcome = await saveRealmClassTuning(
      { abilities: { thorns: { damage_reflect: 1.5, nonsense: 4 } } },
      7,
      'nerf reflect',
    );

    expect(outcome.changed).toBe(true);
    // The world is still on the numbers it booted with: the save is pending.
    expect(outcome.state.pendingRestart).toBe(true);
    expect(outcome.state.active.abilities).toEqual({});
    expect(ABILITIES.thorns.effects[0]).toEqual({
      type: 'buffTarget',
      kind: 'thorns',
      value: 3,
      duration: 600,
    });
    // Only the sanitized document reaches Postgres, so a row this process would
    // refuse to apply can never be stored.
    expect(mocks.saveClassTuningChange).toHaveBeenCalledWith(
      { version: 1, abilities: { thorns: { damage_reflect: 1.5 } }, weapons: {} },
      7,
      'nerf reflect',
    );
  });

  it('reports no pending restart when the save matches what is running', async () => {
    mocks.loadClassTuning.mockResolvedValue({
      data: { version: 1, abilities: { thorns: { damage_reflect: 1.5 } } },
      updatedAt: '2026-08-01T00:00:00.000Z',
      updatedBy: 7,
    });
    await installRealmClassTuning();
    mocks.saveClassTuningChange.mockResolvedValue({ changed: false, updatedAt: null });

    const outcome = await saveRealmClassTuning(
      { abilities: { thorns: { damage_reflect: 1.5 } } },
      7,
      '',
    );
    expect(outcome.state.pendingRestart).toBe(false);
  });

  it('truncates a note past the documented ceiling', async () => {
    mocks.loadClassTuning.mockResolvedValue({ data: {}, updatedAt: null, updatedBy: null });
    await installRealmClassTuning();
    mocks.saveClassTuningChange.mockResolvedValue({ changed: true, updatedAt: null });
    await saveRealmClassTuning({ abilities: {} }, 7, 'y'.repeat(2000));
    expect(mocks.saveClassTuningChange.mock.calls[0][2]).toHaveLength(500);
  });
});

describe('state before boot', () => {
  it('reads as an untuned realm rather than throwing', () => {
    const state = classTuningState();
    expect(state.saved.abilities).toEqual({});
    expect(state.pendingRestart).toBe(false);
    expect(state.tunedChannels).toBe(0);
  });
});
