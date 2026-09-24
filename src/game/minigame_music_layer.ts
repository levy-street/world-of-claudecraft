// The world-quest minigame soundtrack layer: one dedicated looping track per
// activity overrides the zone and combat soundtrack while it plays, then hands
// the mix back. It sits beside MusicDirector instead of inside it (the music.ts
// monolith ratchet): the director keeps three hooks (the dungeon-entry rewind,
// the stream keeper's walk and the update gate), and this layer reads the
// director's private stream plumbing through an untyped host, welded to music.ts
// in tests/minigame_music.test.ts.
import { MINIGAME_MUSIC_URLS, type MinigameTrack } from './minigame_music';

/** The part of MusicDirector's private StreamTrack the layer touches. */
export interface MinigameStream {
  el: HTMLAudioElement | null;
  target: number;
}

/** The private MusicDirector members the layer reads and drives. */
interface MusicDirectorHost<S extends MinigameStream> {
  ctx: unknown;
  zone: string | null;
  combat: boolean;
  zoneStreams: Partial<Record<string, S>>;
  combatStreams: S[];
  makeStream(url: string): S | null;
  setStreamTarget(stream: S, target: number, fadeSeconds: number): void;
  update(zone: string, inCombat: boolean): void;
}

export class MinigameMusicLayer<S extends MinigameStream = MinigameStream> {
  readonly streamsByTrack: Partial<Record<MinigameTrack, S>> = {};
  active: MinigameTrack | null = null;

  constructor(private readonly director: object) {}

  private get host(): MusicDirectorHost<S> {
    return this.director as MusicDirectorHost<S>;
  }

  /** A fresh dungeon run starts every minigame cue from the top as well. */
  rewind(): void {
    for (const stream of Object.values(this.streamsByTrack)) {
      if (stream?.el) {
        try {
          stream.el.currentTime = 0;
        } catch {
          /* browser may reject seeking before metadata */
        }
      }
    }
  }

  /** The layer's streams, for the director's keeper walk. */
  *streams(): Iterable<S> {
    for (const stream of Object.values(this.streamsByTrack)) yield stream as S;
  }

  /** Override zone and combat soundtrack with a dedicated minigame/activity track. */
  set(track: MinigameTrack | null): void {
    const h = this.host;
    if (track === this.active && h.ctx) return;
    this.active = track;
    if (!h.ctx) return;

    if (track !== null) {
      this.ensureStream(track);
      const activeStream = this.streamsByTrack[track];
      if (activeStream?.el?.paused) {
        try {
          activeStream.el.currentTime = 0;
        } catch {
          /* browser may reject seeking before metadata */
        }
      }
      for (const [name, stream] of Object.entries(this.streamsByTrack) as [MinigameTrack, S][]) {
        const target = name === track ? 1 : 0;
        h.setStreamTarget(stream, target, target > 0 ? 0.4 : 0.3);
      }
      for (const stream of Object.values(h.zoneStreams)) {
        if (stream) h.setStreamTarget(stream, 0, 0.35);
      }
      for (const stream of h.combatStreams) {
        h.setStreamTarget(stream, 0, 0.35);
      }
    } else {
      for (const stream of Object.values(this.streamsByTrack)) {
        if (stream) h.setStreamTarget(stream, 0, 0.5);
      }
      const prevZone = h.zone;
      const prevCombat = h.combat;
      h.zone = null;
      if (prevZone !== null) {
        h.update(prevZone, prevCombat);
      }
    }
  }

  private ensureStream(track: MinigameTrack): void {
    if (this.streamsByTrack[track]) return;
    const url = MINIGAME_MUSIC_URLS[track];
    if (!url) return;
    const stream = this.host.makeStream(url);
    if (stream) this.streamsByTrack[track] = stream;
  }
}

const layers = new WeakMap<object, MinigameMusicLayer<MinigameStream>>();

/** The one minigame layer of a MusicDirector, created on first use. */
export function minigameLayerFor<S extends MinigameStream = MinigameStream>(
  director: object,
): MinigameMusicLayer<S> {
  let layer = layers.get(director);
  if (!layer) {
    layer = new MinigameMusicLayer(director);
    layers.set(director, layer);
  }
  return layer as unknown as MinigameMusicLayer<S>;
}
