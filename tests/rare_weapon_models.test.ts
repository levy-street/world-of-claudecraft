// The rare set: two designs for each weapon type (`_a`, `_b`) in up to three painted finishes
// (teal, ember, violet), and two shield designs. Which items draw them, the shape their files
// must keep for the attach path to seat them, and the fit each design takes.
//
// Where several epic items shared one finish of a design, the owner asked for a look apiece.
// Those extra finishes (jade, spectral, molten and so on) are the same designs with the
// pack's paint recoloured: same mesh, same UVs, a new atlas.
//
// A weapon draws the set one rarity below its own, so EPIC items draw this one. Common,
// uncommon and rare weapons draw the field set (tests/field_weapon_models.test.ts), legendary
// weapons the epic set (tests/epic_weapon_models.test.ts). World NPCs hold it too.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KAYKIT_WEAPON_ACCESSORY, VARIANT_GRIPS } from '../src/render/characters/assets';
import { BACK_GRIP_FAMILIES } from '../src/render/characters/back_grips';
import { KAYKIT_SHIELD_ACCESSORIES } from '../src/render/characters/held_item_grips';
import {
  ITEM_OFFHAND_MODELS,
  isAuthoredHeldModelUrl,
  isRimlessHeldModelUrl,
  itemOffhandModelUrl,
  itemWeaponModelUrl,
  manifestUrls,
  NPC_PROP_ATTACH,
} from '../src/render/characters/manifest';
import { variantGripTransform, WEAPON_GRIP_OVERRIDES } from '../src/render/characters/weapon_grip';
import { weaponTypeForItem } from '../src/sim/content/weapon_skin_rules';
import { ITEMS } from '../src/sim/data';
import { isShieldItem, weaponHand } from '../src/sim/equipment_rules';
import { ITEM_WEAPON_VARIANTS } from '../src/ui/weapon_variants';

const model = (key: string): string => `models/weapons/${key}.glb`;

interface RareDesign {
  /** Gameplay weapon type of every item that may draw this design. */
  type: string;
  /** Grip family the design rides in the hand and on the back. */
  family: string;
  /** Painted finishes in the game (only the finishes an item or an NPC uses are shipped). */
  looks: readonly string[];
  /** [lowest point under the grip, highest point above it] along the weapon, in the file. */
  span: readonly [number, number];
  /** Finishes whose file differs in length from the design's `span` (a shortened haft). */
  spans?: Readonly<Record<string, readonly [number, number]>>;
  /** The file is turned head-up about the grip (the carry reads the file); the hand turns
   *  it back. */
  headUp?: true;
  /** The file has its edge on the side a hand holds UP; the hand gives it a half turn about
   *  the hilt (tests/pack_weapon_hand_seat.test.ts measures which way an edge faces). */
  edgeTurned?: true;
}

