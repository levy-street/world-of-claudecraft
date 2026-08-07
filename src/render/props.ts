import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import {
  deinterleaveGeometry,
  mergeGeometries,
} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildingCameraHeight } from '../sim/building_layout';
import { mineMoundFootprint, STALL_HALF_D, STALL_HALF_W } from '../sim/colliders';
import { MOUNT_RACE_JUMP_FIXTURES } from '../sim/content/mounts';
import { BUILTIN_WORLD, getActiveWorldContent, WORLD_MIN_Z } from '../sim/data';
import {
  DOCK_SECTION_LOCAL_Z,
  DOCK_SECTION_SURFACE_Y,
  dockSurfaceLine,
  dockSurfaceYAt,
} from '../sim/dock_layout';
import {
  CHAPEL_HALL,
  CHAPEL_TOWER,
  DELVE_ARCH_SCALE,
  DOCK_BOAT,
  DOCK_DRESSING,
  delveArchMouthSign,
  delveArchZ,
  propPlacementRoll,
} from '../sim/prop_layout';
import { hash2 } from '../sim/rng';
import type { BuildingDef } from '../sim/types';
import { terrainHeight, WATER_LEVEL, waterLevel } from '../sim/world';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { attachBiomeHaze } from './biome_haze_field';
import { buildEastbrookGrandArmouryView } from './eastbrook_grand_armoury';
import {
  isEastbrookRebuildBuilding,
  isEastbrookRebuildFence,
  isEastbrookRebuildStall,
  isEastbrookRebuildWell,
} from './eastbrook_town';
import { indexExactVertexTuples } from './exact_index_geometry';
import {
  isFenbridgeRebuildBuilding,
  isFenbridgeRebuildStall,
  isFenbridgeRebuildWell,
} from './fenbridge_town';
import { EMISSIVE_LIGHT, GFX, type GfxSettings, sharedUniforms, surfaceMat } from './gfx';
import { applyOccluderFade, type OccluderFadeMat, occluderFadeMat } from './occluder_fade';
import { occluderFadeSettled, stepOccluderFade } from './occluder_fade_core';
import { type PropCellBounds, propCellKey, updatePropCell } from './prop_cell_core';
import { applySurfaceDetail, reapplySurfaceDetailToClone, wornFamilyFor } from './worn_stone';

// Static world props: buildings, tents, campfires, mines, ruins, docks,
// fences, graveyards — all real CC0 glTF assets (Quaternius medieval village +
// fantasy props, Kenney nature/pirate/graveyard/fantasy-town kits).
//
// Placement comes from the per-zone content modules (merged into PROPS by
// sim/data.ts) — the collider grid uses the same defs, so positions/footprints
// must not move. Each asset is scaled so its VISUAL footprint matches the
// analytic collider footprint (building w×d with the door on local +z, tent
// r=1.5*scale, crate 0.65, campfire 0.85, mud hut 1.1, ruin column 0.6, ...).
//
// Batching: repeated non-hideable kinds (headstones, fence modules, small
// dressing) become InstancedMesh per (asset part × z-band); one-off compositions
// and camera-ghost props stay as groups or are baked into world space and merged
// per (material, z-band). Converted materials are deduped per (kit, name) so
// the merge collapses to a handful of draws. Animated campfire flames + fire
// PointLights stay live objects.

export interface PropsResult {
  group: THREE.Group;
  flames: THREE.Mesh[]; // animated campfire flames
  windmillFans: THREE.Object3D[]; // live sail pivots the renderer spins
  fireLights: THREE.PointLight[];
  /**
   * Hides merged/instanced prop bands that sit entirely past the fog far plane,
   * and fades any camera-ghost prop crossing the current eye-to-camera segment
   * to 20% opacity so the chase cam sees through props without blanking them.
   */
  update(
    camX: number,
    camY: number,
    camZ: number,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    fogFar: number,
    dt: number,
    reducedMotion?: boolean,
  ): void;
}

const mergeBandDepth = (): number => (GFX.standardMaterials ? 180 : 90);

// ---------------------------------------------------------------------------
// Asset registry — loads kick off at module import; main.ts awaits
// assetsReady() before the Renderer is constructed, so buildProps() can read
// the resolved GLTFs synchronously.
// ---------------------------------------------------------------------------

interface PropAssetDef {
  url: string;
  /** material-dedup namespace (one kit shares flat materials across files) */
  kit: string;
  /** pre-rotation (radians) baked into geometry so the door/opening faces +z */
  yaw?: number;
  /** drop parts whose material name matches (e.g. the market cart's awning) */
  strip?: RegExp;
}

// exported for render/castle_features.ts, which instances the kcas castle
// set through the same registry (one preload gate, one manifest surface)
export const PROP_ASSET_DEFS: Record<string, PropAssetDef> = {
  house1: { url: '/models/props/house_1.glb', kit: 'village' },
  house2: { url: '/models/props/house_2.glb', kit: 'village', yaw: -Math.PI / 2 },
  house3: { url: '/models/props/house_3.glb', kit: 'village' },
  // Veiled Hollow town: KayKit Medieval Hexagon Pack buildings (CC0) with the
  // blue-colorway palette texture shifted to the Hollow's dusk violet (baked
  // into the *_hollow.glb files by tmp/make_kmed_hollow.mjs). Placed via the
  // BuildingDef kinds hollowHouse / hollowInn / hollowChapel / hollowSmith /
  // hollowMarket.
  kmedHomeA: { url: '/models/props/kmed_home_A_hollow.glb', kit: 'kmed' },
  kmedHomeB: { url: '/models/props/kmed_home_B_hollow.glb', kit: 'kmed' },
  kmedTavern: { url: '/models/props/kmed_tavern_hollow.glb', kit: 'kmed' },
  kmedChurch: { url: '/models/props/kmed_church_hollow.glb', kit: 'kmed' },
  kmedBlacksmith: { url: '/models/props/kmed_blacksmith_hollow.glb', kit: 'kmed' },
  kmedMarket: { url: '/models/props/kmed_market_hollow.glb', kit: 'kmed' },
  blacksmith: { url: '/models/props/blacksmith.glb', kit: 'village' },
  inn: { url: '/models/props/inn.glb', kit: 'village' },
  bellTower: { url: '/models/props/bell_tower.glb', kit: 'village' },
  well: { url: '/models/props/well.glb', kit: 'village' },
  stand1: { url: '/models/props/market_stand_1.glb', kit: 'village', yaw: -Math.PI / 2 },
  stand2: { url: '/models/props/market_stand_2.glb', kit: 'village', yaw: -Math.PI / 2 },
  cart: { url: '/models/props/cart.glb', kit: 'village', strip: /^(Red|Beige)$/ },
  fence: { url: '/models/props/fence.glb', kit: 'village' },
  bonfire: { url: '/models/props/bonfire.glb', kit: 'village' },
  oreRocks: { url: '/models/props/ore_rocks.glb', kit: 'ore' },
  tentOpen: { url: '/models/props/tent_open.glb', kit: 'tent', yaw: Math.PI },
  tentSmall: { url: '/models/props/tent_small.glb', kit: 'tent', yaw: Math.PI },
  rockTallA: { url: '/models/props/rock_tall_a.glb', kit: 'minerock' },
  rockTallH: { url: '/models/props/rock_tall_h.glb', kit: 'minerock' },
  rockLargeD: { url: '/models/props/rock_large_d.glb', kit: 'minerock' },
  rockLargeF: { url: '/models/props/rock_large_f.glb', kit: 'minerock' },
  mushroomRed: { url: '/models/props/mushroom_red.glb', kit: 'shroom' },
  mushroomTan: { url: '/models/props/mushroom_tan.glb', kit: 'shroom' },
  column: { url: '/models/props/column.glb', kit: 'nature' },
  columnBroken: { url: '/models/props/column_broken.glb', kit: 'nature' },
  statueHead: { url: '/models/props/statue_head.glb', kit: 'nature' },
  statueBlock: { url: '/models/props/statue_block.glb', kit: 'nature' },
  marshReeds: { url: '/models/props/reeds.glb', kit: 'nature' },
  dockPlatform: { url: '/models/props/dock_platform.glb', kit: 'pirate' },
  rowboat: { url: '/models/props/rowboat.glb', kit: 'pirate' },
  graveRound: { url: '/models/props/gravestone_round.glb', kit: 'grave' },
  graveCross: { url: '/models/props/gravestone_cross.glb', kit: 'grave' },
  graveBevel: { url: '/models/props/gravestone_bevel.glb', kit: 'grave' },
  graveDecor: { url: '/models/props/gravestone_decorative.glb', kit: 'grave' },
  timberPillar: { url: '/models/props/timber_pillar.glb', kit: 'town' },
  crateWooden: { url: '/models/props/crate_wooden.glb', kit: 'qprops' },
  farmCrate: { url: '/models/props/farmcrate_apple.glb', kit: 'qprops' },
  barrel: { url: '/models/props/barrel.glb', kit: 'qprops' },
  anvil: { url: '/models/props/anvil.glb', kit: 'qprops' },
  weaponStand: { url: '/models/props/weapon_stand.glb', kit: 'qprops' },
  lanternWall: { url: '/models/props/lantern_wall.glb', kit: 'qprops' },
  // Meshy-generated portal door used as the overworld Reliquary Hill marker;
  // has its own backing slab so the animated shader plane sits on the front face.
  // No yaw here: the geometry is CACHED and shared by every delve marker, so a
  // per-delve flip is applied to the placed group in buildProps, never baked.
  delveEntrance2: { url: '/models/dungeon/delve_entrance_2.glb', kit: 'dungeon' },
  // Show-jumping race fixtures (Highwatch stables paddock): the start/finish
  // arch and the two jump styles, placed from props.raceCourse (which mirrors
  // the MOUNT_RACE_COURSE content). Tripo-generated CC-authored set; their long
  // axis (the crossbar / arch face) is local +z.
  courseArch: { url: '/models/props/course_arch.glb', kit: 'stable' },
  jumpVertical: { url: '/models/props/jump_vertical.glb', kit: 'stable' },
  jumpOxer: { url: '/models/props/jump_oxer.glb', kit: 'stable' },
  // Veiled Hollow hand-placed decor, all user-made models: the Tripo pixie
  // house (pipeline-normalized: world scale, front on +z) and the flora
  // GLBs realm_flora.ts also scatters (near unit size, so decor entries set
  // an explicit scale; propAsset re-bases min-y to 0 at extraction).
  // Consumed via ZonePropsDef.decorProps.
  pixieMushroomHouse: { url: '/models/props/pixie_mushroom_house.glb', kit: 'hollow' },
  crystalAmethystCluster: { url: '/models/props/crystal_amethyst_cluster.glb', kit: 'hollow' },
  crystalMoundCave: { url: '/models/props/crystal_mound_cave.glb', kit: 'hollow' },
  starHeartCrystal: { url: '/models/props/star_heart_crystal.glb', kit: 'hollow' },
  kkWall: { url: '/models/dungeon/wall.glb', kit: 'dungeon' },
  kkWallCracked: { url: '/models/dungeon/wall_cracked.glb', kit: 'dungeon' },
  kkPillar: { url: '/models/dungeon/pillar.glb', kit: 'dungeon' },
  // The Evergarden's built garden: KayKit Medieval Hexagon Pack buildings in
  // their green colorway (shipped by scripts/assets/specs/biome_packs.json,
  // authored at hex-tile scale so decorProps entries carry a scale) plus the
  // wrought-iron garden fence/arch set from KayKit Halloween Bits (world
  // scale; specs/garden_town.json). All placed via EVERGARDEN_PROPS.decorProps.
  hexWindmill: { url: '/models/biome/hex_windmill.glb', kit: 'khex' },
  hexCastle: { url: '/models/biome/hex_castle.glb', kit: 'khex' },
  hexTower: { url: '/models/biome/hex_tower.glb', kit: 'khex' },
  hexWall: { url: '/models/biome/hex_wall.glb', kit: 'khex' },
  hexChurch: { url: '/models/biome/hex_church.glb', kit: 'khex' },
  hexTavern: { url: '/models/biome/hex_tavern.glb', kit: 'khex' },
  hexBlacksmith: { url: '/models/biome/hex_blacksmith.glb', kit: 'khex' },
  hexHomeA: { url: '/models/biome/hex_home_a.glb', kit: 'khex' },
  hexHomeB: { url: '/models/biome/hex_home_b.glb', kit: 'khex' },
  hexMarket: { url: '/models/biome/hex_market.glb', kit: 'khex' },
  hexWatchtower: { url: '/models/biome/hex_watchtower.glb', kit: 'khex' },
  hexCannonTower: { url: '/models/biome/hex_tower_cannon.glb', kit: 'khex' },
  hexBarracks: { url: '/models/biome/hex_barracks.glb', kit: 'khex' },
  hexCannonballs: { url: '/models/biome/hex_cannonballs.glb', kit: 'khex' },
  hexLumber: { url: '/models/biome/hex_lumber.glb', kit: 'khex' },
  hexWeaponRack: { url: '/models/biome/hex_weaponrack.glb', kit: 'khex' },
  hexFlag: { url: '/models/biome/hex_flag.glb', kit: 'khex' },
  hexWheelbarrow: { url: '/models/biome/hex_wheelbarrow.glb', kit: 'khex' },
  // the Wickharbor city set (blue colorway) plus the harbor line: ships,
  // docks, and the stackable tower drums the Old Beacon rebuilds from
  hexbHomeA: { url: '/models/biome/hexb_home_a.glb', kit: 'khex' },
  hexbHomeB: { url: '/models/biome/hexb_home_b.glb', kit: 'khex' },
  hexbTavern: { url: '/models/biome/hexb_tavern.glb', kit: 'khex' },
  hexbTownhall: { url: '/models/biome/hexb_townhall.glb', kit: 'khex' },
  hexbWorkshop: { url: '/models/biome/hexb_workshop.glb', kit: 'khex' },
  hexbMarket: { url: '/models/biome/hexb_market.glb', kit: 'khex' },
  hexbShipyard: { url: '/models/biome/hexb_shipyard.glb', kit: 'khex' },
  hexbStables: { url: '/models/biome/hexb_stables.glb', kit: 'khex' },
  hexbTowerBase: { url: '/models/biome/hexb_tower_base.glb', kit: 'khex' },
  hexbTowerA: { url: '/models/biome/hexb_tower_a.glb', kit: 'khex' },
  hexrTowerA: { url: '/models/biome/hexr_tower_a.glb', kit: 'khex' },
  hexbTowerB: { url: '/models/biome/hexb_tower_b.glb', kit: 'khex' },
  hexShipBlue: { url: '/models/biome/hex_ship_blue.glb', kit: 'khex' },
  hexShipRed: { url: '/models/biome/hex_ship_red.glb', kit: 'khex' },
  hexShipGreen: { url: '/models/biome/hex_ship_green.glb', kit: 'khex' },
  hexBoat: { url: '/models/biome/hex_boat.glb', kit: 'khex' },
  hexBoatrack: { url: '/models/biome/hex_boatrack.glb', kit: 'khex' },
  hexAnchor: { url: '/models/biome/hex_anchor.glb', kit: 'khex' },
  hexSack: { url: '/models/biome/hex_sack.glb', kit: 'khex' },
  hexCrateBig: { url: '/models/biome/hex_crate_big.glb', kit: 'khex' },
  hexCrateOpen: { url: '/models/biome/hex_crate_open.glb', kit: 'khex' },
  hexHaybale: { url: '/models/biome/hex_haybale.glb', kit: 'khex' },
  hexTrough: { url: '/models/biome/hex_trough.glb', kit: 'khex' },
  // the low scalloped stone wall (fences with kind 'stone'; length runs
  // along local +z in the authored piece)
  hexFenceStone: { url: '/models/biome/hexn_fence_stone.glb', kit: 'khex' },
  // the raider encampment set: spiked log wall (fences with kind
  // 'palisade'; length along local +x), red hide tents, and camp dressing
  hexnPalisade: { url: '/models/biome/hexn_palisade.glb', kit: 'khex' },
  hexrTent: { url: '/models/biome/hexr_tent.glb', kit: 'khex' },
  hexrWatchtower: { url: '/models/biome/hexr_watchtower.glb', kit: 'khex' },
  hexBarrel: { url: '/models/biome/hex_barrel.glb', kit: 'khex' },
  hexTarget: { url: '/models/biome/hex_target.glb', kit: 'khex' },
  hexFlagRed: { url: '/models/biome/hex_flag_red.glb', kit: 'khex' },
  hexCannon: { url: '/models/biome/hex_cannon.glb', kit: 'khex' },
  hexbWindmill: { url: '/models/biome/hexb_windmill.glb', kit: 'khex' },
  // the Galecrest monuments (maintainer-authored generated models): the
  // ship memorial on the Wickharbor dock plaza, the golden horse for the
  // stable yard
  shipMonument: { url: '/models/props/ship_monument.glb', kit: 'kgale' },
  goldenHorseStatue: { url: '/models/props/golden_horse_statue.glb', kit: 'kgale' },
  // a placeable oak (the foliage kit's biggest crown) for authored shade
  // spots like the Garden Gate lawns; decor entries set scale, r is trunk
  oakTree: { url: '/models/foliage/oak_4.glb', kit: 'kfol' },
  gardenIronFence: { url: '/models/props/garden_iron_fence.glb', kit: 'kiron' },
  gardenIronPillar: { url: '/models/props/garden_iron_pillar.glb', kit: 'kiron' },
  gardenIronGate: { url: '/models/props/garden_iron_gate.glb', kit: 'kiron' },
  gardenArch: { url: '/models/props/garden_arch.glb', kit: 'kiron' },
  // the user-authored leafy fox: a clipped-topiary statue crowning the
  // Evergarden's grandest flower beds (sibling models to the maze hedges)
  leafyFoxStatue: { url: '/models/props/leafy_fox_statue.glb', kit: 'kiron' },
  // the Evergarden's modeled flower beds (same maintainer-authored set);
  // their own kit so material dedupe never crosses into the iron props
  flowerBedSquareA: { url: '/models/props/flower_bed_square_a.glb', kit: 'kbeds' },
  flowerBedSquareB: { url: '/models/props/flower_bed_square_b.glb', kit: 'kbeds' },
  flowerBedRound: { url: '/models/props/flower_bed_round.glb', kit: 'kbeds' },
  stagShrine: { url: '/models/props/stag_shrine.glb', kit: 'hollow' },
  mushroomGiantPurple: { url: '/models/props/mushroom_giant_purple.glb', kit: 'hollow' },
  mushroomGlowCluster: { url: '/models/props/mushroom_glow_cluster.glb', kit: 'hollow' },
  flowerGlow: { url: '/models/props/flower_glow.glb', kit: 'hollow' },
  shrubFlowering: { url: '/models/props/shrub_flowering.glb', kit: 'hollow' },
  // The Drakelands castle structure set: KayKit Dungeon Remastered (CC0) pieces
  // at walkable scale (shipped by scripts/assets/specs/drakelands_castle.json):
  // curtain walls, gates, stairs, battlement barriers, floors, red banners,
  // torches, rubble, and keep furnishings for the great hall.
  kcasWall: { url: '/models/biome/kcas_wall.glb', kit: 'kcas' },
  kcasWallHalf: { url: '/models/biome/kcas_wall_half.glb', kit: 'kcas' },
  kcasWallCorner: { url: '/models/biome/kcas_wall_corner.glb', kit: 'kcas' },
  kcasWallGated: { url: '/models/biome/kcas_wall_gated.glb', kit: 'kcas' },
  kcasWallDoorway: { url: '/models/biome/kcas_wall_doorway.glb', kit: 'kcas' },
  kcasWallBroken: { url: '/models/biome/kcas_wall_broken.glb', kit: 'kcas' },
  kcasWallCracked: { url: '/models/biome/kcas_wall_cracked.glb', kit: 'kcas' },
  kcasWallWindow: { url: '/models/biome/kcas_wall_window.glb', kit: 'kcas' },
  kcasWallPillar: { url: '/models/biome/kcas_wall_pillar.glb', kit: 'kcas' },
  kcasStairsWide: { url: '/models/biome/kcas_stairs_wide.glb', kit: 'kcas' },
  kcasStairsWalled: { url: '/models/biome/kcas_stairs_walled.glb', kit: 'kcas' },
  kcasBarrier: { url: '/models/biome/kcas_barrier.glb', kit: 'kcas' },
  kcasBarrierHalf: { url: '/models/biome/kcas_barrier_half.glb', kit: 'kcas' },
  kcasBarrierCorner: { url: '/models/biome/kcas_barrier_corner.glb', kit: 'kcas' },
  kcasColumn: { url: '/models/biome/kcas_column.glb', kit: 'kcas' },
  kcasPillar: { url: '/models/biome/kcas_pillar.glb', kit: 'kcas' },
  kcasFloorLarge: { url: '/models/biome/kcas_floor_large.glb', kit: 'kcas' },
  kcasFloorWeeds: { url: '/models/biome/kcas_floor_weeds.glb', kit: 'kcas' },
  kcasFoundation: { url: '/models/biome/kcas_foundation.glb', kit: 'kcas' },
  kcasBannerRedA: { url: '/models/biome/kcas_banner_red_a.glb', kit: 'kcas' },
  kcasBannerRedShield: { url: '/models/biome/kcas_banner_red_shield.glb', kit: 'kcas' },
  kcasBannerRedTriple: { url: '/models/biome/kcas_banner_red_triple.glb', kit: 'kcas' },
  kcasTorch: { url: '/models/biome/kcas_torch.glb', kit: 'kcas' },
  kcasTorchMounted: { url: '/models/biome/kcas_torch_mounted.glb', kit: 'kcas' },
  kcasRubbleLarge: { url: '/models/biome/kcas_rubble_large.glb', kit: 'kcas' },
  kcasRubbleHalf: { url: '/models/biome/kcas_rubble_half.glb', kit: 'kcas' },
  kcasRocks: { url: '/models/biome/kcas_rocks.glb', kit: 'kcas' },
  kcasChestGold: { url: '/models/biome/kcas_chest_gold.glb', kit: 'kcas' },
  kcasTableLong: { url: '/models/biome/kcas_table_long.glb', kit: 'kcas' },
  kcasBench: { url: '/models/biome/kcas_bench.glb', kit: 'kcas' },
  kcasBookcase: { url: '/models/biome/kcas_bookcase.glb', kit: 'kcas' },
  kcasKeg: { url: '/models/biome/kcas_keg.glb', kit: 'kcas' },
  kcasBarrel: { url: '/models/biome/kcas_barrel.glb', kit: 'kcas' },
  // The Last Keep's lived-in interior furniture (KayKit Dungeon Remastered
  // tavern set, already committed under public/models/dungeon): beds for the
  // residence wing, seating and clothed tables for the dining rooms, shelves,
  // buffet counters, candelabra, stores, and the chapel shrine. Instanced by
  // src/render/lastkeep_dressing.ts through this same registry (one preload
  // gate, one manifest surface).
  kcasBedRoyal: { url: '/models/dungeon/bed_decorated.glb', kit: 'kcas' },
  kcasBedDouble: { url: '/models/dungeon/bed_b_double.glb', kit: 'kcas' },
  kcasBedSingle: { url: '/models/dungeon/bed_b_single.glb', kit: 'kcas' },
  kcasBedBunk: { url: '/models/dungeon/bed_a_stacked.glb', kit: 'kcas' },
  kcasBedCot: { url: '/models/dungeon/bed_a_single.glb', kit: 'kcas' },
  kcasBedroll: { url: '/models/dungeon/bed_floor.glb', kit: 'kcas' },
  kcasChair: { url: '/models/dungeon/chair.glb', kit: 'kcas' },
  kcasStool: { url: '/models/dungeon/stool.glb', kit: 'kcas' },
  kcasTableRoundSmall: { url: '/models/dungeon/table_round_small.glb', kit: 'kcas' },
  kcasTableRoundMedium: { url: '/models/dungeon/table_round_medium.glb', kit: 'kcas' },
  // NOTE: the laid feast table (table_long_tablecloth_decorated_a) is already
  // registered above as kcasTableLong (/models/biome/kcas_table_long.glb), so
  // only the PLAIN clothed table is a new entry.
  kcasTableCloth: { url: '/models/dungeon/table_long_tablecloth.glb', kit: 'kcas' },
  kcasShelfLarge: { url: '/models/dungeon/shelf_large.glb', kit: 'kcas' },
  kcasShelfSmall: { url: '/models/dungeon/shelf_small.glb', kit: 'kcas' },
  kcasShelfBooks: { url: '/models/dungeon/shelf_small_books.glb', kit: 'kcas' },
  kcasShelfCandles: { url: '/models/dungeon/shelf_small_candles.glb', kit: 'kcas' },
  kcasBarA: { url: '/models/dungeon/bar_straight_a.glb', kit: 'kcas' },
  kcasBarB: { url: '/models/dungeon/bar_straight_b.glb', kit: 'kcas' },
  kcasBarC: { url: '/models/dungeon/bar_straight_c.glb', kit: 'kcas' },
  kcasBartopMedium: { url: '/models/dungeon/bartop_a_medium.glb', kit: 'kcas' },
  kcasCandleTriple: { url: '/models/dungeon/candle_triple.glb', kit: 'kcas' },
  kcasCrateLarge: { url: '/models/dungeon/crate_large.glb', kit: 'kcas' },
  kcasCrateSmall: { url: '/models/dungeon/crate_small.glb', kit: 'kcas' },
  kcasCratesStacked: { url: '/models/dungeon/crates_stacked.glb', kit: 'kcas' },
  kcasSwordShield: { url: '/models/dungeon/sword_shield.glb', kit: 'kcas' },
  kcasShrine: { url: '/models/dungeon/shrine_candles.glb', kit: 'kcas' },
  // The Drakelands castle bailey: KayKit Medieval Hexagon Pack buildings in the
  // red colorway (same drakelands_castle.json spec; hex-tile scale, so decor
  // entries carry scale like the other hex buildings).
  hexrCastle: { url: '/models/biome/hexr_castle.glb', kit: 'khex' },
  hexrTownhall: { url: '/models/biome/hexr_townhall.glb', kit: 'khex' },
  hexrBarracks: { url: '/models/biome/hexr_barracks.glb', kit: 'khex' },
  hexrChurch: { url: '/models/biome/hexr_church.glb', kit: 'khex' },
  hexrTavern: { url: '/models/biome/hexr_tavern.glb', kit: 'khex' },
  hexrStables: { url: '/models/biome/hexr_stables.glb', kit: 'khex' },
  hexrHomeA: { url: '/models/biome/hexr_home_a.glb', kit: 'khex' },
  hexrHomeB: { url: '/models/biome/hexr_home_b.glb', kit: 'khex' },
  hexrMarket: { url: '/models/biome/hexr_market.glb', kit: 'khex' },
  hexrBlacksmith: { url: '/models/biome/hexr_blacksmith.glb', kit: 'khex' },
  hexrWindmill: { url: '/models/biome/hexr_windmill.glb', kit: 'khex' },
  hexrArcheryrange: { url: '/models/biome/hexr_archeryrange.glb', kit: 'khex' },
  hexrTowerCatapult: { url: '/models/biome/hexr_tower_catapult.glb', kit: 'khex' },
  hexrTowerBase2: { url: '/models/biome/hexr_tower_base.glb', kit: 'khex' },
};

