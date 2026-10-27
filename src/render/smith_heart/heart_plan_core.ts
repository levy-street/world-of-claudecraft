// Pure plan for the Smith's Heart (docs/design/raid/smith_heart.md): the
// palette, the placeholder recipe of every `sh_*` prop kind the field places
// (boxes, cylinders, cones and gems composed into each room's hero shapes,
// until the per-room kits give each its own model), where a prop's base
// stands, and the budgeted point lights (one colour key per vein at its
// guardian's arena and at its mouth on the Ring, the seal, the Hearth's
// mouth, its crystal and wellspring and the fire in its chasm, the basin's
// braziers, and the Heart's core, altars and terrace).
//
// Every room reads its theme by SHAPE first: the Quarry's kneeling colossi,
// cut blocks and derrick; the Cornice's lightning rods and broken bellows; the
// Basin's colossal sunk blades and heaped ice shelves; the Hearth's mouth,
// its altar-stone, its crystal and its ember boulders; the Seal Dais's crown
// of tines.
//
// Three-free, DOM-free, deterministic: the painters (heart_props.ts,
// heart_lights.ts) read these tables, and tests/smith_heart_render_core.test.ts
// pins them against the sim layout.

import {
  BREATH,
  CLEFT,
  GREAT_HEARTH,
  HAMMER_PIT,
  HEART_ALTARS,
  HEART_RETURN_PORTAL,
  HEART_ROOM,
  HEART_SEAL,
  QUENCH,
  RING,
  ringPoint,
  SMITH_HEART_BOSS_SPOTS,
  SMITH_HEART_FIELD,
  SMITH_HEART_VEIN_COLORS,
  type SmithHeartVein,
} from '../../sim/content/smith_heart_layout';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../../sim/instances/authored_field';
import type { FieldLightZone } from '../../sim/instances/authored_field/types';

/** The palette (linear hex; the materials take them as three colours). */
export const HEART_PALETTE = {
  /** Stormcrag granite: the mountain's own stone. */
  stone: 0x6f6a64,
  /** Darker basalt for bases and the walls' shadowed faces. */
  dark: 0x3e3b39,
  /** The Smith's runed bronze. */
  bronze: 0x9a7038,
  /** Black forge iron (blades, the anvil, the chains). */
  steel: 0x34363a,
  /** Old blue ice. */
  ice: 0xa8cfe6,
  /** Quarried ochre sandstone (the Hammer's carved stone). */
  ochre: 0x9a7a52,
  /** The Ring's forge accent (its light zone's accent). */
  ring: 0xd8c8a0,
  /** A brazier's warm coal (the Quench form's only warmth). */
  coal: 0xffa850,
} as const;

/** A prop part's material family: plain stone, dark rock, quarried ochre,
 *  bronze, forge iron, old ice, a glow in the hue's colour (an emissive face,
 *  never a light), or a banked ember of it (a deep, dimmer glow). */
export type HeartTone = 'stone' | 'dark' | 'ochre' | 'bronze' | 'steel' | 'ice' | 'glow' | 'ember';
export type HeartShape = 'box' | 'cyl' | 'cone' | 'gem';
/** Whose colour a part takes: a vein, the Ring's accent, or a brazier's coal. */
export type HeartHue = SmithHeartVein | 'ring' | 'coal';

/** One placeholder primitive, in the prop's local frame (x across, y up from
 *  the prop's base, z along its facing). A box is w x h x d; a cylinder or a
 *  cone is radius `w / 2` (cylinder top `d / 2`) and height `h`; a gem is an
 *  octahedron of radius `w / 2` stretched to `h`. `y` is the part's CENTRE. */
export interface HeartPart {
  shape: HeartShape;
  tone: HeartTone;
  hue: HeartHue;
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z: number;
  /** Extra yaw, and tilts about the local x and z axes (radians). */
  yaw?: number;
  tiltX?: number;
  tiltZ?: number;
}

function part(
  shape: HeartShape,
  tone: HeartTone,
  hue: HeartHue,
  dims: [number, number, number],
  at: [number, number, number],
  turn: { yaw?: number; tiltX?: number; tiltZ?: number } = {},
): HeartPart {
  return {
    shape,
    tone,
    hue,
    w: dims[0],
    h: dims[1],
    d: dims[2],
    x: at[0],
    y: at[1],
    z: at[2],
    ...turn,
  };
}

/** A forge-altar of the Heart: a stone drum, a bronze bowl burning in the
 *  vein's colour, its crystal, and the ring its chain hangs from. */
