// The sports-venue soundtrack layer (the Deepglass bell, an authored map) and
// the venue-aware stream targeting it needs. It sits beside MusicDirector
// instead of inside it (the music.ts monolith ratchet), the same way
// minigame_music_layer.ts does: the director keeps a handful of one-line hooks
// (setVenueTrack, the four mix-change re-applies, the init attach, the update
// call into applyStreamTargets) and this layer reads the director's private
// stream plumbing through an untyped host, welded to music.ts in
// tests/music.test.ts.
//
// Built-in world: no venue is ever armed there (the HUD's music input carries
// no Deepglass outside the arena), so setTrack(..., null) is a no-op, no venue
// gain or element is ever created, and applyStreamTargets resolves exactly the
// zone/combat targets music.ts's update() always did.

import { resumeWhenAllowed } from './audio_unlock';
import type { CrucibleFloor } from './crucible_music';
import { minigameLayerFor } from './minigame_music_layer';
import { pickCombatTrackIndex, zoneStreamUrls } from './music_tracks';
import type { MusicZone } from './music_zones';

/** The sports venues that bring their own soundtrack: a waiting cue for the
 *  grounds between games and a match cue that takes over at kickoff. Upstream
 *  v0.40 retired the Vale Cup and deleted the Sowfield's pair with it, so the
 *  Deepglass bell is the only venue left; the map shape stays because the
 *  machinery is per-venue and the next arena is a row, not a rewrite. */
export type MusicVenue = 'deepglass';

/** The cues one venue can be playing. `boss` is the third of them: an arena
 *  that hosts an encounter as well as a game needs its own theme for it, and
 *  neither of the other two is right underneath a boss (the grounds cue is
 *  too idle and the match cue is a sport). A venue that declares no boss file
 *  simply never arms this track (see apply), so adding one to the next arena
 *  stays a row rather than a rewrite. */
export type VenueTrack = 'waiting' | 'match' | 'boss';

export const VENUE_MUSIC: Record<MusicVenue, { waiting?: string; match: string; boss?: string }> = {
  // The Deepglass bell: the grounds cue while you explore Tidehold and the
  // bell between bouts ("Sunken Coral Sanctuary", SPACEY's supplied track,
  // re-encoded to the 192 kbps spec and shipped under the waiting name
  // 2026-09-07), the arena cue from the whistle to the final horn
  // (docs/prd/deepglass.md), and the boss theme for a fight held in the bell
  // rather than a deepball match.
  deepglass: {
    waiting: '/audio/deepglass-waiting.mp3',
    match: '/audio/deepglass-match.mp3',
    boss: '/audio/deepglass-boss.mp3',
  },
};

/** The part of MusicDirector's private StreamTrack the layer touches. */
export interface VenueLayerStream {
  url: string;
  el: HTMLAudioElement | null;
  gain: GainNode;
  target: number;
}

/** The private MusicDirector members the layer reads and drives. */
interface MusicDirectorVenueHost<S extends VenueLayerStream> {
  ctx: AudioContext | null;
  master: GainNode | null;
  zone: MusicZone | null;
  combat: boolean;
  combatIdx: number;
  crucibleFloor: CrucibleFloor | null;
  _enabled: boolean;
  _menuPaused: boolean;
  _vol: number;
  zoneStreams: Partial<Record<MusicZone, S>>;
  combatStreams: S[];
  makeStream(url: string): S | null;
  setStreamTarget(stream: S, target: number, fadeSeconds: number): void;
  masterTarget(): number;
  streamKeeper(): void;
}

export class VenueMusicLayer<S extends VenueLayerStream = VenueLayerStream> {
  // Sports-venue music: looped mp3s per venue ('waiting' before a game,
  // 'match' once one has kicked off, 'boss' under an encounter) that crossfade
  // against each other and duck the procedural score while you are at the
  // venue. Same file-track pattern as the boss loop. Only one venue can be
  // under you at a time, so the crossfade gains are shared and the elements
  // are per venue. The gains are built on the first arming, never at init, so
  // a world with no venue carries no extra nodes in its graph.
  private venueEls = new Map<MusicVenue, Partial<Record<VenueTrack, HTMLAudioElement>>>();
  private venueWaitingGain: GainNode | null = null;
  private venueMatchGain: GainNode | null = null;
  private venueBossGain: GainNode | null = null;
  private venue: MusicVenue = 'deepglass';
  private venueTrack: VenueTrack | null = null;
  /** Where the venue gains feed (the director's compressor), set at init. */
  private output: AudioNode | null = null;

