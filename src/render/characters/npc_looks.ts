// Authored character-creator looks for EVERY world NPC, pure data + resolution,
// no three.js (the manifest.ts contract). Each entry composes the modular part
// library (modular.ts) exactly the way a player-authored appearance does, so a
// named NPC reads as a person with a face, a haircut and a wardrobe that match
// their role, instead of one of four stock rigs shared by a whole town.
//
// Authoring language (kept consistent so hubs read as communities):
// - Gender follows the shipped voice casting (scripts/voices/npc_voice_prompts.mjs)
//   and quest-text pronouns; where neither speaks, the name's fiction decides.
// - Skin/hair/eye colours are HSL in the same ranges the creation UI offers, so
//   every look here is one a player could have authored.
// - Zones carry a palette: the Vale is warm and rustic, the Marsh drab greens,
//   Highwatch garrison steel and azure, the Veiled Hollow silver and violet on
//   pointed ears, Frostveil pale furs, the Drakelands ash and ember, Amberfall
//   gold, Wraithwood mourning onyx, Palmreach sun-dark skin and bone jewellery.
// - `worn` mixes the class kits per slot (a look, not a class): head is bare by
//   default so the authored face and hair show; the few helmed looks are the
//   point (FURY's closed visor, the chroniclers' scholar hat, Brosk's fur cap).
// - `props` picks a fixed held-prop def (manifest.ts NPC_MODULAR_PROP_SETS):
//   NPC gear never changes, so props are authored attaches, never weapon swaps.
//
// tests/npc_looks.test.ts pins: every NpcDef id resolves to a look EXCEPT
// Brother Aldric (see aldricKeepsHisRig), every authored value survives
// normalizeAppearance unchanged (a typo'd style id would silently clamp to the
// default), and no two NPCs share an appearance.

import type { EntityKind } from '../../sim/types';
import {
  type ArmorLoadout,
  type ArmorSetId,
  type BodyShape,
  type FaceShape,
  fullSet,
  type ModularAppearance,
  type ModularLook,
  NEUTRAL_BODY,
  NEUTRAL_FACE,
  normalizeAppearance,
} from './modular';

/** Fixed held-prop sets, one derived `npc_modular_<id>` VisualDef each (see
 *  NPC_MODULAR_PROP_SETS in manifest.ts). Data here, geometry there, so this
 *  module stays free of asset paths and the manifest owns every VisualDef. */
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
  | 'spear';

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
];

export interface NpcLookDef {
  app: Partial<ModularAppearance>;
  worn: ArmorLoadout;
  props: NpcPropSet;
}

// --- authoring helpers -------------------------------------------------------

const face = (o: Partial<FaceShape>): FaceShape => ({ ...NEUTRAL_FACE, ...o });
const body = (o: Partial<BodyShape>): BodyShape => ({ ...NEUTRAL_BODY, ...o });
const skin = (h: number, s: number, l: number) => ({ skinHue: h, skinSat: s, skinLight: l });
/** Hair colour, with the lashes dyed to match (the default lash colour is the
 *  stock brown, which reads wrong under white or silver hair). */
const hair = (h: number, s: number, l: number) => ({
  hairHue: h,
  hairSat: s,
  hairLight: l,
  lashHue: h,
  lashSat: s,
  lashLight: l,
});
const eyes = (h: number, s: number, l: number) => ({ eyeHue: h, eyeSat: s, eyeLight: l });

/** A full kit with the head bare (the authored face is the point); override
 *  slots to mix sets or strip a piece (`arms: null` reads as rolled sleeves). */
const kit = (set: ArmorSetId, over: Partial<ArmorLoadout> = {}): ArmorLoadout => ({
  ...fullSet(set),
  head: null,
  ...over,
});

// --- the roster --------------------------------------------------------------

