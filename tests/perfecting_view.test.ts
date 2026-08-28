// The Perfecting window's pure view core (Masterwrought phase 14):
// src/ui/hud/professions/perfecting_view.ts. Driven against BOTH host shapes
// (a Sim-shaped stub over live PlayerMeta-style fields and a
// ClientWorld-shaped stub over snapshot mirrors), each answering
// perfectingInfo through the real shared builder (perfectingInfoFrom), which
// is exactly how src/sim/sim.ts and src/net/online.ts answer it, so the view
// decisions proven here hold in both worlds.

import { describe, expect, it } from 'vitest';
import {
  craftForApexItem,
  PERFECTING_SKILL_REQ,
  type PerfectItemRef,
  type PerfectingInfoView,
  perfectingInfoFrom,
} from '../src/sim/professions/perfecting';
import type { EquipSlot, InvSlot, ItemInstancePayload } from '../src/sim/types';
import {
  buildPerfectingView,
  type PerfectingWorldReads,
  perfectingBindWarning,
  perfectingInfoSignature,
  perfectingViewSignature,
  samePerfectRef,
} from '../src/ui/hud/professions/perfecting_view';

// Two real apex ids (content-derived; craftForApexItem resolves both).
const APEX_WORN = 'duskforged_warblade'; // weaponcrafting output
const APEX_BAGGED = 'wyrmfall_pendant'; // jewelcrafting output

interface HostState {
  equipment: Partial<Record<EquipSlot, string>>;
  equipmentInstances: Partial<Record<EquipSlot, ItemInstancePayload>>;
  inventory: InvSlot[];
  craftSkills: Record<string, number>;
  synced: boolean;
}

/** The offline shape: live PlayerMeta-style fields, info answered exactly the
 *  way Sim.perfectingInfo answers it (perfectingInfoFrom over the live
 *  fields). */
function simShapedReads(state: HostState): PerfectingWorldReads {
  return {
    equipment: state.equipment,
    equipmentInstances: state.equipmentInstances,
    inventory: state.inventory,
    identitySynced: state.synced,
    perfectingInfo: (ref: PerfectItemRef) =>
      perfectingInfoFrom({
        ref,
        inventory: state.inventory,
        equipment: state.equipment,
        equipmentInstances: state.equipmentInstances,
        craftSkills: state.craftSkills,
      }),
  };
}

/** The online shape: the same facts as SNAPSHOT MIRRORS (fresh objects, the
 *  ClientWorld idiom), info answered the way online.ts answers it. */
function clientShapedReads(state: HostState): PerfectingWorldReads {
  const inv = state.inventory.map((cell) => ({ ...cell }));
  const equipment = { ...state.equipment };
  const equipmentInstances = { ...state.equipmentInstances };
  const craftSkills = { ...state.craftSkills };
  return {
    equipment,
    equipmentInstances,
    inventory: inv,
    identitySynced: state.synced,
    perfectingInfo: (ref: PerfectItemRef) =>
      perfectingInfoFrom({ ref, inventory: inv, equipment, equipmentInstances, craftSkills }),
  };
}

const BOTH_HOSTS: ReadonlyArray<[string, (state: HostState) => PerfectingWorldReads]> = [
  ['Sim-shaped', simShapedReads],
  ['ClientWorld-shaped', clientShapedReads],
];

function baseState(): HostState {
  return {
    equipment: { mainhand: APEX_WORN, chest: 'iron_chestplate' },
    equipmentInstances: {},
    inventory: [
      { itemId: 'linen_cloth', count: 5 },
      { itemId: 'makers_ember', count: 2 },
      { itemId: APEX_BAGGED, count: 1 },
      { itemId: 'sundered_essence', count: 1 },
      { itemId: 'prismglass_setting', count: 3 },
    ],
    craftSkills: { weaponcrafting: PERFECTING_SKILL_REQ, jewelcrafting: 10 },
    synced: true,
  };
}

