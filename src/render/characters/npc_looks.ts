// Authored looks for EVERY world NPC, pure data + resolution, no three.js (the
// manifest.ts contract). An NPC is a WOC body: the body, kit and clips of one
// player class (woc_parts_core.ts), wearing a look the character creator's face
// builder could have made (src/ui/woc_head_builder_model.ts): a body type, one
// piece per head slot, a piercing preset, four colours, the five face controls
// and a body size. Nothing here is NPC-only art: every value is one a player
// can reach in the creator, so a town reads as a crowd of people, each with a
// face of their own, on the same bodies the players wear.
//
// Each look is a recreation of the face the NPC wore before, on the composed
// KayKit bodies (2026-10): shot face on, then rebuilt in the creator beside it.
//
// Authoring language (kept consistent so hubs read as communities):
// - `cls` is the class whose kit the NPC wore before: the robe is a mage, the
//   leaf kit a druid, the ranger tunic a hunter, the rogue tunic a rogue, the
//   silver plate a warrior, the gold plate a paladin, and the fur and bare chest
//   kit a warrior. A priest only where the NPC is one by name or by nature
//   (Brother Aldric, Vicar Creel, the Pale Keeper).
// - Bare headed, always: the dressing leaves every NPC's head slot empty, so no
//   helm or hood ever covers the authored face and hair.
// - Colours are the stored HSL the builder writes, and they were SOLVED, never
//   copied: the same value draws brighter on these heads than it did on the old
//   bodies, so each skin and hair colour is the one whose render lands on the
//   old face's measured colour. Brows wear the hair colour.
// - `headShape` carries character. Where the old face had an eye shape (wide,
//   narrow, droopy, cat, wide set) the matching control is pushed; a cast of
//   comic regulars has it pushed to the stop; every other face keeps a small
//   offset of its own, so no two NPCs share a pair of eyes.
// - `bodyScale` follows the old build where one was authored (the smiths stand
//   tall, Tinker Gizzel does not), else a per-NPC roll inside the creator's
//   range. A row may carry none: that body draws at the creator's default size.
// - Piercings stand in for the old jewellery, and for a few rogues who earned one.
// - `props` picks a fixed held-prop set (manifest.ts NPC_PROP_ATTACH): NPC gear
//   never changes, so props are authored attaches, never weapon swaps.
//
// The quest escortees wear a look too, though the sim makes them MOBS so the
// escort driver can walk them, and so do the Mirefen muster's soldiers (friendly
// mobs so they can fight Balgath beside the player), and so does every humanoid
// enemy (the outlaws, the cults, the knights, the drowned): MOB_LOOK_IDS below
// names each one, and nothing else that is a mob ever wears a look. The caravan
// drivers wear a row too, asked for by the wagon that seats them.
//
// tests/npc_looks.test.ts pins: every NpcDef id resolves to a look, every
// authored value is one the look's own head type offers and survives
// normalizeAppearance unchanged (a typo'd id would silently fall back to the
// type's default face), no two NPCs share an appearance, and the mob-kind ids
// that wear a look are exactly the escortees, the muster's soldiers and the
// humanoid enemies.

import type { EntityKind, PlayerClass } from '../../sim/types';
import {
  type ModularAppearance,
  NEUTRAL_HEAD_SHAPE,
  normalizeAppearance,
  type WocHeadShape,
} from './modular';

/** Fixed held-prop sets (the attach lists live in manifest.ts NPC_PROP_ATTACH).
 *  Data here, geometry there, so this module stays free of asset paths. */
export type NpcPropSet =
  | 'none'
  | 'staff'
  | 'walking_staff'
  | 'oak_stave'
  | 'tome'
  | 'crossbow'
  | 'hammer'
  | 'woodaxe'
  | 'sword_shield'
  | 'sword'
  | 'scythe'
  | 'knife'
  | 'spear'
  | 'spear_shield'
  | 'hammer_shield'
  | 'mallet'
  | 'daggers'
  | 'axe'
  | 'dark_staff'
  | 'wand';

export const NPC_PROP_SET_IDS: readonly NpcPropSet[] = [
  'none',
  'staff',
  'walking_staff',
  'oak_stave',
  'tome',
  'crossbow',
  'hammer',
  'woodaxe',
  'sword_shield',
  'sword',
  'scythe',
  'knife',
  'spear',
  'spear_shield',
  'hammer_shield',
  'mallet',
  'daggers',
  'axe',
  'dark_staff',
  'wand',
];

/** The appearance fields a WOC body draws (the face builder's record). */
export type NpcFace = Pick<
  ModularAppearance,
  | 'gender'
  | 'headHair'
  | 'headBeard'
  | 'headBrows'
  | 'headEyes'
  | 'headNose'
  | 'headMouth'
  | 'headEars'
  | 'headPiercing'
  | 'skinHue'
  | 'skinSat'
  | 'skinLight'
  | 'hairHue'
  | 'hairSat'
  | 'hairLight'
  | 'browHue'
  | 'browSat'
  | 'browLight'
  | 'eyeHue'
  | 'eyeSat'
  | 'eyeLight'
> &
  Partial<Pick<ModularAppearance, 'headShape' | 'bodyScale'>>;

export interface NpcLookDef {
  /** The class whose WOC body, kit and clips the NPC wears. */
  cls: PlayerClass;
  app: NpcFace;
  props: NpcPropSet;
}

/** A resolved look: the class, the normalized appearance its head and body
 *  size draw from, and the held props. */
export interface NpcLook {
  readonly cls: PlayerClass;
  readonly app: ModularAppearance;
  readonly props: NpcPropSet;
}

// --- authoring helpers -------------------------------------------------------

/** One piece per head slot, then the piercing preset (the last two default). */
const head = (
  hairStyle: string,
  beard: string,
  brows: string,
  eyeShape: string,
  nose: string,
  mouth: string,
  ears = 'default',
  piercing = 'none',
) => ({
  headHair: hairStyle,
  headBeard: beard,
  headBrows: brows,
  headEyes: eyeShape,
  headNose: nose,
  headMouth: mouth,
  headEars: ears,
  headPiercing: piercing,
});
const skin = (h: number, s: number, l: number) => ({ skinHue: h, skinSat: s, skinLight: l });
/** Hair colour, with the brows dyed to match (the builder's "match hair"). */
const hair = (h: number, s: number, l: number) => ({
  hairHue: h,
  hairSat: s,
  hairLight: l,
  browHue: h,
  browSat: s,
  browLight: l,
});
const eyes = (h: number, s: number, l: number) => ({ eyeHue: h, eyeSat: s, eyeLight: l });
/** The face controls, each at its rest value unless named. */
const shape = (o: Partial<WocHeadShape>): WocHeadShape => ({ ...NEUTRAL_HEAD_SHAPE, ...o });

// --- the roster --------------------------------------------------------------

