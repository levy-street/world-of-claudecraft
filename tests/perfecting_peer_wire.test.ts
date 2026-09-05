import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));

import { wireEntity } from '../server/game';
import { createPlayer } from '../src/sim/entity';
import { activeItemInstanceStats, isItemEnchantActive } from '../src/sim/item_instance_stats';
import { publicInstanceView } from '../src/sim/item_instance_transfer';
import type { ItemInstancePayload } from '../src/sim/types';

describe('inspect preserves the visible Perfected state without private rank provenance', () => {
  it.each([false, true])('mirrors active enchant stats when Perfected=%s', (perfected) => {
    const instance: ItemInstancePayload = {
      signer: 'Ayla',
      name: 'Lastlight',
      enchant: 'enchant_lucent_infusion',
      rolled: { quality: 'legendary', stats: { sta: 13, str: 2 } },
      ...(perfected ? { perfected: true } : { perfecting: 1 }),
      perfectingBound: true,
      perfectingBonus: { str: 2 },
      boundTo: 77,
    };
    const projected = publicInstanceView(instance);
    expect(projected.perfected).toBe(perfected ? true : undefined);
    expect(isItemEnchantActive(projected)).toBe(perfected);
    expect(activeItemInstanceStats(projected)).toEqual(activeItemInstanceStats(instance));
    for (const field of ['perfecting', 'perfectingBound', 'perfectingBonus', 'boundTo']) {
      expect(projected).not.toHaveProperty(field);
    }
    const entity = createPlayer(1, 'warrior', { x: 0, y: 0, z: 0 }, 'Crafter');
    entity.equippedInstances = { chest: instance };
    expect(wireEntity(entity).eqi).toEqual({ chest: projected });
  });
});
