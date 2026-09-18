// The guild_pledge_settings command parser (server/guild_pledge_settings_cmd.ts):
// every field re-validated at the trust boundary, the category flag optional so
// an older client's write leaves the stored opt-in alone.

import { describe, expect, it } from 'vitest';
import { parseGuildPledgeSettingsCommand } from '../../server/guild_pledge_settings_cmd';

describe('parseGuildPledgeSettingsCommand', () => {
  const base = { cmd: 'guild_pledge_settings', enabled: true, minLevel: 10, note: 'hi' };

  it('accepts the current frame with the category flag', () => {
    expect(parseGuildPledgeSettingsCommand({ ...base, newPlayerFriendly: true })).toEqual({
      enabled: true,
      minLevel: 10,
      note: 'hi',
      newPlayerFriendly: true,
    });
  });

  it('accepts an older frame without the flag, and leaves the flag ABSENT (not false)', () => {
    const parsed = parseGuildPledgeSettingsCommand(base);
    expect(parsed).toEqual({ enabled: true, minLevel: 10, note: 'hi' });
    expect(parsed && 'newPlayerFriendly' in parsed).toBe(false);
  });

  it('rejects a malformed field, the flag included', () => {
    expect(parseGuildPledgeSettingsCommand({ ...base, enabled: 'yes' })).toBeNull();
    expect(parseGuildPledgeSettingsCommand({ ...base, minLevel: '10' })).toBeNull();
    expect(parseGuildPledgeSettingsCommand({ ...base, minLevel: Number.NaN })).toBeNull();
    expect(parseGuildPledgeSettingsCommand({ ...base, note: 4 })).toBeNull();
    expect(parseGuildPledgeSettingsCommand({ ...base, newPlayerFriendly: 'true' })).toBeNull();
    expect(parseGuildPledgeSettingsCommand({ ...base, newPlayerFriendly: null })).toBeNull();
  });
});
