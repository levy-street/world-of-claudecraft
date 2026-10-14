// MusicDirector teardown for a page that is going away (the editor's pagehide
// teardown and the studio world swaps, src/game/studio_boot.ts). It sits beside
// the director instead of inside it (the music.ts monolith ratchet), reading
// the director's private plumbing through an untyped host the same way
// minigame_music_layer.ts and music_venue_layer.ts do, welded to music.ts in
// tests/music.test.ts.
//
// Only page-retiring paths call it, and the built-in world never retires its
// page through them, so it changes nothing about a normal session.

import { venueLayerFor } from './music_venue_layer';

/** The private MusicDirector members the teardown releases. */
interface MusicDirectorTeardownHost {
  timer: number | undefined;
  bossSource: AudioBufferSourceNode | null;
  bossElement: HTMLAudioElement | null;
  zoneStreams: Partial<Record<string, { el: HTMLAudioElement | null }>>;
  combatStreams: { el: HTMLAudioElement | null }[];
  ctx: AudioContext | null;
  master: GainNode | null;
  bossGain: GainNode | null;
  zone: string | null;
  combat: boolean;
}

/**
 * Tear the director down. Without this, a navigation ping-pong leaks an audio
 * thread, the scheduler interval, and the whole layer graph per hop. Nulls the
 * context so a later init() rebuilds it and re-arms the scheduler.
 */
export function closeMusicDirector(director: object): void {
  const h = director as MusicDirectorTeardownHost;
  if (h.timer !== undefined) {
    clearInterval(h.timer);
    h.timer = undefined;
  }
  try {
    h.bossSource?.stop();
  } catch {
    /* already stopped */
  }
  h.bossSource = null;
  for (const el of [
    h.bossElement,
    ...Object.values(h.zoneStreams).map((s) => s?.el ?? null),
    ...h.combatStreams.map((s) => s.el),
  ]) {
    if (!el) continue;
    try {
      el.pause();
      el.src = '';
    } catch {
      /* best-effort */
    }
  }
  h.bossElement = null;
  h.zoneStreams = {};
  h.combatStreams = [];
  venueLayerFor(director).detach();
  const ctx = h.ctx;
  h.ctx = null;
  h.master = null;
  h.bossGain = null;
  h.zone = null;
  h.combat = false;
  if (ctx) void ctx.close().catch(() => {});
}
