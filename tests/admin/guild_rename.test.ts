import { describe, expect, it } from 'vitest';
import { buildGuildRename } from '../../src/admin/guild_rename';

describe('buildGuildRename', () => {
  it('requires only non-empty name and reason values on the client', () => {
    expect(buildGuildRename('   ', 'offensive name')).toEqual({
      errorKey: 'guilds.renameNameRequired',
    });
    expect(buildGuildRename('Better Name', '   ')).toEqual({
      errorKey: 'guilds.renameReasonRequired',
    });
    expect(buildGuildRename('  Better Name  ', '  moderation request  ')).toEqual({
      body: { name: 'Better Name', reason: 'moderation request' },
    });
    expect(buildGuildRename('x', 'reason')).toEqual({
      body: { name: 'x', reason: 'reason' },
    });
  });
});
