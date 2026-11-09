// The Masterless Strength's final phase and its poured elements
// (docs/design/raid/smith_heart.md section 7.5, part 2):
//
//   Poured elements  a Splinter alive when its call ends pours its element
//                    into the boss for the rest of the fight: that quarter's
//                    Normal signature fires wherever it stands, slower (the
//                    Heat's Fire Whirls every 26 s, the Breath's Leaping Bolt
//                    every 22 s, the Hammer's Tremor Cracks every 20 s, the
//                    Quench's cold everywhere at half its rise), each cadence
//                    divided by the times it was poured (the cold's rise
//                    never past whole). Painful together, never an instant
//                    wipe: each is a Normal mechanic at a slower pace.
//   The final phase  at 15 percent it strides into the central ring and
//                    stays there; all four quarters wake at once. The
//                    Overload bars are off (empty, still) and the ring is its
//                    own (no Heart Unbound). It mixes one ability of each
//                    element in turn, 7 s apart, so two never land together:
//                    Fire Whirls, Groaning Ice, Leaping Bolt, Weight of the
//                    Anvil (each with its tier's own additions: Crushed on
//                    Heroic, the turning Anvil on Mythic).
//   Masterless Fury  the soft enrage: two minutes into the final phase it
//                    pulses the raid every 2 s, harder each pulse (warned 10 s
//                    before; the HUD counts it down).
//   The hidden phase Mythic's (FINAL_PHASE_DIFFICULTY `hiddenPhase`): at 1
//                    percent final_hidden.ts takes over. Its order reads the
//                    bars as this phase switches them off (`hiddenBars`).
//
// Deterministic: every pick is the kits' own (hashed); the only rng draws
// are the damage rolls, in claim-player order.

import { HEART_ROOM } from '../../content/smith_heart_layout';
import { HEART_QUARTER_ORDER } from '../../content/smith_heart_quarters';
import { DT } from '../../types';
import { phaseRules } from './final_adds';
import { startBolt } from './final_breath';
import { crackTremors, startAnvil } from './final_hammer';
import { raiseWhirls } from './final_heat';
import { dropShield, pinCentre } from './final_intermission';
import {
  FINAL_PHASE_AURAS as A,
  FINAL_MIX,
  FINAL_VEIN_SCHOOL,
  furyScale,
  FINAL_PHASE_NAMES as N,
  FINAL_PHASES as P,
  FINAL_PHASE_CUES as Q,
} from './final_phase_ids';
import { crackIce } from './final_quench';
import {
  auraOf,
  bossFree,
  cueAt,
  cueOn,
  type FinalScope,
  hit,
  livePlayers,
  putMarker,
  roll,
} from './final_scope';

// ---- the poured elements ---------------------------------------------------------------------

/** The Quench's cold share now (0 when it was never poured). */
export function pouredColdRate(s: Pick<FinalScope, 'st'>): number {
  return Math.min(1, P.pouredColdShare * s.st.phase.poured.quench);
}

/** One tick of every poured element's signature (the fight and the final
 *  phase; never while it strides or calls). */
export function stepPoured(s: FinalScope): void {
  const ph = s.st.phase;
  for (const v of HEART_QUARTER_ORDER) {
    const n = ph.poured[v];
    if (n <= 0 || v === 'quench') continue;
    ph.pouredClock[v] -= DT;
    if (ph.pouredClock[v] > 1e-9) continue;
    if (v === 'heat') {
      raiseWhirls(s);
      ph.pouredClock[v] = P.pouredHeatEvery / n;
    } else if (v === 'hammer') {
      crackTremors(s);
      ph.pouredClock[v] = P.pouredHammerEvery / n;
    } else if (v === 'breath') {
      // A bar: it waits for the boss to be free.
      if (!bossFree(s)) {
        ph.pouredClock[v] = 0;
        continue;
      }
      startBolt(s);
      ph.pouredClock[v] = P.pouredBreathEvery / n;
    }
  }
}

// ---- the final phase ------------------------------------------------------------------------

/** The final phase begins (it stands in the centre): all four quarters
 *  awake, the bars off, the mix's clock, the enrage's. */
export function beginFinalPhase(s: FinalScope): void {
  const st = s.st;
  const ph = st.phase;
  if (phaseRules(s).hiddenPhase) ph.hiddenBars = { ...st.overload };
  ph.stage = 'final';
  ph.finalClock = 0;
  ph.mixTurn = 0;
  ph.mixTimer = P.mixFirst;
  ph.fury = 0;
  ph.furyTimer = 0;
  ph.furyWarned = false;
  for (const v of HEART_QUARTER_ORDER) st.overload[v] = 0;
  st.unbound = 0;
  dropShield(s);
  cueAt(s, Q.awaken, HEART_ROOM.x, HEART_ROOM.z, 40, 'arcane');
}

/** One turn of the mix (exported for the tests): true when it began. */
export function mixTurn(s: FinalScope): boolean {
  const ph = s.st.phase;
  const vein = FINAL_MIX[ph.mixTurn % FINAL_MIX.length];
  if (vein === 'heat') raiseWhirls(s);
  else if (vein === 'quench') crackIce(s);
  else if (vein === 'breath') {
    if (!bossFree(s)) return false;
    startBolt(s);
  } else {
    if (!bossFree(s)) return false;
    startAnvil(s);
  }
  // The turn's tell: the room's own cue, in the turn's element (its sound's).
  cueAt(s, Q.mixTurn, HEART_ROOM.x, HEART_ROOM.z, 40, FINAL_VEIN_SCHOOL[vein]);
  ph.mixTurn++;
  return true;
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

/** One tick of the mix's clock (the final phase, the collapse). */
export function stepMix(s: FinalScope): void {
  const ph = s.st.phase;
  ph.mixTimer -= DT;
  if (ph.mixTimer <= 1e-9 && mixTurn(s)) ph.mixTimer = P.mixEvery;
  else if (ph.mixTimer <= 1e-9) ph.mixTimer = 0;
}

/** One tick of the final phase: held in the centre, the mix, the enrage. */
export function stepFinal(s: FinalScope): void {
  const ph = s.st.phase;
  if (!s.st.bar) pinCentre(s);
  ph.finalClock += DT;
  stepMix(s);
  // Near the enrage the boss says so (final_voice.ts reads the flag).
  if (ph.finalClock >= P.enrageAfter - P.enrageWarnAt - 1e-9) ph.furyWarned = true;
  if (ph.finalClock < P.enrageAfter - 1e-9) return;
  ph.furyTimer -= DT;
  if (ph.furyTimer > 1e-9) return;
  ph.furyTimer = P.furyEvery;
  furyPulse(s);
}