type PropKey = keyof typeof PROP_ASSET_DEFS;

const loadedProps = new Map<string, GLTF>();
const propLoadTasks = new Map<string, Promise<void>>();
const ALL_PROP_KEYS = Object.keys(PROP_ASSET_DEFS) as PropKey[];

// The props the renderer actually RENDERS at the low graphics tier: a subset, since
// low gfx drops the decorative/secondary props (anvils, extra rocks, statues, ...).
// Medium and higher render every entry in PROP_ASSET_DEFS. All four headstone
// shapes stay on every tier: their colliders carry per-shape standable heights,
// and a tier may never desync what is drawn from what blocks. This list scopes
// ONLY the per-tier work (material prewarm); it is deliberately NOT the preload
// set (see preloadPropKeys below).
const LOW_TIER_PROP_KEYS: readonly PropKey[] = [
  'house1',
  'house2',
  'house3',
  'blacksmith',
  'inn',
  'bellTower',
  'well',
  'stand1',
  'stand2',
  'cart',
  'fence',
  'bonfire',
  'oreRocks',
  'tentOpen',
  'tentSmall',
  'rockLargeD',
  'mushroomRed',
  'column',
  'columnBroken',
  'dockPlatform',
  'rowboat',
  'graveRound',
  'hexFenceStone',
  'hexnPalisade',
  'graveCross',
  'graveBevel',
  'graveDecor',
  'timberPillar',
  'marshReeds',
  'crateWooden',
  'barrel',
  'delveEntrance2', // delve entrance portal, a landmark, so keep it on low gfx too
  // The race fixtures are GAMEPLAY landmarks (players ride a timed course
  // against them), so every tier renders them: hiding one on low gfx would
  // break the gameplay-neutral graphics invariant.
  'courseArch',
  'jumpVertical',
  'jumpOxer',
];

/**
 * The props to PRELOAD, given the graphics tier guessed when this module was first
 * imported. This MUST be tier-INDEPENDENT.
 *
 * buildProps() places props from the LIVE GFX tier, which is resolved later: the
 * Renderer calls initGfxTier() (which reassigns the GFX global from the real WebGL
 * context) AFTER this module froze its import-time GFX best-guess. If the import-time
 * guess comes in LOWER than the render tier (e.g. a weak/hybrid-GPU probe guesses low,
 * the high-performance renderer then resolves medium+), a tier-SCOPED preload set
 * would omit props that buildProps then places, and propAsset() throws "prop asset
 * not preloaded", the v0.16.0 farmCrate crash on world entry (red "Could not start
 * the renderer" overlay). So every tier preloads the full PROP_ASSET_DEFS, mirroring
 * foliage.ts, which sources its one frozen MODEL_URLS list for both preload and
 * placement and is structurally immune to this class of bug. Because every placement
 * key is typed PropKey (a key of PROP_ASSET_DEFS), the full set is provably a superset
 * of anything buildProps can place, on every tier and device.
 *
 * The arg is retained to document the invariant and to let the guard test assert it at
 * the lowest (most dangerous) import tier; the result intentionally ignores it.
 */
function preloadPropKeys(_importTierStandardMaterials: boolean): Set<PropKey> {
  return new Set<PropKey>(ALL_PROP_KEYS);
}

let deferredPropKeys: ReadonlySet<PropKey> | null = null;
function deferredPropKeysForBoot(): ReadonlySet<PropKey> {
  deferredPropKeys ??= preloadPropKeys(GFX.standardMaterials);
  return deferredPropKeys;
}

function profilePropKeys(target: Readonly<GfxSettings>): readonly PropKey[] {
  return target.standardMaterials ? ALL_PROP_KEYS : LOW_TIER_PROP_KEYS;
}

function preparePropSource(key: PropKey): Promise<void> {
  if (loadedProps.has(key)) return Promise.resolve();
  const existing = propLoadTasks.get(key);
  if (existing) return existing;
  const task = loadGltf(PROP_ASSET_DEFS[key].url)
    .then((gltf) => {
      loadedProps.set(key, gltf);
      propLoadTasks.delete(key);
    })
    .catch((err) => {
      propLoadTasks.delete(key);
      throw err;
    });
  propLoadTasks.set(key, task);
  return task;
}

/** Prepare the prop source set selected by an explicit target profile. */
export function preparePropProfileAssets(target: Readonly<GfxSettings>): Promise<void> {
  // Existing extracted keys belong to the active renderer. Reload their
  // released source scenes before the coordinator clears derived caches, so
  // its old-profile rollback arm can still rebuild after a target failure.
  const keys = new Set<PropKey>([
    ...profilePropKeys(target),
    ...(extractCache.keys() as MapIterator<PropKey>),
  ]);
  return Promise.all([...keys].map(preparePropSource)).then(() => undefined);
}

for (const key of ALL_PROP_KEYS) {
  registerDeferredPreload(() => {
    // Resolve GFX when the deferred lane opens, after startup safety and device
    // defaults have settled. The boot set remains the historical cross-tier
    // superset; live profile preparation may load only the requested target.
    if (!deferredPropKeysForBoot().has(key)) return Promise.resolve();
    return preparePropSource(key).then(() => {
      // Preserve the packaged-iOS boot path: extract each source as it lands
      // and release its parsed scene before the renderer build.
      if (GFX.nativeIosMemoryProfile) propAsset(key);
    });
  });
}

/** Dev-channel residency accounting sources (see assets/residency_budget.ts). */
export function propResidencySources(): {
  extractedGeometries: THREE.BufferGeometry[];
  parsedScenes: THREE.Object3D[];
} {
  return {
    extractedGeometries: [...extractCache.values()].flatMap((a) => a.parts.map((p) => p.geo)),
    parsedScenes: [...loadedProps.values()].map((g) => g.scene),
  };
}

/** Test-only window into the preload/prewarm key sets (see tests/render_asset_preload). */
export const propPreloadInternalsForTest = {
  allPropKeys: ALL_PROP_KEYS,
  lowTierPropKeys: LOW_TIER_PROP_KEYS,
  preloadPropKeys,
  propAssetUrl: Object.fromEntries(
    Object.entries(PROP_ASSET_DEFS).map(([key, def]) => [key, def.url]),
  ) as Record<string, string>,
};