  constructor(private readonly director: object) {}

  private get host(): MusicDirectorVenueHost<S> {
    return this.director as MusicDirectorVenueHost<S>;
  }

  /** True while a venue cue owns the mix (music_mix_policy venueActive). */
  get armed(): boolean {
    return this.venueTrack !== null;
  }

  /** The director's init(): remember the node the venue gains feed. */
  attach(output: AudioNode): void {
    this.output = output;
  }

  /** The director's close(): forget every node built on the closed context, so
   *  a later init() rebuilds them on the new one. */
  detach(): void {
    for (const set of this.venueEls.values()) for (const el of Object.values(set)) el.pause();
    this.venueEls.clear();
    this.venueWaitingGain = null;
    this.venueMatchGain = null;
    this.venueBossGain = null;
    this.output = null;
  }

  /** Drive a sports venue's area music: 'waiting' before a game, 'match' once one
   *  has kicked off, null when you are away from the venue. `venue` picks the
   *  venue's files. Idempotent; the HUD calls it every frame. Crossfades the
   *  tracks and ducks the procedural score while active. A null call while no
   *  venue is armed changes nothing, so it returns before touching the mix
   *  (the built-in world, every frame). */
  setTrack(venue: MusicVenue, track: VenueTrack | null): void {
    if (track === null && this.venueTrack === null) return;
    const h = this.host;
    const enteringOrLeaving = (this.venueTrack === null) !== (track === null);
    // Only re-point the venue while a track is armed: leaving carries `null`, and
    // holding the old venue there keeps the fade-out and the delayed pause aimed
    // at the elements that are actually playing.
    if (track !== null) this.venue = venue;
    this.venueTrack = track;
    this.apply();
    // Idempotent, so it can run on every call: setStreamTarget early-returns
    // on a target it already holds.
    this.applyStreamTargets(false);
    if (h.ctx && h.master) {
      // Re-asserted on EVERY call rather than only on the arming edge. That
      // edge routinely lands with no AudioContext to duck (the HUD drives this
      // from the first frame; the context waits for a gesture), and nothing
      // afterwards used to put the master back down. Arming ducks FAST: a
      // venue cue fades in over half a second, and a zone theme audibly
      // fading out under it is the reported "the music switches for a bit".
      // Releasing stays gentle.
      const target = h.masterTarget();
      if (Math.abs(h.master.gain.value - target) > 1e-3) {
        h.master.gain.setTargetAtTime(target, h.ctx.currentTime, target === 0 ? 0.12 : 0.7);
      }
    }
    // walking away from the venue must revive paused streams now
    if (enteringOrLeaving && track === null) h.streamKeeper();
  }

