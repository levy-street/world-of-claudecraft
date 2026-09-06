// Intentional Gathering PR3: the harvest preference through the REAL Sim
// integration seam (PlayerMeta, CharacterState, serializeCharacter/addPlayer),
// not just the pure harvest_preference.ts leaf (see tests/harvest_preference.test.ts,
// which owns the exact save-byte pins) or the admission leaf
// (tests/harvest_admission.test.ts). Contract exercised here:
//
//   PlayerMeta.harvestPreference: HarvestPreference | null (undefined -> legacy
//     All init, malformed rawstate -> null, retired bounded ids kept)
//   CharacterState.harvestPreference?: string | null
//   sim.harvestPreferenceFor(pid): HarvestPreference | null, cloned, unknown pid null
//   get sim.harvestPreference: HarvestPreference | null (primaryId)
//   sim.setHarvestPreference(raw, pid?): void, validated through
//     parseHarvestPreferenceCommand, touches only the resolved player, and
//     changes NOTHING else (town focus, copper, bags, tools): it is a setting,
//     not a harvest action, so it needs no field kit and works anywhere,
//     in combat included.
import { describe, expect, it } from 'vitest';
import {
  HARVEST_PREFERENCE_ALL,
  type HarvestPreference,
} from '../src/sim/professions/harvest_preference';
import type { CharacterState } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { makeSim, teleportTo } from './sim_shared';

function material(itemId: string): HarvestPreference {
  return { kind: 'material', itemId };
}

