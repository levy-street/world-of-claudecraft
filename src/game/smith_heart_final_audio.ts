// Plays the Masterless Strength's sounds (WHICH and WHEN: the pure core
// beside this file). Fed by the final's kit painter (render/smith_heart_fx/
// final_kit_fx.ts): every cue event, each footprint as it first appears, and
// each frame the boss, the Splinters, the gale's footprint and the local
// player. Bounded and allocation-free in the frame: a fixed row of bar slots,
// a handful of fields. Local presentation: a sound never decides anything.

import { HEART_QUARTER_ORDER } from '../sim/content/smith_heart_quarters';
import { FINAL_AURAS, FINAL_CUES, overloadAuraId } from '../sim/encounters/smith_heart/final_ids';
import {
  FINAL_PHASE_AURAS,
  FINAL_PHASE_CUES,
  FINAL_STAGE_CODES,
} from '../sim/encounters/smith_heart/final_phase_ids';
import type { Entity, SimEvent } from '../sim/types';
import {
  FINAL_BAR_SOUNDS,
  FINAL_CUE_SOUNDS,
  FINAL_FOOTPRINT_SOUNDS,
  FINAL_GALE_LOOP,
  FINAL_MARK_SOUNDS,
  FINAL_OVERLOAD_RISING,
  FINAL_REBUILD_SOUND,
  FINAL_SFX_KEYS,
  type FinalFootprintKind,
  finalBarRate,
  MIX_TURN_STING,
  overloadPulseSound,
  overloadRisingDue,
  rebuildDue,
} from './smith_heart_final_audio_core';
import { HeartMarkEar } from './smith_heart_mark_audio';
import { coldWarningDue, QUENCH_COLD_SOUNDS } from './smith_heart_quench_audio_core';

export interface FinalAudioSink {
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

const GALE_LOOP = 'heart-final-gale';
/** The boss and the Splinters (at most four): one bar slot each. */
const MAX_BARS = 5;
const OVERLOAD_IDS = HEART_QUARTER_ORDER.map((v) => overloadAuraId(v));
const COLLAPSE_CODE = FINAL_STAGE_CODES.collapse;

function auraOf(e: Entity, id: string) {
  const auras = e.auras;
  for (let i = 0; i < auras.length; i++) if (auras[i].id === id) return auras[i];
  return null;
}

/** The fullest Overload bar on the boss, 0 to 100. */
function fullestBar(boss: Entity): number {
  let most = 0;
  for (const id of OVERLOAD_IDS) {
    const a = auraOf(boss, id);
    if (a && a.value > most) most = a.value;
  }
  return most;
}

/** The fallen quarters' mask while the hidden phase's collapse runs, else 0. */
function fallenMask(boss: Entity): number {
  const phase = auraOf(boss, FINAL_PHASE_AURAS.phase);
  if (!phase || Math.round(phase.value) !== COLLAPSE_CODE) return 0;
  return Math.round(auraOf(boss, FINAL_PHASE_AURAS.hidden)?.value ?? 0);
}

export class FinalAudio {
  private preloaded = false;
  private readonly marks = new HeartMarkEar(FINAL_MARK_SOUNDS);
  private readonly barIds: number[] = new Array(MAX_BARS).fill(-1);
  private readonly bars: string[] = new Array(MAX_BARS).fill('');
  private readonly barTotals: number[] = new Array(MAX_BARS).fill(0);
  private overload = 0;
  private fallen = 0;
  private cold = 0;
  private galing = false;

  constructor(private readonly sink: FinalAudioSink) {}

  private preload(): void {
    if (this.preloaded) return;
    this.preloaded = true;
    for (const key of FINAL_SFX_KEYS) this.sink.preload?.(key);
  }

  private play(
    key: string,
    x: number,
    y: number,
    z: number,
    gain: number,
    rate: number,
    cooldown: number,
  ): void {
    this.sink.playAt(key, x, y, z, { gain, rate, cooldown, priority: true });
  }

  /** A fight cue: its layered one-shot. Returns true when it was the fight's. */
  event(
    ev: SimEvent,
    entityOf: (id: number) => Entity | undefined,
    groundY: (x: number, z: number) => number,
  ): boolean {
    if (ev.type !== 'spellfx' && ev.type !== 'spellfxAt') return false;
    const layers = ev.ability ? FINAL_CUE_SOUNDS[ev.ability] : undefined;
    if (!layers) return false;
    this.preload();
    for (const sound of layers) {
      if (sound.on && sound.on !== ev.type) continue;
      let x: number;
      let y: number;
      let z: number;
      let gain = sound.gain;
      let rate = sound.rate;
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
        if (ev.ability === FINAL_CUES.pulse) {
          const p = overloadPulseSound(fullestBar(e) / 100);
          gain = p.gain;
          rate = p.rate;
        }
      }
      this.play(sound.key, x, y + 1, z, gain, rate, sound.cooldown);
      if (ev.type === 'spellfxAt' && ev.ability === FINAL_PHASE_CUES.mixTurn) {
        const sting = MIX_TURN_STING[ev.school ?? ''];
        if (sting) this.play(sting.key, x, y + 2, z, sting.gain, sting.rate, 1);
      }
    }
    return true;
  }

