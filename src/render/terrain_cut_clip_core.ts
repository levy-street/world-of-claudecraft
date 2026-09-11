// The FINE edge of a boolean terrain cut: instead of dropping whole mesher
// quads (which left multi-yard "jaggy boxes" at coarse LOD spacings), the
// cells the cut contour crosses are re-tessellated on a sub-grid and CLIPPED
// against the same surface field the rim band walks, so the opening's edge is
// the smooth marching-squares contour itself at any chunk spacing.
//
// Pure arithmetic over plain typed arrays (no Three, no DOM), the same
// contract as terrain_cut_rim_core.ts, so it runs in the chunk worker beside
// the mesher. The caller supplies the field and the CHORD height (bilinear on
// the chunk's own corner lattice, i.e. the surface the coarse mesh actually
// renders), which keeps the clipped patch, the kept quads around it and the
// rim band all landing on one surface with no cracks by construction.
//
// Crossing interpolation reuses the rim core's own lerp (same SNAP_EPS, same
// clamping), so the rim wall's top edge and the clipped surface edge are the
// SAME point list, the wall meets the ground watertight.

import { buildCutRim, type CutRimArrays, lerpEdge } from './terrain_cut_rim_core';

export interface CutClipInput {
  /** Chunk grid origin (world yards) of interior cell (0,0). */
  x0: number;
  z0: number;
  /** Interior cell counts and spacing of the coarse chunk grid. */
  nx: number;
  nz: number;
  stepX: number;
  stepZ: number;
  /** Cell window the cuts can reach, in interior cell indices (inclusive). */
  ci0: number;
  cj0: number;
  ci1: number;
  cj1: number;
  /** Subdivisions per coarse cell for the clipped patch (>= 1). */
  sub: number;
  /** How far the rim band hangs below the surface, yards. */
  rimDepth: number;
  /** Per-segment rim depth override (see terrain_cut_rim_core depthAt):
   *  carve-owned contour stretches shorten their skirt to a lip. */
  rimDepthAt?(x: number, z: number): number;
  /** Coarse corner height (the mesh's own vertex heights), ci in [0..nx]. */
  cornerHeightAt(ci: number, cj: number): number;
  /** The cut field at a 3D point: negative inside the opening. */
  fieldAt(x: number, y: number, z: number): number;
}

/** The clipped surface patch, positions only, the caller interpolates the
 *  chunk's own vertex attributes over it. */