export const NPC_LOOKS: Record<string, NpcLookDef> = {
  // Flightmaster Zephyr, Windrider Instructor.
  glider_instructor: {
    cls: 'hunter',
    app: {
      gender: 'male',
      ...head('quiff', 'none', 'relaxed', 'almond', 'default', 'default'),
      ...skin(30, 0.45, 0.47),
      ...hair(30, 0.3, 0.18),
      ...eyes(194, 0.48, 0.43),
      headShape: shape({ eyeSpacing: 0.6, eyeSize: -0.09, eyeTilt: 0.5, chinWidth: 0.57 }),
      bodyScale: 1.01,
    },
    props: 'none',
  },
  // Skye, Zephyrs Apprentice.
  glider_apprentice: {
    cls: 'hunter',
    app: {
      gender: 'female',
      ...head('braid', 'none', 'default', 'almond', 'soft', 'default', 'default', 'lobes'),
      ...skin(29, 0.28, 0.58),
      ...hair(36, 0.72, 0.26),
      ...eyes(180, 0.4, 0.48),
      headShape: shape({ eyeSpacing: 0.32, eyeSize: 0.8, eyeTilt: -0.29, chinWidth: 0.67 }),
      bodyScale: 0.98,
    },
    props: 'none',
  },
  // Keeper Liora, Warden of the Hedge Maze.
  wisp_maze_keeper: {
    cls: 'hunter',
    app: {
      gender: 'female',
      ...head('braid', 'none', 'default', 'almond', 'soft', 'default'),
      ...skin(27, 0.36, 0.55),
      ...hair(95, 0.56, 0.18),
      ...eyes(150, 0.45, 0.45),
      headShape: shape({ eyeSpacing: 0.25, eyeSize: 0.22, eyeTilt: 0.3, chinWidth: 0.6 }),
      bodyScale: 1.03,
    },
    props: 'none',
  },
  // Scout Valerie, Covert Operations.
  shadow_cloak_scout: {
    cls: 'rogue',
    app: {
      gender: 'female',
      ...head('braid', 'none', 'default', 'almond', 'soft', 'default', 'default', 'lip'),
      ...skin(27, 0.38, 0.48),
      ...hair(13, 0.55, 0.12),
      ...eyes(165, 0.4, 0.4),
      headShape: shape({ eyeSpacing: 0.24, eyeSize: -0.09, eyeTilt: 0.15, chinWidth: 0.67 }),
    },
    props: 'knife',
  },
  // Dispatch Guard, Dispatch Carrier.
  shadow_guard_north: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('quiff', 'none', 'relaxed', 'almond', 'default', 'default'),
      ...skin(24, 0.44, 0.42),
      ...hair(17, 0.46, 0.16),
      ...eyes(30, 0.3, 0.35),
      headShape: shape({ eyeSpacing: -1, eyeSize: -0.3, eyeTilt: 0.14, chinWidth: 0.62 }),
      bodyScale: 1.02,
    },
    props: 'sword',
  },
  // Dispatch Guard, Dispatch Carrier.
  shadow_guard_south: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('mohawk', 'none', 'relaxed', 'almond', 'default', 'default', 'default', 'septum'),
      ...skin(26, 0.45, 0.43),
      ...hair(23, 0.46, 0.16),
      ...eyes(45, 0.3, 0.35),
      headShape: shape({
        eyeSpacing: 0.02,
        eyeSize: 1,
        eyeTilt: 0.26,
        browHeight: 0.6,
        chinWidth: 0.62,
      }),
      bodyScale: 0.97,
    },
    props: 'sword',
  },
  // Dispatch Guard, Dispatch Carrier.
  shadow_guard_east: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('undercut', 'none', 'slim', 'almond', 'default', 'default', 'default', 'lip'),
      ...skin(23, 0.43, 0.47),
      ...hair(23, 0.45, 0.16),
      ...eyes(60, 0.3, 0.35),
      headShape: shape({ eyeSpacing: 1, eyeSize: -0.8, eyeTilt: 0.09, chinWidth: 0.62 }),
      bodyScale: 1.04,
    },
    props: 'sword',
  },
  // Dispatch Guard, Dispatch Carrier.
  shadow_guard_west: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('bald', 'none', 'default', 'almond', 'default', 'default', 'default', 'full'),
      ...skin(26, 0.45, 0.48),
      ...hair(23, 0.44, 0.16),
      ...eyes(75, 0.3, 0.35),
      headShape: shape({
        eyeSpacing: 0.4,
        eyeSize: -1,
        eyeTilt: 0.12,
        browHeight: -0.7,
        chinWidth: 0.62,
      }),
      bodyScale: 0.96,
    },
    props: 'sword',
  },
  // Lantern Sentry, True Sight.
  shadow_sentry_south: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('quiff', 'chinstrap', 'relaxed', 'almond', 'default', 'default'),
      ...skin(25, 0.39, 0.52),
      ...hair(33, 0.44, 0.16),
      ...eyes(90, 0.3, 0.35),
      headShape: shape({
        eyeSpacing: -0.18,
        eyeSize: -0.8,
        eyeTilt: -1,
        browHeight: 0.4,
        chinWidth: 0.62,
      }),
      bodyScale: 1.03,
    },
    props: 'spear',
  },
  // Lantern Sentry, True Sight.
  shadow_sentry_north: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('swept', 'none', 'rounded', 'almond', 'default', 'default'),
      ...skin(27, 0.4, 0.53),
      ...hair(34, 0.46, 0.16),
      ...eyes(105, 0.3, 0.35),
      headShape: shape({
        eyeSpacing: 0.35,
        eyeSize: 0.9,
        eyeTilt: -0.09,
        browHeight: 0.8,
        chinWidth: 0.62,
      }),
      bodyScale: 0.98,
    },
    props: 'spear',
  },
  // Lantern Watchman, True Sight.
  shadow_watch_west: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('mohawk', 'moustache', 'relaxed', 'almond', 'default', 'default', 'default', 'brow'),
      ...skin(26, 0.4, 0.57),
      ...hair(34, 0.46, 0.16),
      ...eyes(120, 0.3, 0.35),
      headShape: shape({ eyeSpacing: 1, eyeSize: -0.8, eyeTilt: 0.6, chinWidth: 0.62 }),
      bodyScale: 1.05,
    },
    props: 'spear',
  },
  // Lantern Watchman, True Sight.
  shadow_watch_east: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('bald', 'boxed', 'relaxed', 'almond', 'default', 'default'),
      ...skin(26, 0.4, 0.59),
      ...hair(40, 0.45, 0.16),
      ...eyes(135, 0.3, 0.35),
      headShape: shape({ eyeSpacing: -1, eyeSize: -0.5, eyeTilt: -0.24, chinWidth: 0.62 }),
      bodyScale: 0.95,
    },
    props: 'spear',
  },

  // === Eastbrook Vale: the starter valley, warm and rustic =================
  // The Merchant, Keeper of the World Market.
  the_merchant: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('undercut', 'goatee', 'slim', 'almond', 'default', 'smirk', 'default', 'lobes'),
      ...skin(29, 0.44, 0.52),
      ...hair(40, 0.75, 0.03),
      ...eyes(46, 0.55, 0.4),
      headShape: shape({
        eyeSpacing: -0.3,
        eyeSize: -0.8,
        eyeTilt: 0.8,
        browHeight: 0.3,
        chinWidth: 0.62,
      }),
    },
    props: 'none',
  },
  // Marshal Redbrook, Town Marshal.
  marshal_redbrook: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('quiff', 'boxed', 'default', 'almond', 'broad', 'default'),
      ...skin(26, 0.48, 0.53),
      ...hair(29, 0.15, 0.25),
      ...eyes(200, 0.35, 0.3),
      headShape: shape({
        eyeSpacing: 0.14,
        eyeSize: 0.16,
        eyeTilt: 0.7,
        browHeight: -0.24,
        chinWidth: 0.38,
      }),
      bodyScale: 1.03,
    },
    props: 'sword_shield',
  },
  // Trader Wilkes, Provisioner.
  trader_wilkes: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('swept', 'chinstrap', 'soft_arch', 'default', 'default', 'smirk'),
      ...skin(26, 0.46, 0.57),
      ...hair(29, 0.54, 0.3),
      ...eyes(140, 0.35, 0.3),
      headShape: shape({
        eyeSpacing: 1,
        eyeSize: 0.5,
        eyeTilt: 0.26,
        browHeight: 0.4,
        chinWidth: 0.36,
      }),
      bodyScale: 0.97,
    },
    props: 'none',
  },
  // Apothecary Lin, Herbalist.
  apothecary_lin: {
    cls: 'druid',
    app: {
      gender: 'female',
      ...head('shoulder', 'none', 'relaxed', 'default', 'soft', 'full'),
      ...skin(29, 0.31, 0.57),
      ...hair(3, 0.66, 0.03),
      ...eyes(30, 0.4, 0.2),
      headShape: shape({ eyeSpacing: -0.4, eyeSize: 0.9, eyeTilt: 0.26, chinWidth: 0.62 }),
      bodyScale: 0.95,
    },
    props: 'none',
  },
  // Brother Aldric, Priest of the Vale.
  brother_aldric: {
    cls: 'priest',
    app: {
      gender: 'male',
      ...head('long', 'none', 'relaxed', 'default', 'default', 'default'),
      ...skin(25, 0.5, 0.63),
      ...hair(220, 0.1, 0.05),
      ...eyes(25, 0.4, 0.1),
      headShape: shape({
        eyeSpacing: 0.1,
        eyeSize: 0.35,
        eyeTilt: -0.15,
        browHeight: -0.25,
        chinWidth: 0.5,
      }),
      bodyScale: 0.99,
    },
    props: 'staff',
  },
  // Smith Haldren, Armorer & Weaponsmith.
  smith_haldren: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('bald', 'handlebar', 'default', 'almond', 'broad', 'default'),
      ...skin(24, 0.54, 0.48),
      ...hair(31, 0.75, 0.07),
      ...eyes(28, 0.45, 0.25),
      headShape: shape({ eyeSpacing: 0.3, eyeSize: -0.4, eyeTilt: -0.15, chinWidth: 0.44 }),
      bodyScale: 1.05,
    },
    props: 'hammer',
  },
  // Fisherman Brandt, Old Salt.
  fisherman_brandt: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('bald', 'boxed', 'default', 'hooded', 'aquiline', 'smirk'),
      ...skin(25, 0.54, 0.46),
      ...hair(9, 0.04, 0.5),
      ...eyes(190, 0.4, 0.4),
      headShape: shape({
        eyeSpacing: 0.6,
        eyeSize: 0.16,
        eyeTilt: -1,
        browHeight: 0.6,
        chinWidth: 0.71,
      }),
      bodyScale: 1.01,
    },
    props: 'spear',
  },
  // Foreman Odell, Mine Foreman.
  foreman_odell: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('bald', 'chops', 'relaxed', 'almond', 'broad', 'default'),
      ...skin(28, 0.51, 0.43),
      ...hair(23, 0.34, 0.18),
      ...eyes(30, 0.4, 0.35),
      headShape: shape({
        eyeSpacing: -0.8,
        eyeSize: -1,
        eyeTilt: 0.7,
        browHeight: -0.9,
        chinWidth: 0.22,
      }),
      bodyScale: 1.03,
    },
    props: 'hammer',
  },
  // Bursar Fernando, The Gilded Strongbox.
  bursar_fernando: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('long', 'none', 'arched', 'almond', 'default', 'full', 'default', 'lobes'),
      ...skin(29, 0.57, 0.42),
      ...hair(3, 0.65, 0.03),
      ...eyes(25, 0.5, 0.35),
      headShape: shape({
        eyeSpacing: -0.39,
        eyeSize: 0.4,
        eyeTilt: 0.4,
        browHeight: 0.3,
        chinWidth: 0.62,
      }),
      bodyScale: 0.98,
    },
    props: 'none',
  },
  // Card Master, Dealer of Chance.
  card_master: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('swept', 'moustache', 'arched', 'almond', 'default', 'smirk', 'default', 'lobes'),
      ...skin(27, 0.5, 0.48),
      ...hair(20, 0.75, 0.03),
      ...eyes(280, 0.5, 0.35),
      headShape: shape({
        eyeSpacing: -0.9,
        eyeSize: -0.03,
        eyeTilt: 1,
        browHeight: 0.5,
        chinWidth: 0.62,
      }),
      bodyScale: 1.02,
    },
    props: 'none',
  },
  // groundskeeper_bram.
  groundskeeper_bram: {
    cls: 'druid',
    app: {
      gender: 'male',
      ...head('swept', 'none', 'soft_arch', 'default', 'default', 'smirk'),
      ...skin(27, 0.5, 0.51),
      ...hair(41, 0.62, 0.32),
      ...eyes(140, 0.45, 0.35),
      headShape: shape({
        eyeSpacing: 0.5,
        eyeSize: 0.6,
        eyeTilt: -0.2,
        browHeight: 0.5,
        chinWidth: 0.53,
      }),
      bodyScale: 1.03,
    },
    props: 'scythe',
  },
  // Saul the Chronicler, The Vale Chronicle.
  chronicler_saul: {
    cls: 'mage',
    app: {
      gender: 'male',
      ...head('quiff', 'boxed', 'rounded', 'default', 'default', 'full'),
      ...skin(27, 0.38, 0.52),
      ...hair(41, 0.04, 0.4),
      ...eyes(210, 0.35, 0.4),
      headShape: shape({
        eyeSpacing: -0.24,
        eyeSize: 0.4,
        eyeTilt: 0.09,
        browHeight: 0.4,
        chinWidth: 0.69,
      }),
    },
    props: 'tome',
  },
  // Forgemistress Darva, Master of the Forge.
  forgemistress_darva: {
    cls: 'warrior',
    app: {
      gender: 'female',
      ...head('topknot', 'none', 'default', 'almond', 'soft', 'full', 'default', 'ears'),
      ...skin(25, 0.54, 0.45),
      ...hair(3, 0.68, 0.25),
      ...eyes(30, 0.55, 0.45),
      headShape: shape({
        eyeSpacing: -0.28,
        eyeSize: 0.06,
        eyeTilt: 0.6,
        browHeight: -0.18,
        chinWidth: 0.47,
      }),
      bodyScale: 1.04,
    },
    props: 'hammer',
  },
  // Cook Marlow, Master of the Kitchens.
  cook_marlow: {
    cls: 'druid',
    app: {
      gender: 'male',
      ...head('bald', 'chin', 'rounded', 'default', 'default', 'smirk'),
      ...skin(26, 0.49, 0.57),
      ...hair(31, 0.72, 0.12),
      ...eyes(28, 0.5, 0.28),
      headShape: shape({
        eyeSpacing: 0.9,
        eyeSize: 0.8,
        eyeTilt: -0.01,
        browHeight: 0.6,
        chinWidth: 0.05,
      }),
      bodyScale: 1.04,
    },
    props: 'knife',
  },
  // Farmer Jessica, Allotment Keeper.
  farmer_jessica: {
    cls: 'druid',
    app: {
      gender: 'female',
      ...head('braid', 'none', 'soft', 'default', 'button', 'relaxed'),
      ...skin(27, 0.5, 0.49),
      ...hair(25, 0.73, 0.18),
      ...eyes(90, 0.45, 0.35),
      headShape: shape({
        eyeSpacing: -0.2,
        eyeSize: 0.5,
        eyeTilt: 0.29,
        browHeight: 0.3,
        chinWidth: 0.46,
      }),
    },
    props: 'scythe',
  },
  // Farmer Teasel, Fen Paddy Farmer.
  farmer_teasel: {
    cls: 'hunter',
    app: {
      gender: 'male',
      ...head('swept', 'boxed', 'relaxed', 'almond', 'broad', 'default'),
      ...skin(24, 0.5, 0.4),
      ...hair(245, 0.04, 0.6),
      ...eyes(210, 0.35, 0.5),
      headShape: shape({
        eyeSpacing: 0.41,
        eyeSize: -0.8,
        eyeTilt: 0.08,
        browHeight: -0.24,
        chinWidth: 0.44,
      }),
      bodyScale: 1.01,
    },
    props: 'walking_staff',
  },
  // Farmer Hollis, Highwatch Terrace Farmer.
  farmer_hollis: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('quiff', 'boxed', 'default', 'almond', 'default', 'smirk'),
      ...skin(22, 0.63, 0.32),
      ...hair(17, 0.66, 0.14),
      ...eyes(40, 0.5, 0.3),
      headShape: shape({
        eyeSpacing: -0.5,
        eyeSize: 0.16,
        eyeTilt: 0.7,
        browHeight: 0.3,
        chinWidth: 0.3,
      }),
      bodyScale: 1.05,
    },
    props: 'woodaxe',
  },
  // Farmer Verbena, Parterre Gardener.
  farmer_verbena: {
    cls: 'mage',
    app: {
      gender: 'female',
      ...head('curls', 'none', 'soft_arch', 'default', 'button', 'full'),
      ...skin(29, 0.38, 0.59),
      ...hair(286, 0.11, 0.5),
      ...eyes(300, 0.4, 0.55),
      headShape: shape({
        eyeSpacing: 0.11,
        eyeSize: 0.9,
        eyeTilt: 0.1,
        browHeight: -0.12,
        chinWidth: 0.51,
      }),
    },
    props: 'none',
  },
  // Weaver Ottilie, Master of the Loom.
  weaver_ottilie: {
    cls: 'druid',
    app: {
      gender: 'female',
      ...head('crown', 'none', 'soft', 'default', 'soft', 'cupids_bow', 'default', 'lobes'),
      ...skin(26, 0.38, 0.59),
      ...hair(15, 0.63, 0.25),
      ...eyes(140, 0.4, 0.35),
      headShape: shape({ eyeSpacing: 0.43, eyeSize: 0.9, eyeTilt: -0.2, chinWidth: 0.62 }),
      bodyScale: 1.02,
    },
    props: 'none',
  },
  // Tinker Gizzel, Master of the Toolworks.
  tinker_gizzel: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('swept', 'goatee', 'rounded', 'default', 'aquiline', 'smirk', 'large', 'ears'),
      ...skin(26, 0.5, 0.54),
      ...hair(15, 0.73, 0.25),
      ...eyes(95, 0.5, 0.4),
      headShape: shape({
        eyeSpacing: 1,
        eyeSize: 1,
        eyeTilt: 0.17,
        browHeight: 1,
        chinWidth: 0.62,
      }),
      bodyScale: 0.95,
    },
    props: 'hammer',
  },
  // Brother Halven, Reliquary Keeper.
  brother_halven: {
    cls: 'paladin',
    app: {
      gender: 'male',
      ...head('quiff', 'boxed', 'soft_arch', 'almond', 'default', 'default'),
      ...skin(27, 0.38, 0.52),
      ...hair(31, 0.72, 0.12),
      ...eyes(210, 0.3, 0.35),
      headShape: shape({
        eyeSpacing: 0.29,
        eyeSize: 0.12,
        eyeTilt: -0.25,
        browHeight: -0.12,
        chinWidth: 0.62,
      }),
      bodyScale: 1.01,
    },
    props: 'staff',
  },
  // FURY, Honor Quartermaster.
  fury: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('bald', 'none', 'default', 'almond', 'default', 'default', 'default', 'septum'),
      ...skin(25, 0.49, 0.32),
      ...hair(3, 0.7, 0.07),
      ...eyes(0, 0.8, 0.35),
      headShape: shape({
        eyeSpacing: -0.5,
        eyeSize: -0.8,
        eyeTilt: 0.04,
        browHeight: -1,
        chinWidth: 0.18,
      }),
      bodyScale: 1.05,
    },
    props: 'sword_shield',
  },
  // Warden Coalfast, Redoubt Commander.
  warden_coalfast: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('quiff', 'boxed', 'relaxed', 'almond', 'broad', 'default'),
      ...skin(27, 0.46, 0.48),
      ...hair(10, 0.04, 0.4),
      ...eyes(210, 0.3, 0.3),
      headShape: shape({
        eyeSpacing: 0.15,
        eyeSize: -0.29,
        eyeTilt: 0.7,
        browHeight: -0.5,
        chinWidth: 0.41,
      }),
      bodyScale: 1.02,
    },
    props: 'sword_shield',
  },
  // Riftwatch Ollun, Breach Scholar.
  riftwatch_ollun: {
    cls: 'mage',
    app: {
      gender: 'male',
      ...head('swept', 'none', 'rounded', 'default', 'default', 'default'),
      ...skin(29, 0.38, 0.57),
      ...hair(31, 0.66, 0.2),
      ...eyes(185, 0.5, 0.4),
      headShape: shape({
        eyeSpacing: 1,
        eyeSize: 0.5,
        eyeTilt: 0.16,
        browHeight: 0.8,
        chinWidth: 0.62,
      }),
    },
    props: 'tome',
  },
  // Riftwright Maelis, Rift Forgemaster.
  riftwright_maelis: {
    cls: 'warrior',
    app: {
      gender: 'female',
      ...head('undercut', 'none', 'straight', 'almond', 'soft', 'relaxed', 'default', 'brow'),
      ...skin(22, 0.4, 0.27),
      ...hair(280, 0.45, 0.25),
      ...eyes(280, 0.6, 0.55),
      headShape: shape({
        eyeSpacing: -0.33,
        eyeSize: -0.11,
        eyeTilt: -0.14,
        browHeight: 0.18,
        chinWidth: 0.56,
      }),
      bodyScale: 1.01,
    },
    props: 'hammer',
  },
  // Quartermaster Edda, Redoubt Armorer.
  quartermaster_edda: {
    cls: 'warrior',
    app: {
      gender: 'female',
      ...head('ponytail', 'none', 'straight', 'almond', 'soft', 'default'),
      ...skin(25, 0.38, 0.5),
      ...hair(40, 0.15, 0.4),
      ...eyes(210, 0.3, 0.35),
      headShape: shape({ eyeSpacing: -0.13, eyeSize: 0.09, eyeTilt: 0.23, chinWidth: 0.5 }),
      bodyScale: 1.02,
    },
    props: 'hammer',
  },
  // Mender Saul, Field Surgeon.
  mender_saul: {
    cls: 'mage',
    app: {
      gender: 'male',
      ...head('swept', 'none', 'rounded', 'hooded', 'default', 'default'),
      ...skin(30, 0.38, 0.57),
      ...hair(37, 0.7, 0.18),
      ...eyes(140, 0.3, 0.35),
      headShape: shape({
        eyeSpacing: -0.24,
        eyeSize: -0.5,
        eyeTilt: -0.6,
        browHeight: 0.4,
        chinWidth: 0.71,
      }),
    },
    props: 'none',
  },
  // Bellkeeper Tam, Watchbell Keeper.
  bellkeeper_tam: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('quiff', 'none', 'soft_arch', 'default', 'default', 'default', 'large'),
      ...skin(24, 0.46, 0.61),
      ...hair(37, 0.57, 0.4),
      ...eyes(200, 0.5, 0.4),
      headShape: shape({
        eyeSpacing: 0.06,
        eyeSize: 1,
        eyeTilt: 0.1,
        browHeight: 0.7,
        chinWidth: 0.62,
      }),
      bodyScale: 0.96,
    },
    props: 'none',
  },
  // Frightened Nell, Gullhaven Fisher.
  fisher_nell: {
    cls: 'rogue',
    app: {
      gender: 'female',
      ...head('bob', 'none', 'relaxed', 'hooded', 'soft', 'narrow'),
      ...skin(24, 0.25, 0.67),
      ...hair(34, 0.48, 0.25),
      ...eyes(200, 0.3, 0.5),
      headShape: shape({
        eyeSpacing: -0.22,
        eyeSize: 1,
        eyeTilt: -0.8,
        browHeight: 1,
        chinWidth: 0.71,
      }),
      bodyScale: 0.95,
    },
    props: 'none',
  },
  // The Pale Keeper, Warden of the Dead.
  spirit_healer: {
    cls: 'priest',
    app: {
      gender: 'female',
      ...head('waves', 'none', 'soft', 'default', 'soft', 'full'),
      ...skin(220, 0.1, 0.93),
      ...hair(354, 0.04, 0.7),
      ...eyes(210, 0.3, 0.75),
      headShape: shape({ eyeSpacing: -0.31, eyeSize: 0.9, eyeTilt: -0.18, chinWidth: 0.67 }),
      bodyScale: 1.02,
    },
    props: 'none',
  },
  // ptr_dev_vendor.
  ptr_dev_vendor: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('mohawk', 'long', 'soft_arch', 'almond', 'default', 'smirk', 'default', 'full'),
      ...skin(26, 0.5, 0.55),
      ...hair(320, 0.74, 0.4),
      ...eyes(185, 0.8, 0.5),
      headShape: shape({ eyeSpacing: 1, eyeSize: 1, eyeTilt: 1, browHeight: 0.3, chinWidth: 0.62 }),
      bodyScale: 1.04,
    },
    props: 'none',
  },

  // === Mirefen Marsh: Fenbridge, Bridgemere, Willowweep; drab and damp ======
  // Warden Fenwick, Warden of Fenbridge.
  warden_fenwick: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('quiff', 'chinstrap', 'default', 'almond', 'broad', 'default'),
      ...skin(26, 0.43, 0.46),
      ...hair(23, 0.55, 0.12),
      ...eyes(95, 0.35, 0.3),
      headShape: shape({
        eyeSpacing: 0.4,
        eyeSize: -0.8,
        eyeTilt: -0.04,
        browHeight: -0.24,
        chinWidth: 0.44,
      }),
      bodyScale: 1.02,
    },
    props: 'sword_shield',
  },
  // Maben Skerrit, the Socketwright: seventy, bald, bench-stooped, squinting at
  // close work since before the Foreman wore his eye; verdigris and copper, bare
  // hands for the setting, and a grievance he keeps as sharp as his graver.
  // Carried onto the WOC body at the v0.45.0 integration with the same mapping the
  // character branch used for the rest of the roster (full beard -> boxed, sleepy ->
  // hooded, hoop earrings -> lobes, his rogue kit -> the rogue body).
  socketwright_skerrit: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('bald', 'boxed', 'default', 'hooded', 'default', 'default', 'default', 'lobes'),
      ...skin(26, 0.4, 0.46),
      ...hair(32, 0.12, 0.58),
      ...eyes(88, 0.3, 0.26),
      bodyScale: 0.98,
    },
    props: 'knife',
  },
  // The Mirefen muster around Balgath's crater (sim/content/mirefen_muster.ts): Fenbridge's
  // soldiers dug in under the Foreman's eye. The commander is an NPC (he gives the
  // muster's quests); the rest are friendly mobs, drawn through MOB_LOOK_IDS below. The
  // muster's red rides their ember props.
  // Muster Commander, the muster's leader: grey at the temples and steady.
  muster_commander: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('swept', 'boxed', 'default', 'almond', 'aquiline', 'default'),
      ...skin(26, 0.4, 0.5),
      ...hair(30, 0.08, 0.62),
      ...eyes(210, 0.3, 0.4),
      bodyScale: 1.03,
    },
    props: 'sword_shield',
  },
  // Muster Footman: a young pikeman, spear and shield.
  muster_footman: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('quiff', 'none', 'relaxed', 'almond', 'default', 'default'),
      ...skin(28, 0.42, 0.52),
      ...hair(30, 0.45, 0.22),
      ...eyes(30, 0.35, 0.3),
      bodyScale: 1.0,
    },
    props: 'spear_shield',
  },
  // Muster Sergeant: the line's old hand, sword and shield.
  muster_sergeant: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('undercut', 'chinstrap', 'default', 'hooded', 'broad', 'default'),
      ...skin(24, 0.45, 0.42),
      ...hair(25, 0.25, 0.15),
      ...eyes(200, 0.25, 0.35),
      bodyScale: 1.04,
    },
    props: 'sword_shield',
  },
  // Muster Chaplain: the muster's paladin, hammer and shield.
  muster_chaplain: {
    cls: 'paladin',
    app: {
      gender: 'female',
      ...head('crown', 'none', 'soft_arch', 'almond', 'soft', 'relaxed'),
      ...skin(30, 0.35, 0.6),
      ...hair(40, 0.55, 0.5),
      ...eyes(120, 0.3, 0.35),
      bodyScale: 0.99,
    },
    props: 'hammer_shield',
  },
  // Muster Drillmaster: bald, moustached and loud, his mallet for the Straw Foreman.
  muster_drillmaster: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('bald', 'handlebar', 'relaxed', 'hooded', 'broad', 'default'),
      ...skin(22, 0.5, 0.45),
      ...hair(20, 0.35, 0.3),
      ...eyes(25, 0.3, 0.25),
      bodyScale: 1.05,
    },
    props: 'mallet',
  },
  // Provisioner Hale, Provisioner.
  provisioner_hale: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('bald', 'chops', 'rounded', 'hooded', 'broad', 'smirk'),
      ...skin(26, 0.5, 0.55),
      ...hair(31, 0.46, 0.2),
      ...eyes(30, 0.4, 0.25),
      headShape: shape({
        eyeSpacing: 0.5,
        eyeSize: 0.07,
        eyeTilt: -1,
        browHeight: 0.3,
        chinWidth: 0.55,
      }),
    },
    props: 'none',
  },
  // Herbalist Yara, Herbalist.
  herbalist_yara: {
    cls: 'druid',
    app: {
      gender: 'female',
      ...head('twins', 'none', 'soft', 'default', 'soft', 'default'),
      ...skin(27, 0.5, 0.49),
      ...hair(29, 0.75, 0.12),
      ...eyes(120, 0.45, 0.35),
      headShape: shape({ eyeSpacing: 0.3, eyeSize: 0.25, eyeTilt: -0.2, chinWidth: 0.62 }),
    },
    props: 'none',
  },
  // Scout Maren, Marshal's Scout.
  scout_maren: {
    cls: 'hunter',
    app: {
      gender: 'female',
      ...head('ponytail', 'none', 'relaxed', 'almond', 'soft', 'default'),
      ...skin(24, 0.46, 0.47),
      ...hair(17, 0.65, 0.12),
      ...eyes(95, 0.45, 0.42),
      headShape: shape({ eyeSpacing: -0.08, eyeSize: -0.05, eyeTilt: 0.06, chinWidth: 0.56 }),
    },
    props: 'crossbow',
  },
  // Bursar Petra Vell, The Gilded Strongbox.
  bursar_petra_vell: {
    cls: 'rogue',
    app: {
      gender: 'female',
      ...head('crown', 'none', 'soft_arch', 'almond', 'soft', 'full', 'default', 'lobes'),
      ...skin(27, 0.38, 0.55),
      ...hair(9, 0.75, 0.03),
      ...eyes(210, 0.4, 0.35),
      headShape: shape({ eyeSpacing: 0.19, eyeSize: 0.29, eyeTilt: 0.5, chinWidth: 0.62 }),
      bodyScale: 1.01,
    },
    props: 'none',
  },
  // Chronicler Osric Fenn, The Marsh Chronicle.
  chronicler_osric_fenn: {
    cls: 'mage',
    app: {
      gender: 'male',
      ...head('long', 'goatee', 'rounded', 'hooded', 'aquiline', 'default'),
      ...skin(26, 0.38, 0.53),
      ...hair(40, 0.15, 0.32),
      ...eyes(95, 0.35, 0.35),
      headShape: shape({
        eyeSpacing: 0.38,
        eyeSize: -0.1,
        eyeTilt: -1,
        browHeight: 0.7,
        chinWidth: 0.9,
      }),
    },
    props: 'tome',
  },
  // Tanner Hesk, Master of the Tannery.
  tanner_hesk: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head(
        'topknot',
        'handlebar',
        'relaxed',
        'almond',
        'default',
        'default',
        'default',
        'lobes',
      ),
      ...skin(25, 0.53, 0.46),
      ...hair(30, 0.75, 0.12),
      ...eyes(28, 0.45, 0.25),
      headShape: shape({ eyeSpacing: 0.11, eyeSize: 0.22, eyeTilt: 0.28, chinWidth: 0.5 }),
      bodyScale: 1.02,
    },
    props: 'knife',
  },
  // Waykeeper Pell, Keeper of the Amberfen Steps.
  waykeeper_pell: {
    cls: 'druid',
    app: {
      gender: 'female',
      ...head('curls', 'none', 'soft', 'default', 'button', 'relaxed'),
      ...skin(26, 0.38, 0.55),
      ...hair(30, 0.75, 0.18),
      ...eyes(140, 0.4, 0.35),
      headShape: shape({
        eyeSpacing: 0.06,
        eyeSize: 0.25,
        eyeTilt: 0.17,
        browHeight: 0.3,
        chinWidth: 0.53,
      }),
      bodyScale: 0.96,
    },
    props: 'walking_staff',
  },
  // Bridgewright Alden, Master of the Fenway.
  bridgewright_alden: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('quiff', 'chinstrap', 'default', 'almond', 'default', 'default'),
      ...skin(26, 0.56, 0.48),
      ...hair(24, 0.57, 0.18),
      ...eyes(30, 0.4, 0.25),
      headShape: shape({ eyeSpacing: -0.32, eyeSize: 0.03, eyeTilt: -0.3, chinWidth: 0.47 }),
      bodyScale: 1.02,
    },
    props: 'hammer',
  },
  // Netter Maris, Eel-Netter of Bridgemere.
  netter_maris: {
    cls: 'rogue',
    app: {
      gender: 'female',
      ...head('ponytail', 'none', 'soft', 'almond', 'soft', 'thin', 'default', 'nose'),
      ...skin(23, 0.58, 0.42),
      ...hair(20, 0.75, 0.07),
      ...eyes(185, 0.5, 0.4),
      headShape: shape({
        eyeSpacing: 0.27,
        eyeSize: 0.4,
        eyeTilt: 0.23,
        browHeight: 0.3,
        chinWidth: 0.55,
      }),
      bodyScale: 1.01,
    },
    props: 'spear',
  },
  // Mother Sedge, Fen-Witch of Willowweep.
  mother_sedge: {
    cls: 'mage',
    app: {
      gender: 'female',
      ...head('shoulder', 'none', 'relaxed', 'almond', 'default', 'default', 'default', 'septum'),
      ...skin(24, 0.25, 0.57),
      ...hair(96, 0.04, 0.5),
      ...eyes(95, 0.6, 0.45),
      headShape: shape({ eyeSpacing: 1, eyeSize: 0.5, eyeTilt: 1, chinWidth: 0.95 }),
      bodyScale: 0.98,
    },
    props: 'oak_stave',
  },
  // Watcher Maren, The Windway Watch.
  watcher_maren: {
    cls: 'hunter',
    app: {
      gender: 'female',
      ...head('braid', 'none', 'straight', 'almond', 'soft', 'default'),
      ...skin(26, 0.4, 0.5),
      ...hair(47, 0.56, 0.32),
      ...eyes(200, 0.45, 0.4),
      headShape: shape({
        eyeSpacing: 0.39,
        eyeSize: -0.15,
        eyeTilt: 0.7,
        browHeight: -0.12,
        chinWidth: 0.62,
      }),
      bodyScale: 1.01,
    },
    props: 'crossbow',
  },
  // Harbormaster Odile, Harbormaster of Wickharbor.
  harbormaster_odile: {
    cls: 'rogue',
    app: {
      gender: 'female',
      ...head('bob', 'none', 'default', 'almond', 'soft', 'full'),
      ...skin(26, 0.38, 0.5),
      ...hair(9, 0.75, 0.03),
      ...eyes(210, 0.45, 0.35),
      headShape: shape({
        eyeSpacing: 0.23,
        eyeSize: 0.28,
        eyeTilt: 0.7,
        browHeight: -0.3,
        chinWidth: 0.53,
      }),
      bodyScale: 1.04,
    },
    props: 'none',
  },
  // Keeper Bram, Keeper of the Old Beacon.
  keeper_bram: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('bald', 'boxed', 'default', 'default', 'broad', 'full'),
      ...skin(27, 0.5, 0.48),
      ...hair(10, 0.04, 0.6),
      ...eyes(200, 0.35, 0.45),
      headShape: shape({
        eyeSpacing: 0.45,
        eyeSize: 0.5,
        eyeTilt: -0.26,
        browHeight: 0.5,
        chinWidth: 0.71,
      }),
      bodyScale: 1.01,
    },
    props: 'walking_staff',
  },

  // === Thornpeak Heights: the Highwatch garrison, steel and azure ==========
  // Captain Thessaly, Highwatch Captain.
  captain_thessaly: {
    cls: 'warrior',
    app: {
      gender: 'female',
      ...head('crown', 'none', 'default', 'almond', 'soft', 'default'),
      ...skin(26, 0.39, 0.47),
      ...hair(3, 0.7, 0.07),
      ...eyes(210, 0.4, 0.35),
      headShape: shape({
        eyeSpacing: 0.14,
        eyeSize: -0.01,
        eyeTilt: 0.7,
        browHeight: -0.24,
        chinWidth: 0.44,
      }),
      bodyScale: 1.02,
    },
    props: 'sword_shield',
  },
  // Quartermaster Bree, Highwatch Quartermaster.
  quartermaster_bree: {
    cls: 'rogue',
    app: {
      gender: 'female',
      ...head('curls', 'none', 'relaxed', 'almond', 'soft', 'default'),
      ...skin(28, 0.38, 0.52),
      ...hair(37, 0.69, 0.25),
      ...eyes(30, 0.4, 0.3),
      headShape: shape({
        eyeSpacing: 0.35,
        eyeSize: 0.5,
        eyeTilt: -0.15,
        browHeight: 0.8,
        chinWidth: 0.62,
      }),
    },
    props: 'none',
  },
  // Armorer Hode, Master Armorer.
  armorer_hode: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('bald', 'long', 'default', 'almond', 'broad', 'default'),
      ...skin(25, 0.5, 0.47),
      ...hair(22, 0.67, 0.2),
      ...eyes(28, 0.5, 0.25),
      headShape: shape({ eyeSpacing: -0.41, eyeSize: -0.5, eyeTilt: -0.21, chinWidth: 0.44 }),
      bodyScale: 1.05,
    },
    props: 'hammer',
  },
  // Quartermaster Vex, Heroic Quartermaster.
  heroic_quartermaster: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('mohawk', 'chinstrap', 'slim', 'almond', 'broad', 'default', 'default', 'brow'),
      ...skin(23, 0.47, 0.37),
      ...hair(10, 0.75, 0.03),
      ...eyes(0, 0.5, 0.3),
      headShape: shape({
        eyeSpacing: -0.36,
        eyeSize: -0.8,
        eyeTilt: 0.28,
        browHeight: -0.6,
        chinWidth: 0.44,
      }),
      bodyScale: 1.03,
    },
    props: 'sword',
  },
  // Warmarshal Draven Kole, Master of the Warfare Stores.
  warmarshal_draven_kole: {
    cls: 'paladin',
    app: {
      gender: 'male',
      ...head('quiff', 'handlebar', 'relaxed', 'almond', 'broad', 'default'),
      ...skin(26, 0.46, 0.43),
      ...hair(10, 0.04, 0.4),
      ...eyes(20, 0.4, 0.35),
      headShape: shape({
        eyeSpacing: 0.01,
        eyeSize: -0.8,
        eyeTilt: 0.21,
        browHeight: -0.8,
        chinWidth: 0.32,
      }),
      bodyScale: 1.03,
    },
    props: 'sword_shield',
  },
  // Loremaster Caddis, Loremaster.
  loremaster_caddis: {
    cls: 'mage',
    app: {
      gender: 'male',
      ...head('swept', 'goatee', 'rounded', 'hooded', 'default', 'default'),
      ...skin(26, 0.39, 0.57),
      ...hair(9, 0.04, 0.5),
      ...eyes(210, 0.35, 0.4),
      headShape: shape({
        eyeSpacing: -0.11,
        eyeSize: -0.5,
        eyeTilt: -0.5,
        browHeight: 0.4,
        chinWidth: 0.71,
      }),
      bodyScale: 1.03,
    },
    props: 'tome',
  },
  // Auctioneer Voss, Keeper of the World Market.
  auctioneer_voss: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('swept', 'moustache', 'arched', 'almond', 'default', 'smirk', 'default', 'ears'),
      ...skin(26, 0.48, 0.53),
      ...hair(20, 0.61, 0.23),
      ...eyes(46, 0.5, 0.4),
      headShape: shape({
        eyeSpacing: -0.31,
        eyeSize: 0.7,
        eyeTilt: 0.5,
        browHeight: 1,
        chinWidth: 0.57,
      }),
      bodyScale: 0.99,
    },
    props: 'none',
  },
  // Bursar Aldous Crane, The Gilded Strongbox.
  bursar_aldous_crane: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('bald', 'none', 'slim', 'almond', 'aquiline', 'default'),
      ...skin(29, 0.38, 0.58),
      ...hair(41, 0.04, 0.4),
      ...eyes(30, 0.3, 0.3),
      headShape: shape({
        eyeSpacing: -1,
        eyeSize: -0.8,
        eyeTilt: -0.17,
        browHeight: 0.5,
        chinWidth: 1,
      }),
      bodyScale: 1.05,
    },
    props: 'none',
  },
  // Marla Hitchen, Stablemaster.
  stablemaster_marla: {
    cls: 'hunter',
    app: {
      gender: 'female',
      ...head('waves', 'none', 'straight', 'almond', 'soft', 'default'),
      ...skin(27, 0.5, 0.49),
      ...hair(42, 0.67, 0.25),
      ...eyes(140, 0.4, 0.35),
      headShape: shape({ eyeSpacing: -0.43, eyeSize: -0.09, eyeTilt: -0.1, chinWidth: 0.53 }),
      bodyScale: 1.01,
    },
    props: 'none',
  },
  // Chronicler Zenzie, The Peaks Chronicle.
  chronicler_edda_hartwell: {
    cls: 'mage',
    app: {
      gender: 'female',
      ...head('bob', 'none', 'soft_arch', 'almond', 'soft', 'relaxed'),
      ...skin(27, 0.38, 0.57),
      ...hair(216, 0.04, 0.6),
      ...eyes(210, 0.5, 0.45),
      headShape: shape({
        eyeSpacing: -0.31,
        eyeSize: 0.3,
        eyeTilt: 1,
        browHeight: 0.3,
        chinWidth: 0.62,
      }),
    },
    props: 'tome',
  },
  // Alchemist Verane, Master of the Apothecary.
  alchemist_verane: {
    cls: 'mage',
    app: {
      gender: 'female',
      ...head('topknot', 'none', 'relaxed', 'almond', 'soft', 'full', 'default', 'nose'),
      ...skin(29, 0.31, 0.54),
      ...hair(280, 0.46, 0.07),
      ...eyes(280, 0.5, 0.4),
      headShape: shape({
        eyeSpacing: -0.6,
        eyeSize: -0.8,
        eyeTilt: 0.5,
        browHeight: -0.12,
        chinWidth: 0.62,
      }),
    },
    props: 'none',
  },
  // Ondrel Vane, Tidewatcher.
  tidewatcher_ondrel: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('shoulder', 'none', 'rounded', 'hooded', 'aquiline', 'default'),
      ...skin(26, 0.38, 0.53),
      ...hair(278, 0.08, 0.07),
      ...eyes(185, 0.55, 0.45),
      headShape: shape({
        eyeSpacing: -0.38,
        eyeSize: -0.6,
        eyeTilt: -0.6,
        browHeight: 0.7,
        chinWidth: 0.76,
      }),
    },
    props: 'none',
  },
  // Strandwatcher Pell, Watcher of the Tanglemouth.
  strandwatcher_pell: {
    cls: 'hunter',
    app: {
      gender: 'male',
      ...head('mohawk', 'chinstrap', 'relaxed', 'almond', 'default', 'default', 'default', 'lobes'),
      ...skin(26, 0.61, 0.27),
      ...hair(3, 0.7, 0.03),
      ...eyes(28, 0.5, 0.25),
      headShape: shape({ eyeSpacing: 0.32, eyeSize: 0.29, eyeTilt: -0.11, chinWidth: 0.5 }),
      bodyScale: 1.01,
    },
    props: 'sword',
  },
  // Salvage-Boss Ryna, Mistress of the Wreck Line.
  salvage_boss_ryna: {
    cls: 'warrior',
    app: {
      gender: 'female',
      ...head('undercut', 'none', 'default', 'almond', 'soft', 'thin', 'default', 'full'),
      ...skin(26, 0.61, 0.33),
      ...hair(9, 0.75, 0.03),
      ...eyes(185, 0.5, 0.4),
      headShape: shape({
        eyeSpacing: 0.23,
        eyeSize: -0.11,
        eyeTilt: 0.7,
        browHeight: 0.3,
        chinWidth: 0.47,
      }),
      bodyScale: 1.03,
    },
    props: 'woodaxe',
  },
  // Pearl-Mother Isha, Elder of the Divers.
  pearlmother_isha: {
    cls: 'druid',
    app: {
      gender: 'female',
      ...head('crown', 'none', 'soft', 'default', 'default', 'relaxed', 'default', 'ears'),
      ...skin(29, 0.69, 0.22),
      ...hair(41, 0.04, 0.6),
      ...eyes(185, 0.45, 0.45),
      headShape: shape({
        eyeSpacing: 0.39,
        eyeSize: 0.9,
        eyeTilt: -0.21,
        browHeight: 0.3,
        chinWidth: 0.73,
      }),
    },
    props: 'walking_staff',
  },
  // Okrim, The Man Who Went In.
  hermit_okku: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('bald', 'long', 'rounded', 'default', 'aquiline', 'default', 'default', 'septum'),
      ...skin(26, 0.61, 0.32),
      ...hair(41, 0.04, 0.5),
      ...eyes(95, 0.4, 0.35),
      headShape: shape({
        eyeSpacing: 0.8,
        eyeSize: 1,
        eyeTilt: -0.23,
        browHeight: 0.9,
        chinWidth: 0.85,
      }),
      bodyScale: 0.95,
    },
    props: 'walking_staff',
  },
  // Gatewarden Pell, Keeper of the Garden Gate.
  gatewarden_pell: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('quiff', 'none', 'soft_arch', 'default', 'default', 'full'),
      ...skin(29, 0.38, 0.57),
      ...hair(46, 0.47, 0.4),
      ...eyes(140, 0.45, 0.4),
      headShape: shape({
        eyeSpacing: -0.4,
        eyeSize: 0.25,
        eyeTilt: 0.13,
        browHeight: 0.3,
        chinWidth: 0.62,
      }),
    },
    props: 'sword',
  },
  // Head Gardener Amaranth, Head Gardener of the Evergarden.
  head_gardener_amaranth: {
    cls: 'mage',
    app: {
      gender: 'female',
      ...head('shoulder', 'none', 'soft', 'hooded', 'default', 'default'),
      ...skin(24, 0.25, 0.67),
      ...hair(133, 0.66, 0.03),
      ...eyes(140, 0.55, 0.45),
      headShape: shape({
        eyeSpacing: -0.3,
        eyeSize: 0.24,
        eyeTilt: -0.9,
        browHeight: 0.4,
        chinWidth: 0.76,
      }),
    },
    props: 'none',
  },
  // Wickmother Sorrel, Keeper of the Hedgewick Inn.
  wickmother_sorrel: {
    cls: 'druid',
    app: {
      gender: 'female',
      ...head('curls', 'none', 'rounded', 'default', 'button', 'relaxed', 'default', 'lobes'),
      ...skin(26, 0.41, 0.57),
      ...hair(16, 0.72, 0.26),
      ...eyes(140, 0.4, 0.35),
      headShape: shape({
        eyeSpacing: 0.5,
        eyeSize: 0.6,
        eyeTilt: -0.11,
        browHeight: 0.3,
        chinWidth: 0.15,
      }),
      bodyScale: 1.01,
    },
    props: 'none',
  },
  // Salvager Edda, Wreckfield Salvager.
  salvager_edda: {
    cls: 'rogue',
    app: {
      gender: 'female',
      ...head('ponytail', 'none', 'straight', 'almond', 'soft', 'default', 'default', 'nose'),
      ...skin(26, 0.5, 0.45),
      ...hair(33, 0.63, 0.18),
      ...eyes(200, 0.3, 0.35),
      headShape: shape({ eyeSpacing: 0.45, eyeSize: -0.11, chinWidth: 0.56 }),
      bodyScale: 1.02,
    },
    props: 'woodaxe',
  },

  // === The Veiled Hollow and its night towns: silver, violet, pointed ears ==
  // Keeper Saelwyn, Keeper of the Hollow.
  keeper_saelwyn: {
    cls: 'mage',
    app: {
      gender: 'female',
      ...head('braid', 'none', 'soft_arch', 'almond', 'button', 'full', 'pointed', 'ears'),
      ...skin(29, 0.25, 0.62),
      ...hair(271, 0.08, 0.4),
      ...eyes(280, 0.6, 0.45),
      headShape: shape({ eyeSpacing: -0.41, eyeSize: -0.18, eyeTilt: 1, chinWidth: 0.53 }),
    },
    props: 'staff',
  },
  // Loremother Bryn, Voice of the Shrine.
  loremother_bryn: {
    cls: 'mage',
    app: {
      gender: 'female',
      ...head('crown', 'none', 'soft', 'default', 'soft', 'relaxed', 'pointed'),
      ...skin(27, 0.25, 0.59),
      ...hair(333, 0.04, 0.6),
      ...eyes(210, 0.4, 0.55),
      headShape: shape({
        eyeSpacing: 0.37,
        eyeSize: 0.9,
        eyeTilt: -0.01,
        browHeight: 0.3,
        chinWidth: 0.71,
      }),
      bodyScale: 1.05,
    },
    props: 'walking_staff',
  },
  // Provisioner Fenna, Eldershine Provisioner.
  provisioner_fenna: {
    cls: 'druid',
    app: {
      gender: 'female',
      ...head('bob', 'none', 'soft', 'default', 'button', 'relaxed'),
      ...skin(26, 0.38, 0.55),
      ...hair(30, 0.75, 0.18),
      ...eyes(140, 0.4, 0.35),
      headShape: shape({
        eyeSpacing: -0.43,
        eyeSize: 0.25,
        eyeTilt: -0.18,
        browHeight: 0.3,
        chinWidth: 0.51,
      }),
      bodyScale: 1.03,
    },
    props: 'none',
  },
  // Wardsmith Orun, Keeper of the Old Forges.
  wardsmith_orun: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('topknot', 'boxed', 'relaxed', 'almond', 'default', 'default', 'default', 'ears'),
      ...skin(27, 0.51, 0.42),
      ...hair(10, 0.6, 0.07),
      ...eyes(95, 0.45, 0.35),
      headShape: shape({
        eyeSpacing: 0.09,
        eyeSize: 0.2,
        eyeTilt: 0.15,
        browHeight: -0.18,
        chinWidth: 0.47,
      }),
      bodyScale: 1.03,
    },
    props: 'hammer',
  },
  // Archivist Tullo, Reader of Stones.
  archivist_tullo: {
    cls: 'mage',
    app: {
      gender: 'male',
      ...head('quiff', 'none', 'rounded', 'almond', 'default', 'default'),
      ...skin(26, 0.4, 0.57),
      ...hair(19, 0.15, 0.32),
      ...eyes(210, 0.35, 0.4),
      headShape: shape({
        eyeSpacing: -0.34,
        eyeSize: -0.8,
        eyeTilt: 0.2,
        browHeight: 0.12,
        chinWidth: 0.69,
      }),
      bodyScale: 0.97,
    },
    props: 'tome',
  },
  // Huntsman Deral, Warden of the Herds.
  huntsman_deral: {
    cls: 'hunter',
    app: {
      gender: 'male',
      ...head('ponytail', 'chinstrap', 'soft_arch', 'almond', 'default', 'default'),
      ...skin(26, 0.52, 0.46),
      ...hair(23, 0.57, 0.18),
      ...eyes(120, 0.4, 0.3),
      headShape: shape({ eyeSpacing: 0.45, eyeSize: -0.22, eyeTilt: 0.24, chinWidth: 0.62 }),
      bodyScale: 1.01,
    },
    props: 'crossbow',
  },
  // Lamplighter Sorrel, Keeper of the Nightgate.
  lamplighter_sorrel: {
    cls: 'mage',
    app: {
      gender: 'male',
      ...head('quiff', 'none', 'soft_arch', 'default', 'default', 'full', 'pointed'),
      ...skin(27, 0.28, 0.61),
      ...hair(253, 0.15, 0.4),
      ...eyes(46, 0.6, 0.5),
      headShape: shape({ eyeSpacing: -0.17, eyeSize: 0.9, browHeight: 0.3, chinWidth: 0.62 }),
      bodyScale: 1.02,
    },
    props: 'walking_staff',
  },
  // Lira Dewsong, Night-Gardener of Moonrest.
  lira_dewsong: {
    cls: 'druid',
    app: {
      gender: 'female',
      ...head('waves', 'none', 'soft_arch', 'default', 'soft', 'full', 'pointed', 'ears'),
      ...skin(23, 0.25, 0.62),
      ...hair(280, 0.15, 0.5),
      ...eyes(320, 0.45, 0.5),
      headShape: shape({ eyeSpacing: -0.2, eyeSize: 0.9, eyeTilt: 0.19, chinWidth: 0.62 }),
      bodyScale: 1.05,
    },
    props: 'none',
  },
  // Weaver Amelle, Moonfleece Weaver.
  weaver_amelle: {
    cls: 'mage',
    app: {
      gender: 'female',
      ...head('curls', 'none', 'soft', 'almond', 'soft', 'relaxed', 'pointed'),
      ...skin(31, 0.25, 0.57),
      ...hair(250, 0.04, 0.5),
      ...eyes(210, 0.4, 0.55),
      headShape: shape({
        eyeSpacing: -0.15,
        eyeSize: 0.14,
        eyeTilt: -0.06,
        browHeight: 0.3,
        chinWidth: 0.62,
      }),
    },
    props: 'none',
  },
  // Gardener Yew, The Last Gardener.
  gardener_yew: {
    cls: 'druid',
    app: {
      gender: 'male',
      ...head('quiff', 'chinstrap', 'soft_arch', 'hooded', 'default', 'full'),
      ...skin(27, 0.4, 0.53),
      ...hair(95, 0.3, 0.18),
      ...eyes(140, 0.5, 0.4),
      headShape: shape({
        eyeSpacing: 0.11,
        eyeSize: -0.5,
        eyeTilt: -0.35,
        browHeight: 0.42,
        chinWidth: 0.62,
      }),
    },
    props: 'scythe',
  },

  // === Wraithwood: Gallowmere and the Mournstone, mourning onyx ============
  // Lampman Cobb, Keeper of the Crowgate Lanterns.
  lampman_cobb: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('bald', 'chinstrap', 'rounded', 'default', 'default', 'default', 'default', 'nose'),
      ...skin(28, 0.25, 0.5),
      ...hair(26, 0.34, 0.18),
      ...eyes(46, 0.5, 0.45),
      headShape: shape({
        eyeSpacing: 0.7,
        eyeSize: 1,
        eyeTilt: 0.03,
        browHeight: 0.64,
        chinWidth: 0.71,
      }),
    },
    props: 'walking_staff',
  },
  // Sexton Marrow, Sexton of Gibbetmere.
  sexton_marrow: {
    cls: 'mage',
    app: {
      gender: 'male',
      ...head('bald', 'chin', 'slim', 'hooded', 'aquiline', 'default'),
      ...skin(30, 0.25, 0.53),
      ...hair(9, 0.04, 0.4),
      ...eyes(95, 0.3, 0.3),
      headShape: shape({
        eyeSpacing: -1,
        eyeSize: -0.7,
        eyeTilt: -0.9,
        browHeight: -0.4,
        chinWidth: 1,
      }),
      bodyScale: 0.97,
    },
    props: 'scythe',
  },
  // Widow Tansy, Candlewright of Gibbetmere.
  widow_tansy: {
    cls: 'mage',
    app: {
      gender: 'female',
      ...head('curls', 'none', 'relaxed', 'hooded', 'default', 'narrow', 'default', 'lobes'),
      ...skin(28, 0.25, 0.57),
      ...hair(9, 0.04, 0.6),
      ...eyes(46, 0.4, 0.4),
      headShape: shape({
        eyeSpacing: -0.08,
        eyeSize: 0.09,
        eyeTilt: -1,
        browHeight: 0.7,
        chinWidth: 0.8,
      }),
      bodyScale: 0.97,
    },
    props: 'none',
  },
  // Vicar Creel, Last Vicar of the Mournstone.
  vicar_creel: {
    cls: 'priest',
    app: {
      gender: 'male',
      ...head('quiff', 'none', 'relaxed', 'almond', 'aquiline', 'default'),
      ...skin(26, 0.29, 0.57),
      ...hair(10, 0.04, 0.6),
      ...eyes(210, 0.25, 0.4),
      headShape: shape({ eyeSpacing: -0.11, eyeSize: -0.8, eyeTilt: -0.1, chinWidth: 0.72 }),
    },
    props: 'staff',
  },
  // gravedigger_mosley.
  gravedigger_mosley: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('bald', 'none', 'rounded', 'default', 'default', 'default', 'default', 'lip'),
      ...skin(27, 0.38, 0.47),
      ...hair(31, 0.64, 0.12),
      ...eyes(30, 0.35, 0.3),
      headShape: shape({
        eyeSpacing: 0.6,
        eyeSize: 0.8,
        eyeTilt: 0.03,
        browHeight: 0.9,
        chinWidth: 0.62,
      }),
      bodyScale: 1.02,
    },
    props: 'woodaxe',
  },

  // === The Frostveil Reach: Icemantle, pale furs and aurora ================
  // Warden Kaldra, Warden of Icemantle.
  warden_kaldra: {
    cls: 'warrior',
    app: {
      gender: 'female',
      ...head('crown', 'none', 'soft', 'almond', 'soft', 'default'),
      ...skin(28, 0.25, 0.62),
      ...hair(263, 0.04, 0.6),
      ...eyes(210, 0.45, 0.5),
      headShape: shape({ eyeSpacing: -0.3, eyeSize: 0.09, eyeTilt: 0.03, chinWidth: 0.62 }),
      bodyScale: 1.02,
    },
    props: 'sword_shield',
  },
  // Hearthkeeper Maeve, Keeper of the Hearth-Lodge.
  hearthkeeper_maeve: {
    cls: 'druid',
    app: {
      gender: 'female',
      ...head('curls', 'none', 'rounded', 'default', 'button', 'relaxed', 'default', 'lobes'),
      ...skin(26, 0.39, 0.57),
      ...hair(15, 0.63, 0.25),
      ...eyes(30, 0.45, 0.3),
      headShape: shape({
        eyeSpacing: 0.39,
        eyeSize: 0.25,
        eyeTilt: -0.27,
        browHeight: 0.3,
        chinWidth: 0.46,
      }),
    },
    props: 'none',
  },
  // Scout Einna, Snowline Scout.
  scout_einna: {
    cls: 'hunter',
    app: {
      gender: 'female',
      ...head('twins', 'none', 'straight', 'almond', 'soft', 'default'),
      ...skin(24, 0.25, 0.67),
      ...hair(38, 0.3, 0.5),
      ...eyes(210, 0.5, 0.55),
      headShape: shape({ eyeSpacing: 0.32, eyeSize: -0.01, eyeTilt: -0.2, chinWidth: 0.56 }),
    },
    props: 'crossbow',
  },
  // Aurorist Veyla, Reader of the Lights.
  aurorist_veyla: {
    cls: 'mage',
    app: {
      gender: 'female',
      ...head('shoulder', 'none', 'relaxed', 'default', 'soft', 'full'),
      ...skin(26, 0.25, 0.65),
      ...hair(98, 0.04, 0.6),
      ...eyes(185, 0.6, 0.55),
      headShape: shape({ eyeSpacing: 0.9, eyeSize: 0.4, eyeTilt: -0.06, chinWidth: 0.62 }),
    },
    props: 'staff',
  },
  // Trapper Brosk, Shiverfen Trapper.
  trapper_brosk: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('quiff', 'boxed', 'default', 'almond', 'broad', 'full'),
      ...skin(25, 0.5, 0.51),
      ...hair(22, 0.57, 0.18),
      ...eyes(95, 0.35, 0.3),
      headShape: shape({
        eyeSpacing: 0.17,
        eyeSize: -0.8,
        eyeTilt: -0.29,
        browHeight: 0.3,
        chinWidth: 0.57,
      }),
      bodyScale: 1.04,
    },
    props: 'woodaxe',
  },
  // Astronomer Cassian, Watcher at the Vigil.
  astronomer_cassian: {
    cls: 'mage',
    app: {
      gender: 'male',
      ...head('undercut', 'goatee', 'arched', 'default', 'default', 'default', 'default', 'brow'),
      ...skin(27, 0.38, 0.57),
      ...hair(17, 0.65, 0.07),
      ...eyes(240, 0.5, 0.45),
      headShape: shape({
        eyeSpacing: 1,
        eyeSize: -0.03,
        eyeTilt: 0.13,
        browHeight: 0.4,
        chinWidth: 0.69,
      }),
    },
    props: 'tome',
  },
  // apprentice_wren.
  apprentice_wren: {
    cls: 'mage',
    app: {
      gender: 'female',
      ...head('undercut', 'none', 'rounded', 'default', 'soft', 'relaxed', 'default', 'nose'),
      ...skin(26, 0.38, 0.61),
      ...hair(13, 0.73, 0.32),
      ...eyes(140, 0.5, 0.4),
      headShape: shape({
        eyeSpacing: 0.18,
        eyeSize: 0.8,
        eyeTilt: 0.05,
        browHeight: 0.3,
        chinWidth: 0.62,
      }),
      bodyScale: 0.97,
    },
    props: 'none',
  },

  // === The Drakelands and Amberfall: ash, ember and gold ===================
  // Gatecaptain Brannoc, Commander of Wyrmwatch.
  gatecaptain_brannoc: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('bald', 'handlebar', 'relaxed', 'almond', 'broad', 'default'),
      ...skin(25, 0.55, 0.4),
      ...hair(10, 0.04, 0.4),
      ...eyes(28, 0.4, 0.3),
      headShape: shape({
        eyeSpacing: 0.11,
        eyeSize: 0.17,
        eyeTilt: 0.7,
        browHeight: -0.36,
        chinWidth: 0.38,
      }),
      bodyScale: 1.03,
    },
    props: 'sword_shield',
  },
  // Quartermaster Sela, Keeper of the Garrison Stores.
  quartermaster_sela: {
    cls: 'warrior',
    app: {
      gender: 'female',
      ...head('crown', 'none', 'straight', 'almond', 'soft', 'default'),
      ...skin(24, 0.57, 0.37),
      ...hair(10, 0.75, 0.03),
      ...eyes(28, 0.45, 0.4),
      headShape: shape({ eyeSpacing: -0.41, eyeSize: -0.17, eyeTilt: -0.08, chinWidth: 0.53 }),
      bodyScale: 1.01,
    },
    props: 'none',
  },
  // Scout Yerrin, Far-Dune Watcher.
  scout_yerrin: {
    cls: 'hunter',
    app: {
      gender: 'female',
      ...head('ponytail', 'none', 'straight', 'almond', 'soft', 'default', 'default', 'nose'),
      ...skin(26, 0.65, 0.32),
      ...hair(10, 0.75, 0.03),
      ...eyes(46, 0.5, 0.35),
      headShape: shape({
        eyeSpacing: -0.45,
        eyeSize: -0.8,
        eyeTilt: -0.18,
        browHeight: -0.12,
        chinWidth: 0.62,
      }),
    },
    props: 'crossbow',
  },
  // Harbormaster Tamsin, Keeper of the Wyrmwatch Quays.
  harbormaster_tamsin: {
    cls: 'mage',
    app: {
      gender: 'female',
      ...head('braid', 'none', 'straight', 'almond', 'soft', 'relaxed', 'default', 'lobes'),
      ...skin(21, 0.46, 0.37),
      ...hair(9, 0.04, 0.5),
      ...eyes(200, 0.4, 0.4),
      headShape: shape({
        eyeSpacing: 0.24,
        eyeSize: -0.8,
        eyeTilt: 0.17,
        browHeight: -0.06,
        chinWidth: 0.6,
      }),
      bodyScale: 1.02,
    },
    props: 'none',
  },
  // Reeve Ottoline, Reeve of Lanternmere.
  reeve_ottoline: {
    cls: 'druid',
    app: {
      gender: 'female',
      ...head('curls', 'none', 'soft_arch', 'almond', 'soft', 'full'),
      ...skin(28, 0.38, 0.52),
      ...hair(15, 0.63, 0.25),
      ...eyes(30, 0.45, 0.4),
      headShape: shape({
        eyeSpacing: 0.41,
        eyeSize: -0.28,
        eyeTilt: 0.26,
        browHeight: -0.12,
        chinWidth: 0.62,
      }),
      bodyScale: 0.96,
    },
    props: 'none',
  },
  // Waywatcher Sorrel, Watcher of the Goldmelt.
  waywatcher_sorrel: {
    cls: 'hunter',
    app: {
      gender: 'female',
      ...head('braid', 'none', 'straight', 'almond', 'soft', 'default'),
      ...skin(25, 0.54, 0.45),
      ...hair(13, 0.69, 0.25),
      ...eyes(46, 0.55, 0.4),
      headShape: shape({
        eyeSpacing: -0.25,
        eyeSize: -0.3,
        eyeTilt: 0.7,
        browHeight: -0.12,
        chinWidth: 0.56,
      }),
      bodyScale: 1.01,
    },
    props: 'crossbow',
  },
  // Ferrymaster Caddow, Keeper of the Lantern Ferries.
  ferrymaster_caddow: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('quiff', 'boxed', 'default', 'hooded', 'broad', 'default'),
      ...skin(27, 0.46, 0.48),
      ...hair(9, 0.04, 0.5),
      ...eyes(200, 0.3, 0.4),
      headShape: shape({ eyeSpacing: -0.37, eyeSize: 0.03, eyeTilt: -0.9, chinWidth: 0.71 }),
    },
    props: 'walking_staff',
  },
  // Orchardist Pomeline, Keeper of the Gilded Rows.
  orchardist_pomeline: {
    cls: 'druid',
    app: {
      gender: 'female',
      ...head('crown', 'none', 'soft', 'default', 'button', 'relaxed'),
      ...skin(29, 0.43, 0.52),
      ...hair(28, 0.73, 0.18),
      ...eyes(140, 0.45, 0.35),
      headShape: shape({
        eyeSpacing: -0.44,
        eyeSize: 0.25,
        eyeTilt: 0.27,
        browHeight: 0.3,
        chinWidth: 0.49,
      }),
      bodyScale: 0.97,
    },
    props: 'none',
  },
  // Archivist Maelin Emberward, Crucible Archivist.
  archivist_maelin_emberward: {
    cls: 'mage',
    app: {
      gender: 'female',
      ...head('crown', 'none', 'soft_arch', 'almond', 'soft', 'default'),
      ...skin(26, 0.44, 0.46),
      ...hair(21, 0.15, 0.4),
      ...eyes(32, 0.6, 0.42),
      headShape: shape({
        eyeSpacing: 0.21,
        eyeSize: -0.8,
        eyeTilt: -0.25,
        browHeight: -0.18,
        chinWidth: 0.71,
      }),
      bodyScale: 0.99,
    },
    props: 'tome',
  },
  // Quartermaster Bronn Emberward, Crucible Quartermaster.
  crucible_quartermaster: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('mohawk', 'chinstrap', 'slim', 'almond', 'broad', 'default', 'default', 'septum'),
      ...skin(25, 0.51, 0.36),
      ...hair(27, 0.5, 0.12),
      ...eyes(30, 0.6, 0.4),
      headShape: shape({
        eyeSpacing: -0.43,
        eyeSize: -0.8,
        eyeTilt: 0.26,
        browHeight: -0.36,
        chinWidth: 0.41,
      }),
      bodyScale: 1.04,
    },
    props: 'hammer',
  },
  // Maelin's Ember Projection, Ember Projection.
  archivist_maelin_ember_projection: {
    cls: 'mage',
    app: {
      gender: 'female',
      ...head('crown', 'none', 'soft_arch', 'almond', 'soft', 'default'),
      ...skin(23, 0.64, 0.54),
      ...hair(23, 0.64, 0.4),
      ...eyes(46, 0.85, 0.55),
      headShape: shape({
        eyeSpacing: 0.03,
        eyeSize: -0.8,
        eyeTilt: -0.29,
        browHeight: -0.18,
        chinWidth: 0.71,
      }),
      bodyScale: 0.99,
    },
    props: 'tome',
  },

  // === Faction quartermasters and the World Quest taskmaster ==============
  // Quartermaster Vaelen, Rift Watch Provisioner.
  npc_rift_watch_quartermaster: {
    cls: 'hunter',
    app: {
      gender: 'male',
      ...head('braid', 'boxed', 'relaxed', 'almond', 'default', 'default', 'default', 'ears'),
      ...skin(28, 0.69, 0.32),
      ...hair(199, 0.07, 0.4),
      ...eyes(185, 0.5, 0.45),
      headShape: shape({ eyeSpacing: -0.3, eyeSize: 0.24, eyeTilt: 0.7, chinWidth: 0.55 }),
      bodyScale: 1.01,
    },
    props: 'spear',
  },
  // Templar Althea, Church Order Quartermaster.
  npc_church_order_quartermaster: {
    cls: 'paladin',
    app: {
      gender: 'female',
      ...head('crown', 'none', 'soft_arch', 'almond', 'soft', 'relaxed'),
      ...skin(27, 0.38, 0.57),
      ...hair(40, 0.4, 0.43),
      ...eyes(42, 0.5, 0.45),
      headShape: shape({
        eyeSpacing: -0.27,
        eyeSize: -0.27,
        eyeTilt: -0.21,
        browHeight: 0.3,
        chinWidth: 0.62,
      }),
      bodyScale: 1.01,
    },
    props: 'sword_shield',
  },
  // Artificer Tobrin, Automaton Requisitioner.
  npc_automaton_quartermaster: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('undercut', 'goatee', 'relaxed', 'default', 'broad', 'smirk'),
      ...skin(26, 0.51, 0.42),
      ...hair(28, 0.57, 0.12),
      ...eyes(35, 0.55, 0.4),
      headShape: shape({
        eyeSpacing: 0.31,
        eyeSize: 0.85,
        eyeTilt: -0.07,
        browHeight: 0.18,
        chinWidth: 0.62,
      }),
      bodyScale: 1.02,
    },
    props: 'hammer',
  },
  // Taskmaster Kaelen, World Quest Taskmaster.
  npc_wq_taskmaster: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('swept', 'moustache', 'default', 'hooded', 'default', 'default'),
      ...skin(27, 0.43, 0.54),
      ...hair(37, 0.55, 0.18),
      ...eyes(28, 0.4, 0.3),
      headShape: shape({ eyeSpacing: -0.35, eyeSize: 0.19, eyeTilt: -0.9, chinWidth: 0.69 }),
    },
    props: 'tome',
  },

  // === Palmreach and the far shores ========================================
  // castaway_navigator.
  castaway_navigator: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('shoulder', 'boxed', 'soft_arch', 'almond', 'default', 'default', 'default', 'lobes'),
      ...skin(26, 0.65, 0.32),
      ...hair(39, 0.3, 0.5),
      ...eyes(185, 0.55, 0.45),
      headShape: shape({ eyeSize: -0.07, eyeTilt: -0.18, chinWidth: 0.71 }),
    },
    props: 'none',
  },
  // fisher_bram.
  fisher_bram: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('swept', 'boxed', 'rounded', 'hooded', 'aquiline', 'default'),
      ...skin(28, 0.46, 0.47),
      ...hair(19, 0.15, 0.32),
      ...eyes(200, 0.3, 0.4),
      headShape: shape({
        eyeSpacing: -0.42,
        eyeSize: -0.09,
        eyeTilt: -0.9,
        browHeight: 0.64,
        chinWidth: 0.76,
      }),
      bodyScale: 0.95,
    },
    props: 'none',
  },

  // === The Proving Shore: the tutorial island, salt, sailcloth and sun ======
  // Wayfarer Bryn, Harbor Guide.
  wayfarer_bryn: {
    cls: 'hunter',
    app: {
      gender: 'female',
      ...head('curls', 'none', 'soft', 'default', 'button', 'relaxed'),
      ...skin(28, 0.38, 0.55),
      ...hair(32, 0.57, 0.18),
      ...eyes(268, 0.3, 0.42),
      headShape: shape({
        eyeSpacing: -0.14,
        eyeSize: 0.9,
        eyeTilt: -0.12,
        browHeight: 0.3,
        chinWidth: 0.51,
      }),
      bodyScale: 1.03,
    },
    props: 'none',
  },
  // Instructor Maren, Proving Master.
  instructor_maren: {
    cls: 'warrior',
    app: {
      gender: 'female',
      ...head('topknot', 'none', 'default', 'almond', 'soft', 'default'),
      ...skin(28, 0.47, 0.47),
      ...hair(10, 0.3, 0.12),
      ...eyes(272, 0.38, 0.34),
      headShape: shape({
        eyeSpacing: 0.45,
        eyeSize: -0.16,
        eyeTilt: 0.7,
        browHeight: -0.18,
        chinWidth: 0.47,
      }),
      bodyScale: 1.01,
    },
    props: 'sword',
  },
  // Quartermaster Finch, Camp Outfitter.
  quartermaster_finch: {
    cls: 'rogue',
    app: {
      gender: 'female',
      ...head('bob', 'none', 'rounded', 'default', 'button', 'thin', 'default', 'lobes'),
      ...skin(32, 0.38, 0.58),
      ...hair(37, 0.49, 0.32),
      ...eyes(96, 0.32, 0.36),
      headShape: shape({
        eyeSpacing: 0.08,
        eyeSize: 0.25,
        eyeTilt: 0.14,
        browHeight: 0.3,
        chinWidth: 0.49,
      }),
    },
    props: 'none',
  },
  // Bursar Wick, The Gilded Strongbox.
  bursar_wick: {
    cls: 'mage',
    app: {
      gender: 'male',
      ...head('swept', 'goatee', 'slim', 'almond', 'default', 'default', 'default', 'lobes'),
      ...skin(26, 0.36, 0.67),
      ...hair(41, 0.15, 0.5),
      ...eyes(44, 0.45, 0.38),
      headShape: shape({ eyeSpacing: 0.32, eyeSize: -0.8, eyeTilt: -0.07, chinWidth: 0.71 }),
      bodyScale: 0.99,
    },
    props: 'tome',
  },
  // Ferryman Odo, Keeper of the Crossing.
  ferryman_odo: {
    cls: 'druid',
    app: {
      gender: 'male',
      ...head('shoulder', 'boxed', 'default', 'hooded', 'aquiline', 'default'),
      ...skin(26, 0.54, 0.46),
      ...hair(42, 0.04, 0.6),
      ...eyes(206, 0.32, 0.46),
      headShape: shape({ eyeSpacing: 0.04, eyeSize: -0.13, eyeTilt: -0.9, chinWidth: 0.66 }),
      bodyScale: 1.01,
    },
    props: 'walking_staff',
  },
  // Warden Tam, Keeper of the Gauntlet.
  warden_tam: {
    cls: 'hunter',
    app: {
      gender: 'male',
      ...head('quiff', 'none', 'relaxed', 'almond', 'aquiline', 'default'),
      ...skin(24, 0.57, 0.42),
      ...hair(17, 0.48, 0.18),
      ...eyes(32, 0.4, 0.3),
      headShape: shape({ eyeSpacing: 0.42, eyeSize: 0.22, eyeTilt: 0.01, chinWidth: 0.55 }),
      bodyScale: 1.01,
    },
    props: 'spear',
  },
  // Overseer Pell, Gauntlet Overseer.
  overseer_pell: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('quiff', 'handlebar', 'relaxed', 'default', 'broad', 'default'),
      ...skin(25, 0.51, 0.47),
      ...hair(11, 0.26, 0.25),
      ...eyes(84, 0.36, 0.32),
      headShape: shape({ eyeSpacing: 1, eyeSize: 0.05, eyeTilt: 0.02, chinWidth: 0.41 }),
      bodyScale: 1.04,
    },
    props: 'none',
  },
  // Drillmaster Rook, Yard Master.
  drillmaster_rook: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('topknot', 'boxed', 'slim', 'almond', 'default', 'default', 'default', 'brow'),
      ...skin(26, 0.57, 0.44),
      ...hair(26, 0.62, 0.12),
      ...eyes(8, 0.42, 0.3),
      headShape: shape({
        eyeSpacing: 0.14,
        eyeSize: -0.8,
        eyeTilt: 0.24,
        browHeight: -0.6,
        chinWidth: 0.47,
      }),
      bodyScale: 1.04,
    },
    props: 'sword_shield',
  },
  // Tidewarden Nel, Keeper of the Strand.
  tidewarden_nel: {
    cls: 'druid',
    app: {
      gender: 'female',
      ...head('braid', 'none', 'soft_arch', 'almond', 'soft', 'default', 'default', 'ears'),
      ...skin(32, 0.38, 0.51),
      ...hair(199, 0.04, 0.6),
      ...eyes(178, 0.44, 0.4),
      headShape: shape({ eyeSpacing: 0.31, eyeSize: 0.02, eyeTilt: 1, chinWidth: 0.71 }),
      bodyScale: 1.01,
    },
    props: 'oak_stave',
  },
  // Drillmaster Hale, Quay Sparring Master.
  drillmaster_hale: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('bald', 'none', 'default', 'almond', 'broad', 'default'),
      ...skin(27, 0.52, 0.4),
      ...hair(41, 0.04, 0.4),
      ...eyes(30, 0.3, 0.32),
      headShape: shape({
        eyeSpacing: 0.24,
        eyeSize: -0.8,
        eyeTilt: -0.14,
        browHeight: -0.6,
        chinWidth: 0.48,
      }),
      bodyScale: 1.05,
    },
    props: 'hammer',
  },

  // === World quests: instructors and the Fenbridge watch ==================
  // Vault Keeper, Weekly Rewards.
  eastbrook_vault_keeper: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('swept', 'none', 'arched', 'almond', 'default', 'default'),
      ...skin(23, 0.44, 0.52),
      ...hair(22, 0.15, 0.5),
      ...eyes(205, 0.4, 0.45),
      headShape: shape({
        eyeSpacing: 0.09,
        eyeSize: 0.5,
        eyeTilt: -0.2,
        browHeight: 0.5,
        chinWidth: 0.6,
      }),
      bodyScale: 1.04,
    },
    props: 'tome',
  },
  // Cham Pete, Emissary.
  weekly_emissary: {
    cls: 'mage',
    app: {
      gender: 'male',
      ...head(
        'undercut',
        'goatee',
        'soft_arch',
        'almond',
        'default',
        'default',
        'default',
        'lobes',
      ),
      ...skin(30, 0.38, 0.53),
      ...hair(41, 0.15, 0.18),
      ...eyes(262, 0.55, 0.5),
      headShape: shape({ eyeSpacing: 0.27, eyeSize: -0.18, eyeTilt: 0.09, chinWidth: 0.67 }),
      bodyScale: 0.96,
    },
    props: 'tome',
  },
  // Instructor Elian, Arcane Calligraphy.
  calligraphy_instructor: {
    cls: 'mage',
    app: {
      gender: 'male',
      ...head('undercut', 'goatee', 'soft_arch', 'almond', 'default', 'default'),
      ...skin(26, 0.38, 0.57),
      ...hair(41, 0.04, 0.5),
      ...eyes(220, 0.35, 0.4),
      headShape: shape({ eyeSpacing: -0.33, eyeSize: 0.16, eyeTilt: 0.04, chinWidth: 0.69 }),
    },
    props: 'tome',
  },
  // Apprentice Tessa, Student of Calligraphy.
  calligraphy_apprentice_1: {
    cls: 'mage',
    app: {
      gender: 'female',
      ...head('ponytail', 'none', 'relaxed', 'default', 'button', 'default'),
      ...skin(32, 0.38, 0.58),
      ...hair(30, 0.75, 0.12),
      ...eyes(194, 0.44, 0.45),
      headShape: shape({ eyeSpacing: 0.06, eyeSize: 1, eyeTilt: 0.15, chinWidth: 0.53 }),
      bodyScale: 0.99,
    },
    props: 'none',
  },
  // Apprentice Pip, Student of Calligraphy.
  calligraphy_apprentice_2: {
    cls: 'mage',
    app: {
      gender: 'male',
      ...head('swept', 'none', 'soft_arch', 'default', 'default', 'full'),
      ...skin(29, 0.45, 0.57),
      ...hair(33, 0.64, 0.32),
      ...eyes(105, 0.4, 0.35),
      headShape: shape({
        eyeSpacing: 0.4,
        eyeSize: 0.9,
        eyeTilt: 0.15,
        browHeight: 0.6,
        chinWidth: 0.51,
      }),
      bodyScale: 0.95,
    },
    props: 'tome',
  },
  // Smith Mara, Wyrmwatch Smith.
  forge_instructor: {
    cls: 'warrior',
    app: {
      gender: 'female',
      ...head('topknot', 'none', 'straight', 'almond', 'soft', 'default', 'default', 'brow'),
      ...skin(26, 0.52, 0.43),
      ...hair(17, 0.72, 0.12),
      ...eyes(34, 0.48, 0.32),
      headShape: shape({ eyeSpacing: -0.45, eyeSize: 0.05, eyeTilt: 0.7, chinWidth: 0.43 }),
      bodyScale: 1.03,
    },
    props: 'hammer',
  },
  // Sergeant Alric, Fenbridge Watch.
  infiltrator_captain: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('quiff', 'boxed', 'relaxed', 'almond', 'default', 'default'),
      ...skin(25, 0.38, 0.51),
      ...hair(26, 0.15, 0.32),
      ...eyes(165, 0.3, 0.32),
      headShape: shape({
        eyeSpacing: 0.43,
        eyeSize: 0.19,
        eyeTilt: 0.7,
        browHeight: -0.36,
        chinWidth: 0.62,
      }),
      bodyScale: 1.02,
    },
    props: 'sword_shield',
  },
  // Guard Nella, Fenbridge Watch.
  infiltrator_nella: {
    cls: 'warrior',
    app: {
      gender: 'female',
      ...head('topknot', 'none', 'default', 'almond', 'soft', 'default'),
      ...skin(27, 0.52, 0.36),
      ...hair(10, 0.75, 0.03),
      ...eyes(125, 0.35, 0.36),
      headShape: shape({ eyeSpacing: 0.04, eyeSize: -0.24, eyeTilt: -0.1, chinWidth: 0.57 }),
      bodyScale: 1.01,
    },
    props: 'sword',
  },
  // Guard Orin, Fenbridge Watch.
  infiltrator_orin: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('swept', 'chinstrap', 'relaxed', 'almond', 'broad', 'default'),
      ...skin(22, 0.38, 0.56),
      ...hair(38, 0.41, 0.2),
      ...eyes(215, 0.3, 0.38),
      headShape: shape({ eyeSpacing: -0.09, eyeSize: -0.8, eyeTilt: -0.12, chinWidth: 0.47 }),
      bodyScale: 1.01,
    },
    props: 'sword',
  },
  // Guard Bram, Fenbridge Watch.
  infiltrator_bram: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('quiff', 'handlebar', 'default', 'default', 'broad', 'default'),
      ...skin(27, 0.5, 0.48),
      ...hair(40, 0.12, 0.4),
      ...eyes(38, 0.35, 0.3),
      headShape: shape({ eyeSpacing: 1, eyeSize: -0.28, eyeTilt: 0.15, chinWidth: 0.37 }),
      bodyScale: 1.03,
    },
    props: 'sword',
  },
  // Guard Tessa, Fenbridge Watch.
  infiltrator_tessa: {
    cls: 'warrior',
    app: {
      gender: 'female',
      ...head('bob', 'none', 'straight', 'almond', 'soft', 'default'),
      ...skin(29, 0.34, 0.52),
      ...hair(22, 0.69, 0.19),
      ...eyes(185, 0.4, 0.42),
      headShape: shape({ eyeSpacing: -0.28, eyeSize: -0.14, eyeTilt: 0.7, chinWidth: 0.71 }),
      bodyScale: 1.01,
    },
    props: 'sword',
  },
  // --- the humanoid enemies -----------------------------------------------------
  // Every humanoid mob the world fights or walks beside, moved off the KayKit chibi
  // bodies (the hooded outlaw, the robed caster, the barbarian, the knight) onto the WOC
  // class bodies, drawn through MOB_LOOK_IDS below. The class is the kit the mob wore
  // before where one fits (the outlaw's hood a rogue, the barbarian a warrior), and the
  // casters split by what they cast: the shadow cults warlocks, the healers and
  // chanters priests. The drowned and the risen keep a living face with a dead colour:
  // a grey-green or grey-violet pallor the creator's custom wheel reaches.
  // The Vale's outlaws (zone1.ts): Mogger's crew and the road bandits.
  // Vale Bandit: a road thief, sharp and underfed, a stud in his brow.
  vale_bandit: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('undercut', 'chin', 'slim', 'hooded', 'broad', 'smirk', 'default', 'brow'),
      ...skin(25, 0.45, 0.5),
      ...hair(20, 0.4, 0.18),
      ...eyes(30, 0.35, 0.28),
      headShape: shape({ eyeSize: -0.3, eyeTilt: -0.4, browHeight: -0.4 }),
      bodyScale: 0.99,
    },
    props: 'daggers',
  },
  // Mogger Lackey: one of the crew's thugs, a cudgel for his Skullthump.
  mogger_lackey: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('mohawk', 'none', 'rounded', 'default', 'broad', 'full', 'large', 'lobes'),
      ...skin(22, 0.48, 0.46),
      ...hair(15, 0.55, 0.22),
      ...eyes(35, 0.3, 0.25),
      headShape: shape({ eyeSpacing: 0.45, eyeSize: -0.35, chinWidth: 0.85 }),
      bodyScale: 0.96,
    },
    props: 'hammer',
  },
  // Mogger: the crew's boss, bald and bearded, a ring through his nose.
  mogger: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('bald', 'long', 'default', 'hooded', 'broad', 'full', 'large', 'septum'),
      ...skin(20, 0.5, 0.4),
      ...hair(18, 0.5, 0.16),
      ...eyes(20, 0.4, 0.22),
      headShape: shape({ eyeSpacing: -0.4, eyeSize: -0.5, browHeight: -0.7, chinWidth: 1 }),
      bodyScale: 1.05,
    },
    props: 'axe',
  },
  // Gorrak the Ruthless: a topknot, a boxed beard and a cold squint.
  gorrak: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('topknot', 'boxed', 'arched', 'almond', 'aquiline', 'smirk', 'default', 'ears'),
      ...skin(24, 0.42, 0.36),
      ...hair(30, 0.2, 0.08),
      ...eyes(10, 0.5, 0.3),
      headShape: shape({ eyeSize: -0.2, eyeTilt: -0.8, browHeight: -0.5, chinWidth: 0.9 }),
      bodyScale: 1.04,
    },
    props: 'axe',
  },
  // The Gravecaller cult and Sister Nhalia's mourners (zone2.ts).
  // Gravecaller Cultist: a pale young zealot with violet eyes.
  gravecaller_cultist: {
    cls: 'warlock',
    app: {
      gender: 'male',
      ...head('shoulder', 'goatee', 'arched', 'hooded', 'aquiline', 'default'),
      ...skin(28, 0.25, 0.62),
      ...hair(270, 0.15, 0.12),
      ...eyes(280, 0.45, 0.4),
      headShape: shape({ eyeSpacing: -0.3, eyeTilt: -0.6, browHeight: 0.4 }),
      bodyScale: 1.0,
    },
    props: 'dark_staff',
  },
  // Gravecaller Summoner: crowned in a braid, pointed ears, a stud in her brow.
  gravecaller_summoner: {
    cls: 'warlock',
    app: {
      gender: 'female',
      ...head('crown', 'none', 'straight', 'almond', 'soft', 'thin', 'pointed', 'brow'),
      ...skin(30, 0.22, 0.66),
      ...hair(285, 0.35, 0.16),
      ...eyes(290, 0.55, 0.45),
      headShape: shape({ eyeSize: 0.3, eyeTilt: -0.7, browHeight: -0.3, chinWidth: 0.45 }),
      bodyScale: 0.97,
    },
    props: 'dark_staff',
  },
  // Gravecaller Mender: the cult's grey-bearded healer, his book open.
  gravecaller_mender: {
    cls: 'priest',
    app: {
      gender: 'male',
      ...head('long', 'long', 'soft_arch', 'default', 'default', 'full'),
      ...skin(26, 0.3, 0.58),
      ...hair(30, 0.1, 0.55),
      ...eyes(200, 0.2, 0.45),
      headShape: shape({ eyeSpacing: 0.35, eyeSize: -0.4, browHeight: 0.6 }),
      bodyScale: 1.02,
    },
    props: 'tome',
  },
  // Sister Nhalia: the keening priestess, a pale braid and wide grey-blue eyes.
  sister_nhalia: {
    cls: 'priest',
    app: {
      gender: 'female',
      ...head('braid', 'none', 'soft_arch', 'hooded', 'default', 'narrow', 'default', 'nose'),
      ...skin(32, 0.3, 0.7),
      ...hair(40, 0.12, 0.7),
      ...eyes(190, 0.5, 0.55),
      headShape: shape({
        eyeSpacing: -0.2,
        eyeSize: 0.4,
        eyeTilt: 0.5,
        browHeight: 0.5,
        chinWidth: 0.4,
      }),
      bodyScale: 1.03,
    },
    props: 'dark_staff',
  },
  // Nhalia Mourner: one of her grieving faithful, eyes cast down.
  nhalia_mourner: {
    cls: 'priest',
    app: {
      gender: 'female',
      ...head('bob', 'none', 'relaxed', 'default', 'button', 'thin', 'round'),
      ...skin(28, 0.32, 0.6),
      ...hair(25, 0.3, 0.25),
      ...eyes(210, 0.2, 0.4),
      headShape: shape({ eyeSize: -0.2, eyeTilt: 0.9, browHeight: 0.8 }),
      bodyScale: 0.96,
    },
    props: 'knife',
  },
  // Deacon Voss: silver haired and sly, green eyes over a profane book.
  deacon_voss: {
    cls: 'priest',
    app: {
      gender: 'male',
      ...head('swept', 'chops', 'arched', 'almond', 'aquiline', 'smirk', 'pointed', 'brow'),
      ...skin(26, 0.28, 0.55),
      ...hair(220, 0.05, 0.7),
      ...eyes(140, 0.5, 0.4),
      headShape: shape({
        eyeSpacing: -0.5,
        eyeSize: -0.3,
        eyeTilt: -0.9,
        browHeight: -0.6,
        chinWidth: 0.75,
      }),
      bodyScale: 1.04,
    },
    props: 'tome',
  },
  // The Broodsworn wyrm cult (zone3.ts): ember-eyed, dragon red in the hair.
  // Broodsworn Zealot: a knife fighter with a ring through his lip.
  wyrmcult_zealot: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('mohawk', 'chinstrap', 'slim', 'almond', 'default', 'smirk', 'pointed', 'lip'),
      ...skin(18, 0.5, 0.42),
      ...hair(5, 0.65, 0.25),
      ...eyes(25, 0.75, 0.4),
      headShape: shape({ eyeSize: 0.5, eyeTilt: -0.3, browHeight: -0.2 }),
      bodyScale: 1.01,
    },
    props: 'daggers',
  },
  // Broodsworn Necromancer: wide set eyes and a thin moustache.
  wyrmcult_necromancer: {
    cls: 'warlock',
    app: {
      gender: 'male',
      ...head(
        'ponytail',
        'moustache',
        'arched',
        'hooded',
        'aquiline',
        'default',
        'default',
        'ears',
      ),
      ...skin(22, 0.3, 0.48),
      ...hair(15, 0.3, 0.1),
      ...eyes(15, 0.7, 0.4),
      headShape: shape({ eyeSpacing: 0.6, eyeTilt: -0.5, chinWidth: 0.5 }),
      bodyScale: 0.98,
    },
    props: 'dark_staff',
  },
  // Threnos the First Voice: the cult's prophet, heavy browed, every piercing he could take.
  threnos_first_voice: {
    cls: 'warlock',
    app: {
      gender: 'male',
      ...head('braid', 'long', 'rounded', 'hooded', 'broad', 'full', 'large', 'full'),
      ...skin(16, 0.45, 0.35),
      ...hair(8, 0.6, 0.2),
      ...eyes(30, 0.85, 0.5),
      headShape: shape({ eyeSize: -0.6, eyeTilt: -1, browHeight: -0.8, chinWidth: 0.95 }),
      bodyScale: 1.05,
    },
    props: 'tome',
  },
  // The delves (delves/mobs.ts): the Reliquary's acolytes and the Drowned Litany.
  // Gravecall Acolyte: a fresh-faced initiate with a wand.
  reliquary_gravecall_acolyte: {
    cls: 'warlock',
    app: {
      gender: 'male',
      ...head('quiff', 'none', 'soft_arch', 'default', 'default', 'default', 'default', 'lobes'),
      ...skin(29, 0.35, 0.6),
      ...hair(35, 0.4, 0.3),
      ...eyes(100, 0.3, 0.35),
      headShape: shape({ eyeSpacing: -0.45, eyeSize: 0.35, chinWidth: 0.5 }),
      bodyScale: 0.95,
    },
    props: 'wand',
  },
  // Drowned Cantor: a drowned chanter, grey-green and heavy lidded.
  drowned_cantor: {
    cls: 'priest',
    app: {
      gender: 'male',
      ...head('long', 'none', 'relaxed', 'hooded', 'default', 'full'),
      ...skin(170, 0.12, 0.6),
      ...hair(160, 0.1, 0.35),
      ...eyes(175, 0.35, 0.6),
      headShape: shape({ eyeSize: -0.5, eyeTilt: 0.8, browHeight: 0.3, chinWidth: 0.3 }),
      bodyScale: 1.01,
    },
    props: 'tome',
  },
  // Sister Nhalia, the Drowned Canticle: Sister Nhalia's own face, drowned.
  sister_nhalia_drowned_canticle: {
    cls: 'priest',
    app: {
      gender: 'female',
      ...head('braid', 'none', 'soft_arch', 'hooded', 'default', 'narrow', 'default', 'nose'),
      ...skin(175, 0.14, 0.62),
      ...hair(170, 0.12, 0.6),
      ...eyes(180, 0.6, 0.7),
      headShape: shape({
        eyeSpacing: -0.2,
        eyeSize: 0.4,
        eyeTilt: 0.5,
        browHeight: 0.5,
        chinWidth: 0.4,
      }),
      bodyScale: 1.03,
    },
    props: 'dark_staff',
  },
  // Edda Reedhand, Fenbridge's lantern-bearer (a friendly delve companion).
  edda_reedhand: {
    cls: 'druid',
    app: {
      gender: 'female',
      ...head('twins', 'none', 'soft', 'almond', 'button', 'rounded', 'round', 'lobes'),
      ...skin(25, 0.45, 0.66),
      ...hair(28, 0.6, 0.35),
      ...eyes(110, 0.4, 0.38),
      headShape: shape({ eyeSize: 0.3, eyeTilt: 0.3, browHeight: 0.35, chinWidth: 0.55 }),
      bodyScale: 0.97,
    },
    props: 'oak_stave',
  },
  // Acolyte Tessa: a young acolyte, a bright ponytail and a wand.
  acolyte_tessa: {
    cls: 'priest',
    app: {
      gender: 'female',
      ...head('ponytail', 'none', 'straight', 'default', 'soft', 'cupids_bow'),
      ...skin(27, 0.4, 0.7),
      ...hair(30, 0.7, 0.45),
      ...eyes(120, 0.45, 0.4),
      headShape: shape({ eyeSpacing: 0.3, eyeSize: 0.45, chinWidth: 0.5 }),
      bodyScale: 0.95,
    },
    props: 'wand',
  },
  // Pact Acolyte (the rifts, rift/mobs.ts): risen, a grey-violet pallor and lilac hair.
  rift_pact_acolyte: {
    cls: 'warlock',
    app: {
      gender: 'female',
      ...head('undercut', 'none', 'rounded', 'hooded', 'soft', 'narrow', 'pointed', 'septum'),
      ...skin(260, 0.1, 0.55),
      ...hair(265, 0.2, 0.75),
      ...eyes(275, 0.8, 0.55),
      headShape: shape({ eyeSpacing: 0.2, eyeSize: -0.3, eyeTilt: -0.5, browHeight: -0.5 }),
      bodyScale: 1.0,
    },
    props: 'wand',
  },
  // Crow Caller (the Hollow Crypt, hollow_crypt_trash.ts): raven haired, close set eyes.
  crypt_crow_caller: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('shoulder', 'chops', 'slim', 'hooded', 'aquiline', 'default', 'default', 'brow'),
      ...skin(24, 0.3, 0.5),
      ...hair(240, 0.1, 0.07),
      ...eyes(45, 0.6, 0.35),
      headShape: shape({ eyeSpacing: -0.6, eyeSize: -0.4, eyeTilt: -0.6 }),
      bodyScale: 1.0,
    },
    props: 'daggers',
  },
  // Dawnhold Knight (Evergarden, evergarden.ts): fair haired, square jawed, gold plate.
  hedge_knight: {
    cls: 'paladin',
    app: {
      gender: 'male',
      ...head('swept', 'none', 'default', 'almond', 'default', 'default'),
      ...skin(30, 0.4, 0.62),
      ...hair(42, 0.6, 0.5),
      ...eyes(205, 0.45, 0.5),
      headShape: shape({ eyeSpacing: 0.25, browHeight: 0.35, chinWidth: 0.85 }),
      bodyScale: 1.02,
    },
    props: 'sword_shield',
  },
  // The Wreck Warden (Galecrest, galecrest.ts): a drowned brute, weed in his beard.
  the_wreck_warden: {
    cls: 'warrior',
    app: {
      gender: 'male',
      ...head('long', 'long', 'relaxed', 'hooded', 'broad', 'default', 'large'),
      ...skin(165, 0.15, 0.5),
      ...hair(150, 0.15, 0.3),
      ...eyes(185, 0.6, 0.65),
      headShape: shape({ eyeSize: -0.7, eyeTilt: 0.6, browHeight: -0.6, chinWidth: 1 }),
      bodyScale: 1.05,
    },
    props: 'axe',
  },
  // The world-quest caravans' drivers (world_quest_caravan_driver.ts): the person on the
  // wagon's bench, drawn by the wagon, never an entity of their own, so no kind asks.
  // Tobin, the Eastbrook freight driver: a weathered carter with a moustache.
  eastbrook_freight_caravan_driver: {
    cls: 'rogue',
    app: {
      gender: 'male',
      ...head('waves', 'moustache', 'relaxed', 'default', 'broad', 'default'),
      ...skin(26, 0.48, 0.56),
      ...hair(28, 0.45, 0.3),
      ...eyes(30, 0.35, 0.3),
      headShape: shape({ eyeSize: 0.2, browHeight: 0.45, chinWidth: 0.7 }),
      bodyScale: 1.0,
    },
    props: 'none',
  },
  // Mira, the Willowfen remedy driver: a herbalist's robe and dark curls.
  willowfen_remedy_caravan_driver: {
    cls: 'mage',
    app: {
      gender: 'female',
      ...head('curls', 'none', 'soft', 'default', 'soft', 'relaxed', 'default', 'lobes'),
      ...skin(30, 0.38, 0.6),
      ...hair(15, 0.5, 0.3),
      ...eyes(110, 0.45, 0.35),
      headShape: shape({ eyeSize: 0.25, eyeTilt: 0.4, chinWidth: 0.6 }),
      bodyScale: 0.97,
    },
    props: 'none',
  },
  // Orin, the Frostveil supply driver: a mountain hauler, fair and bearded.
  frostveil_supply_caravan_driver: {
    cls: 'hunter',
    app: {
      gender: 'male',
      ...head('shoulder', 'long', 'default', 'almond', 'default', 'full'),
      ...skin(25, 0.4, 0.72),
      ...hair(35, 0.3, 0.55),
      ...eyes(200, 0.4, 0.45),
      headShape: shape({ eyeSpacing: 0.4, eyeTilt: 0.25, chinWidth: 0.8 }),
      bodyScale: 1.01,
    },
    props: 'none',
  },
};

