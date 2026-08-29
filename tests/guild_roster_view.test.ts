import { describe, expect, it } from 'vitest';
import { guildTierForLifetimeXp } from '../src/sim/guild_tier';
import { buildGuildRosterView } from '../src/ui/hud/guild_board/guild_roster_view';
import type { GuildRosterInfo } from '../src/world_api';

const INFO: GuildRosterInfo = {
  guild: 'Stormcallers',
  members: [
    { name: 'Boss', rank: 'leader', class: 'warrior', level: 20, lifetimeXp: 900_000 },
    { name: 'Right Hand', rank: 'officer', class: 'priest', level: 20, lifetimeXp: 800_000 },
    { name: 'Quiet One', rank: 'officer', class: 'mage', level: 18, lifetimeXp: 400_000 },
    { name: 'Fresh Blood', rank: 'member', class: 'rogue', level: 5, lifetimeXp: 40_000 },
  ],
};

describe('buildGuildRosterView', () => {
  it('maps a resolved roster preserving the server rank-then-XP order', () => {
    // Arrange + Act
    const view = buildGuildRosterView({ kind: 'info', guild: 'Stormcallers', info: INFO });

    // Assert
    expect(view.kind).toBe('loaded');
    if (view.kind !== 'loaded') return;
    expect(view.rows.map((r) => r.name)).toEqual([
      'Boss',
      'Right Hand',
      'Quiet One',
      'Fresh Blood',
    ]);
    expect(view.rows[0].rank).toBe('leader');
  });

  it('derives the guild colour tier from the summed roster XP', () => {
    // Arrange + Act
    const view = buildGuildRosterView({ kind: 'info', guild: 'Stormcallers', info: INFO });

    // Assert
    if (view.kind !== 'loaded') throw new Error('expected loaded');
    expect(view.totalLifetimeXp).toBe(2_140_000);
    expect(view.tier).toBe(guildTierForLifetimeXp(2_140_000));
  });

  it('maps null info and an empty roster to the empty state', () => {
    // Arrange + Act + Assert
    expect(buildGuildRosterView({ kind: 'info', guild: 'Ghost', info: null })).toEqual({
      kind: 'empty',
      guild: 'Ghost',
    });
    expect(
      buildGuildRosterView({ kind: 'info', guild: 'Empty', info: { guild: 'Empty', members: [] } }),
    ).toEqual({ kind: 'empty', guild: 'Empty' });
  });

  it('passes the loading and error discriminators through', () => {
    // Arrange + Act + Assert
    expect(buildGuildRosterView({ kind: 'loading', guild: 'G' })).toEqual({
      kind: 'loading',
      guild: 'G',
    });
    expect(buildGuildRosterView({ kind: 'error', guild: 'G' })).toEqual({
      kind: 'error',
      guild: 'G',
    });
  });
});