describe('the candidate walk', () => {
  it.each(BOTH_HOSTS)('%s: worn apex first, then bagged cells; non-apex ignored', (_n, make) => {
    // Premise check so the walk cannot pass vacuously on retired content.
    expect(craftForApexItem(APEX_WORN)).toBe('weaponcrafting');
    expect(craftForApexItem(APEX_BAGGED)).toBe('jewelcrafting');
    const view = buildPerfectingView(make(baseState()), null);
    expect(view.candidates.map((c) => c.itemId)).toEqual([APEX_WORN, APEX_BAGGED]);
    expect(view.candidates[0].worn).toBe(true);
    expect(view.candidates[0].ref).toEqual({ slot: 'mainhand' });
    expect(view.candidates[1].worn).toBe(false);
    // The bagged ref carries the CELL index plus the id seen there (the
    // index-plus-id pin).
    expect(view.candidates[1].ref).toEqual({ bag: 2, itemId: APEX_BAGGED });
  });

  it.each(BOTH_HOSTS)('%s: no candidates means an empty view with null detail', (_n, make) => {
    const state = baseState();
    state.equipment = {};
    state.inventory = [{ itemId: 'linen_cloth', count: 5 }];
    const view = buildPerfectingView(make(state), null);
    expect(view.candidates).toEqual([]);
    expect(view.detail).toBeNull();
  });
});

describe('selection resolution', () => {
  it.each(BOTH_HOSTS)('%s: null request selects the first candidate', (_n, make) => {
    const view = buildPerfectingView(make(baseState()), null);
    expect(view.candidates[0].selected).toBe(true);
    expect(view.detail?.itemId).toBe(APEX_WORN);
  });

  it.each(BOTH_HOSTS)('%s: a live request wins; a stale one falls back', (_n, make) => {
    const picked = buildPerfectingView(make(baseState()), { bag: 2, itemId: APEX_BAGGED });
    expect(picked.detail?.itemId).toBe(APEX_BAGGED);
    expect(picked.candidates[1].selected).toBe(true);
    // The copy left that cell: the request no longer names a candidate.
    const state = baseState();
    state.inventory.splice(2, 1);
    const stale = buildPerfectingView(make(state), { bag: 2, itemId: APEX_BAGGED });
    expect(stale.detail?.itemId).toBe(APEX_WORN);
    expect(stale.candidates[0].selected).toBe(true);
  });
});

describe('the synced gate (the crafting_view syncing precedent)', () => {
  it.each(BOTH_HOSTS)('%s: an unsynced mirror says syncing, never skill-unmet', (_n, make) => {
    const state = baseState();
    state.synced = false;
    // The all-zero pre-cprof mirror: skills read empty online before the
    // first frame lands.
    state.craftSkills = {};
    const view = buildPerfectingView(make(state), null);
    expect(view.detail?.syncing).toBe(true);
    expect(view.detail?.actionEnabled).toBe(false);
  });

  it.each(BOTH_HOSTS)('%s: synced with skill and materials enables the attempt', (_n, make) => {
    const view = buildPerfectingView(make(baseState()), null);
    const detail = view.detail;
    expect(detail?.syncing).toBe(false);
    expect(detail?.action).toBe('attempt');
    expect(detail?.info.skillMet).toBe(true);
    expect(detail?.materialsMet).toBe(true);
    expect(detail?.actionEnabled).toBe(true);
  });

  it.each(BOTH_HOSTS)('%s: a genuine skill shortfall disables once synced', (_n, make) => {
    const state = baseState();
    state.craftSkills = { weaponcrafting: PERFECTING_SKILL_REQ - 1 };
    const view = buildPerfectingView(make(state), null);
    expect(view.detail?.syncing).toBe(false);
    expect(view.detail?.info.skillMet).toBe(false);
    expect(view.detail?.actionEnabled).toBe(false);
  });
});