function altar(vein: SmithHeartVein): HeartPart[] {
  return [
    part('cyl', 'dark', vein, [6, 1.2, 5.6], [0, 0.6, 0]),
    part('cyl', 'stone', vein, [5.4, 2.2, 4.6], [0, 2.3, 0]),
    part('cyl', 'bronze', vein, [4.4, 1.4, 6.2], [0, 4.1, 0]),
    part('cyl', 'glow', vein, [5.8, 0.3, 5.8], [0, 4.85, 0]),
    part('gem', 'glow', vein, [2.2, 4.2, 2.2], [0, 7.4, 0]),
    part('box', 'bronze', vein, [3.2, 3.4, 0.9], [0, 6.2, -2.6]),
  ];
}

/** A colossus the Smith left half-carved in the quarry's top step: an uncut
 *  block, kneeling legs, a stooped torso, a bowed head, both hands on the
 *  haft of a stone hammer whose head rests before its knees. About eleven
 *  times a body's height. */
const COLOSSUS: HeartPart[] = [
  part('cyl', 'dark', 'hammer', [10.4, 7, 9.6], [0, 3.5, 0]),
  part('box', 'ochre', 'hammer', [9, 3.4, 7], [0, 8.6, 0.6]),
  part('box', 'ochre', 'hammer', [7.4, 9, 4.8], [0, 14.6, -0.6], { tiltX: 0.14 }),
  part('box', 'ochre', 'hammer', [10.4, 2.6, 4.6], [0, 19.4, 0.2], { tiltX: 0.14 }),
  part('box', 'ochre', 'hammer', [3.2, 3.6, 3.2], [0, 22.2, 1.4], { tiltX: 0.32 }),
  part('box', 'ochre', 'hammer', [2, 8.4, 2], [-4.6, 15.4, 1.8], { tiltX: 0.42, tiltZ: -0.06 }),
  part('box', 'ochre', 'hammer', [2, 8.4, 2], [4.6, 15.4, 1.8], { tiltX: 0.42, tiltZ: 0.06 }),
  part('cyl', 'stone', 'hammer', [1.1, 9.4, 1.1], [0, 11.8, 4.1]),
  part('box', 'stone', 'hammer', [6.4, 2.8, 2.8], [0, 8.4, 4.1]),
  part('gem', 'glow', 'hammer', [1.6, 2.4, 1.6], [-3.6, 6.4, 3.2], { tiltZ: 0.4 }),
  part('gem', 'glow', 'hammer', [1.2, 1.8, 1.2], [3.8, 5.6, 2.8], { tiltZ: -0.5 }),
];

/**
 * The placeholder of every `sh_*` prop kind (the heart seal is drawn by
 * heart_seal.ts, so its recipe is empty). Sized to the layout's colliders
 * (`r`, `hw`/`hd` and `h` in content/smith_heart_layout.ts): a part a body
 * can touch never reaches more than a body's width past its prop's
 * footprint.
 */
