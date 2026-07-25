// Remastered soundtrack catalog: the streamed mp3 renders of the procedural
// themes, served from public/audio/music/. The composition machinery in
// music.ts remains the authoring source (music editor + offline render
// pipeline); these files are its remastered renders and own runtime playback.
// Pure data + math, DOM-free, so it unit-tests in plain Node.

import type { MusicZone } from './music';

/** Streamed remaster for each zone cue. null means the zone has no stream:
 *  vale_cup is only ever active at the Sowfield stadium, where the dedicated
 *  sowfield-waiting/sowfield-match tracks own the mix and the zone bus is
 *  ducked to silence, so streaming a file for it would only waste bandwidth. */
export const ZONE_STREAM_URLS: Record<MusicZone, string | null> = {
  town_eastbrook: '/audio/music/town_eastbrook.mp3',
  town_fenbridge: '/audio/music/town_fenbridge.mp3',
  town_highwatch: '/audio/music/town_highwatch.mp3',
  vale: '/audio/music/vale.mp3',
  // The legacy vale cue has no dedicated remaster and is not routed by
  // musicZoneForLocation; the vale remaster stands in for completeness.
  vale_legacy: '/audio/music/vale.mp3',
  marsh: '/audio/music/marsh.mp3',
  peaks: '/audio/music/peaks.mp3',
  vale_cup: null,
  dungeon_hollow_crypt: '/audio/music/dungeon_hollow_crypt.mp3',
  dungeon_sunken_bastion: '/audio/music/dungeon_sunken_bastion.mp3',
  dungeon_gravewyrm_sanctum: '/audio/music/dungeon_gravewyrm_sanctum.mp3',
};

/** The remastered battle themes; each fight opens on one chosen at random. */
export const COMBAT_STREAM_URLS: string[] = [
  '/audio/music/combat_1.mp3',
  '/audio/music/combat_2.mp3',
];

/** Pick which battle theme opens the next fight: uniform over the catalog.
 *  rand is injected (Math.random at the call site) so tests can drive it;
 *  the result is clamped so rand() returning exactly 1 stays in range. */
export function pickCombatTrackIndex(trackCount: number, rand: () => number): number {
  if (trackCount <= 0) return 0;
  const idx = Math.floor(rand() * trackCount);
  return Math.min(trackCount - 1, Math.max(0, idx));
}