  /** A footprint of `kind` first appeared at (x, y, z): its warning. */
  footprint(kind: FinalFootprintKind, x: number, y: number, z: number): void {
    const s = FINAL_FOOTPRINT_SOUNDS[kind];
    if (!s) return;
    this.preload();
    this.play(s.key, x, y + 1, z, s.gain, s.rate, 0.25);
  }

  /** One body's bar this frame (slot 0 the boss, 1 to 4 the Splinters). */
  private bar(slot: number, e: Entity | undefined): void {
    if (!e) {
      this.barIds[slot] = -1;
      return;
    }
    const bar = e.dead ? '' : (e.castingAbility ?? '');
    const fresh = this.barIds[slot] !== e.id;
    if (fresh) {
      // A bar already running when first heard is never replayed late.
      this.barIds[slot] = e.id;
      this.bars[slot] = bar;
      this.barTotals[slot] = e.castTotal;
      return;
    }
    if (bar === this.bars[slot] && (bar === '' || e.castTotal === this.barTotals[slot])) return;
    this.bars[slot] = bar;
    this.barTotals[slot] = e.castTotal;
    const sound = bar ? FINAL_BAR_SOUNDS[bar] : undefined;
    if (sound)
      this.play(
        sound.key,
        e.pos.x,
        e.pos.y + 2,
        e.pos.z,
        sound.gain,
        finalBarRate(sound, e.castTotal),
        0.3,
      );
  }

  /**
   * One frame in the Heart: the boss (null out of the room), the Splinters
   * (their ids, read through `entityOf`), Bellows Wind's gale while it blows
   * (its spot, or null), the local player, and the Anvil's centre (where the
   * floor rises back).
   */
  update(
    boss: Entity | null,
    splinterIds: readonly number[],
    entityOf: (id: number) => Entity | undefined,
    gale: { x: number; y: number; z: number } | null,
    me: Entity | null,
    centre: { x: number; y: number; z: number } | null,
  ): void {
    if (boss) this.preload();
    this.bar(0, boss ?? undefined);
    for (let i = 1; i < MAX_BARS; i++) {
      const id = i - 1 < splinterIds.length ? splinterIds[i - 1] : -1;
      this.bar(i, id >= 0 ? entityOf(id) : undefined);
    }
    // The Overload: the fullest bar passing three quarters.
    const overload = boss && !boss.dead ? fullestBar(boss) : 0;
    if (boss && overloadRisingDue(this.overload, overload))
      this.play(
        FINAL_OVERLOAD_RISING.key,
        boss.pos.x,
        boss.pos.y + 4,
        boss.pos.z,
        FINAL_OVERLOAD_RISING.gain,
        1,
        2,
      );
    if (overload >= FINAL_OVERLOAD_RISING.at || overload < FINAL_OVERLOAD_RISING.rearm)
      this.overload = overload;
    // Mythic's floor: fallen quarters, then none (a kill, a wipe, a reset).
    const fallen = boss ? fallenMask(boss) : 0;
    if (rebuildDue(this.fallen, fallen) && centre)
      this.play(
        FINAL_REBUILD_SOUND.key,
        centre.x,
        centre.y + 1,
        centre.z,
        FINAL_REBUILD_SOUND.gain,
        1,
        2,
      );
    this.fallen = fallen;
    // Bellows Wind's gale.
    if (gale) {
      this.sink.loop?.(
        GALE_LOOP,
        FINAL_GALE_LOOP.key,
        FINAL_GALE_LOOP.gain,
        gale.x,
        gale.y + 2,
        gale.z,
      );
      this.galing = true;
    } else if (this.galing) {
      this.sink.unloop?.(GALE_LOOP, FINAL_GALE_LOOP.fadeOut);
      this.galing = false;
    }
    // The local player's marks and their Quenching Cold.
    this.marks.update(me, this.sink);
    const cold = me && !me.dead ? (auraOf(me, FINAL_AURAS.cold)?.value ?? 0) : 0;
    const due = me ? coldWarningDue(this.cold, cold) : null;
    if (me && due) {
      const s = QUENCH_COLD_SOUNDS[due];
      this.play(s.key, me.pos.x, me.pos.y + 1.6, me.pos.z, s.gain, 1, 1);
    }
    this.cold = cold;
  }

  dispose(): void {
    if (this.galing) this.sink.unloop?.(GALE_LOOP, 0.3);
    this.galing = false;
  }
}
