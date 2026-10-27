// Plays the Hammer Council's sounds (WHICH and WHEN: the pure core beside this
// file). Fed by the council's painter (render/smith_heart_fx/council_fx.ts):
// its cue events, the bodies and soul pillars and marked players its scan sees,
// and a frame tick. Bounded and allocation-free in the frame: a fixed pool of
// watch slots, no timers. Local presentation: a sound never decides anything.

import {
  COUNCIL_AURAS,
  COUNCIL_CUES,
  COUNCIL_TUNING as T,
} from '../sim/encounters/smith_heart/council_ids';
import type { Entity, SimEvent } from '../sim/types';
import {
  barSoundRate,
  COUNCIL_BAR_SOUNDS,
  COUNCIL_CUE_SOUNDS,
  COUNCIL_SFX_KEYS,
  type CouncilSound,
  ROCK_FALL_SOUND,
  SLAB_GRIND_SOUND,
  songPulseSound,
} from './smith_heart_council_audio_core';

export interface CouncilAudioSink {
  playAt(
    key: string,
    x: number,
    y: number,
    z: number,
    opts?: { gain?: number; cooldown?: number; rate?: number; jitter?: boolean },
  ): boolean;
  loop(id: string, key: string, target: number, x?: number, y?: number, z?: number): void;
  unloop(id: string, fade?: number): void;
  preload?(key: string): void;
}

/** What a watched entity is to the sound. */
export type CouncilWatchKind = 'member' | 'echo' | 'slab' | 'song' | 'rock';

interface Watch {
  id: number;
  kind: CouncilWatchKind;
  seen: boolean;
  /** The bar it was last heard on (an id, or '' for none) and its length. */
  bar: string;
  barTotal: number;
  /** The rock's fall already played for this mark. */
  fell: boolean;
  /** The slab: where it was last frame, and how long since it moved. */
  x: number;
  z: number;
  still: number;
  grinding: boolean;
}

/** Three members, three soul pillars, and the rock's few marked players. */
const MAX_WATCH = 12;

const _song: CouncilSound = { key: '', gain: 1, rate: 1, cooldown: 0, at: 'source' };

function auraOf(e: Entity, id: string) {
  const auras = e.auras;
  for (let i = 0; i < auras.length; i++) if (auras[i].id === id) return auras[i];
  return null;
}

export class CouncilAudio {
  private readonly watches: Watch[] = [];
  private preloaded = false;

  constructor(private readonly sink: CouncilAudioSink) {
    for (let i = 0; i < MAX_WATCH; i++)
      this.watches.push({
        id: -1,
        kind: 'member',
        seen: false,
        bar: '',
        barTotal: 0,
        fell: false,
        x: 0,
        z: 0,
        still: 0,
        grinding: false,
      });
  }

  /** The samples are fetched the first time the council is near, so its
   *  first blow is never the one that misses its sound. */
  private preload(): void {
    if (this.preloaded) return;
    this.preloaded = true;
    for (const key of COUNCIL_SFX_KEYS) this.sink.preload?.(key);
  }

  // ---- the cues -----------------------------------------------------------------------------

  /** A council cue: its one-shot. Returns true when it was the council's. */
  event(
    ev: SimEvent,
    entityOf: (id: number) => Entity | undefined,
    groundY: (x: number, z: number) => number,
  ): boolean {
    if (ev.type !== 'spellfx' && ev.type !== 'spellfxAt') return false;
    const base = ev.ability ? COUNCIL_CUE_SOUNDS[ev.ability] : undefined;
    if (!base) return false;
    this.preload();
    let sound = base;
    let x: number;
    let z: number;
    let y: number;
    if (ev.type === 'spellfxAt') {
      x = ev.x;
      z = ev.z;
      y = groundY(x, z);
    } else {
      const e = entityOf(base.at === 'target' ? ev.targetId : ev.sourceId);
      if (!e) return true;
      x = e.pos.x;
      y = e.pos.y;
      z = e.pos.z;
      if (ev.ability === COUNCIL_CUES.songPulse) {
        // The pulses sung before this one ride the song aura's multiplier.
        const song = auraOf(e, COUNCIL_AURAS.endlessSong);
        const pulses = song ? Math.max(0, Math.round((song.value - 1) / T.songPulseGrowth)) : 0;
        sound = songPulseSound(pulses, _song);
      }
    }
    this.sink.playAt(sound.key, x, y + 1, z, {
      gain: sound.gain,
      rate: sound.rate,
      cooldown: sound.cooldown,
    });
    return true;
  }