const DESIGNS: Record<string, RareDesign> = {
  // the straight sword: one-hand in teal and anvil, a greatsword in every other finish
  sword_rare_a: {
    type: 'sword',
    family: 'VAR_SWORD',
    looks: ['teal', 'ember', 'violet', 'jade', 'spectral', 'molten', 'royal', 'ivory', 'anvil'],
    span: [-0.36, 1.64],
  },
  // the saber
  sword_rare_b: {
    type: 'sword',
    family: 'VAR_SWORD',
    looks: ['teal', 'ember', 'violet'],
    span: [-0.36, 1.64],
  },
  dagger_rare_a: {
    type: 'dagger',
    family: 'VAR_DAGGER',
    looks: ['teal', 'ember', 'violet', 'frost', 'bone'],
    span: [-0.243, 1.037],
  },
  // the curved dagger
  dagger_rare_b: {
    type: 'dagger',
    family: 'VAR_DAGGER',
    looks: ['teal', 'ember', 'violet'],
    span: [-0.243, 1.037],
    edgeTurned: true,
  },
  hammer_rare_a: {
    type: 'mace',
    family: 'VAR_MACE',
    looks: ['teal', 'ember'],
    span: [-0.377, 1.073],
  },
  // the war maul: two-hand length in the file. The two finishes held in two hands had 0.45
  // of bare haft taken out (owner: shorter handle); the one-hand finish is as made.
  hammer_rare_b: {
    type: 'mace',
    family: 'VAR_HAMMER',
    looks: ['teal', 'ember', 'violet'],
    span: [-0.623, 1.527],
    spans: { teal: [-0.623, 1.077], violet: [-0.623, 1.077] },
  },
  // the bearded axe
  axe_rare_a: {
    type: 'axe',
    family: 'VAR_AXE',
    looks: ['teal', 'ember', 'violet'],
    span: [-0.39, 1.11],
  },
  // the double-bit axe: the one two-hand axe draws it
  axe_rare_b: { type: 'axe', family: 'VAR_AXE', looks: ['ember'], span: [-0.39, 1.11] },
  staff_rare_a: {
    type: 'staff',
    family: 'VAR_STAFF',
    looks: ['teal', 'ember', 'violet', 'obsidian'],
    span: [-1.368, 0.912],
    headUp: true,
  },
  staff_rare_b: {
    type: 'staff',
    family: 'VAR_STAFF',
    looks: ['teal', 'ember', 'violet'],
    span: [-1.368, 0.912],
    headUp: true,
  },
  // the glaive and the spear: no epic polearm exists, world NPCs hold them
  spear_rare_a: {
    type: 'polearm',
    family: 'VAR_POLEARM',
    looks: ['teal'],
    span: [-1.56, 0.84],
    headUp: true,
  },
  spear_rare_b: {
    type: 'polearm',
    family: 'VAR_POLEARM',
    looks: ['ember'],
    span: [-1.625, 0.875],
    headUp: true,
  },
  wand_rare_a: { type: 'wand', family: 'VAR_WAND', looks: ['teal'], span: [-0.294, 0.796] },
  wand_rare_b: {
    type: 'wand',
    family: 'VAR_WAND',
    looks: ['ember', 'violet'],
    span: [-0.294, 0.796],
  },
};

/** Every held weapon key of the set, with the design it belongs to. */
const WEAPON_KEYS: [string, string][] = Object.entries(DESIGNS).flatMap(([stem, design]) =>
  design.looks.map((look): [string, string] => [`${stem}_${look}`, stem]),
);
/** The finishes held in two hands, and the length each draws at. A model has one size, so a
 *  finish serves one hand: these carry a scale (weapon_grip.ts), every other finish draws at
 *  one-hand length. A staff is one length for either hand. */
const TWO_HAND: Record<string, number> = {
  sword_rare_a_ember: 2.15,
  sword_rare_a_violet: 2.15,
  sword_rare_a_jade: 2.15,
  sword_rare_a_spectral: 2.15,
  sword_rare_a_molten: 2.15,
  sword_rare_a_royal: 2.15,
  sword_rare_a_ivory: 2.15,
  axe_rare_b_ember: 1.875,
  hammer_rare_b_teal: 1.6,
  hammer_rare_b_violet: 1.6,
};
/** The owner's sizing pass ("weapons that look a bit too big for their hands"): the designs
 *  that draw at a fraction of the length their file has. The two-hand lengths above are the
 *  pass's too: the greatswords were 2.4, the axe 2.1, the mauls 1.7. */
const SIZED: Record<string, number> = { dagger_rare_a: 0.7, dagger_rare_b: 0.7 };
/** The repainted finishes: each gives one epic item that shared a pack finish a look of its
 *  own, and is built on the pack finish named here (same mesh and UVs). */
