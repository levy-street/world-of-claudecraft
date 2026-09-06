import { describe, expect, it } from 'vitest';

import {
  mailMaterialAttachmentAvailableCount,
  planMaterialMailAttachments,
} from '../src/sim/mail/material_attachment_plan';
import type { InvSlot } from '../src/sim/types';

const HIDE = 'pristine_hide';

describe('material mail attachment planning', () => {
  it('keeps one index-aligned null entry for each non-material request', () => {
    const planned = planMaterialMailAttachments(
      [
        { itemId: 'baked_bread', count: 2 },
        { itemId: HIDE, count: 1, materialSources: [{ source: {}, count: 1 }] },
      ],
      [
        { itemId: 'baked_bread', count: 1 },
        { itemId: HIDE, count: 1 },
      ],
    );

    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.rowsByAttachment).toEqual([
      null,
      [{ itemId: HIDE, count: 1, materialSources: [{ source: {}, count: 1 }] }],
    ]);
    expect(planned.value.inventory).toEqual([{ itemId: 'baked_bread', count: 2 }]);
  });

  it('plans the whole plain pool in source priority order while ignoring manual grouping', () => {
    const inventory: InvSlot[] = [
      {
        itemId: HIDE,
        count: 2,
        materialSources: [{ source: { signer: 'Ana' }, count: 2 }],
        materialSeparated: true,
      },
      {
        itemId: HIDE,
        count: 2,
        materialSources: [
          { source: { gatherer: { kind: 'character', id: 7, name: 'Bru' } }, count: 2 },
        ],
        materialSeparated: true,
      },
      { itemId: HIDE, count: 1, materialSources: [{ source: {}, count: 1 }] },
    ];

    expect(mailMaterialAttachmentAvailableCount(inventory, HIDE)).toBe(5);
    const planned = planMaterialMailAttachments(inventory, [{ itemId: HIDE, count: 4 }]);

    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.rowsByAttachment[0]).toEqual([
      {
        itemId: HIDE,
        count: 4,
        materialSources: [
          { source: {}, count: 1 },
          { source: { signer: 'Ana' }, count: 1 },
          { source: { gatherer: { kind: 'character', id: 7, name: 'Bru' } }, count: 2 },
        ],
      },
    ]);
    expect(planned.value.inventory).toEqual([
      {
        itemId: HIDE,
        count: 1,
        materialSources: [{ source: { signer: 'Ana' }, count: 1 }],
        materialSeparated: true,
      },
    ]);
    expect(inventory).toHaveLength(3);
  });

  it('keeps crafted recipes in distinct parcel rows without losing their sources', () => {
    const planned = planMaterialMailAttachments(
      [
        {
          itemId: HIDE,
          count: 1,
          craftedRecipeId: 'recipe_a',
          materialSources: [{ source: { signer: 'Ana' }, count: 1 }],
        },
        {
          itemId: HIDE,
          count: 1,
          craftedRecipeId: 'recipe_b',
          materialSources: [{ source: {}, count: 1 }],
        },
      ],
      [{ itemId: HIDE, count: 2 }],
    );

    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.rowsByAttachment[0]).toEqual([
      {
        itemId: HIDE,
        count: 1,
        craftedRecipeId: 'recipe_a',
        materialSources: [{ source: { signer: 'Ana' }, count: 1 }],
      },
      {
        itemId: HIDE,
        count: 1,
        craftedRecipeId: 'recipe_b',
        materialSources: [{ source: {}, count: 1 }],
      },
    ]);
  });

  it('matches a canonical rest payload independently from source signers', () => {
    const inventory: InvSlot[] = [
      {
        itemId: HIDE,
        count: 2,
        instance: { enchant: 'ench_stat_str' },
        materialSources: [
          { source: { signer: 'Ana' }, count: 1 },
          { source: { signer: 'Bru' }, count: 1 },
        ],
      },
    ];

    expect(
      mailMaterialAttachmentAvailableCount(inventory, HIDE, { enchant: 'ench_stat_str' }),
    ).toBe(2);
    const planned = planMaterialMailAttachments(inventory, [
      { itemId: HIDE, count: 1, instance: { enchant: 'ench_stat_str' } },
    ]);

    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.rowsByAttachment[0]?.[0]).toMatchObject({
      itemId: HIDE,
      count: 1,
      instance: { enchant: 'ench_stat_str' },
    });
    expect(planned.value.rowsByAttachment[0]?.[0].materialSources).toHaveLength(1);
  });

  it('keeps legacy signer needles exact and refuses an overlapping batch atomically', () => {
    const inventory: InvSlot[] = [
      {
        itemId: HIDE,
        count: 1,
        materialSources: [{ source: { signer: 'Sender' }, count: 1 }],
      },
    ];
    const before = structuredClone(inventory);
    const planned = planMaterialMailAttachments(inventory, [
      { itemId: HIDE, count: 1 },
      { itemId: HIDE, count: 1, instance: { signer: 'Sender' } },
    ]);

    expect(planned).toEqual({ ok: false, error: 'insufficient' });
    expect(inventory).toEqual(before);
  });

  it('excludes player-locked and transfer-locked material without weakening charged copies', () => {
    const inventory: InvSlot[] = [
      {
        itemId: HIDE,
        count: 1,
        instance: { locked: true },
        materialSources: [{ source: {}, count: 1 }],
      },
      {
        itemId: HIDE,
        count: 1,
        instance: { bindOnTrade: true },
        materialSources: [{ source: {}, count: 1 }],
      },
      {
        itemId: HIDE,
        count: 1,
        instance: { charges: { zap: 2 } },
        materialSources: [{ source: { signer: 'Sender' }, count: 1 }],
      },
    ];

    expect(mailMaterialAttachmentAvailableCount(inventory, HIDE)).toBe(0);
    expect(mailMaterialAttachmentAvailableCount(inventory, HIDE, { locked: true })).toBe(0);
    expect(mailMaterialAttachmentAvailableCount(inventory, HIDE, { bindOnTrade: true })).toBe(0);
    expect(mailMaterialAttachmentAvailableCount(inventory, HIDE, { charges: { zap: 2 } })).toBe(1);
  });
});
