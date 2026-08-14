// Deterministic online-crowd fixture shared by the geared-arrival benchmark
// and the GPU hitch campaign. The fixture is deliberately data-only: every
// A/B leg must present the observer with the same authored bodies and weapons.

import { createHash } from 'node:crypto';

export const GEARED_ARRIVAL_LOADOUTS = Object.freeze([
  Object.freeze({
    cls: 'warrior',
    weapon: 'worn_sword',
    skins: Object.freeze([
      'solheim_sword',
      'ice_fang_sword',
      'cinderbrand_sword',
      'guildmark_arming_sword',
    ]),
  }),
  Object.freeze({
    cls: 'warrior',
    weapon: 'handaxe',
    skins: Object.freeze(['skyrender_axe', 'glaciersplit_axe', 'emberbite_axe', 'brasscap_axe']),
  }),
  Object.freeze({
    cls: 'paladin',
    weapon: 'training_mace',
    skins: Object.freeze([
      'starfall_mace',
      'rimecrusher_mace',
      'smoulderfall_mace',
      'tempered_flanged_mace',
    ]),
  }),
  Object.freeze({
    cls: 'rogue',
    weapon: 'rusty_dagger',
    skins: Object.freeze([
      'astravyr_dagger',
      'frostbite_dagger',
      'ashspark_dagger',
      'guildmark_dirk',
    ]),
  }),
  Object.freeze({
    cls: 'mage',
    weapon: 'gnarled_staff',
    skins: Object.freeze([
      'cosmarch_staff',
      'hoarfrost_vigil_staff',
      'forgeheart_staff',
      'brasscrown_staff',
    ]),
  }),
]);

const HAIRS = Object.freeze([
  'bald',
  'buzz',
  'crew',
  'pixie',
  'quiff',
  'sidepart',
  'messy',
  'curlycap',
  'pompadour',
  'sweptback',
  'fauxhawk',
  'mohawk',
  'topknot',
  'warriorbraid',
  'highbun',
  'braidcrown',
  'afro',
  'wavybob',
  'longwavy',
  'fantasybraid',
]);
const BEARDS = Object.freeze([
  'none',
  'stubble',
  'scruff',
  'mutton',
  'goatee',
  'chinpuff',
  'stache',
  'horseshoe',
  'shortbox',
  'full',
  'vikingb',
  'wizard',
  'stubblebeard',
]);
const BROWS = Object.freeze([
  'soft',
  'thick',
  'angled',
  'flat',
  'arched',
  'thin',
  'bushy',
  'worried',
  'sharp',
  'round',
]);
const EYES = Object.freeze([
  'round',
  'almond',
  'narrow',
  'wide',
  'sharp',
  'droopy',
  'sleepy',
  'wideset',
  'cat',
  'doe',
]);
const EARS = Object.freeze(['round', 'pointed', 'small', 'wide']);
const MOUTHS = Object.freeze([
  'neutral',
  'lips',
  'smile',
  'frown',
  'wide',
  'pout',
  'grin',
  'open',
  'awe',
]);
const EARRINGS = Object.freeze([
  'none',
  'stud',
  'hoop',
  'bone',
  'moon',
  'moonstar',
  'feather',
  'runic',
  'cuff',
  'chain',
  'septum',
  'warden',
]);
const EARRING_MATERIALS = Object.freeze([
  'default',
  'gold',
  'silver',
  'bone',
  'iron',
  'copper',
  'bronze',
  'obsidian',
  'jade',
  'amethyst',
  'ruby',
  'pearl',
  'turquoise',
]);
const OUTFITS = Object.freeze([
  'classic',
  'crimson',
  'ember',
  'gold',
  'forest',
  'emerald',
  'teal',
  'azure',
  'royal',
  'violet',
  'magenta',
  'rose',
  'onyx',
  'ivory',
  'gilded',
  'bonewrought',
  'obsidian',
  'verdigris',
  'bloodforged',
]);
const LIPS = Object.freeze(['none', 'rose', 'coral', 'ruby', 'berry', 'plum', 'nude']);
const BLUSH = Object.freeze(['none', 'peach', 'rose', 'warm', 'mauve']);
const SHADOW = Object.freeze(['none', 'smoke', 'bronze', 'plum', 'teal', 'rose']);