const REPAINTS: Record<string, readonly [item: string, from: string]> = {
  sword_rare_a_jade: ['greatfang_of_the_basin', 'sword_rare_a_ember'],
  sword_rare_a_spectral: ['deathless_greatblade', 'sword_rare_a_teal'],
  sword_rare_a_molten: ['heart_of_the_end_greatblade', 'sword_rare_a_violet'],
  sword_rare_a_royal: ['vanguard_verdict_greatsword', 'sword_rare_a_teal'],
  sword_rare_a_ivory: ['wildheart_tuskblade', 'sword_rare_a_teal'],
  sword_rare_a_anvil: ['anvilguard_blade', 'sword_rare_a_ember'],
  dagger_rare_a_frost: ['rimefang', 'dagger_rare_a_violet'],
  dagger_rare_a_bone: ['marrowpoint', 'dagger_rare_a_teal'],
  staff_rare_a_obsidian: ['emberglass_warstaff', 'staff_rare_a_violet'],
  shield_rare_a_glacier: ['glacier_hewn_bulwark', 'shield_rare_a_teal'],
  shield_rare_a_deepice: ['legendary_glacier_hewn_bulwark', 'shield_rare_a_violet'],
  shield_rare_a_dawn: ['templar_dawn_shield', 'shield_rare_a_teal'],
  shield_rare_a_crucible: ['bulwark_of_the_inner_crucible', 'shield_rare_a_violet'],
};
/** The finishes no item draws: world NPCs hold them (manifest.ts NPC_PROP_ATTACH). */
const NPC_ONLY = ['spear_rare_a_teal', 'spear_rare_b_ember'];
/** Shield key -> [arm seat and back carry family, board height, board width]. */
const SHIELDS: Record<string, readonly [string, number, number]> = {
  shield_rare_a_teal: ['Heater_Shield', 1.25, 0.8],
  shield_rare_a_violet: ['Heater_Shield', 1.25, 0.8],
  shield_rare_a_glacier: ['Heater_Shield', 1.25, 0.8],
  shield_rare_a_deepice: ['Heater_Shield', 1.25, 0.8],
  shield_rare_a_dawn: ['Heater_Shield', 1.25, 0.8],
  shield_rare_a_crucible: ['Heater_Shield', 1.25, 0.8],
  shield_rare_b_teal: ['Heater_Shield', 1.2, 1.2],
  shield_rare_b_ember: ['Heater_Shield', 1.2, 1.2],
  shield_rare_b_violet: ['Heater_Shield', 1.2, 1.2],
};
const SHIELD_KEYS = Object.keys(SHIELDS);
const ALL_KEYS = [...WEAPON_KEYS.map(([key]) => key), ...SHIELD_KEYS];

const designOf = (key: string): string | undefined => WEAPON_KEYS.find(([k]) => k === key)?.[1];
/** The file's span along the weapon for one finish. */
const spanOf = (key: string): readonly [number, number] => {
  const stem = designOf(key) ?? '';
  return DESIGNS[stem].spans?.[key.slice(stem.length + 1)] ?? DESIGNS[stem].span;
};
const RARE_KEY =
  /^(sword|dagger|hammer|axe|staff|spear|wand|shield)_rare_[ab]_(teal|ember|violet|jade|spectral|molten|royal|ivory|anvil|frost|bone|obsidian|glacier|deepice|dawn|crucible)$/;
const isRareKey = (key: string): boolean => RARE_KEY.test(key);
/** `models/weapons/<key>.glb` back to its key ('' for no model). */
const keyOf = (url: string | null): string => /([^/]+)\.glb$/.exec(url ?? '')?.[1] ?? '';

interface GlbNode {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
}
interface GlbJson {
  extensionsRequired?: string[];
  scenes: { nodes: number[] }[];
  nodes: GlbNode[];
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  materials: { name?: string }[];
  textures?: { extensions?: Record<string, unknown> }[];
  accessors: { min?: number[]; max?: number[]; normalized?: boolean; componentType: number }[];
}

function readGlb(key: string): GlbJson {
  const buf = readFileSync(`public/${model(key)}`);
  expect(buf.readUInt32LE(0), `${key} magic`).toBe(0x46546c67);
  return JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as GlbJson;
}

type Vec3 = [number, number, number];

