// Pure decisions behind the Deepglass sound beds and cues: how loud the bowl
// reads from a point, how hard a burner bed drives, and the per-fighter edge
// bits. Three- and DOM-free; cues.ts and renderer.ts are the consumers.

import { DG_BOOST_SPEED, DG_SWIM_SPEED } from '../../sim/deepglass/flight';
import { DEEPGLASS_CENTER, DG_BOWL_OUTER_R } from '../../sim/deepglass/layout';
import type { DgMatch } from '../../sim/deepglass/match';

/** How far a deepball cue carries. The bell is ~98 yd across and the shared
 *  cutoff is 46, so without this half the arena is silent, and hearing the ball
 *  behind you is half of knowing where it is. */
export const DG_SOUND_RANGE = 120;

/** Yards past the bowl wall over which the outdoor crowd bed fades out. */
const CROWD_FADE_YD = 40;

/** How loud the Deepglass bowl reads from (x, z).
 *
 *  The mood is the match state, split the same way the card crowd's excite
 *  is: a goal is the whole bowl, a running bout is a full house, an ordinary
 *  day is the quarter crowd that turns up to watch the water.
 *
 *  Inside the bell there is no falloff, the stands ring the arena, so the
 *  crowd is not a thing you walk toward. Outside it, the bed fades over the
 *  forty yards past the bowl wall and is gone well before the Tide Gate, so
 *  the stadium never follows the player up the causeway into Tidehold. */
export function deepglassCrowdLevel(
  phase: DgMatch['phase'] | null,
  x: number,
  z: number,
  submerged: boolean,
): number {
  const mood = phase === 'goal' ? 1 : phase !== null ? 0.72 : 0.3;
  if (submerged) return mood;
  const d = Math.hypot(x - DEEPGLASS_CENTER.x, z - DEEPGLASS_CENTER.z);
  const far = DG_BOWL_OUTER_R + CROWD_FADE_YD;
  if (d >= far) return 0;
  return d <= DG_BOWL_OUTER_R ? mood : mood * (1 - (d - DG_BOWL_OUTER_R) / CROWD_FADE_YD);
}

/** The card crowd's excitement: a goal spikes the whole bowl, a running bout
 *  keeps it lively, the market-day idle keeps a gentle murmur. */
export function deepglassCrowdExcite(phase: DgMatch['phase'] | null): number {
  return phase === 'goal' ? 1 : phase !== null ? 0.42 : 0.14;
}

/** 0..1 burner-bed drive for a body at `speed`. Against the bell's own
 *  cruise, not the world's run speed: measured against RUN_SPEED this would
 *  sit pinned all bout and say nothing (the same saturation trap the camera
 *  FOV kick had). */
export function boostBedDrive(speed: number): number {
  return Math.min(
    1,
    Math.max(0, (speed - DG_SWIM_SPEED * 0.5) / (DG_BOOST_SPEED - DG_SWIM_SPEED * 0.5)),
  );
}

/** Edge bits for one fighter: boost | dash | brake. */
export const DG_CUE_BOOST = 1;
export const DG_CUE_DASH = 2;
export const DG_CUE_BRAKE = 4;

export function bodyCueBits(boosting: boolean, dashTicks: number, braking: boolean): number {
  return (
    (boosting ? DG_CUE_BOOST : 0) | (dashTicks > 0 ? DG_CUE_DASH : 0) | (braking ? DG_CUE_BRAKE : 0)
  );
}

/** Which one cue a fighter's rising edges fire, or null. The dash is the
 *  loudest of the three and outranks the others: they all fire on the same
 *  tick (a dash lights the pack), and three transients stacked on one body is
 *  mud. Brake outranks ignition for the same reason. */
export function bodyCueFor(was: number, bits: number): 'dash' | 'brake' | 'ignite' | null {
  const rose = bits & ~was;
  if (rose & DG_CUE_DASH) return 'dash';
  if (rose & DG_CUE_BRAKE) return 'brake';
  if (rose & DG_CUE_BOOST) return 'ignite';
  return null;
}

/** The side a fighter plays for in `match`, or null for a non-roster body. */
export function deepglassTeamOf(match: DgMatch | null, id: number): 'A' | 'B' | null {
  if (!match) return null;
  if (match.teamA.includes(id)) return 'A';
  if (match.teamB.includes(id)) return 'B';
  return null;
}
