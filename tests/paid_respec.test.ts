// Exercises the $WOC-paid respec + loadout-slot feature (#472) at the sim-pure
// and config layers:
//   - src/sim/progression/paid_respec.ts: the offline state transforms a paid
//     action applies to a character's persisted JSONB (respec, unlock slot, caps).
//   - the live Sim guard that a respec / loadout swap is rejected in combat.
//   - server/woc_config.ts: the exact burn-amount base units for each price key.
// The server action + confirm/dedupe/flag layer is covered in respec_actions.test.ts.
import { describe, expect, it } from 'vitest';
import { splitPrice, WOC_DECIMALS, wocPriceBase } from '../server/woc_config';
import {
  DEFAULT_LOADOUT_SLOTS,
  emptyAllocation,
  MAX_LOADOUT_SLOTS,
} from '../src/sim/content/talents';
import {
  canUnlockLoadoutSlot,
  loadoutSlotCap,
  respecCharacterState,
  unlockLoadoutSlot,
} from '../src/sim/progression/paid_respec';
import type { CharacterState } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { MAX_LEVEL } from '../src/sim/types';

// A minimal persisted state with talents spent + saved loadouts, enough to prove
// the transforms touch exactly what they should and nothing else.
function stateWith(over: Partial<CharacterState> = {}): CharacterState {
  return {
    level: 20,
    xp: 0,
    copper: 0,
    hp: 100,
    resource: 0,
    pos: { x: 0, z: 0 },
    facing: 0,
    equipment: {} as any,
    inventory: [],
    talents: { spec: 'arms', ranks: { deep_wounds: 3, impale: 2 }, choices: {} },
    loadouts: [{ name: 'PvP', alloc: emptyAllocation(), bar: [] }],
    ...over,
  } as CharacterState;
}

describe('respecCharacterState (respec happy path)', () => {
  it('wipes spent ranks, keeps the spec, and leaves saved loadouts untouched', () => {
    const before = stateWith();
    const after = respecCharacterState(before);
    expect(after.talents).toEqual({ spec: 'arms', ranks: {}, choices: {} });
    // Saved builds are NOT destroyed by a respec.
    expect(after.loadouts).toEqual(before.loadouts);
    // Pure transform: the input is not mutated in place.
    expect(before.talents?.ranks).toEqual({ deep_wounds: 3, impale: 2 });
  });

  it('respec on a character with no talents object still yields a clean empty allocation', () => {
    const after = respecCharacterState(stateWith({ talents: undefined }));
    expect(after.talents).toEqual({ spec: null, ranks: {}, choices: {} });
  });
});

describe('loadout-slot unlock + cap enforcement', () => {
  it('a fresh character sits at the default cap and can unlock', () => {
    const s = stateWith({ loadoutSlots: undefined });
    expect(loadoutSlotCap(s)).toBe(DEFAULT_LOADOUT_SLOTS);
    expect(canUnlockLoadoutSlot(s)).toBe(true);
  });

  it('each unlock raises the effective cap by exactly one', () => {
    let s = stateWith({ loadoutSlots: 0 });
    const next = unlockLoadoutSlot(s);
    expect(next).not.toBeNull();
    s = next as CharacterState;
    expect(s.loadoutSlots).toBe(1);
    expect(loadoutSlotCap(s)).toBe(DEFAULT_LOADOUT_SLOTS + 1);
  });

  it('refuses to unlock past the hard ceiling (no paid no-op)', () => {
    // Bonus that already lands the cap at MAX_LOADOUT_SLOTS.
    const atCeiling = MAX_LOADOUT_SLOTS - DEFAULT_LOADOUT_SLOTS;
    const s = stateWith({ loadoutSlots: atCeiling });
    expect(loadoutSlotCap(s)).toBe(MAX_LOADOUT_SLOTS);
    expect(canUnlockLoadoutSlot(s)).toBe(false);
    expect(unlockLoadoutSlot(s)).toBeNull();
  });
});

describe('live Sim rejects a respec / loadout swap in combat', () => {
  it('respec is refused while the player is in combat, allowed out of it', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(MAX_LEVEL);
    sim.player.inCombat = true;
    expect(sim.respec()).toBe(false);
    sim.player.inCombat = false;
    expect(sim.respec()).toBe(true);
  });

  it('a saved-loadout swap is refused while in combat', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(MAX_LEVEL);
    expect(sim.saveLoadout('Build A', [])).toBe(0);
    sim.player.inCombat = true;
    expect(sim.switchLoadout(0)).toBe(false);
  });
});

describe('burn-amount exactness (woc_config)', () => {
  it('respec / loadout_slot prices convert to the exact base units', () => {
    const unit = 10n ** BigInt(WOC_DECIMALS);
    // Defaults: 750 $WOC respec, 1500 $WOC per loadout slot.
    expect(wocPriceBase('respec')).toBe(750n * unit);
    expect(wocPriceBase('loadout_slot')).toBe(1500n * unit);
  });

  it('the whole price is burned under the default 100% burn config', () => {
    const price = wocPriceBase('respec');
    const { burnBase, treasuryBase } = splitPrice(price);
    expect(burnBase).toBe(price);
    expect(treasuryBase).toBe(0n);
    // Burn + treasury always covers the price exactly (no dust leak).
    expect(burnBase + treasuryBase).toBe(price);
  });
});