export const HEART_PROP_RECIPES: Readonly<Record<string, readonly HeartPart[]>> = {
  // The crack in the Stormcrag cliffs behind the Cleft landing: two leaning
  // slabs of dark rock from the fissure's depth to well over the landing,
  // set back (local -z) so neither leans over the landing's floor.
  sh_cleft_mouth: [
    part('box', 'dark', 'hammer', [4, 74, 9], [-6, -6, -5], { tiltZ: 0.06 }),
    part('box', 'dark', 'hammer', [4, 70, 9], [6, -8, -5], { tiltZ: -0.06 }),
    part('gem', 'glow', 'hammer', [1.6, 3, 1.6], [0, 9, -1]),
  ],
  // A half-carved mountain statue on the Gallery's rim.
  sh_rough_statue: [
    part('box', 'dark', 'hammer', [6, 1.2, 4.6], [0, 0.6, 0]),
    part('box', 'ochre', 'hammer', [5, 8.6, 3.6], [0, 5.5, 0]),
    part('box', 'ochre', 'hammer', [2.8, 2.8, 2.8], [0, 11.2, 0.3]),
    part('box', 'ochre', 'hammer', [1.6, 5.4, 1.6], [3.4, 7.4, 0.5], { tiltZ: -0.25 }),
  ],
  sh_geode: [
    part('gem', 'dark', 'hammer', [3.6, 2.8, 3.6], [0, 1.2, 0]),
    part('gem', 'glow', 'hammer', [1, 3.2, 1], [0.6, 2.6, 0], { tiltZ: -0.4 }),
    part('gem', 'glow', 'hammer', [0.9, 2.6, 0.9], [-0.7, 2.3, 0.4], { tiltZ: 0.5 }),
    part('gem', 'glow', 'hammer', [0.8, 2.2, 0.8], [0, 2.2, -0.7], { tiltX: -0.5 }),
    part('gem', 'glow', 'hammer', [0.7, 1.8, 0.7], [0.5, 1.9, 0.8], { tiltX: 0.6 }),
  ],
  // The Quarry's columns (they rise and fall in phase 2): Mountain's Wrath's
  // line-of-sight cover, banded so their height reads from across the pit.
  sh_pit_column: [
    part('cyl', 'dark', 'hammer', [6, 1.2, 5.6], [0, 0.6, 0]),
    part('cyl', 'stone', 'hammer', [5, 12, 4.4], [0, 7.2, 0]),
    part('cyl', 'glow', 'hammer', [5.3, 0.3, 5.3], [0, 2.4, 0]),
    part('cyl', 'bronze', 'hammer', [5, 0.7, 5], [0, 9.6, 0]),
    part('box', 'dark', 'hammer', [6.4, 1.4, 6.4], [0, 13.8, 0]),
  ],
  sh_quarry_colossus: COLOSSUS,
  // A cut block waiting on the steps, a smaller one set on it.
  sh_quarry_block: [
    part('box', 'ochre', 'hammer', [4.8, 4.8, 4.8], [0, 2.4, 0]),
    part('box', 'ochre', 'hammer', [3.2, 2.6, 3.4], [0.4, 6.1, -0.3], { yaw: 0.5 }),
  ],
  // A block fallen onto the Gallery's walk (phase 2E), tipped on its edge.
  sh_fallen_block: [part('box', 'ochre', 'hammer', [2.2, 1.3, 1.6], [0, 0.65, 0], { yaw: 0.25 })],
  // The derrick that lifted them: an A of timbers, a boom over the pit, a
  // chain and a hoisted block.
  sh_quarry_derrick: [
    part('cyl', 'dark', 'hammer', [2.4, 2, 2.4], [0, 1, -1]),
    part('box', 'dark', 'hammer', [0.8, 18, 0.8], [-0.9, 9, 0], { tiltZ: 0.1 }),
    part('box', 'dark', 'hammer', [0.8, 18, 0.8], [0.9, 9, 0], { tiltZ: -0.1 }),
    part('box', 'dark', 'hammer', [0.7, 0.7, 13], [0, 16.6, 4.8], { tiltX: -0.22 }),
    part('cyl', 'steel', 'hammer', [0.35, 7, 0.35], [0, 14.6, 10.6]),
    part('box', 'ochre', 'hammer', [2.8, 2.8, 2.8], [0, 9.8, 10.6]),
  ],
  // The Slab's frame: two jambs from the fissure's depth beside the stair and
  // a lintel high over it (the slab itself is a gate, heart_gates.ts). Set
  // just north of the slab, clear of the Quarry's rim on either side.
  sh_slab_frame: [
    part('box', 'dark', 'hammer', [2.4, 34, 3], [-9.4, -3, 2]),
    part('box', 'dark', 'hammer', [2.4, 34, 3], [9.4, -3, 2]),
    part('box', 'stone', 'hammer', [21.2, 2.4, 3.2], [0, 13.2, 2]),
    part('box', 'glow', 'hammer', [12, 0.4, 0.4], [0, 12, 3.65]),
  ],
  // A forge pillar on the Ring's outer rim, a bronze collar near its top.
  sh_ring_pillar: [
    part('cyl', 'stone', 'ring', [2.4, 12, 2.2], [0, 6, 0]),
    part('cyl', 'bronze', 'ring', [2.8, 0.8, 2.8], [0, 10.6, 0]),
    part('cone', 'glow', 'ring', [1.6, 1.4, 0], [0, 12.7, 0]),
  ],
  // A pack spot's cairn on the Ring's rim (the Ring kit's fallen block or
  // toppled stone with its crystal lamp; this is its stand-in).
  sh_ring_cairn: [
    part('box', 'stone', 'ring', [2.8, 1.8, 2.2], [0.3, 0.9, 0]),
    part('gem', 'glow', 'ring', [0.8, 1.2, 0.8], [-1.3, 0.9, 0.2]),
  ],
  // A jamb of the Hammer's mouth at the Grand Stair's head (stand-in).
  sh_hammer_jamb: [
    part('box', 'stone', 'hammer', [2.6, 8.6, 2.2], [0, 4.3, 0]),
    part('gem', 'glow', 'hammer', [0.9, 1.4, 0.9], [0, 9.2, 0]),
  ],
  // One of the four bronze tines crowning the Seal Dais: a shaft rising off
  // the dais, its head bent in over the seal, a glowing tip the portal's
  // light runs from.
  sh_portal_tine: [
    part('cyl', 'dark', 'ring', [2, 1.2, 1.8], [0, 0.6, 0]),
    part('cyl', 'bronze', 'ring', [1.3, 11, 0.8], [0, 6.7, 0]),
    part('cyl', 'glow', 'ring', [1.4, 0.3, 1.4], [0, 4, 0]),
    part('cyl', 'glow', 'ring', [1.2, 0.3, 1.2], [0, 8.6, 0]),
    part('box', 'bronze', 'ring', [0.8, 5, 0.8], [0, 13.6, -1.4], { tiltX: -0.6 }),
    part('gem', 'glow', 'ring', [1.1, 2, 1.1], [0, 16, -3]),
  ],
  // The Breath: the bridge's wind shelters, the Cornice's lightning rods and
  // its broken bellows.
  sh_wind_shelter: [
    part('box', 'stone', 'breath', [4.8, 2, 1.4], [0, 1, 0]),
    part('box', 'glow', 'breath', [4.2, 0.2, 0.2], [0, 1.6, 0.72]),
  ],
  // A wind channel's cheek stone and a landing's standing stone (phase 2G
  // stand-ins until the Breath kit lands).
  sh_channel_jamb: [part('box', 'stone', 'breath', [2.4, 9, 1.4], [0, 4.5, 0])],
  sh_storm_stone: [
    part('box', 'stone', 'breath', [2.6, 7.5, 1.8], [0, 3.75, 0]),
    part('gem', 'glow', 'breath', [0.6, 1, 0.6], [0.3, 5.3, 0]),
  ],
  // A Quench landing's frost-cracked standing stone (phase 2H stand-in until
  // the Quench kit lands).
  sh_frost_stone: [
    part('box', 'stone', 'quench', [3, 5.6, 2.4], [0, 2.8, 0]),
    part('gem', 'ice', 'quench', [0.8, 1.4, 0.8], [0.9, 3.4, 0.6]),
  ],
  sh_lightning_rod: [
    part('cyl', 'stone', 'breath', [2.6, 2, 2.4], [0, 1, 0]),
    part('cyl', 'bronze', 'breath', [0.9, 20, 0.5], [0, 12, 0]),
    part('cyl', 'bronze', 'breath', [2, 0.35, 2], [0, 6, 0]),
    part('cyl', 'bronze', 'breath', [1.8, 0.35, 1.8], [0, 10, 0]),
    part('cyl', 'bronze', 'breath', [1.5, 0.35, 1.5], [0, 14, 0]),
    part('cone', 'bronze', 'breath', [0.5, 3, 0], [0.6, 22.6, 0], { tiltZ: -0.35 }),
    part('cone', 'bronze', 'breath', [0.5, 3, 0], [-0.6, 22.6, 0], { tiltZ: 0.35 }),
    part('gem', 'glow', 'breath', [1.1, 2.8, 1.1], [0, 23.6, 0]),
  ],
  sh_broken_bellows: [
    part('box', 'dark', 'breath', [8, 0.8, 13], [0, 0.4, 0]),
    part('box', 'dark', 'breath', [6.8, 2.4, 10], [0, 2, -0.6], { tiltX: 0.14 }),
    part('box', 'bronze', 'breath', [8, 0.8, 13], [0, 4.6, -1.2], { tiltX: 0.36 }),
    part('cone', 'bronze', 'breath', [2.4, 3.6, 0], [0, 1.6, 6.6], { tiltX: Math.PI / 2 }),
    part('box', 'bronze', 'breath', [8.4, 0.5, 0.6], [0, 1.2, 4.4]),
    part('gem', 'glow', 'breath', [1.2, 1.6, 1.2], [2.6, 1, -4.8]),
  ],
  // The Quench: the basin's braziers, vents, colossal blades and ice shelves.
  sh_brazier: [
    part('cyl', 'dark', 'quench', [1.4, 1.2, 1.1], [0, 0.6, 0]),
    part('cyl', 'bronze', 'quench', [2, 0.4, 1.6], [0, 1.4, 0]),
    part('cyl', 'glow', 'coal', [1.5, 0.2, 1.5], [0, 1.65, 0]),
  ],
  sh_steam_vent: [
    part('cyl', 'dark', 'quench', [3.4, 0.1, 3.4], [0, 0.05, 0]),
    part('cyl', 'glow', 'quench', [1.8, 0.12, 1.8], [0, 0.07, 0]),
  ],
  sh_sunk_blade: [
    part('box', 'steel', 'quench', [0.6, 12, 3.2], [0, 4.6, 0], { tiltZ: 0.22 }),
    part('box', 'glow', 'quench', [0.2, 11, 0.4], [0.32, 4.8, 0], { tiltZ: 0.22 }),
    part('box', 'bronze', 'quench', [0.9, 0.9, 6], [2.4, 10.4, 0], { tiltZ: 0.22 }),
    part('cyl', 'dark', 'quench', [0.7, 3.4, 0.7], [3, 12.6, 0], { tiltZ: 0.22 }),
    part('gem', 'ice', 'quench', [2.4, 1, 2.4], [0, 0.4, 0]),
  ],
  sh_ice_shelf: [
    part('box', 'ice', 'quench', [14, 2.6, 6.4], [0, -0.8, 0], { tiltX: 0.28 }),
    part('box', 'ice', 'quench', [8, 2, 5], [5, 0.6, -2.4], { tiltX: 0.45, yaw: 0.3 }),
    part('gem', 'ice', 'quench', [2.6, 4, 2.6], [-4.6, 1.4, -1]),
    part('gem', 'glow', 'quench', [1, 2.6, 1], [-4, 2.4, 0.4], { tiltZ: 0.3 }),
  ],
  // A half-forged blade set in the Singing Ice.
  sh_ice_blade: [
    part('box', 'glow', 'quench', [0.4, 4, 1.4], [0, 2, 0], { tiltZ: 0.15 }),
    part('box', 'bronze', 'quench', [1.6, 0.4, 0.5], [0.3, 4, 0], { tiltZ: 0.15 }),
  ],
  // The Heat (phase 2I: the Hearth, never a forge; these stand in only until
  // its kit lands): the crystal clusters, the wellspring, the Hearth's mouth,
  // the ember boulders, the altar-stone and the seams of fire, in basalt and
  // the first flame's crystal (the ids keep their old names).
  sh_crucible: [
    part('cyl', 'dark', 'heat', [4.6, 1.4, 5.2], [0, 0.7, 0]),
    part('gem', 'glow', 'heat', [1.6, 6, 1.6], [0, 3.6, 0]),
    part('gem', 'glow', 'heat', [1.1, 3.6, 1.1], [1.2, 2.4, 0.6], { tiltZ: -0.35 }),
    part('gem', 'glow', 'heat', [1.0, 3.2, 1.0], [-1.1, 2.2, -0.5], { tiltZ: 0.4 }),
  ],
  sh_pour_crucible: [
    part('cyl', 'dark', 'heat', [6.4, 2.4, 6.8], [0, 1.2, 0]),
    part('cyl', 'glow', 'heat', [3.4, 0.3, 3.4], [0, 2.4, 0]),
    part('gem', 'glow', 'heat', [1.4, 7, 1.4], [0, 5.5, -2], { tiltX: -0.2 }),
    part('gem', 'glow', 'heat', [1.1, 5, 1.1], [-1.8, 4.6, -1.2], { tiltZ: 0.3 }),
    part('gem', 'glow', 'heat', [1.1, 5, 1.1], [1.8, 4.6, -1.2], { tiltZ: -0.3 }),
  ],
  // The Hearth's mouth in the rock behind the Forge's west wall (local +z
  // faces the arena): two jambs, a lintel, its throat full of the first
  // flame's crystal. Nothing of it stands over the floor.
  sh_great_hearth: [
    part('box', 'dark', 'heat', [46, 4, 12], [0, -2, -5]),
    part('box', 'dark', 'heat', [7, 26, 10], [-17, 11, -5]),
    part('box', 'dark', 'heat', [7, 26, 10], [17, 11, -5]),
    part('box', 'stone', 'heat', [4.4, 21, 10], [-9.2, 31, -5], { tiltZ: -0.62 }),
    part('box', 'stone', 'heat', [4.4, 21, 10], [9.2, 31, -5], { tiltZ: 0.62 }),
    part('box', 'dark', 'heat', [52, 16, 12], [0, 48, -8]),
    part('box', 'ember', 'heat', [26, 30, 1], [0, 14, -10]),
    part('gem', 'glow', 'heat', [5, 15, 5], [-8, 7.5, -7]),
    part('gem', 'glow', 'heat', [6, 22, 6], [-2.5, 11, -7.5]),
    part('gem', 'glow', 'heat', [5.4, 18, 5.4], [3.5, 9, -7.2]),
    part('gem', 'glow', 'heat', [4.4, 12, 4.4], [8.5, 6, -6.8]),
  ],
  sh_great_bellows: [
    part('box', 'dark', 'heat', [3.2, 4.6, 11.5], [-1.8, 2.3, 0], { tiltZ: 0.08 }),
    part('box', 'stone', 'heat', [3.2, 4.2, 11], [1.8, 2.1, 0.2], { tiltZ: -0.08 }),
    part('box', 'glow', 'heat', [0.5, 0.3, 10], [0, 0.4, 0]),
  ],
  // The altar-stone, side-on to the arena's door: its foot, waist and
  // capstone of basalt, a seam of fire down its table, crystal at its north
  // end (local +z).
  sh_giant_anvil: [
    part('box', 'dark', 'heat', [6.2, 1.4, 16.4], [0, 0.7, 0]),
    part('box', 'dark', 'heat', [4.8, 2.8, 14.6], [0, 2.8, 0]),
    part('box', 'stone', 'heat', [6.2, 1.6, 16.2], [0, 5, 0]),
    part('box', 'glow', 'heat', [0.4, 0.2, 13], [0, 5.85, 0]),
    part('gem', 'glow', 'heat', [1.4, 4.4, 1.4], [0, 7.6, 6.4]),
    part('gem', 'glow', 'heat', [1.0, 3.0, 1.0], [0.9, 6.9, 5.6], { tiltZ: -0.4 }),
  ],
  sh_casting_channel: [
    part('box', 'dark', 'heat', [2.6, 0.06, 64], [0, 0.03, 0]),
    part('box', 'glow', 'heat', [1.4, 0.1, 64], [0, 0.05, 0]),
  ],
  sh_altar_hammer: altar('hammer'),
  sh_altar_breath: altar('breath'),
  sh_altar_quench: altar('quench'),
  sh_altar_heat: altar('heat'),
  sh_heart_seal: [],
};