// Per-material look overrides, keyed `${kit}:${name}` (falls back to name).
// Kenney/Quaternius flat materials need small nudges to sit in our lighting.
const MAT_OVERRIDES: Record<
  string,
  {
    color?: number;
    emissive?: number;
    emissiveIntensity?: number;
    metalness?: number;
    roughness?: number;
  }
> = {
  'village:Windows': { emissive: 0x2a3c55, emissiveIntensity: 1.1, roughness: 0.4 },
  'village:Bell': { metalness: 0.6, roughness: 0.35 },
  'ore:Stone_Dark': { color: 0xb87333, metalness: 0.45, roughness: 0.5 },
  // bandit/cult tents: weathered canvas instead of Kenney's toy red
  'tent:colorRed': { color: 0x9c8662 },
  'tent:colorRedDark': { color: 0x6e5c42 },
  // murloc huts: a giant mushroom recolored to read as a woven thatch dome
  'shroom:colorRed': { color: 0xb29459 },
  'shroom:_defaultMat': { color: 0xc9b896 },
  // mine mound: Kenney nature rocks are beige dirt + teal grass — regrade to
  // granite with a dull moss cap so the pile reads as blasted rock
  'minerock:dirt': { color: 0x82868a },
  'minerock:grass': { color: 0x77846a },
  'minerock:_defaultMat': { color: 0x6f7376 },
  // graveyard colormap is near-white; knock it toward weathered stone
  'grave:colormap': { color: 0xd2d2c8 },
};

// Kits that take the shared triplanar surface-detail layer route through the
// one family table in worn_stone.ts (wornFamilyFor): kit-wide stone entries
// (khex, kiron, minerock) plus per-material-NAME wood/stone/plaster routing
// for the village-architecture kits. Kit membership and the SOURCE material
// name are already part of the material cache key below, so application is
// deterministic per cached material.

// ---------------------------------------------------------------------------
// Extraction: GLTF scene -> world-baked float-attribute geometry + converted
// shared materials. Geometries are CLONES — the cached GLTF stays pristine
// for any other consumer, and the static merge may freely dispose ours.
// ---------------------------------------------------------------------------

interface AssetPart {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  /** source mesh name (picks out animated parts like the windmill fan) */
  name: string;
}
interface PropAsset {
  parts: AssetPart[];
  size: THREE.Vector3;
}

const extractCache = new Map<string, PropAsset>();
const matConvCache = new Map<string, THREE.Material>();

/** Drop profile-derived prop geometry/materials while retaining unresolved source recipes. */
export function resetPropProfileCaches(): void {
  extractCache.clear();
  matConvCache.clear();
  delvePortalMatCache.clear();
  drowningVeilMatCache.clear();
}

/** Kit materials whose NAME marks them as metal (measured across the shipped
 *  kits: MI_Trim_Metal, WornIron, ArmouryMetal, MailboxMetal). Kept in
 *  lockstep with quest_objects.ts. */
export const METAL_MAT_NAME = /metal|iron|gold|steel/i;

/** denormalized float copy — meshopt/quantized attrs must not be transformed in place */
function toFloatAttr(
  attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  itemSize: number,
): THREE.BufferAttribute {
  const out = new Float32Array(attr.count * itemSize);
  for (let i = 0; i < attr.count; i++) {
    out[i * itemSize] = attr.getX(i);
    if (itemSize > 1) out[i * itemSize + 1] = attr.getY(i);
    if (itemSize > 2) out[i * itemSize + 2] = attr.getZ(i);
  }
  return new THREE.BufferAttribute(out, itemSize);
}

function convertMaterial(
  src: THREE.Material,
  kit: string,
  hasVertexColors: boolean,
): THREE.Material {
  const s = src as THREE.MeshStandardMaterial; // basic (unlit) shares the fields we read
  const ov = MAT_OVERRIDES[`${kit}:${s.name}`] ?? MAT_OVERRIDES[s.name];
  // hasVertexColors must key the cache: kits share material names between
  // COLOR_0 meshes (trim 'Vertex' props) and colorless ones — a shared
  // vertexColors:true material would render the colorless meshes black
  // The alpha cutout and sidedness the asset authored (glTF alphaMode MASK +
  // alphaCutoff + doubleSided, already resolved by GLTFLoader) must survive the
  // rebuild, and must key the cache: almost every prop is solid geometry, but a
  // cutout one (the placeable oak's leaf cards) renders as opaque quads without
  // them, and would otherwise share a cached material with an opaque namesake.
  const alphaTest = s.alphaTest ?? 0;
  const key = `${kit}|${s.name}|${s.color?.getHexString() ?? ''}|${s.map ? 'm' : ''}|${hasVertexColors ? 'v' : ''}|${GFX.standardMaterials ? 's' : 'l'}|a${alphaTest}|d${s.side}`;
  const cached = matConvCache.get(key);
  if (cached) return cached;
  const color =
    ov?.color !== undefined
      ? new THREE.Color(ov.color)
      : (s.color?.clone() ?? new THREE.Color(0xffffff));
  const map = s.map ?? null;
  // Tripo-generated 'hollow' kit: one baked painterly albedo per model, glow
  // painted in, smooth normals. Two nudges make them sit beside the
  // hand-authored kits: flat shading (faceted low-poly light response) and a
  // soft albedo re-emit (the realm_flora mushroom trick) so painted windows,
  // lanterns, and crystals actually shine under the permanent dusk.
  const hollow = kit === 'hollow';
  const hollowEmissive = hollow && map;
  let mat: THREE.Material;
  if (GFX.standardMaterials) {
    mat = new THREE.MeshStandardMaterial({
      color,
      map,
      alphaTest,
      side: s.side,
      vertexColors: hasVertexColors,
      flatShading: hollow,
      normalMap: s.normalMap ?? null,
      roughnessMap: s.roughnessMap ?? null,
      metalnessMap: s.metalnessMap ?? null,
      aoMap: s.aoMap ?? null,
      roughness: ov?.roughness ?? (hollow ? 0.85 : s.isMeshStandardMaterial ? s.roughness : 0.9),
      // The kit exporter ships an accidental metallicFactor 0.4 on hundreds
      // of dielectric palette materials (wood carts outshone actual anvils),
      // so only metal-NAMED materials keep their authored metalness; every
      // other family is dielectric, and the metal surface-detail layer below
      // supplies the real per-texel metalness on top.
      metalness:
        ov?.metalness ??
        (s.isMeshStandardMaterial && METAL_MAT_NAME.test(s.name) ? Math.min(s.metalness, 0.85) : 0),
      emissive: new THREE.Color(hollowEmissive ? 0xffffff : (ov?.emissive ?? 0x000000)),
      emissiveMap: hollowEmissive ? map : null,
      emissiveIntensity: hollowEmissive ? 0.3 : (ov?.emissiveIntensity ?? 1),
      // Metal-named kit materials (MI_Trim_Metal, WornIron, ...) get a mild
      // per-material env boost so anvils/fittings catch the sky IBL; the name
      // is already part of the cache key above. Everything else keeps the
      // default 1 (the metal surface-detail family below raises its own floor
      // via envMapMin, taking the max of the two).
      envMapIntensity: METAL_MAT_NAME.test(s.name) ? 1.3 : 1,
    });
  } else {
    mat = new THREE.MeshLambertMaterial({
      color,
      map,
      alphaTest,
      side: s.side,
      vertexColors: hasVertexColors,
      flatShading: hollow,
      emissive: new THREE.Color(hollowEmissive ? 0xffffff : (ov?.emissive ?? 0x000000)),
      emissiveMap: hollowEmissive ? map : null,
      emissiveIntensity: hollowEmissive ? 0.2 : (ov?.emissiveIntensity ?? 1) * 0.6,
    });
  }
  // Triplanar surface-detail layer, applied before caching so every consumer
  // of the shared per-key material carries it (the helper self-gates to
  // standard materials, so the Lambert branch is a no-op). Routing matches on
  // the SOURCE material name (s.name), which keys the cache; the context
  // flags keep emissive/transparent surfaces clean and let Tripo props that
  // ship their own PBR maps skip the bare-coverage fallback.
  const worn = wornFamilyFor(kit, s.name, {
    emissive: !!hollowEmissive || (ov?.emissive ?? 0) !== 0,
    transparent: s.transparent === true,
    hasOwnMaps: !!(s.normalMap || s.roughnessMap),
  });
  if (worn) {
    applySurfaceDetail(mat as THREE.MeshStandardMaterial, worn.family, {
      strength: worn.strength,
    });
  }
  // Distant-zone air (biome_haze_field.ts): every converted kit material
  // hazes with the ground under it, chained over the worn-detail hook.
  attachBiomeHaze(mat);
  mat.name = `${kit}:${s.name}`;
  matConvCache.set(key, mat);
  return mat;
}

/** parts of a loaded asset, world-baked (incl. yaw), origin centered at the
 *  footprint center with min-y at 0, materials converted + deduped */
function propAsset(key: PropKey): PropAsset {
  const cached = extractCache.get(key);
  if (cached) return cached;
  const def = PROP_ASSET_DEFS[key];
  const gltf = loadedProps.get(key);
  if (!gltf) throw new Error(`prop asset not preloaded: ${key} (${def.url})`);
  gltf.scene.updateMatrixWorld(true);
  const parts: AssetPart[] = [];
  const yawM = def.yaw ? new THREE.Matrix4().makeRotationY(def.yaw) : null;
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const srcMat = mesh.material as THREE.Material;
    if (def.strip?.test(srcMat.name)) return;
    const src = mesh.geometry;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', toFloatAttr(src.getAttribute('position'), 3));
    if (src.getAttribute('normal'))
      geo.setAttribute('normal', toFloatAttr(src.getAttribute('normal'), 3));
    const uv = src.getAttribute('uv');
    geo.setAttribute(
      'uv',
      uv
        ? toFloatAttr(uv, 2)
        : new THREE.BufferAttribute(
            new Float32Array((src.getAttribute('position') as THREE.BufferAttribute).count * 2),
            2,
          ),
    );
    // authored vertex tints (trim-kit 'Vertex' materials depend on them);
    // toFloatAttr denormalizes the uint8 COLOR_0, alpha is 1.0 kit-wide
    const col = src.getAttribute('color');
    if (col) geo.setAttribute('color', toFloatAttr(col, 3));
    if (src.index) geo.setIndex(src.index.clone());
    geo.applyMatrix4(mesh.matrixWorld);
    if (yawM) geo.applyMatrix4(yawM);
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    parts.push({ geo, mat: convertMaterial(srcMat, def.kit, !!col), name: mesh.name });
  });
  if (!parts.length) throw new Error(`prop asset has no meshes: ${key}`);
  // normalize origin: xz-center at 0, base at y=0
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geo.computeBoundingBox();
    box.union(p.geo.boundingBox as THREE.Box3);
  }
  const cx = (box.min.x + box.max.x) / 2,
    cz = (box.min.z + box.max.z) / 2;
  for (const p of parts) {
    p.geo.translate(-cx, -box.min.y, -cz);
    p.geo.computeBoundingBox();
    p.geo.computeBoundingSphere();
  }
  const asset: PropAsset = { parts, size: box.getSize(new THREE.Vector3()) };
  extractCache.set(key, asset);
  // The extracted float geometry and converted materials are now authoritative.
  // Release the parsed scene's duplicate source buffers without disposing shared
  // textures that the converted materials still reference.
  loadedProps.delete(key);
  releaseGltf(def.url);
  return asset;
}

export function buildPropMaterialPrewarmGroup(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'prop-material-prewarm';
  group.visible = true;
  group.userData.renderCategory = 'prewarm';
  const seen = new Set<string>();
  let idx = 0;
  const instanceMatrix = new THREE.Matrix4();
  const place = (obj: THREE.Object3D): void => {
    const col = idx % 10;
    const row = Math.floor(idx / 10) % 8;
    const layer = Math.floor(idx / 80);
    obj.position.set((col - 4.5) * 1.2, row * 0.85, -8 - layer * 1.5);
    obj.scale.setScalar(0.08);
    obj.frustumCulled = false;
    group.add(obj);
    idx++;
  };
  // castShadow so the depth/shadow program variant compiles too (ultra renders a
  // shadow pass; structures cast shadows live). instanceColor covers the tinted
  // instance variant the way the live placed props do; the plain InstancedMesh
  // and Mesh cover the untinted and non-instanced paths.
  const white = new THREE.Color(1, 1, 1);
  // Prewarm only the props that actually render at the LIVE tier (this runs after
  // initGfxTier via the Renderer, so GFX is authoritative here, unlike the import-time
  // best-guess): low renders the LOW_TIER_PROP_KEYS subset, medium+ renders the full
  // catalog. Keying off the live tier rather than an import-frozen guess means a low
  // import guess on a medium+ renderer still prewarms every prop it will draw, so the
  // props the low subset omits do not take a first-frame shader-compile hitch.
  const prewarmKeys = GFX.standardMaterials ? ALL_PROP_KEYS : LOW_TIER_PROP_KEYS;
  for (const key of prewarmKeys) {
    const asset = propAsset(key);
    for (const part of asset.parts) {
      const matKey = `${part.mat.uuid}:${part.geo.getAttribute('color') ? 'color' : 'plain'}`;
      if (seen.has(matKey)) continue;
      seen.add(matKey);
      const mesh = new THREE.Mesh(part.geo, part.mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      place(mesh);
      const instanced = new THREE.InstancedMesh(part.geo, part.mat, 1);
      instanced.setMatrixAt(0, instanceMatrix.identity());
      instanced.instanceMatrix.needsUpdate = true;
      instanced.castShadow = true;
      instanced.receiveShadow = true;
      place(instanced);
      const tinted = new THREE.InstancedMesh(part.geo, part.mat, 1);
      tinted.setMatrixAt(0, instanceMatrix.identity());
      tinted.setColorAt(0, white);
      tinted.instanceMatrix.needsUpdate = true;
      if (tinted.instanceColor) tinted.instanceColor.needsUpdate = true;
      tinted.castShadow = true;
      tinted.receiveShadow = true;
      place(tinted);
    }
  }
  return group;
}

// ---------------------------------------------------------------------------
// deterministic per-prop rand streams (no native random — placement is shared
// with colliders/tests via the world seed)
// ---------------------------------------------------------------------------

// The shared per-prop placement roll (sim/prop_layout.ts): colliders derive
// per-point shapes (camp crate kind and scale, relic poses) from the SAME
// draw, so mesh and physics agree per placement.
const propRand = propPlacementRoll;

// Village-building pools and heights, shared by the placement loop in
// buildProps and by the far-field impostor collector below so the sprite a
// building becomes is always the asset it really renders as.
const HOUSE_POOL: PropKey[] = ['house1', 'house2', 'blacksmith'];
const HOUSE_POOL_HOLLOW: PropKey[] = ['kmedHomeA', 'kmedHomeB'];
const HOUSE_HEIGHT: Record<string, number> = {
  house1: 8.0,
  house2: 7.6,
  blacksmith: 6.6,
  inn: 7.6,
  kmedHomeA: 8.0,
  kmedHomeB: 8.8,
  kmedTavern: 8.5,
  kmedChurch: 10.5,
  kmedBlacksmith: 6.2,
  kmedMarket: 5.2,
};
// single-asset (non-pool) building kinds
const KIND_ASSET: Partial<Record<BuildingDef['kind'], PropKey>> = {
  inn: 'inn',
  hollowInn: 'kmedTavern',
  hollowChapel: 'kmedChurch',
  hollowSmith: 'kmedBlacksmith',
  hollowMarket: 'kmedMarket',
};

function keyRand(key: number, n: number): number {
  return hash2(Math.round(key * 97), n * 7919, 0x9e3779);
}

// Rotate a parent-local XZ offset by the parent's yaw (colliders.rotY twin).
function rotLocal(lx: number, lz: number, rot: number): { x: number; z: number } {
  const c = Math.cos(rot),
    s = Math.sin(rot);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

/**
 * The chapel bell tower's WORLD center: its CHAPEL_TOWER.dz rear offset
 * rotated by the building yaw. The one transform the real composed chapel
 * (its hideable footprint), the camera collider and the far IMPOSTOR all
 * derive from; an impostor centered at the raw (b.x, b.z) instead sits
 * dz off its real twin and jumps sideways at the handoff.
 */
export function chapelTowerWorldCenter(b: { x: number; z: number; rot: number }): {
  x: number;
  z: number;
} {
  const off = rotLocal(0, CHAPEL_TOWER.dz, b.rot);
  return { x: b.x + off.x, z: b.z + off.z };
}

/**
 * The one house-asset pick for a building record: the same pool and the
 * same keyRand draw whether the consumer is the real placement loop or the
 * impostor collector, so a far sprite can never disagree with the model it
 * hands off to.
 */
function buildingAssetPick(b: { x: number; z: number; kind: BuildingDef['kind'] }): PropKey {
  const key = b.x * 13.7 + b.z * 3.1;
  const pool = b.kind === 'hollowHouse' ? HOUSE_POOL_HOLLOW : HOUSE_POOL;
  return KIND_ASSET[b.kind] ?? pool[Math.floor(keyRand(key, 3) * 0.999 * pool.length)];
}

type Scale = number | [number, number, number];

function setScale(o: THREE.Object3D, s: Scale): void {
  if (typeof s === 'number') o.scale.setScalar(s);
  else o.scale.set(s[0], s[1], s[2]);
}

// ---------------------------------------------------------------------------
// Delve-mouth portal: a self-animating red "void" sheet that fills the entrance
// arch, driven by the shared uTime clock (no per-frame JS plumbing, same
// pattern as the Drowned-Temple water in dungeon.ts). A churning swirl + a
// global breathing pulse take a deep near-black red up to a hot bright red; the
// circular alpha mask hides the plane's rectangular edges so it reads as a glowing
// mouth. On the composer tiers the hot core is pushed past 1.0 (uHdr) so it
// blooms; on low/headless (no composer) the colour stays saturated so it still
// reads without bloom.
// ---------------------------------------------------------------------------
const DELVE_PORTAL_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWPos;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWPos = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const DELVE_PORTAL_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDim;
  uniform vec3 uBright;
  uniform vec3 uRim;
  uniform float uHdr;
  varying vec2 vUv;
  varying vec3 vWPos;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    vec2 p = vUv * 2.0 - 1.0; // centre-origin -1..1
    float r = length(p);

    // spinning vortex: angular phase + time rotates concentric rings inward
    float angle  = atan(p.y, p.x) / (2.0 * PI); // 0..1 around the disc
    float vortex = sin((angle + uTime * 0.10) * PI * 12.0 + r * 10.0 - uTime * 2.0) * 0.5 + 0.5;

    // three churning noise layers for organic variation
    float swirl = sin(p.x * 5.0 + uTime * 1.0)
                + sin(p.y * 6.0 - uTime * 0.85)
                + sin((p.x + p.y) * 4.5 + uTime * 0.65);
    float churn = 0.5 + 0.28 * (swirl / 3.0);

    // slow ominous breathing pulse
    float pulse = 0.5 + 0.5 * sin(uTime * 0.85);

    // hot outer rim (caller-tinted; crimson by default, watery cyan for the drowned shrine)
    vec3 rimCol = uRim * uHdr;

    // zone blending: void core (uDim) → mid swirl (uBright) → rim
    float toMid  = smoothstep(0.06, 0.55, r);
    float toRim  = smoothstep(0.45, 0.85, r);
    float ringEnergy = vortex * churn * smoothstep(0.90, 0.05, r);

    vec3 col = uDim;
    col = mix(col, uBright, toMid * (0.55 + 0.45 * ringEnergy));
    col = mix(col, rimCol,  toRim * (0.45 + 0.55 * pulse));
    col += uBright * smoothstep(0.28, 0.0, r) * 0.6 * uHdr; // core bloom

    // fill the whole opening as a dark solid portal; feather only the outer rim
    vec2 e = abs(p);
    float fill = (1.0 - smoothstep(0.76, 1.0, e.x)) * (1.0 - smoothstep(0.76, 1.0, e.y));
    float alpha = fill * (0.93 + 0.07 * pulse);

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const delvePortalMatCache = new Map<string, THREE.ShaderMaterial>();
function delvePortalMaterial(dim: number, bright: number, rim: number): THREE.ShaderMaterial {
  const key = `${dim}_${bright}_${rim}`;
  let mat = delvePortalMatCache.get(key);
  if (mat) return mat;
  mat = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: sharedUniforms.uTime,
      uDim: { value: new THREE.Color(dim) },
      uBright: { value: new THREE.Color(bright) },
      uRim: { value: new THREE.Color(rim) },
      uHdr: { value: GFX.composer ? 2.8 : 1.0 },
    },
    vertexShader: DELVE_PORTAL_VERT,
    fragmentShader: DELVE_PORTAL_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    fog: true,
  });
  delvePortalMatCache.set(key, mat);
  return mat;
}