function rotate(q: readonly [number, number, number, number], v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  const cx = y * vz - z * vy;
  const cy = z * vx - x * vz;
  const cz = x * vy - y * vx;
  return [
    vx + 2 * (w * cx + (y * cz - z * cy)),
    vy + 2 * (w * cy + (z * cx - x * cz)),
    vz + 2 * (w * cz + (x * cy - y * cx)),
  ];
}

/** The model's bounds in the frame the attach path keeps (under the wrapper node). */
function authoredBounds(key: string): { min: Vec3; max: Vec3 } {
  const json = readGlb(key);
  const inner = json.nodes[json.nodes[json.scenes[0].nodes[0]].children?.[0] ?? -1];
  const accessor = json.accessors[json.meshes[inner.mesh ?? -1].primitives[0].attributes.POSITION];
  // int16, normalized: a stored 32767 is 1.0
  expect(accessor.normalized, `${key} positions`).toBe(true);
  const lo = (accessor.min ?? []).map((n) => n / 32767);
  const hi = (accessor.max ?? []).map((n) => n / 32767);
  const s = inner.scale ?? [1, 1, 1];
  const t = inner.translation ?? [0, 0, 0];
  const q = inner.rotation ?? [0, 0, 0, 1];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const cx of [lo[0], hi[0]]) {
    for (const cy of [lo[1], hi[1]]) {
      for (const cz of [lo[2], hi[2]]) {
        const p = rotate(q, [cx * s[0], cy * s[1], cz * s[2]]);
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], p[i] + t[i]);
          max[i] = Math.max(max[i], p[i] + t[i]);
        }
      }
    }
  }
  return { min, max };
}

/** How long the weapon draws in the right hand, in hand-slot units. */
function drawnLength(key: string): number {
  const { min, max } = authoredBounds(key);
  const family = VARIANT_GRIPS[KAYKIT_WEAPON_ACCESSORY[key]];
  const grip = variantGripTransform(
    max[1] - min[1],
    false,
    family.lift,
    family.maxHeight,
    WEAPON_GRIP_OVERRIDES[key],
  );
  return (max[1] - min[1]) * grip.scale;
}

