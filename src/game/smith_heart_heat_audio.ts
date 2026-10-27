// Plays the Guardian of the Heat's sounds (WHICH and WHEN: the pure core
// beside this file). Fed by the fight's painter (render/smith_heart_fx/
// heat_fight_fx.ts): its cue events, the channel's state as it changes, the
// guardian (its bar and its heat) and the local player (their own burn) each
// frame. Bounded and allocation-free in the frame: no timers, a handful of
// fields. Local presentation: a sound never decides anything.

import type { Entity, SimEvent } from '../sim/types';
import {
  HEAT_BAR_SOUNDS,
  HEAT_BRIM_SOUND,
  HEAT_BURN_SOUND,
  HEAT_CUE_SOUNDS,
  HEAT_RISING_SOUND,
  HEAT_SFX_KEYS,
  heatBarRate,
  heatWarningDue,
} from './smith_heart_heat_audio_core';

export interface HeatAudioSink {
  playAt(
    key: string,
    x: number,
    y: number,
    z: number,
    opts?: { gain?: number; cooldown?: number; rate?: number; jitter?: boolean },
  ): boolean;
  preload?(key: string): void;
}

export class HeatAudio {
  private preloaded = false;
  private bar = '';
  private barTotal = 0;
  private heat = 0;
  private burn = 0;

  constructor(private readonly sink: HeatAudioSink) {}

  private preload(): void {
    if (this.preloaded) return;
    this.preloaded = true;
    for (const key of HEAT_SFX_KEYS) this.sink.preload?.(key);
  }

  /** A fight cue: its layered one-shot. Returns true when it was the fight's. */
  event(
    ev: SimEvent,
    entityOf: (id: number) => Entity | undefined,
    groundY: (x: number, z: number) => number,
  ): boolean {
    if (ev.type !== 'spellfx' && ev.type !== 'spellfxAt') return false;
    const layers = ev.ability ? HEAT_CUE_SOUNDS[ev.ability] : undefined;
    if (!layers) return false;
    this.preload();
    for (const sound of layers) {
      let x: number;
      let y: number;
      let z: number;
      if (ev.type === 'spellfxAt') {
        x = ev.x;
        z = ev.z;
        y = groundY(x, z);
      } else {
        const e = entityOf(sound.at === 'target' ? ev.targetId : ev.sourceId);
        if (!e) continue;
        x = e.pos.x;
        y = e.pos.y;
        z = e.pos.z;
      }
      this.sink.playAt(sound.key, x, y + 1, z, {
        gain: sound.gain,
        rate: sound.rate,
        cooldown: sound.cooldown,
      });
    }
    return true;
  }

  /** The channel began to brim at (x, y, z). */
  brim(x: number, y: number, z: number): void {
    this.preload();
    this.sink.playAt(HEAT_BRIM_SOUND.key, x, y + 0.5, z, {
      gain: HEAT_BRIM_SOUND.gain,
      rate: HEAT_BRIM_SOUND.rate,
      cooldown: 2,
      jitter: false,
    });
  }

  /**
   * One frame of the fight: the guardian (its bar and its heat, the
   * resource; null out of the fight) and the local player with their own
   * burn stacks (null when not in it).
   */
  update(guardian: Entity | null, me: Entity | null, burn: number): void {
    if (guardian !== null) this.preload();
    const bar = guardian && !guardian.dead ? (guardian.castingAbility ?? '') : '';
    const total = guardian?.castTotal ?? 0;
    if (bar !== this.bar || (bar !== '' && total !== this.barTotal)) {
      this.bar = bar;
      this.barTotal = total;
      const sound = bar ? HEAT_BAR_SOUNDS[bar] : undefined;
      if (sound && guardian)
        this.sink.playAt(sound.key, guardian.pos.x, guardian.pos.y + 2, guardian.pos.z, {
          gain: sound.gain,
          rate: heatBarRate(sound, total),
          cooldown: 0.5,
          jitter: false,
        });
    }
    const heat = guardian && !guardian.dead ? guardian.resource : 0;
    if (me && heatWarningDue(this.heat, heat))
      this.sink.playAt(HEAT_RISING_SOUND.key, me.pos.x, me.pos.y + 1.6, me.pos.z, {
        gain: HEAT_RISING_SOUND.gain,
        rate: HEAT_RISING_SOUND.rate,
        cooldown: 2,
        jitter: false,
      });
    this.heat = heat;
    if (me && burn > this.burn)
      this.sink.playAt(HEAT_BURN_SOUND.key, me.pos.x, me.pos.y + 1.2, me.pos.z, {
        gain: HEAT_BURN_SOUND.gain,
        rate: HEAT_BURN_SOUND.rate,
        cooldown: 0.3,
      });
    this.burn = me ? burn : 0;
  }
}