// The delve-entrance GLB bakes its stone AND its hanging veil into one shared
// texture (single unnamed material), so the veil can't be recolored by material
// name. For the drowned shrine we want that red veil to read as water: clone the
// converted material and inject a red→blue recolor that only touches reddish
// texels (R dominant over G/B), leaving the grey stone untouched. Cloned per
// asset-part material so the default (purple) entrance keeps the original red veil.
const drowningVeilMatCache = new Map<THREE.Material, THREE.Material>();
function drownVeilMaterial(src: THREE.Material): THREE.Material {
  const cached = drowningVeilMatCache.get(src);
  if (cached) return cached;
  const m = src.clone();
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      // recolor the baked red veil to a murky Blackwater blue; red-dominance gates it
      // so stone stays grey. The gate must SATURATE (smoothstep, full recolor by 0.15):
      // texels here are linear-space, where even a bright red fold only reaches ~0.5
      // dominance, and the old linear-strength mix left half the red channel intact,
      // so the veil still read red in-game. Stone dominance measures under 0.01.
      float _veilRed = smoothstep(0.02, 0.15, diffuseColor.r - max(diffuseColor.g, diffuseColor.b));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.04, 0.13, 0.2) * (0.4 + diffuseColor.r), _veilRed);
      `,
    );
  };
  // a distinct program key so three doesn't reuse the un-injected cached program
  m.customProgramCacheKey = () => 'drownVeil';
  drowningVeilMatCache.set(src, m);
  return m;
}

// Embers drifting up out of the delve mouth, a deterministic point cloud whose
// whole motion (rise + sideways waver + life fade) is a function of uTime, so it
// self-animates with no per-frame JS. Additive + HDR-boosted so it glows and
// blooms on composer tiers; reads as warm sparks on low too.
const DELVE_EMBER_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uRise;
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aDrift;
  varying float vLife;
  void main() {
    float t = fract(uTime * aSpeed + aPhase); // 0..1 life cycle
    vLife = t;
    vec3 pos = position;
    pos.y += t * uRise;                                  // rise
    pos.x += sin((t + aPhase) * 6.2831) * aDrift;        // lazy sideways waver
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = (95.0 / max(-mv.z, 1.0)) * (0.45 + 0.55 * sin(t * 3.14159));
    gl_Position = projectionMatrix * mv;
  }
`;
const DELVE_EMBER_FRAG = /* glsl */ `
  uniform float uHdr;
  uniform vec3 uCol1;
  uniform vec3 uCol2;
  varying float vLife;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, d);
    float fade = sin(vLife * 3.14159);                   // fade in then out over life
    vec3 col = mix(uCol1, uCol2, vLife) * uHdr;
    gl_FragColor = vec4(col, soft * fade * 0.85);
  }
`;

function buildDelveEmbers(
  cx: number,
  baseY: number,
  cz: number,
  halfW: number,
  riseY: number,
  col1: [number, number, number] = [1.0, 0.16, 0.09],
  col2: [number, number, number] = [1.0, 0.5, 0.18],
): THREE.Points {
  const N = GFX.standardMaterials ? 48 : 28; // lighter on low
  const positions = new Float32Array(N * 3);
  const phase = new Float32Array(N);
  const speed = new Float32Array(N);
  const drift = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    positions[i * 3] = (hash2(i * 1.7, cx, 0x656d62) - 0.5) * halfW * 2;
    positions[i * 3 + 1] = hash2(i * 2.3, cz, 0x656d62) * 1.5; // start low in the mouth
    positions[i * 3 + 2] = (hash2(i * 3.1, cx + cz, 0x656d62) - 0.5) * 0.6;
    phase[i] = hash2(i * 4.5, cx, 0x656d62);
    speed[i] = 0.05 + hash2(i * 5.9, cz, 0x656d62) * 0.09;
    drift[i] = 0.3 + hash2(i * 6.7, cx, 0x656d62) * 0.7;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  geo.setAttribute('aDrift', new THREE.BufferAttribute(drift, 1));
  // motion happens in the shader, so bound it manually or it culls at rest
  geo.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, riseY / 2, 0),
    Math.max(halfW, riseY) + 1.5,
  );
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedUniforms.uTime,
      uRise: { value: riseY },
      uHdr: { value: GFX.composer ? 2.0 : 1.0 },
      uCol1: { value: new THREE.Vector3(...col1) },
      uCol2: { value: new THREE.Vector3(...col2) },
    },
    vertexShader: DELVE_EMBER_VERT,
    fragmentShader: DELVE_EMBER_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.position.set(cx, baseY, cz);
  pts.renderOrder = 4; // over the void + vault
  return pts;
}

