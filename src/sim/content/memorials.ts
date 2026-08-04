// Interactable war memorials. One record per monument; the active WorldContent
// supplies the list, the Sim spawns each as an interactable object entity (the
// mailbox/noticeboard pattern), and the client resolves the plaque from this
// same data so the roll never has to cross the wire.
//
// The stone itself carries only the dedication. The roll of honour lives here
// because a Roll of Honour has to stay legible and translatable, which baked
// lettering on a 7 yard column cannot be.

import type { HeightStamp, MemorialDef } from '../types';

export type { MemorialDef, MemorialRollEntry } from '../types';

// Gullhaven's memorial, on the berm crest north of the redoubt. Every warden
// listed carried a seal into the Breach and did not come back out; the roll
// runs oldest first, so J T Hale is last and newest. The Q0 line is the
// canon this has to satisfy: "The newest name on the plinth is a century old:
// WARDEN HALE. There is room below it for more." Nothing is added after Hale,
// and the plaque leaves the space after him visibly empty.
//
// None of these surnames may collide with a living warden (Coalfast, Fenwick,
// Kaldra, Pell) or with the warden-issue gear line (Cudgel, Cuirass, Dirk,
// Grips, Jerkin, Leggings, Sabatons, Treads).
const GULLHAVEN_SEAL_BEARERS = [
  { initials: 'R M', surname: 'Ashgrove' },
  { initials: 'E', surname: 'Brack' },
  { initials: 'H', surname: 'Dunmore' },
  { initials: 'S', surname: 'Vane' },
  { initials: 'A L', surname: 'Tesk' },
  { initials: 'W', surname: 'Orrum' },
  { initials: 'M J', surname: 'Voss' },
  { initials: 'C', surname: 'Rell' },
  { initials: 'D', surname: 'Corrin' },
  { initials: 'P', surname: 'Standish' },
  { initials: 'J', surname: 'Wray' },
  { initials: 'E M', surname: 'Thorne' },
  { initials: 'G', surname: 'Ferrow' },
  { initials: 'N', surname: 'Askell' },
  { initials: 'L', surname: 'Cobb' },
  { initials: 'R', surname: 'Dain' },
  { initials: 'I', surname: 'Mercer' },
  { initials: 'F', surname: 'Nyle' },
  { initials: 'K', surname: 'Bramble' },
  { initials: 'S T', surname: 'Orrick' },
  { initials: 'B', surname: 'Halloran' },
  { initials: 'A', surname: 'Skeld' },
  { initials: 'T W', surname: 'Ravensworth' },
  { initials: 'J T', surname: 'Hale' },
] as const;

export const GULLHAVEN_MEMORIAL = {
  id: 'gullhaven_warden_memorial',
  // The prop's own placement record in farshore.ts; the object entity spawns at
  // the same spot so the interaction prompt sits on the silhouette.
  x: 805,
  z: 139,
  // Generous, because the plinth is 2.8yd across and the player reads the
  // plaque standing at the foot of the steps rather than inside the stone.
  interactionRadius: 6,
  // Front faces +Z (south, inland over the town), matching the prop's rot.
  frontStandingPoint: { x: 805, z: 133 },
  // Comfortably past the terrace and its planting, so the hill has sky
  // behind the bronze from the town below.
  clearingRadius: 21,
  roll: GULLHAVEN_SEAL_BEARERS,
  // The rail ring. Corners sit 4.24 from the plinth, inside the level pad, so
  // every post stands at the same height. Panels are 4.0 long on a 3.0 run
  // spacing, so they overlap rather than gap. The SOUTH run is deliberately
  // open on the axis: that is where the path arrives and where the inscribed
  // face looks. Half-extents are measured off the shipping GLBs
  // (garden_iron_pillar 0.5 square, garden_iron_fence 4.0 x 0.5 x 2.2).
  rail: {
    postHalf: 0.25,
    panelHalfLength: 2,
    panelHalfDepth: 0.25,
    height: 2.2,
    posts: [
      { x: 802, z: 136.6 },
      { x: 808, z: 136.6 },
      { x: 802, z: 142.6 },
      { x: 808, z: 142.6 },
    ],
    panels: [
      { x: 803.5, z: 142.6 },
      { x: 806.5, z: 142.6 },
      { x: 802, z: 138.1, rot: Math.PI / 2 },
      { x: 802, z: 141.1, rot: Math.PI / 2 },
      { x: 808, z: 138.1, rot: Math.PI / 2 },
      { x: 808, z: 141.1, rot: Math.PI / 2 },
    ],
  },
} satisfies MemorialDef;

/**
 * The rail's RENDER placements, derived from the same record colliders.ts
 * reads. Authoring the props by hand beside the collider data is how they
 * drift; deriving both from `def.rail` is why you cannot walk through this
 * fence any more.
 */
