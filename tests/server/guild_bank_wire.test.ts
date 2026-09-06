import { describe, expect, it, vi } from 'vitest';
import {
  dispatchGuildBankCommand,
  GUILD_BANK_COMMANDS,
  type GuildBankWireHost,
  isGuildBankCommand,
} from '../../server/guild_bank_wire';

function makeHost() {
  const sim = {
    guildBankDepositGoldFor: vi.fn(),
    guildBankWithdrawGoldFor: vi.fn(),
    guildBankDepositFor: vi.fn(),
    guildBankWithdrawFor: vi.fn(),
    guildBankBuySlotsFor: vi.fn(),
  };
  // The host runner is what the coordinator sits behind; here it just runs
  // the mutation so the sim call and the op label can both be asserted.
  const run = vi.fn((_op: string, mutate: () => void) => mutate());
  const host: GuildBankWireHost = { sim, run };
  return { host, sim, run };
}

describe('guild bank wire dispatch', () => {
  it('recognizes exactly the five mutation commands', () => {
    for (const cmd of GUILD_BANK_COMMANDS) expect(isGuildBankCommand(cmd)).toBe(true);
    expect(isGuildBankCommand('guild_bank_log')).toBe(false);
    expect(isGuildBankCommand('vault_deposit')).toBe(false);
  });

  it('routes a gold deposit through the runner under the deposit_gold op', () => {
    const rig = makeHost();
    dispatchGuildBankCommand(rig.host, 'guild_bank_deposit_gold', { amount: 5000 }, 7);
    expect(rig.run).toHaveBeenCalledWith('deposit_gold', expect.any(Function));
    expect(rig.sim.guildBankDepositGoldFor).toHaveBeenCalledWith(7, 5000);
  });

  it('routes a gold withdrawal through the runner under the withdraw_gold op', () => {
    const rig = makeHost();
    dispatchGuildBankCommand(rig.host, 'guild_bank_withdraw_gold', { amount: 250 }, 7);
    expect(rig.run).toHaveBeenCalledWith('withdraw_gold', expect.any(Function));
    expect(rig.sim.guildBankWithdrawGoldFor).toHaveBeenCalledWith(7, 250);
  });

  it('routes item deposit and withdraw with an optional count', () => {
    const rig = makeHost();
    dispatchGuildBankCommand(rig.host, 'guild_bank_deposit', { slot: 3, count: 2 }, 7);
    dispatchGuildBankCommand(rig.host, 'guild_bank_withdraw', { slot: 4 }, 7);
    expect(rig.sim.guildBankDepositFor).toHaveBeenCalledWith(7, 3, 2);
    expect(rig.sim.guildBankWithdrawFor).toHaveBeenCalledWith(7, 4, undefined);
    expect(rig.run.mock.calls.map((c) => c[0])).toEqual(['deposit', 'withdraw']);
  });

  it('routes buy_slots with no payload', () => {
    const rig = makeHost();
    dispatchGuildBankCommand(rig.host, 'guild_bank_buy_slots', {}, 7);
    expect(rig.run).toHaveBeenCalledWith('buy_slots', expect.any(Function));
    expect(rig.sim.guildBankBuySlotsFor).toHaveBeenCalledWith(7);
  });

  it('drops a malformed frame without touching the runner', () => {
    const rig = makeHost();
    dispatchGuildBankCommand(rig.host, 'guild_bank_deposit_gold', { amount: '5000' }, 7);
    dispatchGuildBankCommand(rig.host, 'guild_bank_withdraw_gold', {}, 7);
    dispatchGuildBankCommand(rig.host, 'guild_bank_deposit', { slot: 'a' }, 7);
    dispatchGuildBankCommand(rig.host, 'guild_bank_withdraw', { count: 1 }, 7);
    expect(rig.run).not.toHaveBeenCalled();
  });
});
