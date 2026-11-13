// Plays the Guardian of the Breath's sounds (WHICH and WHEN: the pure core
// beside this file). Fed by the fight's painter (render/smith_heart_fx/
// breath_fight_fx.ts): its cue events, the wind's phase each frame, the
// guardian's bar, the nearest loose gale, the most urgent Knotted Gale and
// the local player. Bounded and allocation-free in the frame: no timers, a
// handful of fields. Local presentation: a sound never decides anything.

import type { BreathWindPhase } from '../sim/encounters/smith_heart/breath_ids';
import type { Entity, SimEvent } from '../sim/types';
import {
  BREATH_BAR_SOUNDS,
  BREATH_CUE_SOUNDS,
  BREATH_KNOT_SOUNDS,
  BREATH_MARK_SOUNDS,
  BREATH_RIDE_LOOP,
  BREATH_RIDING_AURA,
  BREATH_SFX_KEYS,
  BREATH_WIND_SOUNDS,
  breathBarRate,
  knotFuseWarnDue,
  windPhaseSound,
} from './smith_heart_breath_audio_core';
import { HeartMarkEar } from './smith_heart_mark_audio';

export interface BreathAudioSink {
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
  loop(id: string, key: string, target: number, x?: number, y?: number, z?: number): void;
  unloop(id: string, fade?: number): void;
  preload?(key: string): void;
}

/** The Knotted Gale the painter hears most: where, carried or loose, its fuse. */
export interface BreathKnotHeard {
  x: number;
  y: number;
  z: number;
  held: boolean;
  fuse: number;
}

const BLOW_LOOP = 'heart-breath-blow';
const GALE_LOOP = 'heart-breath-gale';
const CARRY_LOOP = 'heart-breath-knot-carry';
const RIDE_LOOP = 'heart-breath-ride';

function riding(me: Entity | null): boolean {
  if (!me || me.dead) return false;
  const auras = me.auras;
  for (let i = 0; i < auras.length; i++) if (auras[i].id === BREATH_RIDING_AURA) return true;
  return false;
}

export class BreathAudio {
  private preloaded = false;
  private phase: BreathWindPhase | null = null;
  private blowing = false;
  private galing = false;
  private carrying = false;
  private ridingNow = false;
  private fuse = Number.POSITIVE_INFINITY;
  private bar = '';
  private barTotal = 0;
  private readonly marks = new HeartMarkEar(BREATH_MARK_SOUNDS);

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
    const layers = ev.ability ? BREATH_CUE_SOUNDS[ev.ability] : undefined;
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

  /**
   * One frame of the fight: the wind's phase at the Cornice's middle (null
   * out of the fight), the guardian (its bar), the nearest loose gale, the
   * local player (their marks, their ride) and the most urgent Knotted Gale.
   */
  update(
    phase: BreathWindPhase | null,
    windAt: { x: number; y: number; z: number } | null,
    guardian: Entity | null,
    gale: { x: number; y: number; z: number } | null,
    me: Entity | null = null,
    knot: BreathKnotHeard | null = null,
  ): void {
    if (phase !== null || guardian !== null) this.preload();
    const change = windPhaseSound(this.phase, phase);
    if (change.oneShot && windAt) {
      const s = BREATH_WIND_SOUNDS[change.oneShot];
      this.sink.playAt(s.key, windAt.x, windAt.y + 2, windAt.z, {
        gain: s.gain,
        cooldown: 0.5,
        jitter: false,
        priority: true,
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
          priority: true,
        });
    }
    this.marks.update(me, this.sink);
    this.updateRide(me);
    this.updateKnot(knot);
  }

  /** The wind past the local player's ears while a gale carries them. */
  private updateRide(me: Entity | null): void {
    if (riding(me) && me) {
      this.sink.loop(
        RIDE_LOOP,
        BREATH_RIDE_LOOP.key,
        BREATH_RIDE_LOOP.gain,
        me.pos.x,
        me.pos.y + 1.6,
        me.pos.z,
      );
      this.ridingNow = true;
    } else if (this.ridingNow) {
      this.sink.unloop(RIDE_LOOP, BREATH_RIDE_LOOP.fadeOut);
      this.ridingNow = false;
    }
  }

  /** The Knotted Gale: its churning loop while carried, its fuse's warning. */
  private updateKnot(knot: BreathKnotHeard | null): void {
    if (knot?.held) {
      const s = BREATH_KNOT_SOUNDS.carry;
      this.sink.loop(CARRY_LOOP, s.key, s.gain, knot.x, knot.y + 2, knot.z);
      this.carrying = true;
    } else if (this.carrying) {
      this.sink.unloop(CARRY_LOOP, BREATH_KNOT_SOUNDS.carry.fadeOut);
      this.carrying = false;
    }
    const fuse = knot ? knot.fuse : Number.POSITIVE_INFINITY;
    if (knot && knotFuseWarnDue(this.fuse, fuse))
      this.sink.playAt(BREATH_KNOT_SOUNDS.fuse.key, knot.x, knot.y + 2, knot.z, {
        gain: BREATH_KNOT_SOUNDS.fuse.gain,
        cooldown: 1,
        jitter: false,
        priority: true,
      });
    this.fuse = fuse;
  }

  dispose(): void {
    if (this.blowing) this.sink.unloop(BLOW_LOOP, 0.3);
    if (this.galing) this.sink.unloop(GALE_LOOP, 0.3);
    if (this.carrying) this.sink.unloop(CARRY_LOOP, 0.3);
    if (this.ridingNow) this.sink.unloop(RIDE_LOOP, 0.3);
    this.blowing = false;
    this.galing = false;
    this.carrying = false;
    this.ridingNow = false;
  }
}
