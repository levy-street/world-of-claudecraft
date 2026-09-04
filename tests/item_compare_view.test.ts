// The item-comparison card core (item_compare_view.ts): which worn slots a
// hovered item compares against, the delta-line wiring, and the phase 13
// review fix this extraction exists to pin: the worn side hands the injected
// tooltip renderer the worn copy's PROJECTED per-copy payload
// (wornTooltipInstance), so "Currently Equipped" describes the copy (a
// promoted legendary's title and chosen name), never just its def, and never
// the bag-only bond fields.
import { describe, expect, it } from 'vitest';
import type { ItemDef, ItemInstancePayload } from '../src/sim/types';
import { itemCompareBlocksHtml } from '../src/ui/item_compare_view';

const HOVERED_HELM = {
  id: 'cmp_test_helm',
  name: 'Test Helm',
  kind: 'armor',
  slot: 'helmet',
  quality: 'epic',
  stats: { sta: 10 },
  sellValue: 1,
} as ItemDef;
const WORN_HELM = {
  id: 'cmp_test_worn_helm',
  name: 'Worn Helm',
  kind: 'armor',
  slot: 'helmet',
  quality: 'epic',
  stats: { sta: 6 },
  sellValue: 1,
} as ItemDef;
const HOVERED_RING = {
  id: 'cmp_test_ring',
  name: 'Test Ring',
  kind: 'armor',
  slot: 'ring',
  quality: 'epic',
  stats: { sta: 1 },
  sellValue: 1,
} as ItemDef;
const WORN_RING_A = { ...HOVERED_RING, id: 'cmp_test_ring_a', name: 'Ring A' } as ItemDef;
const WORN_RING_B = { ...HOVERED_RING, id: 'cmp_test_ring_b', name: 'Ring B' } as ItemDef;

const TABLE: Record<string, ItemDef> = Object.fromEntries(
  [HOVERED_HELM, WORN_HELM, HOVERED_RING, WORN_RING_A, WORN_RING_B].map((d) => [d.id, d]),
);
const lookup = (id: string): ItemDef | undefined => TABLE[id];

function recordingRenderer(): {
  calls: Array<{ id: string; instance?: ItemInstancePayload }>;
  render: (item: ItemDef, instance?: ItemInstancePayload) => string;
} {
  const calls: Array<{ id: string; instance?: ItemInstancePayload }> = [];
  return {
    calls,
    render: (item, instance) => {
      calls.push({ id: item.id, instance });
      return `[card:${item.id}]`;
    },
  };
}

describe('itemCompareBlocksHtml', () => {
  it('hands the renderer the worn copy PROJECTED payload (the instance-driven case)', () => {
    const { calls, render } = recordingRenderer();
    const html = itemCompareBlocksHtml(
      HOVERED_HELM,
      {
        equipment: { helmet: WORN_HELM.id },
        instances: {
          helmet: {
            name: 'Dawnbreaker',
            rolled: { quality: 'legendary' },
            signer: 'Ana',
            bindOnTrade: true,
          },
        },
      },
      lookup,
      render,
    );
    expect(html).toContain('[card:cmp_test_worn_helm]');
    // Worn identity only: signer/enchant/rolled/name survive the projection,
    // the bag-only bond field does not (the wornTooltipInstance trim).
    expect(calls).toEqual([
      {
        id: WORN_HELM.id,
        instance: { name: 'Dawnbreaker', rolled: { quality: 'legendary' }, signer: 'Ana' },
      },
    ]);
  });

  it('a def-only worn piece hands the renderer no payload (the negative)', () => {
    const { calls, render } = recordingRenderer();
    itemCompareBlocksHtml(HOVERED_HELM, { equipment: { helmet: WORN_HELM.id } }, lookup, render);
    expect(calls).toEqual([{ id: WORN_HELM.id, instance: undefined }]);
  });

  it('a hovered ring compares BOTH worn fingers, each against its own slot payload', () => {
    const { calls, render } = recordingRenderer();
    const html = itemCompareBlocksHtml(
      HOVERED_RING,
      {
        equipment: { ring1: WORN_RING_A.id, ring2: WORN_RING_B.id },
        instances: { ring2: { rolled: { quality: 'legendary' } } },
      },
      lookup,
      render,
    );
    expect(html).toContain('[card:cmp_test_ring_a]');
    expect(html).toContain('[card:cmp_test_ring_b]');
    expect(calls).toEqual([
      { id: WORN_RING_A.id, instance: undefined },
      { id: WORN_RING_B.id, instance: { rolled: { quality: 'legendary' } } },
    ]);
  });

  it('renders the classic card chrome and the signed delta lines', () => {
    const { render } = recordingRenderer();
    const html = itemCompareBlocksHtml(
      HOVERED_HELM,
      { equipment: { helmet: WORN_HELM.id } },
      lookup,
      render,
    );
    expect(html).toContain('tt-cmp-head');
    expect(html).toContain('tt-cmp-body');
    // sta 10 versus worn sta 6: one green +4 line.
    expect(html).toContain('tt-green');
    expect(html).toContain('+4');
  });

  it('the delta lines account for per-copy stats on BOTH sides (the net-loss case)', () => {
    const { render } = recordingRenderer();
    // The worn copy's bake (rolled sta 8 atop def sta 6 = 14) beats the
    // hovered def's flat 10: the swap is a NET LOSS and must read a red -4,
    // where the def-only compare (the chrome test above) showed +4 green.
    const wornSource = {
      equipment: { helmet: WORN_HELM.id },
      instances: { helmet: { rolled: { quality: 'legendary' as const, stats: { sta: 8 } } } },
    };
    const html = itemCompareBlocksHtml(HOVERED_HELM, wornSource, lookup, render);
    expect(html).toContain('tt-red');
    expect(html).toContain('−4'); // proper minus, the view's own sign
    expect(html).not.toContain('+4');
    // The hovered COPY's own bake rides the candidate argument: 10 + 5 = 15
    // against the worn 14 flips it back to a +1 gain.
    const withCandidate = itemCompareBlocksHtml(HOVERED_HELM, wornSource, lookup, render, {
      rolled: { stats: { sta: 5 } },
    });
    expect(withCandidate).toContain('tt-green');
    expect(withCandidate).toContain('+1');
    expect(withCandidate).not.toContain('tt-red');
  });

  it('compares separately rolled copies even when they share an item id', () => {
    const { calls, render } = recordingRenderer();
    const html = itemCompareBlocksHtml(
      HOVERED_HELM,
      {
        equipment: { helmet: HOVERED_HELM.id },
        instances: { helmet: { rolled: { stats: { sta: 3 } } } },
      },
      lookup,
      render,
      { rolled: { stats: { sta: 5 } } },
    );
    expect(html).toContain('[card:cmp_test_helm]');
    expect(html).toContain('+2');
    expect(calls).toEqual([{ id: HOVERED_HELM.id, instance: { rolled: { stats: { sta: 3 } } } }]);
  });

  it('is empty for a slotless item or an empty slot', () => {
    const { calls, render } = recordingRenderer();
    const potion = { id: 'cmp_test_potion', name: 'P', kind: 'potion' } as ItemDef;
    expect(itemCompareBlocksHtml(potion, { equipment: {} }, lookup, render)).toBe('');
    expect(itemCompareBlocksHtml(HOVERED_HELM, { equipment: {} }, lookup, render)).toBe('');
    expect(calls).toEqual([]);
  });
});