describe('which items draw the rare set', () => {
  const rareItems = Object.entries(ITEM_WEAPON_VARIANTS).filter(([, key]) => isRareKey(key));

  it('every rare key an item or an NPC names is a shipped finish, and every shipped finish is used', () => {
    const named = new Set(rareItems.map(([, key]) => key));
    for (const key of NPC_ONLY) expect(named.has(key), key).toBe(false);
    expect([...named, ...NPC_ONLY].sort()).toEqual(WEAPON_KEYS.map(([key]) => key).sort());
    // every NPC prop from the set is a shipped finish too
    const npc = Object.values(NPC_PROP_ATTACH)
      .flat()
      .map((att) => keyOf(att.url))
      .filter(isRareKey);
    for (const key of NPC_ONLY) expect(npc, key).toContain(key);
    for (const key of npc) expect(ALL_KEYS, key).toContain(key);
    // + the five-dungeon rework's three epics on the v0.45.0 integration: 48.
    expect(rareItems.length).toBe(48);
    // exactly the finishes in use are shipped: no stray file, none missing
    const onDisk = (dir: string, ext: string): string[] =>
      readdirSync(dir)
        .filter((file) => file.endsWith(ext))
        .map((file) => file.slice(0, -ext.length))
        .filter(isRareKey)
        .sort();
    expect(onDisk('public/models/weapons', '.glb')).toEqual([...ALL_KEYS].sort());
    expect(onDisk('public/ui/weapons', '.jpg')).toEqual(WEAPON_KEYS.map(([key]) => key).sort());
  });

  // Both directions: only epic weapons draw the set, and no epic weapon is left on another
  // model. A Heroic copy has no row of its own and resolves through its base item.
  it('is drawn by every epic weapon of the matching type, and by nothing else', () => {
    for (const [itemId, key] of rareItems) {
      const item = ITEMS[itemId];
      expect(item?.kind, itemId).toBe('weapon');
      expect(item.quality, itemId).toBe('epic');
      expect(weaponTypeForItem(itemId), `${itemId} on ${key}`).toBe(
        DESIGNS[designOf(key) ?? ''].type,
      );
    }
    const weapons = Object.values(ITEMS).filter((item) => item.kind === 'weapon');
    expect(weapons.filter((item) => item.quality === 'epic').length).toBeGreaterThan(40);
    for (const item of weapons) {
      const key = keyOf(itemWeaponModelUrl(item.id));
      expect(isRareKey(key), `${item.id} (${item.quality}) draws ${key}`).toBe(
        item.quality === 'epic',
      );
    }
  });

  it('gives a two-hander a two-hand finish, and a one-hander a one-hand one', () => {
    for (const [itemId, key] of rareItems) {
      const item = ITEMS[itemId];
      if (item.kind !== 'weapon' || DESIGNS[designOf(key) ?? ''].type === 'staff') continue;
      expect(weaponHand(item) === 'twohand', `${itemId} on ${key}`).toBe(key in TWO_HAND);
    }
    // the greatswords, the one two-hand axe and the mauls draw long...
    for (const [key, length] of Object.entries(TWO_HAND)) {
      expect(drawnLength(key), key).toBeCloseTo(length, 2);
    }
    // ...and the same designs in a one-hand finish draw at one-hand length: the maul at its
    // family's limit, the straight sword at the length its file has
    expect(drawnLength('hammer_rare_b_ember')).toBeCloseTo(1.5, 2);
    expect(drawnLength('sword_rare_a_teal')).toBeCloseTo(2.0, 2);
  });

  it('follows the gameplay hand, not the name', () => {
    const hand = (itemId: string): string | undefined => {
      const item = ITEMS[itemId];
      return item.kind === 'weapon' ? weaponHand(item) : undefined;
    };
    // "greatblade" by name, one-hand in play: the saber, not the greatsword
    expect(hand('final_argument_greatblade')).toBe('onehand');
    expect(itemWeaponModelUrl('final_argument_greatblade')).toBe(model('sword_rare_b_violet'));
    // a one-hand warhammer draws the maul at one-hand length, a two-hand maul at full length
    expect(hand('forgefathers_warhammer')).toBe('onehand');
    expect(itemWeaponModelUrl('forgefathers_warhammer')).toBe(model('hammer_rare_b_ember'));
    expect(hand('ridgebreaker')).toBe('twohand');
    expect(itemWeaponModelUrl('ridgebreaker')).toBe(model('hammer_rare_b_violet'));
    // one staff shape for both hands
    expect(hand('lunar_tide_greatstaff')).toBe('onehand');
    expect(hand('nightfangs_greatstaff')).toBe('twohand');
  });

  it('draws one known item per design', () => {
    expect(itemWeaponModelUrl('bonewrought_greatsword')).toBe(model('sword_rare_a_violet'));
    expect(itemWeaponModelUrl('duskforged_warblade')).toBe(model('sword_rare_a_teal'));
    expect(itemWeaponModelUrl('vanguard_oath_blade')).toBe(model('sword_rare_b_ember'));
    expect(itemWeaponModelUrl('duskwhisper')).toBe(model('dagger_rare_a_violet'));
    expect(itemWeaponModelUrl('fang_of_korzul')).toBe(model('dagger_rare_b_violet'));
    expect(itemWeaponModelUrl('springtouched_crozier')).toBe(model('hammer_rare_a_teal'));
    expect(itemWeaponModelUrl('wildsoul_maul')).toBe(model('hammer_rare_b_teal'));
    expect(itemWeaponModelUrl('gravecourt_hewer')).toBe(model('axe_rare_a_violet'));
    expect(itemWeaponModelUrl('forgemaster_crag_cleaver')).toBe(model('axe_rare_b_ember'));
    expect(itemWeaponModelUrl('forgefire_spire')).toBe(model('staff_rare_a_ember'));
    expect(itemWeaponModelUrl('nightfangs_greatstaff')).toBe(model('staff_rare_b_violet'));
    expect(itemWeaponModelUrl('stormcallers_focus')).toBe(model('wand_rare_a_teal'));
    expect(itemWeaponModelUrl('wand_of_quenched_sparks')).toBe(model('wand_rare_b_ember'));
    // a Heroic copy draws its base item's model
    expect(itemWeaponModelUrl('heroic_wyrmfang_greatblade')).toBe(model('sword_rare_a_ember'));
    expect(itemWeaponModelUrl('heroic_duskwhisper')).toBe(model('dagger_rare_a_violet'));
  });

  it('gives every epic shield a rare shield: pointed for the walls, round for the wards', () => {
    const onRare = Object.entries(ITEM_OFFHAND_MODELS)
      .filter(([, key]) => isRareKey(key))
      .sort(([a], [b]) => a.localeCompare(b));
    expect(onRare).toEqual([
      ['bonewrought_bulwark', 'shield_rare_a_teal'],
      ['bulwark_of_the_inner_crucible', 'shield_rare_a_crucible'],
      ['duskforged_bulwark', 'shield_rare_a_violet'],
      ['ember_wardens_barrier', 'shield_rare_b_ember'],
      ['glacier_hewn_bulwark', 'shield_rare_a_glacier'],
      ['legendary_glacier_hewn_bulwark', 'shield_rare_a_deepice'],
      ['legendary_storm_tuned_buckler', 'shield_rare_b_teal'],
      ['storm_tuned_buckler', 'shield_rare_b_teal'],
      ['templar_dawn_shield', 'shield_rare_a_dawn'],
      ['votive_ward_of_the_deathless_court', 'shield_rare_b_violet'],
    ]);
    expect(new Set(onRare.map(([, key]) => key))).toEqual(new Set(SHIELD_KEYS));
    // both directions, as for the weapons: every epic shield, and nothing else
    const shields = Object.values(ITEMS).filter((item) => isShieldItem(item));
    for (const item of shields) {
      const key = keyOf(itemOffhandModelUrl(item.id));
      expect(isRareKey(key), `${item.id} (${item.quality}) draws ${key}`).toBe(
        item.quality === 'epic',
      );
    }
    // a Heroic copy draws its base item's shield
    expect(itemOffhandModelUrl('heroic_bonewrought_bulwark')).toBe(model('shield_rare_a_teal'));
  });

  // Owner review: epic items that shared one finish of a design read as the same weapon. Each
  // named one now draws a finish no other item draws.
  it('gives each epic item that shared a finish a look of its own', () => {
    const drawnBy = new Map<string, string[]>();
    for (const [itemId, key] of [...rareItems, ...Object.entries(ITEM_OFFHAND_MODELS)]) {
      drawnBy.set(key, [...(drawnBy.get(key) ?? []), itemId]);
    }
    expect(Object.keys(REPAINTS)).toHaveLength(13);
    for (const [key, [itemId]] of Object.entries(REPAINTS)) {
      expect(ALL_KEYS, key).toContain(key);
      expect(drawnBy.get(key), key).toEqual([itemId]);
    }
    // the greatswords the owner passed keep the pack finish they wore
    expect(itemWeaponModelUrl('wyrmfang_greatblade')).toBe(model('sword_rare_a_ember'));
    expect(itemWeaponModelUrl('bonewrought_greatsword')).toBe(model('sword_rare_a_violet'));
  });

  it('is in the preload set, keeps its own painted surface, and has a preview', () => {
    const preloaded = new Set(manifestUrls());
    for (const key of ALL_KEYS) {
      expect(preloaded.has(model(key)), `${key} preloaded`).toBe(true);
      expect(isAuthoredHeldModelUrl(model(key)), `${key} authored surface`).toBe(true);
    }
    for (const [key] of WEAPON_KEYS) {
      expect(existsSync(`public/ui/weapons/${key}.jpg`), `${key} preview`).toBe(true);
    }
    // a shield is a flat plate: it draws without the character rim, the weapons with it
    for (const key of SHIELD_KEYS) expect(isRimlessHeldModelUrl(model(key)), key).toBe(true);
    for (const [key] of WEAPON_KEYS) {
      expect(isRimlessHeldModelUrl(model(key)), key).toBe(false);
    }
  });
});

