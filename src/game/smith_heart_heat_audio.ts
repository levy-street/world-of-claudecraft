// Plays the Guardian of the Heat's sounds (WHICH and WHEN: the pure core
// beside this file). Fed by the fight's painter (render/smith_heart_fx/
// heat_fight_fx.ts): its cue events, a Wakefire band beginning to build, a
// Wheel slice changing state, the guardian (its bar), the nearest Rolling
// Cinder and the local player (the marks on them, Cinder Grip) each frame.
// Bounded and allocation-free in the frame: no timers, a handful of fields.
// Local presentation: a sound never decides anything.

import { HEAT_AURAS } from '../sim/encounters/smith_heart/heat_ids';
import type { Entity, SimEvent } from '../sim/types';
import {
  gripSound,
  HEAT_BAR_SOUNDS,
  HEAT_CINDER_LOOP,
  HEAT_CUE_SOUNDS,
  HEAT_GRIP_SOUND,
  HEAT_MARK_SOUNDS,
  HEAT_SFX_KEYS,
  HEAT_WHEEL_SOUNDS,
  HEAT_ZONE_BUILD_SOUND,
  heatBarRate,
} from './smith_heart_heat_audio_core';
import { HeartMarkEar } from './smith_heart_mark_audio';

export interface HeatAudioSink {
  playAt(
    key: string,
    x: number,
    y: number,
    z: number,
    opts?: {
      gain?: number;
      cooldown?: number;
      rate?: number;
      jitter?: boolean;
      priority?: boolean;
    },
  ): boolean;
  loop?(id: string, key: string, target: number, x?: number, y?: number, z?: number): void;
  unloop?(id: string, fade?: number): void;
  preload?(key: string): void;
}

const CINDER_LOOP = 'heart-heat-cinder';

export class HeatAudio {
  private preloaded = false;
  private bar = '';
  private barTotal = 0;
  private readonly marks = new HeartMarkEar(HEAT_MARK_SOUNDS);
  /** Cinder Grip's stacks on the local player a frame ago. */
  private grip = 0;
  private rolling = false;

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
        priority: true,
      });
    }
    return true;
  }

  /** A Wakefire band began to build at (x, y, z). */
  zoneBuild(x: number, y: number, z: number): void {
    this.preload();
    this.sink.playAt(HEAT_ZONE_BUILD_SOUND.key, x, y + 0.5, z, {
      gain: HEAT_ZONE_BUILD_SOUND.gain,
      rate: HEAT_ZONE_BUILD_SOUND.rate,
      cooldown: 1.5,
      jitter: false,
      priority: true,
    });
  }

  /** A Wheel slice turned `state` at (x, y, z): red slices heating sound
   *  their warning, erupting slices their eruption (a round's three as one
   *  voice, cooled); a safe slice is silent. */
  wheel(state: 'warn' | 'burn' | 'safe', x: number, y: number, z: number): void {
    if (state === 'safe') return;
    this.preload();
    const s = HEAT_WHEEL_SOUNDS[state];
    this.sink.playAt(s.key, x, y + 1, z, {
      gain: s.gain,
      cooldown: 1,
      jitter: false,
      priority: true,
    });
  }

  /**
   * One frame of the fight: the guardian (its bar; null out of the fight),
   * the local player (the marks on them, Cinder Grip; null when not in it)
   * and the nearest Rolling Cinder (null when none rolls).
   */
  update(
    guardian: Entity | null,
    me: Entity | null,
    cinder: { x: number; y: number; z: number } | null = null,
  ): void {
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
          priority: true,
        });
    }
    this.marks.update(me, this.sink);
    this.updateGrip(me);
    if (cinder) {
      this.sink.loop?.(
        CINDER_LOOP,
        HEAT_CINDER_LOOP.key,
        HEAT_CINDER_LOOP.gain,
        cinder.x,
        cinder.y + 1,
        cinder.z,
      );
      this.rolling = true;
    } else if (this.rolling) {
      this.sink.unloop?.(CINDER_LOOP, HEAT_CINDER_LOOP.fadeOut);
      this.rolling = false;
    }
  }

  /** Each new stack of Cinder Grip on the local player: a sizzle in their ear. */
  private updateGrip(me: Entity | null): void {
    let stacks = 0;
    if (me && !me.dead)
      for (const a of me.auras) if (a.id === HEAT_AURAS.grip) stacks = a.stacks ?? 1;
    if (me && stacks > this.grip) {
      const g = gripSound(stacks);
      this.sink.playAt(HEAT_GRIP_SOUND.key, me.pos.x, me.pos.y + 1.4, me.pos.z, {
        gain: g.gain,
        rate: g.rate,
        cooldown: 0.4,
        priority: true,
      });
    }
    this.grip = stacks;
  }

  dispose(): void {
    if (this.rolling) this.sink.unloop?.(CINDER_LOOP, 0.3);
    this.rolling = false;
  }
}
