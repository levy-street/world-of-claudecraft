// Plays the Buried Hoard mechanics' sounds off their cues. Cue-owned like
// hoard_tide_audio.ts: bounded voices, no timers, no per-frame allocation, and
// nothing at all outside a hoard fight. WHICH sound and WHEN is the pure core
// beside this file; this only watches each live cue's clock cross a beat and plays
// it where the cue is. Local presentation: a sound never decides anything.

import type { HoardBossCueView } from '../world_api/dungeons';
import {
  HOARD_MECHANIC_SFX_KEYS,
  type HoardMechanicDue,
  hoardMechanicBeats,
  hoardMechanicDue,
} from './hoard_mechanic_audio_core';

export interface HoardMechanicAudioSink {
  playAt(
    key: string,
    x: number,
    y: number,
    z: number,
    opts?: { gain?: number; cooldown?: number; rate?: number },
  ): boolean;
  preload?(key: string): void;
}

interface Voice {
  instanceId: number;
  cueId: number;
  fired: number;
  seen: boolean;
}

/** Two hammers, six tentacles with an attack each, a boulder and a cocoon fit
 *  with room to spare; past this a cue simply stays silent. */
const MAX_VOICES = 24;

export class HoardMechanicAudio {
  private readonly voices: Voice[] = [];
  private readonly due: HoardMechanicDue = { play: 0, fired: 0 };
  private preloaded = false;

  constructor(private readonly sink: HoardMechanicAudioSink) {}

  sync(cues: readonly HoardBossCueView[], groundY = 0): void {
    if (cues.length === 0 && this.voices.length === 0) return;
    for (let v = 0; v < this.voices.length; v++) this.voices[v].seen = false;
    for (let c = 0; c < cues.length; c++) {
      const cue = cues[c];
      const beats = hoardMechanicBeats(cue.variant);
      if (!beats) continue;
      // The samples are fetched the first time any of these mechanics shows up,
      // so the first blow is never the one that misses its sound.
      if (!this.preloaded) {
        this.preloaded = true;
        for (const key of HOARD_MECHANIC_SFX_KEYS) this.sink.preload?.(key);
      }
      let voice: Voice | undefined;
      for (let v = 0; v < this.voices.length; v++) {
        const candidate = this.voices[v];
        if (candidate.instanceId === cue.instanceId && candidate.cueId === cue.cueId) {
          voice = candidate;
          break;
        }
      }
      const firstSight = !voice;
      if (!voice) {
        if (this.voices.length >= MAX_VOICES) continue;
        voice = { instanceId: cue.instanceId, cueId: cue.cueId, fired: 0, seen: true };
        this.voices.push(voice);
      }
      voice.seen = true;
      const elapsed = Math.max(0, cue.total - cue.remaining);
      const due = hoardMechanicDue(beats, elapsed, voice.fired, firstSight, this.due);
      voice.fired = due.fired;
      if (due.play === 0) continue;
      for (let i = 0; i < beats.length; i++) {
        if (!(due.play & (1 << i))) continue;
        const beat = beats[i];
        this.sink.playAt(beat.key, cue.x, groundY, cue.z, {
          gain: beat.gain,
          rate: beat.rate,
          cooldown: 0,
        });
      }
    }
    for (let v = this.voices.length - 1; v >= 0; v--) {
      if (this.voices[v].seen) continue;
      this.voices[v] = this.voices[this.voices.length - 1];
      this.voices.pop();
    }
  }

  dispose(): void {
    this.voices.length = 0;
  }
}
