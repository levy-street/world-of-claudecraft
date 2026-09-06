// Source-container load for real save-cost probes. The whole-character fixture
// in professions_blob_growth.test.ts separately covers every serialized field.

import { stackSizeOf } from '../../src/sim/bags';
import {
  BANK_BAG_SOCKETS,
  BANK_BASE_SLOTS,
  BANK_MAX_BONUS_SLOTS,
  BANK_PURCHASED_SLOTS_MAX,
} from '../../src/sim/bank';
import type { CharacterState } from '../../src/sim/character_state';
import { ITEMS } from '../../src/sim/data';
import { materialItemIds } from '../../src/sim/material_ids';
import type { InvSlot } from '../../src/sim/types';

export function fullMaterialSourceSaveFixture(
  shape: 'single' | 'five' | 'per-unit',
  signer = 'S'.repeat(16),
): CharacterState {
  const ids = [...materialItemIds()].sort();
  let sourceId = 1;
  const stack = (itemId: string, count: number): InvSlot => {
    const buckets = shape === 'single' ? 1 : shape === 'five' ? Math.min(5, count) : count;
    return {
      itemId,
      count,
      materialSources: Array.from({ length: buckets }, (_, index) => ({
        count: Math.floor(count / buckets) + (index < count % buckets ? 1 : 0),
        source: {
          gatherer: { kind: 'character' as const, id: sourceId++, name: 'W'.repeat(16) },
          signer,
        },
      })),
    };
  };
  const itemId = ids[0]!;
  return {
    questLog: [],
    questsDone: [],
    inventory: Array.from({ length: 16 + 4 * 24 }, () => stack(itemId, stackSizeOf(ITEMS[itemId]))),
    vendorBuyback: Array.from({ length: 12 }, () => stack(itemId, stackSizeOf(ITEMS[itemId]))),
    bank: {
      inventory: Array.from(
        {
          length:
            BANK_BASE_SLOTS +
            BANK_PURCHASED_SLOTS_MAX +
            BANK_MAX_BONUS_SLOTS +
            BANK_BAG_SOCKETS * 24,
        },
        () => stack(itemId, stackSizeOf(ITEMS[itemId])),
      ),
    },
    vault: { stock: {}, special: ids.map((id) => stack(id, 200)), upgrades: 0 },
  } as unknown as CharacterState;
}