/** The colour of a part: its vein's, the Ring's accent, or a coal. */
export function heartHueColor(hue: HeartHue): number {
  if (hue === 'ring') return HEART_PALETTE.ring;
  if (hue === 'coal') return HEART_PALETTE.coal;
  return SMITH_HEART_VEIN_COLORS[hue];
}

/** Scale a colour's channels toward black (a vein's dim tone). */
export function scaleColor(color: number, k: number): number {
  const c = Math.max(0, Math.min(1, k));
  const r = Math.round(((color >> 16) & 0xff) * c);
  const g = Math.round(((color >> 8) & 0xff) * c);
  const b = Math.round((color & 0xff) * c);
  return (r << 16) | (g << 8) | b;
}

/**
 * The floor height a prop stands on: the field's ground under it, or, for a
 * prop set just past a lip into the void (the Cleft's mouth, the Slab's
 * jambs, the great hearth), the highest floor within `reach` yards, so it
 * rises from the terrace beside it rather than from the fissure's depth.
 */
export function heartPropBase(x: number, z: number, reach = 10): number {
  if (authoredFieldSurfaceAt(SMITH_HEART_FIELD, x, z)) {
    return authoredFieldHeight(SMITH_HEART_FIELD, x, z);
  }
  let best = Number.NEGATIVE_INFINITY;
  for (let r = 2; r <= reach; r += 2) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const px = x + Math.sin(a) * r;
      const pz = z + Math.cos(a) * r;
      if (!authoredFieldSurfaceAt(SMITH_HEART_FIELD, px, pz)) continue;
      best = Math.max(best, authoredFieldHeight(SMITH_HEART_FIELD, px, pz));
    }
    if (best > Number.NEGATIVE_INFINITY) return best;
  }
  return SMITH_HEART_FIELD.voidHeight;
}

