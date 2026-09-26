// The signpost roster drill-in decoder (src/net/guild_roster_wire.ts, moved
// verbatim out of online.ts guildRoster): every field re-validated at the
// trust boundary, the rank narrowed to the public roster's three labels, and a
// body that is not a roster at all rejected so the window can offer a retry.
import { describe, expect, it } from 'vitest';
import { decodeGuildRoster } from '../src/net/guild_roster_wire';

describe('decodeGuildRoster', () => {
  it('coerces fields and narrows any other rank (a custom title) to member', () => {
    expect(
      decodeGuildRoster({
        guild: 'Knights',
        members: [
          { name: 'Ada', class: 'mage', rank: 'leader', level: '12', lifetimeXp: 900 },
          { name: 'Bo', class: 'rogue', rank: 'officer', level: 7, lifetimeXp: 'x' },
          { name: 'Cy', rank: 'r3', level: null },
          {},
        ],
      }),
    ).toEqual({
      guild: 'Knights',
      members: [
        { name: 'Ada', class: 'mage', rank: 'leader', level: 12, lifetimeXp: 900 },
        { name: 'Bo', class: 'rogue', rank: 'officer', level: 7, lifetimeXp: 0 },
        { name: 'Cy', class: '', rank: 'member', level: 0, lifetimeXp: 0 },
        { name: '', class: '', rank: 'member', level: 0, lifetimeXp: 0 },
      ],
    });
  });

  it('rejects a body that is not a roster', () => {
    for (const bad of [null, {}, { guild: 5, members: [] }, { guild: 'K', members: 'x' }]) {
      expect(() => decodeGuildRoster(bad)).toThrow('malformed body');
    }
  });
});
