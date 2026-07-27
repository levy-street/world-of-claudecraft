// Compose per-piece variant atlases for every finished (character, theme)
// repaint and emit the picker manifest. Resumable: atlases whose PNG already
// exists are skipped; themes whose textured GLB is missing are omitted from
// the manifest. Run from repo root:
//   node tmp/asset_pipeline/armor_picker/build_picker_assets.mjs
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';

const DIR = 'tmp/asset_pipeline/armor_picker'; // workspace (generated artifacts, untracked)
const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const THEMES = ['obsidian', 'frost', 'gilded', 'verdant'];
const CHARS = {
  warrior: {
    label: 'Warrior',
    glb: 'work/warrior_plain.glb',
    pieces: {
      Armor_Helm: { label: 'Helm', removable: true },
      Armor_Shoulders: { label: 'Pauldrons', removable: true },
      Armor_Torso: { label: 'Breastplate', removable: true },
      Armor_Arms: { label: 'Gauntlets', removable: true },
      Armor_Legs: { label: 'Greaves', removable: true },
      Torso: { label: 'Tunic', removable: false },
      Shoulders: { label: 'Shoulder Pads', removable: false },
    },
  },
  paladin: {
    label: 'Paladin',
    glb: 'work/paladin_plain.glb',
    pieces: {
      Torso: { label: 'Breastplate', removable: false },
      Shoulders: { label: 'Pauldrons', removable: false },
      Legs: { label: 'Legs', removable: false },
    },
  },
  druid: {
    label: 'Druid',
    glb: 'work/druid_plain.glb',
    pieces: {
      Torso: { label: 'Vestment', removable: false },
      Legs: { label: 'Legs', removable: false },
    },
  },
  hunter: {
    label: 'Hunter',
    glb: 'work/hunter_split.glb',
    pieces: {
      Torso: { label: 'Jerkin', removable: false },
      Legs: { label: 'Legs', removable: false },
    },
  },
  shaman: {
    label: 'Shaman',
    glb: 'work/shaman_split.glb',
    pieces: {
      Torso: { label: 'Harness', removable: false },
      Shoulders: { label: 'Pauldrons', removable: false },
      Legs: { label: 'Legs', removable: false },
    },
  },
};

// Generated full-geometry armor sets (rigged on the warrior's mixamorig
// skeleton; attachable to any character sharing those joint names).
const SETS = {
  dragonscale: { label: 'Dragonscale', glb: 'work/set_dragonscale.glb' },
  bonewrought: { label: 'Bonewrought', glb: 'work/set_bonewrought.glb' },
  stormcrystal: { label: 'Stormcrystal', glb: 'work/set_stormcrystal.glb' },
};
const SET_SLOTS = {
  Helm: 'Helm',
  Shoulders: 'Pauldrons',
  Torso: 'Breastplate',
  Arms: 'Gauntlets',
  Legs: 'Greaves',
};
const SET_CHARS = ['warrior', 'paladin', 'druid'];

const manifest = {
  themes: THEMES,
  chars: {},
  sets: {},
  setSlots: SET_SLOTS,
  heads: {},
  weapons: {},
  wings: {},
};
// Held weapons (grip-normalized GLBs: origin at grip, blade +Y) and the hover
// wing cosmetics, both attached at runtime by bone.
const WEAPONS = {
  emberfang_sword: { label: 'Emberfang Sword', family: 'sword' },
  purple_sword: { label: 'Purple Sword', family: 'sword' },
  purple_axe: { label: 'Purple Axe', family: 'axe' },
  purple_dagger: { label: 'Purple Dagger', family: 'dagger' },
  purple_staff: { label: 'Purple Staff', family: 'staff' },
  purple_wand: { label: 'Purple Wand', family: 'wand' },
  redskull_sword: { label: 'Red Skull Sword', family: 'sword' },
  redskull_hammer: { label: 'Red Skull Hammer', family: 'axe' },
  redskull_dagger: { label: 'Red Skull Dagger', family: 'dagger' },
  redskull_staff: { label: 'Red Skull Staff', family: 'staff' },
  redskull_wand: { label: 'Red Skull Wand', family: 'wand' },
  sword_2handed: { label: 'Greatsword (KayKit)', family: 'sword' },
  axe_2handed: { label: 'Greataxe (KayKit)', family: 'axe' },
  staff: { label: 'Staff (KayKit)', family: 'staff' },
};
for (const [key, def] of Object.entries(WEAPONS)) {
  const glb = `work/weapons/${key}.glb`;
  if (existsSync(`${DIR}/${glb}`)) manifest.weapons[key] = { ...def, glb };
}
const WINGS = {
  hover_butterfly_wings: { label: 'Butterfly Wings', pos: [0, 0.14, -0.16], scale: 1.3 },
  hover_angel_wings: { label: 'Angel Wings', pos: [0, 0.14, -0.16], scale: 1.35 },
  hover_dragon_wings: { label: 'Dragon Wings', pos: [0, 0.14, -0.18], scale: 1.45 },
  hover_jetpack: { label: 'Jetpack', pos: [0, 0.12, -0.2], scale: 1 },
};
for (const [key, def] of Object.entries(WINGS)) {
  const glb = `work/cosmetics/${key}.glb`;
  if (existsSync(`${DIR}/${glb}`)) manifest.wings[key] = { ...def, glb };
}
// Transplanted alternative heads (equippable on the mixamorig characters).
const HEADS = { hunter: { label: 'Hunter (KayKit)', glb: 'work/head_hunter.glb' } };
for (const [key, def] of Object.entries(HEADS)) {
  if (existsSync(`${DIR}/${def.glb}`)) manifest.heads[key] = def;
  else console.log(`missing head ${key}, omitted`);
}
for (const [key, def] of Object.entries(SETS)) {
  if (existsSync(`${DIR}/${def.glb}`)) manifest.sets[key] = def;
  else console.log(`missing set ${key}, omitted`);
}
for (const [char, def] of Object.entries(CHARS)) {
  const entry = { label: def.label, glb: def.glb, pieces: {}, sets: SET_CHARS.includes(char) };
  const tucked = `work/${char}_tucked.glb`;
  if (existsSync(`${DIR}/${tucked}`)) entry.tucked = tucked;
  for (const [piece, meta] of Object.entries(def.pieces)) {
    entry.pieces[piece] = { ...meta, variants: {} };
  }
  for (const theme of THEMES) {
    const textured = `${DIR}/work/${char}_${theme}_textured.glb`;
    if (!existsSync(textured)) {
      console.log(`missing ${char}/${theme} repaint, omitted`);
      continue;
    }
    await mkdir(`${DIR}/atlases/${char}/${theme}`, { recursive: true });
    for (const piece of Object.keys(def.pieces)) {
      const out = `${DIR}/atlases/${char}/${theme}/${piece}.png`;
      if (!existsSync(out)) {
        try {
          execFileSync(
            'node',
            [join(SCRIPTS, 'compose_piece.mjs'), `${DIR}/${def.glb}`, textured, piece, out],
            { stdio: 'inherit' },
          );
        } catch (err) {
          console.error(`FAILED compose ${char}/${theme}/${piece}: ${err.message}`);
          continue;
        }
      }
      entry.pieces[piece].variants[theme] = `atlases/${char}/${theme}/${piece}.png`;
    }
  }
  manifest.chars[char] = entry;
}
await writeFile(`${DIR}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log('wrote manifest.json');
