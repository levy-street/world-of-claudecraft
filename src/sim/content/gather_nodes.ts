// Gatherable world nodes: ore veins, wood stands, herb patches. Placed as
// permanent, unowned world fixtures; visibility only (see G3 for harvesting).
// Adding a new node type or placement should touch only this file plus the
// render prop lookup that draws it (src/render/gather_nodes.ts).
//
// Density: SIX nodes of every type in every zone, spread across the zone rather
// than thickened in one clearing, against the 240-second respawn in
// NODE_HARVEST_TABLE. The two numbers are one decision. Before, every zone
// circuit was shorter than the respawn, so a gathering session was spent
// standing at a node the player had already worked; doubling both the count and
// the wait leaves the per-zone harvest ceiling where it was and spends the wait
// walking instead. Spread is what buys that, so it is measured, not assumed:
// tests/gather_node_placement.test.ts holds every zone to keeping 40 percent of
// its walkable ground within 40 yards of a node, and holds every coordinate to
// being dry, walkable, unblocked, reachable and workable.
//
// What "spends the wait walking" does and does not mean, measured rather than
// asserted, because the honest version is narrower than the slogan. Modelling a
// circuit as a nearest-neighbour tour at RUN_SPEED plus the 2.5-second cast
// ceiling, working ALL of a zone's nodes:
//
//                  before (9/12/12 at 120s)      after (18 at 240s)
//   Eastbrook       69s circuit, 43 pct idle      160s circuit, 33 pct idle
//   Mirefen        109s circuit,  9 pct idle      207s circuit, 14 pct idle
//   Thornpeak      113s circuit,  6 pct idle      197s circuit, 18 pct idle
//
// So the starting zone, which is where the complaint came from and where 43
// percent of a session really was standing still, improves. The two later zones
// get slightly worse, because their circuits were ALREADY nearly respawn-length,
// so the packet's premise that "every zone circuit is shorter than the respawn"
// was only substantially true of Eastbrook. And no circuit exceeds the respawn
// even now: a gatherer working one profession is idle most of the cycle in every
// zone, before and after (a solo Eastbrook miner: 10s of work in 120 before, 30s
// in 240 now, because the six veins are held inside a 20-yard ring around the
// Copper Dig by tests/gather_nodes.test.ts so q_prof_intro's ore is findable at
// the landmark it names).
//
// The absolute circuit roughly doubled and now covers the zone rather than three
// clearings, which is the density half of the goal and is real. The idle half is
// only delivered in zone 1. Recorded here so the next reader does not believe
// waiting was solved.
//
// Scope note for the header above: "every zone" meant the tuned strip when it
// was written. The v0.32.0 expansion shipped eleven zones at a deliberate
// two-per-type hub-outskirt starter kit, and the phase 20 density pass
// (docs/design/professions-tuning-packet-review.md, the build record) brought
// three of them (willowfen, galecrest, farshore_isle) to the strip's own six
// per type; the remaining eight keep the starter kit until their zone-4 pass.

import type { GatherNodeDef, GatherNodeType } from '../types';

export const GATHER_NODE_TYPES: readonly GatherNodeType[] = ['ore', 'wood', 'herb'];

