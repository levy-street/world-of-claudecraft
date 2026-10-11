// How Vysska's Cocoon LOOKS, as pure functions of its hoard cue's own clock
// (src/sim/rift/hoard_cocoon_core.ts): the web mark closing on a player, the
// strand the cocoon hangs by, the rescue ring running down, her feeding, and the
// end (cut open, or fed). No Three.js, no DOM: a Vitest imports this directly,
// and the adapter beside it (hoard_cocoon.ts) only copies these numbers onto
// meshes. The cocoons themselves are ordinary mob bodies (characters/manifest.ts).

import { COCOON, cocoonUrgency } from '../sim/rift/hoard_cocoon_core';

export const COCOON_LOOK = Object.freeze({
  silk: 0xe9ecd9,
  web: 0xf4f6e6,
  calm: 0xcfe39a,
  urgent: 0xff5a3c,
  feed: 0x9dff4a,
  /** The web mark on the floor, in yards. */
  webRadius: 2.4,
  webSpokes: 10,
  webRings: 3,
  /** The rescue ring sits this far out from the cocoon. */
  ringRadius: 2.1,
  ringWidth: 0.34,
  /** The strand runs up out of sight. */
  strandHeight: 24,
  silkTop: 3.5,
  broodTop: 2.5,
});

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number): number => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

export interface CocoonLook {
  /** The web mark: how bright, and how far it has closed in (1 wide, 0 shut). */
  web: number;
  webScale: number;
  /** The strand it hangs by, once the silk has closed. */
  strand: number;
  /** The rescue ring: how much of it is LEFT (1 full, 0 out of time), how bright,
   *  and how far from calm to urgent its colour has gone. */
  left: number;
  ring: number;
  urgency: number;
  /** Her feeding line, and the beat it pulses on (faster as time runs out). */
  feed: number;
  pulse: number;
}

export function makeCocoonLook(): CocoonLook {
  return { web: 0, webScale: 1, strand: 0, left: 1, ring: 0, urgency: 0, feed: 0, pulse: 0 };
}

export function cocoonLook(
  elapsed: number,
  total: number,
  brood: boolean,
  time: number,
  out: CocoonLook,
): CocoonLook {
  const warn = COCOON.warningSec;
  const since = elapsed - warn;
  // The web closes in on them through the warning and snaps shut as it ends.
  out.web = since < 0 ? 0.35 + 0.65 * smooth(elapsed / 0.3) : 1 - smooth(since / 0.35);
  out.webScale = since < 0 ? 1 - 0.55 * smooth(elapsed / warn) : 0.45;
  out.strand = smooth(since / 0.4);
  out.urgency = cocoonUrgency(elapsed, total);
  out.left = 1 - out.urgency;
  out.ring = since < 0 ? 0 : smooth(since / 0.3);
  // She feeds on a player; a brood cocoon only ripens.
  const beat = 2.2 + 5 * out.urgency;
  out.pulse = since < 0 ? 0 : 0.5 + 0.5 * Math.sin(time * beat * Math.PI);
  out.feed = since < 0 || brood ? 0 : (0.35 + 0.65 * out.pulse) * smooth(since / 0.6);
  return out;
}

/** The end: a burst that fades. `fed` is red and sour, cut open is clean silk. */
export function cocoonEndLook(elapsed: number, out: { burst: number; spread: number }): void {
  const t = clamp01(elapsed / COCOON.endSec);
  out.burst = (1 - t) * (1 - t);
  out.spread = 0.6 + 2.6 * smooth(t);
}

/** Write the unit web mark (radius 1, on the floor) as line segments: spokes and
 *  sagging rings. Returns how many floats were written. */
export function writeWeb(out: Float32Array): number {
  const spokes = COCOON_LOOK.webSpokes;
  const rings = COCOON_LOOK.webRings;
  let o = 0;
  for (let s = 0; s < spokes; s++) {
    const a = (s / spokes) * Math.PI * 2;
    out[o++] = 0;
    out[o++] = 0;
    out[o++] = 0;
    out[o++] = Math.sin(a);
    out[o++] = 0;
    out[o++] = Math.cos(a);
  }
  for (let r = 1; r <= rings; r++) {
    const radius = r / rings;
    for (let s = 0; s < spokes; s++) {
      const a = (s / spokes) * Math.PI * 2;
      const b = ((s + 1) / spokes) * Math.PI * 2;
      out[o++] = Math.sin(a) * radius;
      out[o++] = 0;
      out[o++] = Math.cos(a) * radius;
      out[o++] = Math.sin(b) * radius;
      out[o++] = 0;
      out[o++] = Math.cos(b) * radius;
    }
  }
  return o;
}

export const WEB_FLOATS = COCOON_LOOK.webSpokes * 6 * (1 + COCOON_LOOK.webRings);
