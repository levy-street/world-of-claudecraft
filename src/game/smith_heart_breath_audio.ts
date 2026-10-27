// Plays the Guardian of the Breath's sounds (WHICH and WHEN: the pure core
// beside this file). Fed by the fight's painter (render/smith_heart_fx/
// breath_fight_fx.ts): its cue events, the wind's phase each frame, the
// guardian's bar, the nearest loose gale. Bounded and allocation-free in the
// frame: no timers, a handful of fields. Local presentation: a sound never
// decides anything.

import type { BreathWindPhase } from '../sim/encounters/smith_heart/breath_ids';
import type { Entity, SimEvent } from '../sim/types';
import {
  BREATH_BAR_SOUNDS,
  BREATH_CUE_SOUNDS,
  BREATH_SFX_KEYS,
  BREATH_WIND_SOUNDS,
  breathBarRate,
  windPhaseSound,
} from './smith_heart_breath_audio_core';

export interface BreathAudioSink {
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

const BLOW_LOOP = 'heart-breath-blow';
const GALE_LOOP = 'heart-breath-gale';

export class BreathAudio {
  private preloaded = false;
  private phase: BreathWindPhase | null = null;
  private blowing = false;
  private galing = false;
  private bar = '';
  private barTotal = 0;

  constructor(private readonly sink: BreathAudioSink) {}

  private preload(): void {
    if (this.preloaded) return;
    this.preloaded = true;
    for (const key of BREATH_SFX_KEYS) this.sink.preload?.(key);
  }

  /** A fight cue: its one-shot. Returns true when it was the fight's. */
  event(
    ev: SimEvent,
    entityOf: (id: number) => Entity | undefined,
    groundY: (x: number, z: number) => number,
  ): boolean {
    if (ev.type !== 'spellfx' && ev.type !== 'spellfxAt') return false;
    const sound = ev.ability ? BREATH_CUE_SOUNDS[ev.ability] : undefined;
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

  /**
   * One frame of the fight: the wind's phase at the Cornice's middle (null
   * out of the fight), the guardian (its bar), the nearest loose gale.
   */
  update(
    phase: BreathWindPhase | null,
    windAt: { x: number; y: number; z: number } | null,
    guardian: Entity | null,
    gale: { x: number; y: number; z: number } | null,
  ): void {
    if (phase !== null || guardian !== null) this.preload();
    const change = windPhaseSound(this.phase, phase);
    if (change.oneShot && windAt) {
      const s = BREATH_WIND_SOUNDS[change.oneShot];
      this.sink.playAt(s.key, windAt.x, windAt.y + 2, windAt.z, {
        gain: s.gain,
        cooldown: 0.5,
        jitter: false,
      });
    }
    this.phase = phase;
    if (change.blowing && windAt) {
      const s = BREATH_WIND_SOUNDS.blow;
      this.sink.loop(BLOW_LOOP, s.key, s.gain, windAt.x, windAt.y + 2, windAt.z);
      this.blowing = true;
    } else if (this.blowing) {
      this.sink.unloop(BLOW_LOOP, BREATH_WIND_SOUNDS.blow.fadeOut);
      this.blowing = false;
    }
    if (gale) {
      const s = BREATH_WIND_SOUNDS.gale;
      this.sink.loop(GALE_LOOP, s.key, s.gain, gale.x, gale.y + 1, gale.z);
      this.galing = true;
    } else if (this.galing) {
      this.sink.unloop(GALE_LOOP, BREATH_WIND_SOUNDS.gale.fadeOut);
      this.galing = false;
    }
    const bar = guardian && !guardian.dead ? (guardian.castingAbility ?? '') : '';
    const total = guardian?.castTotal ?? 0;
    if (bar !== this.bar || (bar !== '' && total !== this.barTotal)) {
      this.bar = bar;
      this.barTotal = total;
      const sound = bar ? BREATH_BAR_SOUNDS[bar] : undefined;
      if (sound && guardian)
        this.sink.playAt(sound.key, guardian.pos.x, guardian.pos.y + 2, guardian.pos.z, {
          gain: sound.gain,
          rate: breathBarRate(sound, total),
          cooldown: 0.5,
          jitter: false,
        });
    }
  }

  dispose(): void {
    if (this.blowing) this.sink.unloop(BLOW_LOOP, 0.3);
    if (this.galing) this.sink.unloop(GALE_LOOP, 0.3);
    this.blowing = false;
    this.galing = false;
  }
}
