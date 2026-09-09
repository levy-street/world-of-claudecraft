// The legendary-name strip core (server/clear_item_name.ts): target
// validation (explicit-sweep, shape-bounded bag id), the blob region walk (the
// rekeyInstanceSigner regions), and the runClearItemName endpoint body's
// ordering contract (validate, choose live/offline, audit, atomic strip)
// over an injected deps bag. The RouteDef arm rides
// the admin.test.ts rig ('phase 13 legendary-name strip' there).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CHARACTER_SAVE_LEASED_LINE } from '../../server/character_save_statement';
import {
  type ClearItemNameDeps,
  type ClearItemNameOutcome,
  clearItemNameBodyError,
  clearItemNameTarget,
  describeClearItemNameTarget,
  runClearItemName,
  stripLegendaryNames,
} from '../../server/clear_item_name';
import { BACKPACK_SLOTS, BAG_SOCKETS, bagSlotsOf } from '../../src/sim/bags';
import { ITEMS } from '../../src/sim/data';
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
      'bag must be a whole number from 0 to 1023',
    );
    expect(clearItemNameBodyError({ bag: -1, itemId: 'x' })).toBe(
      'bag must be a whole number from 0 to 1023',
    );
    expect(clearItemNameBodyError({ bag: '0', itemId: 'x' })).toBe(
      'bag must be a whole number from 0 to 1023',
    );
    expect(clearItemNameBodyError({ bag: 0, itemId: '' })).toBe('unknown item id');
    expect(clearItemNameBodyError({ bag: 0, itemId: 7 })).toBe('unknown item id');
    expect(clearItemNameBodyError({ bag: 0, itemId: 'x'.repeat(65) })).toBe('unknown item id');
    // The SHAPE bound (the signer doctrine: a persisted id survives
    // shape-bounded validation, never a catalog filter, so retired ids stay
    // reachable; src/sim/professions/training.ts sanitizeKnownRecipeIds is the
    // sim's own statement of it). Free text, spaces, quotes, and control
    // bytes are refused so they never reach the audit reason's folded detail.
    expect(clearItemNameBodyError({ bag: 0, itemId: 'not a real item' })).toBe('unknown item id');
    expect(clearItemNameBodyError({ bag: 0, itemId: "x'; DROP TABLE" })).toBe('unknown item id');
    expect(clearItemNameBodyError({ bag: 0, itemId: 'slur\nline' })).toBe('unknown item id');
    expect(clearItemNameBodyError({ bag: 0, itemId: 'wyrmfall pendant' })).toBe('unknown item id');
    expect(clearItemNameBodyError({ bag: 0, itemId: 'pendant/../etc' })).toBe('unknown item id');
  });

  it('bounds the bag index ABOVE as well as below, both edges', () => {
    // The Phase 18 security review's A3: Number.isInteger answers TRUE for
    // 1e21, so the lower-bound-only check let a request reach the audit row
    // and render its folded detail as `bag 1e+21`, and any absurd index
    // bought a pointless load-strip-and-refuse round trip. Both edges are
    // pinned by LITERAL here, never rebuilt from the module's own constant,
    // so a moved bound reds rather than following itself.
    expect(clearItemNameBodyError({ bag: 0, itemId: 'wyrmfall_pendant' })).toBeNull();
    expect(clearItemNameBodyError({ bag: 1023, itemId: 'wyrmfall_pendant' })).toBeNull();
    expect(clearItemNameBodyError({ bag: 1024, itemId: 'wyrmfall_pendant' })).toBe(
      'bag must be a whole number from 0 to 1023',
    );
    // The offending shapes the old check admitted, and the ones it already
    // refused, under the one message.
    for (const bag of [1e21, 1e300, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE]) {
      expect(clearItemNameBodyError({ bag, itemId: 'wyrmfall_pendant' }), String(bag)).toBe(
        'bag must be a whole number from 0 to 1023',
      );
    }
    for (const bag of [Number.POSITIVE_INFINITY, Number.NaN, -0.5, -1e21]) {
      expect(clearItemNameBodyError({ bag, itemId: 'wyrmfall_pendant' }), String(bag)).toBe(
        'bag must be a whole number from 0 to 1023',
      );
    }
    // Non-vacuity: the bound must sit ABOVE every carried inventory the game
    // can actually build, or it would refuse a real target. The largest
    // possible carried array is the backpack plus one copy of the roomiest
    // bag in every socket, computed here from the live catalog rather than
    // asserted as a number that could quietly grow past the bound.
    const roomiestBag = Math.max(...Object.keys(ITEMS).map((id) => bagSlotsOf(ITEMS[id])));
    const maxCarried = BACKPACK_SLOTS + BAG_SOCKETS * roomiestBag;
    expect(roomiestBag).toBeGreaterThan(0);
    expect(maxCarried).toBeLessThan(1024);
  });

  it('a bagged copy of a RETIRED id is targetable per-cell (the shape bound, not an allowlist)', () => {
    // A promoted copy outlives its catalog record: an id retired from the
    // content tables still sits in the blob, and the sweep (all: true)
    // already reaches it by payload. The per-cell arm reaches it too, so the
    // bound is the id SHAPE, never ITEMS membership (the Phase 18
    // retired-id-per-cell-targeting item).
    const retired = 'retired_masterwrought_blade_v1';
    expect(Object.hasOwn(ITEMS, retired)).toBe(false);
    expect(clearItemNameBodyError({ bag: 2, itemId: retired })).toBeNull();
    expect(clearItemNameTarget({ bag: 2, itemId: retired })).toEqual({
      kind: 'bag',
      bag: 2,
      itemId: retired,
    });
    // Every LIVE id passes the shape: the bound can never refuse a real target.
    for (const id of Object.keys(ITEMS)) {
      expect(clearItemNameBodyError({ bag: 0, itemId: id }), id).toBeNull();
    }
    // The length bound is the sim's persisted-id bound: 64 passes, 65 fails
    // (the malformed-dimension test above).
    expect(clearItemNameBodyError({ bag: 0, itemId: 'x'.repeat(64) })).toBeNull();
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
  it('strips a retired bagged item by its saved id while preserving an untargeted sibling', () => {
    const retired = 'retired_masterwrought_blade_v1';
    expect(Object.hasOwn(ITEMS, retired)).toBe(false);
    const state = stateWith({
      inventory: [
        { itemId: 'wyrmfall_pendant', count: 1, instance: namedCopy('Keep') },
        { itemId: retired, count: 1, instance: namedCopy('Strip') },
      ],
    });
    expect(stripLegendaryNames(state, { kind: 'bag', bag: 1, itemId: retired })).toBe(1);
    expect(state.inventory[1].instance?.name).toBeUndefined();
    expect(state.inventory[0].instance?.name).toBe('Keep');
  });

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
    const deps: ClearItemNameDeps = {
      characterOnline: vi.fn(() => false),
      clearOfflineItemName: vi.fn(async () => ({ ok: true as const, cleared: 1 })),
      recordAudit: vi.fn(async () => ({ accountId: 9 })),
      ...overrides,
    };
    return {
      deps,
      recordAudit: vi.mocked(deps.recordAudit),
      clearOfflineItemName: vi.mocked(deps.clearOfflineItemName),
    };
  }

  it('forwards a retired bag item id to the atomic strip without requiring a live catalog entry', async () => {
    const retired = 'retired_masterwrought_blade_v1';
    expect(Object.hasOwn(ITEMS, retired)).toBe(false);
    const { deps, recordAudit, clearOfflineItemName } = makeDeps();
    const outcome = await runClearItemName(deps, {
      characterId: 5,
      adminAccountId: 7,
      body: { bag: 1, itemId: retired, reason: 'slur' },
    });
    expect(outcome).toEqual({ ok: true, cleared: 1 });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ detail: `bag 1 ${retired}` }),
    );
    expect(clearOfflineItemName).toHaveBeenCalledWith(5, {
      kind: 'bag',
      bag: 1,
      itemId: retired,
    });
  });

  it('awaits the audit before starting the atomic offline strip', async () => {
    let finishAudit!: () => void;
    const auditPending = new Promise<void>((resolve) => {
      finishAudit = resolve;
    });
    const { deps, recordAudit, clearOfflineItemName } = makeDeps({
      recordAudit: vi.fn(() => auditPending),
    });
    const pending = runClearItemName(deps, {
      characterId: 5,
      adminAccountId: 7,
      body: { bag: 0, itemId: 'wyrmfall_pendant', reason: 'slur in the name' },
    });
    expect(recordAudit).toHaveBeenCalledWith({
      characterId: 5,
      adminAccountId: 7,
      detail: 'bag 0 wyrmfall_pendant',
      reason: 'slur in the name',
    });
    expect(clearOfflineItemName).not.toHaveBeenCalled();
    finishAudit();
    expect(await pending).toEqual({ ok: true, cleared: 1 });
    expect(clearOfflineItemName).toHaveBeenCalledExactlyOnceWith(5, {
      kind: 'bag',
      bag: 0,
      itemId: 'wyrmfall_pendant',
    });
  });

  it('refuses an online character without a live arm before auditing or starting an offline strip', async () => {
    const { deps, recordAudit, clearOfflineItemName } = makeDeps({
      characterOnline: vi.fn(() => true),
    });
    expect(deps.clearLiveItemName).toBeUndefined();
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
    expect(clearOfflineItemName).not.toHaveBeenCalled();
  });

  it('routes an online character to the live arm when one is bound, auditing first', async () => {
    const clearLiveItemName = vi.fn(async () => ({ cleared: 2 }));
    const { deps, recordAudit, clearOfflineItemName } = makeDeps({
      characterOnline: () => true,
      clearLiveItemName,
    });
    const outcome = await runClearItemName(deps, {
      characterId: 5,
      adminAccountId: 7,
      body: { all: true, reason: 'slur' },
    });
    expect(outcome).toEqual({ ok: true, cleared: 2 });
    expect(clearLiveItemName).toHaveBeenCalledWith(5, { kind: 'all' });
    expect(recordAudit).toHaveBeenCalledWith({
      characterId: 5,
      adminAccountId: 7,
      detail: 'all copies',
      reason: 'slur',
    });
    expect(recordAudit.mock.invocationCallOrder[0]).toBeLessThan(
      clearLiveItemName.mock.invocationCallOrder[0],
    );
    expect(clearOfflineItemName).not.toHaveBeenCalled();
  });

  it('reports the live arm finding nothing and never falls back to the offline operation', async () => {
    const clearLiveItemName = vi.fn(async () => ({ cleared: 0 }));
    const { deps, clearOfflineItemName } = makeDeps({
      characterOnline: () => true,
      clearLiveItemName,
    });
    const outcome = await runClearItemName(deps, {
      characterId: 5,
      adminAccountId: 7,
      body: { slot: 'neck', reason: 'slur' },
    });
    expect(outcome).toEqual({ ok: false, error: 'no named copy matched that target' });
    expect(clearOfflineItemName).not.toHaveBeenCalled();
  });

  it('asks the operator to retry when the session leaves mid-strip without falling through', async () => {
    const clearLiveItemName = vi.fn(async () => 'offline' as const);
    const { deps, recordAudit, clearOfflineItemName } = makeDeps({
      characterOnline: () => true,
      clearLiveItemName,
    });
    const outcome = await runClearItemName(deps, {
      characterId: 5,
      adminAccountId: 7,
      body: { all: true, reason: 'slur' },
    });
    expect(outcome).toEqual({
      ok: false,
      error: 'character went offline before the strip landed; retry',
    });
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(clearOfflineItemName).not.toHaveBeenCalled();
  });

  it('refuses a malformed target before any audit or atomic operation', async () => {
    const { deps, recordAudit, clearOfflineItemName } = makeDeps();
    const outcome = await runClearItemName(deps, {
      characterId: 5,
      adminAccountId: 7,
      body: { slot: 'hat', reason: 'slur' },
    });
    expect(outcome).toEqual({ ok: false, error: 'unknown equipment slot' });
    expect(recordAudit).not.toHaveBeenCalled();
    expect(clearOfflineItemName).not.toHaveBeenCalled();
  });

  it.each<ClearItemNameOutcome>([
    { ok: true, cleared: 3 },
    { ok: false, error: 'no named copy matched that target' },
    { ok: false, error: 'character not found' },
    { ok: false, error: CHARACTER_SAVE_LEASED_LINE },
  ])('returns the atomic operation outcome unchanged after the audit: %j', async (result) => {
    const { deps, recordAudit, clearOfflineItemName } = makeDeps({
      clearOfflineItemName: vi.fn(async () => result),
    });
    const outcome = await runClearItemName(deps, {
      characterId: 5,
      adminAccountId: 7,
      body: { all: true, reason: 'slur' },
    });
    expect(outcome).toBe(result);
    expect(clearOfflineItemName).toHaveBeenCalledExactlyOnceWith(5, { kind: 'all' });
    expect(recordAudit.mock.invocationCallOrder[0]).toBeLessThan(
      clearOfflineItemName.mock.invocationCallOrder[0],
    );
  });

  it.each([false, true])(
    'never starts either strip after an audit failure (online: %s)',
    async (online) => {
      const clearLiveItemName = vi.fn(async () => ({ cleared: 1 }));
      const { deps, clearOfflineItemName } = makeDeps({
        characterOnline: () => online,
        clearLiveItemName,
        recordAudit: vi.fn(async () => {
          throw new Error('moderation reason is required');
        }),
      });
      await expect(
        runClearItemName(deps, {
          characterId: 5,
          adminAccountId: 7,
          body: { all: true },
        }),
      ).rejects.toThrow('moderation reason is required');
      expect(clearOfflineItemName).not.toHaveBeenCalled();
      expect(clearLiveItemName).not.toHaveBeenCalled();
    },
  );

  it('propagates atomic-operation failure without retrying or reporting success', async () => {
    const { deps, recordAudit, clearOfflineItemName } = makeDeps({
      clearOfflineItemName: vi.fn(async () => {
        throw new Error('database unavailable');
      }),
    });
    await expect(
      runClearItemName(deps, {
        characterId: 5,
        adminAccountId: 7,
        body: { all: true, reason: 'slur' },
      }),
    ).rejects.toThrow('database unavailable');
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(clearOfflineItemName).toHaveBeenCalledTimes(1);
  });
});

