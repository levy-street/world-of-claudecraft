// The border ridges' gaussian used to be truncated with a hard early-out at
// 3 sigma from the edge line. For the classic low ridges the tail there is a
// ~0.2yd step, but Thornpeak's tall craggy edges (peaksHeight 34) and the
// sealed walls (SEALED_RIDGE_HEIGHT 60) leave a 0.6 to 1.3yd instant cliff
// along the whole cutoff line: an invisible straight wall the movement gate
// (rise/run over one tick) refuses to climb. The report: a long impassable
// line of uneven ground at x = -102 in Thornpeak Heights (the west edge at
// x = -180 with RIDGE_SIGMA 26, so 3 sigma lands exactly there), plus its
// siblings at z = 879 and z = 951 off the sealed Hollow wall at z = 915.
// The fix keeps every height inside 3 sigma bit-identical and fades the tail
// smoothly to zero across [3, 4] sigma, so the cutoff line cannot step.

import { describe, expect, it } from 'vitest';
import { ZONES } from '../src/sim/data';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { computeBorderEdges, groundHeight } from '../src/sim/world';

// The production seed: the reported cliffs are seed-pinned world geometry.
const SEED = 20061;

// One movement tick of run at RUN_SPEED (player_motion.ts): the gate blocks a
// step when its rise over this run beats PLAYER_MAX_CLIMB_SLOPE.
const TICK_RUN = 7 / 20;

const RIDGE_SIGMA = 26;
const SEALED_RIDGE_SIGMA = 12;

describe('border ridge tails end without a step', () => {
  const edges = computeBorderEdges(ZONES);

  it('no window line blocks a walking step in the classic strip zones', () => {
    // The realms beyond the strip carry intentional cliffs on some of these
    // lines (the Frostveil's terraced benches, coast headlands), so the sweep
    // stays inside the classic rolling country where the bug manifested: the
    // vale/marsh/peaks bands plus the sealed Hollow wall's skirts. The
    // check is the movement gate's own refusal condition: a rise steeper
    // than PLAYER_MAX_CLIMB_SLOPE over one tick of run, straight across the
    // line. The bug's signature was that CUTOFF LINE itself: a coherent
    // invisible cliff running the whole window edge, refusing the step at
    // (nearly) every position along it. The natural-relief terrain
    // legitimately crosses these lines with organic crags at scattered
    // points (Thornpeak's uplands are genuinely craggy now), so the
    // assertion is on the per-line steep FRACTION, far below the wall-like
    // coherence the bug produced and far above organic scatter.
    const offenders: string[] = [];
    const inStripCountry = (x: number, z: number) => Math.abs(x) <= 204 && z >= -170 && z <= 963;
    // a point standing inside another edge's ridge window is on a real
    // mountain range whose flanks are intentionally steep; the sweep is about
    // the open country where only the tail (and the bug's cliff) lives
    const onAnotherWall = (x: number, z: number, self: (typeof edges)[number]) =>
      edges.some((e) => {
        if (e === self) return false;
        const s = e.sealed ? SEALED_RIDGE_SIGMA : RIDGE_SIGMA;
        const dPerp = Math.abs((e.kind === 'h' ? z : x) - e.at);
        const along = e.kind === 'h' ? x : z;
        return dPerp < s * 3 && along >= e.lo - 24 && along <= e.hi + 24;
      });
    for (const edge of edges) {
      const sigma = edge.sealed ? SEALED_RIDGE_SIGMA : RIDGE_SIGMA;
      // both flanks of the wall, both the old and the new window radius
      for (const side of [-1, 1]) {
        for (const cut of [sigma * 3, sigma * 4]) {
          const line = edge.at + side * cut;
          const lo = edge.lo - 20;
          const hi = edge.hi + 20;
          let eligible = 0;
          let steep = 0;
          for (let along = lo; along <= hi; along += 3) {
            const a =
              edge.kind === 'h' ? [along, line - TICK_RUN / 2] : [line - TICK_RUN / 2, along];
            const b =
              edge.kind === 'h' ? [along, line + TICK_RUN / 2] : [line + TICK_RUN / 2, along];
            if (!inStripCountry(a[0], a[1]) || !inStripCountry(b[0], b[1])) continue;
            if (onAnotherWall(a[0], a[1], edge) || onAnotherWall(b[0], b[1], edge)) continue;
            eligible++;
            const rise = Math.abs(groundHeight(b[0], b[1], SEED) - groundHeight(a[0], a[1], SEED));
            if (rise / TICK_RUN > PLAYER_MAX_CLIMB_SLOPE) steep++;
          }
          // the cutoff-line bug refused the step at essentially every
          // eligible position; organic crag crossings measure a few percent
          if (eligible >= 20 && steep / eligible > 0.2) {
            offenders.push(
              `${edge.kind}@${edge.at} cut ${side * cut}: ${steep}/${eligible} steep along the line`,
            );
          }
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('the reported Thornpeak line at x = -102 is walkable again', () => {
    // The exact repro line: walking west across x = -102 along the zone. The
    // bug was a coherent invisible cliff spanning the WHOLE line (the 3 sigma
    // cutoff of the x = -180 edge); Thornpeak's craggy uplands now cross it
    // with real, visible rock at scattered points, so the pin is that no
    // wall-like fraction of the line refuses the step.
    let steep = 0;
    let total = 0;
    for (let z = 560; z <= 890; z += 2) {
      const east = groundHeight(-101.9, z, SEED);
      const west = groundHeight(-102.1, z, SEED);
      const slope = Math.abs(west - east) / 0.2;
      total++;
      if (slope > PLAYER_MAX_CLIMB_SLOPE) steep++;
    }
    expect(steep / total, `${steep}/${total} steep steps across x=-102`).toBeLessThanOrEqual(0.2);
  });
});
