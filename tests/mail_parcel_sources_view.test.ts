import { describe, expect, it } from 'vitest';
import type { MaterialComposition } from '../src/sim/material_sources';
import type { InvSlot } from '../src/sim/types';
import {
  appendableMailParcelCount,
  mailParcelCountCeiling,
  plannedMailParcelSources,
} from '../src/ui/mail_parcel_sources_view';

function sourceCounts(sources: MaterialComposition | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { source, count } of sources ?? []) {
    const key = source.signer ?? source.gatherer?.name ?? '-';
    counts[key] = (counts[key] ?? 0) + count;
  }
  return counts;
}

describe('mail parcel material source view', () => {
  it('finds the full safe-integer ceiling without overflowing the midpoint', () => {
    const inventory: InvSlot[] = [{ itemId: 'copper_ore', count: Number.MAX_SAFE_INTEGER }];
    const attachments: InvSlot[] = [{ itemId: 'copper_ore', count: 1 }];

    expect(mailParcelCountCeiling(inventory, attachments, 0)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('reserves an exact signer request staged after a plain request', () => {
    const inventory: InvSlot[] = [
      {
        itemId: 'copper_ore',
        count: 4,
        materialSources: [
          { source: {}, count: 2 },
          { source: { signer: 'Ana' }, count: 2 },
        ],
      },
    ];
    const attachments: InvSlot[] = [
      { itemId: 'copper_ore', count: 1 },
      { itemId: 'copper_ore', count: 1, instance: { signer: 'Ana' } },
    ];

    expect(mailParcelCountCeiling(inventory, attachments, 0)).toBe(3);
    expect(mailParcelCountCeiling(inventory, attachments, 1)).toBe(1);
  });

  it('keeps mixed requests index-aligned and aggregates rows across recipe identities', () => {
    const inventory: InvSlot[] = [
      { itemId: 'baked_bread', count: 1 },
      {
        itemId: 'copper_ore',
        count: 1,
        craftedRecipeId: 'ore_route_a',
        materialSources: [{ source: { signer: 'Ana' }, count: 1 }],
      },
      {
        itemId: 'copper_ore',
        count: 2,
        craftedRecipeId: 'ore_route_b',
        materialSources: [{ source: { signer: 'Bru' }, count: 2 }],
      },
    ];
    const previews = plannedMailParcelSources(inventory, [
      { itemId: 'baked_bread', count: 1 },
      { itemId: 'copper_ore', count: 3 },
    ]);

    expect(previews).not.toBeNull();
    expect(previews).toHaveLength(2);
    expect(previews?.[0]).toBeUndefined();
    expect(sourceCounts(previews?.[1])).toEqual({ Ana: 1, Bru: 2 });
  });

  it('refuses previews and exposes no capacity for malformed material state', () => {
    const inventory: InvSlot[] = [
      {
        itemId: 'copper_ore',
        count: 2,
        materialSources: [{ source: { signer: 'Ana' }, count: 1 }],
      },
    ];
    const attachments: InvSlot[] = [{ itemId: 'copper_ore', count: 1 }];

    expect(plannedMailParcelSources(inventory, attachments)).toBeNull();
    expect(appendableMailParcelCount(inventory, [], 'copper_ore')).toBe(0);
    expect(mailParcelCountCeiling(inventory, attachments, 0)).toBe(0);
  });

  it('delegates non-material requests to the mailbox existing stock rules', () => {
    const inventory: InvSlot[] = [{ itemId: 'baked_bread', count: 4 }];
    const attachments: InvSlot[] = [{ itemId: 'baked_bread', count: 2 }];

    expect(appendableMailParcelCount(inventory, [], 'baked_bread')).toBeNull();
    expect(mailParcelCountCeiling(inventory, attachments, 0)).toBeNull();
    expect(plannedMailParcelSources(inventory, attachments)).toEqual([undefined]);
  });
});