describe('the strip walks exactly the payload-bearing regions the rename sweep walks', () => {
  // The five-region claim, tied MECHANICALLY to its precedent rather than
  // restated as a hand count: a sixth payload-bearing CharacterState region
  // added to rekeyInstanceSigner (src/sim/character_rename.ts) without a
  // matching arm here reds this, where the hand-counted sweep test above
  // would stay green at five. toolEffectSlots is the rename walk's one
  // non-payload region (it rekeys a craftedBy string), excluded by name.
  const regionReads = (source: string): string[] =>
    Array.from(
      new Set(
        Array.from(
          source.matchAll(
            /\bstate\.(inventory|bank\??\.inventory|vendorBuyback|equipmentInstances?|toolEffectSlots)\b/g,
          ),
        )
          .map((m) => m[1].replace('?', ''))
          .sort(),
      ),
    );
  const stripSource = readFileSync(
    join(__dirname, '..', '..', 'server', 'clear_item_name.ts'),
    'utf8',
  );
  const renameSource = readFileSync(
    join(__dirname, '..', '..', 'src', 'sim', 'character_rename.ts'),
    'utf8',
  );
  const PAYLOAD_REGIONS = [
    'bank.inventory',
    'equipmentInstance',
    'equipmentInstances',
    'inventory',
    'vendorBuyback',
  ];

  it('the strip reads the five payload regions, and the rename walk reads those plus toolEffectSlots', () => {
    const stripBody = stripSource.slice(
      stripSource.indexOf('export function stripLegendaryNames('),
    );
    expect(regionReads(stripBody)).toEqual(PAYLOAD_REGIONS);
    const renameBody = renameSource.slice(
      renameSource.indexOf('export function rekeyInstanceSigner('),
    );
    expect(regionReads(renameBody)).toEqual([...PAYLOAD_REGIONS, 'toolEffectSlots'].sort());
  });
});