// `level` (issue: profession XP) is a one-time snapshot of each node's zone
// levelRange midpoint (eastbrook_vale [1,7] -> 4; mirefen_marsh, zone2's
// levelRange [6,13] -> 10), not a live lookup: see types.ts GatherNodeDef.
export const GATHER_NODES: GatherNodeDef[] = [
  // Eastbrook Vale (eastbrook_vale), ore around the Copper Dig outcrops (the
  // zone's mine-themed POI, zone1.ts pois); moved here from Boar Meadow (a
  // wolf/boar mob area with no mining flavor and no discoverable landmark)
  // so q_prof_intro's ore veins actually sit somewhere players can find them.
  // Nudged toward the town-facing edge of the tunnel_rat camp (center -82,-62,
  // radius 20) so a level 1-2 miner picking up q_prof_intro can reach ore
  // without crossing all the way to the camp's interior first.
  {
    id: 'ore_eastbrook_1',
    zoneId: 'eastbrook_vale',
    type: 'ore',
    pos: { x: -70, z: -53 },
    level: 4,
    tier: 1,
  },
  {
    id: 'ore_eastbrook_2',
    zoneId: 'eastbrook_vale',
    type: 'ore',
    pos: { x: -73, z: -49 },
    level: 4,
    tier: 1,
  },
  {
    id: 'ore_eastbrook_3',
    zoneId: 'eastbrook_vale',
    type: 'ore',
    pos: { x: -67, z: -57 },
    level: 4,
    tier: 1,
  },
  // Three more veins finishing the Copper Dig field, on the far side of the
  // outcrops from the trio above so the dig is a short circuit rather than one
  // spot. All six stay inside the 20-yard ring tests/gather_nodes.test.ts holds
  // every Eastbrook vein to (the ore has to be findable from the landmark
  // q_prof_intro names), and these three sit 18 to 20 yards out, with the
  // Grix clearance below deciding their exact spots.
  //
  // The whole field keeps clear of Grix the Tunnelking, the zone's rare
  // elite, who spawns at (-95, -78) with a 4-yard ring and a 13-yard BASE
  // aggro radius. Base is not the real reach: aggro is level-scaled
  // (src/sim/mob/locomotion.ts, 1.5 yards per level over the player, clamped
  // at MAX_AGGRO_RADIUS), so against the level-1 characters q_prof_intro
  // sends here Grix detects at the 20-yard clamp. Damage cancels a gather
  // cast outright, so a vein whose 5-yard harvest disc overlaps that reach
  // forces the named fight to finish the tutorial at ANY level, which is not
  // "level up first" (R33's stated exception to the deliberate-danger rule).
  // Every vein therefore keeps its whole harvest disc outside the scaled
  // reach plus the spawn ring (29 yards from the camp centre), pinned for
  // every named mob in every zone by the placement-margin arm in
  // tests/gather_node_placement.test.ts. Ordinary camps stay deliberate
  // gathering risk (a third of all nodes sit inside one on purpose: grey
  // trash, not a rare).
  {
    id: 'ore_eastbrook_4',
    zoneId: 'eastbrook_vale',
    type: 'ore',
    pos: { x: -92, z: -48 },
    level: 4,
    tier: 1,
  },
  // Moved off (-99, -56): 22.4 yards from Grix's camp centre read as safe
  // under his 13-yard base aggro, but the level-scaled clamp reaches 24 from
  // the ring and the harvest disc closes another 5. Now 34.0 yards out on the
  // north side of the outcrops, 19.2 from the dig.
  {
    id: 'ore_eastbrook_5',
    zoneId: 'eastbrook_vale',
    type: 'ore',
    pos: { x: -87, z: -45 },
    level: 4,
    tier: 1,
  },
  // Moved off (-76, -79): 19.0 yards from Grix's camp centre, inside even a
  // generous reading of the scaled reach. Now 31.3 yards out on the
  // town-facing side, 19.7 from the dig, keeping the field's circuit shape.
  {
    id: 'ore_eastbrook_6',
    zoneId: 'eastbrook_vale',
    type: 'ore',
    pos: { x: -65, z: -69 },
    level: 4,
    tier: 1,
  },

  // Eastbrook Vale, wood stands around Webwood
  {
    id: 'wood_eastbrook_1',
    zoneId: 'eastbrook_vale',
    type: 'wood',
    pos: { x: -62, z: 8 },
    level: 4,
    tier: 1,
  },
  {
    id: 'wood_eastbrook_2',
    zoneId: 'eastbrook_vale',
    type: 'wood',
    pos: { x: -57, z: -6 },
    level: 4,
    tier: 1,
  },
  {
    id: 'wood_eastbrook_3',
    zoneId: 'eastbrook_vale',
    type: 'wood',
    pos: { x: -68, z: 18 },
    level: 4,
    tier: 1,
  },
  // The Webwood trio above is one stop, so logging in the starting zone was a
  // single tree. These three follow the northern woodland instead: up the
  // Fenbridge road, then east along the Brightwood Glade treeline. They are 40
  // to 80 yards apart, which is the point: a logging run is now a walk, and the
  // 240-second respawn is spent travelling rather than standing.
  {
    id: 'wood_eastbrook_4',
    zoneId: 'eastbrook_vale',
    type: 'wood',
    pos: { x: 25, z: 101 },
    level: 4,
    tier: 1,
  },
  {
    id: 'wood_eastbrook_5',
    zoneId: 'eastbrook_vale',
    type: 'wood',
    pos: { x: 7, z: 140 },
    level: 4,
    tier: 1,
  },
  {
    id: 'wood_eastbrook_6',
    zoneId: 'eastbrook_vale',
    type: 'wood',
    pos: { x: 85, z: 140 },
    level: 4,
    tier: 1,
  },

  // Eastbrook Vale, herb patches along Mirror Lake's bank. All three used to sit
  // ON the lake floor, about 4 yards under the surface (the lake is centred at
  // (-92, 88) with radius 30, and its basin bottoms out at waterLevel - 4), so
  // the only way to pick a herb in the starting zone was to swim to the bottom
  // of a lake, and none of the three had anywhere inside harvest reach a player
  // could stand. They now run along the dry bank 33 to 36 yards out from the
  // lake centre, still in sight of the water, clearing its surface by 3.2 to 4.4
  // yards on ground flat enough to work.
  // tests/gather_node_placement.test.ts pins every arm.
  //
  // One deliberate consequence: the old spots sat inside the Mirror Lake POI's
  // 20-yard visit radius, so a herbalist used to be credited that landmark just
  // by picking here, and the bank is 10 to 14 yards outside it. Wayfarer of the
  // Vale now asks for an actual walk to the shore, which is what a landmark
  // ought to ask, and the walk stays dry: the visit radius holds plenty of dry
  // standable ground, up to 4.96 yards of freeboard, so nothing about that deed
  // requires swimming. tests/gather_node_placement.test.ts pins that property
  // too, since after this change nothing else in the suite touches that POI.
  {
    id: 'herb_eastbrook_1',
    zoneId: 'eastbrook_vale',
    type: 'herb',
    pos: { x: -59, z: 91 },
    level: 4,
    tier: 1,
  },
  {
    id: 'herb_eastbrook_2',
    zoneId: 'eastbrook_vale',
    type: 'herb',
    pos: { x: -57, z: 82 },
    level: 4,
    tier: 1,
  },
  {
    id: 'herb_eastbrook_3',
    zoneId: 'eastbrook_vale',
    type: 'herb',
    pos: { x: -58, z: 99 },
    level: 4,
    tier: 1,
  },
  // Three more patches across the east half of the vale, which had no herb at
  // all: the Sowfield croplands south of town, the boar downs east of Boar
  // Meadow, and the rise between the downs and the Fallen Chapel. Silverleaf
  // growing on open pasture and tilled ground is the same flavour as the Mirror
  // Lake bank, and it means a herbalist walking east is not walking away from
  // their profession.
  {
    id: 'herb_eastbrook_4',
    zoneId: 'eastbrook_vale',
    type: 'herb',
    pos: { x: 23, z: -99 },
    level: 4,
    tier: 1,
  },
  {
    id: 'herb_eastbrook_5',
    zoneId: 'eastbrook_vale',
    type: 'herb',
    pos: { x: 89, z: -27 },
    level: 4,
    tier: 1,
  },
  {
    id: 'herb_eastbrook_6',
    zoneId: 'eastbrook_vale',
    type: 'herb',
    pos: { x: 99, z: 57 },
    level: 4,
    tier: 1,
  },

  // Mirefen Marsh (mirefen_marsh)
  {
    id: 'ore_mirefen_1',
    zoneId: 'mirefen_marsh',
    type: 'ore',
    pos: { x: 40, z: 340 },
    level: 10,
    tier: 1,
  },
  {
    id: 'ore_mirefen_2',
    zoneId: 'mirefen_marsh',
    type: 'ore',
    pos: { x: -30, z: 360 },
    level: 10,
    tier: 1,
  },
  {
    id: 'ore_mirefen_3',
    zoneId: 'mirefen_marsh',
    type: 'ore',
    pos: { x: 35, z: 345 },
    level: 10,
    tier: 1,
  },
  // Every marsh vein sat in the northern third, within sight of Fenbridge. This
  // one is out on the Drowned Chapel shore, so the southern half of the zone has
  // ore of its own. It is the NEARER of the two ore additions to the hub (172
  // yards against 196), which is why it is the tier-1 one: see the hub-distance
  // rule in the tier-ramp block below.
  {
    id: 'ore_mirefen_4',
    zoneId: 'mirefen_marsh',
    type: 'ore',
    pos: { x: 111, z: 431 },
    level: 10,
    tier: 1,
  },

  {
    id: 'wood_mirefen_1',
    zoneId: 'mirefen_marsh',
    type: 'wood',
    pos: { x: 10, z: 330 },
    level: 10,
    tier: 1,
  },
  {
    id: 'wood_mirefen_2',
    zoneId: 'mirefen_marsh',
    type: 'wood',
    pos: { x: -15, z: 355 },
    level: 10,
    tier: 1,
  },
  {
    id: 'wood_mirefen_3',
    zoneId: 'mirefen_marsh',
    type: 'wood',
    pos: { x: -20, z: 315 },
    level: 10,
    tier: 1,
  },
  // North of the causeway in the Prowler Reeds, the first marsh ground a
  // traveller from Eastbrook crosses.
  {
    id: 'wood_mirefen_4',
    zoneId: 'mirefen_marsh',
    type: 'wood',
    pos: { x: -15, z: 237 },
    level: 10,
    tier: 1,
  },

  // Two of the three marsh herb patches were also on a lake floor, each in the
  // dead centre of one of the zone's two smaller pools ((60, 380) radius 25 and
  // (-40, 450) radius 20), about 4 yards under. Both moved out to the dry shore
  // of the same pool, so a marsh herb still grows by marsh water and the patch
  // is workable. herb_mirefen_3 was already on dry ground and has not moved.
  {
    id: 'herb_mirefen_1',
    zoneId: 'mirefen_marsh',
    type: 'herb',
    pos: { x: 29, z: 395 },
    level: 10,
    tier: 1,
  },
  {
    id: 'herb_mirefen_2',
    zoneId: 'mirefen_marsh',
    type: 'herb',
    pos: { x: -66, z: 458 },
    level: 10,
    tier: 1,
  },
  {
    id: 'herb_mirefen_3',
    zoneId: 'mirefen_marsh',
    type: 'herb',
    pos: { x: 30, z: 355 },
    level: 10,
    tier: 1,
  },
  // West shore of the Deepfen Shallows, 3.3 yards above the water plane: marsh
  // herb by marsh water, the same reading as the two patches above, and the only
  // gatherable anything on the zone's west flank.
  {
    id: 'herb_mirefen_4',
    zoneId: 'mirefen_marsh',
    type: 'herb',
    pos: { x: -88, z: 272 },
    level: 10,
    tier: 1,
  },

  // Thornpeak Heights (thornpeak_heights) had no gather nodes at all, forcing
  // higher-level players back down to zone 1 for every mining/logging/herb
  // trip. Ore sits by Deeprock Burrows (the zone's mine-themed POI, guarded by
  // the deeprock_kobold camp, matching the eastbrook_vale ore-vs-tunnel_rat
  // precedent); wood sits near The Glimmermere and herb near Highwatch.
  {
    id: 'ore_thornpeak_1',
    zoneId: 'thornpeak_heights',
    type: 'ore',
    pos: { x: 90, z: 608 },
    level: 17,
    tier: 1,
  },
  {
    id: 'ore_thornpeak_2',
    zoneId: 'thornpeak_heights',
    type: 'ore',
    pos: { x: 78, z: 630 },
    level: 17,
    tier: 1,
  },

  // This stand was the near-vertical one: it stood in the Glimmermere shallows
  // with only 0.46 yards of freeboard, and the lake wall inside its own harvest
  // reach climbs at 3.28 rise/run against a movement climb limit of 1.5, so a
  // player working it was pushed off the face. The node itself measured a
  // walkable 0.94, which is why nothing short of a reach sweep found it. Moved
  // round to a rise 13 yards out from the lake centre. That is still inside the
  // Glimmermere's authored 18-yard disc, so this is a hummock standing 5 yards
  // clear of the water plane rather than a shore, which is fine: what the old
  // spot got wrong was the 0.46 yards of freeboard and the wall, and this has
  // 5.00 and stays under 0.94 across the whole reach. Nearer the lake than
  // before, and still the anchor the tier-2 stand sits a short walk from
  // (18.7 yards). It also happens to sit clear of every mob camp radius, as the
  // old spot did, which is worth keeping if a later edit moves it again: damage
  // cancels a gather cast outright rather than pushing it back, so a contested
  // patch is materially harder to work. Not a rule, though, and no arm pins it:
  // a third of the shipped nodes sit inside a camp on purpose.
  {
    id: 'wood_thornpeak_1',
    zoneId: 'thornpeak_heights',
    type: 'wood',
    pos: { x: -63, z: 771 },
    level: 17,
    tier: 1,
  },
  {
    id: 'wood_thornpeak_2',
    zoneId: 'thornpeak_heights',
    type: 'wood',
    pos: { x: -82, z: 782 },
    level: 17,
    tier: 1,
  },

  {
    id: 'herb_thornpeak_1',
    zoneId: 'thornpeak_heights',
    type: 'herb',
    pos: { x: 18, z: 648 },
    level: 17,
    tier: 1,
  },
  {
    id: 'herb_thornpeak_2',
    zoneId: 'thornpeak_heights',
    type: 'herb',
    pos: { x: -18, z: 678 },
    level: 17,
    tier: 1,
  },

  // Tool-tier ramp. Zone 1 (eastbrook_vale) stays ALL tier 1: every node
  // above keeps tier 1, so the 20-copper starter tools cover the whole zone
  // (#2343: every harvest needs its profession's tool, tier 1 included; the
  // starter tools are sold a few steps from spawn). The ramp comes only from the
  // veins below: mirefen_marsh carries two tier-2 nodes per type,
  // thornpeak_heights two tier-2 and two tier-3 per type. Every one of them
  // grants the zone's existing material via the zone-keyed NODE_MATERIAL_TABLE:
  // no new materials and no yield changes (deliberate; richer yields are handled
  // separately).
  //
  // Two of each higher tier rather than one, because respawn is 240 seconds
  // (NODE_HARVEST_TABLE). A tier only a single node in the zone carries would
  // have HALVED its own rate when respawn doubled, and Thornpeak's tier-3 veins
  // are what carry a gatherer from proficiency 75 to 100 (see
  // GATHER_GAIN_TIER_STEP), so that tier in particular has to keep pace.
  //
  // Which of a type's two additions carries the higher tier is not a
  // coin-flip: it is the one FURTHER from the zone hub. The long arm of the new
  // circuit is the arm that asks for the better tool, so a traveller working the
  // near half with a starter tool still has nodes, and the deep half rewards the
  // upgrade. (The `b` suffix just means the second node of that tier; node ids
  // key meta.nodeHarvestReadyAt and persist as remaining-time deltas in
  // CharacterState.nodeHarvestCooldowns, where a RETIRED id is dropped on
  // load, so renaming a node id costs at most one in-flight respawn timer.)
  {
    id: 'ore_mirefen_t2',
    zoneId: 'mirefen_marsh',
    type: 'ore',
    // Moved off (48,352) at the v0.32.0 merge: the expansion seats a collider
    // there and the reshaped marsh water leaves under half the required yard
    // of bank clearance.
    pos: { x: 36, z: 350 },
    level: 10,
    tier: 2,
  },
  // The Sunken Bastion approach, 196 yards out from Fenbridge and the deepest ore
  // in the zone, so it is the ore addition that takes the higher tier.
  {
    id: 'ore_mirefen_t2b',
    zoneId: 'mirefen_marsh',
    type: 'ore',
    pos: { x: 45, z: 491 },
    level: 10,
    tier: 2,
  },
  // Moved off the north road surface (R11): it shipped at (2, 342), 0.3yd
  // from the road center line, standing in the roadway the moment nodes
  // became solid bodies. The new spot is well clear of the road (11.5yd,
  // dry, standable; measured against the same world.ts predicates the
  // placement suite runs), and it left the road-band exemption set in
  // tests/gather_node_placement.test.ts with it.
  {
    id: 'wood_mirefen_t2',
    zoneId: 'mirefen_marsh',
    type: 'wood',
    pos: { x: -10, z: 340 },
    level: 10,
    tier: 2,
  },
  // East flank, past Widow Thicket.
  {
    id: 'wood_mirefen_t2b',
    zoneId: 'mirefen_marsh',
    type: 'wood',
    pos: { x: 102, z: 292 },
    level: 10,
    tier: 2,
  },
  // Followed herb_mirefen_1 off the pool it shared: it sat inside the same
  // footprint at 3.55 yards under. Still 12 yards from that patch.
  {
    id: 'herb_mirefen_t2',
    zoneId: 'mirefen_marsh',
    type: 'herb',
    pos: { x: 34, z: 406 },
    level: 10,
    tier: 2,
  },
  // Above the Troll Mounds on the zone's south-west shoulder.
  {
    id: 'herb_mirefen_t2b',
    zoneId: 'mirefen_marsh',
    type: 'herb',
    pos: { x: -114, z: 412 },
    level: 10,
    tier: 2,
  },
  {
    id: 'ore_thornpeak_t2',
    zoneId: 'thornpeak_heights',
    type: 'ore',
    pos: { x: 102, z: 615 },
    level: 17,
    tier: 2,
  },
  // Stalker Ridge, the zone's northern shelf. Nearer the hub than the Stormcrag
  // vein below, hence tier 2 rather than tier 3.
  {
    id: 'ore_thornpeak_t2b',
    zoneId: 'thornpeak_heights',
    type: 'ore',
    pos: { x: -54, z: 602 },
    level: 17,
    tier: 2,
  },
  {
    id: 'ore_thornpeak_t3',
    zoneId: 'thornpeak_heights',
    type: 'ore',
    pos: { x: 70, z: 640 },
    level: 17,
    tier: 3,
  },
  // Stormcrag, among the elementals, 163 yards from Highwatch.
  {
    id: 'ore_thornpeak_t3b',
    zoneId: 'thornpeak_heights',
    type: 'ore',
    pos: { x: 110, z: 780 },
    level: 17,
    tier: 3,
  },
  {
    id: 'wood_thornpeak_t2',
    zoneId: 'thornpeak_heights',
    type: 'wood',
    pos: { x: -45, z: 776 },
    level: 17,
    tier: 2,
  },
  // Above Drogmar's War-Camp on the western slopes.
  {
    id: 'wood_thornpeak_t2b',
    zoneId: 'thornpeak_heights',
    type: 'wood',
    pos: { x: -130, z: 716 },
    level: 17,
    tier: 2,
  },
  {
    id: 'wood_thornpeak_t3',
    zoneId: 'thornpeak_heights',
    type: 'wood',
    pos: { x: -92, z: 793 },
    level: 17,
    tier: 3,
  },
  // The Revenant Fields treeline, deepest wood stand in the zone at 193 yards.
  {
    id: 'wood_thornpeak_t3b',
    zoneId: 'thornpeak_heights',
    type: 'wood',
    pos: { x: -34, z: 850 },
    level: 17,
    tier: 3,
  },
  {
    id: 'herb_thornpeak_t2',
    zoneId: 'thornpeak_heights',
    type: 'herb',
    pos: { x: 28, z: 658 },
    level: 17,
    tier: 2,
  },
  // The Ogre Foothills, west of the wall.
  {
    id: 'herb_thornpeak_t2b',
    zoneId: 'thornpeak_heights',
    type: 'herb',
    pos: { x: -106, z: 694 },
    level: 17,
    tier: 2,
  },
  {
    id: 'herb_thornpeak_t3',
    zoneId: 'thornpeak_heights',
    type: 'herb',
    pos: { x: -28, z: 690 },
    level: 17,
    tier: 3,
  },
  // Beside the Wyrmcult Tents on the Sanctum approach.
  {
    id: 'herb_thornpeak_t3b',
    zoneId: 'thornpeak_heights',
    type: 'herb',
    pos: { x: 51, z: 834 },
    level: 17,
    tier: 3,
  },

  // The Veiled Hollow, around Eldergleam: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_veiled_hollow_1',
    zoneId: 'veiled_hollow',
    type: 'ore',
    pos: { x: -2, z: 1004 },
    level: 18,
    tier: 1,
  },
  {
    id: 'ore_veiled_hollow_2',
    zoneId: 'veiled_hollow',
    type: 'ore',
    pos: { x: 6, z: 1044 },
    level: 18,
    tier: 1,
  },
  {
    id: 'wood_veiled_hollow_1',
    zoneId: 'veiled_hollow',
    type: 'wood',
    pos: { x: -82, z: 1052 },
    level: 18,
    tier: 1,
  },
  {
    id: 'wood_veiled_hollow_2',
    zoneId: 'veiled_hollow',
    type: 'wood',
    pos: { x: -70, z: 992 },
    level: 18,
    tier: 1,
  },
  {
    id: 'herb_veiled_hollow_1',
    zoneId: 'veiled_hollow',
    type: 'herb',
    pos: { x: -22, z: 1074 },
    level: 18,
    tier: 1,
  },
  {
    id: 'herb_veiled_hollow_2',
    zoneId: 'veiled_hollow',
    type: 'herb',
    pos: { x: -54, z: 1082 },
    level: 18,
    tier: 1,
  },

  // The Drakelands, around Wyrmwatch: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_drakelands_1',
    zoneId: 'drakelands',
    type: 'ore',
    pos: { x: 442, z: 1874 },
    level: 18,
    tier: 1,
  },
  {
    id: 'ore_drakelands_2',
    zoneId: 'drakelands',
    type: 'ore',
    pos: { x: 450, z: 1914 },
    level: 18,
    tier: 1,
  },
  {
    id: 'wood_drakelands_1',
    zoneId: 'drakelands',
    type: 'wood',
    pos: { x: 362, z: 1922 },
    level: 18,
    tier: 1,
  },
  {
    id: 'wood_drakelands_2',
    zoneId: 'drakelands',
    type: 'wood',
    pos: { x: 374, z: 1862 },
    level: 18,
    tier: 1,
  },
  {
    id: 'herb_drakelands_1',
    zoneId: 'drakelands',
    type: 'herb',
    pos: { x: 422, z: 1944 },
    level: 18,
    tier: 1,
  },
  {
    id: 'herb_drakelands_2',
    zoneId: 'drakelands',
    type: 'herb',
    pos: { x: 390, z: 1952 },
    level: 18,
    tier: 1,
  },

  // The Frostveil Reach, around Icemantle: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_frostveil_1',
    zoneId: 'frostveil',
    type: 'ore',
    pos: { x: 8, z: 1534 },
    level: 19,
    tier: 1,
  },
  {
    id: 'ore_frostveil_2',
    zoneId: 'frostveil',
    type: 'ore',
    pos: { x: 16, z: 1574 },
    level: 19,
    tier: 1,
  },
  {
    id: 'wood_frostveil_1',
    zoneId: 'frostveil',
    type: 'wood',
    pos: { x: -72, z: 1582 },
    level: 19,
    tier: 1,
  },
  {
    id: 'wood_frostveil_2',
    zoneId: 'frostveil',
    type: 'wood',
    // Nudged off (-60,1522) at the v0.32.0 merge: the authored spot stands on
    // a 1.76 rise/run slope, past the 1.5 climb limit a harvest needs, and
    // the near ground west keeps a cliff lip inside the 5yd harvest reach.
    pos: { x: -54, z: 1518 },
    level: 19,
    tier: 1,
  },
  {
    id: 'herb_frostveil_1',
    zoneId: 'frostveil',
    type: 'herb',
    pos: { x: -12, z: 1604 },
    level: 19,
    tier: 1,
  },
  {
    id: 'herb_frostveil_2',
    zoneId: 'frostveil',
    type: 'herb',
    pos: { x: -44, z: 1612 },
    level: 19,
    tier: 1,
  },

  // The Amberfall, around Lanternmere: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_amberfall_1',
    zoneId: 'amberfall',
    type: 'ore',
    pos: { x: -322, z: 2046 },
    level: 19,
    tier: 1,
  },
  {
    id: 'ore_amberfall_2',
    zoneId: 'amberfall',
    type: 'ore',
    pos: { x: -314, z: 2086 },
    level: 19,
    tier: 1,
  },
  {
    id: 'wood_amberfall_1',
    zoneId: 'amberfall',
    type: 'wood',
    pos: { x: -402, z: 2094 },
    level: 19,
    tier: 1,
  },
  {
    id: 'wood_amberfall_2',
    zoneId: 'amberfall',
    type: 'wood',
    pos: { x: -390, z: 2034 },
    level: 19,
    tier: 1,
  },
  {
    id: 'herb_amberfall_1',
    zoneId: 'amberfall',
    type: 'herb',
    // Nudged off (-342,2116) at the v0.32.0 merge: the authored spot clears
    // the amberfall mere's surface by under a third of the required yard.
    pos: { x: -342, z: 2110 },
    level: 19,
    tier: 1,
  },
  {
    id: 'herb_amberfall_2',
    zoneId: 'amberfall',
    type: 'herb',
    // Moved off (-374,2124) at the v0.32.0 merge: that spot is 3 yards under
    // the amberfall mere's surface (the same lake-floor authoring defect the
    // placement suite exists to catch).
    pos: { x: -388, z: 2110 },
    level: 19,
    tier: 1,
  },

  // The Willowfen, around Bridgemere: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_willowfen_1',
    zoneId: 'willowfen',
    type: 'ore',
    // Nudged off (-322,336) at the v0.32.0 merge: the authored spot sits on
    // the fen waterline (0.03yd of the required yard of bank clearance).
    pos: { x: -318, z: 336 },
    level: 20,
    tier: 1,
  },
  {
    id: 'ore_willowfen_2',
    zoneId: 'willowfen',
    type: 'ore',
    pos: { x: -314, z: 376 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_willowfen_1',
    zoneId: 'willowfen',
    type: 'wood',
    pos: { x: -402, z: 384 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_willowfen_2',
    zoneId: 'willowfen',
    type: 'wood',
    // Nudged off (-390,324) at the v0.32.0 merge: half the required yard of
    // bank clearance over the fen water.
    pos: { x: -392, z: 322 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_willowfen_1',
    zoneId: 'willowfen',
    type: 'herb',
    pos: { x: -342, z: 406 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_willowfen_2',
    zoneId: 'willowfen',
    type: 'herb',
    pos: { x: -374, z: 414 },
    level: 20,
    tier: 1,
  },
  // Phase 20 density pass (the +36 bottom-three set, docs/design/
  // professions-tuning-packet-review.md Q9 to Q16): four more of each type
  // spread to the zone's far quarters, all tier 1, the rollout ledger row
  // staying 'starter'. Every spot passed the full placement-rule sweep
  // (dry land with sea freeboard, slope and reach, colliders, stand spot,
  // hub flood, spacing, cluster bands, road band, dangers, mailbox floor)
  // before landing.
  {
    id: 'ore_willowfen_3',
    zoneId: 'willowfen',
    type: 'ore',
    // Lilymoors west fen-pool bank, a fishing shore nearby.
    pos: { x: -470, z: 330 },
    level: 20,
    tier: 1,
  },
  {
    id: 'ore_willowfen_4',
    zoneId: 'willowfen',
    type: 'ore',
    // Bogshine east margin. Nudged off (-252,268) at authoring (Q15): 1.48yd
    // of world-sea freeboard, inside the half-yard-above-the-guard band the
    // Q15 pass treated as too close (authoring practice, a recorded session
    // default; the suite itself enforces only the 1yd guard). The moved spot
    // clears at 1.76.
    pos: { x: -251, z: 268 },
    level: 20,
    tier: 1,
  },
  {
    id: 'ore_willowfen_5',
    zoneId: 'willowfen',
    type: 'ore',
    // Drowsy Flats southwest margin.
    pos: { x: -384, z: 512 },
    level: 20,
    tier: 1,
  },
  {
    id: 'ore_willowfen_6',
    zoneId: 'willowfen',
    type: 'ore',
    // North fen by the Tanglemouth road.
    pos: { x: -358, z: 604 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_willowfen_3',
    zoneId: 'willowfen',
    type: 'wood',
    // Lilymoors north willow stand.
    pos: { x: -458, z: 264 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_willowfen_4',
    zoneId: 'willowfen',
    type: 'wood',
    // East moor by the Windway track.
    pos: { x: -232, z: 420 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_willowfen_5',
    zoneId: 'willowfen',
    type: 'wood',
    // Drowsy Flats east rise. Nudged off (-254,500) at authoring (Q15):
    // 1.01yd of world-sea freeboard; the moved spot clears at 1.73.
    pos: { x: -251, z: 504 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_willowfen_6',
    zoneId: 'willowfen',
    type: 'wood',
    // North fen west stand. Nudged off (-418,580) at authoring (Q15): 1.08yd
    // of world-sea freeboard; the moved spot clears at 1.69.
    pos: { x: -417, z: 580 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_willowfen_3',
    zoneId: 'willowfen',
    type: 'herb',
    // Bogshine south pool shore.
    pos: { x: -296, z: 332 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_willowfen_4',
    zoneId: 'willowfen',
    type: 'herb',
    // Willowweep pool margin, a fishing shore.
    pos: { x: -452, z: 438 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_willowfen_5',
    zoneId: 'willowfen',
    type: 'herb',
    // North fen east meadow.
    pos: { x: -322, z: 588 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_willowfen_6',
    zoneId: 'willowfen',
    type: 'herb',
    // South fen off the Amberfen Steps road.
    pos: { x: -330, z: 240 },
    level: 20,
    tier: 1,
  },

  // The Nightbloom, around Moonrest: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_nightbloom_1',
    zoneId: 'nightbloom',
    type: 'ore',
    pos: { x: -332, z: 1394 },
    level: 20,
    tier: 1,
  },
  {
    id: 'ore_nightbloom_2',
    zoneId: 'nightbloom',
    type: 'ore',
    pos: { x: -324, z: 1434 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_nightbloom_1',
    zoneId: 'nightbloom',
    type: 'wood',
    pos: { x: -412, z: 1442 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_nightbloom_2',
    zoneId: 'nightbloom',
    type: 'wood',
    pos: { x: -400, z: 1382 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_nightbloom_1',
    zoneId: 'nightbloom',
    type: 'herb',
    pos: { x: -352, z: 1464 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_nightbloom_2',
    zoneId: 'nightbloom',
    type: 'herb',
    pos: { x: -384, z: 1472 },
    level: 20,
    tier: 1,
  },

  // The Wraithwood, around Gallowmere: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_wraithwood_1',
    zoneId: 'wraithwood',
    type: 'ore',
    pos: { x: 398, z: 1404 },
    level: 20,
    tier: 1,
  },
  {
    id: 'ore_wraithwood_2',
    zoneId: 'wraithwood',
    type: 'ore',
    pos: { x: 406, z: 1444 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_wraithwood_1',
    zoneId: 'wraithwood',
    type: 'wood',
    pos: { x: 318, z: 1452 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_wraithwood_2',
    zoneId: 'wraithwood',
    type: 'wood',
    pos: { x: 330, z: 1392 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_wraithwood_1',
    zoneId: 'wraithwood',
    type: 'herb',
    pos: { x: 378, z: 1474 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_wraithwood_2',
    zoneId: 'wraithwood',
    type: 'herb',
    pos: { x: 346, z: 1482 },
    level: 20,
    tier: 1,
  },

  // The Galecrest, around Wickharbor: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_galecrest_1',
    zoneId: 'galecrest',
    type: 'ore',
    pos: { x: 458, z: 334 },
    level: 20,
    tier: 1,
  },
  {
    id: 'ore_galecrest_2',
    zoneId: 'galecrest',
    type: 'ore',
    pos: { x: 466, z: 374 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_galecrest_1',
    zoneId: 'galecrest',
    type: 'wood',
    pos: { x: 378, z: 382 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_galecrest_2',
    zoneId: 'galecrest',
    type: 'wood',
    pos: { x: 390, z: 322 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_galecrest_1',
    zoneId: 'galecrest',
    type: 'herb',
    // Nudged off (438,404) at the v0.32.0 merge: a 5.7 rise/run crag sat
    // inside the authored spot's 5yd harvest reach, and the flat ground west
    // of it would close the pair gap under the 30yd quest-target cluster
    // link, so the patch moved out along the ridge foot instead.
    pos: { x: 448, z: 400 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_galecrest_2',
    zoneId: 'galecrest',
    type: 'herb',
    pos: { x: 406, z: 412 },
    level: 20,
    tier: 1,
  },
  // Phase 20 density pass (the +36 bottom-three set; see the willowfen block
  // note above for the sweep every spot passed).
  {
    id: 'ore_galecrest_3',
    zoneId: 'galecrest',
    type: 'ore',
    // Old Beacon road foot.
    pos: { x: 474, z: 298 },
    level: 20,
    tier: 1,
  },
  {
    id: 'ore_galecrest_4',
    zoneId: 'galecrest',
    type: 'ore',
    // Coast road south of Wickharbor.
    pos: { x: 420, z: 470 },
    level: 20,
    tier: 1,
  },
  {
    id: 'ore_galecrest_5',
    zoneId: 'galecrest',
    type: 'ore',
    // Wreckfields approach.
    pos: { x: 330, z: 600 },
    level: 20,
    tier: 1,
  },
  {
    id: 'ore_galecrest_6',
    zoneId: 'galecrest',
    type: 'ore',
    // Howling Downs west.
    pos: { x: 232, z: 300 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_galecrest_3',
    zoneId: 'galecrest',
    type: 'wood',
    // Windway road south side.
    pos: { x: 250, z: 432 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_galecrest_4',
    zoneId: 'galecrest',
    type: 'wood',
    // Mid downs on the tarn road.
    pos: { x: 350, z: 480 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_galecrest_5',
    zoneId: 'galecrest',
    type: 'wood',
    // Wreckfields west treeline rise, clear of the Warden and deckhand camps.
    pos: { x: 250, z: 648 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_galecrest_6',
    zoneId: 'galecrest',
    type: 'wood',
    // Stable meadows east.
    pos: { x: 452, z: 600 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_galecrest_3',
    zoneId: 'galecrest',
    type: 'herb',
    // Mirror Tarn northeast shore, bundling with the fishing site. Moved from
    // the authored (330,562), whose cell the hub flood cannot enter.
    pos: { x: 326, z: 566 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_galecrest_4',
    zoneId: 'galecrest',
    type: 'herb',
    // West downs meadow.
    pos: { x: 240, z: 352 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_galecrest_5',
    zoneId: 'galecrest',
    type: 'herb',
    // South Lawnmere bank approach, on the dry side of the z 680 to 700 mere
    // rect.
    pos: { x: 420, z: 650 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_galecrest_6',
    zoneId: 'galecrest',
    type: 'herb',
    // Beacon meadow at the eastern ridge foot, 16yd of rim margin.
    pos: { x: 484, z: 330 },
    level: 20,
    tier: 1,
  },

  // The Palmreach, around Drifthaven: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_palmreach_1',
    zoneId: 'palmreach',
    type: 'ore',
    pos: { x: -262, z: 794 },
    level: 20,
    tier: 1,
  },
  {
    id: 'ore_palmreach_2',
    zoneId: 'palmreach',
    type: 'ore',
    pos: { x: -254, z: 834 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_palmreach_1',
    zoneId: 'palmreach',
    type: 'wood',
    pos: { x: -342, z: 842 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_palmreach_2',
    zoneId: 'palmreach',
    type: 'wood',
    pos: { x: -330, z: 782 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_palmreach_1',
    zoneId: 'palmreach',
    type: 'herb',
    pos: { x: -282, z: 864 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_palmreach_2',
    zoneId: 'palmreach',
    type: 'herb',
    pos: { x: -314, z: 872 },
    level: 20,
    tier: 1,
  },

  // The Evergarden, around Hedgewick: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_evergarden_1',
    zoneId: 'evergarden',
    type: 'ore',
    // Moved off (358,784) at the phase 20 pass (Q13): 0.42yd from the road
    // center line stood the vein body in the roadway by the R11 standard; the
    // new spot clears the 5yd band at 6.3yd and keeps the hub flood.
    pos: { x: 354, z: 780 },
    level: 20,
    tier: 1,
  },
  {
    id: 'ore_evergarden_2',
    zoneId: 'evergarden',
    type: 'ore',
    pos: { x: 366, z: 824 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_evergarden_1',
    zoneId: 'evergarden',
    type: 'wood',
    pos: { x: 278, z: 832 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_evergarden_2',
    zoneId: 'evergarden',
    type: 'wood',
    pos: { x: 290, z: 772 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_evergarden_1',
    zoneId: 'evergarden',
    type: 'herb',
    pos: { x: 338, z: 854 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_evergarden_2',
    zoneId: 'evergarden',
    type: 'herb',
    // Nudged off (306,862) at the v0.32.0 merge: the authored spot is cut off
    // from the Fountain Court hub by the garden walls (the placement flood
    // cannot reach it, so a player could not either).
    pos: { x: 302, z: 866 },
    level: 20,
    tier: 1,
  },

  // The Farshore, around Gullhaven: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_farshore_isle_1',
    zoneId: 'farshore_isle',
    type: 'ore',
    pos: { x: 343, z: 44 },
    level: 5,
    tier: 1,
  },
  {
    id: 'ore_farshore_isle_2',
    zoneId: 'farshore_isle',
    type: 'ore',
    pos: { x: 351, z: 84 },
    level: 5,
    tier: 1,
  },
  {
    id: 'wood_farshore_isle_1',
    zoneId: 'farshore_isle',
    type: 'wood',
    // Nudged off (263,92) at the v0.32.0 merge: a 1.9 rise/run bluff sat
    // inside the authored spot's 5yd harvest reach.
    pos: { x: 259, z: 96 },
    level: 5,
    tier: 1,
  },
  {
    id: 'wood_farshore_isle_2',
    zoneId: 'farshore_isle',
    type: 'wood',
    pos: { x: 275, z: 32 },
    level: 5,
    tier: 1,
  },
  {
    id: 'herb_farshore_isle_1',
    zoneId: 'farshore_isle',
    type: 'herb',
    pos: { x: 323, z: 114 },
    level: 5,
    tier: 1,
  },
  {
    id: 'herb_farshore_isle_2',
    zoneId: 'farshore_isle',
    type: 'herb',
    pos: { x: 291, z: 122 },
    level: 5,
    tier: 1,
  },
  // Phase 20 density pass (the +36 bottom-three set; see the willowfen block
  // note above for the sweep every spot passed).
  {
    id: 'ore_farshore_isle_3',
    zoneId: 'farshore_isle',
    type: 'ore',
    // Causeway-approach meadow north of the Landing.
    pos: { x: 232, z: 30 },
    level: 5,
    tier: 1,
  },
  {
    id: 'ore_farshore_isle_4',
    zoneId: 'farshore_isle',
    type: 'ore',
    // South headland toward the cliffs.
    pos: { x: 352, z: -48 },
    level: 5,
    tier: 1,
  },
  {
    id: 'ore_farshore_isle_5',
    zoneId: 'farshore_isle',
    type: 'ore',
    // Sundered Cliffs meadow.
    pos: { x: 430, z: -90 },
    level: 5,
    tier: 1,
  },
  {
    id: 'ore_farshore_isle_6',
    zoneId: 'farshore_isle',
    type: 'ore',
    // Riftfields east reach. Nudged off (454,93) at authoring (Q15): 1.02yd
    // of world-sea freeboard; the moved spot clears at 1.50.
    pos: { x: 450, z: 93 },
    level: 5,
    tier: 1,
  },
  {
    id: 'wood_farshore_isle_3',
    zoneId: 'farshore_isle',
    type: 'wood',
    // South strand west.
    pos: { x: 279, z: -44 },
    level: 5,
    tier: 1,
  },
  {
    id: 'wood_farshore_isle_4',
    zoneId: 'farshore_isle',
    type: 'wood',
    // South headland stand.
    pos: { x: 330, z: -70 },
    level: 5,
    tier: 1,
  },
  {
    id: 'wood_farshore_isle_5',
    zoneId: 'farshore_isle',
    type: 'wood',
    // North coast east of Gull Mere, bundling with the fishing site. Nudged
    // off (388,123) at authoring (Q15): 1.04yd of world-sea freeboard; the
    // moved spot clears at 1.50.
    pos: { x: 386, z: 120 },
    level: 5,
    tier: 1,
  },
  {
    id: 'wood_farshore_isle_6',
    zoneId: 'farshore_isle',
    type: 'wood',
    // Ferrywalk causeway approach.
    pos: { x: 210, z: -24 },
    level: 5,
    tier: 1,
  },
  {
    id: 'herb_farshore_isle_3',
    zoneId: 'farshore_isle',
    type: 'herb',
    // West meadow off the shore road.
    pos: { x: 245, z: 55 },
    level: 5,
    tier: 1,
  },
  {
    id: 'herb_farshore_isle_4',
    zoneId: 'farshore_isle',
    type: 'herb',
    // North shore east of Gull Mere, outside its blend footprint, bundling
    // with the fishing site. Nudged off (358,140) at authoring (Q15): 1.16yd
    // of world-sea freeboard; the moved spot clears at 1.52.
    pos: { x: 358, z: 138 },
    level: 5,
    tier: 1,
  },
  {
    id: 'herb_farshore_isle_5',
    zoneId: 'farshore_isle',
    type: 'herb',
    // South strand patch.
    pos: { x: 295, z: -55 },
    level: 5,
    tier: 1,
  },
  {
    id: 'herb_farshore_isle_6',
    zoneId: 'farshore_isle',
    type: 'herb',
    // Riftfields patch.
    pos: { x: 430, z: 8 },
    level: 5,
    tier: 1,
  },
];