describe('the materials rows (whichever rows arrive)', () => {
  it.each(BOTH_HOSTS)('%s: the attempt bill while unperfected, lock-aware haves', (_n, make) => {
    const view = buildPerfectingView(make(baseState()), null);
    const rows = view.detail?.info.materials ?? [];
    expect(rows.map((r) => r.itemId)).toEqual([
      'makers_ember',
      'sundered_essence',
      'prismglass_setting',
    ]);
    expect(rows.map((r) => r.have)).toEqual([2, 1, 3]);
    expect(view.detail?.materialsMet).toBe(true);
  });

  it.each(BOTH_HOSTS)('%s: a shortfall disables the attempt', (_n, make) => {
    const state = baseState();
    state.inventory = state.inventory.filter((cell) => cell.itemId !== 'sundered_essence');
    const view = buildPerfectingView(make(state), null);
    expect(view.detail?.materialsMet).toBe(false);
    expect(view.detail?.actionEnabled).toBe(false);
  });

  it.each(BOTH_HOSTS)('%s: the Deed of Making once Perfected, empty once promoted', (_n, make) => {
    const state = baseState();
    state.equipmentInstances = { mainhand: { perfected: true, boundTo: 1 } };
    const perfected = buildPerfectingView(make(state), { slot: 'mainhand' });
    expect(perfected.detail?.state).toBe('perfected');
    expect(perfected.detail?.action).toBe('promote');
    expect(perfected.detail?.info.materials.map((r) => r.itemId)).toEqual(['deed_of_making']);
    state.equipmentInstances = {
      mainhand: { perfected: true, boundTo: 1, rolled: { quality: 'legendary' }, name: 'Oath' },
    };
    const promoted = buildPerfectingView(make(state), { slot: 'mainhand' });
    expect(promoted.detail?.state).toBe('promoted');
    expect(promoted.detail?.action).toBe('done');
    expect(promoted.detail?.actionEnabled).toBe(false);
    expect(promoted.detail?.info.materials).toEqual([]);
    // The chosen name surfaces as a raw value for the painter to esc().
    expect(promoted.detail?.chosenName).toBe('Oath');
    expect(promoted.candidates[0].chosenName).toBe('Oath');
  });
});

describe('the equipBlocked gate (never re-derived)', () => {
  it('a blocked promotion disables the promote action off the view flag alone', () => {
    // Hand-built info: the core must gate on info.equipBlocked as delivered,
    // never re-run the equip rules (the PerfectingInfoView contract).
    const state = baseState();
    const reads = simShapedReads(state);
    const blocked: PerfectingWorldReads = {
      ...reads,
      perfectingInfo: (ref) => {
        const info = reads.perfectingInfo(ref);
        if (info === null || !('slot' in ref)) return info;
        return {
          ...info,
          perfected: true,
          equipBlocked: true,
          materials: [{ itemId: 'deed_of_making', required: 1, have: 1 }],
        };
      },
    };
    const view = buildPerfectingView(blocked, { slot: 'mainhand' });
    expect(view.detail?.action).toBe('promote');
    expect(view.detail?.materialsMet).toBe(true);
    expect(view.detail?.info.skillMet).toBe(true);
    expect(view.detail?.actionEnabled).toBe(false);
  });
});

