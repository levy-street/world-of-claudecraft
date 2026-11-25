// Plays the Guardian of the Quench's sounds (WHICH and WHEN: the pure core
// beside this file). Fed by the fight's painter (render/smith_heart_fx/
// quench_fight_fx.ts): its cue events, the cracks as they appear, the slashes'
// lines each frame, the guardian's bar and the local player's own cold and
// marks. Bounded and allocation-free in the frame: no timers, a fixed row of
// line slots. Local presentation: a sound never decides anything.

import { QUENCH_CASTS } from '../sim/encounters/smith_heart/quench_ids';
import type { Entity, SimEvent } from '../sim/types';
import { HeartMarkEar } from './smith_heart_mark_audio';
import {
  coldWarningDue,
  QUENCH_BAR_SOUNDS,
  QUENCH_COLD_SOUNDS,
  crackStrainStage,
  QUENCH_CRACK_SOUND,
  QUENCH_CRACK_STRAIN,
  QUENCH_CUE_SOUNDS,
  QUENCH_HUNT_SOUNDS,
  QUENCH_MARK_ALARM,
  QUENCH_MARK_SOUNDS,
  QUENCH_SFX_KEYS,
  QUENCH_SLASH_SOUNDS,
  quenchBarRate,
  slashLocked,
} from './smith_heart_quench_audio_core';

export interface QuenchAudioSink {
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

const HUNT_LOOP = 'heart-quench-hunt';
/** The painter's line slots (quench_fight_fx_core's pool). */
const MAX_LINES = 8;

export class QuenchAudio {
  private preloaded = false;
  private bar = '';
  private barTotal = 0;
  private cold = 0;
  private hunting = false;
  private readonly marks = new HeartMarkEar(QUENCH_MARK_SOUNDS);
  /** A slash mark's alarm over its sting (QUENCH_MARK_ALARM). */
  private readonly alarm = new HeartMarkEar(QUENCH_MARK_ALARM);
  /** Per painter line slot: the line it last heard, and whether its lock sounded. */
  private readonly lineIds: number[] = new Array(MAX_LINES).fill(-1);
  private readonly lineLocked: boolean[] = new Array(MAX_LINES).fill(false);
  /** Each crack slot's object and the strain snaps it has sounded. */
  private readonly crackIds: number[] = [];
  private readonly crackStages: number[] = [];

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
      priority: true,
    });
    return true;
  }

  /**
   * A crack in painter slot `slot` this frame: its object `id` at (x, y, z),
   * `elapsed` seconds into its `warn`. Each strain snap sounds once as the
   * warning passes it, rising in pitch to the break (QUENCH_CRACK_STRAIN); a
   * crack first seen part-way sounds only the snaps still to come.
   */
  crackStrain(
    slot: number,
    id: number,
    x: number,
    y: number,
    z: number,
    elapsed: number,
    warn: number,
  ): void {
    if (slot < 0) return;
    const stage = crackStrainStage(elapsed, warn);
    if (this.crackIds[slot] !== id) {
      this.crackIds[slot] = id;
      this.crackStages[slot] = stage;
      return;
    }
    const was = this.crackStages[slot] ?? 0;
    if (stage <= was) return;
    this.crackStages[slot] = stage;
    const k = stage - 1;
    this.preload();
    this.sink.playAt(QUENCH_CRACK_STRAIN.key, x, y + 0.4, z, {
      gain: QUENCH_CRACK_STRAIN.gain[k],
      rate: QUENCH_CRACK_STRAIN.rate[k],
      cooldown: 0.1,
      jitter: false,
      priority: true,
    });
  }

  /** A crack appeared at (x, y, z). */
  crack(x: number, y: number, z: number): void {
    this.preload();
    this.sink.playAt(QUENCH_CRACK_SOUND.key, x, y + 0.5, z, {
      gain: QUENCH_CRACK_SOUND.gain,
      cooldown: QUENCH_CRACK_SOUND.cooldown,
      priority: true,
    });
  }

  /**
   * A slash's line in painter slot `slot` this frame: its object `id` at its
   * blade (x, y, z), `elapsed` seconds into its `seconds` of warning (its last
   * `lock` seconds locked). Its
   * warning sounds as it is drawn, its lock as it locks, in the ear of the
   * player it is aimed at ONLY (`mine`): the raid sees the line and the arrow
   * over the marked, the marked alone hears the call (the owner's online run
   * of 2026-11-17; the Rush's mark is the same). The Blades Hunt's own lines
   * stay quiet here (its loop is their warning).
   */
  line(
    slot: number,
    id: number,
    x: number,
    y: number,
    z: number,
    elapsed: number,
    seconds: number,
    lock: number,
    mine = false,
  ): void {
    if (slot < 0 || slot >= MAX_LINES) return;
    if (this.lineIds[slot] !== id) {
      this.lineIds[slot] = id;
      this.lineLocked[slot] = slashLocked(elapsed, seconds, lock);
      if (mine && !this.hunting && !this.lineLocked[slot]) {
        this.preload();
        const s = QUENCH_SLASH_SOUNDS.warn;
        this.sink.playAt(s.key, x, y + 2, z, {
          gain: s.gain,
          cooldown: 0.3,
          jitter: false,
          priority: true,
        });
      }
      return;
    }
    if (this.lineLocked[slot] || !slashLocked(elapsed, seconds, lock)) return;
    this.lineLocked[slot] = true;
    if (this.hunting || !mine) return;
    const s = QUENCH_SLASH_SOUNDS.lock;
    this.sink.playAt(s.key, x, y + 2, z, {
      gain: s.gain,
      cooldown: 0.2,
      jitter: false,
      priority: true,
    });
  }

  /** Painter slot `slot` holds no line this frame. */
  noLine(slot: number): void {
    if (slot >= 0 && slot < MAX_LINES) this.lineIds[slot] = -1;
  }

  /**
   * One frame of the fight: the guardian (its bar; null out of the fight)
   * and the local player (their own cold and marks; null when not in it).
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
          priority: true,
        });
      if (bar === QUENCH_CASTS.flurry && guardian) {
        const s = QUENCH_HUNT_SOUNDS.start;
        this.sink.playAt(s.key, guardian.pos.x, guardian.pos.y + 3, guardian.pos.z, {
          gain: s.gain,
          cooldown: 1,
          jitter: false,
          priority: true,
        });
      }
    }
    const hunting = bar === QUENCH_CASTS.flurry && guardian !== null;
    if (hunting && guardian) {
      const s = QUENCH_HUNT_SOUNDS.loop;
      this.sink.loop?.(
        HUNT_LOOP,
        s.key,
        s.gain,
        guardian.pos.x,
        guardian.pos.y + 3,
        guardian.pos.z,
      );
    } else if (this.hunting) this.sink.unloop?.(HUNT_LOOP, QUENCH_HUNT_SOUNDS.loop.fadeOut);
    this.hunting = hunting;
    const c = cold ?? 0;
    const due = me ? coldWarningDue(this.cold, c) : null;
    if (me && due) {
      const s = QUENCH_COLD_SOUNDS[due];
      this.sink.playAt(s.key, me.pos.x, me.pos.y + 1.6, me.pos.z, {
        gain: s.gain,
        cooldown: 1,
        jitter: false,
        priority: true,
      });
    }
    this.cold = c;
    this.marks.update(me, this.sink);
    this.alarm.update(me, this.sink);
  }

  dispose(): void {
    if (this.hunting) this.sink.unloop?.(HUNT_LOOP, 0.3);
    this.hunting = false;
  }
}