  private ensureGains(ctx: AudioContext): void {
    if (this.venueMatchGain || !this.output) return;
    const make = (): GainNode => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      if (this.output) gain.connect(this.output);
      return gain;
    };
    this.venueWaitingGain = make();
    this.venueMatchGain = make();
    this.venueBossGain = make();
  }

  private ensureVenueElements(
    venue: MusicVenue,
  ): Partial<Record<VenueTrack, HTMLAudioElement>> | null {
    const made = this.venueEls.get(venue);
    if (made) return made;
    const ctx = this.host.ctx;
    if (!ctx || typeof Audio !== 'function') return null;
    this.ensureGains(ctx);
    const sources = VENUE_MUSIC[venue];
    const set: Partial<Record<VenueTrack, HTMLAudioElement>> = {
      match: this.makeVenueElement(sources.match, this.venueMatchGain),
    };
    // Only a venue that declares a grounds cue streams one: an element built
    // for a file that is never armed would decode under every match for nothing.
    if (sources.waiting)
      set.waiting = this.makeVenueElement(sources.waiting, this.venueWaitingGain);
    this.venueEls.set(venue, set);
    return set;
  }

  /** The venue's boss theme, built on the first engagement rather than at
   *  arrival (see apply for why this one alone is lazy). Null for a venue
   *  that declares no boss track. */
  private ensureVenueBossElement(venue: MusicVenue): HTMLAudioElement | null {
    const url = VENUE_MUSIC[venue].boss;
    if (!url) return null;
    const set = this.ensureVenueElements(venue);
    if (!set) return null;
    if (!set.boss) set.boss = this.makeVenueElement(url, this.venueBossGain);
    return set.boss;
  }

  private makeVenueElement(url: string, gain: GainNode | null): HTMLAudioElement {
    const el = new Audio(url);
    el.loop = true;
    el.preload = 'auto';
    try {
      const src = this.host.ctx?.createMediaElementSource(el);
      if (src && gain) src.connect(gain);
    } catch {
      /* element already wired or unsupported */
    }
    return el;
  }

  /** Re-apply the venue gains and playback for the current mix state. The
   *  director calls this on every mix change (volume, toggle, menu fade). */
  apply(): void {
    const h = this.host;
    if (!h.ctx) return;
    const active = this.venueTrack !== null && h._enabled && !h._menuPaused;
    const level = 0.5 * h._vol;
    // A venue that declares no boss theme falls back to its match cue rather
    // than to silence, so arming 'boss' is safe whatever the venue ships.
    // ...and a venue with no grounds cue rides its match cue when 'waiting' is
    // asked for, for the same reason.
    const sources = VENUE_MUSIC[this.venue];
    const armed: VenueTrack | null =
      (this.venueTrack === 'boss' && !sources.boss) ||
      (this.venueTrack === 'waiting' && !sources.waiting)
        ? 'match'
        : this.venueTrack;
    const bossArmed = active && armed === 'boss';
    if (active) {
      resumeWhenAllowed(h.ctx);
      const set = this.ensureVenueElements(this.venue);
      // The waiting/match pair BOTH run from arrival and the gains pick which
      // one you hear, so the whistle crossfades into a track already in
      // progress. The boss theme is the exception: a fight is an event and
      // wants its own first bar, and a third stream decoding silently under
      // every match is a cost this arena can least afford.
      void set?.waiting?.play().catch(() => {});
      void set?.match?.play().catch(() => {});
      if (bossArmed) {
        const boss = this.ensureVenueBossElement(this.venue);
        if (boss) {
          if (boss.paused) {
            try {
              boss.currentTime = 0;
            } catch {
              /* not seekable yet; it will simply start where it is */
            }
          }
          void boss.play().catch(() => {});
        }
      }
      // A different venue's set shares these gains, so it must not be left
      // running underneath (only reachable by swapping worlds in place).
      for (const [id, other] of this.venueEls) {
        if (id === this.venue) continue;
        for (const el of Object.values(other)) el.pause();
      }
    }
    const wTarget = active && armed === 'waiting' ? level : 0;
    const mTarget = active && armed === 'match' ? level : 0;
    const bTarget = bossArmed ? level : 0;
    if (this.venueWaitingGain)
      this.venueWaitingGain.gain.setTargetAtTime(wTarget, h.ctx.currentTime, 0.5);
    if (this.venueMatchGain)
      this.venueMatchGain.gain.setTargetAtTime(mTarget, h.ctx.currentTime, 0.5);
    if (this.venueBossGain)
      this.venueBossGain.gain.setTargetAtTime(bTarget, h.ctx.currentTime, 0.5);
    // Only when something is actually left running that should not be: leaving
    // the venue, or a boss stream still going after the fight. This is called
    // every frame, so an unconditional timeout here would queue one per frame.
    const staleBoss = !bossArmed && this.venueEls.get(this.venue)?.boss?.paused === false;
    if (this.venueEls.size > 0 && (!active || staleBoss)) {
      // Fade to silence, then pause once we are truly away (guard against a quick
      // re-entry flipping the track back on before the timeout fires). The boss
      // stream also stops as soon as it is no longer the armed track, since it
      // restarts from the top on the next engagement and nothing is lost.
      window.setTimeout(() => {
        const leaving = this.venueTrack === null;
        for (const set of this.venueEls.values()) {
          if (leaving) {
            set.waiting?.pause();
            set.match?.pause();
          }
          if (leaving || this.venueTrack !== 'boss') set.boss?.pause();
        }
      }, 700);
    }
  }

  /**
   * Point every zone and combat stream at its target for the current zone,
   * combat flag and venue. Called from the director's update() (zoneChanging
   * marks a genuine zone change) and from setTrack.
   *
   * Combat music replaces the zone theme rather than layering over it: the
   * zone is silenced for the duration of combat and fades back in when it
   * ends. Fade out faster than fade in so instance music does not bleed into
   * the world.
   *
   * And a VENUE cue owns the score outright: while one is armed every
   * procedural stream targets silence and no zone cue is even rolled. Ducking
   * the master was not enough on its own, twice over. The duck is applied on
   * the arming edge with a fade, so a zone theme already playing when the
   * player reached the arena stayed audible under the venue track for the
   * length of the ramp, heard as the wrong music playing for a second or
   * two. And the duck is skipped entirely when there is no AudioContext at
   * that edge, which is the common case: the HUD drives this from the first
   * frame and the context waits for a gesture. With the targets held at zero
   * there is nothing queued for any later mix change to uncover, and nothing
   * downloading that the player could never hear.
   */
  applyStreamTargets(zoneChanging: boolean, zoneFadeIn = FADE_IN_SECONDS): void {
    const h = this.host;
    if (!h.ctx || minigameLayerFor(this.director).active !== null) return;
    const venued = this.venueTrack !== null;
    // A Crucible floor owns the whole mix like a venue track does (upstream's
    // crucible streams, faded in setCrucibleFloor).
    const crucible = h.crucibleFloor !== null;
    // Null before the first update(): no zone is playing yet, so every stream
    // below simply targets 0, which is exactly right.
    const zone = h.zone;
    const inCombat = h.combat;
    if (zone !== null && !inCombat && !venued && !crucible)
      this.ensureZoneStream(zone, zoneChanging);
    for (const [name, stream] of Object.entries(h.zoneStreams) as [MusicZone, S][]) {
      const target = !venued && !crucible && name === zone && !inCombat ? 1 : 0;
      h.setStreamTarget(stream, target, target > 0 ? zoneFadeIn : 0.35);
    }
    h.combatStreams.forEach((stream, idx) => {
      const target = !venued && !crucible && inCombat && idx === h.combatIdx ? 1 : 0;
      h.setStreamTarget(stream, target, target > 0 || crucible ? 0.35 : zoneFadeIn);
    });
  }

  /** Ensure `zone` has a live stream. `arriving` marks a genuine zone change
   *  (not a combat handback): only then does a POOLED zone roll a different one
   *  of its cues, so a capital with two harbor themes varies between visits
   *  instead of wearing one loop out. Single-track zones are untouched and keep
   *  resuming mid-track exactly as before. */
  private ensureZoneStream(zone: MusicZone, arriving: boolean): void {
    const h = this.host;
    const urls = zoneStreamUrls(zone);
    if (urls.length === 0) return;
    const existing = h.zoneStreams[zone];
    if (existing && (urls.length === 1 || !arriving)) return;
    const url = urls.length === 1 ? urls[0] : urls[pickCombatTrackIndex(urls.length, Math.random)];
    if (existing) {
      if (existing.url === url) return; // rolled the same cue: keep it playing
      releaseStream(existing);
      delete h.zoneStreams[zone];
    }
    const stream = h.makeStream(url);
    if (stream) h.zoneStreams[zone] = stream;
  }
}

