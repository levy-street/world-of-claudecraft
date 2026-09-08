import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { bagOwnedMounts, mountItemId } from '../src/sim/mounts';

const LEGACY = [
  'mech_bird',
  'chimeglass_tortoise',
  'rickshaw_mount',
  'goblin_rocket_sled',
  'rallycart_rxt',
];

describe('retired mount reins compatibility', () => {
  it.each(LEGACY)('keeps %s readable and discardable without granting a ride', (id) => {
    const itemId = `reins_${id}`;
    const def = ITEMS[itemId];
    expect(def).toBeDefined();
    expect(def.name.length).toBeGreaterThan(0);
    expect(def.kind).toBe('junk');
    expect(def.soulbound).toBe(true);
    expect(def.noVendorSell).toBe(true);
    expect(def.noDiscard).not.toBe(true);
    expect(mountItemId(id)).toBeNull();
    expect(bagOwnedMounts([{ itemId }])).toEqual([]);
  });
});