// `delveLabel` resolves a delve id to its localized display name for the carved
// entrance sign. Passed in by renderer.ts (the only render-side i18n surface) so
// props.ts itself stays string-table-free; falls back to the id if absent.
export function buildProps(seed: number, delveLabel?: (delveId: string) => string): PropsResult {
  const group = new THREE.Group();
  const flames: THREE.Mesh[] = [];
  // Meshes the far-cell bake must never absorb because the renderer animates
  // them live (campfire flames, windmill sails): baking one freezes its pose
  // while the live copy is hidden in far mode. They stay individual in BOTH
  // modes and keep their own shadow flags.
  const keepLiveMeshes = new Set<THREE.Mesh>();
  const windmillFans: THREE.Object3D[] = [];
  const fireLights: THREE.PointLight[] = [];
  const activeContent = getActiveWorldContent();
  const builtInWorld = activeContent === BUILTIN_WORLD;

  const ground = (x: number, z: number) => terrainHeight(x, z, seed);

  // Hideable props stay individual and unmerged so they can be faded while
  // the camera ray passes through their footprint. Footprints mirror the
  // colliders so what fades is exactly what the camera passes through.
  const hideables: Hideable[] = [];
  const keepFromMerge = new Set<THREE.Object3D>();
  /**
   * Mark `g` un-mergeable and register it as fade-when-camera-crossed. Each
   * mesh's material is cloned so the opacity fade touches only this structure
   * (and leaves the shadow pass untouched). The pre-clone shared material is
   * recorded per mesh so the far-cell bake can merge distant copies.
   */
  function registerHideable(g: THREE.Group, fp: Footprint): void {
    const matMap = new Map<THREE.Material, OccluderFadeMat>();
    const bakeMeshes: HideableBakeMesh[] = [];
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      keepFromMerge.add(mesh);
      // Animated meshes (flames, windmill sails) and transparent meshes stay
      // live in both modes (the bake would freeze the animation or break
      // blend ordering).
      const srcMat = mesh.material as THREE.Material;
      if (!keepLiveMeshes.has(mesh) && srcMat.transparent !== true) {
        bakeMeshes.push({ mesh, srcMat });
      }
      const src = mesh.material as THREE.Material;
      let tm = matMap.get(src);
      if (!tm) {
        const ghostSrc = src.clone();
        // Material.clone drops onBeforeCompile: re-attach the recorded
        // surface-detail layer so ghostable buildings keep their texture.
        reapplySurfaceDetailToClone(ghostSrc);
        tm = occluderFadeMat(ghostSrc);
        matMap.set(src, tm);
      }
      mesh.material = tm.mat;
    });
    hideables.push({
      group: g,
      mats: [...matMap.values()],
      hidden: false,
      alpha: 1,
      cellKey: propCellKey(fp.x, fp.z),
      bakeMeshes,
      suppressed: false,
      ...fp,
    });
  }

  // live small materials (decals / glow) — shared, never per-instance
  const usePbr = GFX.standardMaterials;
  const lowProps = !usePbr;
  const recessMat = surfaceMat({ color: 0x14100b, roughness: 1 });
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
  const lanternMat = surfaceMat({
    color: 0xffcc66,
    emissive: 0xff9933,
    emissiveIntensity: usePbr ? EMISSIVE_LIGHT : 1.2,
    roughness: 0.4,
  });

  // emissive glass / black hole-fillers opt out of shadow casting; shadowed()
  // runs after the builders so a plain `castShadow = false` would be clobbered
  const noShadow = new Set<THREE.Mesh>();
  function shadowed<T extends THREE.Object3D>(o: T): T {
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        (c as THREE.Mesh).castShadow = !noShadow.has(c as THREE.Mesh);
        (c as THREE.Mesh).receiveShadow = true;
      }
    });
    return o;
  }

  /** add one asset's meshes under `parent` with a local transform */
  function addParts(
    parent: THREE.Object3D,
    key: PropKey,
    opts: {
      x?: number;
      y?: number;
      z?: number;
      rot?: number;
      scale: Scale;
      euler?: THREE.Euler;
    },
  ): THREE.Group {
    const a = propAsset(key);
    const holder = new THREE.Group();
    for (const p of a.parts) holder.add(new THREE.Mesh(p.geo, p.mat));
    holder.position.set(opts.x ?? 0, opts.y ?? 0, opts.z ?? 0);
    if (opts.euler) holder.quaternion.setFromEuler(opts.euler);
    else if (opts.rot) holder.rotation.y = opts.rot;
    setScale(holder, opts.scale);
    parent.add(holder);
    return holder;
  }

  // ---- instancing: repeated kinds collect matrices per (asset × z-band) ----
  const instanceBatches = new Map<string, { key: PropKey; mats: THREE.Matrix4[] }>();
  const tmpPos = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();

  function addInstance(
    key: PropKey,
    x: number,
    y: number,
    z: number,
    rot: THREE.Euler | number,
    scale: Scale,
  ): void {
    tmpPos.set(x, y, z);
    tmpQuat.setFromEuler(typeof rot === 'number' ? new THREE.Euler(0, rot, 0) : rot);
    if (typeof scale === 'number') tmpScale.setScalar(scale);
    else tmpScale.set(scale[0], scale[1], scale[2]);
    const band = Math.floor((z - WORLD_MIN_Z) / mergeBandDepth());
    // Split bands into x-halves (the foliage bucket pattern): a world-wide
    // band's bounding sphere always intersects the shadow frustum, so it
    // re-submits into the shadow map every frame; half-bands cull.
    const bucketKey = `${key}:${x < 0 ? 'w' : 'e'}:${band}`;
    let bucket = instanceBatches.get(bucketKey);
    if (!bucket) {
      bucket = { key, mats: [] };
      instanceBatches.set(bucketKey, bucket);
    }
    bucket.mats.push(new THREE.Matrix4().compose(tmpPos, tmpQuat, tmpScale));
  }

  // ---- buildings: village houses / inn / composed chapel ------------------
  const houseHeight = HOUSE_HEIGHT;

  for (const b of activeContent.props.buildings) {
    const y = ground(b.x, b.z);
    const armoury = buildEastbrookGrandArmouryView(b, ground);
    if (armoury) {
      group.add(armoury.group);
      registerHideable(
        armoury.group,
        obbFootprint(b.x, b.z, b.w / 2, b.d / 2, b.rot, armoury.cameraTopY),
      );
      continue;
    }
    if (builtInWorld && isEastbrookRebuildBuilding(b)) continue;
    if (builtInWorld && isFenbridgeRebuildBuilding(b)) continue;
    // roof Y mirrors the camera collider height in colliders.ts, through the
    // same shared helper, so an authored per-building height override cannot
    // leave the hideable top and the camera top disagreeing.
    const roofY = y + buildingCameraHeight(b);
    if (b.kind === 'chapel') {
      // Composed chapel: tall bell tower at the rear + squat stone entry hall
      // in front; the hall door lands on the footprint's +z edge. Composition
      // numbers come from sim/prop_layout.ts (CHAPEL_TOWER/CHAPEL_HALL): the
      // collider derives the SAME shapes, so the hall roof a player climbs
      // onto is exactly the roof drawn here.
      //
      // The two parts are SEPARATE hideables at their own real heights: a
      // player STANDS on the hall roof, and one whole-chapel footprint at the
      // tower's top would put their eye inside-and-below it, vanishing the
      // very roof underfoot. Split, the hall never hides while stood on and
      // the tower still ghosts when it genuinely blocks the camera.
      const gTower = new THREE.Group();
      const tower = propAsset('bellTower');
      addParts(gTower, 'bellTower', {
        z: CHAPEL_TOWER.dz,
        scale: [
          (b.w * CHAPEL_TOWER.wScale) / tower.size.x,
          CHAPEL_TOWER.height / tower.size.y,
          (b.d * CHAPEL_TOWER.dScale) / tower.size.z,
        ],
      });
      gTower.position.set(b.x, y - CHAPEL_HALL.sink, b.z);
      gTower.rotation.y = b.rot;
      group.add(shadowed(gTower));
      const towerCenter = chapelTowerWorldCenter(b);
      registerHideable(
        gTower,
        obbFootprint(
          towerCenter.x,
          towerCenter.z,
          (b.w * CHAPEL_TOWER.wScale) / 2,
          (b.d * CHAPEL_TOWER.dScale) / 2,
          b.rot,
          roofY,
        ),
      );
      const gHall = new THREE.Group();
      const hall = propAsset('house3');
      addParts(gHall, 'house3', {
        z: b.d / 2 - CHAPEL_HALL.dzFromFront,
        scale: [
          (b.w * CHAPEL_HALL.wScale) / hall.size.x,
          CHAPEL_HALL.height / hall.size.y,
          CHAPEL_HALL.depth / hall.size.z,
        ],
      });
      gHall.position.set(b.x, y - CHAPEL_HALL.sink, b.z);
      gHall.rotation.y = b.rot;
      group.add(shadowed(gHall));
      const hallOff = rotLocal(0, b.d / 2 - CHAPEL_HALL.dzFromFront, b.rot);
      registerHideable(
        gHall,
        obbFootprint(
          b.x + hallOff.x,
          b.z + hallOff.z,
          (b.w * CHAPEL_HALL.wScale) / 2,
          CHAPEL_HALL.depth / 2,
          b.rot,
          y + CHAPEL_HALL.height,
        ),
      );
      continue;
    }
    const asset = buildingAssetPick(b);
    const a = propAsset(asset);
    const g = new THREE.Group();
    addParts(g, asset, { scale: [b.w / a.size.x, houseHeight[asset] / a.size.y, b.d / a.size.z] });
    g.position.set(b.x, y - 0.12, b.z);
    g.rotation.y = b.rot;
    group.add(shadowed(g));
    registerHideable(g, obbFootprint(b.x, b.z, b.w / 2, b.d / 2, b.rot, roofY));
  }

  // ---- hand-placed GLB decor (the generated storybook set) -----------------
  // World-scale, front-on-+z models: place at scale 1, orient with rot alone.
  // r > 0 entries mirror the circle collider in colliders.ts and camera-ghost;
  // r 0 dressing stays always-visible (small silhouettes, nothing to hide).
  for (const d of getActiveWorldContent().props.decorProps ?? []) {
    if (!(d.key in PROP_ASSET_DEFS)) {
      console.warn(`decorProps: unknown prop key "${d.key}" skipped`);
      continue;
    }
    const g = new THREE.Group();
    const holder = addParts(g, d.key as PropKey, { scale: d.scale ?? 1 });
    // the windmill's sail cross is a distinct authored mesh: reparent it onto
    // a pivot at its axle so the renderer can spin it (kept out of the static
    // merge, the campfire-flame idiom)
    if (d.key === 'hexWindmill' || d.key === 'hexbWindmill') {
      const a = propAsset(d.key);
      const fanIdx = a.parts.findIndex((part) => /fan/i.test(part.name));
      if (fanIdx >= 0) {
        const fanMesh = holder.children[fanIdx] as THREE.Mesh;
        const axle = (a.parts[fanIdx].geo.boundingBox as THREE.Box3).getCenter(new THREE.Vector3());
        const pivot = new THREE.Group();
        pivot.position.copy(axle);
        fanMesh.position.set(-axle.x, -axle.y, -axle.z);
        holder.remove(fanMesh);
        pivot.add(fanMesh);
        holder.add(pivot);
        keepFromMerge.add(fanMesh);
        keepLiveMeshes.add(fanMesh);
        windmillFans.push(pivot);
      }
    }
    // floating decor (moored ships) rides the waterline at its draft depth
    // instead of standing on the seabed
    const baseY =
      d.float !== undefined
        ? Math.max(ground(d.x, d.z), WATER_LEVEL - d.float)
        : ground(d.x, d.z) - 0.05;
    g.position.set(d.x, baseY, d.z);
    g.rotation.y = d.rot ?? 0;
    group.add(shadowed(g));
    if (d.r) {
      registerHideable(g, circleFootprint(d.x, d.z, d.r, baseY + (d.h ?? 4)));
    }
  }

  // ---- market stalls (smith/armorer stalls get anvil + weapon stand) ------
  activeContent.props.stalls.forEach((s, i) => {
    if (builtInWorld && isEastbrookRebuildStall(s)) return;
    if (builtInWorld && isFenbridgeRebuildStall(s)) return;
    const key = s.x * 7.7 + s.z * 2.3;
    const g = new THREE.Group();
    const standKey: PropKey = i % 2 === 0 ? 'stand1' : 'stand2';
    const stand = propAsset(standKey);
    addParts(g, standKey, {
      scale: [3.1 / stand.size.x, 2.6 / stand.size.y, 2.5 / stand.size.z],
      rot: (keyRand(key, 1) - 0.5) * 0.1,
    });
    if (!lowProps && s.smithy) {
      // Smith Haldren (z1) / Armorer Hode (z3): forge-front dressing
      addParts(g, 'anvil', { x: 1.35, z: 1.15, rot: 0.9, scale: 1.35 });
      addParts(g, 'weaponStand', { x: -1.45, z: 0.6, rot: 0.5 + Math.PI, scale: 1.25 });
    } else if (!lowProps) {
      addParts(g, 'farmCrate', { x: 1.3, z: 1.05, rot: keyRand(key, 2) * Math.PI, scale: 1.5 });
      addParts(g, 'barrel', { x: -1.35, z: 0.85, rot: keyRand(key, 3) * Math.PI, scale: 1.15 });
    }
    g.position.set(s.x, ground(s.x, s.z) - 0.06, s.z);
    g.rotation.y = s.rot;
    group.add(shadowed(g));
    // Footprint mirrors the collider's true 3.1 x 2.5 box (the old circle
    // overhung the flat sides, so a body pressed to the counter put its eye
    // a hair from the hide surface and the stall vanished at most angles).
    registerHideable(
      g,
      obbFootprint(s.x, s.z, STALL_HALF_W, STALL_HALF_D, s.rot, ground(s.x, s.z) + 3.1),
    );
  });

  // ---- wells ---------------------------------------------------------------
  for (const w of activeContent.props.wells) {
    if (builtInWorld && isEastbrookRebuildWell(w)) continue;
    if (builtInWorld && isFenbridgeRebuildWell(w)) continue;
    const g = new THREE.Group();
    const a = propAsset('well');
    addParts(g, 'well', { scale: [2.6 / a.size.x, 3.6 / a.size.y, 2.9 / a.size.z] });
    g.position.set(w.x, ground(w.x, w.z) - 0.1, w.z);
    g.rotation.y = propRand(w.x, w.z, 1) * Math.PI;
    group.add(shadowed(g));
    registerHideable(g, circleFootprint(w.x, w.z, w.r, ground(w.x, w.z) + 3.7));
  }

  // ---- graveyards: 4 headstone shapes, leaning, instanced ------------------
  // The SAME four stones at every graphics tier. Collision derives each
  // headstone's height from this cycle (`sim/prop_layout.ts`) and the sim has
  // no notion of a graphics preset, so substituting a shorter stone on low
  // would make what blocks a player depend on their settings, which the
  // gameplay-neutrality invariant forbids. Six stones per graveyard is a
  // rounding error next to the instanced foliage either way.
  const graveKinds: PropKey[] = ['graveRound', 'graveCross', 'graveBevel', 'graveDecor'];
  for (const gy of getActiveWorldContent().props.graveyards) {
    for (let i = 0; i < 6; i++) {
      const gx = gy.x + (i % 3) * 2.2,
        gz = gy.z + Math.floor(i / 3) * 2.6;
      const s = 2.0 + keyRand(gx * 3 + gz, 4) * 0.5;
      addInstance(
        graveKinds[i % graveKinds.length],
        gx,
        ground(gx, gz) - 0.06,
        gz,
        new THREE.Euler(
          (propRand(gx, gz, 1) - 0.5) * 0.2,
          i * 0.4 + (propRand(gx, gz, 2) - 0.5) * 0.5,
          (propRand(gx, gz, 3) - 0.5) * 0.22,
        ),
        s,
      );
    }
  }

  // ---- town fences: village fence module repeated along the run ------------
  // (kind 'stone': the low scalloped KayKit wall, its authored length along
  // local +z; kind 'palisade': the spiked KayKit log wall, length along
  // local +x like the wood rail)
  const STONE_WALL_SCALE = 4.2;
  const STONE_MODULE_LEN = 1.155 * STONE_WALL_SCALE;
  const PALISADE_MODULE_LEN = 2.0; // authored length before scaling
  const PALISADE_SEG = 6.4; // target module length in the world
  for (const f of activeContent.props.fences) {
    if (builtInWorld && isEastbrookRebuildFence(f)) continue;
    const len = Math.hypot(f.x2 - f.x1, f.z2 - f.z1);
    const stone = f.kind === 'stone';
    const palisade = f.kind === 'palisade';
    const n = Math.max(
      1,
      Math.round(len / (stone ? STONE_MODULE_LEN : palisade ? PALISADE_SEG : 2.35)),
    );
    const dirx = (f.x2 - f.x1) / len,
      dirz = (f.z2 - f.z1) / len;
    // module length runs along local +x (wood, palisade) or local +z (stone)
    const yaw = stone ? Math.atan2(dirx, dirz) : Math.atan2(-dirz, dirx);
    for (let i = 0; i < n; i++) {
      const x0 = f.x1 + (f.x2 - f.x1) * (i / n),
        z0 = f.z1 + (f.z2 - f.z1) * (i / n);
      const x1 = f.x1 + (f.x2 - f.x1) * ((i + 1) / n),
        z1 = f.z1 + (f.z2 - f.z1) * ((i + 1) / n);
      const g0 = ground(x0, z0),
        g1 = ground(x1, z1);
      const pitch = Math.atan2(g1 - g0, len / n);
      const mx = (x0 + x1) / 2,
        mz = (z0 + z1) / 2;
      if (stone) {
        // stretch the module to close the run exactly; sink a touch so the
        // base course follows sloped ground without floating
        const segScale = (len / n / STONE_MODULE_LEN) * STONE_WALL_SCALE;
        addInstance(
          'hexFenceStone',
          mx,
          (g0 + g1) / 2 - 0.12,
          mz,
          new THREE.Euler(-pitch, yaw, 0, 'YXZ'),
          [STONE_WALL_SCALE, STONE_WALL_SCALE, segScale],
        );
        continue;
      }
      if (palisade) {
        addInstance(
          'hexnPalisade',
          mx,
          (g0 + g1) / 2 - 0.15,
          mz,
          new THREE.Euler(0, yaw, pitch, 'YZX'),
          [len / n / PALISADE_MODULE_LEN, 3.2, 1.8],
        );
        continue;
      }
      const sy = 2.9 + (propRand(mx, mz, 1) - 0.5) * 0.5;
      addInstance('fence', mx, (g0 + g1) / 2 - 0.05, mz, new THREE.Euler(0, yaw, pitch, 'YZX'), [
        3.0,
        sy,
        3.0,
      ]);
    }
  }

  // ---- campfires: hideable bonfire base + live animated flame + light ------
  const flamePts = [
    [0, 0],
    [0.16, 0.1],
    [0.27, 0.28],
    [0.3, 0.45],
    [0.22, 0.66],
    [0.1, 0.84],
    [0.001, 0.95],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const flameGeo = new THREE.LatheGeometry(flamePts, 7);
  for (const [x, z] of getActiveWorldContent().props.campfires) {
    const y = ground(x, z);
    const g = new THREE.Group();
    addParts(g, 'bonfire', { y: -0.05, rot: propRand(x, z, 1) * Math.PI * 2, scale: 4.3 });
    const flame = new THREE.Mesh(
      flameGeo,
      new THREE.MeshLambertMaterial({
        color: 0xffaa33,
        emissive: 0xff6600,
        emissiveIntensity: usePbr ? EMISSIVE_LIGHT : 1.4,
        transparent: true,
        opacity: 0.92,
      }),
    );
    flame.position.y = 0.16;
    flame.scale.setScalar(1.15);
    g.add(flame);
    flames.push(flame);
    keepLiveMeshes.add(flame);
    noShadow.add(flame);
    const light = new THREE.PointLight(0xff8830, 12, 16, 2);
    // Root-level, world-positioned: the light must NOT live inside the hideable
    // campfire group. A parent visibility toggle (fog cull / camera ghost) would
    // change numPointLights and recompile every lit material mid-travel (the
    // open-world shader-compile freeze). The fireLights budget owns its shine.
    light.position.set(x, y + 1.2, z);
    group.add(light);
    fireLights.push(light);
    g.position.set(x, y, z);
    group.add(shadowed(g));
    registerHideable(g, circleFootprint(x, z, 0.85, y + 1.45, 2.4));
  }

  // ---- bandit/war tents: Kenney ridge tents, opening on +z, hideable -------
  for (const t of getActiveWorldContent().props.tents) {
    const kind: PropKey = propRand(t.x, t.z, 2) < 0.55 ? 'tentOpen' : 'tentSmall';
    const a = propAsset(kind);
    const s = (3.0 * t.scale) / Math.max(a.size.x, a.size.z);
    const y = ground(t.x, t.z);
    const g = new THREE.Group();
    addParts(g, kind, { scale: [s, s * 1.32, s] });
    g.position.set(t.x, y - 0.06, t.z);
    g.rotation.set(
      (propRand(t.x, t.z, 3) - 0.5) * 0.06,
      t.rot,
      (propRand(t.x, t.z, 4) - 0.5) * 0.06,
    );
    group.add(shadowed(g));
    registerHideable(g, circleFootprint(t.x, t.z, 1.5 * t.scale, y + 3.4 * t.scale, 3.0 * t.scale));
  }

  // ---- reeds: marsh vegetation along the shallow water edge, hideable -------
  // A clump stands ~3 yards tall and carries no collider, so the player walks
  // straight into it and the third-person boom ends up inside an opaque blob.
  // registerHideable ghosts it only while the eye-to-camera segment crosses the
  // footprint (walking up to it leaves it fully visible) and keeps it casting a
  // shadow, the same treatment tents, crates and trees already get.
  getActiveWorldContent().props.marshReeds.forEach(([x, z], i) => {
    const kind: PropKey = 'marshReeds';
    const a = propAsset(kind);
    const s = 3.0 + propRand(x, z, i + 5) * 0.6;
    const y = ground(x, z);
    const g = new THREE.Group();
    addParts(g, kind, {
      scale: s,
      euler: new THREE.Euler(
        (propRand(x, z, 10 + i) - 0.5) * 0.08,
        propRand(x, z, 12 + i) * Math.PI * 2,
        (propRand(x, z, 11 + i) - 0.5) * 0.08,
      ),
    });
    g.position.set(x, y - 0.05, z);
    group.add(shadowed(g));
    const r = (Math.max(a.size.x, a.size.z) / 2) * s;
    registerHideable(g, circleFootprint(x, z, r, y + a.size.y * s, r * 2));
  });

  // ---- crates: camp clutter (wooden crate / barrel mix), hideable ----------
  getActiveWorldContent().props.crates.forEach(([x, z], i) => {
    const kind: PropKey = i % 3 === 2 ? 'barrel' : 'crateWooden';
    const s = kind === 'barrel' ? 1.25 : 1.3 + propRand(x, z, 5) * 0.15;
    const y = ground(x, z);
    const g = new THREE.Group();
    addParts(g, kind, {
      scale: s,
      euler: new THREE.Euler((propRand(x, z, 7) - 0.5) * 0.05, ((x * 13 + z * 7) % 1) * Math.PI, 0),
    });
    g.position.set(x, y - 0.04, z);
    group.add(shadowed(g));
    registerHideable(g, circleFootprint(x, z, 0.65, y + 1.35));
  });

  // ---- murloc mud huts: giant swamp mushrooms, doorway facing camp center --
  const hutCenter = getActiveWorldContent().props.mudHuts.reduce(
    (acc, [hx, hz]) => ({
      x: acc.x + hx / getActiveWorldContent().props.mudHuts.length,
      z: acc.z + hz / getActiveWorldContent().props.mudHuts.length,
    }),
    { x: 0, z: 0 },
  );
  for (const [x, z] of getActiveWorldContent().props.mudHuts) {
    const y = ground(x, z);
    const g = new THREE.Group();
    const sxz = 13 + propRand(x, z, 15) * 3;
    const sy = 10.5 + propRand(x, z, 16) * 3;
    addParts(g, 'mushroomRed', {
      y: -0.15,
      scale: [sxz, sy, sxz],
      euler: new THREE.Euler(
        (propRand(x, z, 13) - 0.5) * 0.1,
        propRand(x, z, 12) * Math.PI * 2,
        (propRand(x, z, 14) - 0.5) * 0.1,
      ),
    });
    // doorway decal aimed at the camp heart
    const face = Math.atan2(hutCenter.x - x, hutCenter.z - z);
    const doorway = new THREE.Mesh(new THREE.CircleGeometry(0.62, 8, 0, Math.PI), recessMat);
    doorway.position.set(Math.sin(face) * 1.0, 0.04, Math.cos(face) * 1.0);
    doorway.rotation.y = face;
    doorway.rotation.x = -0.14;
    noShadow.add(doorway);
    g.add(doorway);
    if (!lowProps) {
      // toadstool cluster at the foot
      const a2 = face + 0.9 + propRand(x, z, 18);
      addParts(g, 'mushroomTan', {
        x: Math.sin(a2) * 1.7,
        y: -0.05,
        z: Math.cos(a2) * 1.7,
        rot: propRand(x, z, 19) * Math.PI * 2,
        scale: 2.6 + propRand(x, z, 20) * 1.4,
      });
    }
    g.position.set(x, y, z);
    group.add(shadowed(g));
    registerHideable(g, circleFootprint(x, z, 1.1, y + 12.5, sxz));
  }

  // ---- ruin rings: weathered monolith columns at the exact collider angles -
  for (const r of getActiveWorldContent().props.ruinRings) {
    for (let i = 0; i < r.columns; i++) {
      const ang = (i / r.columns) * Math.PI * 2;
      const x = r.x + Math.sin(ang) * r.ringR,
        z = r.z + Math.cos(ang) * r.ringR;
      const intact = i % 4 === 1;
      const kind: PropKey = intact ? 'column' : 'columnBroken';
      const sy = intact ? 3.5 + (i % 2) * 0.5 : 1.7 + (i % 3) * 0.85;
      const y = ground(x, z);
      const g = new THREE.Group();
      addParts(g, kind, {
        scale: [3.8, sy, 3.8],
        euler: new THREE.Euler(
          0,
          propRand(x, z, 8) * Math.PI,
          (i % 3 === 0 ? 0.13 : 0.03) * (i % 2 ? 1 : -1),
        ),
      });
      g.position.set(x, y - 0.1, z);
      group.add(shadowed(g));
      // Hideable at the column's REAL drawn top, not the intact monolith's:
      // broken stumps are standable now, and registering them tall would put
      // a standing player's eye inside-and-below the footprint, vanishing
      // the stump underfoot. Same height math as the collider (native tops
      // 1.0 intact / 0.65 broken, times the y scale, minus the 0.1 sink).
      const colTop = intact ? sy - 0.1 : 0.65 * sy - 0.1;
      registerHideable(g, circleFootprint(x, z, 0.6, y + colTop, 2.2));
    }
    if (lowProps) continue;
    // toppled relics at the ring's heart: half-buried head + fallen column
    const fy = ground(r.x - 2, r.z - 3);
    const g = new THREE.Group();
    addParts(g, 'statueHead', {
      x: -0.4,
      y: -0.55,
      z: 0.3,
      scale: 2.3,
      euler: new THREE.Euler(0.34, propRand(r.x, r.z, 30) * Math.PI * 2, 0.22),
    });
    addParts(g, 'statueBlock', {
      x: 2.1,
      y: -0.2,
      z: -1.3,
      rot: propRand(r.x, r.z, 31) * Math.PI,
      scale: 2.1,
    });
    addParts(g, 'column', {
      x: -1.2,
      y: 0.62,
      z: -2.2,
      scale: 3.2,
      euler: new THREE.Euler(
        Math.PI / 2 - 0.06,
        0.6 + (propRand(r.x, r.z, 32) - 0.5) * 0.4,
        0,
        'YXZ',
      ),
    });
    g.position.set(r.x - 2, fy, r.z - 3);
    group.add(shadowed(g));
  }

  // ---- mine entrances: timber portal, rock mound, ore cart, lantern --------
  for (const m of getActiveWorldContent().props.mines) {
    const g = new THREE.Group();
    const abandonedCrypt = m.x < -140 && m.z > 590 && m.z < 630;
    for (const sx of [-1.45, 1.45]) {
      addParts(g, 'timberPillar', { x: sx, scale: [3.4, 3.5, 3.4] });
    }
    // lintel + cap beam: the same square timber laid across the posts
    addParts(g, 'timberPillar', {
      y: 3.42,
      x: -2.2,
      euler: new THREE.Euler(0, 0, -Math.PI / 2),
      scale: [3.6, 4.4, 3.6],
    });
    addParts(g, 'timberPillar', {
      y: 3.85,
      x: -2.45,
      euler: new THREE.Euler(0, 0, -Math.PI / 2),
      scale: [3.0, 4.9, 3.0],
    });
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.1), holeMat);
    hole.position.set(0, 1.55, -0.2);
    noShadow.add(hole);
    g.add(hole);
    // boulder mound swallowing the portal (same mound the collider blocks):
    // pairs of mid-sized granite rocks per anchor read as a rubble pile where
    // one giant scaled rock would read as a box
    const mound: [number, number, number, number][] = abandonedCrypt
      ? [
          [0.2, 1.35, -3.2, 2.35],
          [-2.8, 0.25, -2.35, 1.75],
          [2.65, 0.3, -2.3, 1.75],
          [-1.7, 0.1, -1.25, 1.15],
          [1.75, 0.1, -1.2, 1.1],
          [0.2, 2.8, -4.15, 2.0],
          [-1.35, 1.45, -3.45, 1.55],
          [1.45, 1.5, -3.35, 1.5],
          [0, 0.15, -1.85, 1.2],
          [-3.45, 0.6, -3.5, 1.15],
          [3.35, 0.65, -3.45, 1.1],
          [0.1, 3.35, -2.85, 1.25],
        ]
      : [
          [0, 1.4, -3.0, 2.6],
          [-2.7, 0.3, -2.0, 1.9],
          [2.7, 0.35, -2.2, 2.0],
          [-1.6, 0.1, -1.0, 1.2],
          [1.8, 0.1, -0.9, 1.1],
          [0.3, 3.0, -4.2, 2.3],
          [-1.4, 1.6, -3.4, 1.8],
          [1.5, 1.7, -3.2, 1.7],
          [0, 0.2, -1.6, 1.4],
        ];
    const rockKinds: PropKey[] = lowProps
      ? ['rockLargeD']
      : ['rockTallA', 'rockLargeD', 'rockTallH', 'rockLargeF'];
    for (let i = 0; i < mound.length; i++) {
      const [rx, ry, rz, rr] = mound[i];
      const kind = rockKinds[(i * 2 + 1) % rockKinds.length];
      const a = propAsset(kind);
      addParts(g, kind, {
        x: rx,
        y: ry,
        z: rz,
        scale: (2.1 * rr) / Math.max(a.size.x, a.size.z),
        euler: new THREE.Euler(
          (propRand(m.x, m.z, i + 80) - 0.5) * 0.5,
          propRand(m.x, m.z, i + 70) * Math.PI,
          (propRand(m.x, m.z, i + 90) - 0.5) * 0.5,
        ),
      });
    }
    // ore cart (market awning stripped) + raw copper ore in the bed
    if (!abandonedCrypt) {
      addParts(g, 'cart', { x: 2.8, z: 1.6, rot: 0.5, scale: 1.9 });
      addParts(g, 'oreRocks', { x: 2.75, y: 0.78, z: 1.55, rot: 0.9, scale: 2.6 });
      addParts(g, 'oreRocks', { x: 3.4, z: 0.4, rot: 2.2, scale: 1.8 });
    }
    if (!lowProps) {
      // hanging lantern on the right post
      addParts(g, 'lanternWall', { x: 1.45, y: 2.0, z: 0.28, scale: 1.25 });
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.26, 6), lanternMat);
      glass.position.set(1.45, 2.52, 1.32);
      noShadow.add(glass);
      g.add(glass);
    }
    g.position.set(m.x, ground(m.x, m.z), m.z);
    g.rotation.y = m.rot;
    group.add(shadowed(g));
    // mound circle behind the portal, same offset/radius as the collider
    // (src/sim/colliders.ts), via the shared mineMoundFootprint helper so the
    // two can never drift apart again
    const { x: mx, z: mz, r: moundRadius } = mineMoundFootprint(m);
    registerHideable(g, circleFootprint(mx, mz, moundRadius, ground(mx, mz) + moundRadius + 0.2));
  }

  // ---- fishing docks: pirate-kit platforms, moored rowboat, stone hut ------
  for (const d of getActiveWorldContent().props.docks) {
    const y = ground(d.x, d.z);
    const g = new THREE.Group();
    const key = d.x * 3.3 + d.z * 1.7;
    const surfaceLine = dockSurfaceLine(d, ground);
    const pitch = -Math.atan(surfaceLine.slope);
    const zScale = 0.85 / Math.cos(pitch);
    for (let i = 0; i < DOCK_SECTION_LOCAL_Z.length; i++) {
      const lz = DOCK_SECTION_LOCAL_Z[i];
      const section = new THREE.Group();
      section.position.set(0, dockSurfaceYAt(surfaceLine, lz) - y, lz);
      section.rotation.x = pitch;
      g.add(section);
      // Pivot around the plank surface, not the post feet. Every section then
      // lies on the same analytic plane exposed by groundHeight. Compensating
      // z scale preserves the authored footprint after the pitch projection.
      addParts(section, 'dockPlatform', {
        y: -DOCK_SECTION_SURFACE_Y,
        scale: [0.78, 0.52, zScale],
      });
    }
    // hw/hd 0 means this dock carries no stone hut (e.g. the Farshore Landing).
    // Skip it entirely: a zero-scale mesh has a degenerate (non-invertible)
    // transform, which reads as NaN normals and flickers as a black square.
    const hasHut = d.hutLocal.hw > 0 && d.hutLocal.hd > 0;
    if (hasHut) {
      const hut = propAsset('house3');
      addParts(g, 'house3', {
        x: d.hutLocal.x,
        z: d.hutLocal.z,
        scale: [
          (d.hutLocal.hw * 2) / hut.size.x,
          2.6 / hut.size.y,
          (d.hutLocal.hd * 2) / hut.size.z,
        ],
      });
    }
    if (!lowProps) {
      // Loose dressing from the shared DOCK_DRESSING layout (all collidable
      // now, so they sit OFF the pinned-crossable plank walkway, on the
      // shore around the pier entry and the hut). Each seats on its own
      // ground sample: the shore undulates around the anchor.
      DOCK_DRESSING.forEach((dd, i) => {
        const off = {
          x: dd.x * Math.cos(d.rot) + dd.z * Math.sin(d.rot),
          z: -dd.x * Math.sin(d.rot) + dd.z * Math.cos(d.rot),
        };
        addParts(g, i === 2 ? 'crateWooden' : 'barrel', {
          x: dd.x,
          y: ground(d.x + off.x, d.z + off.z) - y,
          z: dd.z,
          rot: keyRand(key, 5 + i) * Math.PI,
          scale: dd.scale ?? 1,
        });
      });
    }
    // rowboat beside the deck's far end: floats at water level when the
    // shore dips below it, otherwise sits hauled up on the bank
    const boatLx = DOCK_BOAT.x,
      boatLz = DOCK_BOAT.z;
    const boatWx = d.x + boatLx * Math.cos(d.rot) + boatLz * Math.sin(d.rot);
    const boatWz = d.z - boatLx * Math.sin(d.rot) + boatLz * Math.cos(d.rot);
    const boatGround = ground(boatWx, boatWz);
    const wl = waterLevel();
    const isAfloat = boatGround < wl - 0.1;
    addParts(g, 'rowboat', {
      x: boatLx,
      z: boatLz,
      y: (isAfloat ? wl + 0.18 : boatGround + 0.06) - y,
      rot: DOCK_BOAT.rot + (keyRand(key, 8) - 0.5) * 0.4,
      scale: 0.85,
      euler: isAfloat
        ? undefined
        : new THREE.Euler(0.04, DOCK_BOAT.rot + (keyRand(key, 8) - 0.5) * 0.4, 0.16),
    });
    g.position.set(d.x, y, d.z);
    g.rotation.y = d.rot;
    group.add(shadowed(g));
    // stone hut OBB — same offset/extents/rotation as the collider
    if (hasHut) {
      const hc = Math.cos(d.rot),
        hs = Math.sin(d.rot);
      const hx = d.x + d.hutLocal.x * hc + d.hutLocal.z * hs;
      const hz = d.z - d.hutLocal.x * hs + d.hutLocal.z * hc;
      registerHideable(
        g,
        obbFootprint(hx, hz, d.hutLocal.hw, d.hutLocal.hd, d.rot, ground(hx, hz) + 2.9),
      );
    }
  }

  // ---- delve entrance: Meshy portal-door + animated void + carved name lintel -
  // The portal-door model sits just behind Brother Halven, its mouth facing the
  // hub players approach from (faceSign below: +z for Reliquary Hill, -z for the
  // marsh); it has its own stone backing slab so the animated shader plane
  // (FrontSide) reads as a solid void from the approach and is invisible from
  // behind. The carved name slab rides the model's crown. All render-only,
  // players enter by talking to Halven; leaveDelve drops them at doorPos.z - 4,
  // on the mouth side for both delves.
  const delvePortals: THREE.Mesh[] = [];
  for (const dm of getActiveWorldContent().props.delveMarkers ?? []) {
    if (!loadedProps.has('delveEntrance2') && !extractCache.has('delveEntrance2')) continue;
    const isDrowned = dm.delveId === 'drowned_litany';
    // The portal mouth faces the hub the players approach from: Reliquary Hill's
    // town is north (+z) of its door, Mirefen Marsh's hub (z~300) is SOUTH (-z)
    // of the drowned door (z=505), so the whole assembly (arch, void plane,
    // braziers, name slab) flips together for the drowned delve. The flip is on
    // the placed group, never baked into the asset (its geometry is cached and
    // shared by every marker). Sign, scale, and slab position are the shared
    // prop_layout constants the arch's solid collider is built from, so the
    // drawn slab and the wall it presents are always the same box.
    const faceSign = delveArchMouthSign(dm.delveId);

    // Portal-door model with its own backing slab, no separate vault sphere needed.
    const arch = propAsset('delveEntrance2');
    const SX = DELVE_ARCH_SCALE,
      SY = DELVE_ARCH_SCALE,
      SZ = DELVE_ARCH_SCALE;
    // The arch sits on the far side of Halven from the approach, so he greets
    // arrivals with the glowing mouth framed behind him. The leaveDelve drop
    // (prop_layout delveExitDropZ) lands mouth-side, clear of the slab.
    const archZ = delveArchZ(dm.z, dm.delveId);
    // Sample ground height at the arch's OWN placement (archZ), not Halven's
    // (dm.z): marsh terrain can slope/dip between the two, and sampling the
    // wrong z left the model's normalized (min-y at 0) base floating above the
    // real ground a few units away.
    const gy = ground(dm.x, archZ);
    const ag = new THREE.Group();
    for (const part of arch.parts) {
      // drowned shrine: recolor the baked red veil to water-blue (stone unaffected)
      const mat = isDrowned ? drownVeilMaterial(part.mat) : part.mat;
      const m = new THREE.Mesh(part.geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      ag.add(m);
    }
    ag.scale.set(SX, SY, SZ);
    ag.position.set(dm.x, gy, archZ);
    if (faceSign < 0) ag.rotation.y = Math.PI;
    group.add(ag);

    // portal opening: doorway is roughly half the model's width and a bit over
    // half its height; the animated shader plane sits on the approach-facing front
    // face. Tune these fractions after seeing the model in-game.
    const openW = arch.size.x * SX * 0.5;
    const openH = arch.size.y * SY * 0.55;
    const openCY = gy + arch.size.y * SY * 0.32; // centre of the doorway opening
    const faceZ = archZ + faceSign * ((arch.size.z * SZ) / 2); // approach-facing front face

    // opaque dark backsplash filling the doorway behind the void plane, so no
    // red leaks through from the rear and you can't see daylight through the
    // opening, the portal reads as a solid one-way threshold. Slightly larger
    // than the opening to cover the gap, recessed a touch into the model.
    const backsplash = new THREE.Mesh(
      new THREE.PlaneGeometry(openW * 1.1, openH * 1.1),
      new THREE.MeshBasicMaterial({
        color: isDrowned ? 0x01060f : 0x05030a, // deep blue-black for the drowned shrine
        side: THREE.DoubleSide,
      }),
    );
    backsplash.position.set(dm.x, openCY, faceZ - faceSign * 0.35);
    group.add(backsplash);

    // swirling void plane, FrontSide, drawn over the dark backsplash so the
    // animated vortex reads against true black from the town approach.
    const portalMat = isDrowned
      ? delvePortalMaterial(0x01060c, 0x0c2c3a, 0x176079) // murky marsh water: black-blue → deep teal → dim cyan rim
      : delvePortalMaterial(0x03000a, 0x6e0a85, 0xd90a1a); // default: void → purple → crimson rim
    const portal = new THREE.Mesh(new THREE.PlaneGeometry(openW, openH), portalMat);
    portal.position.set(dm.x, openCY, faceZ - faceSign * 0.05);
    // FrontSide plane natively faces +z; turn it with the assembly.
    if (faceSign < 0) portal.rotation.y = Math.PI;
    portal.renderOrder = 3;
    group.add(portal);
    delvePortals.push(portal);

    const mouthLightColor = isDrowned ? 0x1048c0 : 0x7010b0;
    const mouthLight = new THREE.PointLight(mouthLightColor, 8, 18, 2);
    mouthLight.position.set(dm.x, gy + 2.4, faceZ + faceSign * 0.4);
    mouthLight.userData.baseIntensity = 8;
    group.add(mouthLight);
    fireLights.push(mouthLight);

    // embers drifting up out of the mouth (self-animating; not a mesh, so the
    // static merge skips it automatically)
    const emberCol1: [number, number, number] = isDrowned
      ? [0.1, 0.35, 1.0] // blue sparks for the drowned shrine
      : [1.0, 0.16, 0.09];
    const emberCol2: [number, number, number] = isDrowned
      ? [0.55, 0.8, 1.0] // pale blue-white fade
      : [1.0, 0.5, 0.18];
    group.add(
      buildDelveEmbers(
        dm.x,
        gy + 1.0,
        faceZ + faceSign * 0.2,
        openW * 0.34,
        openH * 0.85,
        emberCol1,
        emberCol2,
      ),
    );

    // two flaming braziers flanking the mouth, a tended-entrance read. Reuse
    // the campfire flame + fire-light pattern so the renderer flickers them and
    // sheds embers for free; the warm torch orange plays off the red void.
    const postMat = surfaceMat({ color: 0x2a2622, roughness: 1 });
    const bowlMat = surfaceMat({ color: 0x191512, roughness: 1 });
    for (const side of [-1, 1]) {
      const bx = dm.x + side * (openW * 0.5 + 0.7);
      const bz = faceZ + faceSign * 0.5; // just in front of the mouth, on the approach side
      const by = ground(bx, bz);
      const bg = new THREE.Group();
      const postH = 2.0;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.33, postH, 8), postMat);
      post.position.y = postH / 2;
      bg.add(post);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.26, 0.38, 10), bowlMat);
      bowl.position.y = postH + 0.1;
      bg.add(bowl);
      const flame = new THREE.Mesh(
        flameGeo,
        new THREE.MeshLambertMaterial({
          color: 0xffaa33,
          emissive: 0xff6a1e,
          emissiveIntensity: usePbr ? EMISSIVE_LIGHT : 1.4,
          transparent: true,
          opacity: 0.92,
        }),
      );
      flame.position.y = postH + 0.28;
      flame.scale.setScalar(0.72);
      bg.add(flame);
      flames.push(flame);
      keepLiveMeshes.add(flame);
      noShadow.add(flame);
      const light = new THREE.PointLight(0xff8a3a, 9, 13, 2);
      light.position.y = postH + 0.55;
      light.userData.baseIntensity = 8;
      bg.add(light);
      fireLights.push(light);
      bg.position.set(bx, by, bz);
      group.add(shadowed(bg));
    }

    // (ruin-column dressing removed, the portal-door model has its own pillars,
    // so flanking rubble columns just cluttered and overpowered the silhouette.
    // Mossy boulders flanking the approach feet keep it grounded without competing.)
    const rubble: { kind: PropKey; dx: number; dz: number; s: Scale; rot?: number }[] = [
      { kind: 'rockLargeD', dx: -8.5, dz: -1.8, s: 1.7, rot: 2.1 },
      { kind: 'rockLargeD', dx: 8.0, dz: 2.2, s: 1.45, rot: 0.7 },
    ];
    for (const rb of rubble) {
      const rx = dm.x + rb.dx,
        rz = archZ + faceSign * rb.dz;
      const rgrp = new THREE.Group();
      addParts(rgrp, rb.kind, { scale: rb.s, rot: rb.rot });
      rgrp.position.set(rx, ground(rx, rz) - 0.08, rz);
      group.add(shadowed(rgrp));
    }

    // ---- carved name slab as the arch's approach-facing lintel-sign --------
    const slabY = gy + arch.size.y * SY * 0.8; // mounted on the crown, above the mouth
    const slabZ = faceZ + faceSign * 0.1; // proud of the front face so it never z-fights the arch

    // stone backing box
    const backMat = surfaceMat({ color: 0x3a3530 });
    const backing = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.9, 0.18), backMat);
    backing.position.set(dm.x, slabY, slabZ);
    backing.castShadow = true;
    group.add(backing);

    // grimy canvas inscription on the approach-facing surface (turns with the
    // assembly via the faceSign flip, so it reads -z for the drowned delve)
    const CW = 512,
      CH = 96;
    const cv = document.createElement('canvas');
    cv.width = CW;
    cv.height = CH;
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('2d canvas context unavailable');

    ctx.fillStyle = '#2b2722';
    ctx.fillRect(0, 0, CW, CH);
    ctx.strokeStyle = '#16120e';
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, CW - 12, CH - 12);

    // horizontal grime streaks (deterministic)
    for (let i = 0; i < 10; i++) {
      const gx = hash2(dm.x + i * 1.3, dm.z, 0x6d61726b) * CW;
      const gy2 = hash2(dm.z + i * 1.7, dm.x, 0x6d61726b) * CH;
      const gw = 20 + hash2(i * 3.1, dm.x + dm.z, 0x6d61726b) * 55;
      ctx.fillStyle = `rgba(6,4,2,${0.22 + hash2(i * 5.9, dm.z, 0x6d61726b) * 0.32})`;
      ctx.fillRect(gx - gw / 2, gy2 - 1.8, gw, 3.6);
    }

    // carved text, shadow pass then bright pass for depth illusion. Shrink the
    // font until the (localized) name fits inside the slab border so a long title
    // like "THE COLLAPSED RELIQUARY" is never clipped at the canvas edges.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = (delveLabel ? delveLabel(dm.delveId) : dm.delveId).toUpperCase();
    const maxTextW = CW - 44; // inside the 6px stroke + breathing room
    // Step down until it fits (kerning/hinting make a single proportional guess
    // unreliable for wide-glyph locales, e.g. CJK names), with a 16px floor.
    let fontPx = 34;
    ctx.font = `bold ${fontPx}px Georgia, "Times New Roman", serif`;
    while (fontPx > 16 && ctx.measureText(label).width > maxTextW) {
      fontPx -= 1;
      ctx.font = `bold ${fontPx}px Georgia, "Times New Roman", serif`;
    }
    ctx.fillStyle = '#120f0b';
    ctx.fillText(label, CW / 2 + 2, CH / 2 + 2);
    ctx.fillStyle = '#7d6e59';
    ctx.fillText(label, CW / 2, CH / 2);

    const tex = new THREE.CanvasTexture(cv);
    const faceMat = new THREE.MeshBasicMaterial({ map: tex });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.78), faceMat);
    // sit flush on the approach-facing face of the backing (PlaneGeometry faces
    // +z, so it turns with the assembly)
    face.position.set(dm.x, slabY, slabZ + faceSign * 0.1);
    if (faceSign < 0) face.rotation.y = Math.PI;
    group.add(face);
  }

  // ---- show-jumping race fixtures (Highwatch Stables) -----------------------
  // The start/finish arch and the jumps, permanent landmarks placed from
  // props.raceCourse (zone content mirroring MOUNT_RACE_COURSE), so the visible
  // course can never drift from the gates the race system detects. Rendered on
  // EVERY tier (riders race against these; no tier may hide them). colliders.ts
  // builds matching fence-like OBBs from the same raceCourse and fixture-size
  // data, so grounded riders stop and deliberate jumps clear. Merged static.
  const raceCourse = getActiveWorldContent().props.raceCourse;
  if (raceCourse) {
    // The models' long axis (crossbar / arch face) is local +z; yawing by
    // dir + PI/2 turns it perpendicular to the riding heading, so every gate is
    // ridden face-on. The gates are deliberately BIG (a proper arena): wide jumps
    // whose bar sits a touch higher now that mounts jump higher. Each jump carries
    // a height cap on the WHOLE model; the jumpable rail reads a bit below that, so
    // capping the vertical model at ~1.7 and the oxer at ~1.85 lands the main bar
    // below each model's top. A mounted hop apexes near ~1.76yd (JUMP_VELOCITY * MOUNT_JUMP_MULT
    // over GRAVITY in sim/player_motion), clearing even the standard tops, so the
    // ~7.5-8yd span fills the gate while every jump still reads as hoppable. The
    // arch is an imposing ~10.5yd start/finish gate at natural proportions.
    const fixtures: {
      x: number;
      z: number;
      dir: number;
      key: PropKey;
      width: number;
      maxHeight?: number;
    }[] = [
      { ...raceCourse.arch, key: 'courseArch', width: 10.5 },
      ...raceCourse.jumps.map((j) => {
        const fixture = MOUNT_RACE_JUMP_FIXTURES[j.kind];
        return {
          x: j.x,
          z: j.z,
          dir: j.dir,
          key: (j.kind === 'oxer' ? 'jumpOxer' : 'jumpVertical') as PropKey,
          width: fixture.width,
          maxHeight: fixture.maxHeight,
        };
      }),
    ];
    for (const f of fixtures) {
      const a = propAsset(f.key);
      // Uniform scale to the target width (long axis is +z), then clamp the
      // height: for a model taller than maxHeight this lowers only the vertical
      // axis (never a stretch, min() keeps it a cap). Sunk 0.08yd like the delve
      // rubble so a wide base never floats on the paddock's gentle slopes.
      const s = f.width / a.size.z;
      const sy = f.maxHeight != null ? Math.min(s, f.maxHeight / a.size.y) : s;
      const g = new THREE.Group();
      addParts(g, f.key, { scale: [s, sy, s] });
      g.position.set(f.x, ground(f.x, f.z) - 0.08, f.z);
      g.rotation.y = f.dir + Math.PI / 2;
      group.add(shadowed(g));
    }
  }

  // ---- flush instanced batches ---------------------------------------------
  const cullables: PropCullable[] = [];
  for (const batch of instanceBatches.values()) {
    const a = propAsset(batch.key);
    for (const part of a.parts) {
      const im = new THREE.InstancedMesh(part.geo, part.mat, batch.mats.length);
      for (let i = 0; i < batch.mats.length; i++) im.setMatrixAt(i, batch.mats[i]);
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      im.computeBoundingBox();
      group.add(im);
      const bounds = cullableBounds(im, im.boundingBox, im.boundingSphere);
      if (bounds) cullables.push(bounds);
    }
  }

  // animated flames + camera-ghost props (faded individually) stay un-merged
  const keep = new Set<THREE.Object3D>(flames);
  for (const m of keepFromMerge) keep.add(m);
  for (const p of delvePortals) keep.add(p); // shader-driven void: keep its transparency/renderOrder
  const staticMeshes = mergeStaticMeshes(group, keep);
  for (const sm of staticMeshes) {
    const bounds = cullableBounds(sm, sm.geometry.boundingBox, sm.geometry.boundingSphere);
    if (bounds) cullables.push(bounds);
  }

  // Far-cell merged bakes for the hideables (dual representation): identical
  // world-baked geometry on the SHARED pre-clone materials, one mesh per
  // (cell, material, castShadow). The per-frame swap lives in update().
  // Constrained-memory profiles (phone WebKit, native iOS) skip the bake:
  // duplicating the prop geometry at world entry is exactly the allocation
  // spike the v0.27.2 memory hotfix class guards against, and the draw-call
  // win matters most on the desktop tiers.
  const farCells = GFX.constrainedMemory ? [] : buildFarPropCells(group, hideables);

  return {
    group,
    flames,
    windmillFans,
    fireLights,
    update(
      camX: number,
      camY: number,
      camZ: number,
      eyeX: number,
      eyeY: number,
      eyeZ: number,
      fogFar: number,
      dt: number,
      reducedMotion = false,
    ): void {
      const fogFarSq = fogFar * fogFar;
      for (let i = 0; i < cullables.length; i++) {
        const c = cullables[i];
        c.obj.visible = cullableVisible(c, camX, camZ, fogFar, fogFarSq);
      }
      // Far-cell swap first (prop_cell_core): distant cells draw their merged
      // bake and suppress the members' individual baked meshes; near cells
      // (where the ghost fade can fire) draw the individuals while the bake
      // stays as the shadow-only caster. Pixel-identical both ways.
      for (const cell of farCells) {
        updatePropCell(cell, camX, camZ, fogFar);
      }
      for (let i = 0; i < hideables.length; i++) {
        const h = hideables[i];
        const dx = camX - h.x,
          dz = camZ - h.z;
        const reach = fogFar + h.cull;
        if (dx * dx + dz * dz >= reach * reach) {
          h.group.visible = false; // fully fogged: drop it (shadow is out of range too)
          continue;
        }
        // LOAD-BEARING ORDER: visible=true must be restored BEFORE the
        // suppressed continue, or a group culled on the prior frame would
        // stay stranded invisible when its cell enters far mode.
        h.group.visible = true;
        // Far mode: the merged cell bake draws instead; flames/transparent
        // members stay live on the group, and the ghost fade cannot fire. Put
        // the local clone back at its authored alpha before it can return to
        // near mode.
        if (h.suppressed) {
          h.hidden = false;
          if (h.alpha !== 1) {
            h.alpha = 1;
            applyOccluderFade(h.mats, 1);
          }
          continue;
        }
        // Ghost on every tier with the same timing while keeping the obstacle's
        // silhouette and shadow. Per-structure clones keep the change local.
        const hide = cameraSegmentHitsFootprint(h, eyeX, eyeY, eyeZ, camX, camY, camZ);
        h.hidden = hide;
        if (occluderFadeSettled(h.alpha, hide)) continue;
        h.alpha = stepOccluderFade(h.alpha, hide, dt, reducedMotion);
        applyOccluderFade(h.mats, h.alpha);
      }
    },
  };
}

