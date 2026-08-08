// Farm patches: the static garden-bed geography for Farming, the fifth
// gathering profession (patches-and-plots phase).
//
// FISHING-SHAPED, NOT NODE-SHAPED (recon-locked): a patch is its own side
// table, never a GatherNodeType, because a node type conscripts every zone
// through the R37 coverage rule and the node placement suites. Patches are
// static content rows like GATHER_NODES (no entity-id churn); what a player
// SEES on a bed is per-player plot state (src/sim/professions/farm_projection.ts),
// the nodeHarvestCooldowns precedent.
//
// One patch per farming hub, four hubs on the farming tier ladder (the D2
// hub list): Eastbrook tier 1, Fenbridge tier 2, Highwatch tier 3, and the
// Evergarden's parterre grounds tier 4 (the showcase; its reachability anchor
// is the zone hub, Hedgewick). The tier column must agree with
// FARMING_ZONE_TIERS (src/sim/professions/farming_zones.ts): the one-ladder
// arm in tests/farm_patch_placement.test.ts pins the agreement, so no other
// module ever hardcodes a farming zone tier.
//
// BED IDS ARE STABLE AND NEVER RENUMBER: plot state is persisted in
// CharacterState keyed by these ids (the shipped-id rule in
// src/sim/content/CLAUDE.md). Retiring a bed means dropping its id forever,
// never reusing it. Bed counts are TIER-SCALED (4/5/6/8): higher-tier hubs
// carry more beds so the showcase garden reads as one, and the per-site count
// is part of the pacing budget, not a balance knob.
//
// Every position must hold the placement arms in
// tests/farm_patch_placement.test.ts (dry land, sea freeboard, water in
// reach, slope, no collider overlap, a reachable stand spot, hub
// reachability, zone containment, bed spacing, node clearance, and the camp,
// road and Sowfield screens): move a bed rather than weaken an arm.
//
// LAYOUT RULE, so the grid stays readable and the arms stay satisfiable: one
// patch is a rectangular grid on a 5 yard pitch, filled row by row from its
// north-west bed, and the patch anchor is the grid's centroid. 5 yards is
// INTERACT_RANGE, the same floor tests/gather_node_placement.test.ts holds two
// gather nodes apart, so neighbouring beds never collapse into one interact
// reach; a wider pitch would only push the site's footprint out into terrain
// the arms then have to clear.
//
// Two of those arms are stricter than the node suite's, and the reason is
// that a farm differs from a gather node in KIND. Beds clear every mob camp
// footprint, not merely the NAMED mobs the node suite screens: a node is a
// few seconds of exposure, so camp overlap is deliberate risk for one, while
// a farm is ground a player stands on over and over, which is why the tier-1
// site moved off the Sableweb webwood entirely rather than accept the same
// risk. And beds clear the roads by the margin world.ts already demands of
// any seated ground object, which is why no site sits on the lane it is
// reached by.

