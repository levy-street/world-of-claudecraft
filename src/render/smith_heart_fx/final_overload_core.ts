// Pure plan of the Masterless Strength's Overload IN THE WORLD (the team's
// review of 2026-11-17: "Overload needs something that isn't UI, something
// on the boss or the arena"; final_overload_fx.ts paints it, the room's floor
// and wall the interior through heart_quarters_core.ts `strain`). As the bar
// of the quarter it drinks fills:
//   - the boss's own cracks burn brighter as it fills: its body's glow
//     throbbing in steps, harder and faster as it nears full (`strainPulse`,
//     the rig's glow pulses: light in the body itself, never a cage round it,
//     the coordinator's review of 2026-11-18), light bleeding off it in
//     sparks (`strainLook`);
//   - the quarter's floor cracks throb harder (`floorThrob`);
//   - at three quarters (FINAL_OVERLOAD.eruptAt) the quarter's wall erupts
//     (`eruptLevel`: the landmark's own light flaring past its lit level and
//     its element thrown up off it);
//   - the burst is a wave out of the boss itself (FinalFx's wall of light).
// Every level is read off the bar's own aura (the same `value` the HUD
// reads), so offline and online look the same, and it draws on every tier
// (actionable: how near the burst is).
//
// Three-free, DOM-free, deterministic.

import { FINAL_OVERLOAD } from '../../sim/encounters/smith_heart/final_ids';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** The shell of strain round the body at bar `fill` (0..1), render time
 *  `t`: how far it has swelled (a scale over the body's own), how open its
 *  cracks are, how hot they burn, and its throb (0..1). Nothing under a
 *  fifth of a bar. */
export function strainLook(
  fill: number,
  t: number,
  out: { swell: number; crack: number; heat: number; throb: number } = {
    swell: 1,
    crack: 0,
    heat: 0,
    throb: 0,
  },
): { swell: number; crack: number; heat: number; throb: number } {
  const s = smooth(0.2, 1, fill);
  // The throb quickens as it fills: about once every two seconds to four a
  // second at full.
  const rate = 3 + 22 * s * s;
  const throb = s > 0 ? 0.5 + 0.5 * Math.sin(t * rate) : 0;
  out.swell = 1 + 0.16 * s + 0.04 * s * throb;
  out.crack = s;
  out.heat = s * (0.55 + 0.45 * throb);
  out.throb = throb;
  return out;
}

/** The body's own cracks throbbing at bar `fill` (0..1): which of the
 *  three strain pulses to send (0 none, under a quarter of a bar; 3 the
 *  brightest, past three quarters) and how often (seconds: about every 1.5 s
 *  at a quarter, quickening to three a second at full). */
export function strainPulse(fill: number): { level: 0 | 1 | 2 | 3; every: number } {
  if (fill < 0.25) return { level: 0, every: 0 };
  const level: 1 | 2 | 3 = fill < 0.5 ? 1 : fill < FINAL_OVERLOAD.eruptAt ? 2 : 3;
  const s = smooth(0.25, 1, fill);
  return { level, every: 1.5 - 1.17 * s };
}

/** The quarter's floor cracks' extra light at bar `fill`, render time `t`
 *  (0 under a third; up to about 0.7 at full, pulsing). */
export function floorThrob(fill: number, t: number): number {
  const s = smooth(0.3, 1, fill);
  if (s <= 0) return 0;
  return s * (0.35 + 0.35 * (0.5 + 0.5 * Math.sin(t * (3 + 9 * s))));
}

/** The quarter's wall erupting at bar `fill`: 0 below FINAL_OVERLOAD's
 *  `eruptAt`, rising fast to 1 just past it (the landmark flares and throws
 *  its element up). */
export function eruptLevel(fill: number): number {
  return smooth(FINAL_OVERLOAD.eruptAt, FINAL_OVERLOAD.eruptAt + 0.06, fill);
}

/** Has the bar just crossed into the eruption (`from` to `to`, 0..1)? */
export function eruptStarts(from: number, to: number): boolean {
  return from < FINAL_OVERLOAD.eruptAt && to >= FINAL_OVERLOAD.eruptAt;
}
