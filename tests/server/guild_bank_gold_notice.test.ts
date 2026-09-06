import { describe, expect, it, vi } from 'vitest';
import {
  broadcastGuildBankGoldNotice,
  formatGuildBankNoticeMoney,
  GUILD_BANK_GOLD_NOTICE_COLOR,
  type GuildBankGoldNoticePort,
  guildBankGoldNoticeText,
} from '../../server/guild_bank_gold_notice';
import { localizeServerText } from '../../src/ui/server_i18n';

describe('guild bank gold notice: money and sentence', () => {
  it('formats compact English money the way the client formatMoney does for en', () => {
    expect(formatGuildBankNoticeMoney(52003)).toBe('5g 20s 3c');
    expect(formatGuildBankNoticeMoney(50000)).toBe('5g 0s');
    expect(formatGuildBankNoticeMoney(2500)).toBe('25s');
    expect(formatGuildBankNoticeMoney(7)).toBe('7c');
    expect(formatGuildBankNoticeMoney(0)).toBe('0c');
    expect(formatGuildBankNoticeMoney(-300)).toBe('0c');
    expect(formatGuildBankNoticeMoney(Number.NaN)).toBe('0c');
  });

  it('names the actor, the direction, and the amount', () => {
    expect(guildBankGoldNoticeText('deposit_gold', 'Ada', 52003)).toBe(
      'Ada deposited 5g 20s 3c into the guild bank.',
    );
    expect(guildBankGoldNoticeText('withdraw_gold', 'Bob', 100000)).toBe(
      'Bob withdrew 10g 0s from the guild bank.',
    );
  });

  it('is recognized by the client server-text matcher for both directions', () => {
    // The server module lives outside the S3 emit scanner's corpus, so the
    // emit-to-matcher contract is pinned here byte for byte.
    expect(localizeServerText(guildBankGoldNoticeText('deposit_gold', 'Ada', 52003))).toBe(
      'Ada deposited 5g 20s 3c into the guild bank.',
    );
    expect(localizeServerText(guildBankGoldNoticeText('withdraw_gold', 'Bob', 7))).toBe(
      'Bob withdrew 7c from the guild bank.',
    );
    expect(
      localizeServerText(guildBankGoldNoticeText('withdraw_gold', 'Bob', 2500)),
    ).not.toBeNull();
  });
});

function makePort(members: number[], online: number[]) {
  const guildMembers = vi.fn(async (_guildId: number) => members.map((id) => ({ id })));
  const isOnline = vi.fn((id: number) => online.includes(id));
  const deliver = vi.fn();
  const port: GuildBankGoldNoticePort = { guildMembers, isOnline, deliver };
  return { port, guildMembers, isOnline, deliver };
}

describe('guild bank gold notice: fan-out', () => {
  it('delivers one guild-green log line to every ONLINE member, the actor included', async () => {
    const rig = makePort([1, 2, 3, 4], [1, 3]);
    const logError = vi.fn();

    await broadcastGuildBankGoldNotice(rig.port, 23, 'withdraw_gold', 'Ada', 52003, logError);

    expect(rig.guildMembers).toHaveBeenCalledWith(23);
    expect(rig.deliver).toHaveBeenCalledTimes(2);
    const expected = [
      {
        type: 'log',
        text: 'Ada withdrew 5g 20s 3c from the guild bank.',
        color: GUILD_BANK_GOLD_NOTICE_COLOR,
      },
    ];
    expect(rig.deliver).toHaveBeenCalledWith(1, expected);
    expect(rig.deliver).toHaveBeenCalledWith(3, expected);
    expect(logError).not.toHaveBeenCalled();
  });

  it('delivers nothing to an offline-only guild', async () => {
    const rig = makePort([1, 2], []);
    await broadcastGuildBankGoldNotice(rig.port, 23, 'deposit_gold', 'Ada', 100, vi.fn());
    expect(rig.deliver).not.toHaveBeenCalled();
  });

  it('logs and swallows a membership read failure instead of throwing', async () => {
    const rig = makePort([1], [1]);
    const error = new Error('roster read failed');
    rig.guildMembers.mockRejectedValueOnce(error);
    const logError = vi.fn();

    await expect(
      broadcastGuildBankGoldNotice(rig.port, 23, 'deposit_gold', 'Ada', 100, logError),
    ).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledWith(expect.stringContaining('guild 23'), error);
    expect(rig.deliver).not.toHaveBeenCalled();
  });
});
