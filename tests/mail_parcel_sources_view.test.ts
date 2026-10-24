import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { MaterialComposition } from '../src/sim/material_sources';
import { isStackProvenanceItemId } from '../src/sim/stack_provenance_ids';
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
      { itemId: 'worn_sword', count: 1 },
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
    const before = structuredClone(inventory);
    expect(isStackProvenanceItemId('baked_bread')).toBe(true);
    expect(isStackProvenanceItemId('worn_sword')).toBe(false);
    const previews = plannedMailParcelSources(inventory, [
      { itemId: 'baked_bread', count: 1 },
      { itemId: 'copper_ore', count: 3 },
      { itemId: 'worn_sword', count: 1 },
    ]);

    expect(previews).not.toBeNull();
    expect(previews).toHaveLength(3);
    expect(previews?.[0]).toEqual([{ source: {}, count: 1 }]);
    expect(sourceCounts(previews?.[1])).toEqual({ Ana: 1, Bru: 2 });
    expect(previews?.[1]).toHaveLength(2);
    expect(previews?.[2]).toBeUndefined();
    expect(inventory).toEqual(before);
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
    expect(ITEMS.worn_sword.kind).toBe('weapon');
    expect(isStackProvenanceItemId('worn_sword')).toBe(false);
    const inventory: InvSlot[] = [{ itemId: 'worn_sword', count: 1 }];
    const attachments: InvSlot[] = [{ itemId: 'worn_sword', count: 1 }];

    expect(appendableMailParcelCount(inventory, [], 'worn_sword')).toBeNull();
    expect(mailParcelCountCeiling(inventory, attachments, 0)).toBeNull();
    expect(plannedMailParcelSources(inventory, attachments)).toEqual([undefined]);
  });

  it.each(['baked_bread', 'minor_healing_potion'])(
    'previews exact unknown and signed consumable units for %s',
    (itemId) => {
      expect(isStackProvenanceItemId(itemId)).toBe(true);
      const inventory: InvSlot[] = [
        { itemId, count: 2, craftedRecipeId: 'recipe_a' },
        {
          itemId,
          count: 2,
          craftedRecipeId: 'recipe_b',
          materialSources: [
            { source: { signer: 'Ana' }, count: 1 },
            { source: { signer: 'Bru' }, count: 1 },
          ],
        },
      ];
      const before = structuredClone(inventory);
      const attachments = [{ itemId, count: 4 }];
      expect(appendableMailParcelCount(inventory, [], itemId)).toBe(4);
      expect(appendableMailParcelCount(inventory, [{ itemId, count: 2 }], itemId)).toBe(2);
      expect(mailParcelCountCeiling(inventory, attachments, 0)).toBe(4);
      expect(plannedMailParcelSources(inventory, attachments)).toEqual([
        [
          { source: {}, count: 2 },
          { source: { signer: 'Ana' }, count: 1 },
          { source: { signer: 'Bru' }, count: 1 },
        ],
      ]);
      expect(plannedMailParcelSources(inventory, [{ itemId, count: 5 }])).toBeNull();
      expect(inventory).toEqual(before);
    },
  );

  it.each([{ locked: true }, { boundTo: 7 }, { bindOnTrade: true }])(
    'excludes locked or bound consumable stock: %j',
    (instance) => {
      const inventory: InvSlot[] = [{ itemId: 'baked_bread', count: 2, instance }];
      const before = structuredClone(inventory);
      const attachments = [{ itemId: 'baked_bread', count: 1, instance }];
      expect(appendableMailParcelCount(inventory, [], 'baked_bread', instance)).toBe(0);
      expect(mailParcelCountCeiling(inventory, attachments, 0)).toBe(0);
      expect(plannedMailParcelSources(inventory, attachments)).toBeNull();
      expect(inventory).toEqual(before);
    },
  );
});