/**
 * NPCs that wear their own authored Blender body (a `VISUALS` def reached
 * through the manifest's NPC key map) instead of a composed look: the Drowned
 * Temple's lore guide Laverock (`npc_laverock`), whose clips (Talk, Startle,
 * Kneel, Sing) the guide system drives. `npcLookFor` returns null for them, the
 * same "keep the fixed rig" answer Aldric gets, so a later roster entry can
 * never silently swap the body out. Pinned by tests/npc_looks.test.ts.
 */
export const NPC_OWN_BODY_IDS: ReadonlySet<string> = new Set(['cantor_laverock']);

/** Suffixed hub ids that share one person's look (the same character recurs
 *  across zones under new templateIds). */
function baseId(templateId: string): string {
  if (templateId === 'scout_maren_highwatch') return 'scout_maren';
  if (templateId === 'brother_halven_marsh') return 'brother_halven';
  // The Muster Standard's soldiers (combat/balgath_trinkets.ts) are the camp's own.
  if (templateId === 'guardian_muster_standard_spear') return 'muster_footman';
  if (templateId === 'guardian_muster_standard_sword') return 'muster_sergeant';
  // Brother Aldric stands in every hub (`_fen`, `_highwatch`, `_raid`).
  if (templateId.startsWith('brother_aldric')) return 'brother_aldric';
  return templateId;
}

