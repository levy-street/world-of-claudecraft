import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import type { CharacterState } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';

// JSONB character-state back-compat round-trip.
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
        players: Map<number, { vendorBuyback: unknown; delveClears: unknown; bank: unknown }>;
      }
    ).players.get(pid)!;
    meta.vendorBuyback = [{ itemId: 'roasted_boar', count: 2 }];
    meta.delveClears = { d_reservoir: 3 };
    meta.bank = {
      inventory: [{ itemId: 'wolf_fang', count: 3 }],
      purchasedSlots: 6,
      bonusSlots: 0,
      // Live meta always carries the socket fields and the applied
      // storage-purchase keys (sanitize materializes all three); at their
      // defaults the serializer omits them, which the 3-field state.bank
      // expectation below deliberately pins.
      unlockedSockets: 0,
      socketBags: [null, null, null, null],
      appliedStorageKeys: [],
    };

    const state = sim.serializeCharacter(pid)!;
    // Legacy unsigned rows save with explicit unknown-source units.
    expect(state.vendorBuyback).toEqual([
      { itemId: 'roasted_boar', count: 2, materialSources: [{ source: {}, count: 2 }] },
    ]);
    expect(state.delveClears).toEqual({ d_reservoir: 3 });
    expect(state.bank).toEqual({
      inventory: [{ itemId: 'wolf_fang', count: 3, materialSources: [{ source: {}, count: 3 }] }],
      purchasedSlots: 6,
      bonusSlots: 0,
    });

    // Round-trip through JSON, then drop the fields a pre-migration row lacks.
    const stripped = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    delete stripped.vendorBuyback;
    delete stripped.delveClears;
    delete stripped.companionUpgrades;
    delete stripped.bank;

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
          {
            vendorBuyback: unknown;
            delveClears: unknown;
            companionUpgrades: unknown;
            bank: unknown;
          }
        >;
      }
    ).players.get(reloadedPid)!;
    expect(reloadedMeta.vendorBuyback).toEqual([]);
    expect(reloadedMeta.delveClears).toEqual({});
    expect(reloadedMeta.companionUpgrades).toEqual({});
    expect(reloadedMeta.bank).toEqual({
      inventory: [],
      purchasedSlots: 0,
      bonusSlots: 0,
      unlockedSockets: 0,
      socketBags: [null, null, null, null],
      appliedStorageKeys: [],
    });

    // And it re-serializes cleanly with the defaults in place.
    const reserialized = sim2.serializeCharacter(reloadedPid)!;
    expect(reserialized.vendorBuyback).toEqual([]);
    expect(reserialized.delveClears).toEqual({});
    expect(reserialized.companionUpgrades).toEqual({});
    expect(reserialized.bank).toEqual({ inventory: [], purchasedSlots: 0, bonusSlots: 0 });
    expect(reserialized).toEqual({
      ...state,
      vendorBuyback: [],
      delveClears: {},
      companionUpgrades: {},
      bank: { inventory: [], purchasedSlots: 0, bonusSlots: 0 },
    });

    const sim3 = makeSim();
    const canonicalPid = sim3.addPlayer('warrior', 'Reloaded', { state: reserialized });
    expect(sim3.serializeCharacter(canonicalPid)).toEqual(reserialized);
  });

  it('loads an old row still carrying the removed Town Focus fields and its deed', () => {
    // Town Focus left the game on 2026-11-04 (the professions consolidation).
    // Rows written by older builds still carry `townFocus` (always, as `{}`
    // or an allocation), sometimes `pendingTownFocus` (a queued re-spec), and
    // the earned record of its deed `soc_civic_duty`, which left DEED_ORDER
    // with it. All three must load without throwing, the two blobs must be
    // dropped on the next write (never normalized or round-tripped), and the
    // earned record must stay harmless: `recomputeRenown` is catalog-bounded,
    // so the 5 Renown it used to score fall away on load (docs/design/deeds.md,
    // rule 5's third recorded consequence), and the loaded world keeps ticking.
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)!;
    const legacy = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    legacy.townFocus = { hide: 4, silk: 6 };
    legacy.pendingTownFocus = {
      allocation: { fang: 10 },
      remainingSeconds: 30,
      coin: 5,
      materials: 1,
    };
    legacy.deeds = {
      ...((legacy.deeds as Record<string, string> | undefined) ?? {}),
      soc_civic_duty: '2026-10-01',
    };

    const sim2 = new Sim({ seed: 1, playerClass: 'warrior' });
    let pid = -1;
    expect(() => {
      pid = sim2.addPlayer('warrior', 'Reloaded', { state: legacy as unknown as CharacterState });
    }).not.toThrow();
    expect(() => {
      for (let i = 0; i < 40; i++) sim2.tick();
    }).not.toThrow();

    const reserialized = sim2.serializeCharacter(pid)!;
    expect('townFocus' in reserialized).toBe(false);
    expect('pendingTownFocus' in reserialized).toBe(false);
    // The earned day is kept verbatim (the Book never drops an earned record),
    // but the removed deed scores nothing.
    expect(reserialized.deeds?.soc_civic_duty).toBe('2026-10-01');
    // Renown is re-derived from the live catalog on load: the removed deed
    // contributes 0, so the total equals the catalog sum of the OTHER earned
    // ids (a literal, not a same-path comparison), and a positive control
    // with a live 25-Renown deed added scores exactly 25 more.
    const liveRenown = Object.keys(reserialized.deeds ?? {})
      .filter((id) => id !== 'soc_civic_duty')
      .reduce((sum, id) => sum + (DEEDS[id]?.renown ?? 0), 0);
    expect(reserialized.renown ?? 0).toBe(liveRenown);
    expect(DEEDS.soc_wyrms_hoard.renown).toBe(25);
    const control = new Sim({ seed: 1, playerClass: 'warrior' });
    const controlPid = control.addPlayer('warrior', 'Control', {
      state: {
        ...legacy,
        deeds: { ...(legacy.deeds as Record<string, string>), soc_wyrms_hoard: '2026-10-02' },
      } as unknown as CharacterState,
    });
    expect(control.serializeCharacter(controlPid)!.renown ?? 0).toBe(liveRenown + 25);
  });
});
