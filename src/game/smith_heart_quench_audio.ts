// Plays the Guardian of the Quench's sounds (WHICH and WHEN: the pure core
// beside this file). Fed by the fight's painter (render/smith_heart_fx/
// quench_fight_fx.ts): its cue events, the cracks as they appear, the
// guardian's bar and the local player's own cold each frame. Bounded and
// allocation-free in the frame: no timers, a handful of fields. Local
// presentation: a sound never decides anything.

import type { Entity, SimEvent } from '../sim/types';
import {
  coldWarningDue,
  QUENCH_BAR_SOUNDS,
  QUENCH_COLD_SOUND,
  QUENCH_CRACK_SOUND,
  QUENCH_CUE_SOUNDS,
  QUENCH_SFX_KEYS,
  quenchBarRate,
} from './smith_heart_quench_audio_core';

export interface QuenchAudioSink {
  playAt(
    key: string,
    x: number,
    y: number,
    z: number,
    opts?: { gain?: number; cooldown?: number; rate?: number; jitter?: boolean },
  ): boolean;
  preload?(key: string): void;
}

export class QuenchAudio {
  private preloaded = false;
  private bar = '';
  private barTotal = 0;
  private cold = 0;

  constructor(private readonly sink: QuenchAudioSink) {}

  private preload(): void {
    if (this.preloaded) return;
    this.preloaded = true;
    for (const key of QUENCH_SFX_KEYS) this.sink.preload?.(key);
  }

  /** A fight cue: its one-shot. Returns true when it was the fight's. */
  event(
    ev: SimEvent,
    entityOf: (id: number) => Entity | undefined,
    groundY: (x: number, z: number) => number,
  ): boolean {
    if (ev.type !== 'spellfx' && ev.type !== 'spellfxAt') return false;
    const sound = ev.ability ? QUENCH_CUE_SOUNDS[ev.ability] : undefined;
    if (!sound) return false;
    this.preload();
    let x: number;
    let y: number;
    let z: number;
    if (ev.type === 'spellfxAt') {
      x = ev.x;
      z = ev.z;
      y = groundY(x, z);
    } else {
      const e = entityOf(sound.at === 'target' ? ev.targetId : ev.sourceId);
      if (!e) return true;
      x = e.pos.x;
      y = e.pos.y;
      z = e.pos.z;
    }
    this.sink.playAt(sound.key, x, y + 1, z, {
      gain: sound.gain,
      rate: sound.rate,
      cooldown: sound.cooldown,
    });
    return true;
  }

  /** A crack appeared at (x, y, z). */
  crack(x: number, y: number, z: number): void {
    this.preload();
    this.sink.playAt(QUENCH_CRACK_SOUND.key, x, y + 0.5, z, {
      gain: QUENCH_CRACK_SOUND.gain,
      cooldown: QUENCH_CRACK_SOUND.cooldown,
    });
  }

  /**
   * One frame of the fight: the guardian (its bar; null out of the fight)
   * and the local player (their own cold; null when they carry none).
   */
  update(guardian: Entity | null, me: Entity | null, cold: number | null): void {
    if (guardian !== null) this.preload();
    const bar = guardian && !guardian.dead ? (guardian.castingAbility ?? '') : '';
    const total = guardian?.castTotal ?? 0;
    if (bar !== this.bar || (bar !== '' && total !== this.barTotal)) {
      this.bar = bar;
      this.barTotal = total;
      const sound = bar ? QUENCH_BAR_SOUNDS[bar] : undefined;
      if (sound && guardian)
        this.sink.playAt(sound.key, guardian.pos.x, guardian.pos.y + 2, guardian.pos.z, {
          gain: sound.gain,
          rate: quenchBarRate(sound, total),
          cooldown: 0.5,
          jitter: false,
        });
    }
    const c = cold ?? 0;
    if (me && coldWarningDue(this.cold, c))
      this.sink.playAt(QUENCH_COLD_SOUND.key, me.pos.x, me.pos.y + 1.6, me.pos.z, {
        gain: QUENCH_COLD_SOUND.gain,
        cooldown: 2,
        jitter: false,
      });
    this.cold = c;
  }
}
