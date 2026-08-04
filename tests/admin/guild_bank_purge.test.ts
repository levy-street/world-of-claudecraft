import { describe, expect, it } from 'vitest';
import { buildGuildBankPurge, GUILD_BANK_REASON_MAX } from '../../src/admin/guild_bank_purge';

describe('buildGuildBankPurge', () => {
  it('shapes the three-part body the endpoint requires, trimming operator whitespace', () => {
    expect(buildGuildBankPurge(0, 'reins_grag_bear', '  stuck rift-gear copy  ')).toEqual({
      body: { slot: 0, itemId: 'reins_grag_bear', reason: 'stuck rift-gear copy' },
    });
    // Slot 0 is a real slot, not a falsy "nothing selected".
    expect(buildGuildBankPurge(7, '  riding_training  ', 'x')).toEqual({
      body: { slot: 7, itemId: 'riding_training', reason: 'x' },
    });
  });

  it('refuses a submission that could not possibly be valid, one dimension at a time', () => {
    expect(buildGuildBankPurge(-1, 'wolf_fang', 'reason')).toEqual({
      errorKey: 'guilds.bankPurgeSlotRequired',
    });
    expect(buildGuildBankPurge(1.5, 'wolf_fang', 'reason')).toEqual({
      errorKey: 'guilds.bankPurgeSlotRequired',
    });
    expect(buildGuildBankPurge(Number.NaN, 'wolf_fang', 'reason')).toEqual({
      errorKey: 'guilds.bankPurgeSlotRequired',
    });
    expect(buildGuildBankPurge(0, '   ', 'reason')).toEqual({
      errorKey: 'guilds.bankPurgeItemRequired',
    });
    expect(buildGuildBankPurge(0, 'wolf_fang', '   ')).toEqual({
      errorKey: 'guilds.bankPurgeReasonRequired',
    });
  });

  it('mirrors the server reason cap, refusing one character past it', () => {
    // The server bar (ADMIN_GUILD_REASON_MAX) is applied to the TRIMMED reason,
    // so trailing whitespace must not push a legal reason over the line.
    expect(GUILD_BANK_REASON_MAX).toBe(500);
    const atCap = 'r'.repeat(500);
    expect(buildGuildBankPurge(0, 'wolf_fang', atCap)).toEqual({
      body: { slot: 0, itemId: 'wolf_fang', reason: atCap },
    });
    expect(buildGuildBankPurge(0, 'wolf_fang', `  ${atCap}  `)).toEqual({
      body: { slot: 0, itemId: 'wolf_fang', reason: atCap },
    });
    expect(buildGuildBankPurge(0, 'wolf_fang', 'r'.repeat(501))).toEqual({
      errorKey: 'guilds.bankPurgeReasonTooLong',
    });
  });
});