// One mesh of a hideable structure plus its pre-clone shared material, the
// pair the far-cell bake merges on.
interface HideableBakeMesh {
  mesh: THREE.Mesh;
  srcMat: THREE.Material;
}

// A prop that the camera ghosts through and the renderer fades toward 20%
// opacity whenever the eye-to-camera segment crosses its footprint (below
// `topY`). Either a circle (`r`) or an OBB (`hw`/`hd`/`rot`), matching the
// collider it mirrors. Near the camera, the fade animates via
// occluder_fade_core. Far away, prop_cell_core swaps its opaque baked meshes
// into the cell merge while transparent and animated members stay live.
interface Hideable {
  group: THREE.Group;
  mats: OccluderFadeMat[]; // cloned per-structure so the fade is local
  hidden: boolean; // whether the structure occludes the view this frame
  alpha: number; // animated fade level (1 = opaque, 0.2 = occluding)
  cellKey: string; // far-cell membership (prop_cell_core)
  bakeMeshes: HideableBakeMesh[]; // meshes swapped out in far mode
  suppressed: boolean; // far mode: baked meshes hidden, merged cell draws
  x: number; // footprint centre (world XZ)
  z: number;
  topY: number; // roof height; a camera above this never fades the structure
  cull: number; // bounding radius for the fog-far cull
  r?: number; // circle footprint
  hw?: number; // OBB half-extents + yaw
  hd?: number;
  rot?: number;
}

