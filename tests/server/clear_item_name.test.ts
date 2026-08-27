// The legendary-name strip core (server/clear_item_name.ts): target
// validation (explicit-sweep, allowlisted bag id), the blob region walk (the
// rekeyInstanceSigner regions), and the runClearItemName endpoint body's
// ordering contract (validate, offline, audit, load-strip, the pre-save
// online re-check, save) over an injected deps bag. The RouteDef arm rides
// the admin.test.ts rig ('phase 13 legendary-name strip' there).
import { describe, expect, it, vi } from 'vitest';
import {
  type ClearItemNameDeps,
  clearItemNameBodyError,
  clearItemNameTarget,
  describeClearItemNameTarget,
  runClearItemName,
  stripLegendaryNames,
} from '../../server/clear_item_name';
import type { CharacterState } from '../../src/sim/sim';
import type { ItemInstancePayload } from '../../src/sim/types';

const NAMED: ItemInstancePayload = {
  signer: 'Forger',
  rolled: { quality: 'legendary', stats: { str: 4 } },
  name: 'Dawnbreaker',
  boundTo: 7,
};

function namedCopy(name = 'Dawnbreaker'): ItemInstancePayload {
  return JSON.parse(JSON.stringify({ ...NAMED, name }));
}

function stateWith(overrides: Partial<CharacterState>): CharacterState {
  return {
    level: 20,
    xp: 0,
    copper: 0,
    hp: 100,
    resource: 100,
    pos: { x: 0, z: 0 },
    facing: 0,
    equipment: {},
    inventory: [],
    questLog: [],
    ...overrides,
  } as unknown as CharacterState;
}

describe('clearItemNameBodyError / clearItemNameTarget', () => {
  it('accepts the three EXPLICIT target shapes and maps them', () => {
    expect(clearItemNameBodyError({ slot: 'neck' })).toBeNull();
    expect(clearItemNameTarget({ slot: 'neck' })).toEqual({ kind: 'slot', slot: 'neck' });
    expect(clearItemNameBodyError({ bag: 3, itemId: 'wyrmfall_pendant' })).toBeNull();
    expect(clearItemNameTarget({ bag: 3, itemId: 'wyrmfall_pendant' })).toEqual({
      kind: 'bag',
      bag: 3,
      itemId: 'wyrmfall_pendant',
    });
    // The whole-character sweep is opt-in: the literal `all: true`, never an
    // empty body (a reason-only request must not quietly strip everything).
    expect(clearItemNameBodyError({ all: true })).toBeNull();
    expect(clearItemNameTarget({ all: true })).toEqual({ kind: 'all' });
  });

  it('refuses a body naming no target (reason-only included), naming the three forms', () => {
    const threeForms = 'name exactly one target: a worn slot, a bag cell, or all: true';
    expect(clearItemNameBodyError({})).toBe(threeForms);
    // The reason field is not a target; a reason-only body is the exact
    // request the explicit sweep exists to refuse.
    expect(clearItemNameBodyError({ reason: 'slur' } as never)).toBe(threeForms);
  });

  it('refuses a non-literal all and any mixed target', () => {
    const threeForms = 'name exactly one target: a worn slot, a bag cell, or all: true';
    expect(clearItemNameBodyError({ all: 'yes' })).toBe('all must be the literal true');
    expect(clearItemNameBodyError({ all: 1 })).toBe('all must be the literal true');
    expect(clearItemNameBodyError({ all: false })).toBe('all must be the literal true');
    expect(clearItemNameBodyError({ all: true, slot: 'neck' })).toBe(threeForms);
    expect(clearItemNameBodyError({ all: true, bag: 0, itemId: 'wyrmfall_pendant' })).toBe(
      threeForms,
    );
  });

  it('refuses each malformed dimension with its own prose', () => {
    expect(clearItemNameBodyError({ slot: 'hat' })).toBe('unknown equipment slot');
    expect(clearItemNameBodyError({ slot: 3 })).toBe('unknown equipment slot');
    expect(clearItemNameBodyError({ slot: 'neck', bag: 0, itemId: 'x' })).toBe(
      'name exactly one target: a worn slot, a bag cell, or all: true',
    );
    expect(clearItemNameBodyError({ bag: 0 })).toBe(
      'a bag target needs both the cell index and its item id',
    );
    expect(clearItemNameBodyError({ itemId: 'x' })).toBe(
      'a bag target needs both the cell index and its item id',
    );
    expect(clearItemNameBodyError({ bag: 1.5, itemId: 'x' })).toBe(
      'bag must be a non-negative whole number',
    );
    expect(clearItemNameBodyError({ bag: -1, itemId: 'x' })).toBe(
      'bag must be a non-negative whole number',
    );
    expect(clearItemNameBodyError({ bag: '0', itemId: 'x' })).toBe(
      'bag must be a non-negative whole number',
    );
    expect(clearItemNameBodyError({ bag: 0, itemId: '' })).toBe('unknown item id');
    expect(clearItemNameBodyError({ bag: 0, itemId: 7 })).toBe('unknown item id');
    expect(clearItemNameBodyError({ bag: 0, itemId: 'x'.repeat(65) })).toBe('unknown item id');
    // The allowlist arm (the restoreItemBodyError precedent): a well-shaped id
    // the ITEMS table does not carry is refused, so free text never reaches
    // the audit reason's folded detail.
    expect(clearItemNameBodyError({ bag: 0, itemId: 'not_a_real_item' })).toBe('unknown item id');
    expect(clearItemNameBodyError({ bag: 0, itemId: 'hasOwnProperty' })).toBe('unknown item id');
  });

  it('describes each target for the audit detail', () => {
    expect(describeClearItemNameTarget({ kind: 'slot', slot: 'neck' })).toBe('slot neck');
    expect(describeClearItemNameTarget({ kind: 'bag', bag: 3, itemId: 'wyrmfall_pendant' })).toBe(
      'bag 3 wyrmfall_pendant',
    );
    expect(describeClearItemNameTarget({ kind: 'all' })).toBe('all copies');
  });
});