/** The mob-kind templates that wear their roster look exactly as an NPC does:
 *  the quest escortees. The sim makes each one a mob so the escort driver can
 *  walk it (sim/escort.ts), but it is a townsperson the player walks home, so
 *  the world draws it as one: the class body, face, body size, bare head and
 *  held props its row names. Named one by one on purpose, never "any mob with a
 *  row": one templateId can be an NPC and a mob at once (Sexton Marrow is the
 *  living sexton of Gibbetmere and, under the same id, an undead dungeon boss),
 *  and that mob keeps its mob body. The Mirefen muster's soldiers wear theirs the
 *  same way, and so does every humanoid enemy (the bandits, the cults, the
 *  knights): a person drawn on a person's body. tests/npc_looks.test.ts holds this
 *  set to the escortees the content ships, the muster's soldiers and the enemies
 *  it names. */
export const MOB_LOOK_IDS: ReadonlySet<string> = new Set([
  'fisher_bram',
  'apprentice_wren',
  'castaway_navigator',
  'gravedigger_mosley',
  // The Mirefen muster's soldiers (friendly mobs: they fight Balgath), and the two the
  // Muster Standard trinket raises from the same rows (baseId above).
  'muster_footman',
  'muster_sergeant',
  'muster_chaplain',
  'muster_drillmaster',
  'guardian_muster_standard_spear',
  'guardian_muster_standard_sword',
  // The humanoid enemies, and the two delve companions, that drew a KayKit chibi body.
  'vale_bandit',
  'mogger_lackey',
  'mogger',
  'gorrak',
  'gravecaller_cultist',
  'gravecaller_summoner',
  'gravecaller_mender',
  'sister_nhalia',
  'nhalia_mourner',
  'deacon_voss',
  'wyrmcult_zealot',
  'wyrmcult_necromancer',
  'threnos_first_voice',
  'reliquary_gravecall_acolyte',
  'drowned_cantor',
  'sister_nhalia_drowned_canticle',
  'edda_reedhand',
  'acolyte_tessa',
  'rift_pact_acolyte',
  'crypt_crow_caller',
  'hedge_knight',
  'the_wreck_warden',
]);