// A bed id is a PERSISTED SAVE KEY: CharacterState.farmPlots is keyed by it,
// and the load-side allowlist DROPS any plot whose bed id is no longer in
// this table. Renaming or renumbering an id, or retiring a bed, silently
// destroys every player's crop on that bed at their next load. Never rename,
// never reuse; retiring one is a deliberate destroy-on-load decision.
export interface FarmBedDef {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

export interface FarmPatchDef {
  readonly id: string;
  readonly zoneId: string;
  readonly tier: 1 | 2 | 3 | 4;
  // The patch anchor: where the site sits as a whole (map pins and the
  // render phase read this); beds carry their own positions.
  readonly x: number;
  readonly z: number;
  readonly beds: readonly FarmBedDef[];
}

const FARM_PATCH_ROWS: readonly FarmPatchDef[] = [
  {
    // The Eastbrook allotments, on the north lane out of town: 37 yards from
    // the hub, past the last cottage and short of the Wolf Run. The obvious
    // farmland west of town is the Sableweb webwood, whose spider camp covers
    // it, so the tutorial site sits north instead where nothing patrols.
    id: 'patch_eastbrook',
    zoneId: 'eastbrook_vale',
    tier: 1,
    x: 18.5,
    z: 32.5,
    beds: [
      { id: 'bed_eastbrook_1', x: 16, z: 30 },
      { id: 'bed_eastbrook_2', x: 21, z: 30 },
      { id: 'bed_eastbrook_3', x: 16, z: 35 },
      { id: 'bed_eastbrook_4', x: 21, z: 35 },
    ],
  },
  {
    // Raised beds on the drained ground south-west of Fenbridge, between the
    // town and the fen proper: the only marsh footprint big enough to hold
    // five beds and their reach without a bed's own working disc reaching
    // standing water.
    id: 'patch_mirefen',
    zoneId: 'mirefen_marsh',
    tier: 2,
    x: -22,
    z: 341,
    beds: [
      { id: 'bed_mirefen_1', x: -26, z: 339 },
      { id: 'bed_mirefen_2', x: -21, z: 339 },
      { id: 'bed_mirefen_3', x: -16, z: 339 },
      { id: 'bed_mirefen_4', x: -26, z: 344 },
      { id: 'bed_mirefen_5', x: -21, z: 344 },
    ],
  },
  {
    // Terraces on the shelf below Highwatch, south-west of the hold. Slope is
    // the binding constraint on this whole mountain, and this shelf is where
    // six beds fit with no cliff anywhere in any bed's working reach.
    id: 'patch_thornpeak',
    zoneId: 'thornpeak_heights',
    tier: 3,
    x: -18,
    z: 687.5,
    beds: [
      { id: 'bed_thornpeak_1', x: -23, z: 685 },
      { id: 'bed_thornpeak_2', x: -18, z: 685 },
      { id: 'bed_thornpeak_3', x: -13, z: 685 },
      { id: 'bed_thornpeak_4', x: -23, z: 690 },
      { id: 'bed_thornpeak_5', x: -18, z: 690 },
      { id: 'bed_thornpeak_6', x: -13, z: 690 },
    ],
  },
  {
    // The showcase: eight beds on the parterre grounds, a dozen yards west of
    // The Parterre Walk itself and clear of its lane. The site is 70 yards
    // from Hedgewick, which is the zone hub and therefore the origin every
    // reachability arm here floods from, the Walk being a landmark rather
    // than a hub.
    id: 'patch_evergarden',
    zoneId: 'evergarden',
    tier: 4,
    x: 348.5,
    z: 874.5,
    beds: [
      { id: 'bed_evergarden_1', x: 341, z: 872 },
      { id: 'bed_evergarden_2', x: 346, z: 872 },
      { id: 'bed_evergarden_3', x: 351, z: 872 },
      { id: 'bed_evergarden_4', x: 356, z: 872 },
      { id: 'bed_evergarden_5', x: 341, z: 877 },
      { id: 'bed_evergarden_6', x: 346, z: 877 },
      { id: 'bed_evergarden_7', x: 351, z: 877 },
      { id: 'bed_evergarden_8', x: 356, z: 877 },
    ],
  },
];

// Frozen at module load, not just readonly-typed, because both worlds hand
// this table across the IWorld seam BY REFERENCE (the FARMING_ZONE_TIERS
// symmetry): a consumer that sorted or spliced the shared array in place
// would corrupt shipped content process-wide, and `readonly` is erased at
// runtime. Deep: the array, each patch, each beds array, each bed.
export const FARM_PATCHES: readonly FarmPatchDef[] = Object.freeze(
  FARM_PATCH_ROWS.map((p) =>
    Object.freeze({ ...p, beds: Object.freeze(p.beds.map((b) => Object.freeze({ ...b }))) }),
  ),
);

// The load-side bed allowlist: a persisted plot whose bed id is not here is
// dropped on load (the node_persist.ts anti-tamper pattern).
// UNLIKE the deep-frozen table above, this Set (and FARM_CROP_IDS below)
// stays a live instance: Object.freeze cannot disable Set.add and the
// ReadonlySet type erases at runtime. That asymmetry is acceptable only
// because the allowlists never cross the IWorld seam; they are internal to
// the load path.
export const FARM_BED_IDS: ReadonlySet<string> = new Set(
  FARM_PATCHES.flatMap((p) => p.beds.map((b) => b.id)),
);

// The crop registry the persistence allowlist reads. The growth phase owns
// the real catalog; `wheat` is pre-declared now because it is packet-locked
// (the intro quest plants one wheat) and a real id lets the save round trip
// prove a surviving row end to end. Nothing can plant yet, so no live save
// can carry a row before the growth phase lands.
// Crop ids are PERSISTED SAVE KEYS like bed ids: removing or renaming one
// destroys every player's plot of that crop at their next load (the
// allowlist drop). Never rename a shipped crop id; retiring one is a
// deliberate destroy-on-load decision.
export const FARM_CROP_IDS: ReadonlySet<string> = new Set(['wheat']);
