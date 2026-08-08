import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
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
  return path.join(publicDir, ...url.split('?')[0].split('/').filter(Boolean));
}

/** The `?v=<hash12>` query every URL below carries: first 12 hex chars of the
 * file's sha256, same convention as the sampled SFX manifest
 * (scripts/sfx/manifest.mjs). server/static_cache.ts trusts an exact regex
 * match to cache the file immutably, so this suite is the guard rail that
 * catches a swapped-in remaster whose URL hash was not updated to match
 * (recompute via `node scripts/render_music.mjs --hash <file>`). */
function assetHash(url: string): string {
  return createHash('sha256')
    .update(readFileSync(assetPath(url)))
    .digest('hex')
    .slice(0, 12);
}

describe('remastered soundtrack catalog', () => {
  it('maps every routable zone to a committed, content-hash-versioned mp3 under public/audio/music', () => {
    for (const [zone, url] of Object.entries(ZONE_STREAM_URLS)) {
      if (url === null) continue;
      expect(url, `zone '${zone}'`).toMatch(/^\/audio\/music\/[a-z0-9_]+\.mp3\?v=[a-f0-9]{12}$/);
      expect(existsSync(assetPath(url)), `missing asset for zone '${zone}': ${url}`).toBe(true);
      const [, requestedHash] = url.split('?v=');
      expect(requestedHash, `stale cache-bust hash for zone '${zone}': ${url}`).toBe(
        assetHash(url),
      );
    }
  });

  it('leaves vale_cup streamless: the Sowfield mp3 pair owns that mix', () => {
    expect(ZONE_STREAM_URLS.vale_cup).toBeNull();
  });

  it('routes each supplied new-zone remaster to its matching music cue', () => {
    const supplied = {
      amber: [
        '/audio/music/amber.mp3',
        '338cb1c002c2139e3a9900f8145b3bb983d0c84da6168a52d3e3f0197c381440',
      ],
      farshore: [
        '/audio/music/farshore.mp3',
        '69d713cd3f3c3413e9cafb59fddb0b797fa147a2d80392d073bb076ef32103d6',
      ],
      fen: [
        '/audio/music/fen.mp3',
        '1ff84a71dd315f5a9c22ce374736bb1b852db7bd804b8557ef2d9eb6dc1e7278',
      ],
      frost: [
        '/audio/music/frost.mp3',
        '88500e3eb213b721296e48562870adf7b62f375ebcb89caaa44821b2538f22ad',
      ],
      gale: [
        '/audio/music/gale.mp3',
        'a940defc3275abb593c21bcf0ea8d0477523a62bfbebfa1d83b0904734532a5c',
      ],
      garden: [
        '/audio/music/garden.mp3',
        '9ec0e18f6d817d991ddadb6390d6908dd17cc6366c9903221c6f1dd784e4fbad',
      ],
      jungle: [
        '/audio/music/jungle.mp3',
        '9b86b3bbeb7b58e3eb971a8b13a5778c0f91b8bd189dd5824f01f7721ad38848',
      ],
      night: [
        '/audio/music/night.mp3',
        '44f582c437208d480fc0cb828e1ed91f254ccd4cd0236a0815c97e76fb75394e',
      ],
    } as const satisfies Partial<Record<MusicZone, readonly [string, string]>>;

    for (const [zone, [url, expectedHash]] of Object.entries(supplied)) {
      const versionedUrl = `${url}?v=${expectedHash.slice(0, 12)}`;
      expect(ZONE_STREAM_URLS[zone as MusicZone], zone).toBe(versionedUrl);
      const hash = createHash('sha256')
        .update(readFileSync(assetPath(url)))
        .digest('hex');
      expect(hash, `${zone} remaster bytes`).toBe(expectedHash);
    }
  });

  it('keeps explicit stand-ins only for new zones without supplied remasters', () => {
    expect(ZONE_STREAM_URLS.dusk).toBe(ZONE_STREAM_URLS.marsh);
    expect(ZONE_STREAM_URLS.ember).toBe(ZONE_STREAM_URLS.peaks);
    expect(ZONE_STREAM_URLS.haunt).toBe(ZONE_STREAM_URLS.marsh);
  });

  it('ships the two battle themes and they exist on disk', () => {
    expect(COMBAT_STREAM_URLS).toHaveLength(2);
    for (const url of COMBAT_STREAM_URLS) {
      expect(url).toMatch(/^\/audio\/music\/combat_[0-9]+\.mp3\?v=[a-f0-9]{12}$/);
      expect(existsSync(assetPath(url)), `missing combat asset: ${url}`).toBe(true);
      const [, requestedHash] = url.split('?v=');
      expect(requestedHash, `stale cache-bust hash: ${url}`).toBe(assetHash(url));
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
      'dusk',
      'ember',
      'frost',
      'amber',
      'fen',
      'night',
      'haunt',
      'jungle',
      'garden',
      'gale',
      'farshore',
      'vale_cup',
      'dungeon_hollow_crypt',
      'dungeon_sunken_bastion',
      'dungeon_gravewyrm_sanctum',
      'rift_frost',
      'rift_ember',
      'rift_venom',
      'rift_bone',
      'rift_brute',
      'rift_void',
      'rift_storm',
      'rift_tide',
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