// One far cell: the merged bakes for every hideable structure whose footprint
// falls in the cell, plus the members to swap against (prop_cell_core.ts).
// The bakes are single-instance InstancedMeshes so the near-mode shadow-only
// gate (count 0 in the color pass, 1 for the shadow draw) can make the bake
// the cell's ONLY shadow caster in both modes: the individuals never cast,
// and their union IS the bake, so the shadows are pixel-identical while the
// per-structure shadow submissions collapse to one per (material, cell).
interface FarPropCell {
  bounds: PropCellBounds;
  meshes: THREE.InstancedMesh[];
  hideables: Hideable[];
  farMode: boolean;
  visible: boolean;
}

type Footprint = Omit<
  Hideable,
  'group' | 'mats' | 'hidden' | 'alpha' | 'cellKey' | 'bakeMeshes' | 'suppressed'
>;

function circleFootprint(x: number, z: number, r: number, topY: number, cull = r): Footprint {
  return { x, z, r, topY, cull };
}

function obbFootprint(
  x: number,
  z: number,
  hw: number,
  hd: number,
  rot: number,
  topY: number,
): Footprint {
  return { x, z, hw, hd, rot, topY, cull: Math.hypot(hw, hd) };
}

function pointInsideFootprint(h: Hideable, x: number, z: number): boolean {
  const dx = x - h.x,
    dz = z - h.z;
  if (h.r !== undefined) return dx * dx + dz * dz < h.r * h.r;
  if (h.rot === undefined || h.hw === undefined || h.hd === undefined) return false;
  // world -> OBB local (three.js rotation.y convention), mirrors colliders.rotY
  const c = Math.cos(h.rot),
    s = Math.sin(h.rot);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) < h.hw && Math.abs(lz) < h.hd;
}