// ---- lights -------------------------------------------------------------------------

/** One budgeted point light (instance-local; `lift` above the floor). */
/** The Cleft's braziers in the gate's frame (the kit builds them there:
 *  build_smith_heart_hammer_kit.py cleft_gate): across, out toward the
 *  landing, and the height of their fire over the landing. */
export const HEART_CLEFT_BRAZIER = { x: 6.4, z: 5.0, lift: 2.6 } as const;
/** The two larger amber crystal clusters at the Cleft gate's foot that carry
 *  a light (the gate's frame, as the braziers'; hammer_air_core.ts
 *  HEART_CLEFT_CRYSTALS lists all four for their halos). */
export const HEART_CLEFT_GLOW_LIGHTS = [
  { x: -10.5, z: 4.6, lift: 1.8 },
  { x: 11.5, z: 3.8, lift: 2.0 },
] as const;

export interface HeartLightSpot {
  id: string;
  x: number;
  z: number;
  lift: number;
  color: number;
  intensity: number;
  range: number;
  /** Draws no halo card (a light that only shapes stone, never a lamp). */
  noHalo?: boolean;
  /** The light's absolute height, for a light hung off the walked floor (the
   *  Cleft's door and braziers stand past the landing's lip, where the
   *  field's height is the void). Otherwise the floor under it plus `lift`. */
  y?: number;
}