export function memorialRailProps(
  def: MemorialDef,
): { key: string; x: number; z: number; rot?: number }[] {
  return [
    ...def.rail.posts.map((p) => ({ key: 'gardenIronPillar', x: p.x, z: p.z })),
    ...def.rail.panels.map((p) => ({
      key: 'gardenIronFence',
      x: p.x,
      z: p.z,
      ...(p.rot === undefined ? {} : { rot: p.rot }),
    })),
  ];
}

export const MEMORIALS: readonly MemorialDef[] = Object.freeze([GULLHAVEN_MEMORIAL]);

// ---------------------------------------------------------------------------
// The memorial grounds: an ANZAC-style precinct rather than a statue on grass.
// ---------------------------------------------------------------------------
//
// Terrain, not props. These are HeightStamps on the same edit layer the jail
// floor and the harbor grading use, so `terrainHeight` carries them and render,
// collision and pathing all see one surface (the render-samples-sim-height
// invariant). Order matters: the array applies in sequence, so the broad swell
// lands first and the level pads cut into it.
//
// Two constraints the numbers answer to. The berm crest reads 9.4 and the town
// pad is a flat 5.5 about 4 yards below, so the climb has to stay inside the
// movement climb gate the way the harbor ramp pockets do: the approach gains
// roughly 1.1 yards per 3 of run, a walkable grade rather than a step. And the
// swell is kept to radius 17 so its skirt dies out around z 122, clear of the
// market and the harbor steps; at smooth falloff the rim contribution is
// already near zero well before that.
export const MEMORIAL_TERRAIN_EDITS: readonly HeightStamp[] = Object.freeze([
  // The mound. Assertive on purpose: the first pass raised 1.3 over a 17 yard
  // radius, which measured fine and was invisible on screen.
  { x: 805, z: 139.5, radius: 13, delta: 2.8, falloff: 'smooth', mode: 'add' },
  // A wider apron so the hill has a foot instead of a rim.
  { x: 805, z: 139.5, radius: 22, delta: 0.9, falloff: 'smooth', mode: 'add' },

  // Pad radius 8, not 5: narrow pads cut the ramp INTO the hillside and left
  // 1.30 side slopes at its foot, which is why circling the shrine felt like it
  // got steep too fast. Wide overlapping pads blend the ramp into the flank
  // instead, taking the worst radial grade anywhere on the mound to 0.97 and
  // the worst grade walking a ring around the shrine to 0.39.
  // The approach CONTOURS the mound's west flank, then turns and runs the last
  // stretch STRAIGHT UP THE AXIS (x=805) into the terrace: an informal climb
  // then a formal axial arrival, so you walk in facing the inscribed face
  // square-on. The last two pads reach the terrace height BEFORE the flat
  // terrace pass begins, which is what keeps the path from running into the
  // terrace's own edge as a wall.
  { x: 807.0, z: 123.0, radius: 8, delta: 6.0, falloff: 'smooth', mode: 'level' },
  { x: 801.0, z: 124.5, radius: 8, delta: 6.8, falloff: 'smooth', mode: 'level' },
  { x: 797.0, z: 127.5, radius: 8, delta: 7.6, falloff: 'smooth', mode: 'level' },
  { x: 795.5, z: 131.0, radius: 8, delta: 8.4, falloff: 'smooth', mode: 'level' },
  { x: 797.5, z: 134.0, radius: 8, delta: 9.2, falloff: 'smooth', mode: 'level' },
  { x: 800.5, z: 130.5, radius: 8, delta: 9.7, falloff: 'smooth', mode: 'level' },
  { x: 803.0, z: 129.5, radius: 8, delta: 10.1, falloff: 'smooth', mode: 'level' },
  { x: 805.0, z: 130.5, radius: 8, delta: 10.4, falloff: 'smooth', mode: 'level' },

  // The terrace, in three concentric passes. A `smooth` level alone only
  // reaches its target AT the centre and tapers away, which domed the pad and
  // left the rail posts at six different heights; but a lone WIDE `flat` pass
  // instead produced a 3.9 yard grass cliff at its rim, an unclimbable
  // invisible wall. So: a broad smooth pass lifts the surround, a mid pass
  // narrows the gap, and the inner flat pass makes the precinct dead level.
  // Each transition is then a walkable step rather than a wall.
  // Radius 22, not wider: at 26 the outer grading reached Gullhaven and
  // lifted the town's flat 5.500 pad to 5.580.
  { x: 805, z: 139.5, radius: 22, delta: 8.6, falloff: 'smooth', mode: 'level' },
  { x: 805, z: 139.5, radius: 17, delta: 10.4, falloff: 'smooth', mode: 'level' },
  // The precinct itself, and ONLY the precinct. Sized to the rail ring and no
  // wider: every earlier attempt to flatten further out built a grass cliff at
  // the pad's rim (3.9 yards, then 4.6), because the mound falls to the sea on
  // the north and east and a flat pass has a hard edge. The dome above is
  // walkable everywhere on its own; this pad only takes the last half-yard of
  // crown out of the terrace so the footing and the rail posts sit level.
  { x: 805, z: 139.6, radius: 5.8, delta: 10.4, falloff: 'flat', mode: 'level' },
] as HeightStamp[]);