export const NPC_LOOKS: Record<string, NpcLookDef> = {
  // === Eastbrook Vale: the starter valley, warm and rustic =================
  // The Merchant: gold on black, a man who owns the market and dresses like it.
  the_merchant: {
    app: {
      gender: 'male',
      hair: 'sweptback',
      ...hair(26, 0.35, 0.1),
      beard: 'goatee',
      brows: 'sharp',
      eyeShape: 'narrow',
      ...eyes(46, 0.55, 0.4),
      ...skin(27, 0.45, 0.55),
      mouth: 'smile',
      face: face({ smirk: 0.4, chin: 0.2 }),
      earrings: 'moon',
      earringMaterial: 'gold',
      outfit: 'onyx',
    },
    worn: kit('rogue'),
    props: 'none',
  },
  // Marshal Redbrook: the name is the colorway; a greying soldier holding a town.
  marshal_redbrook: {
    app: {
      gender: 'male',
      hair: 'crewcut',
      ...hair(20, 0.15, 0.35),
      beard: 'shortbox',
      brows: 'angled',
      eyeShape: 'sharp',
      ...eyes(200, 0.35, 0.3),
      ...skin(25, 0.45, 0.55),
      face: face({ jaw: 0.4, brow: 0.2 }),
      body: body({ shoulders: 0.2 }),
      outfit: 'crimson',
    },
    worn: kit('knight'),
    props: 'sword_shield',
  },
  // Trader Wilkes: round-faced, easy smile, sleeves rolled off the leathers.
  trader_wilkes: {
    app: {
      gender: 'male',
      hair: 'sidepart',
      ...hair(28, 0.5, 0.4),
      beard: 'scruff',
      brows: 'soft',
      eyeShape: 'round',
      ...eyes(140, 0.35, 0.3),
      ...skin(26, 0.5, 0.62),
      mouth: 'smile',
      face: face({ cheeks: 0.35 }),
      body: body({ chest: 0.15, hips: 0.1 }),
    },
    worn: kit('rogue', { arms: null }),
    props: 'none',
  },
  // Apothecary Lin: neat, small, dark-haired; watches where everyone steps.
  apothecary_lin: {
    app: {
      gender: 'female',
      hair: 'lowbun',
      ...hair(20, 0.4, 0.06),
      brows: 'thin',
      eyeShape: 'doe',
      ...eyes(30, 0.4, 0.2),
      ...skin(30, 0.35, 0.62),
      mouth: 'lips',
      body: body({ shoulders: -0.15, hands: -0.1 }),
      outfit: 'forest',
    },
    worn: kit('druid'),
    props: 'none',
  },
  // Brother Aldric is DELIBERATELY ABSENT, in every hub (see ALDRIC_KEEPS_HIS_RIG
  // below). He keeps the pre-v0.7 `npc_aldric` model with the staff built into
  // the mesh: the community adopted that exact silhouette, so recomposing him
  // would be a regression, not an upgrade, however good the composed body looks.
  // Smith Haldren: the Vale armorer, all shoulders, horseshoe moustache.
  smith_haldren: {
    app: {
      gender: 'male',
      hair: 'crew',
      ...hair(22, 0.45, 0.15),
      beard: 'horseshoe',
      brows: 'bushy',
      eyeShape: 'almond',
      ...eyes(28, 0.45, 0.25),
      ...skin(24, 0.5, 0.5),
      face: face({ jaw: 0.3 }),
      body: body({ shoulders: 0.35, chest: 0.3, hands: 0.2 }),
      outfit: 'ember',
    },
    worn: kit('barbarian'),
    props: 'hammer',
  },
  // Fisherman Brandt, Old Salt: grey, weathered, grinning about the fish-men.
  fisherman_brandt: {
    app: {
      gender: 'male',
      hair: 'crew',
      ...hair(30, 0.05, 0.6),
      beard: 'full',
      brows: 'bushy',
      eyeShape: 'droopy',
      ...eyes(190, 0.4, 0.4),
      ...skin(24, 0.5, 0.48),
      mouth: 'grin',
      face: face({ cheeks: -0.2, nose: 0.3 }),
      outfit: 'teal',
    },
    worn: kit('rogue', { arms: null }),
    props: 'spear',
  },
  // Foreman Odell: dust-choked and exasperated, balding, heavy-browed.
  foreman_odell: {
    app: {
      gender: 'male',
      hair: 'buzz',
      ...hair(24, 0.3, 0.25),
      beard: 'mutton',
      brows: 'thick',
      eyeShape: 'sharp',
      ...eyes(30, 0.4, 0.35),
      ...skin(26, 0.45, 0.45),
      mouth: 'frown',
      face: face({ jaw: 0.5, brow: 0.3, nose: 0.2 }),
      body: body({ shoulders: 0.25, chest: 0.2 }),
      outfit: 'onyx',
    },
    worn: kit('barbarian'),
    props: 'hammer',
  },
  // Bursar Fernando: the Gilded Strongbox uniform is gold over dark leathers;
  // his likeness keeps the black shoulder-length hair and light brown skin the
  // old bespoke atlas painted.
  bursar_fernando: {
    app: {
      gender: 'male',
      hair: 'chinbob',
      ...hair(20, 0.35, 0.05),
      brows: 'arched',
      eyeShape: 'almond',
      ...eyes(25, 0.5, 0.35),
      ...skin(27, 0.5, 0.45),
      mouth: 'smile',
      earrings: 'stud',
      earringMaterial: 'gold',
      outfit: 'gilded',
    },
    worn: kit('rogue'),
    props: 'none',
  },
  // Card Master, Dealer of Chance: slick, moustached, one gold hoop, loud coat.
  card_master: {
    app: {
      gender: 'male',
      hair: 'sidepart',
      ...hair(24, 0.4, 0.08),
      beard: 'stache',
      brows: 'arched',
      eyeShape: 'cat',
      ...eyes(280, 0.5, 0.35),
      ...skin(26, 0.45, 0.5),
      mouth: 'grin',
      face: face({ smirk: 0.55 }),
      earrings: 'hoop',
      earringMaterial: 'gold',
      outfit: 'magenta',
    },
    worn: kit('rogue'),
    props: 'none',
  },
  // Groundskeeper Bram: sandy, grinning referee of the Sowfield truce.
  groundskeeper_bram: {
    app: {
      gender: 'male',
      hair: 'messy',
      ...hair(38, 0.5, 0.45),
      beard: 'scruff',
      brows: 'soft',
      eyeShape: 'round',
      ...eyes(140, 0.45, 0.35),
      ...skin(26, 0.5, 0.55),
      mouth: 'grin',
      face: face({ cheeks: 0.2 }),
      body: body({ hands: 0.3, shoulders: 0.15 }),
      outfit: 'forest',
    },
    worn: kit('druid'),
    props: 'scythe',
  },
  // Saul the Chronicler: grey, ledger-minded, twice-told stories by the fire.
  chronicler_saul: {
    app: {
      gender: 'male',
      hair: 'crew',
      ...hair(28, 0.08, 0.55),
      beard: 'full',
      brows: 'round',
      eyeShape: 'round',
      ...eyes(210, 0.35, 0.4),
      ...skin(26, 0.4, 0.55),
      mouth: 'smile',
      face: face({ cheeks: -0.15 }),
      outfit: 'royal',
    },
    worn: kit('mage', { head: 'mage' }),
    props: 'tome',
  },
  // Forgemistress Darva: red warrior braid, forge-built shoulders, amber eyes.
  forgemistress_darva: {
    app: {
      gender: 'female',
      hair: 'warriorbraid',
      ...hair(8, 0.7, 0.32),
      brows: 'sharp',
      eyeShape: 'almond',
      ...eyes(30, 0.55, 0.45),
      mouth: 'lips',
      ...skin(24, 0.5, 0.5),
      face: face({ jaw: 0.25, brow: 0.15 }),
      body: body({ shoulders: 0.3, chest: 0.15, hands: 0.15 }),
      earrings: 'cuff',
      earringMaterial: 'iron',
      outfit: 'ember',
    },
    worn: kit('barbarian'),
    props: 'hammer',
  },
  // Cook Marlow: bald, big, chin-tuft, whites like a proper kitchen master.
  cook_marlow: {
    app: {
      gender: 'male',
      hair: 'bald',
      ...hair(24, 0.4, 0.2),
      beard: 'chinpuff',
      brows: 'round',
      eyeShape: 'round',
      ...eyes(28, 0.5, 0.28),
      ...skin(24, 0.5, 0.6),
      mouth: 'smile',
      face: face({ cheeks: 0.55, chin: 0.2 }),
      body: body({ chest: 0.3, hips: 0.3, hands: 0.2 }),
      outfit: 'ivory',
    },
    worn: kit('druid'),
    props: 'knife',
  },
  // Weaver Ottilie: auburn braid crown, steady hands at the loom.
  weaver_ottilie: {
    app: {
      gender: 'female',
      hair: 'braidcrown',
      ...hair(16, 0.6, 0.35),
      brows: 'soft',
      eyeShape: 'doe',
      ...eyes(140, 0.4, 0.35),
      ...skin(26, 0.45, 0.65),
      mouth: 'lips',
      lipstick: 'rose',
      body: body({ hands: -0.1 }),
      outfit: 'rose',
    },
    worn: kit('druid'),
    props: 'none',
  },
  // Tinker Gizzel: small, rusty-haired, verdigris-stained, springs everywhere.
  tinker_gizzel: {
    app: {
      gender: 'male',
      hair: 'curlyafro',
      ...hair(15, 0.7, 0.35),
      beard: 'goatee',
      brows: 'worried',
      eyeShape: 'wide',
      ...eyes(95, 0.5, 0.4),
      ...skin(27, 0.45, 0.55),
      mouth: 'grin',
      face: face({ nose: 0.3, ears: 0.4 }),
      body: body({
        shoulders: -0.3,
        chest: -0.25,
        hips: -0.25,
        hands: -0.2,
        elbows: -0.2,
        knees: -0.2,
        feet: -0.2,
      }),
      earrings: 'runic',
      earringMaterial: 'copper',
      outfit: 'verdigris',
    },
    worn: kit('rogue'),
    props: 'hammer',
  },
  // Brother Halven, Reliquary Keeper (and his marsh posting): a devout
  // guardian in pale plate, calm as the crypt he keeps.
  brother_halven: {
    app: {
      gender: 'male',
      hair: 'crew',
      ...hair(24, 0.4, 0.2),
      beard: 'shortbox',
      brows: 'soft',
      eyeShape: 'almond',
      ...eyes(210, 0.3, 0.35),
      ...skin(26, 0.4, 0.55),
      face: face({ brow: 0.1 }),
      body: body({ shoulders: 0.15 }),
      outfit: 'ivory',
    },
    worn: kit('paladin'),
    props: 'staff',
  },
  // FURY, Honor Quartermaster: the arena's closed crimson visor. The one Vale
  // look that keeps the full helm; whatever face is under it stays its secret.
  fury: {
    app: {
      gender: 'male',
      hair: 'bald',
      ...hair(0, 0.5, 0.1),
      brows: 'sharp',
      eyeShape: 'narrow',
      ...eyes(0, 0.8, 0.35),
      ...skin(20, 0.4, 0.35),
      mouth: 'frown',
      body: body({ shoulders: 0.35, chest: 0.25 }),
      outfit: 'bloodforged',
    },
    worn: kit('knight', { head: 'knight' }),
    props: 'sword_shield',
  },
  // Warden Coalfast, Redoubt Commander: black steel, salt-grey beard, no give.
  warden_coalfast: {
    app: {
      gender: 'male',
      hair: 'buzz',
      ...hair(30, 0.08, 0.5),
      beard: 'full',
      brows: 'flat',
      eyeShape: 'sharp',
      ...eyes(210, 0.3, 0.3),
      ...skin(25, 0.4, 0.5),
      mouth: 'frown',
      face: face({ jaw: 0.35, brow: 0.25 }),
      body: body({ shoulders: 0.25 }),
      outfit: 'onyx',
    },
    worn: kit('knight'),
    props: 'sword_shield',
  },
  // Riftwatch Ollun, Breach Scholar: unkempt, stubbled, always half-listening.
  riftwatch_ollun: {
    app: {
      gender: 'male',
      hair: 'messy',
      ...hair(26, 0.45, 0.3),
      beard: 'stubble',
      brows: 'worried',
      eyeShape: 'wideset',
      ...eyes(185, 0.5, 0.4),
      ...skin(26, 0.4, 0.6),
      mouth: 'open',
      face: face({ brow: -0.2 }),
      outfit: 'teal',
    },
    worn: kit('mage'),
    props: 'tome',
  },
  // Quartermaster Edda, Redoubt Armorer: steel and salt, hair tied back for work.
  quartermaster_edda: {
    app: {
      gender: 'female',
      hair: 'lowpony',
      ...hair(40, 0.25, 0.55),
      brows: 'flat',
      eyeShape: 'almond',
      ...eyes(210, 0.3, 0.35),
      ...skin(25, 0.4, 0.55),
      face: face({ jaw: 0.2 }),
      body: body({ shoulders: 0.2, hands: 0.15 }),
    },
    worn: kit('knight'),
    props: 'hammer',
  },
  // Mender Saul, Field Surgeon: tired eyes, clean ivory, kind and clinical.
  mender_saul: {
    app: {
      gender: 'male',
      hair: 'sidepart',
      ...hair(26, 0.4, 0.3),
      brows: 'worried',
      eyeShape: 'sleepy',
      ...eyes(140, 0.3, 0.35),
      ...skin(26, 0.4, 0.6),
      face: face({ cheeks: -0.2 }),
      outfit: 'ivory',
    },
    worn: kit('mage'),
    props: 'none',
  },
  // Bellkeeper Tam: young, alert, an ear always on the watchbell.
  bellkeeper_tam: {
    app: {
      gender: 'male',
      hair: 'quiff',
      ...hair(38, 0.55, 0.5),
      brows: 'soft',
      eyeShape: 'wide',
      ...eyes(200, 0.5, 0.4),
      ...skin(26, 0.45, 0.62),
      body: body({ shoulders: -0.1, chest: -0.1 }),
      outfit: 'azure',
    },
    worn: kit('rogue'),
    props: 'none',
  },
  // Frightened Nell: pale, mussed, worried; she does not go to the shore now.
  fisher_nell: {
    app: {
      gender: 'female',
      hair: 'asymbob',
      ...hair(26, 0.35, 0.4),
      brows: 'worried',
      eyeShape: 'droopy',
      ...eyes(200, 0.3, 0.5),
      ...skin(26, 0.3, 0.72),
      mouth: 'frown',
      face: face({ brow: -0.3, cheeks: -0.2 }),
      body: body({ shoulders: -0.2 }),
      outfit: 'teal',
    },
    worn: kit('rogue', { hands: null }),
    props: 'none',
  },
  // The Pale Keeper: the graveyard angel. White on white on white; the
  // renderer's spirit-healer branches keep her translucent and shimmering.
  spirit_healer: {
    app: {
      gender: 'female',
      hair: 'longwavy',
      ...hair(220, 0.04, 0.95),
      brows: 'soft',
      eyeShape: 'doe',
      ...eyes(210, 0.3, 0.75),
      ...skin(220, 0.1, 0.93),
      mouth: 'lips',
      face: face({ cheeks: -0.1 }),
      outfit: 'ivory',
    },
    worn: kit('mage'),
    props: 'none',
  },
  // PTR dev vendor: dev-only free-epics stall; dressed like a patch note.
  ptr_dev_vendor: {
    app: {
      gender: 'male',
      hair: 'mohawk',
      ...hair(320, 0.8, 0.5),
      beard: 'wizard',
      ...eyes(185, 0.8, 0.5),
      ...skin(27, 0.45, 0.55),
      mouth: 'grin',
      earrings: 'runic',
      earringMaterial: 'amethyst',
      outfit: 'magenta',
    },
    worn: kit('rogue'),
    props: 'none',
  },

  // === Mirefen Marsh: Fenbridge, Bridgemere, Willowweep; drab and damp ======
  // Warden Fenwick: mud-dulled plate, a gate that holds because he does.
  warden_fenwick: {
    app: {
      gender: 'male',
      hair: 'crew',
      ...hair(22, 0.35, 0.18),
      beard: 'scruff',
      brows: 'angled',
      eyeShape: 'narrow',
      ...eyes(95, 0.35, 0.3),
      ...skin(25, 0.4, 0.5),
      face: face({ jaw: 0.3, brow: 0.2 }),
      body: body({ shoulders: 0.2 }),
      outfit: 'forest',
    },
    worn: kit('knight'),
    props: 'sword_shield',
  },
  // Provisioner Hale: two dry things out of three on a good day, and a wry
  // grin about it.
  provisioner_hale: {
    app: {
      gender: 'male',
      hair: 'buzz',
      ...hair(26, 0.3, 0.3),
      beard: 'mutton',
      brows: 'round',
      eyeShape: 'droopy',
      ...eyes(30, 0.4, 0.25),
      ...skin(26, 0.45, 0.55),
      mouth: 'grin',
      face: face({ cheeks: 0.15, nose: 0.15 }),
    },
    worn: kit('rogue'),
    props: 'none',
  },
  // Herbalist Yara: twin braids, sleeves off, eyes on the webs in the thicket.
  herbalist_yara: {
    app: {
      gender: 'female',
      hair: 'twinbraids',
      ...hair(22, 0.55, 0.22),
      brows: 'soft',
      eyeShape: 'round',
      ...eyes(120, 0.45, 0.35),
      ...skin(26, 0.5, 0.55),
      body: body({ hands: -0.1 }),
      outfit: 'forest',
    },
    worn: kit('druid', { arms: null }),
    props: 'none',
  },
  // Scout Maren (Vale fen and her Highwatch posting): quiet feet, short blade,
  // hair up and out of the way.
  scout_maren: {
    app: {
      gender: 'female',
      hair: 'highpony',
      ...hair(22, 0.5, 0.18),
      brows: 'thin',
      eyeShape: 'almond',
      ...eyes(95, 0.45, 0.42),
      ...skin(25, 0.45, 0.52),
      face: face({ jaw: 0.1 }),
      body: body({ shoulders: 0.1, hips: -0.1 }),
      outfit: 'forest',
    },
    worn: kit('ranger'),
    props: 'crossbow',
  },
  // Bursar Petra Vell: clean ledgers, cleaner vaults, not a hair out of place.
  bursar_petra_vell: {
    app: {
      gender: 'female',
      hair: 'lowbun',
      ...hair(22, 0.4, 0.08),
      brows: 'arched',
      eyeShape: 'almond',
      ...eyes(210, 0.4, 0.35),
      ...skin(27, 0.4, 0.6),
      mouth: 'lips',
      lipstick: 'nude',
      earrings: 'stud',
      earringMaterial: 'gold',
      outfit: 'gilded',
    },
    worn: kit('rogue'),
    props: 'none',
  },
  // Chronicler Osric Fenn: damp pages, grey curtains of hair, marsh-green robes.
  chronicler_osric_fenn: {
    app: {
      gender: 'male',
      hair: 'curtains',
      ...hair(28, 0.15, 0.45),
      beard: 'goatee',
      brows: 'worried',
      eyeShape: 'droopy',
      ...eyes(95, 0.35, 0.35),
      ...skin(26, 0.35, 0.55),
      face: face({ cheeks: -0.25 }),
      outfit: 'forest',
    },
    worn: kit('mage', { head: 'mage' }),
    props: 'tome',
  },
  // Tanner Hesk: topknot, horseshoe, forearms that live in the vats.
  tanner_hesk: {
    app: {
      gender: 'male',
      hair: 'topknot',
      ...hair(24, 0.5, 0.2),
      beard: 'horseshoe',
      brows: 'thick',
      eyeShape: 'almond',
      ...eyes(28, 0.45, 0.25),
      ...skin(24, 0.5, 0.48),
      face: face({ jaw: 0.2 }),
      body: body({ shoulders: 0.2, hands: 0.3 }),
      outfit: 'ember',
    },
    worn: kit('barbarian'),
    props: 'knife',
  },
  // Waykeeper Pell of the Amberfen Steps: hospitable without fuss.
  waykeeper_pell: {
    app: {
      gender: 'female',
      hair: 'halfbun',
      ...hair(24, 0.55, 0.3),
      brows: 'soft',
      eyeShape: 'round',
      ...eyes(140, 0.4, 0.35),
      ...skin(26, 0.45, 0.6),
      mouth: 'smile',
      face: face({ cheeks: 0.2 }),
      outfit: 'ember',
    },
    worn: kit('druid'),
    props: 'walking_staff',
  },
  // Bridgewright Alden: every plank his, stubble and shoulders to keep them.
  bridgewright_alden: {
    app: {
      gender: 'male',
      hair: 'crew',
      ...hair(26, 0.45, 0.25),
      beard: 'stubblebeard',
      brows: 'bushy',
      eyeShape: 'almond',
      ...eyes(30, 0.4, 0.25),
      ...skin(25, 0.5, 0.5),
      face: face({ jaw: 0.25 }),
      body: body({ shoulders: 0.3, hands: 0.25 }),
    },
    worn: kit('barbarian'),
    props: 'hammer',
  },
  // Netter Maris: smoked eel built this town; sun-browned and pleased about it.
  netter_maris: {
    app: {
      gender: 'female',
      hair: 'sidepony',
      ...hair(20, 0.45, 0.15),
      brows: 'soft',
      eyeShape: 'almond',
      ...eyes(185, 0.5, 0.4),
      ...skin(24, 0.55, 0.45),
      mouth: 'grin',
      face: face({ cheeks: 0.15, smirk: 0.2 }),
      body: body({ shoulders: 0.15, hands: 0.15 }),
      outfit: 'teal',
    },
    worn: kit('rogue', { arms: null }),
    props: 'spear',
  },
  // Mother Sedge, Fen-Witch of Willowweep: grey-veiled, bone septum ring,
  // cat eyes that heard you from the willows.
  mother_sedge: {
    app: {
      gender: 'female',
      hair: 'longcenterpart',
      ...hair(100, 0.08, 0.7),
      brows: 'thin',
      eyeShape: 'cat',
      ...eyes(95, 0.6, 0.45),
      ...skin(28, 0.3, 0.6),
      mouth: 'neutral',
      face: face({ cheeks: -0.5, chin: 0.2, nose: 0.2 }),
      body: body({ shoulders: -0.2, chest: -0.15 }),
      earrings: 'septum',
      earringMaterial: 'bone',
      outfit: 'onyx',
    },
    worn: kit('mage'),
    props: 'oak_stave',
  },
  // Watcher Maren of the Windway: hair braided against the wind that takes hats.
  watcher_maren: {
    app: {
      gender: 'female',
      hair: 'fantasybraid',
      ...hair(42, 0.45, 0.5),
      brows: 'flat',
      eyeShape: 'sharp',
      ...eyes(200, 0.45, 0.4),
      ...skin(25, 0.45, 0.55),
      face: face({ brow: 0.1 }),
      body: body({ shoulders: 0.15 }),
      outfit: 'azure',
    },
    worn: kit('ranger'),
    props: 'crossbow',
  },
  // Harbormaster Odile: blunt fringe, blunt manner; counts every soul.
  harbormaster_odile: {
    app: {
      gender: 'female',
      hair: 'bluntbangs',
      ...hair(20, 0.4, 0.07),
      brows: 'sharp',
      eyeShape: 'sharp',
      ...eyes(210, 0.45, 0.35),
      ...skin(26, 0.4, 0.55),
      mouth: 'lips',
      lipstick: 'berry',
      face: face({ brow: 0.2, jaw: 0.15 }),
      outfit: 'azure',
    },
    worn: kit('rogue'),
    props: 'none',
  },
  // Keeper Bram of the Old Beacon: nine and thirty years, all of them white.
  keeper_bram: {
    app: {
      gender: 'male',
      hair: 'bald',
      ...hair(40, 0.06, 0.75),
      beard: 'full',
      brows: 'bushy',
      eyeShape: 'round',
      ...eyes(200, 0.35, 0.45),
      ...skin(25, 0.45, 0.5),
      mouth: 'smile',
      face: face({ cheeks: -0.2, nose: 0.2 }),
      outfit: 'teal',
    },
    worn: kit('rogue'),
    props: 'walking_staff',
  },

  // === Thornpeak Heights: the Highwatch garrison, steel and azure ==========
  // Captain Thessaly: two hundred years of wall, one immovable captain.
  captain_thessaly: {
    app: {
      gender: 'female',
      hair: 'lowbun',
      ...hair(24, 0.35, 0.12),
      brows: 'angled',
      eyeShape: 'sharp',
      ...eyes(210, 0.4, 0.35),
      ...skin(25, 0.4, 0.52),
      face: face({ jaw: 0.3, brow: 0.2 }),
      body: body({ shoulders: 0.25 }),
      outfit: 'azure',
    },
    worn: kit('knight'),
    props: 'sword_shield',
  },
  // Quartermaster Bree: short of wool, hardtack, steel, and patience.
  quartermaster_bree: {
    app: {
      gender: 'female',
      hair: 'highbun',
      ...hair(30, 0.5, 0.4),
      brows: 'worried',
      eyeShape: 'almond',
      ...eyes(30, 0.4, 0.3),
      ...skin(26, 0.45, 0.58),
      mouth: 'neutral',
      face: face({ brow: -0.15 }),
      body: body({ hands: 0.1 }),
    },
    worn: kit('rogue'),
    props: 'none',
  },
  // Armorer Hode: viking beard, knight plate over smith leathers.
  armorer_hode: {
    app: {
      gender: 'male',
      hair: 'buzz',
      ...hair(18, 0.5, 0.3),
      beard: 'vikingb',
      brows: 'bushy',
      eyeShape: 'almond',
      ...eyes(28, 0.5, 0.25),
      ...skin(24, 0.45, 0.5),
      face: face({ jaw: 0.3 }),
      body: body({ shoulders: 0.35, chest: 0.25, hands: 0.2 }),
      outfit: 'ember',
    },
    worn: kit('barbarian', { chest: 'knight', arms: 'knight' }),
    props: 'hammer',
  },
  // Quartermaster Vex: heroic-marks broker; obsidian plate, bone stud, a face
  // that has seen the heroic depths it sells proof of.
  heroic_quartermaster: {
    app: {
      gender: 'male',
      hair: 'mohawk',
      ...hair(20, 0.3, 0.08),
      beard: 'scruff',
      brows: 'sharp',
      eyeShape: 'narrow',
      ...eyes(0, 0.5, 0.3),
      ...skin(22, 0.4, 0.42),
      mouth: 'frown',
      face: face({ jaw: 0.3, brow: 0.3, smirk: 0.2 }),
      body: body({ shoulders: 0.25, chest: 0.15 }),
      earrings: 'bone',
      earringMaterial: 'bone',
      outfit: 'obsidian',
    },
    worn: kit('paladin', { chest: 'knight' }),
    props: 'sword',
  },
  // Warmarshal Draven Kole: honor is the only coin; blood-forged plate, grey
  // horseshoe, a face like a shut gate.
  warmarshal_draven_kole: {
    app: {
      gender: 'male',
      hair: 'crewcut',
      ...hair(30, 0.06, 0.5),
      beard: 'horseshoe',
      brows: 'flat',
      eyeShape: 'narrow',
      ...eyes(20, 0.4, 0.35),
      ...skin(24, 0.4, 0.45),
      mouth: 'frown',
      face: face({ jaw: 0.5, brow: 0.4, nose: 0.15 }),
      body: body({ shoulders: 0.3, chest: 0.2 }),
      outfit: 'bloodforged',
    },
    worn: kit('paladin'),
    props: 'sword_shield',
  },
  // Loremaster Caddis: grey sidepart, restless mountains, sleepless reading.
  loremaster_caddis: {
    app: {
      gender: 'male',
      hair: 'sidepart',
      ...hair(30, 0.08, 0.6),
      beard: 'goatee',
      brows: 'round',
      eyeShape: 'sleepy',
      ...eyes(210, 0.35, 0.4),
      ...skin(26, 0.4, 0.58),
      face: face({ cheeks: -0.2, brow: -0.1 }),
      outfit: 'royal',
    },
    worn: kit('mage', { head: 'mage' }),
    props: 'tome',
  },
  // Auctioneer Voss: pompadour, moustache, gold chain; the market as theatre.
  auctioneer_voss: {
    app: {
      gender: 'male',
      hair: 'pompadour',
      ...hair(24, 0.55, 0.3),
      beard: 'stache',
      brows: 'arched',
      eyeShape: 'almond',
      ...eyes(46, 0.5, 0.4),
      ...skin(26, 0.45, 0.55),
      mouth: 'grin',
      face: face({ smirk: 0.4, cheeks: 0.1 }),
      earrings: 'chain',
      earringMaterial: 'gold',
      outfit: 'gilded',
    },
    worn: kit('rogue'),
    props: 'none',
  },
  // Bursar Aldous Crane: scrupulously polite, mildly pained, gaunt as a ledger.
  bursar_aldous_crane: {
    app: {
      gender: 'male',
      hair: 'buzz',
      ...hair(30, 0.06, 0.55),
      brows: 'thin',
      eyeShape: 'narrow',
      ...eyes(30, 0.3, 0.3),
      ...skin(26, 0.35, 0.6),
      mouth: 'frown',
      face: face({ cheeks: -0.5, chin: -0.1, nose: 0.2 }),
      body: body({ shoulders: -0.2, chest: -0.2 }),
      outfit: 'gilded',
    },
    worn: kit('rogue'),
    props: 'none',
  },
  // Marla Hitchen, Stablemaster: wind-tangled, no-nonsense, reins-callused.
  stablemaster_marla: {
    app: {
      gender: 'female',
      hair: 'layered',
      ...hair(38, 0.5, 0.4),
      brows: 'flat',
      eyeShape: 'almond',
      ...eyes(140, 0.4, 0.35),
      ...skin(26, 0.5, 0.55),
      face: face({ jaw: 0.15 }),
      body: body({ shoulders: 0.15, hands: 0.25 }),
    },
    worn: kit('ranger'),
    props: 'none',
  },
  // Chronicler Zenzie: the Peaks remember; silver bob, sky-blue robes.
  chronicler_edda_hartwell: {
    app: {
      gender: 'female',
      hair: 'wavybob',
      ...hair(220, 0.06, 0.85),
      brows: 'arched',
      eyeShape: 'cat',
      ...eyes(210, 0.5, 0.45),
      ...skin(27, 0.4, 0.62),
      mouth: 'smile',
      outfit: 'azure',
    },
    worn: kit('mage', { head: 'mage' }),
    props: 'tome',
  },
  // Alchemist Verane: measured twice, poured once; precise to the eyelash.
  alchemist_verane: {
    app: {
      gender: 'female',
      hair: 'highbun',
      ...hair(280, 0.25, 0.15),
      brows: 'thin',
      eyeShape: 'narrow',
      ...eyes(280, 0.5, 0.4),
      ...skin(27, 0.35, 0.6),
      mouth: 'lips',
      eyeshadow: 'plum',
      face: face({ brow: 0.1 }),
      outfit: 'violet',
    },
    worn: kit('mage'),
    props: 'none',
  },
  // Ondrel Vane, Tidewatcher: thirty nights at the mere, and tonight it is open.
  tidewatcher_ondrel: {
    app: {
      gender: 'male',
      hair: 'longpart',
      ...hair(220, 0.15, 0.15),
      beard: 'stubble',
      brows: 'worried',
      eyeShape: 'sleepy',
      ...eyes(185, 0.55, 0.45),
      ...skin(26, 0.35, 0.55),
      face: face({ cheeks: -0.3, brow: -0.2 }),
      outfit: 'teal',
    },
    worn: kit('rogue'),
    props: 'none',
  },
  // Strandwatcher Pell: out of the black trees at last; sun-dark, sword kept.
  strandwatcher_pell: {
    app: {
      gender: 'male',
      hair: 'buzz',
      ...hair(20, 0.4, 0.06),
      beard: 'scruff',
      brows: 'flat',
      eyeShape: 'almond',
      ...eyes(28, 0.5, 0.25),
      ...skin(22, 0.5, 0.32),
      face: face({ jaw: 0.2 }),
      body: body({ shoulders: 0.15 }),
      outfit: 'teal',
    },
    worn: kit('rogue', { chest: 'ranger' }),
    props: 'sword',
  },
  // Salvage-Boss Ryna: wreck-line muscle, bone hoop, salt-cropped black hair.
  salvage_boss_ryna: {
    app: {
      gender: 'female',
      hair: 'fauxhawk',
      ...hair(20, 0.4, 0.08),
      brows: 'angled',
      eyeShape: 'sharp',
      ...eyes(185, 0.5, 0.4),
      ...skin(23, 0.5, 0.38),
      mouth: 'grin',
      face: face({ jaw: 0.25, smirk: 0.25 }),
      body: body({ shoulders: 0.3, chest: 0.15, hands: 0.2 }),
      earrings: 'bonehoop',
      earringMaterial: 'bone',
      outfit: 'teal',
    },
    worn: kit('barbarian'),
    props: 'woodaxe',
  },
  // Pearl-Mother Isha, Elder of the Divers: white crown braid, pearl moons.
  pearlmother_isha: {
    app: {
      gender: 'female',
      hair: 'braidcrown',
      ...hair(40, 0.05, 0.85),
      brows: 'soft',
      eyeShape: 'doe',
      ...eyes(185, 0.45, 0.45),
      ...skin(22, 0.5, 0.28),
      mouth: 'smile',
      face: face({ cheeks: -0.25 }),
      earrings: 'moonstar',
      earringMaterial: 'pearl',
      outfit: 'ivory',
    },
    worn: kit('druid'),
    props: 'walking_staff',
  },
  // Okku, The Man Who Went In: wiry, bald, grey-bearded, listening for drums.
  hermit_okku: {
    app: {
      gender: 'male',
      hair: 'bald',
      ...hair(30, 0.06, 0.65),
      beard: 'wizard',
      brows: 'worried',
      eyeShape: 'wide',
      ...eyes(95, 0.4, 0.35),
      ...skin(22, 0.5, 0.35),
      mouth: 'neutral',
      face: face({ cheeks: -0.5, nose: 0.2, brow: -0.2 }),
      body: body({ shoulders: -0.25, chest: -0.3, hips: -0.2 }),
      earrings: 'bone',
      earringMaterial: 'bone',
    },
    worn: kit('barbarian', { chest: null, arms: null, hands: null }),
    props: 'walking_staff',
  },
  // Gatewarden Pell of the Evergarden: verdigris plate, garden-gate polite.
  gatewarden_pell: {
    app: {
      gender: 'male',
      hair: 'crew',
      ...hair(44, 0.5, 0.55),
      brows: 'soft',
      eyeShape: 'round',
      ...eyes(140, 0.45, 0.4),
      ...skin(26, 0.4, 0.6),
      mouth: 'smile',
      outfit: 'verdigris',
    },
    worn: kit('knight'),
    props: 'sword',
  },
  // Head Gardener Amaranth: shadows under the eyes; someone must stay awake.
  head_gardener_amaranth: {
    app: {
      gender: 'female',
      hair: 'longcenterpart',
      ...hair(150, 0.3, 0.12),
      brows: 'soft',
      eyeShape: 'droopy',
      ...eyes(140, 0.55, 0.45),
      ...skin(26, 0.25, 0.72),
      mouth: 'neutral',
      eyeshadow: 'smoke',
      face: face({ cheeks: -0.3, brow: -0.2 }),
      outfit: 'emerald',
    },
    worn: kit('mage'),
    props: 'none',
  },
  // Wickmother Sorrel of the Hedgewick Inn: copper curls, cordial on the fire.
  wickmother_sorrel: {
    app: {
      gender: 'female',
      hair: 'curls',
      ...hair(14, 0.65, 0.4),
      brows: 'round',
      eyeShape: 'round',
      ...eyes(140, 0.4, 0.35),
      ...skin(26, 0.5, 0.62),
      mouth: 'smile',
      blush: 'peach',
      face: face({ cheeks: 0.4 }),
      body: body({ hips: 0.15, chest: 0.1 }),
      outfit: 'rose',
    },
    worn: kit('druid'),
    props: 'none',
  },
  // Salvager Edda: flat-voiced wreckfield picker, axe over one shoulder.
  salvager_edda: {
    app: {
      gender: 'female',
      hair: 'lowpony',
      ...hair(26, 0.4, 0.3),
      brows: 'flat',
      eyeShape: 'almond',
      ...eyes(200, 0.3, 0.35),
      ...skin(25, 0.45, 0.5),
      mouth: 'neutral',
      face: face({ jaw: 0.1 }),
      body: body({ shoulders: 0.2, hands: 0.15 }),
      outfit: 'onyx',
    },
    worn: kit('rogue'),
    props: 'woodaxe',
  },

  // === The Veiled Hollow and its night towns: silver, violet, pointed ears ==
  // Keeper Saelwyn: ageless keeper of the boughs; violet-silver braid, cat eyes.
  keeper_saelwyn: {
    app: {
      gender: 'female',
      hair: 'fantasybraid',
      ...hair(250, 0.15, 0.6),
      brows: 'arched',
      eyeShape: 'cat',
      ...eyes(280, 0.6, 0.45),
      ...skin(28, 0.3, 0.68),
      mouth: 'lips',
      lipstick: 'rose',
      ears: 'pointed',
      earrings: 'moonstar',
      earringMaterial: 'silver',
      face: face({ cheeks: 0.2, chin: -0.1 }),
      outfit: 'emerald',
    },
    worn: kit('mage'),
    props: 'staff',
  },
  // Loremother Bryn, Voice of the Shrine: white crown braid, listening lights.
  loremother_bryn: {
    app: {
      gender: 'female',
      hair: 'braidcrown',
      ...hair(240, 0.06, 0.88),
      brows: 'soft',
      eyeShape: 'doe',
      ...eyes(210, 0.4, 0.55),
      ...skin(27, 0.3, 0.65),
      mouth: 'smile',
      ears: 'pointed',
      face: face({ cheeks: -0.2 }),
      outfit: 'violet',
    },
    worn: kit('mage'),
    props: 'walking_staff',
  },
  // Provisioner Fenna: a human trader at home under the boughs; warm bread.
  provisioner_fenna: {
    app: {
      gender: 'female',
      hair: 'chinbob',
      ...hair(24, 0.55, 0.3),
      brows: 'soft',
      eyeShape: 'round',
      ...eyes(140, 0.4, 0.35),
      ...skin(26, 0.45, 0.6),
      mouth: 'smile',
      face: face({ cheeks: 0.25 }),
      outfit: 'forest',
    },
    worn: kit('druid'),
    props: 'none',
  },
  // Wardsmith Orun, Keeper of the Old Forges: verdigris on old bronze work.
  wardsmith_orun: {
    app: {
      gender: 'male',
      hair: 'topknot',
      ...hair(22, 0.4, 0.1),
      beard: 'shortbox',
      brows: 'thick',
      eyeShape: 'almond',
      ...eyes(95, 0.45, 0.35),
      ...skin(25, 0.45, 0.45),
      face: face({ jaw: 0.25, brow: 0.15 }),
      body: body({ shoulders: 0.3, chest: 0.2, hands: 0.2 }),
      earrings: 'cuff',
      earringMaterial: 'bronze',
      outfit: 'verdigris',
    },
    worn: kit('barbarian', { arms: 'knight' }),
    props: 'hammer',
  },
  // Archivist Tullo, Reader of Stones: fresh ears for waiting monuments.
  archivist_tullo: {
    app: {
      gender: 'male',
      hair: 'crew',
      ...hair(28, 0.15, 0.4),
      brows: 'round',
      eyeShape: 'narrow',
      ...eyes(210, 0.35, 0.4),
      ...skin(26, 0.4, 0.58),
      face: face({ cheeks: -0.15, brow: -0.1 }),
      outfit: 'royal',
    },
    worn: kit('mage', { head: 'mage' }),
    props: 'tome',
  },
  // Huntsman Deral, Warden of the Herds: quiet now; the valley listens back.
  huntsman_deral: {
    app: {
      gender: 'male',
      hair: 'lowpony',
      ...hair(24, 0.45, 0.25),
      beard: 'scruff',
      brows: 'soft',
      eyeShape: 'almond',
      ...eyes(120, 0.4, 0.3),
      ...skin(25, 0.45, 0.5),
      mouth: 'neutral',
      body: body({ shoulders: 0.15 }),
      outfit: 'forest',
    },
    worn: kit('ranger'),
    props: 'crossbow',
  },
  // Lamplighter Sorrel, Keeper of the Nightgate: silver youth with a lamp pole.
  lamplighter_sorrel: {
    app: {
      gender: 'male',
      hair: 'quiff',
      ...hair(250, 0.15, 0.55),
      brows: 'soft',
      eyeShape: 'wide',
      ...eyes(46, 0.6, 0.5),
      ...skin(27, 0.3, 0.62),
      mouth: 'smile',
      ears: 'pointed',
      outfit: 'violet',
    },
    worn: kit('mage'),
    props: 'walking_staff',
  },
  // Lira Dewsong, Night-Gardener of Moonrest: lavender hair, rose lips, dew.
  lira_dewsong: {
    app: {
      gender: 'female',
      hair: 'longwavy',
      ...hair(275, 0.35, 0.7),
      brows: 'arched',
      eyeShape: 'doe',
      ...eyes(320, 0.45, 0.5),
      ...skin(27, 0.3, 0.66),
      mouth: 'lips',
      lipstick: 'rose',
      ears: 'pointed',
      earrings: 'feather',
      earringMaterial: 'silver',
      outfit: 'emerald',
    },
    worn: kit('druid'),
    props: 'none',
  },
  // Weaver Amelle: moonfleece on the loom; frost-blue halfbun, ivory robes.
  weaver_amelle: {
    app: {
      gender: 'female',
      hair: 'halfbun',
      ...hair(220, 0.2, 0.75),
      brows: 'soft',
      eyeShape: 'almond',
      ...eyes(210, 0.4, 0.55),
      ...skin(27, 0.3, 0.64),
      mouth: 'smile',
      ears: 'pointed',
      body: body({ hands: -0.1 }),
      outfit: 'ivory',
    },
    worn: kit('mage'),
    props: 'none',
  },
  // Gardener Yew, The Last Gardener: mossy calm, a scythe kept working.
  gardener_yew: {
    app: {
      gender: 'male',
      hair: 'crew',
      ...hair(90, 0.25, 0.25),
      beard: 'stubblebeard',
      brows: 'soft',
      eyeShape: 'sleepy',
      ...eyes(140, 0.5, 0.4),
      ...skin(26, 0.4, 0.55),
      mouth: 'smile',
      face: face({ brow: -0.1 }),
      body: body({ hands: 0.2 }),
      outfit: 'emerald',
    },
    worn: kit('druid'),
    props: 'scythe',
  },

  // === Wraithwood: Gallowmere and the Mournstone, mourning onyx ============
  // Lampman Cobb: stays in the lamplight and counts who passes; so does the wood.
  lampman_cobb: {
    app: {
      gender: 'male',
      hair: 'buzz',
      ...hair(26, 0.3, 0.25),
      beard: 'scruff',
      brows: 'worried',
      eyeShape: 'wide',
      ...eyes(46, 0.5, 0.45),
      ...skin(26, 0.3, 0.55),
      mouth: 'neutral',
      face: face({ brow: -0.2, cheeks: -0.2 }),
      outfit: 'onyx',
    },
    worn: kit('rogue'),
    props: 'walking_staff',
  },
  // Sexton Marrow: gaunt keeper of deep graves; the bells are his argument.
  sexton_marrow: {
    app: {
      gender: 'male',
      hair: 'bald',
      ...hair(30, 0.05, 0.5),
      beard: 'chinpuff',
      brows: 'thin',
      eyeShape: 'droopy',
      ...eyes(95, 0.3, 0.3),
      ...skin(28, 0.2, 0.55),
      mouth: 'frown',
      face: face({ cheeks: -0.6, chin: -0.2, nose: 0.25 }),
      body: body({ shoulders: -0.25, chest: -0.25 }),
      outfit: 'bonewrought',
    },
    worn: kit('mage'),
    props: 'scythe',
  },
  // Widow Tansy, Candlewright: white bun, mourning black, not one candle out.
  widow_tansy: {
    app: {
      gender: 'female',
      hair: 'highbun',
      ...hair(40, 0.05, 0.8),
      brows: 'worried',
      eyeShape: 'droopy',
      ...eyes(46, 0.4, 0.4),
      ...skin(27, 0.3, 0.62),
      mouth: 'frown',
      face: face({ cheeks: -0.4, brow: -0.2 }),
      body: body({ shoulders: -0.25, chest: -0.15 }),
      outfit: 'onyx',
    },
    worn: kit('mage'),
    props: 'none',
  },
  // Vicar Creel, Last Vicar of the Mournstone: the chapel fell; he stayed.
  vicar_creel: {
    app: {
      gender: 'male',
      hair: 'crew',
      ...hair(40, 0.05, 0.75),
      brows: 'flat',
      eyeShape: 'narrow',
      ...eyes(210, 0.25, 0.4),
      ...skin(26, 0.3, 0.58),
      mouth: 'neutral',
      face: face({ cheeks: -0.35, jaw: 0.1 }),
      outfit: 'onyx',
    },
    worn: kit('mage'),
    props: 'staff',
  },
  // Gravedigger Mosley: nervous chatter against the wood; shovel-shouldered.
  gravedigger_mosley: {
    app: {
      gender: 'male',
      hair: 'buzz',
      ...hair(24, 0.35, 0.2),
      beard: 'stubble',
      brows: 'worried',
      eyeShape: 'wide',
      ...eyes(30, 0.35, 0.3),
      ...skin(26, 0.35, 0.5),
      mouth: 'open',
      face: face({ brow: -0.25 }),
      body: body({ shoulders: 0.2, hands: 0.2 }),
      outfit: 'onyx',
    },
    worn: kit('rogue'),
    props: 'woodaxe',
  },

  // === The Frostveil Reach: Icemantle, pale furs and aurora ================
  // Warden Kaldra: a grandmother's patience with a warden's shield.
  warden_kaldra: {
    app: {
      gender: 'female',
      hair: 'braidcrown',
      ...hair(220, 0.05, 0.78),
      brows: 'soft',
      eyeShape: 'almond',
      ...eyes(210, 0.45, 0.5),
      ...skin(26, 0.3, 0.68),
      mouth: 'neutral',
      face: face({ cheeks: -0.2, jaw: 0.15 }),
      body: body({ shoulders: 0.2 }),
      outfit: 'azure',
    },
    worn: kit('barbarian', { chest: 'knight' }),
    props: 'sword_shield',
  },
  // Hearthkeeper Maeve: the lodge fire never goes out; neither does she.
  hearthkeeper_maeve: {
    app: {
      gender: 'female',
      hair: 'curls',
      ...hair(16, 0.6, 0.35),
      brows: 'round',
      eyeShape: 'round',
      ...eyes(30, 0.45, 0.3),
      ...skin(26, 0.45, 0.62),
      mouth: 'smile',
      blush: 'warm',
      face: face({ cheeks: 0.35 }),
      body: body({ hips: 0.1 }),
      outfit: 'ember',
    },
    worn: kit('druid'),
    props: 'none',
  },
  // Scout Einna: snow-pale braids, ivory leathers, back from the pass alive.
  scout_einna: {
    app: {
      gender: 'female',
      hair: 'twinbraids',
      ...hair(45, 0.5, 0.65),
      brows: 'flat',
      eyeShape: 'almond',
      ...eyes(210, 0.5, 0.55),
      ...skin(26, 0.3, 0.72),
      face: face({ jaw: 0.1 }),
      body: body({ hips: -0.1 }),
      outfit: 'ivory',
    },
    worn: kit('ranger'),
    props: 'crossbow',
  },
  // Aurorist Veyla: hush; ice-white hair and eyes the colour of the lights.
  aurorist_veyla: {
    app: {
      gender: 'female',
      hair: 'longcenterpart',
      ...hair(200, 0.1, 0.88),
      brows: 'thin',
      eyeShape: 'wideset',
      ...eyes(185, 0.6, 0.55),
      ...skin(27, 0.25, 0.7),
      mouth: 'lips',
      outfit: 'azure',
    },
    worn: kit('mage'),
    props: 'staff',
  },
  // Trapper Brosk: fur cap on, full beard, a dry laugh instead of a sentence.
  trapper_brosk: {
    app: {
      gender: 'male',
      hair: 'crew',
      ...hair(22, 0.45, 0.25),
      beard: 'full',
      brows: 'bushy',
      eyeShape: 'narrow',
      ...eyes(95, 0.35, 0.3),
      ...skin(25, 0.45, 0.52),
      mouth: 'smile',
      face: face({ cheeks: 0.1, nose: 0.2 }),
      body: body({ shoulders: 0.25, chest: 0.2 }),
    },
    worn: kit('barbarian', { head: 'barbarian' }),
    props: 'woodaxe',
  },
  // Astronomer Cassian, Watcher at the Vigil: the sky never dawns, he never stops.
  astronomer_cassian: {
    app: {
      gender: 'male',
      hair: 'sweptback',
      ...hair(24, 0.3, 0.12),
      beard: 'goatee',
      brows: 'arched',
      eyeShape: 'wideset',
      ...eyes(240, 0.5, 0.45),
      ...skin(27, 0.35, 0.58),
      earrings: 'moonstar',
      earringMaterial: 'silver',
      face: face({ cheeks: -0.15 }),
      outfit: 'royal',
    },
    worn: kit('mage', { head: 'mage' }),
    props: 'tome',
  },
  // Apprentice Wren: young, copper pixie, eyes wide at everything.
  apprentice_wren: {
    app: {
      gender: 'female',
      hair: 'pixie',
      ...hair(14, 0.7, 0.45),
      brows: 'round',
      eyeShape: 'wide',
      ...eyes(140, 0.5, 0.4),
      ...skin(26, 0.45, 0.66),
      mouth: 'smile',
      body: body({ shoulders: -0.2, chest: -0.15, hips: -0.1 }),
      outfit: 'azure',
    },
    worn: kit('mage'),
    props: 'none',
  },

  // === The Drakelands and Amberfall: ash, ember and gold ===================
  // Gatecaptain Brannoc: forty years of gate; obsidian plate, grey horseshoe.
  gatecaptain_brannoc: {
    app: {
      gender: 'male',
      hair: 'buzz',
      ...hair(30, 0.08, 0.5),
      beard: 'horseshoe',
      brows: 'thick',
      eyeShape: 'sharp',
      ...eyes(28, 0.4, 0.3),
      ...skin(24, 0.5, 0.42),
      mouth: 'frown',
      face: face({ jaw: 0.4, brow: 0.3 }),
      body: body({ shoulders: 0.3, chest: 0.2 }),
      outfit: 'obsidian',
    },
    worn: kit('knight'),
    props: 'sword_shield',
  },
  // Quartermaster Sela: forty miles of ash behind every crate; treat them kindly.
  quartermaster_sela: {
    app: {
      gender: 'female',
      hair: 'lowbun',
      ...hair(22, 0.4, 0.1),
      brows: 'flat',
      eyeShape: 'almond',
      ...eyes(28, 0.45, 0.4),
      ...skin(24, 0.5, 0.42),
      face: face({ jaw: 0.15 }),
      body: body({ shoulders: 0.15 }),
    },
    worn: kit('knight'),
    props: 'none',
  },
  // Scout Yerrin, Far-Dune Watcher: keep low; glass carries sound.
  scout_yerrin: {
    app: {
      gender: 'female',
      hair: 'sidepony',
      ...hair(20, 0.45, 0.1),
      brows: 'flat',
      eyeShape: 'narrow',
      ...eyes(46, 0.5, 0.35),
      ...skin(23, 0.55, 0.38),
      mouth: 'neutral',
      face: face({ brow: 0.1 }),
      body: body({ hips: -0.1 }),
      outfit: 'ember',
    },
    worn: kit('ranger'),
    props: 'crossbow',
  },
  // Reeve Ottoline of Lanternmere: the harvest never ends; neither do ledgers.
  reeve_ottoline: {
    app: {
      gender: 'female',
      hair: 'highbun',
      ...hair(16, 0.6, 0.35),
      brows: 'arched',
      eyeShape: 'almond',
      ...eyes(30, 0.45, 0.4),
      ...skin(26, 0.45, 0.58),
      mouth: 'lips',
      lipstick: 'nude',
      face: face({ brow: 0.1, chin: 0.1 }),
      outfit: 'gold',
    },
    worn: kit('druid'),
    props: 'none',
  },
  // Waywatcher Sorrel of the Goldmelt: copper braid, gold leathers, few cross twice.
  waywatcher_sorrel: {
    app: {
      gender: 'female',
      hair: 'warriorbraid',
      ...hair(14, 0.65, 0.35),
      brows: 'flat',
      eyeShape: 'sharp',
      ...eyes(46, 0.55, 0.4),
      ...skin(25, 0.5, 0.5),
      face: face({ jaw: 0.1, brow: 0.1 }),
      body: body({ shoulders: 0.15 }),
      outfit: 'gold',
    },
    worn: kit('ranger'),
    props: 'crossbow',
  },
  // Ferrymaster Caddow: fog on the Mere; a grey poleman who respects it.
  ferrymaster_caddow: {
    app: {
      gender: 'male',
      hair: 'crew',
      ...hair(30, 0.06, 0.6),
      beard: 'full',
      brows: 'bushy',
      eyeShape: 'droopy',
      ...eyes(200, 0.3, 0.4),
      ...skin(25, 0.4, 0.5),
      mouth: 'neutral',
      face: face({ cheeks: -0.2, nose: 0.2 }),
      outfit: 'teal',
    },
    worn: kit('rogue'),
    props: 'walking_staff',
  },
  // Orchardist Pomeline, Keeper of the Gilded Rows: chestnut crown, gold rows.
  orchardist_pomeline: {
    app: {
      gender: 'female',
      hair: 'braidcrown',
      ...hair(22, 0.55, 0.3),
      brows: 'soft',
      eyeShape: 'round',
      ...eyes(140, 0.45, 0.35),
      ...skin(26, 0.5, 0.58),
      mouth: 'smile',
      blush: 'peach',
      face: face({ cheeks: 0.3 }),
      outfit: 'gold',
    },
    worn: kit('druid'),
    props: 'none',
  },
  // Archivist Maelin Emberward, Crucible Archivist of the hidden Ignivar
  // forge: ash-grey bun, ember eyes that read Varkhul's records by forgelight.
  archivist_maelin_emberward: {
    app: {
      gender: 'female',
      hair: 'lowbun',
      ...hair(24, 0.12, 0.55),
      brows: 'arched',
      eyeShape: 'narrow',
      ...eyes(32, 0.6, 0.42),
      ...skin(25, 0.42, 0.5),
      mouth: 'neutral',
      face: face({ cheeks: -0.2, brow: 0.15, eyes: 0.1 }),
      body: body({ shoulders: -0.1 }),
      outfit: 'ember',
    },
    worn: kit('mage', { head: 'mage' }),
    props: 'tome',
  },
  // Quartermaster Bronn Emberward, the Crucible sigil broker: a forge-broad
  // quartermaster in ember-tempered plate, hammer at hand, the counter he
  // keeps standing a few paces from the raid door.
  crucible_quartermaster: {
    app: {
      gender: 'male',
      hair: 'mohawk',
      ...hair(18, 0.25, 0.2),
      beard: 'scruff',
      brows: 'sharp',
      eyeShape: 'narrow',
      ...eyes(30, 0.6, 0.4),
      ...skin(24, 0.45, 0.4),
      mouth: 'frown',
      face: face({ jaw: 0.35, brow: 0.3 }),
      body: body({ shoulders: 0.35, chest: 0.25, hands: 0.2 }),
      outfit: 'ember',
    },
    worn: kit('paladin', { chest: 'knight', arms: 'knight' }),
    props: 'hammer',
  },
  // Maelin's Ember Projection: the same archivist carried forward through the
  // forge as living flame; her silhouette holds, her colours burn.
  archivist_maelin_ember_projection: {
    app: {
      gender: 'female',
      hair: 'lowbun',
      ...hair(20, 0.85, 0.6),
      brows: 'arched',
      eyeShape: 'narrow',
      ...eyes(46, 0.85, 0.55),
      ...skin(22, 0.75, 0.6),
      mouth: 'neutral',
      face: face({ cheeks: -0.2, brow: 0.15, eyes: 0.1 }),
      body: body({ shoulders: -0.1 }),
      outfit: 'ember',
    },
    worn: kit('mage', { head: 'mage' }),
    props: 'tome',
  },

  // === Palmreach and the far shores ========================================
  // Castaway Navigator: sun-bleached, half-dressed, still reading the stars.
  castaway_navigator: {
    app: {
      gender: 'male',
      hair: 'longpart',
      ...hair(45, 0.45, 0.6),
      beard: 'scruff',
      brows: 'soft',
      eyeShape: 'almond',
      ...eyes(185, 0.55, 0.45),
      ...skin(23, 0.55, 0.35),
      mouth: 'neutral',
      face: face({ cheeks: -0.2 }),
      body: body({ chest: -0.1 }),
    },
    worn: kit('rogue', { chest: null, arms: null, hands: null }),
    props: 'none',
  },
  // Fisher Bram, Nell's husband: thrown back by the sea; it shows.
  fisher_bram: {
    app: {
      gender: 'male',
      hair: 'messy',
      ...hair(28, 0.2, 0.4),
      beard: 'full',
      brows: 'worried',
      eyeShape: 'droopy',
      ...eyes(200, 0.3, 0.4),
      ...skin(25, 0.4, 0.5),
      mouth: 'frown',
      face: face({ cheeks: -0.3, brow: -0.2 }),
      outfit: 'teal',
    },
    worn: kit('rogue', { arms: null }),
    props: 'none',
  },

  // === The Proving Shore: the tutorial island, salt, sailcloth and sun ======
  // The island is the first face the game shows, so its keepers read as a crew
  // that works outdoors: sun-darkened skin, salt-bleached or weather-greyed
  // hair, and each one's outfit colourway matched to the nameplate colour their
  // NpcDef already carries (src/sim/content/proving_shore.ts), so the person and
  // the marker agree. Gender follows the shipped voice casting (each line is
  // recorded by an existing actor: Bryn on Waykeeper Pell, Nel on Captain
  // Thessaly, Rook on Marshal Redbrook, Pell on Foreman Odell, Tam on Warden
  // Fenwick, Finch on Quartermaster Bree, Wick on Bursar Fernando, Maren on
  // Stablemaster Marla) and the English quest copy's pronouns.

  // Wayfarer Bryn: the Eastbrook-side greeter who points at the crossing, not
  // an islander; town clothes with a traveller's road-worn edge.
  wayfarer_bryn: {
    app: {
      gender: 'female',
      hair: 'halfbun',
      ...hair(30, 0.42, 0.28),
      brows: 'soft',
      eyeShape: 'doe',
      ...eyes(268, 0.3, 0.42),
      ...skin(28, 0.42, 0.6),
      mouth: 'smile',
      face: face({ cheeks: 0.25, eyes: 0.15 }),
      outfit: 'violet',
    },
    worn: kit('ranger', { back: null }),
    props: 'none',
  },
  // Instructor Maren: the Proving Master who signs off the whole island; the
  // only islander in a full kit, because the graduation is hers to give.
  instructor_maren: {
    app: {
      gender: 'female',
      hair: 'warriorbraid',
      ...hair(24, 0.28, 0.18),
      brows: 'angled',
      eyeShape: 'sharp',
      ...eyes(272, 0.38, 0.34),
      ...skin(27, 0.46, 0.52),
      face: face({ jaw: 0.25, brow: 0.15 }),
      body: body({ shoulders: 0.18 }),
      outfit: 'royal',
    },
    worn: kit('knight'),
    props: 'sword',
  },
  // Quartermaster Finch: the camp stall; buys salvage all day, so she is the
  // one islander with rolled sleeves and an apron-drab colourway.
  quartermaster_finch: {
    app: {
      gender: 'female',
      hair: 'chinbob',
      ...hair(38, 0.5, 0.44),
      brows: 'round',
      eyeShape: 'round',
      ...eyes(96, 0.32, 0.36),
      ...skin(29, 0.44, 0.64),
      mouth: 'grin',
      face: face({ cheeks: 0.3, nose: 0.15 }),
      earrings: 'hoop',
      earringMaterial: 'copper',
      outfit: 'forest',
    },
    worn: kit('rogue', { arms: null }),
    props: 'none',
  },
  // Bursar Wick: the Gilded Strongbox, a clerk not a fighter; robes, a ledger,
  // and the one gold colourway on the island because the name promises it.
  bursar_wick: {
    app: {
      gender: 'male',
      hair: 'sidepart',
      ...hair(40, 0.2, 0.66),
      beard: 'goatee',
      brows: 'thin',
      eyeShape: 'narrow',
      ...eyes(44, 0.45, 0.38),
      ...skin(30, 0.34, 0.68),
      face: face({ chin: 0.2, cheeks: -0.2 }),
      body: body({ shoulders: -0.15 }),
      earrings: 'stud',
      earringMaterial: 'gold',
      outfit: 'gilded',
    },
    worn: kit('mage'),
    props: 'tome',
  },
  // Ferryman Odo: the oldest hand on the shore and the first voice a new player
  // hears; weathered, white-bearded, punt pole still in his fist.
  ferryman_odo: {
    app: {
      gender: 'male',
      hair: 'longcenterpart',
      ...hair(36, 0.08, 0.78),
      beard: 'full',
      brows: 'bushy',
      eyeShape: 'droopy',
      ...eyes(206, 0.32, 0.46),
      ...skin(26, 0.5, 0.48),
      face: face({ jaw: 0.2, cheeks: -0.35, nose: 0.3 }),
      body: body({ shoulders: 0.15, hands: 0.2 }),
      outfit: 'azure',
    },
    worn: kit('druid', { arms: null, back: null }),
    props: 'walking_staff',
  },
  // Warden Tam: keeps the Gauntlet on the strand; lean, sun-cured, a spear he
  // uses as a lane marker more than a weapon.
  warden_tam: {
    app: {
      gender: 'male',
      hair: 'crew',
      ...hair(22, 0.4, 0.24),
      beard: 'stubble',
      brows: 'flat',
      eyeShape: 'almond',
      ...eyes(32, 0.4, 0.3),
      ...skin(25, 0.52, 0.44),
      face: face({ jaw: 0.3, cheeks: -0.25 }),
      body: body({ shoulders: 0.1, knees: 0.15 }),
      outfit: 'classic',
    },
    worn: kit('ranger'),
    props: 'spear',
  },
  // Overseer Pell: clocks every Gauntlet run from the far end; a foreman's
  // build, arms crossed, nothing in his hands but the count.
  overseer_pell: {
    app: {
      gender: 'male',
      hair: 'buzz',
      ...hair(18, 0.22, 0.32),
      beard: 'horseshoe',
      brows: 'thick',
      eyeShape: 'wideset',
      ...eyes(84, 0.36, 0.32),
      ...skin(24, 0.48, 0.5),
      mouth: 'wide',
      face: face({ jaw: 0.35, chin: 0.25 }),
      body: body({ shoulders: 0.3, chest: 0.25 }),
      outfit: 'verdigris',
    },
    worn: kit('rogue'),
    props: 'none',
  },
  // Drillmaster Rook: turns footwork into swordwork in the practice yard; the
  // island's one sword-and-board silhouette, brick red to match his nameplate.
  drillmaster_rook: {
    app: {
      gender: 'male',
      hair: 'topknot',
      ...hair(16, 0.34, 0.2),
      beard: 'shortbox',
      brows: 'sharp',
      eyeShape: 'narrow',
      ...eyes(8, 0.42, 0.3),
      ...skin(23, 0.5, 0.46),
      mouth: 'frown',
      face: face({ brow: 0.3, jaw: 0.25, smirk: -0.2 }),
      body: body({ shoulders: 0.35, chest: 0.2, elbows: 0.15 }),
      outfit: 'crimson',
    },
    worn: kit('knight'),
    props: 'sword_shield',
  },
  // Tidewarden Nel: keeps the strand tally out where the wrecks are; salt-white
  // hair, teal oilskins, a stave she walks the tide line with.
  tidewarden_nel: {
    app: {
      gender: 'female',
      hair: 'fantasybraid',
      ...hair(190, 0.12, 0.82),
      brows: 'arched',
      eyeShape: 'cat',
      ...eyes(178, 0.44, 0.4),
      ...skin(31, 0.4, 0.56),
      face: face({ cheeks: -0.2, eyes: 0.2, chin: 0.15 }),
      body: body({ shoulders: 0.12 }),
      earrings: 'bonehoop',
      earringMaterial: 'turquoise',
      outfit: 'teal',
    },
    worn: kit('druid'),
    props: 'oak_stave',
  },
};

