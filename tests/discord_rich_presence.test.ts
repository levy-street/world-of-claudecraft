import { describe, expect, it } from 'vitest';
import { buildDiscordRichPresence } from '../server/discord_rich_presence';

describe('buildDiscordRichPresence', () => {
  it('formats a Discord RPC-friendly activity from live character state', () => {
    const presence = buildDiscordRichPresence({
      characterName: 'Maelin',
      className: 'mage',
      level: 17,
      zone: 'The Hollow Crypt',
      status: 'dungeon',
      joinedAt: 1_720_000_123_456,
      realm: 'Claudemoon',
      profileUrl: 'https://worldofclaudecraft.com/c/Maelin',
    });

    expect(presence.details).toBe('Maelin - Level 17 Mage');
    expect(presence.state).toBe('In a dungeon in The Hollow Crypt');
    expect(presence.largeImageKey).toBe('world_of_claudecraft');
    expect(presence.smallImageKey).toBe('class_mage');
    expect(presence.startTimestamp).toBe(1_720_000_123);
    expect(presence.metadata).toMatchObject({
      characterName: 'Maelin',
      className: 'Mage',
      level: 17,
      zone: 'The Hollow Crypt',
      status: 'dungeon',
      realm: 'Claudemoon',
      profileUrl: 'https://worldofclaudecraft.com/c/Maelin',
    });
  });

  it('clamps sparse or malformed inputs to stable display fallbacks', () => {
    const presence = buildDiscordRichPresence({
      characterName: '  ',
      className: '  frost mage!! ',
      level: 0,
      zone: '',
      status: 'dead',
      joinedAt: -25,
      realm: 'Claudemoon',
      profileUrl: null,
    });

    expect(presence.details).toBe('Adventurer - Level 1 Frost mage!!');
    expect(presence.state).toBe('Dead in Unknown');
    expect(presence.smallImageKey).toBe('class_frost_mage');
    expect(presence.startTimestamp).toBe(0);
    expect(presence.metadata.profileUrl).toBeNull();
  });
});
