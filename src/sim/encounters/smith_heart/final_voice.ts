// What the Masterless Strength SAYS (docs/design/raid/smith_heart.md section
// 7.5, the voice): the heart of the mountain, the Smith's four strengths
// speaking as one ("we"), yelling to every player in the Heart. Each yell
// carries its catalog key (`hudChrome.finalBoss.say.<moment>`) so the client
// renders it through t(), with the English as the fallback and as the key its
// voice clip is found by (scripts/voices/smith_heart_voice_pack.mjs).
//
//   the arrival  the heart wakes as the raid first stands in the Heart: three
//                lines over the rebuild (ARRIVAL_LINE_AT, the renderer's
//                arrival timeline: the heart rising, the stones tearing free,
//                the shockwave), once a claim (a dev replay hears them again)
//   pull         the pull
//   drink*       it drinks a NEW quarter after the first (each at most once
//                in DRINK_EVERY)
//   burst        an Overload bar bursts (at most once in BURST_EVERY)
//   anvil        Weight of the Anvil's bar (at most once in ANVIL_EVERY)
//   call         the 70 percent stride and Call of the Quarters
//   callAgain    the 40 percent one
//   shattered    every Splinter of a call slain: the shield breaks
//   poured       a call run out: the Splinters pour into it
//   final        the 15 percent stride into the centre
//   fury         Masterless Fury's warning
//   kneel        Mythic: the false death at 1 percent
//   rebirth      Mythic: the Heart beats and it rises to 20 percent
//   collapse     Mythic: the first quarter falls
//   anvilsEnd    Mythic: the ring breaks (Anvil's End)
//   slay_*       a player falls: its three kill lines in turn, at most one in
//                SLAY_EVERY (voice_slain.ts)
//   wipe, death  the raid lies still on the Anvil; its fall
//
// An observer: it reads the fight's state after the tick and speaks, and
// changes nothing in the fight (every mechanic's timing and number is the
// coordinator's). Zero rng, no clock but the fight's and the claim's.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import type { FinalStage } from './final_phase_ids';
import type { FinalScope } from './final_scope';
import { heartListeners } from './final_scope';
import type { FinalFightState } from './final_state';
import {
  freshSlainWatch,
  isSlayMoment,
  SLAY_EVERY,
  type SlainWatch,
  slayMoment,
  watchSlain,
} from './voice_slain';

/** The moments the Masterless Strength speaks at. */
export type FinalMoment =
  | 'arrivalWake'
  | 'arrivalRise'
  | 'arrivalRoar'
  | 'pull'
  | 'drinkHeat'
  | 'drinkQuench'
  | 'drinkBreath'
  | 'drinkHammer'
  | 'burst'
  | 'anvil'
  | 'call'
  | 'callAgain'
  | 'shattered'
  | 'poured'
  | 'final'
  | 'fury'
  | 'kneel'
  | 'rebirth'
  | 'collapse'
  | 'anvilsEnd'
  | 'slay_a'
  | 'slay_b'
  | 'slay_c'
  | 'wipe'
  | 'death';

/** Every line (English source; the catalog's `hudChrome.finalBoss.say.*`
 *  rows are the same text). */
