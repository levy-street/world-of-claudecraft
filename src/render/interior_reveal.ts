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
  /** Keep every storey group (G_H1 / G_H3) visible whenever the player is
   *  inside: only the roof (G_H2) hides. For a building whose floors carry
   *  their own always-visible ceilings, hiding the storey above buys the
   *  camera nothing and only makes that floor's furniture pop in when the
   *  player arrives on it (SPACEY, 2026-09-11: "the assets on the floors
   *  should always load when the player is in the castle"). */
  keepStoreys?: boolean;
  /** The model has no G_H2 group: its whole outer shell is one mesh (see
   *  isRevealShellName), and that shell is what hides. For the hand-built
   *  harbour lots, whose room is a mesh of its own under the shell. */
  shell?: boolean;
}

export const INTERIOR_BUILDINGS: Readonly<Record<string, InteriorSpec>> = {
  '/models/tidehold/tavern.glb': {
    // bl_town.py (the town kit): measured from its sidecar on install
    volumes: [{ x0: -10.3, x1: 10.3, y0: 0, y1: 16.05, z0: -7.5, z1: 7.5 }],
    storeySplit: 5.55,
  },
  '/models/tidehold/tavern_b.glb': {
    // bl_town.py (the town kit): measured from its sidecar on install
    volumes: [{ x0: -13.3, x1: 13.3, y0: 0, y1: 17.05, z0: -8.5, z1: 8.5 }],
    storeySplit: 5.55,
  },
  '/models/tidehold/bank.glb': {
    // bl_town.py (the town kit): measured from its sidecar on install
    volumes: [{ x0: -9.9, x1: 9.9, y0: 0, y1: 15.65, z0: -6.55, z1: 6.55 }],
    storeySplit: 5.7,
  },
  '/models/tidehold/market.glb': {
    // bl_town.py (the town kit): measured from its sidecar on install
    volumes: [{ x0: -16.5, x1: 16.5, y0: 0, y1: 22.5, z0: -15.2, z1: 10 }],
  },
  '/models/tidehold/shop_a.glb': {
    // bl_town.py (the town kit): measured from its sidecar on install
    volumes: [{ x0: -5.8, x1: 5.8, y0: 0, y1: 13.45, z0: -5.15, z1: 4.5 }],
    storeySplit: 4.5,
  },
  '/models/tidehold/shop_b.glb': {
    // bl_town.py (the town kit): measured from its sidecar on install
    volumes: [{ x0: -5.55, x1: 5, y0: 0, y1: 13.85, z0: -4.8, z1: 4.8 }],
    storeySplit: 4.5,
  },
  '/models/tidehold/smithy.glb': {
    // bl_town.py (the town kit): measured from its sidecar on install
    volumes: [
      { x0: -5.8, x1: 5.8, y0: 0, y1: 10.05, z0: -4.8, z1: 4.8 },
      { x0: 5.5, x1: 13.3, y0: 0, y1: 6.85, z0: -5.5, z1: 5.3 },
    ],
  },
  // NOT registered on purpose: tidehold/castle.glb. Its "roof" (G_H2) is the
  // walkable battlement TERRACE, so hiding it from inside would strip the great
  // hall's ceiling and open the keep to the sky, a courtyard, not a keep.
  // Castle B: three storeys in the keep (hall, the middle floor = G_H1 at
  // 5 kit, the top floor = G_H3 at 10 kit) and a room upstairs in each
  // wing (G_H1). The splits sit at the storey lines (6.75 and 13.5 yd).
  '/models/tidehold/castle_b.glb': {
    volumes: [
      { x0: -17.55, x1: 17.55, y0: 0, y1: 20.25, z0: 2.7, z1: 21.6 },
      { x0: 17.55, x1: 33.75, y0: 0, y1: 6.75, z0: 2.7, z1: 16.2 },
      { x0: -33.75, x1: -17.55, y0: 0, y1: 6.75, z0: 2.7, z1: 16.2 },
    ],
    storeySplit: 6.3, // a hair under the floors (6.86 / 13.6 model yd where the body stands)
    storeySplit2: 13.0,
    keepStoreys: true, // the keep has real ceilings; every floor's furniture stays loaded inside
  },
  // NOT registered on purpose: tidehold/hall.glb (the church, bl_town.py). Its
  // eaves stand 9 yd up, so the chase camera stays under the roof; hiding G_H2
  // would only strip the open timber trusses and leave the chandeliers hanging
  // in the sky. Same reason as the castle above.
};

// The hand-built harbour lots (scripts/assets/eastbrook_houses/lots.py), which every
// town stands in its own colour set (/models/tidehold/harbour, harbour_moss, ...). A set
// re-paints the same geometry, so one row per model serves them all. Each lot is two
// meshes: the outer shell (walls, upper storey and roof in one piece) and the room with
// its furniture, whose faces all look inward. From inside, hiding the shell alone opens
// the room to the camera, the dollhouse the G_H2 convention gives the older models.
// A volume is the lot's room in the model's own yards (build.py writes each lot's room to
// tmp/eastbrook_houses/lots.json as its first air box), from the ground line to the
// ceiling. Not registered, for the reasons given above for the models they replace: the
// chapel (`hall`: the camera stays under its nine yard ceiling) and the cottages, which
// are sealed; nor the guild hall, which never had a reveal.
const HARBOUR_LOT = /^\/models\/tidehold\/harbour(?:_[a-z]+)?\/([a-z_]+)\.glb$/;
const HARBOUR_INTERIORS: Readonly<Record<string, InteriorSpec>> = {
  tavern: { shell: true, volumes: [{ x0: -9.35, x1: 9.35, y0: 0, y1: 5.25, z0: -5.85, z1: 5.85 }] },
  tavern_b: {
    shell: true,
    volumes: [{ x0: -12.35, x1: 12.35, y0: 0, y1: 5.25, z0: -6.85, z1: 6.85 }],
  },
  bank: { shell: true, volumes: [{ x0: -8.35, x1: 8.35, y0: 0, y1: 5.45, z0: -5.6, z1: 5.6 }] },
  shop_a: { shell: true, volumes: [{ x0: -4.85, x1: 4.85, y0: 0, y1: 4.25, z0: -3.55, z1: 3.55 }] },
  shop_b: { shell: true, volumes: [{ x0: -4.05, x1: 4.05, y0: 0, y1: 4.25, z0: -3.85, z1: 3.85 }] },
  smithy: { shell: true, volumes: [{ x0: -4.85, x1: 4.85, y0: 0, y1: 4.85, z0: -3.85, z1: 3.85 }] },
};

export function interiorSpecFor(path: string): InteriorSpec | null {
  const listed = INTERIOR_BUILDINGS[path];
  if (listed) return listed;
  const lot = HARBOUR_LOT.exec(path);
  return (lot && HARBOUR_INTERIORS[lot[1]]) || null;
}

/** Whether a node is a lot's outer shell: the kit names it `<model>_L0` and the room
 *  `<model>_INT_L0` (scripts/assets/eastbrook_houses/kit.py finish). */
export function isRevealShellName(name: string): boolean {
  return /_L0$/.test(name) && !/_INT_L0$/.test(name);
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