describe('stripLegendaryNames', () => {
  it('a slot target strips the worn payload under BOTH equipment-map spellings', () => {
    const state = stateWith({
      equipmentInstance: { neck: namedCopy() },
      equipmentInstances: { neck: namedCopy(), ring1: namedCopy('Elsewhere') },
    });
    expect(stripLegendaryNames(state, { kind: 'slot', slot: 'neck' })).toBe(2);
    expect(state.equipmentInstance?.neck?.name).toBeUndefined();
    expect(state.equipmentInstances?.neck?.name).toBeUndefined();
    // Only the name leaves: the promotion, stats, signer, and bind stand.
    expect(state.equipmentInstance?.neck?.rolled).toEqual({
      quality: 'legendary',
      stats: { str: 4 },
    });
    expect(state.equipmentInstance?.neck?.signer).toBe('Forger');
    expect(state.equipmentInstance?.neck?.boundTo).toBe(7);
    // An untargeted slot is untouched.
    expect(state.equipmentInstances?.ring1?.name).toBe('Elsewhere');
  });

  it('a bag target strips only its exact cell, and only while the item id still matches', () => {
    const state = stateWith({
      inventory: [
        { itemId: 'makers_ember', count: 3 },
        { itemId: 'wyrmfall_pendant', count: 1, instance: namedCopy() },
        { itemId: 'wyrmfall_pendant', count: 1, instance: namedCopy('Sibling') },
      ],
    });
    // A shifted stack (the id no longer matches the cell) strips nothing.
    expect(stripLegendaryNames(state, { kind: 'bag', bag: 1, itemId: 'other_item' })).toBe(0);
    expect(state.inventory[1].instance?.name).toBe('Dawnbreaker');
    expect(stripLegendaryNames(state, { kind: 'bag', bag: 1, itemId: 'wyrmfall_pendant' })).toBe(1);
    expect(state.inventory[1].instance?.name).toBeUndefined();
    expect(state.inventory[2].instance?.name).toBe('Sibling');
    // Out-of-range and unnamed cells answer zero rather than throwing.
    expect(stripLegendaryNames(state, { kind: 'bag', bag: 9, itemId: 'x' })).toBe(0);
    expect(stripLegendaryNames(state, { kind: 'bag', bag: 0, itemId: 'makers_ember' })).toBe(0);
  });

  it('the whole-character sweep walks all five payload regions', () => {
    const state = stateWith({
      inventory: [{ itemId: 'wyrmfall_pendant', count: 1, instance: namedCopy('Carried') }],
      bank: {
        inventory: [{ itemId: 'warhewn_signet', count: 1, instance: namedCopy('Banked') }],
      } as never,
      vendorBuyback: [{ itemId: 'wyrmfall_pendant', count: 1, instance: namedCopy('Sold') }],
      equipmentInstance: { neck: namedCopy('Worn') },
      equipmentInstances: { ring1: namedCopy('Legacy') },
    });
    expect(stripLegendaryNames(state, { kind: 'all' })).toBe(5);
    expect(state.inventory[0].instance?.name).toBeUndefined();
    expect(state.bank?.inventory[0].instance?.name).toBeUndefined();
    expect(state.vendorBuyback?.[0].instance?.name).toBeUndefined();
    expect(state.equipmentInstance?.neck?.name).toBeUndefined();
    expect(state.equipmentInstances?.ring1?.name).toBeUndefined();
    // Plain stacks and payloads with no name are untouched and uncounted.
    expect(stripLegendaryNames(state, { kind: 'all' })).toBe(0);
  });
});

