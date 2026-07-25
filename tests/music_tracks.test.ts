import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MusicZone } from '../src/game/music';
import {
  COMBAT_STREAM_URLS,
  pickCombatTrackIndex,
  ZONE_STREAM_URLS,
} from '../src/game/music_tracks';

const publicDir = path.join(__dirname, '..', 'public');

function assetPath(url: string): string {
  return path.join(publicDir, ...url.split('/').filter(Boolean));
}

describe('remastered soundtrack catalog', () => {
  it('maps every routable zone to a committed mp3 under public/audio/music', () => {
    for (const [zone, url] of Object.entries(ZONE_STREAM_URLS)) {
      if (url === null) continue;
      expect(url, `zone '${zone}'`).toMatch(/^\/audio\/music\/[a-z0-9_]+\.mp3$/);
      expect(existsSync(assetPath(url)), `missing asset for zone '${zone}': ${url}`).toBe(true);
    }
  });

  it('leaves vale_cup streamless: the Sowfield mp3 pair owns that mix', () => {
    expect(ZONE_STREAM_URLS.vale_cup).toBeNull();
  });

  it('ships the two battle themes and they exist on disk', () => {
    expect(COMBAT_STREAM_URLS).toHaveLength(2);
    for (const url of COMBAT_STREAM_URLS) {
      expect(url).toMatch(/^\/audio\/music\/combat_[0-9]+\.mp3$/);
      expect(existsSync(assetPath(url)), `missing combat asset: ${url}`).toBe(true);
    }
  });

  it('covers every MusicZone key exactly once', () => {
    const zones: MusicZone[] = [
      'town_eastbrook',
      'town_fenbridge',
      'town_highwatch',
      'vale',
      'vale_legacy',
      'marsh',
      'peaks',
      'vale_cup',
      'dungeon_hollow_crypt',
      'dungeon_sunken_bastion',
      'dungeon_gravewyrm_sanctum',
    ];
    expect(Object.keys(ZONE_STREAM_URLS).sort()).toEqual([...zones].sort());
  });
});

describe('pickCombatTrackIndex', () => {
  it('spreads uniformly over the catalog', () => {
    expect(pickCombatTrackIndex(2, () => 0)).toBe(0);
    expect(pickCombatTrackIndex(2, () => 0.49)).toBe(0);
    expect(pickCombatTrackIndex(2, () => 0.5)).toBe(1);
    expect(pickCombatTrackIndex(2, () => 0.99)).toBe(1);
  });

  it('clamps degenerate rand values into range', () => {
    expect(pickCombatTrackIndex(2, () => 1)).toBe(1);
    expect(pickCombatTrackIndex(2, () => -0.5)).toBe(0);
    expect(pickCombatTrackIndex(0, () => 0.5)).toBe(0);
  });
});
