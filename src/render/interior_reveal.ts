// Interior reveal for the explorable Tidehold buildings (WoW-style): when the
// player steps inside one, its roof group hides, and on the ground floor of a
// two-storey building the upper storey hides too, so the camera can see the
// room. The buildings are Blender-assembled GLBs whose scene graph carries the
// convention: children of a node named G_H1 are the SECOND STOREY (floor,
// walls, furniture), children of G_H2 are the ROOF. Everything else is the
// ground-floor shell and never hides.
//
// Volumes here are in RAW model yards (the GLB's own units, glTF axes): the
// loader's normalization and the placement scale both live on the clone's
// transform, so testing the player against `model.matrixWorld.invert()` lands
// in exactly this space. Data source: the assembly scripts' collision JSON
// (scratchpad bl_*.py -> *.collision.json `interiors`), kept in sync by hand
// when a building is re-exported.

export interface InteriorVolume {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

export interface InteriorSpec {
  volumes: readonly InteriorVolume[];
  /** Model-space Y separating the ground storey from the upper one. Below it
   *  both H1 and H2 hide; at or above it only the roof (H2) hides. Absent =
   *  single-volume building, only H2 ever hides. */
  storeySplit?: number;
  /** A THIRD storey (children of G_H3): hidden below this model-space Y,
   *  i.e. in states 1 and 2; shown at or above it (state 3). */
  storeySplit2?: number;
}

export const INTERIOR_BUILDINGS: Readonly<Record<string, InteriorSpec>> = {
  '/models/tidehold/tavern.glb': {
    // 12.5 x 10 kit footprint at S=1.85: half 11.56 x 9.25, ridge at 22.1.
    volumes: [{ x0: -11.8, x1: 11.8, y0: 0, y1: 22.5, z0: -9.5, z1: 9.5 }],
    storeySplit: 5.65,
  },
  '/models/tidehold/tavern_b.glb': {
    // 17.5 x 10 hall plus a 7.5 x 2.5 cross wing at S=1.85; the common room is
    // open to the ridge, so one volume covers both storeys and the gallery.
    volumes: [
      { x0: -23.4, x1: 23.4, y0: 0, y1: 25.2, z0: -14.2, z1: 14.2 },
      { x0: -7.1, x1: 7.1, y0: 0, y1: 19.0, z0: -18.9, z1: -13.6 },
    ],
    storeySplit: 5.7,
  },
  '/models/tidehold/bank.glb': {
    volumes: [{ x0: -8.9, x1: 8.9, y0: 0, y1: 9.25, z0: -6.6, z1: 6.6 }],
  },
  '/models/tidehold/market.glb': {
    volumes: [{ x0: -14.6, x1: 14.6, y0: 0, y1: 6.1, z0: -8.85, z1: 8.85 }],
  },
  '/models/tidehold/smithy.glb': {
    volumes: [
      { x0: -6.4, x1: 6.4, y0: 0, y1: 5.5, z0: -6.4, z1: 6.4 },
      { x0: 6.4, x1: 13.0, y0: 0, y1: 5.5, z0: -6.75, z1: 6.75 },
    ],
  },
  // NOT registered on purpose: tidehold/castle.glb. Its "roof" (G_H2) is the
  // walkable battlement TERRACE, so hiding it from inside would strip the great
  // hall's ceiling and open the keep to the sky, a courtyard, not a keep. The
  // hall is lit by its own braziers instead (fireEffects in citadel.ts).
  // Castle B: three storeys in the keep (hall, the middle floor = G_H1 at
  // 5 kit, the Warden's floor = G_H3 at 10 kit) and a room upstairs in each
  // wing (G_H1). The splits sit at the storey lines (6.75 and 13.5 yd).
  '/models/tidehold/castle_b.glb': {
    volumes: [
      { x0: -17.55, x1: 17.55, y0: 0, y1: 20.25, z0: 2.7, z1: 21.6 },
      { x0: 17.55, x1: 33.75, y0: 0, y1: 6.75, z0: 2.7, z1: 16.2 },
      { x0: -33.75, x1: -17.55, y0: 0, y1: 6.75, z0: 2.7, z1: 16.2 },
    ],
    storeySplit: 6.3, // a hair under the floors (6.86 / 13.6 model yd where the body stands)
    storeySplit2: 13.0,
  },
  '/models/tidehold/hall.glb': {
    volumes: [{ x0: -9.6, x1: 9.6, y0: 0, y1: 20, z0: -14.6, z1: 14.6 }],
  },
};

export function interiorSpecFor(path: string): InteriorSpec | null {
  return INTERIOR_BUILDINGS[path] ?? null;
}

/** 0 = outside, 1 = inside on the ground storey, 2 = inside above the split,
 *  3 = inside above the second split (a three-storey building's top floor). */
export function revealState(spec: InteriorSpec, x: number, y: number, z: number): 0 | 1 | 2 | 3 {
  for (const v of spec.volumes) {
    if (x < v.x0 || x > v.x1 || z < v.z0 || z > v.z1 || y < v.y0 - 0.5 || y > v.y1) continue;
    if (spec.storeySplit2 !== undefined && y >= spec.storeySplit2) return 3;
    if (spec.storeySplit !== undefined && y >= spec.storeySplit) return 2;
    return 1;
  }
  return 0;
}