describe('the rare model files', () => {
  it('each is one mesh and one material on a compressed texture, under a wrapper node', () => {
    for (const key of ALL_KEYS) {
      const json = readGlb(key);
      expect(json.meshes.length, key).toBe(1);
      expect(json.materials.length, key).toBe(1);
      expect(json.materials[0].name, key).toBe(key);
      expect(json.extensionsRequired, key).toEqual(
        expect.arrayContaining(['EXT_meshopt_compression', 'KHR_texture_basisu']),
      );
      expect(json.textures?.length, key).toBe(1);
      // The attach path (assets.ts flattenWeaponScene) resets the transform of a scene's
      // only child, so the node that holds the grip offset sits under an identity wrapper.
      expect(json.scenes[0].nodes.length, key).toBe(1);
      const wrapper = json.nodes[json.scenes[0].nodes[0]];
      expect(wrapper.name, key).toBe(key);
      expect(wrapper.translation, `${key} wrapper`).toBeUndefined();
      expect(wrapper.rotation, `${key} wrapper`).toBeUndefined();
      expect(wrapper.scale, `${key} wrapper`).toBeUndefined();
      expect(wrapper.children?.length, key).toBe(1);
      expect(json.nodes[wrapper.children?.[0] ?? -1].mesh, key).toBe(0);
    }
  });

  // The pack shipped 1024 px textures (about 265 KB a file). These are rebuilt from its
  // editable sources at the repo's weapon size, 512 px, with the starter set's compression.
  it('stays small: every file under 120 KB, the set under 4.5 MB', () => {
    let total = 0;
    for (const key of ALL_KEYS) {
      const bytes = statSync(`public/${model(key)}`).size;
      expect(bytes, key).toBeLessThan(120_000);
      total += bytes;
    }
    expect(total).toBeLessThan(4_500_000);
  });

  // A repaint is the pack design itself under new paint: the same mesh, vertex for vertex,
  // so every fit measured on the pack finish holds for it.
  it('builds each repainted finish on the mesh of the pack finish it came from', () => {
    const shape = (key: string): unknown => {
      const json = readGlb(key);
      const inner = json.nodes[json.nodes[json.scenes[0].nodes[0]].children?.[0] ?? -1];
      const prim = json.meshes[inner.mesh ?? -1].primitives[0];
      return {
        node: [inner.translation, inner.rotation, inner.scale],
        attributes: Object.keys(prim.attributes).sort(),
        position: json.accessors[prim.attributes.POSITION],
        uv: json.accessors[prim.attributes.TEXCOORD_0],
      };
    };
    for (const [key, [, from]] of Object.entries(REPAINTS)) {
      expect(shape(key), `${key} against ${from}`).toEqual(shape(from));
    }
  });

  // The two-hand maul finishes are the made maul with bare haft taken out between the grip and
  // the head: nothing below the cut moved, and the head is as wide and as deep as it was.
  it('shortens the haft of the two-hand maul finishes and nothing else about them', () => {
    const made = authoredBounds('hammer_rare_b_ember');
    for (const key of ['hammer_rare_b_teal', 'hammer_rare_b_violet']) {
      const cut = authoredBounds(key);
      expect(cut.min[1], key).toBeCloseTo(made.min[1], 3);
      expect(made.max[1] - cut.max[1], key).toBeCloseTo(0.45, 3);
      for (const axis of [0, 2]) {
        expect(cut.min[axis], key).toBeCloseTo(made.min[axis], 3);
        expect(cut.max[axis], key).toBeCloseTo(made.max[axis], 3);
      }
    }
  });

  it('seats each weapon at its grip, along Y, long hafts turned head-up', () => {
    for (const [key, stem] of WEAPON_KEYS) {
      const design = DESIGNS[stem];
      const { min, max } = authoredBounds(key);
      expect(min[1], `${key} low`).toBeCloseTo(spanOf(key)[0], 2);
      expect(max[1], `${key} high`).toBeCloseTo(spanOf(key)[1], 2);
      expect(max[1] - min[1], key).toBeGreaterThan(max[0] - min[0]);
      expect(min[0] + max[0], key).toBeCloseTo(0, 3);
      // +Y is the end a held weapon hangs low in the carry. A staff's head and a polearm's
      // blade belong up over the shoulder, so those files are turned over about the grip
      // and the hand turns them back.
      const json = readGlb(key);
      const inner = json.nodes[json.nodes[json.scenes[0].nodes[0]].children?.[0] ?? -1];
      if (design.headUp) {
        expect(inner.rotation, key).toEqual([1, 0, 0, 0]);
        expect(WEAPON_GRIP_OVERRIDES[key]?.rot, key).toEqual([180, 0, 0]);
      } else {
        expect(inner.rotation, key).toBeUndefined();
        // no turn in the hand, bar the half turn about the hilt of an edge-up file
        expect(WEAPON_GRIP_OVERRIDES[key]?.rot, key).toEqual(
          design.edgeTurned ? [0, 180, 0] : undefined,
        );
      }
    }
  });

  it('centres each shield on its board, thin along its face', () => {
    for (const [key, [, height, width]] of Object.entries(SHIELDS)) {
      const { min, max } = authoredBounds(key);
      for (let i = 0; i < 3; i++) expect(min[i] + max[i], key).toBeCloseTo(0, 3);
      expect(max[1] - min[1], key).toBeCloseTo(height, 2);
      expect(max[0] - min[0], key).toBeCloseTo(width, 1);
      expect(max[2] - min[2], key).toBeLessThan(0.36);
    }
  });
});