// Looks resolve once per templateId, alias ids included: the table is static, a
// stable object identity keeps every downstream diff and cache (the head
// dressing's reference compare, the pool, the far bake's key) on the fast path,
// and the renderer asks once per NPC or mob view per frame (manifest.ts
// visualKeyFor), so a repeat ask is one map read with no string work.
//
// The cache is keyed by templateId ALONE while the answer also depends on the
// entity kind, so npcLookFor settles the kind BEFORE it reads or writes here:
// only an NPC, or a mob MOB_LOOK_IDS names, ever reaches the cache, and for
// those the answer is the row whatever the kind.
const resolved = new Map<string, NpcLook | null>();

/** The authored look an entity of `kind` wears under `templateId`, or null for
 *  one that wears none (it keeps its stock rig, manifest.ts visualKeyFor). An
 *  NPC wears its row. A mob wears one only if MOB_LOOK_IDS names it: any other
 *  mob keeps its mob visual, one that shares a templateId with an NPC included.
 *  A mob's refusal is one set read and nothing more (asked per view per frame). */
export function npcLookFor(templateId: string, kind: EntityKind = 'npc'): NpcLook | null {
  if (kind !== 'npc' && (kind !== 'mob' || !MOB_LOOK_IDS.has(templateId))) return null;
  const hit = resolved.get(templateId);
  if (hit !== undefined) return hit;
  const id = baseId(templateId);
  if (NPC_OWN_BODY_IDS.has(id)) return null;
  let look = id === templateId ? undefined : resolved.get(id);
  if (look === undefined) {
    const def = NPC_LOOKS[id];
    look = def ? { cls: def.cls, app: normalizeAppearance(def.app), props: def.props } : null;
    resolved.set(id, look);
  }
  resolved.set(templateId, look);
  return look;
}
