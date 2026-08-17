// Remastered soundtrack catalog: the streamed mp3 renders of the procedural
// themes, served from public/audio/music/. The composition machinery in
// music.ts remains the authoring source (music editor + offline render
// pipeline); these files are its remastered renders and own runtime playback.
// Pure data + math, DOM-free, so it unit-tests in plain Node.
//
// Each URL carries a `?v=<hash12>` content hash (first 12 hex chars of the
// file's sha256), same convention as the sampled SFX manifest
// (scripts/sfx/manifest.mjs), so server/static_cache.ts can serve these large
// (multi-MB) tracks with a year-long immutable Cache-Control instead of
// falling through to no-cache. When you replace a public/audio/music/<file>
// with a new remaster, recompute its hash (`sha256sum <file> | cut -c1-12`,
// same truncation `scripts/render_music.mjs --hash` prints) and update every
// URL that references it here; tests/music_tracks.test.ts pins the hash
// against the committed file so a forgotten update fails the gate rather than
// serving stale audio to a returning player forever.

import type { MusicZone } from './music';

/** Streamed remaster for each zone cue. null means the zone has no stream:
 *  vale_cup is only ever active at the Sowfield stadium, where the dedicated
 *  sowfield-waiting/sowfield-match tracks own the mix and the zone bus is
 *  ducked to silence, so streaming a file for it would only waste bandwidth. */
export const ZONE_STREAM_URLS: Record<MusicZone, string | null> = {
  town_eastbrook: '/audio/music/town_eastbrook.mp3?v=251c46caf6ce',
  town_fenbridge: '/audio/music/town_fenbridge.mp3?v=1a94215a28f8',
  town_highwatch: '/audio/music/town_highwatch.mp3?v=8daa06e91073',
  vale: '/audio/music/vale.mp3?v=d40a82892e1e',
  // The legacy vale cue has no dedicated remaster and is not routed by
  // musicZoneForLocation; the vale remaster stands in for completeness.
  vale_legacy: '/audio/music/vale.mp3?v=d40a82892e1e',
  marsh: '/audio/music/marsh.mp3?v=ad5dcf5613b9',
  peaks: '/audio/music/peaks.mp3?v=b41ca1a8edcc',
  // STAND-INS (same precedent as vale_legacy): Veiled Hollow, Drakelands, and
  // Wraithwood do not have supplied remasters yet, so they stream the nearest
  // existing render instead of falling silent. Replace these three URLs when
  // their dedicated public/audio/music/<zone>.mp3 files land.
  dusk: '/audio/music/marsh.mp3?v=ad5dcf5613b9',
  ember: '/audio/music/peaks.mp3?v=b41ca1a8edcc',
  frost: '/audio/music/frost.mp3?v=88500e3eb213',
  amber: '/audio/music/amber.mp3?v=338cb1c002c2',
  fen: '/audio/music/fen.mp3?v=1ff84a71dd31',
  night: '/audio/music/night.mp3?v=44f582c43720',
  haunt: '/audio/music/marsh.mp3?v=ad5dcf5613b9',
  jungle: '/audio/music/jungle.mp3?v=9b86b3bbeb7b',
  garden: '/audio/music/garden.mp3?v=9ec0e18f6d81',
  gale: '/audio/music/gale.mp3?v=a940defc3275',
  farshore: '/audio/music/farshore.mp3?v=69d713cd3f3c',
  vale_cup: null,
  dungeon_hollow_crypt: '/audio/music/dungeon_hollow_crypt.mp3?v=4bb48c2d90fc',
  dungeon_sunken_bastion: '/audio/music/dungeon_sunken_bastion.mp3?v=db67d7df0f4b',
  dungeon_gravewyrm_sanctum: '/audio/music/dungeon_gravewyrm_sanctum.mp3?v=19f49e28f3af',
  // Rift crawl stand-ins borrow the nearest-mood dungeon crawl render.
  rift_frost: '/audio/music/dungeon_gravewyrm_sanctum.mp3?v=19f49e28f3af',
  rift_ember: '/audio/music/dungeon_hollow_crypt.mp3?v=4bb48c2d90fc',
  rift_venom: '/audio/music/dungeon_sunken_bastion.mp3?v=db67d7df0f4b',
  rift_bone: '/audio/music/dungeon_gravewyrm_sanctum.mp3?v=19f49e28f3af',
  rift_brute: '/audio/music/dungeon_hollow_crypt.mp3?v=4bb48c2d90fc',
  rift_void: '/audio/music/dungeon_gravewyrm_sanctum.mp3?v=19f49e28f3af',
  rift_storm: '/audio/music/dungeon_hollow_crypt.mp3?v=4bb48c2d90fc',
  rift_tide: '/audio/music/dungeon_sunken_bastion.mp3?v=db67d7df0f4b',
};

/** The remastered battle themes; each fight opens on one chosen at random. */
export const COMBAT_STREAM_URLS: string[] = [
  '/audio/music/combat_1.mp3?v=c2587cdfa73a',
  '/audio/music/combat_2.mp3?v=36f7fc946e3a',
];

/** Pick which battle theme opens the next fight: uniform over the catalog.
 *  rand is injected (Math.random at the call site) so tests can drive it;
 *  the result is clamped so rand() returning exactly 1 stays in range. */
export function pickCombatTrackIndex(trackCount: number, rand: () => number): number {
  if (trackCount <= 0) return 0;
  const idx = Math.floor(rand() * trackCount);
  return Math.min(trackCount - 1, Math.max(0, idx));
}