  // ---- the watch ----------------------------------------------------------------------------

  beginScan(): void {
    for (const w of this.watches) w.seen = false;
  }

  /** The painter's scan saw `e` as `kind`. */
  see(e: Entity, kind: CouncilWatchKind): void {
    let free: Watch | null = null;
    for (const w of this.watches) {
      if (w.id === e.id && w.kind === kind) {
        w.seen = true;
        return;
      }
      if (!free && w.id < 0) free = w;
    }
    if (!free) return;
    free.id = e.id;
    free.kind = kind;
    free.seen = true;
    // A bar already running when it is first seen is never replayed late.
    free.bar = e.castingAbility ?? '';
    free.barTotal = e.castTotal;
    const rock = kind === 'rock' ? auraOf(e, COUNCIL_AURAS.rockMark) : null;
    free.fell = rock !== null && rock.remaining <= ROCK_FALL_SOUND.lead;
    free.x = e.pos.x;
    free.z = e.pos.z;
    free.still = 0;
    free.grinding = false;
    this.preload();
  }

  endScan(): void {
    for (const w of this.watches) if (w.id >= 0 && !w.seen) this.free(w);
  }

  private free(w: Watch): void {
    if (w.grinding) this.sink.unloop(`heart-slab-${w.id}`, 0.5);
    w.id = -1;
    w.grinding = false;
  }

  /** One frame: the bars starting, the rock coming into view, the slab's
   *  grind. */
  update(dt: number, entityOf: (id: number) => Entity | undefined): void {
    for (const w of this.watches) {
      if (w.id < 0) continue;
      const e = entityOf(w.id);
      if (!e || e.dead) {
        this.free(w);
        continue;
      }
      if (w.kind === 'rock') {
        const mark = auraOf(e, COUNCIL_AURAS.rockMark);
        if (!mark) w.fell = false;
        else if (!w.fell && mark.remaining <= ROCK_FALL_SOUND.lead) {
          w.fell = true;
          this.sink.playAt(ROCK_FALL_SOUND.key, e.pos.x, e.pos.y + 6, e.pos.z, {
            gain: ROCK_FALL_SOUND.gain,
            cooldown: 0.3,
          });
        }
        continue;
      }
      // A bar starting (or a new one straight after another).
      const bar = e.castingAbility ?? '';
      if (bar !== w.bar || (bar !== '' && e.castTotal !== w.barTotal)) {
        w.bar = bar;
        w.barTotal = e.castTotal;
        const sound = bar ? COUNCIL_BAR_SOUNDS[bar] : undefined;
        if (sound)
          this.sink.playAt(sound.key, e.pos.x, e.pos.y + 1, e.pos.z, {
            gain: sound.gain,
            rate: barSoundRate(sound, e.castTotal),
            cooldown: 0.5,
            jitter: false,
          });
      }
      if (w.kind !== 'slab') continue;
      const moved = Math.hypot(e.pos.x - w.x, e.pos.z - w.z);
      w.x = e.pos.x;
      w.z = e.pos.z;
      w.still = moved > SLAB_GRIND_SOUND.moving ? 0 : w.still + dt;
      const grinding = w.still < SLAB_GRIND_SOUND.hold;
      if (grinding)
        this.sink.loop(
          `heart-slab-${w.id}`,
          SLAB_GRIND_SOUND.key,
          SLAB_GRIND_SOUND.gain,
          e.pos.x,
          e.pos.y + 1,
          e.pos.z,
        );
      else if (w.grinding) this.sink.unloop(`heart-slab-${w.id}`, 0.6);
      w.grinding = grinding;
    }
  }

  dispose(): void {
    for (const w of this.watches) if (w.id >= 0) this.free(w);
  }
}