/** music.ts FADE_SECONDS / 3, the zone fade-in (and combat fade-out) the
 *  director's update() always used; music.ts passes its own value in. */
const FADE_IN_SECONDS = 2.2 / 3;

/** Tear one zone stream down for good: the swapped-out cue must stop
 *  buffering behind the one now playing, so this releases the buffered media
 *  rather than just pausing the playhead. */
function releaseStream(stream: VenueLayerStream): void {
  const el = stream.el;
  stream.el = null;
  stream.target = 0;
  try {
    el?.pause();
  } catch {
    /* best-effort: the element is being discarded either way */
  }
  try {
    el?.removeAttribute('src');
    el?.load();
  } catch {
    /* older/stubbed elements: pausing already stopped the download */
  }
  try {
    stream.gain.disconnect();
  } catch {
    /* already detached */
  }
}

const layers = new WeakMap<object, VenueMusicLayer<VenueLayerStream>>();

/** The one venue layer of a MusicDirector, created on first use. */
export function venueLayerFor<S extends VenueLayerStream = VenueLayerStream>(
  director: object,
): VenueMusicLayer<S> {
  let layer = layers.get(director);
  if (!layer) {
    layer = new VenueMusicLayer(director);
    layers.set(director, layer);
  }
  return layer as unknown as VenueMusicLayer<S>;
}
