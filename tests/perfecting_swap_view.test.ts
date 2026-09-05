import { describe, expect, it } from 'vitest';
import { STATIONS } from '../src/sim/content/professions';
import { perfectingInfoFrom } from '../src/sim/professions/perfecting';
import { capturePerfectItemRef } from '../src/sim/professions/perfecting_copy';
import { perfectingSwapInfoFrom } from '../src/sim/professions/perfecting_swap';
import type { InvSlot } from '../src/sim/types';
import {
  buildPerfectingSwapView,
  type PerfectingSwapReads,
  perfectingSwapViewSignature,
  samePerfectingSwapRequest,
} from '../src/ui/hud/professions/perfecting_swap_view';
import { buildPerfectingView } from '../src/ui/hud/professions/perfecting_view';

const CHEST = 'crucible_str_mail_chest';
const WAIST = 'crucible_str_mail_waist';

function fixture(mirrored = false) {
  const inventory: InvSlot[] = [
    {
      itemId: CHEST,
      count: 1,
      instance: {
        perfected: true,
        perfectingBonus: { str: 2 },
        enchant: 'enchant_lucent_infusion',
        rolled: { stats: { str: 2, sta: 13 } },
      },
    },
    { itemId: WAIST, count: 1, instance: { perfecting: 1 } },
    { itemId: 'crucible_caster_cloth_chest', count: 1 },
  ];
  const inputs = {
    inventory: mirrored ? structuredClone(inventory) : inventory,
    equipment: {},
    equipmentInstances: {},
    craftSkills: { armorcrafting: 125 },
    dead: false,
    inCombat: false,
    pos: STATIONS.find((s) => s.type === 'forge')!.pos,
  };
  const reads: PerfectingSwapReads = {
    ...inputs,
    craftingIdentity: { synced: true } as PerfectingSwapReads['craftingIdentity'],
    perfectingSwapInfo: (request) => perfectingSwapInfoFrom({ ...inputs, ...request }),
  };
  const view = buildPerfectingView(
    {
      ...inputs,
      identitySynced: true,
      perfectingInfo: (ref) => perfectingInfoFrom({ ...inputs, ref }),
    },
    { bag: 0, itemId: CHEST },
  );
  const target = capturePerfectItemRef(reads, { bag: 1, itemId: WAIST });
  return { inputs, reads, view, target };
}

describe('Perfecting exchange pure view', () => {
  it.each([false, true])(
    'uses owned reads for a complete two-way preview (mirrored=%s)',
    (mirrored) => {
      const { reads, view, target } = fixture(mirrored);
      const model = buildPerfectingSwapView(reads, view, target);
      expect(model?.rows.map((row) => row.candidate.itemId)).toEqual([WAIST]);
      expect(model?.enabled).toBe(true);
      expect(model?.changes).toEqual([
        { itemId: CHEST, name: null, from: 4, to: 1, enchantChange: 'inactive' },
        { itemId: WAIST, name: null, from: 1, to: 4, enchantChange: null },
      ]);
      expect(buildPerfectingSwapView(reads, view, target)).toEqual(model);
    },
  );

  it('does not offer exchanges for empty or legacy Masterwrought selections', () => {
    const { reads, view } = fixture();
    expect(buildPerfectingSwapView(reads, { candidates: [], detail: null }, null)).toBeNull();
    expect(
      buildPerfectingSwapView(
        reads,
        { ...view, detail: { ...view.detail!, itemId: 'duskforged_warblade' } },
        null,
      ),
    ).toBeNull();
  });

  it('requires an explicit target and invalidates changed or departed copies', () => {
    const { reads, view, target } = fixture();
    expect(buildPerfectingSwapView(reads, view, null)?.reason).toBe('choose_target');
    reads.inventory[1].instance = { perfecting: 2 };
    expect(buildPerfectingSwapView(reads, view, target)?.reason).toBe('changed');
    expect(buildPerfectingSwapView(reads, view, target)?.enabled).toBe(false);
  });

  it('disables admission while syncing or refused by the shared world read', () => {
    const { reads, view, target, inputs } = fixture();
    inputs.inCombat = true;
    expect(buildPerfectingSwapView(reads, view, target)?.reason).toBe('busy');
    reads.craftingIdentity = { ...reads.craftingIdentity, synced: false };
    expect(buildPerfectingSwapView(reads, view, target)?.reason).toBe('syncing');
    reads.craftingIdentity = { ...reads.craftingIdentity, synced: true };
    reads.perfectingSwapInfo = () => null;
    expect(buildPerfectingSwapView(reads, view, target)?.reason).toBe('no_item');
  });

  it('detects a changed source while preserving a still-current target', () => {
    const { reads, view, target } = fixture();
    reads.inventory[0].instance = { perfecting: 2 };
    expect(buildPerfectingSwapView(reads, view, target)?.reason).toBe('changed');
  });

  it('includes payload changes in the poll signature before any target is selected', () => {
    const { reads, view } = fixture();
    const before = perfectingSwapViewSignature(buildPerfectingSwapView(reads, view, null));
    reads.inventory[1].instance = { perfecting: 1, locked: true };
    expect(perfectingSwapViewSignature(buildPerfectingSwapView(reads, view, null))).not.toBe(
      before,
    );
    expect(perfectingSwapViewSignature(null)).toBe('null');
  });

  it('correlates echoed requests by both copy witnesses, not property order or item IDs alone', () => {
    const { reads, view, target } = fixture();
    const request = buildPerfectingSwapView(reads, view, target)!.request!;
    expect(
      samePerfectingSwapRequest(request, { target: request.target, source: request.source }),
    ).toBe(true);
    expect(samePerfectingSwapRequest(request, undefined)).toBe(false);
    expect(
      samePerfectingSwapRequest(request, { ...request, target: { bag: 1, itemId: WAIST } }),
    ).toBe(false);
    expect(
      samePerfectingSwapRequest(request, {
        ...request,
        target: { ...request.target, copy: { ...request.target.copy!, pin: 'changed' } },
      }),
    ).toBe(false);
  });
});