function veinKey(id: string, vein: SmithHeartVein, at: { x: number; z: number }): HeartLightSpot {
  return {
    id,
    x: at.x,
    z: at.z,
    lift: 12,
    color: SMITH_HEART_VEIN_COLORS[vein],
    intensity: 8,
    range: 58,
  };
}

function veinMouth(id: string, vein: SmithHeartVein, deg: number): HeartLightSpot {
  const p = ringPoint(deg, RING.R);
  return {
    id,
    x: p.x,
    z: p.z,
    lift: 6,
    color: SMITH_HEART_VEIN_COLORS[vein],
    intensity: 4,
    range: 26,
  };
}

/** Where the fire burns deep in the chasm the anvil bridge crosses (between
 *  the casting floor's west lip and the Forge's east one). */
export const HEAT_BRIDGE_CHASM = { x: -169, z: 0 } as const;

/** Which of the Cornice's rods (in field order) carry a light. */
const LIT_RODS: ReadonlySet<number> = new Set([1, 5]);

function warm(id: string, x: number, z: number, lift: number, color: number): HeartLightSpot {
  return { id, x, z, lift, color, intensity: 3, range: 16 };
}

/**
 * Every budgeted light: each vein's key over its guardian's arena and an
 * accent at its mouth (the Hammer's on the Balcony, the others on the Ring),
 * the seal's glow, the forge's crucibles and hearth, the basin's braziers,
 * two of the Cornice's lightning rods, and the Heart: the core's glow up out
 * of the chasm, a warm key over the platform, the four altars and the
 * terrace's return portal.
 */
