import { describe, expect, it, vi } from 'vitest';
import type { MaterialSourceTransferSelection } from '../src/sim/material_source_transfer_selection';
import { bareClient } from './helpers/bare_client';

const routes = [
  ['bankDeposit', 'bank_deposit'],
  ['bankWithdraw', 'bank_withdraw'],
  ['vaultDeposit', 'vault_deposit'],
  ['guildBankDeposit', 'guild_bank_deposit'],
  ['guildBankWithdraw', 'guild_bank_withdraw'],
] as const;
const selection: MaterialSourceTransferSelection = {
  itemId: 'copper_ore',
  target: { slotIndex: 3, pin: '0'.repeat(32), anchor: { ordinal: 0, count: 1 } },
  quantities: [{ sourceIndex: 1, count: 2 }],
};

describe('storage command source intent', () => {
  it.each(routes)('%s preserves ordinary omission and exact selected intent', (method, cmd) => {
    const world = bareClient(1);
    const send = vi.fn();
    Object.assign(world, { cmd: send });
    world[method](3);
    expect(send).toHaveBeenLastCalledWith({ cmd, slot: 3 });
    world[method](3, 2, selection);
    expect(send).toHaveBeenLastCalledWith({ cmd, slot: 3, count: 2, selection });
    world[method](3, undefined, selection);
    expect(send).toHaveBeenLastCalledWith({ cmd, slot: 3, selection });
    expect(send).toHaveBeenCalledTimes(3);
  });
});