describe('runClearItemName (the endpoint body over injected deps)', () => {
  function makeDeps(overrides: Partial<ClearItemNameDeps> = {}) {
    const state = stateWith({
      inventory: [{ itemId: 'wyrmfall_pendant', count: 1, instance: namedCopy() }],
    });
    const recordAudit = vi.fn(async () => ({ accountId: 9 }));
    const saveCharacterState = vi.fn(async () => true);
    const deps: ClearItemNameDeps = {
      characterOnline: () => false,
      loadCharacter: async () => ({ level: 20, state }),
      saveCharacterState,
      recordAudit,
      ...overrides,
    };
    return { deps, state, recordAudit, saveCharacterState };
  }

  it('audits FIRST, then loads, strips, and saves the stripped blob', async () => {
    const { deps, state, recordAudit, saveCharacterState } = makeDeps();
    const outcome = await runClearItemName(deps, {
      characterId: 5,
      adminAccountId: 7,
      body: { bag: 0, itemId: 'wyrmfall_pendant', reason: 'slur in the name' },
    });
    expect(outcome).toEqual({ ok: true, cleared: 1 });
    expect(recordAudit).toHaveBeenCalledWith({
      characterId: 5,
      adminAccountId: 7,
      detail: 'bag 0 wyrmfall_pendant',
      reason: 'slur in the name',
    });
    expect(saveCharacterState).toHaveBeenCalledWith(5, 20, state);
    expect(state.inventory[0].instance?.name).toBeUndefined();
    // A strip may never exist unaudited: the audit row precedes the save.
    expect(recordAudit.mock.invocationCallOrder[0]).toBeLessThan(
      saveCharacterState.mock.invocationCallOrder[0],
    );
  });

  it('refuses an ONLINE character before any audit write (the offline-writer doctrine)', async () => {
    const { deps, recordAudit, saveCharacterState } = makeDeps({
      characterOnline: vi.fn(() => true),
    });
    const outcome = await runClearItemName(deps, {
      characterId: 5,
      adminAccountId: 7,
      body: { all: true, reason: 'slur' },
    });
    expect(outcome).toEqual({
      ok: false,
      error: 'character is online on this realm; disconnect them first',
    });
    expect(recordAudit).not.toHaveBeenCalled();
    expect(saveCharacterState).not.toHaveBeenCalled();
  });

  it('re-checks online IMMEDIATELY before the save and refuses without writing (the login race)', async () => {
    // The online check flips between the pre-check (false, so the strip
    // proceeds) and the pre-save re-check (true: the character logged in
    // mid-strip). The save must not land: the live session's autosave would
    // clobber it anyway, so the refusal names the kick-and-retry flow. The
    // audit row already recorded the REQUEST honestly ("requested" prose).
    const online = vi
      .fn(() => false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const { deps, recordAudit, saveCharacterState } = makeDeps({ characterOnline: online });
    const outcome = await runClearItemName(deps, {
      characterId: 5,
      adminAccountId: 7,
      body: { bag: 0, itemId: 'wyrmfall_pendant', reason: 'slur' },
    });
    expect(outcome).toEqual({
      ok: false,
      error: 'character came online before the strip landed; kick them and retry',
    });
    expect(online).toHaveBeenCalledTimes(2);
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(saveCharacterState).not.toHaveBeenCalled();
  });

  it('refuses a malformed target before any audit write', async () => {
    const { deps, recordAudit } = makeDeps();
    const outcome = await runClearItemName(deps, {
      characterId: 5,
      adminAccountId: 7,
      body: { slot: 'hat', reason: 'slur' },
    });
    expect(outcome).toEqual({ ok: false, error: 'unknown equipment slot' });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('a no-match strip answers its own error AFTER the audit and never saves', async () => {
    const { deps, recordAudit, saveCharacterState } = makeDeps();
    const outcome = await runClearItemName(deps, {
      characterId: 5,
      adminAccountId: 7,
      body: { slot: 'neck', reason: 'nothing worn there' },
    });
    expect(outcome).toEqual({ ok: false, error: 'no named copy matched that target' });
    expect(recordAudit).toHaveBeenCalled();
    expect(saveCharacterState).not.toHaveBeenCalled();
  });

  it('a vanished character answers character not found after the audit', async () => {
    const { deps, saveCharacterState } = makeDeps({ loadCharacter: vi.fn(async () => null) });
    const outcome = await runClearItemName(deps, {
      characterId: 5,
      adminAccountId: 7,
      body: { all: true, reason: 'slur' },
    });
    expect(outcome).toEqual({ ok: false, error: 'character not found' });
    expect(saveCharacterState).not.toHaveBeenCalled();
  });
});