export const FINAL_LINES: Readonly<Record<FinalMoment, string>> = {
  arrivalWake: 'Who wakes the heart of the mountain? Warm breath... here, where nothing breathes.',
  arrivalRise: 'Stone, rise. Bind to us. The hand that shaped us is gone, so we shape ourselves.',
  arrivalRoar: "We are the Smith's strength, and we have no master!",
  pull: 'You broke the Hammer, the Breath, the Quench and the Heat. You slew every one of our brothers. Good. Their strength did not die with them... it flows to us. We will wear their power, and crush you with it!',
  drinkHeat: 'The first flame fills us!',
  drinkQuench: 'Cold water, harden us!',
  drinkBreath: 'Breathe, bellows! Lift the storm!',
  drinkHammer: 'Strike, Hammer! Make us heavy!',
  burst: 'The vein runs over! Drown in it!',
  anvil: 'Bear the weight of the world!',
  call: 'Splinters of our strength, rise from the veins! Guard the heart!',
  callAgain: 'Again! Every vein, give us your children!',
  shattered: 'Our splinters... shattered. Then we fight with what remains.',
  poured: 'Yes... pour into us. Every vein, one body.',
  final: 'Enough! Every vein at once! The whole mountain falls on you!',
  fury: 'No hand to stay us. No end to our strength!',
  kneel: 'So this is how he felt... lying down... at last...',
  rebirth: 'No. The mountain does not sleep twice!',
  collapse: 'Fall, stone! If we cannot hold the mountain, no one stands on it!',
  anvilsEnd: 'The Anvil ends. Everything ends.',
  slay_a: 'Back into the stone.',
  slay_b: 'Your blood returns to the vein.',
  slay_c: 'One more warmth, sealed in.',
  wipe: 'Sealed. Silent. As he wanted.',
  death:
    'Useless... all of them. The Guardians... Varkhul... useless, every one. But you cannot kill the elements. Stone, fire, wind and ice do not die... they wait. We will return... and the mountain will remember your names.',
};

/** The catalog key of a line. */
export function finalLineKey(moment: FinalMoment): string {
  return `hudChrome.finalBoss.say.${moment}`;
}

/** Seconds between two of a repeating line (each its own clock). */
export const DRINK_EVERY = 60;
export const BURST_EVERY = 30;
export const ANVIL_EVERY = 45;

const REPEAT_EVERY: Readonly<Partial<Record<FinalMoment, number>>> = {
  drinkHeat: DRINK_EVERY,
  drinkQuench: DRINK_EVERY,
  drinkBreath: DRINK_EVERY,
  drinkHammer: DRINK_EVERY,
  burst: BURST_EVERY,
  anvil: ANVIL_EVERY,
};

const DRINK: Readonly<Record<string, FinalMoment>> = {
  heat: 'drinkHeat',
  quench: 'drinkQuench',
  breath: 'drinkBreath',
  hammer: 'drinkHammer',
};

/** What the voice last saw of the fight (FinalFightState.voice). */
export interface FinalVoiceWatch {
  /** Lines said this pull: the moment (or `slay`) to the fight clock. */
  said: Record<string, number>;
  /** The zone, stage, bursts, Anvil, pours and falls it last saw. */
  zone: string | null;
  stage: FinalStage;
  bursts: number;
  anvil: number | null;
  poured: number;
  fallen: number;
  broken: boolean;
  fury: boolean;
  slain: SlainWatch;
}

export function freshFinalVoice(): FinalVoiceWatch {
  return {
    said: {},
    zone: null,
    stage: 'fight',
    bursts: 0,
    anvil: null,
    poured: 0,
    fallen: 0,
    broken: false,
    fury: false,
    slain: freshSlainWatch(),
  };
}

/** Speak one line from `boss` to everyone in the Heart. */
function yell(ctx: SimContext, inst: InstanceSlot, boss: Entity, moment: FinalMoment): void {
  for (const p of heartListeners(ctx, inst)) {
    ctx.emit({
      type: 'chat',
      fromPid: boss.id,
      from: boss.name,
      entityId: boss.id,
      text: FINAL_LINES[moment],
      textKey: finalLineKey(moment),
      channel: 'yell',
      pid: p.id,
    });
  }
}

/**
 * The boss says its `moment` line, if it may now: a repeating line at most
 * once in its own seconds, a kill line at most one in SLAY_EVERY, every other
 * line once a pull. Returns true when it spoke.
 */
export function finalSay(
  s: Pick<FinalScope, 'ctx' | 'inst' | 'st' | 'boss'>,
  moment: FinalMoment,
): boolean {
  const w = s.st.voice;
  const tag = isSlayMoment(moment) ? 'slay' : moment;
  const said = w.said[tag];
  const every = isSlayMoment(moment) ? SLAY_EVERY : REPEAT_EVERY[moment];
  if (every !== undefined) {
    if (said !== undefined && s.st.clock - said < every - 1e-9) return false;
  } else if (said !== undefined) return false;
  w.said[tag] = s.st.clock;
  yell(s.ctx, s.inst, s.boss, moment);
  return true;
}