export interface CutClipSurf {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface CutClipResult {
  /** Per cell of the window (width = ci1-ci0+1): 0 keep, 1 drop, 2 clipped. */
  kinds: Uint8Array;
  surf: CutClipSurf | null;
  rim: CutRimArrays | null;
}

export const CUT_CELL_KEEP = 0;
export const CUT_CELL_DROP = 1;
export const CUT_CELL_CLIP = 2;

/**
 * Classify the window's cells against the surface field and build the clipped
 * boundary patch plus the fine rim band. Returns null when no cell of the
 * window is touched at all (the cuts never reach this chunk's surface).
 */
export function buildCutClip(input: CutClipInput): CutClipResult | null {
  const { x0, z0, nx, nz, stepX, stepZ, ci0, cj0, ci1, cj1, sub } = input;
  const cw = ci1 - ci0 + 1;
  const ch = cj1 - cj0 + 1;
  if (cw < 1 || ch < 1 || sub < 1) return null;

  // Chord height: bilinear over the coarse corner lattice, clamped to the
  // interior. This is exactly the surface the coarse quads render.
  const chordHeight = (x: number, z: number): number => {
    const fx = Math.max(0, Math.min(nx - 1e-9, (x - x0) / stepX));
    const fz = Math.max(0, Math.min(nz - 1e-9, (z - z0) / stepZ));
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const h00 = input.cornerHeightAt(i, j);
    const h10 = input.cornerHeightAt(i + 1, j);
    const h01 = input.cornerHeightAt(i, j + 1);
    const h11 = input.cornerHeightAt(i + 1, j + 1);
    return h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
  };
  const surfField = (x: number, z: number): number => input.fieldAt(x, chordHeight(x, z), z);

  // The window's fine lattice, sampled once and shared by the classification,
  // the clip and the rim walk. Fine index fi in [0 .. cw*sub], fj likewise.
  const fw = cw * sub + 1;
  const fh = ch * sub + 1;
  const fineStepX = stepX / sub;
  const fineStepZ = stepZ / sub;
  const wx0 = x0 + ci0 * stepX;
  const wz0 = z0 + cj0 * stepZ;
  const fine = new Float32Array(fw * fh);
  let anyIn = false;
  for (let fj = 0; fj < fh; fj++) {
    const z = wz0 + fj * fineStepZ;
    for (let fi = 0; fi < fw; fi++) {
      const v = surfField(wx0 + fi * fineStepX, z);
      fine[fj * fw + fi] = v;
      if (v < 0) anyIn = true;
    }
  }
  if (!anyIn) return null;

  // Classify each coarse cell of the window on its own (sub+1)^2 fine corners:
  // every corner inside = drop, none = keep, mixed = clip. A keep cell whose
  // interior still dips inside (a cut smaller than a fine cell) is caught by
  // the fine sampling above at sub >= 1 plus the centre bias of the walk; at
  // sub 1 the cell corners ARE the coarse corners, so add a centre probe.
  const kinds = new Uint8Array(cw * ch);
  let anyClip = false;
  for (let cj = 0; cj < ch; cj++) {
    for (let ci = 0; ci < cw; ci++) {
      let inCount = 0;
      const total = (sub + 1) * (sub + 1);
      for (let sj = 0; sj <= sub; sj++) {
        for (let si = 0; si <= sub; si++) {
          if (fine[(cj * sub + sj) * fw + ci * sub + si] < 0) inCount++;
        }
      }
      if (inCount === total) {
        kinds[cj * cw + ci] = CUT_CELL_DROP;
        continue;
      }
      if (inCount === 0) {
        if (sub === 1) {
          // Centre probe: a cut narrower than the cell must still open it.
          const cx = wx0 + (ci + 0.5) * stepX;
          const cz = wz0 + (cj + 0.5) * stepZ;
          if (surfField(cx, cz) < 0) {
            kinds[cj * cw + ci] = CUT_CELL_CLIP;
            anyClip = true;
          }
        }
        continue;
      }
      kinds[cj * cw + ci] = CUT_CELL_CLIP;
      anyClip = true;
    }
  }

  // ---- the clipped surface patch over every CLIP cell ----------------------
  let surf: CutClipSurf | null = null;
  if (anyClip) {
    const positions: number[] = [];
    const indices: number[] = [];
    // Shared vertices across sub-cells, keyed on the fine lattice: corners by
    // their fine index, crossings by the fine edge they sit on. One vertex per
    // key keeps neighbouring sub-cells agreeing exactly.
    const verts = new Map<number, number>();
    const cornerVert = (fi: number, fj: number): number => {
      const key = (fj * fw + fi) * 3;
      const found = verts.get(key);
      if (found !== undefined) return found;
      const x = wx0 + fi * fineStepX;
      const z = wz0 + fj * fineStepZ;
      const vi = positions.length / 3;
      positions.push(x, chordHeight(x, z), z);
      verts.set(key, vi);
      return vi;
    };
    // Edge id: horizontal (along +x) = 1, vertical (along +z) = 2, from the
    // edge's low corner (fi, fj).
    const crossVert = (fi: number, fj: number, horizontal: boolean): number => {
      const key = (fj * fw + fi) * 3 + (horizontal ? 1 : 2);
      const found = verts.get(key);
      if (found !== undefined) return found;
      const ax = wx0 + fi * fineStepX;
      const az = wz0 + fj * fineStepZ;
      const bx = horizontal ? ax + fineStepX : ax;
      const bz = horizontal ? az : az + fineStepZ;
      const av = fine[fj * fw + fi];
      const bv = horizontal ? fine[fj * fw + fi + 1] : fine[(fj + 1) * fw + fi];
      const [px, pz] = lerpEdge(ax, az, av, bx, bz, bv);
      const vi = positions.length / 3;
      positions.push(px, chordHeight(px, pz), pz);
      verts.set(key, vi);
      return vi;
    };
    const fan = (poly: number[]): void => {
      for (let k = 1; k + 1 < poly.length; k++) {
        indices.push(poly[0], poly[k], poly[k + 1]);
      }
    };
    for (let cj = 0; cj < ch; cj++) {
      for (let ci = 0; ci < cw; ci++) {
        if (kinds[cj * cw + ci] !== CUT_CELL_CLIP) continue;
        for (let sj = 0; sj < sub; sj++) {
          for (let si = 0; si < sub; si++) {
            const fi = ci * sub + si;
            const fj = cj * sub + sj;
            const v00 = fine[fj * fw + fi];
            const v10 = fine[fj * fw + fi + 1];
            const v01 = fine[(fj + 1) * fw + fi];
            const v11 = fine[(fj + 1) * fw + fi + 1];
            const in00 = v00 < 0;
            const in10 = v10 < 0;
            const in01 = v01 < 0;
            const in11 = v11 < 0;
            const inCount = (in00 ? 1 : 0) + (in10 ? 1 : 0) + (in01 ? 1 : 0) + (in11 ? 1 : 0);
            if (inCount === 4) continue;
            if (inCount === 0) {
              // Whole sub-quad survives. Same +y winding as the mesher.
              const a = cornerVert(fi, fj);
              const b = cornerVert(fi + 1, fj);
              const c = cornerVert(fi, fj + 1);
              const d = cornerVert(fi + 1, fj + 1);
              indices.push(a, c, b, b, c, d);
              continue;
            }
            // Saddle (two opposite corners inside): the centre decides whether
            // the outside stays connected through the middle.
            const saddle = inCount === 2 && in00 === in11 && in10 === in01 && in00 !== in10;
            if (saddle) {
              const cx = wx0 + (fi + 0.5) * fineStepX;
              const cz = wz0 + (fj + 0.5) * fineStepZ;
              const centreOut = surfField(cx, cz) >= 0;
              const e0 = crossVert(fi, fj, false); // c0-c1 (west edge)
              const e1 = crossVert(fi, fj + 1, true); // c1-c2 (north edge)
              const e2 = crossVert(fi + 1, fj, false); // c2-c3 (east edge)
              const e3 = crossVert(fi, fj, true); // c3-c0 (south edge)
              if (in00) {
                // c1=(0,+z) and c3=(+x,0) are outside.
                if (centreOut) fan([cornerVert(fi, fj + 1), e1, cornerVert(fi + 1, fj), e3, e0]);
                else {
                  fan([cornerVert(fi, fj + 1), e1, e0]);
                  fan([cornerVert(fi + 1, fj), e3, e2]);
                }
              } else {
                // c0=(0,0) and c2=(+x,+z) are outside.
                if (centreOut) fan([cornerVert(fi, fj), e0, cornerVert(fi + 1, fj + 1), e2, e3]);
                else {
                  fan([cornerVert(fi, fj), e0, e3]);
                  fan([cornerVert(fi + 1, fj + 1), e2, e1]);
                }
              }
              continue;
            }
            // Walk the corners counter-clockwise seen from above,             // c0=(0,0) -> c1=(0,+z) -> c2=(+x,+z) -> c3=(+x,0), keeping the
            // outside corners and inserting a crossing on every mixed edge.
            const poly: number[] = [];
            const corners = [
              { fi, fj, inside: in00 },
              { fi, fj: fj + 1, inside: in01 },
              { fi: fi + 1, fj: fj + 1, inside: in11 },
              { fi: fi + 1, fj, inside: in10 },
            ];
            const edges: { fi: number; fj: number; horizontal: boolean }[] = [
              { fi, fj, horizontal: false }, // c0-c1, west
              { fi, fj: fj + 1, horizontal: true }, // c1-c2, north
              { fi: fi + 1, fj, horizontal: false }, // c2-c3, east
              { fi, fj, horizontal: true }, // c3-c0, south
            ];
            for (let k = 0; k < 4; k++) {
              const c = corners[k];
              if (!c.inside) poly.push(cornerVert(c.fi, c.fj));
              const n = corners[(k + 1) % 4];
              if (c.inside !== n.inside) {
                const e = edges[k];
                poly.push(crossVert(e.fi, e.fj, e.horizontal));
              }
            }
            if (poly.length >= 3) fan(poly);
          }
        }
      }
    }
    if (indices.length > 0) {
      surf = {
        positions: Float32Array.from(positions),
        indices: Uint32Array.from(indices),
      };
    }
  }

  // ---- the rim band, walked on the SAME fine lattice ------------------------
  // Cached lattice reads for lattice points; off-lattice probes (the band's
  // winding test) fall through to the real field. The wall's top edge sits at
  // the chord surface itself (sinkTop 0): the clipped patch ends exactly on
  // the contour, so the wall must meet it there, not 6cm under it.
  const fieldAt = (x: number, z: number): number => {
    const fi = (x - wx0) / fineStepX;
    const fj = (z - wz0) / fineStepZ;
    const ri = Math.round(fi);
    const rj = Math.round(fj);
    if (
      Math.abs(fi - ri) < 1e-6 &&
      Math.abs(fj - rj) < 1e-6 &&
      ri >= 0 &&
      ri < fw &&
      rj >= 0 &&
      rj < fh
    ) {
      return fine[rj * fw + ri];
    }
    return surfField(x, z);
  };
  const rim = buildCutRim({
    x0: wx0,
    z0: wz0,
    nx: cw * sub,
    nz: ch * sub,
    stepX: fineStepX,
    stepZ: fineStepZ,
    depth: input.rimDepth,
    depthAt: input.rimDepthAt,
    // The clip ends exactly on the contour: only a sliver of lip is needed to
    // cover float disagreement, not the old half-a-coarse-cell ragged edge.
    flare: Math.max(fineStepX, fineStepZ) * 0.5,
    sinkTop: 0,
    heightAt: chordHeight,
    fieldAt,
  });

  return { kinds, surf, rim };
}