/**
 * The one NPC this module deliberately does NOT compose, under any of the hub
 * ids he recurs at (`brother_aldric`, `_fen`, `_highwatch`, `_raid`).
 *
 * Brother Aldric renders the pre-v0.7 `npc_aldric` model, restored on purpose
 * once already (PR #499) after a model change moved him off it. The community
 * knows him by that exact silhouette, staff baked into the mesh and all, so a
 * composed replacement would be a regression no matter how good the new body
 * is. `npcLookFor` returns null for him, which is the same "keep the fixed
 * rig" answer a pre-creator player character gets, so nothing special-cases
 * him downstream. Pinned by tests/npc_looks.test.ts.
 */
export function aldricKeepsHisRig(templateId: string): boolean {
  return templateId.startsWith('brother_aldric');
}

/** Suffixed hub ids that share one person's look (the same character recurs
 *  across zones under new templateIds). */
function baseId(templateId: string): string {
  if (templateId === 'scout_maren_highwatch') return 'scout_maren';
  if (templateId === 'brother_halven_marsh') return 'brother_halven';
  return templateId;
}

// Composed looks resolve once per templateId: the table is static, and a stable
// object identity keeps every downstream diff/cache (variant cache keys, the
// pool, portrait caches) on the fast path.
const resolved = new Map<string, ModularLook | null>();

/** The authored look for an NPC templateId, or null for one with no entry
 *  (which keeps its fixed rig, the same null the player path uses). */
export function npcLookFor(templateId: string, kind: EntityKind = 'npc'): ModularLook | null {
  if (kind !== 'npc') return null;
  if (aldricKeepsHisRig(templateId)) return null;
  const id = baseId(templateId);
  let look = resolved.get(id);
  if (look === undefined) {
    const def = NPC_LOOKS[id];
    look = def ? { app: normalizeAppearance(def.app), worn: def.worn } : null;
    resolved.set(id, look);
  }
  return look;
}

/** The modular VisualDef key for a composed NPC: the prop-set def authored for
 *  them (every prop set has one, derived in manifest.ts). */
export function npcModularKeyFor(templateId: string): string {
  const def = NPC_LOOKS[baseId(templateId)];
  return `npc_modular_${def?.props ?? 'none'}`;
}