function segmentCircleEntry(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  r: number,
): number {
  const dx = bx - ax,
    dz = bz - az;
  const a = dx * dx + dz * dz;
  if (a < 1e-12) return Infinity;
  const fx = ax - cx,
    fz = az - cz;
  const c = fx * fx + fz * fz - r * r;
  if (c < 0) return 0;
  const b = 2 * (fx * dx + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  return (-b - Math.sqrt(disc)) / (2 * a);
}

function segmentObbEntry(h: Hideable, ax: number, az: number, bx: number, bz: number): number {
  if (h.rot === undefined || h.hw === undefined || h.hd === undefined) return Infinity;
  const c = Math.cos(h.rot),
    s = Math.sin(h.rot);
  const adx = ax - h.x,
    adz = az - h.z;
  const bdx = bx - h.x,
    bdz = bz - h.z;
  const lax = adx * c - adz * s;
  const laz = adx * s + adz * c;
  const lbx = bdx * c - bdz * s;
  const lbz = bdx * s + bdz * c;
  if (Math.abs(lax) < h.hw && Math.abs(laz) < h.hd) return 0;

  const dx = lbx - lax,
    dz = lbz - laz;
  let tmin = -Infinity,
    tmax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (lax < -h.hw || lax > h.hw) return Infinity;
  } else {
    let t1 = (-h.hw - lax) / dx,
      t2 = (h.hw - lax) / dx;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (Math.abs(dz) < 1e-9) {
    if (laz < -h.hd || laz > h.hd) return Infinity;
  } else {
    let t1 = (-h.hd - laz) / dz,
      t2 = (h.hd - laz) / dz;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (tmax < tmin || tmax < 0) return Infinity;
  return tmin;
}

// A crossing that begins within arm's reach of the EYE end of the segment is
// the player standing AGAINST the prop, not the prop covering the player:
// occlusion of the subject scales with how close the blocker sits to the
// CAMERA end. Without this, a body pressed to a stall counter or a house
// wall hides the whole structure at most orbit angles, because the entry
// point sits centimetres from the eye at eye height.
const HIDE_EYE_CLEARANCE = 1.0;

function cameraSegmentHitsFootprint(
  h: Hideable,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  camX: number,
  camY: number,
  camZ: number,
): boolean {
  if (
    (eyeY < h.topY && pointInsideFootprint(h, eyeX, eyeZ)) ||
    (camY < h.topY && pointInsideFootprint(h, camX, camZ))
  ) {
    return true;
  }
  const t =
    h.r !== undefined
      ? segmentCircleEntry(eyeX, eyeZ, camX, camZ, h.x, h.z, h.r)
      : segmentObbEntry(h, eyeX, eyeZ, camX, camZ);
  if (t < 0 || t > 1) return false;
  if (t * Math.hypot(camX - eyeX, camZ - eyeZ) < HIDE_EYE_CLEARANCE) return false;
  return eyeY + (camY - eyeY) * t < h.topY;
}

interface PropCullable {
  obj: THREE.Object3D;
  hasBox: boolean;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  cx: number;
  cz: number;
  r: number;
}

function cullableBounds(
  obj: THREE.Object3D,
  box: THREE.Box3 | null,
  sphere: THREE.Sphere | null,
): PropCullable | undefined {
  if (box) {
    const fallback = sphere ?? box.getBoundingSphere(new THREE.Sphere());
    return {
      obj,
      hasBox: true,
      minX: box.min.x,
      maxX: box.max.x,
      minZ: box.min.z,
      maxZ: box.max.z,
      cx: fallback.center.x,
      cz: fallback.center.z,
      r: fallback.radius,
    };
  }
  if (!sphere) return undefined;
  return {
    obj,
    hasBox: false,
    minX: sphere.center.x - sphere.radius,
    maxX: sphere.center.x + sphere.radius,
    minZ: sphere.center.z - sphere.radius,
    maxZ: sphere.center.z + sphere.radius,
    cx: sphere.center.x,
    cz: sphere.center.z,
    r: sphere.radius,
  };
}

function cullableVisible(
  c: PropCullable,
  camX: number,
  camZ: number,
  fogFar: number,
  fogFarSq: number,
): boolean {
  const dx = camX < c.minX ? c.minX - camX : camX > c.maxX ? camX - c.maxX : 0;
  const dz = camZ < c.minZ ? c.minZ - camZ : camZ > c.maxZ ? camZ - c.maxZ : 0;
  if (dx * dx + dz * dz < fogFarSq) return true;
  if (c.hasBox) return false;
  const centerDx = c.cx - camX;
  const centerDz = c.cz - camZ;
  const reach = fogFar + c.r;
  return centerDx * centerDx + centerDz * centerDz < reach * reach;
}

// Far-cell merged bakes for the camera-ghost hideables (dual representation,
// see prop_cell_core.ts). Every bakeable mesh of every hideable is baked into
// world space and merged per (cell, SHARED material, castShadow); the merged
// meshes start invisible and update() swaps them against the individual
// structures per cell. Geometry is cloned/de-indexed exactly like
// mergeStaticMeshes below, so the swap is pixel-identical.
function buildFarPropCells(group: THREE.Group, hideables: Hideable[]): FarPropCell[] {
  group.updateMatrixWorld(true);
  interface CellBucket {
    material: THREE.Material;
    castShadow: boolean;
    receiveShadow: boolean;
    geoms: THREE.BufferGeometry[];
  }
  interface CellBuild {
    buckets: Map<string, CellBucket>;
    bounds: PropCellBounds;
    hideables: Hideable[];
  }
  const cells = new Map<string, CellBuild>();
  const box = new THREE.Box3();
  for (const h of hideables) {
    if (h.bakeMeshes.length === 0) continue;
    let cell = cells.get(h.cellKey);
    if (!cell) {
      cell = {
        buckets: new Map(),
        bounds: {
          minX: Infinity,
          maxX: -Infinity,
          minZ: Infinity,
          maxZ: -Infinity,
        },
        hideables: [],
      };
      cells.set(h.cellKey, cell);
    }
    cell.hideables.push(h);
    for (const { mesh, srcMat } of h.bakeMeshes) {
      const key = `${srcMat.uuid}:${mesh.castShadow ? 1 : 0}:${mesh.receiveShadow ? 1 : 0}`;
      let bucket = cell.buckets.get(key);
      if (!bucket) {
        bucket = {
          material: srcMat,
          castShadow: mesh.castShadow,
          receiveShadow: mesh.receiveShadow,
          geoms: [],
        };
        cell.buckets.set(key, bucket);
      }
      const geo = normalizedStaticGeometry(mesh.geometry);
      geo.applyMatrix4(mesh.matrixWorld);
      geo.computeBoundingBox();
      if (geo.boundingBox) {
        box.copy(geo.boundingBox);
        cell.bounds.minX = Math.min(cell.bounds.minX, box.min.x);
        cell.bounds.maxX = Math.max(cell.bounds.maxX, box.max.x);
        cell.bounds.minZ = Math.min(cell.bounds.minZ, box.min.z);
        cell.bounds.maxZ = Math.max(cell.bounds.maxZ, box.max.z);
      }
      bucket.geoms.push(geo);
    }
  }
  const out: FarPropCell[] = [];
  for (const cellBuild of cells.values()) {
    const meshes: THREE.InstancedMesh[] = [];
    const cell: FarPropCell = {
      bounds: cellBuild.bounds,
      meshes,
      hideables: cellBuild.hideables,
      farMode: false,
      visible: true,
    };
    for (const bucket of cellBuild.buckets.values()) {
      const geo = mergeGeometries(bucket.geoms, false);
      if (!geo) continue;
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      // Single-instance so the count gate below can skip the color pass
      // per frame without touching visibility (three's instanced draw path
      // is a free no-op at count 0).
      const mesh = new THREE.InstancedMesh(geo, bucket.material, 1);
      mesh.setMatrixAt(0, new THREE.Matrix4());
      mesh.instanceMatrix.needsUpdate = true;
      // Pin the object bounds to the world-baked geometry bounds NOW: the
      // frustum test lazily computes an InstancedMesh's bounding sphere from
      // its CURRENT count, and this mesh spends near mode at count 0, which
      // would cache an empty sphere and cull the bake (and its shadow)
      // forever. The single identity instance makes geometry bounds exact.
      mesh.boundingBox = geo.boundingBox ? geo.boundingBox.clone() : null;
      mesh.boundingSphere = geo.boundingSphere ? geo.boundingSphere.clone() : null;
      mesh.castShadow = bucket.castShadow;
      mesh.receiveShadow = bucket.receiveShadow;
      // Near mode: shadow draw only. The hooks restore the instance for the
      // shadow pass and drop it again so the color pass skips the bake while
      // the individuals draw; far mode leaves the instance up for both.
      mesh.count = 0;
      (mesh as { onBeforeShadow: unknown }).onBeforeShadow = () => {
        mesh.count = 1;
      };
      (mesh as { onAfterShadow: unknown }).onAfterShadow = () => {
        if (!cell.farMode) mesh.count = 0;
      };
      group.add(mesh);
      meshes.push(mesh);
    }
    // The individuals never cast: the bake carries the cell's shadows in
    // both modes (identical union geometry). Flames/transparent meshes are
    // not in the bake and keep their own flags. Ghost fades keep their
    // shadow via the bake exactly as they did per-material before; the
    // lowProps ghost path (whole-group hide) cannot diverge because every
    // lowProps profile also disables dynamicShadows (gfx.ts:
    // constrainedMemory is true whenever nativeIosMemoryProfile is).
    for (const h of cellBuild.hideables) {
      for (const b of h.bakeMeshes) b.mesh.castShadow = false;
    }
    out.push(cell);
  }
  return out;
}

// Bake every static prop mesh into world space and merge per
// (material, castShadow, z-band). Flames (animated) and InstancedMeshes
// survive untouched, as do the PointLights (not meshes). The merged meshes
// replace the originals on the same group; emptied sub-groups are left in
// place (they carry lights). Non-indexed procedural shapes receive exact tuple
// indices so they can share indexed glTF buckets without expanding either.
function mergeStaticMeshes(group: THREE.Group, keep: Set<THREE.Object3D>): THREE.Mesh[] {
  group.updateMatrixWorld(true);
  interface Bucket {
    material: THREE.Material;
    castShadow: boolean;
    geoms: THREE.BufferGeometry[];
  }
  const buckets = new Map<string, Bucket>();
  const merged: THREE.Mesh[] = [];
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || keep.has(mesh) || (mesh as THREE.InstancedMesh).isInstancedMesh) return;
    const material = mesh.material as THREE.Material;
    const worldX = mesh.matrixWorld.elements[12];
    const worldZ = mesh.matrixWorld.elements[14];
    const band = Math.floor((worldZ - WORLD_MIN_Z) / mergeBandDepth());
    // x-halved like the instance batches above: world-wide merged bands
    // defeat shadow-frustum culling (their bounds always intersect it).
    const key = `${material.uuid}:${mesh.castShadow ? 1 : 0}:${worldX < 0 ? 'w' : 'e'}:${band}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material, castShadow: mesh.castShadow, geoms: [] };
      buckets.set(key, bucket);
    }
    // Extracted geometries are shared across placements, so the bake must
    // never mutate them in place. Preserve source index reuse and normalize
    // procedural streams with byte-exact full-tuple indices.
    const geo = normalizedStaticGeometry(mesh.geometry);
    bucket.geoms.push(geo.applyMatrix4(mesh.matrixWorld));
    merged.push(mesh);
  });
  for (const mesh of merged) mesh.removeFromParent();
  const out: THREE.Mesh[] = [];
  for (const bucket of buckets.values()) {
    const geo = mergeGeometries(bucket.geoms, false);
    if (!geo) continue;
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, bucket.material);
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    out.push(mesh);
  }
  return out;
}

function normalizedStaticGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const normalized = source.clone();
  deinterleaveGeometry(normalized);
  return normalized.index ? normalized : indexExactVertexTuples(normalized);
}

export const propStaticMergeInternalsForTest = { mergeStaticMeshes };

export const propMaterialInternalsForTest = { convertMaterial };

// ---------------------------------------------------------------------------
// Far-field building impostors
// ---------------------------------------------------------------------------

export interface BuildingImpostorPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  isLeaf: boolean;
}

export interface BuildingImpostorInstance {
  asset: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  widthScale: number;
  heightScale: number;
}

/**
 * Everything the far-field sprite layer needs to stand in for the village
 * buildings and the skyline-scale decor (windmills, moored ships) past the
 * detail horizon: the asset parts to bake and the placements, computed with
 * the SAME pools, pick hash, scale rules and seating the real placement loop
 * in buildProps uses, so a sprite can never disagree with the building it
 * replaces. Chapels reduce to their bell tower: at sprite range the squat
 * entry hall sits below the treeline. The Eastbrook rebuild kit and the
 * Grand Armoury keep their bespoke views and are skipped here.
 */
export function collectBuildingImpostors(seed: number): {
  sources: { asset: string; parts: BuildingImpostorPart[] }[];
  instances: BuildingImpostorInstance[];
} {
  const activeContent = getActiveWorldContent();
  const builtInWorld = activeContent === BUILTIN_WORLD;
  const used = new Map<string, PropAsset>();
  const instances: BuildingImpostorInstance[] = [];
  const use = (key: PropKey): PropAsset => {
    const a = propAsset(key);
    used.set(key, a);
    return a;
  };
  for (const b of activeContent.props.buildings) {
    if (b.landmark) continue;
    if (builtInWorld && isEastbrookRebuildBuilding(b)) continue;
    const y = terrainHeight(b.x, b.z, seed);
    if (b.kind === 'chapel') {
      const tower = use('bellTower');
      const w = Math.max(b.w * CHAPEL_TOWER.wScale, b.d * CHAPEL_TOWER.dScale);
      // The real tower stands at the rotated CHAPEL_TOWER.dz rear offset,
      // through the SAME helper the real loop's footprint uses; centering
      // on the raw building origin made the sprite jump sideways at the
      // handoff.
      const center = chapelTowerWorldCenter(b);
      instances.push({
        asset: 'bellTower',
        x: center.x,
        // base height comes from the building ORIGIN, exactly like the real
        // group (positioned at b.x/b.z, tower offset inside it)
        y: y - CHAPEL_HALL.sink,
        z: center.z,
        rot: b.rot,
        widthScale: w / Math.max(tower.size.x, tower.size.z),
        heightScale: CHAPEL_TOWER.height / tower.size.y,
      });
      continue;
    }
    const asset = buildingAssetPick(b);
    const a = use(asset);
    instances.push({
      asset,
      x: b.x,
      y: y - 0.12,
      z: b.z,
      rot: b.rot,
      widthScale: Math.max(b.w, b.d) / Math.max(a.size.x, a.size.z),
      heightScale: HOUSE_HEIGHT[asset] / a.size.y,
    });
  }
  for (const d of activeContent.props.decorProps ?? []) {
    if (!(d.key in PROP_ASSET_DEFS)) continue;
    const a = propAsset(d.key as PropKey);
    const scale = typeof d.scale === 'number' ? d.scale : 1;
    // only skyline-scale decor earns a sprite; small dressing is sub-pixel
    // out where the sprites live
    if (a.size.y * scale < 7) continue;
    used.set(d.key, a);
    const y =
      d.float !== undefined
        ? Math.max(terrainHeight(d.x, d.z, seed), WATER_LEVEL - d.float)
        : terrainHeight(d.x, d.z, seed) - 0.05;
    instances.push({
      asset: d.key,
      x: d.x,
      y,
      z: d.z,
      rot: d.rot ?? 0,
      widthScale: scale,
      heightScale: scale,
    });
  }
  return {
    sources: [...used].map(([asset, a]) => ({
      asset,
      parts: a.parts.map((part) => ({ geometry: part.geo, material: part.mat, isLeaf: false })),
    })),
    instances,
  };
}