describe('the R2 bind-warning predicate', () => {
  const info = (over: Partial<PerfectingInfoView>): PerfectingInfoView => ({
    itemId: APEX_WORN,
    rank: 0,
    ranks: 4,
    perfected: false,
    promoted: false,
    craftId: 'weaponcrafting',
    skillReq: PERFECTING_SKILL_REQ,
    skillMet: true,
    bound: false,
    equipBlocked: false,
    materials: [],
    ...over,
  });

  it('warns on an unbound, rank 0, unperfected copy (the acceptance case)', () => {
    expect(perfectingBindWarning(info({}))).toBe(true);
  });

  it('warns on an unbound head-start copy too: rank 1 still binds on its first attempt', () => {
    expect(perfectingBindWarning(info({ rank: 1 }))).toBe(true);
  });

  it('never warns once bound, Perfected, or promoted', () => {
    expect(perfectingBindWarning(info({ bound: true }))).toBe(false);
    expect(perfectingBindWarning(info({ perfected: true }))).toBe(false);
    expect(perfectingBindWarning(info({ promoted: true, perfected: true }))).toBe(false);
  });

  it.each(BOTH_HOSTS)('%s: the view carries the predicate for the selection', (_n, make) => {
    const fresh = buildPerfectingView(make(baseState()), null);
    expect(fresh.detail?.bindWarning).toBe(true);
    const state = baseState();
    state.equipmentInstances = { mainhand: { boundTo: 1, perfecting: 2 } };
    const bound = buildPerfectingView(make(state), { slot: 'mainhand' });
    expect(bound.detail?.bindWarning).toBe(false);
    expect(bound.detail?.info.rank).toBe(2);
    expect(bound.candidates[0].state).toBe('track');
  });
});

describe('the value signatures (the 1 Hz clock and the send-answer edge)', () => {
  it.each(BOTH_HOSTS)('%s: unchanged reads sign identically; a change moves it', (_n, make) => {
    const a = buildPerfectingView(make(baseState()), null);
    const b = buildPerfectingView(make(baseState()), null);
    expect(perfectingViewSignature(a, false)).toBe(perfectingViewSignature(b, false));
    // A consumed material (the attempt landing) moves the selected info sig.
    const spent = baseState();
    spent.inventory = spent.inventory.map((cell) =>
      cell.itemId === 'makers_ember' ? { ...cell, count: cell.count - 1 } : cell,
    );
    const c = buildPerfectingView(make(spent), null);
    expect(perfectingViewSignature(c, false)).not.toBe(perfectingViewSignature(a, false));
    expect(perfectingInfoSignature(c.detail?.info ?? null)).not.toBe(
      perfectingInfoSignature(a.detail?.info ?? null),
    );
    // The sync gate is part of the whole-view signature, so the first cprof
    // frame forces the repaint that retires the syncing face.
    expect(perfectingViewSignature(a, true)).not.toBe(perfectingViewSignature(a, false));
  });

  it('a rank advance moves the selected info signature', () => {
    const state = baseState();
    state.equipmentInstances = { mainhand: { boundTo: 1, perfecting: 1 } };
    const r1 = buildPerfectingView(simShapedReads(state), { slot: 'mainhand' });
    state.equipmentInstances = { mainhand: { boundTo: 1, perfecting: 2 } };
    const r2 = buildPerfectingView(simShapedReads(state), { slot: 'mainhand' });
    expect(perfectingInfoSignature(r1.detail?.info ?? null)).not.toBe(
      perfectingInfoSignature(r2.detail?.info ?? null),
    );
  });
});

describe('samePerfectRef', () => {
  it('matches worn by slot and bagged by cell + id, never across kinds', () => {
    expect(samePerfectRef({ slot: 'mainhand' }, { slot: 'mainhand' })).toBe(true);
    expect(samePerfectRef({ slot: 'mainhand' }, { slot: 'chest' })).toBe(false);
    expect(samePerfectRef({ bag: 2, itemId: 'a' }, { bag: 2, itemId: 'a' })).toBe(true);
    expect(samePerfectRef({ bag: 2, itemId: 'a' }, { bag: 2, itemId: 'b' })).toBe(false);
    expect(samePerfectRef({ bag: 2, itemId: 'a' }, { bag: 3, itemId: 'a' })).toBe(false);
    expect(samePerfectRef({ slot: 'mainhand' }, { bag: 0, itemId: APEX_WORN })).toBe(false);
    expect(samePerfectRef(null, { slot: 'mainhand' })).toBe(false);
    expect(samePerfectRef(null, null)).toBe(true);
  });
});