function pouredCount(st: FinalFightState): number {
  const p = st.phase.poured;
  return p.heat + p.quench + p.breath + p.hammer;
}

/** The fight's moments since the last tick (called once per tick, after the
 *  fight has stepped): the quarters, the bursts, the Anvil, the stages, the
 *  fury, the hidden phase's falls and a player's fall. */
export function stepFinalVoice(s: FinalScope): void {
  const st = s.st;
  const w = st.voice;
  const ph = st.phase;
  // The quarter: the first one it drinks is the pull's (no line of its own).
  if (st.zone !== w.zone) {
    const first = w.zone === null;
    w.zone = st.zone;
    const drink = DRINK[st.zone];
    if (!first && drink && ph.stage === 'fight') finalSay(s, drink);
  }
  if (st.bursts > w.bursts) {
    w.bursts = st.bursts;
    finalSay(s, 'burst');
  }
  const anvil = st.anvil?.objectId ?? null;
  if (anvil !== null && anvil !== w.anvil) finalSay(s, 'anvil');
  w.anvil = anvil;
  if (ph.stage !== w.stage) {
    const from = w.stage;
    w.stage = ph.stage;
    if (ph.stage === 'leap') finalSay(s, ph.intermissions >= 2 ? 'callAgain' : 'call');
    else if (ph.stage === 'fight' && from === 'call')
      finalSay(s, pouredCount(st) > w.poured ? 'poured' : 'shattered');
    else if (ph.stage === 'finalLeap') finalSay(s, 'final');
    else if (ph.stage === 'kneel') finalSay(s, 'kneel');
    else if (ph.stage === 'rebirth') finalSay(s, 'rebirth');
  }
  w.poured = pouredCount(st);
  if (ph.furyWarned && !w.fury) finalSay(s, 'fury');
  w.fury = ph.furyWarned;
  const h = ph.hidden;
  if (h) {
    if (h.fallen > w.fallen && w.fallen === 0) finalSay(s, 'collapse');
    w.fallen = h.fallen;
    if (h.broken && !w.broken) finalSay(s, 'anvilsEnd');
    w.broken = h.broken;
  }
  if (watchSlain(w.slain, heartListeners(s.ctx, s.inst)) > 0)
    finalSay(s, slayMoment(w.slain.kills, 3));
}

// ---- the arrival -----------------------------------------------------------------------------

/** Seconds after the heart wakes each arrival line is said: the heart rising
 *  out of its bed, the stones tearing free, the shockwave of the last lock
 *  (src/render/smith_heart_fx/final_fx_core.ts ARRIVAL, ARRIVAL_WAVE_AT). */
export const ARRIVAL_LINE_AT: readonly { at: number; moment: FinalMoment }[] = [
  { at: 1.2, moment: 'arrivalWake' },
  { at: 6.4, moment: 'arrivalRise' },
  { at: 11.75, moment: 'arrivalRoar' },
];

/** A claim's arrival in progress: the claim time the heart woke and the next
 *  line to say, keyed by the claim's identity and its exit (a recycled slot
 *  never inherits it). */
const arrivals = new WeakMap<InstanceSlot, { exitId: number | null; from: number; next: number }>();

/** The heart woke in this claim (the seal's arrival bit rose): its three
 *  lines follow over the rebuild. */
export function beginArrivalVoice(ctx: SimContext, inst: InstanceSlot): void {
  arrivals.set(inst, { exitId: inst.exitId, from: ctx.time, next: 0 });
}

/** One tick of a claim's arrival lines (called every tick of the claim). */
export function stepArrivalVoice(ctx: SimContext, inst: InstanceSlot, boss: Entity | null): void {
  const a = arrivals.get(inst);
  if (!a) return;
  if (a.exitId !== inst.exitId || !boss || boss.dead || a.next >= ARRIVAL_LINE_AT.length) {
    arrivals.delete(inst);
    return;
  }
  const line = ARRIVAL_LINE_AT[a.next];
  if (ctx.time - a.from + 1e-9 < line.at) return;
  a.next++;
  // A raid that pulls straight away hears the fight's lines instead.
  if (boss.smithHeartFinal) return;
  yell(ctx, inst, boss, line.moment);
}
