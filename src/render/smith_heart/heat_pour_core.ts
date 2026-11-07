// Pure plan of the pour, the Heat's set piece's look (phase 2I; heat_pour.ts
// paints it; docs/design/raid/smith_heart.md section 6.4): on a fixed cycle
// the wellspring at the Pour Channel's head brims and glows, the channel's
// bed lights from its head down to the lip before anything arrives (the
// warning the mechanic will keep), then a stream of white-gold fire runs
// down the channel, fills it, pours off the casting floor's south lip into
// the chasm in a burning fall, and drains away, the channel cooling dark
// again. The mechanic (a pour that hurts whoever stands in it) is not
// built: this is its look, on the vein's own white-gold, never a threat
// colour, and it lies under every telegraph.
//
// Every motion runs in the shaders on the shared clock; the timeline below is
// the same arithmetic the shaders run (pinned by
// tests/smith_heart_heat_air.test.ts). The warning glow and the flow draw on
// every tier (the readable part); only the sparks and the haze shed on the
// low tier. Three-free, DOM-free, deterministic.

import { heartPropBase } from './heart_plan_core';
import { HEAT_WELL_FIRE, heatChannelRun, heatWellspring } from './heat_kit_plan_core';

/** The pour's cycle (seconds): it brims for BRIM (the channel's warning
 *  glow running down it in the brim's last WARN share), its flow runs to
 *  the lip in RUN, holds full HOLD, drains DRAIN; idle the rest. */
export const HEAT_POUR = {
  cycle: 26,
  brim: 4.2,
  warn: 0.7,
  run: 2.0,
  hold: 4.5,
  drain: 3.5,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

/** Seconds into the pour's cycle at clock `t`. */
export function heatPourSince(t: number): number {
  const c = HEAT_POUR.cycle;
  return ((t % c) + c) % c;
}

export interface HeatPourLook {
  /** The wellspring brimming (0 idle to 1 full and bright). */
  brim: number;
  /** How far down the channel its warning glow has run (0 head to 1 lip),
   *  and how bright it is. */
  warnFront: number;
  warn: number;
  /** How far down the channel the flow has run (0 head to 1 lip). */
  front: number;
  /** The flow's heat (1 full, falling to 0 as it drains). */
  fill: number;
  /** The fall off the lip into the chasm (0 to 1). */
  fall: number;
}

/** The pour `since` seconds into its cycle. */
export function heatPourLook(since: number): HeatPourLook {
  const P = HEAT_POUR;
  const flowAt = P.brim;
  const fullAt = flowAt + P.run;
  const drainAt = fullAt + P.hold;
  const doneAt = drainAt + P.drain;
  const brim =
    since < flowAt
      ? smooth(since / P.brim)
      : since < drainAt
        ? 1
        : since < doneAt
          ? 1 - smooth((since - drainAt) / P.drain)
          : 0;
  const warnStart = P.brim * (1 - P.warn);
  const warnFront =
    since < warnStart ? 0 : since < flowAt ? smooth((since - warnStart) / (flowAt - warnStart)) : 1;
  const warn =
    since < warnStart
      ? 0
      : since < doneAt
        ? Math.min(1, (since - warnStart) / 0.6) * (1 - smooth((since - drainAt) / P.drain))
        : 0;
  const front = since < flowAt ? 0 : since < doneAt ? smooth((since - flowAt) / P.run) : 0;
  const fill =
    since < flowAt
      ? 0
      : since < drainAt
        ? 1
        : since < doneAt
          ? 1 - smooth((since - drainAt) / P.drain)
          : 0;
  // The fall starts as the front reaches the lip, a breath to gather.
  const fall = since >= fullAt && since < doneAt ? fill * smooth((since - fullAt) / 0.4) : 0;
  return { brim, warnFront, warn, front, fill, fall };
}

/** Where the pour runs (instance-local): the wellspring's brim, its chute
 *  down to the channel's head, the channel from the head (z1) down to the
 *  lip (z0), its half width, and the floor's height. */
export function heatPourPath(): {
  brim: { x: number; y: number; z: number; r: number };
  x: number;
  z0: number;
  z1: number;
  half: number;
  y: number;
} {
  const w = heatWellspring();
  const run = heatChannelRun();
  const base = heartPropBase(w.x, w.z);
  return {
    brim: { x: w.x, y: base + HEAT_WELL_FIRE + 0.2, z: w.z, r: 1.75 },
    x: run.x,
    z0: run.z0,
    z1: run.z1,
    half: 2.2,
    y: heartPropBase(run.x, (run.z0 + run.z1) / 2),
  };
}
