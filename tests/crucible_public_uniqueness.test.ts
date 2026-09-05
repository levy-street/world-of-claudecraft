import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { isUniqueEquipped } from '../src/sim/equipment_rules';
import { publicInstanceView } from '../src/sim/item_instance_transfer';

describe('Crucible promotion uniqueness on inspected rank-zero copies', () => {
  it('retains the public unique-equipped fact without disclosing private binding proof', () => {
    const publicCopy = publicInstanceView({ perfectingBound: true, boundTo: 1, rolled: { quality: 'legendary' } });
    expect(publicCopy).not.toHaveProperty('perfectingBound');
    expect(isUniqueEquipped(ITEMS.crucible_str_mail_chest, publicCopy)).toBe(true);
    expect(isUniqueEquipped(ITEMS.wyrmfall_pendant, publicCopy)).toBe(false);
  });
});
