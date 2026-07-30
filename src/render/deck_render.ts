// The shared plank-walkway builder: turns a list of GaleDeckDef rectangles
// (the raised-ground surfaces world.ts groundHeight walks) into plank and
// post geometry: level runs as long plank courses on stilts, steep
// two-anchor ramps as stepped stair treads, handrails on the stairs (and,
// when railAll is set, along every deck edge: the bridge-and-pier look).
// Rails stop short where two decks of the batch join (deckRailRuns), so a
// walkway the decks share never ends up fenced off across its mouth.
// Callers merge the returned arrays with their own materials, so the
// harbor and the jungle walkways each keep their own wood tones. Extracted
// from render/gale_features.ts when the Palmreach walkways became the
// second consumer.
import * as THREE from 'three';
import { type GaleDeckDef, galeDeckSurfaceAt } from '../sim/gale_harbor';

// a box beam from p0 to p1 (long axis along the run, yaw/pitch aligned)
export function beamBetween(
  parts: THREE.BufferGeometry[],
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  w: number,
  h: number,
): void {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const dz = p1.z - p0.z;
  const lenH = Math.hypot(dx, dz);
  const len = Math.hypot(lenH, dy);
  if (len < 1e-4) return;
  const g = new THREE.BoxGeometry(w, h, len + w * 0.6);
  g.rotateX(-Math.atan2(dy, lenH));
  g.rotateY(Math.atan2(dx, dz));
  g.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
  parts.push(g.toNonIndexed());
}

export interface DeckWood {
  planks: THREE.BufferGeometry[];
  posts: THREE.BufferGeometry[];
}

/** One rail post position along a deck edge (`along` re-samples its height). */
export interface DeckRailPoint {
  x: number;
  z: number;
  along: number;
}

/**
 * A rail point this close to another deck's walkable rectangle counts as
 * standing in the junction. Decks that join share an anchor and overlap only
 * roughly, so the neighbour's rail can sit a little OUTSIDE the rectangle and
 * still fence its mouth (at the Palmreach lagoon T the boardwalk's far-side
 * rail misses the pier rect by 0.38).
 */
const RAIL_JUNCTION_MARGIN = 0.55;

/** Point inside a deck's walkable rectangle (rotated rect), grown by `margin`. */
function deckContains(deck: GaleDeckDef, x: number, z: number, margin: number): boolean {
  const dx = x - deck.x;
  const dz = z - deck.z;
  const dirx = Math.sin(deck.rot);
  const dirz = Math.cos(deck.rot);
  const along = dx * dirx + dz * dirz;
  const across = dx * dirz - dz * dirx;
  return Math.abs(along) <= deck.hl + margin && Math.abs(across) <= deck.hw + margin;
}

/**
 * The rail post positions along one edge of `deck`, split into runs.
 *
 * Decks meet flush by design (a pier off a boardwalk, a stair into the deck it
 * climbs to), so an edge run laid over the deck's whole length walls off the
 * walkway they share. A point standing on ANOTHER deck of the same batch is
 * dropped and ENDS its run, so the rail bars stop at the junction instead of
 * stretching across the gap. Pure and cheap: batches are a handful of decks.
 */
