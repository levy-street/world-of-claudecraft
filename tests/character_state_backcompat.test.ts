import { describe, expect, it } from 'vitest';
import type { CharacterState } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';

// JSONB character-state back-compat round-trip (Phase 20).
//
// WHAT THIS PINS: character state is persisted as a JSONB blob and reloaded
// through Sim.addPlayer, which applies defensive `??` defaults for fields that
// were added after some rows were saved (vendorBuyback ?? [], delveClears ?? {},
// companionUpgrades ?? {} in addPlayer). This is the contract that lets an OLD
// row, written before a field existed, load without throwing once new fields
// ship. We serialize a live character, strip those defaulted keys to simulate
// such an old row, and prove the reload does not throw and the defaults apply.

function makeSim(): Sim {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
}

describe('character state JSONB back-compat', () => {
  it('loads an old row missing later-added defaulted fields without throwing', () => {
    const sim = makeSim();
    const pid = sim.playerId;

    // Populate the defaulted fields so the serialized blob genuinely carries
    // them; stripping them below then models a row saved before they existed.
    const meta = (
      sim as unknown as {
        players: Map<number, { vendorBuyback: unknown; delveClears: unknown }>;
      }
    ).players.get(pid)!;
    meta.vendorBuyback = [{ itemId: 'roasted_boar', count: 2 }];
    meta.delveClears = { d_reservoir: 3 };

    const state = sim.serializeCharacter(pid)!;
    expect(state.vendorBuyback).toEqual([{ itemId: 'roasted_boar', count: 2 }]);
    expect(state.delveClears).toEqual({ d_reservoir: 3 });

    // Round-trip through JSON, then drop the fields a pre-migration row lacks.
    const stripped = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    delete stripped.vendorBuyback;
    delete stripped.delveClears;
    delete stripped.companionUpgrades;

    // Loading the stripped row must not throw, and the `??` defaults apply.
    const sim2 = new Sim({ seed: 1, playerClass: 'warrior' });
    let reloadedPid = -1;
    expect(() => {
      reloadedPid = sim2.addPlayer('warrior', 'Reloaded', {
        state: stripped as unknown as CharacterState,
      });
    }).not.toThrow();

    const reloadedMeta = (
      sim2 as unknown as {
        players: Map<
          number,
          { vendorBuyback: unknown; delveClears: unknown; companionUpgrades: unknown }
        >;
      }
    ).players.get(reloadedPid)!;
    expect(reloadedMeta.vendorBuyback).toEqual([]);
    expect(reloadedMeta.delveClears).toEqual({});
    expect(reloadedMeta.companionUpgrades).toEqual({});

    // And it re-serializes cleanly with the defaults in place.
    const reserialized = sim2.serializeCharacter(reloadedPid)!;
    expect(reserialized.vendorBuyback).toEqual([]);
    expect(reserialized.delveClears).toEqual({});
    expect(reserialized.companionUpgrades).toEqual({});
  });
});
