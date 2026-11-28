// The Masterless Strength's final phase (docs/design/raid/smith_heart.md
// section 7.5, part 2, reworked on 2026-11-18):
//
//   Poured elements  a Splinter alive when its call ends pours its quarter's
//                    star into the boss for the rest of the fight: woken if it
//                    slept, and at full pace wherever the boss stands
//                    (final_stars.ts starPace; the pour itself is
//                    final_intermission.ts endCall).
//   The final phase  at 15 percent it strides into the central ring and
//                    stays there; all four quarters' stars wake at once and
//                    run together at FINAL_TUNING.finalPace with their
//                    interactions (pillars rising, lightning seeking them,
//                    blades shattering them, whirls running). The Overload
//                    bars are off (empty, still) and the ring is its own (no
//                    Heart Unbound). Weight of the Anvil keeps its own clock.
//   Masterless Fury  the soft enrage: two minutes into the final phase it
//                    pulses the raid every 2 s, harder each pulse (warned 10 s
//                    before; the HUD counts it down).
//   The hidden phase Mythic's (FINAL_PHASE_DIFFICULTY `hiddenPhase`): at 1
//                    percent final_hidden.ts takes over. Its order reads the
//                    bars as this phase switches them off (`hiddenBars`).
//
// Deterministic: every pick is the stars' own (hashed); the only rng draws
// are the damage rolls, in claim-player order.

import { HEART_ROOM } from '../../content/smith_heart_layout';
import { HEART_QUARTER_ORDER } from '../../content/smith_heart_quarters';
import { DT } from '../../types';
import { phaseRules } from './final_adds';
import { dropShield, pinCentre } from './final_intermission';
import {
  FINAL_PHASE_AURAS as A,
  furyScale,
  FINAL_PHASE_NAMES as N,
  FINAL_PHASES as P,
  FINAL_PHASE_CUES as Q,
} from './final_phase_ids';
import {
  auraOf,
  cueAt,
  cueOn,
  type FinalScope,
  hit,
  livePlayers,
  putMarker,
  roll,
} from './final_scope';
import { wakeStar } from './final_stars';

// ---- the final phase ------------------------------------------------------------------------

/** The final phase begins (it stands in the centre): all four stars awake,
 *  the bars off, the enrage's clock. */
export function beginFinalPhase(s: FinalScope): void {
  const st = s.st;
  const ph = st.phase;
  if (phaseRules(s).hiddenPhase) ph.hiddenBars = { ...st.overload };
  ph.stage = 'final';
  ph.finalClock = 0;
  ph.fury = 0;
  ph.furyTimer = 0;
  ph.furyWarned = false;
  for (const v of HEART_QUARTER_ORDER) {
    st.overload[v] = 0;
    wakeStar(s, v);
  }
  st.unbound = 0;
  dropShield(s);
  cueAt(s, Q.awaken, HEART_ROOM.x, HEART_ROOM.z, 40, 'arcane');
}

/** Masterless Fury pulses (exported for the dev verb). */
export function furyPulse(s: FinalScope): void {
  const ph = s.st.phase;
  const b = s.boss;
  ph.fury++;
  const a = auraOf(b, A.fury);
  if (a) {
    a.stacks = ph.fury;
    a.value = ph.fury;
  } else {
    putMarker(b, A.fury, N.fury, 3600, b.id, {
      permanent: true,
      stacks: ph.fury,
      value: ph.fury,
      school: 'arcane',
    });
  }
  cueOn(s, b, Q.fury, 'arcane');
  for (const p of livePlayers(s))
    hit(s, p, Math.round(roll(s, P.furyMin, P.furyMax) * furyScale(ph.fury)), N.fury, 'arcane');
}

/** One tick of the final phase: held in the centre, the enrage (the stars
 *  run on their own clocks, final_stars.ts). */
export function stepFinal(s: FinalScope): void {
  const ph = s.st.phase;
  if (!s.st.bar) pinCentre(s);
  ph.finalClock += DT;
  // Near the enrage the boss says so (final_voice.ts reads the flag).
  if (ph.finalClock >= P.enrageAfter - P.enrageWarnAt - 1e-9) ph.furyWarned = true;
  if (ph.finalClock < P.enrageAfter - 1e-9) return;
  ph.furyTimer -= DT;
  if (ph.furyTimer > 1e-9) return;
  ph.furyTimer = P.furyEvery;
  furyPulse(s);
}