function cycle(values, index, stride = 1) {
  return values[(index * stride) % values.length];
}

function signed(index, salt, amplitude) {
  const unit = ((index * 37 + salt * 53) % 101) / 100;
  return Number(((unit * 2 - 1) * amplitude).toFixed(3));
}

/** A complete, valid authored look. No clock or randomness enters the matrix. */
export function gearedArrivalAppearance(index) {
  const gender = index % 2 === 0 ? 'male' : 'female';
  const hairHue = (index * 67 + 19) % 360;
  const hairSat = 0.2 + ((index * 17) % 61) / 100;
  const hairLight = 0.12 + ((index * 13) % 57) / 100;
  return {
    gender,
    hair: cycle(HAIRS, index, 7),
    beard: gender === 'female' && index % 5 !== 1 ? 'none' : cycle(BEARDS, index, 5),
    brows: cycle(BROWS, index, 3),
    earrings: cycle(EARRINGS, index, 5),
    earringMaterial: cycle(EARRING_MATERIALS, index, 7),
    skinHue: 18 + ((index * 11) % 21),
    skinSat: 0.24 + ((index * 7) % 37) / 100,
    skinLight: 0.28 + ((index * 13) % 53) / 100,
    hairHue,
    hairSat,
    hairLight,
    face: {
      nose: signed(index, 1, 0.7),
      eyes: signed(index, 2, 0.7),
      ears: signed(index, 3, 0.7),
      jaw: signed(index, 4, 0.7),
      brow: signed(index, 5, 0.7),
      cheeks: signed(index, 6, 0.7),
      chin: signed(index, 7, 0.7),
      smirk: signed(index, 8, 0.7),
    },
    body: {
      shoulders: signed(index, 9, 0.35),
      chest: signed(index, 10, 0.35),
      hips: signed(index, 11, 0.35),
      hands: signed(index, 12, 0.35),
      elbows: signed(index, 13, 0.35),
      knees: signed(index, 14, 0.35),
      feet: signed(index, 15, 0.35),
    },
    mouth: cycle(MOUTHS, index, 5),
    eyeShape: cycle(EYES, index, 7),
    ears: cycle(EARS, index, 3),
    lashes: index % 3 !== 0,
    lashHue: hairHue,
    lashSat: hairSat,
    lashLight: hairLight,
    eyeHue: (index * 83 + 31) % 360,
    eyeSat: 0.2 + ((index * 19) % 66) / 100,
    eyeLight: 0.12 + ((index * 23) % 41) / 100,
    lipstick: cycle(LIPS, index, 3),
    blush: cycle(BLUSH, index, 2),
    eyeshadow: cycle(SHADOW, index, 5),
    outfit: cycle(OUTFITS, index, 7),
  };
}

export function gearedArrivalBotFixture(index) {
  const loadout = GEARED_ARRIVAL_LOADOUTS[index % GEARED_ARRIVAL_LOADOUTS.length];
  return {
    index,
    cls: loadout.cls,
    weapon: loadout.weapon,
    skins: [...loadout.skins],
    skin: loadout.skins[Math.floor(index / GEARED_ARRIVAL_LOADOUTS.length) % loadout.skins.length],
    appearance: gearedArrivalAppearance(index),
    helmHidden: index % 2 === 0,
  };
}

export function gearedArrivalFixtureManifest(count) {
  if (!Number.isInteger(count) || count < 0) throw new Error('fixture count must be non-negative');
  return Array.from({ length: count }, (_, index) => gearedArrivalBotFixture(index));
}

export function gearedArrivalFixtureSha256(count) {
  return createHash('sha256')
    .update(JSON.stringify(gearedArrivalFixtureManifest(count)))
    .digest('hex');
}