export function deckRailRuns(
  deck: GaleDeckDef,
  side: number,
  batch: readonly GaleDeckDef[],
): DeckRailPoint[][] {
  const dirx = Math.sin(deck.rot);
  const dirz = Math.cos(deck.rot);
  const pxu = dirz; // unit across (perp) axis
  const pzu = -dirx;
  const runs: DeckRailPoint[][] = [];
  let run: DeckRailPoint[] = [];
  for (let along = -deck.hl + 0.4; along <= deck.hl - 0.2; along += 1.4) {
    const x = deck.x + dirx * along + pxu * (deck.hw - 0.12) * side;
    const z = deck.z + dirz * along + pzu * (deck.hw - 0.12) * side;
    const junction = batch.some(
      (other) => other !== deck && deckContains(other, x, z, RAIL_JUNCTION_MARGIN),
    );
    if (junction) {
      if (run.length > 0) runs.push(run);
      run = [];
      continue;
    }
    run.push({ x, z, along });
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

export function buildDeckWood(
  decks: readonly GaleDeckDef[],
  terrain: (x: number, z: number) => number,
  waterLevel: number,
  opts: { railAll?: boolean; bollards?: boolean } = {},
): DeckWood {
  const planks: THREE.BufferGeometry[] = [];
  const posts: THREE.BufferGeometry[] = [];
  for (const d of decks) {
    const dirx = Math.sin(d.rot);
    const dirz = Math.cos(d.rot);
    const pxu = dirz; // unit across (perp) axis
    const pzu = -dirx;
    const yAt = (along: number): number => galeDeckSurfaceAt(d, along, terrain, waterLevel);
    const ramp = Math.atan2(yAt(d.hl) - yAt(-d.hl), d.hl * 2);
    const stair = Math.abs(ramp) > 0.25;
    // plank courses laid across the walking direction; a steep ramp is
    // drawn as stepped stair treads instead, each flat at its own height
    const step = stair ? 0.55 : 1.05;
    for (let along = -d.hl + step / 2; along < d.hl; along += step) {
      const cx = d.x + dirx * along;
      const cz = d.z + dirz * along;
      const g = new THREE.BoxGeometry(d.hw * 2, stair ? 0.2 : 0.16, stair ? 0.62 : 0.88);
      if (!stair) g.rotateX(-ramp);
      g.rotateY(d.rot);
      g.translate(cx, yAt(along) - 0.08, cz);
      planks.push(g.toNonIndexed());
    }
    // side beams along both edges, and stilt posts marching to the seabed
    for (const side of [1, -1]) {
      const ex = pxu * (d.hw - 0.14) * side;
      const ez = pzu * (d.hw - 0.14) * side;
      beamBetween(
        planks,
        new THREE.Vector3(d.x - dirx * d.hl + ex, yAt(-d.hl) + 0.06, d.z - dirz * d.hl + ez),
        new THREE.Vector3(d.x + dirx * d.hl + ex, yAt(d.hl) + 0.06, d.z + dirz * d.hl + ez),
        0.24,
        0.2,
      );
      for (let along = -d.hl + 1.0; along < d.hl; along += 2.2) {
        const px = d.x + dirx * along + pxu * (d.hw - 0.3) * side;
        const pz = d.z + dirz * along + pzu * (d.hw - 0.3) * side;
        const top = yAt(along) - 0.05;
        const bed = Math.min(terrain(px, pz), top - 0.4);
        const g = new THREE.BoxGeometry(0.3, top - bed + 0.4, 0.3);
        g.translate(px, (top + bed - 0.4) / 2 + 0.2, pz);
        posts.push(g.toNonIndexed());
      }
      // stairs always get a handrail; railAll rails the level runs too. Runs
      // break where another deck of the batch joins, so no rail fences off a
      // shared walkway (the lagoon T, the pool stair, the harbor stair feet).
      if (stair || opts.railAll) {
        for (const run of deckRailRuns(d, side, decks)) {
          const railPts = run.map((p) => new THREE.Vector3(p.x, yAt(p.along), p.z));
          for (const pt of railPts) {
            const g = new THREE.BoxGeometry(0.14, 1.06, 0.14);
            g.translate(pt.x, pt.y + 0.5, pt.z);
            posts.push(g.toNonIndexed());
          }
          for (let i = 0; i + 1 < railPts.length; i++) {
            for (const lift of [0.98, 0.54]) {
              beamBetween(
                posts,
                new THREE.Vector3(railPts[i].x, railPts[i].y + lift, railPts[i].z),
                new THREE.Vector3(railPts[i + 1].x, railPts[i + 1].y + lift, railPts[i + 1].z),
                0.08,
                0.1,
              );
            }
          }
        }
      }
    }
    // mooring bollards on the two tip corners of each pier
    if (opts.bollards) {
      for (const side of [1, -1]) {
        const bx = d.x + dirx * (d.hl - 0.5) + pxu * (d.hw - 0.35) * side;
        const bz = d.z + dirz * (d.hl - 0.5) + pzu * (d.hw - 0.35) * side;
        const g = new THREE.BoxGeometry(0.26, 0.72, 0.26);
        g.translate(bx, yAt(d.hl - 0.5) + 0.3, bz);
        posts.push(g.toNonIndexed());
      }
    }
  }
  return { planks, posts };
}