export function planHeartLights(): HeartLightSpot[] {
  const spots: HeartLightSpot[] = [
    veinKey('key:hammer', 'hammer', SMITH_HEART_BOSS_SPOTS.hammer),
    veinKey('key:breath', 'breath', BREATH.cornice),
    veinKey('key:quench', 'quench', QUENCH.lake),
    veinKey('key:heat', 'heat', SMITH_HEART_BOSS_SPOTS.heat),
    { ...veinMouth('mouth:hammer', 'hammer', 180), x: 0, z: -86 },
    veinMouth('mouth:breath', 'breath', 0),
    veinMouth('mouth:quench', 'quench', 90),
    veinMouth('mouth:heat', 'heat', 270),
    {
      id: 'seal',
      x: HEART_SEAL.x,
      z: HEART_SEAL.z,
      lift: 8,
      color: HEART_PALETTE.ring,
      intensity: 6,
      range: 34,
    },
    // The Hearth's first flame (phase 2I): strong enough to lay its gold
    // across the Forge and up the altar-stone from its mouth.
    {
      id: 'hearth',
      x: GREAT_HEARTH.x + 9,
      z: GREAT_HEARTH.z,
      lift: 9,
      color: SMITH_HEART_VEIN_COLORS.heat,
      intensity: 16,
      range: 54,
    },
    // The fire deep in the chasm under the anvil bridge, lighting its arch
    // and the cliffs from below (phase 2I).
    {
      id: 'chasm:heat',
      x: HEAT_BRIDGE_CHASM.x,
      z: HEAT_BRIDGE_CHASM.z,
      lift: -14,
      color: SMITH_HEART_VEIN_COLORS.heat,
      intensity: 14,
      range: 34,
      noHalo: true,
    },
    {
      id: 'core',
      x: HEART_ROOM.x,
      z: HEART_ROOM.z,
      lift: -28,
      color: 0xffd890,
      intensity: 12,
      range: 90,
    },
    {
      id: 'key:heart',
      x: HEART_ROOM.x,
      z: HEART_ROOM.z,
      lift: 20,
      color: 0xffe6c0,
      intensity: 6,
      range: 64,
    },
    // Each altar lights its own quarter of the platform (phase 2J: the
    // altars stand taller, their vein's light over their quarter).
    ...HEART_ALTARS.map((a) => ({
      id: `altar:${a.vein}`,
      x: a.x,
      z: a.z,
      lift: 9,
      color: SMITH_HEART_VEIN_COLORS[a.vein],
      intensity: 11,
      range: 34,
    })),
    {
      id: 'return_portal',
      x: HEART_RETURN_PORTAL.x,
      z: HEART_RETURN_PORTAL.z,
      lift: 5,
      color: HEART_PALETTE.ring,
      intensity: 4,
      range: 20,
    },
  ];
  // The Hammer: a warm fill on each colossus's face from the pit side (the
  // carving must read against the terraces), and the vein's glow at the
  // Cleft's door.
  for (const p of SMITH_HEART_FIELD.props) {
    if (p.kind === 'sh_quarry_colossus') {
      const dx = HAMMER_PIT.x - p.x;
      const dz = HAMMER_PIT.z - p.z;
      const d = Math.hypot(dx, dz);
      spots.push({
        id: `colossus:${p.x.toFixed(0)}:${p.z.toFixed(0)}`,
        x: p.x + (dx / d) * 9,
        z: p.z + (dz / d) * 9,
        lift: 9,
        color: 0xffc890,
        intensity: 2.2,
        range: 26,
        noHalo: true,
      });
    } else if (p.kind === 'sh_cleft_mouth') {
      // The raid's first image: the vein's glow in the doorway, and the two
      // braziers flanking its steps (the kit's, at x +-6.4, 5 yd out of the
      // gate's origin), all standing past the landing's lip at its height.
      const at = (lx: number, lz: number) => ({
        x: p.x + lx * Math.cos(p.rot) + lz * Math.sin(p.rot),
        z: p.z - lx * Math.sin(p.rot) + lz * Math.cos(p.rot),
      });
      spots.push({
        id: 'cleft_door',
        ...at(0, 7),
        lift: 7,
        y: CLEFT.h + 9,
        color: 0xffb860,
        // Physical falloff: a light that must reach the flanks 15 to 25 yd
        // off needs a strong source (the colossi's fills sit 9 yd off).
        intensity: 40,
        range: 44,
        noHalo: true,
      });
      // The flanks' bounce: the sun off the landing and the braziers' glow
      // lifting the rock over the door out of the dark (no halo, steady).
      spots.push({
        id: 'cleft_fill',
        ...at(0, 14),
        lift: 20,
        y: CLEFT.h + 20,
        color: 0xffd2a8,
        intensity: 60,
        range: 56,
        noHalo: true,
      });
      for (const s of [-1, 1]) {
        spots.push({
          id: `cleft_brazier:${s}`,
          ...at(s * HEART_CLEFT_BRAZIER.x, HEART_CLEFT_BRAZIER.z),
          lift: HEART_CLEFT_BRAZIER.lift,
          y: CLEFT.h + HEART_CLEFT_BRAZIER.lift,
          color: HEART_PALETTE.coal,
          intensity: 12,
          range: 22,
        });
      }
      // The amber crystals at the flanks' foot cast their own warm glow on
      // the rock round them (phase 2D: the first image's accent; small,
      // steady, no card: the air draws their halos).
      for (const c of HEART_CLEFT_GLOW_LIGHTS) {
        spots.push({
          id: `cleft_crystals:${c.x}`,
          ...at(c.x, c.z),
          lift: c.lift,
          y: CLEFT.h + c.lift,
          color: 0xff9a3c,
          intensity: 9,
          range: 13,
          noHalo: true,
        });
      }
    }
  }
  // Two of the Cornice's lightning rods (east and west of the arena) carry
  // their tip's storm light; the rest only glow.
  let rod = 0;
  for (const p of SMITH_HEART_FIELD.props) {
    if (p.kind === 'sh_crucible') {
      // The fire crystal's clusters (phase 2I: the old crucibles' spots),
      // a warm pool round each.
      spots.push({
        ...warm(`crystal:${p.x}:${p.z}`, p.x, p.z, 3.4, SMITH_HEART_VEIN_COLORS.heat),
        intensity: 4,
        range: 17,
      });
    } else if (p.kind === 'sh_pour_crucible') {
      // The wellspring brimming (phase 2I), just over its fire.
      spots.push({
        ...warm(`wellspring:${p.x}:${p.z}`, p.x, p.z, 3.2, SMITH_HEART_VEIN_COLORS.heat),
        intensity: 6,
        range: 20,
      });
    } else if (p.kind === 'sh_brazier') {
      // The Quench's fire bowls (phase 2H): the one warm light in the cold,
      // strong enough to lay a warm pool on the snow round each bowl.
      spots.push({
        ...warm(`brazier:${p.x}:${p.z}`, p.x, p.z, 3.2, HEART_PALETTE.coal),
        intensity: 7,
        range: 20,
      });
    } else if (p.kind === 'sh_lightning_rod' && LIT_RODS.has(rod++)) {
      spots.push({
        id: `rod:${p.x}:${p.z}`,
        x: p.x,
        z: p.z,
        lift: 23,
        color: SMITH_HEART_VEIN_COLORS.breath,
        intensity: 4,
        range: 30,
      });
    }
  }
  return spots;
}

/** The light zone that holds (x, z) (the first listed that contains it). */
export function heartLightZoneOf(x: number, z: number): FieldLightZone | null {
  for (const zone of SMITH_HEART_FIELD.lightZones) {
    if (Math.hypot(x - zone.x, z - zone.z) <= zone.r) return zone;
  }
  return null;
}

/** Deterministic hash in [0, 1) of two integers (no rng in a plan). */
export function heartHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