describe('the rare grips', () => {
  it('ride the family seat of their design, hand and back', () => {
    for (const [key, stem] of WEAPON_KEYS) {
      const family = DESIGNS[stem].family;
      expect(KAYKIT_WEAPON_ACCESSORY[key], key).toBe(family);
      expect(VARIANT_GRIPS[family], family).toBeDefined();
      expect(BACK_GRIP_FAMILIES.has(family), family).toBe(true);
    }
    // both shield designs share the heater's arm seat and back carry
    const seats: Record<string, string> = KAYKIT_SHIELD_ACCESSORIES;
    for (const [key, [family]] of Object.entries(SHIELDS)) {
      expect(seats[key], key).toBe(family);
      expect(KAYKIT_WEAPON_ACCESSORY[key], key).toBe(family);
      expect(BACK_GRIP_FAMILIES.has(family), family).toBe(true);
    }
  });

  // Only the two-hand finishes and the daggers carry a scale. Every other finish sits at or
  // under its family clamp and draws at the length its file has, or at the clamp for the maul.
  it('scales the two-hand finishes and the daggers, and nothing else', () => {
    for (const [key, stem] of WEAPON_KEYS) {
      const scaled = WEAPON_GRIP_OVERRIDES[key]?.scale !== undefined;
      expect(scaled, `${key} scale`).toBe(key in TWO_HAND || stem in SIZED);
      if (key in TWO_HAND || stem === 'hammer_rare_b') continue;
      const [low, high] = spanOf(key);
      expect(drawnLength(key), key).toBeCloseTo((high - low) * (SIZED[stem] ?? 1), 2);
    }
    // a dagger is under half a one-hand sword, and a greatsword still the longer sword
    expect(drawnLength('dagger_rare_a_teal')).toBeLessThan(0.5 * drawnLength('sword_rare_a_teal'));
    expect(drawnLength('sword_rare_a_ember')).toBeGreaterThan(drawnLength('sword_rare_a_teal'));
  });
});