describe('the harvest preference through real Sim persistence', () => {
  it('defaults a fresh character to All, on both the per-pid and primary readers', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    expect(sim.harvestPreferenceFor(pid)).toEqual(HARVEST_PREFERENCE_ALL);
    expect(sim.harvestPreference).toEqual(HARVEST_PREFERENCE_ALL);
  });

  it('answers null for a pid nobody owns, never a default', () => {
    const sim = makeSim();
    expect(sim.harvestPreferenceFor(999999)).toBeNull();
  });

  it('defaults an old row that never carried the field (sparse legacy save) to All', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const state = sim.serializeCharacter(pid)!;
    expect(Object.hasOwn(state, 'harvestPreference')).toBe(false);

    const sim2 = new Sim({ seed: 1, playerClass: 'warrior' });
    const reloadedPid = sim2.addPlayer('warrior', 'Legacy', { state });
    expect(sim2.harvestPreferenceFor(reloadedPid)).toEqual(HARVEST_PREFERENCE_ALL);
  });

  it('round trips a chosen material across a full re-add into a fresh Sim', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.setHarvestPreference('rough_hide', pid);
    expect(sim.harvestPreferenceFor(pid)).toEqual(material('rough_hide'));

    const state = sim.serializeCharacter(pid)!;
    expect(state.harvestPreference).toBe('rough_hide');

    const sim2 = new Sim({ seed: 7, playerClass: 'warrior' });
    const reloadedPid = sim2.addPlayer('warrior', 'Reloaded', { state });
    expect(sim2.harvestPreferenceFor(reloadedPid)).toEqual(material('rough_hide'));
  });

  it('keeps a retired material id through a real character load, verbatim', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const baseState = sim.serializeCharacter(pid)!;
    const retiredState: CharacterState = { ...baseState, harvestPreference: 'retired_material' };

    const sim2 = new Sim({ seed: 3, playerClass: 'warrior' });
    const reloadedPid = sim2.addPlayer('warrior', 'Retired', { state: retiredState });
    expect(sim2.harvestPreferenceFor(reloadedPid)).toEqual(material('retired_material'));

    // Saving again writes the same retired id back rather than dropping it.
    const reserialized = sim2.serializeCharacter(reloadedPid)!;
    expect(reserialized.harvestPreference).toBe('retired_material');
  });

  it('refuses a malformed persisted value to null, saves it as JSON null, and stays refused across a second load', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const baseState = sim.serializeCharacter(pid)!;
    // A live save can never carry a number here; this models a corrupted or
    // hand-edited row, the boundary this suite is allowed to cast malformed
    // external input at.
    const malformedState = {
      ...baseState,
      harvestPreference: 42,
    } as unknown as CharacterState;

    const sim2 = new Sim({ seed: 11, playerClass: 'warrior' });
    const pid2 = sim2.addPlayer('warrior', 'Malformed', { state: malformedState });
    expect(sim2.harvestPreferenceFor(pid2)).toBeNull();

    // The refusal saves back as an explicit JSON null, never an omitted key
    // and never a silent revival into All.
    const savedOnce = sim2.serializeCharacter(pid2)!;
    expect(Object.hasOwn(savedOnce, 'harvestPreference')).toBe(true);
    expect(savedOnce.harvestPreference).toBeNull();

    // A real JSON round trip (the shape a JSONB column actually stores) still
    // refuses: null is not the legacy-absent case.
    const jsonRoundTripped = JSON.parse(JSON.stringify(savedOnce)) as CharacterState;
    const sim3 = new Sim({ seed: 12, playerClass: 'warrior' });
    const pid3 = sim3.addPlayer('warrior', 'MalformedAgain', { state: jsonRoundTripped });
    expect(sim3.harvestPreferenceFor(pid3)).toBeNull();

    const savedTwice = sim3.serializeCharacter(pid3)!;
    expect(savedTwice.harvestPreference).toBeNull();
  });

  it('recovers a malformed refused preference with one explicit valid command', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const baseState = sim.serializeCharacter(pid)!;
    const malformedState = {
      ...baseState,
      harvestPreference: 42,
    } as unknown as CharacterState;

    const sim2 = new Sim({ seed: 13, playerClass: 'warrior' });
    const pid2 = sim2.addPlayer('warrior', 'Recovers', { state: malformedState });
    expect(sim2.harvestPreferenceFor(pid2)).toBeNull();

    sim2.setHarvestPreference('rough_hide', pid2);
    expect(sim2.harvestPreferenceFor(pid2)).toEqual(material('rough_hide'));
  });

  it('leaves the current choice byte-identical on a malformed or unsupported command', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.setHarvestPreference('wolf_fang', pid);
    const before = sim.harvestPreferenceFor(pid);
    expect(before).toEqual(material('wolf_fang'));

    for (const raw of ['not_a_real_item', 'hide', 'tusk', 'pristine_hide', '']) {
      sim.setHarvestPreference(raw, pid);
      expect(sim.harvestPreferenceFor(pid), raw).toEqual(before);
    }
  });

  it('accepts the explicit All token, collapsing back to the same sparse save encoding as the untouched default', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.setHarvestPreference('rough_hide', pid);
    expect(sim.harvestPreferenceFor(pid)).toEqual(material('rough_hide'));

    sim.setHarvestPreference('all', pid);
    expect(sim.harvestPreferenceFor(pid)).toEqual(HARVEST_PREFERENCE_ALL);

    // savedHarvestPreference has no live encoding for "explicit All" distinct
    // from the sparse default: both omit the key entirely (harvest_preference.ts
    // "costs zero extra bytes for the default All preference"), so a character
    // who explicitly chose All serializes byte-identically to one who never
    // touched the setting at all.
    const state = sim.serializeCharacter(pid)!;
    expect(Object.hasOwn(state, 'harvestPreference')).toBe(false);
  });

  it('keeps two players fully isolated: setting one never touches the other', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pidA = sim.addPlayer('warrior', 'Alpha');
    const pidB = sim.addPlayer('mage', 'Beta');

    sim.setHarvestPreference('rough_hide', pidA);

    expect(sim.harvestPreferenceFor(pidA)).toEqual(material('rough_hide'));
    expect(sim.harvestPreferenceFor(pidB)).toEqual(HARVEST_PREFERENCE_ALL);

    // The no-pid form resolves to the primary player (the first one added),
    // never silently fanning out to every player in the world.
    sim.setHarvestPreference('wolf_fang');
    expect(sim.harvestPreferenceFor(pidA)).toEqual(material('wolf_fang'));
    expect(sim.harvestPreferenceFor(pidB)).toEqual(HARVEST_PREFERENCE_ALL);
  });

  it('hands back a clone the caller cannot use to mutate the owned choice', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.setHarvestPreference('wolf_fang', pid);

    const first = sim.harvestPreferenceFor(pid) as { kind: string; itemId?: string };
    expect(first).toEqual(material('wolf_fang'));
    first.itemId = 'tampered';

    const second = sim.harvestPreferenceFor(pid);
    expect(second).toEqual(material('wolf_fang'));
  });

  it('changes nothing else: no town focus, copper, inventory, bags, or tool state moves', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.serializeCharacter(pid)!;
    const copperBefore = sim.copper;
    const focusBefore = { ...sim.townFocusFor(pid) };
    const bagCapacityBefore = sim.bagCapacity;
    // A full snapshot of the actual inventory and bags, not a single-item
    // proxy: this is the "a setting touches nothing else" contract, so
    // anything a harvest action WOULD touch (loot, stack merges, bag socket
    // assignment) must come back byte-identical too.
    const inventoryBefore = structuredClone(meta.inventory);
    const bagsBefore = structuredClone(meta.bags);
    const toolEffectSlotsBefore = structuredClone(meta.toolEffectSlots ?? null);

    sim.setHarvestPreference('rough_hide', pid);

    expect(sim.copper).toBe(copperBefore);
    expect(sim.townFocusFor(pid)).toEqual(focusBefore);
    expect(sim.bagCapacity).toBe(bagCapacityBefore);
    const metaAfter = sim.serializeCharacter(pid)!;
    expect(structuredClone(metaAfter.inventory)).toEqual(inventoryBefore);
    expect(structuredClone(metaAfter.bags)).toEqual(bagsBefore);
    expect(structuredClone(metaAfter.toolEffectSlots ?? null)).toEqual(toolEffectSlotsBefore);
    // The one thing that DID change: the preference itself actually applied.
    expect(sim.harvestPreferenceFor(pid)).toEqual(material('rough_hide'));
  });

  it('permits setting the preference while the player is in combat', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.player.inCombat = true;

    expect(() => sim.setHarvestPreference('wolf_fang', pid)).not.toThrow();
    expect(sim.harvestPreferenceFor(pid)).toEqual(material('wolf_fang'));
  });

  it('never mutates the primary player when the target pid is unknown', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.setHarvestPreference('rough_hide', pid);
    const before = sim.harvestPreferenceFor(pid);

    expect(() => sim.setHarvestPreference('wolf_fang', 999999)).not.toThrow();

    expect(sim.harvestPreferenceFor(pid)).toEqual(before);
    expect(sim.harvestPreferenceFor(999999)).toBeNull();
  });

  it('requires no field kit and works both in town and far outside it', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    expect(sim.countItem('field_kit')).toBe(0);

    // In town (spawn position, untouched): a setting, not a harvest action.
    expect(() => sim.setHarvestPreference('rough_hide', pid)).not.toThrow();
    expect(sim.harvestPreferenceFor(pid)).toEqual(material('rough_hide'));

    // Far outside any settlement: still just a setting.
    teleportTo(sim, 900, 900);
    expect(() => sim.setHarvestPreference('wolf_fang', pid)).not.toThrow();
    expect(sim.harvestPreferenceFor(pid)).toEqual(material('wolf_fang'));
  });
});
