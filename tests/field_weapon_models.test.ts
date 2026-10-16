// The plain "field" weapons: ten shapes (one-hand sword, greatsword, dagger, one-hand mace,
// maul, axe, staff, spear, wand, heater shield) in up to three painted looks (iron, steel,
// bronze). Which items draw them, the shape their files must keep for the attach path to
// seat them, and the fit each family takes in the hand and on the back.
//
// A weapon draws the set one rarity below its own, so common, uncommon AND rare items draw
// this one: a rare weapon is a common shape in another paint. The starting items keep their
// own starter models (tests/starter_weapon_models.test.ts), epic weapons draw the rare set
// (tests/rare_weapon_models.test.ts) and legendary weapons the epic set
// (tests/epic_weapon_models.test.ts).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KAYKIT_WEAPON_ACCESSORY, VARIANT_GRIPS } from '../src/render/characters/assets';
import { BACK_GRIP_FAMILIES, backGripFor } from '../src/render/characters/back_grips';
import {
  KAYKIT_SHIELD_ACCESSORIES,
  KAYKIT_SHIELD_GRIPS,
} from '../src/render/characters/held_item_grips';
import {
  ITEM_OFFHAND_MODELS,
  isAuthoredHeldModelUrl,
  isRimlessHeldModelUrl,
  itemOffhandModelUrl,
  itemWeaponModelUrl,
  manifestUrls,
} from '../src/render/characters/manifest';
import { variantGripTransform, WEAPON_GRIP_OVERRIDES } from '../src/render/characters/weapon_grip';
import { weaponTypeForItem } from '../src/sim/content/weapon_skin_rules';
import { ITEMS } from '../src/sim/data';
import { isShieldItem, weaponHand } from '../src/sim/equipment_rules';
import { ITEM_WEAPON_VARIANTS } from '../src/ui/weapon_variants';

const model = (key: string): string => `models/weapons/${key}.glb`;

interface FieldShape {
  /** Gameplay weapon type of every item that may draw this shape. */
  type: string;
  /** Grip family the shape rides in the hand and on the back. */
  family: string;
  /** Painted looks shipped for the shape (only the looks an item uses are in the game). */
  looks: readonly string[];
  /** [lowest point under the grip, highest point above it] along the weapon, in the file. */
  span: readonly [number, number];
  /** A two-hander: only two-hand items draw it, and no two-hand item of its type draws
   *  the one-hand sibling. */
  twoHand?: true;
  /** The file is turned head-up about the grip (the carry reads the file); the hand turns
   *  it back. */
  headUp?: true;
  /** The owner's sizing pass: the shape looked too big for the hand at the length its file
   *  has, and draws at this fraction of it. */
  sized?: number;
}

/** A greatsword draws 2.15 long, whatever its file's length (the field one is made 2.4). */
const GREATSWORD = 2.15;

const SHAPES: Record<string, FieldShape> = {
  sword_field: {
    type: 'sword',
    family: 'VAR_SWORD',
    looks: ['iron', 'steel', 'bronze'],
    span: [-0.36, 1.64],
  },
  sword_field_2h: {
    type: 'sword',
    family: 'VAR_SWORD',
    looks: ['iron', 'steel'],
    span: [-0.528, 1.872],
    twoHand: true,
    sized: GREATSWORD / 2.4,
  },
  dagger_field: {
    type: 'dagger',
    family: 'VAR_DAGGER',
    looks: ['iron', 'steel', 'bronze'],
    span: [-0.243, 1.037],
    sized: 0.7,
  },
  hammer_field: {
    type: 'mace',
    family: 'VAR_MACE',
    looks: ['iron', 'steel', 'bronze'],
    span: [-0.364, 1.036],
  },
  // the maul: made 2.2 long, its bare haft shortened by 0.45 (owner: handle too long)
  hammer_field_2h: {
    type: 'mace',
    family: 'VAR_HAMMER',
    looks: ['iron', 'steel'],
    span: [-0.616, 1.134],
    twoHand: true,
    sized: 0.9,
  },
  axe_field: {
    type: 'axe',
    family: 'VAR_AXE',
    looks: ['iron', 'steel', 'bronze'],
    span: [-0.377, 1.073],
  },
  staff_field: {
    type: 'staff',
    family: 'VAR_STAFF',
    looks: ['iron', 'steel', 'bronze'],
    span: [-1.368, 0.912],
    headUp: true,
  },
  spear_field: {
    type: 'polearm',
    family: 'VAR_POLEARM',
    looks: ['iron'],
    span: [-1.625, 0.875],
    twoHand: true,
    headUp: true,
  },
  wand_field: { type: 'wand', family: 'VAR_WAND', looks: ['iron', 'steel'], span: [-0.294, 0.796] },
};

/** Every held weapon key of the set, with the shape it belongs to. */
const WEAPON_KEYS: [string, string][] = Object.entries(SHAPES).flatMap(([stem, shape]) =>
  shape.looks.map((look): [string, string] => [`${stem}_${look}`, stem]),
);
const SHIELD_KEY = 'shield_field_steel';
const ALL_KEYS = [...WEAPON_KEYS.map(([key]) => key), SHIELD_KEY];

const shapeOf = (key: string): string | undefined => WEAPON_KEYS.find(([k]) => k === key)?.[1];
/** A field model key: `<type>_field[_2h]_<look>`. Deliberately not a bare `_field_` test:
 *  the Armory skin model `iron_field_hammer` is no part of this set. */
const FIELD_KEY =
  /^(sword|dagger|hammer|axe|staff|spear|wand|shield)_field(_2h)?_(iron|steel|bronze)$/;
const isFieldKey = (key: string): boolean => FIELD_KEY.test(key);
/** `models/weapons/<key>.glb` back to its key ('' for no model). */
const keyOf = (url: string | null): string => /([^/]+)\.glb$/.exec(url ?? '')?.[1] ?? '';
/** Common and uncommon gear (an item with no quality reads as common). */
const isPlain = (quality: string | undefined): boolean =>
  quality === undefined || quality === 'poor' || quality === 'common' || quality === 'uncommon';
/** The qualities that draw this set: a weapon draws the set one rarity below its own. */
const drawsPlain = (quality: string | undefined): boolean => isPlain(quality) || quality === 'rare';

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
  const jsonLength = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8')) as GlbJson;
}

type Vec3 = [number, number, number];

function rotate(q: readonly [number, number, number, number], v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  // v + 2w(q x v) + 2 q x (q x v)
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
  expect(accessor.componentType).toBe(5122);
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

/** The hand transform the attach path gives a variant weapon (right hand). */
function handGrip(key: string): ReturnType<typeof variantGripTransform> {
  const { min, max } = authoredBounds(key);
  const family = VARIANT_GRIPS[KAYKIT_WEAPON_ACCESSORY[key]];
  return variantGripTransform(
    max[1] - min[1],
    false,
    family.lift,
    family.maxHeight,
    WEAPON_GRIP_OVERRIDES[key],
  );
}

/** How long the weapon draws in the hand, in hand-slot units. */
function drawnLength(key: string): number {
  const { min, max } = authoredBounds(key);
  return (max[1] - min[1]) * handGrip(key).scale;
}

describe('which items draw the field weapons', () => {
  const fieldItems = Object.entries(ITEM_WEAPON_VARIANTS).filter(([, key]) => isFieldKey(key));

  it('every field key an item names is a shipped look, and every shipped look is used', () => {
    const named = new Set(fieldItems.map(([, key]) => key));
    expect([...named].sort()).toEqual(WEAPON_KEYS.map(([key]) => key).sort());
    // how many items share each look: the looks spread the paint over a level band
    const counts: Record<string, number> = {};
    for (const [, key] of fieldItems) counts[key] = (counts[key] ?? 0) + 1;
    expect(counts).toEqual({
      sword_field_iron: 5,
      sword_field_steel: 9,
      sword_field_bronze: 3,
      sword_field_2h_iron: 1,
      sword_field_2h_steel: 1,
      dagger_field_iron: 10,
      dagger_field_steel: 9,
      dagger_field_bronze: 8,
      hammer_field_iron: 1,
      hammer_field_steel: 5,
      hammer_field_bronze: 5,
      hammer_field_2h_iron: 2,
      hammer_field_2h_steel: 1,
      axe_field_iron: 4,
      axe_field_steel: 3,
      axe_field_bronze: 4,
      staff_field_iron: 8,
      staff_field_steel: 7,
      staff_field_bronze: 5,
      spear_field_iron: 4,
      wand_field_iron: 4,
      wand_field_steel: 3,
    });
    // 49 common and uncommon weapons, and the 42 rare ones; 53 rare on the v0.45.0
    // integration with the five-dungeon rework's eleven (placeholder finishes).
    expect(fieldItems.length).toBe(102);
  });

  it('only common, uncommon and rare weapons of the matching type draw one', () => {
    for (const [itemId, key] of fieldItems) {
      const item = ITEMS[itemId];
      const shape = SHAPES[shapeOf(key) ?? ''];
      expect(item?.kind, itemId).toBe('weapon');
      expect(drawsPlain(item.quality), `${itemId} is ${item.quality}`).toBe(true);
      expect(weaponTypeForItem(itemId), `${itemId} on ${key}`).toBe(shape.type);
    }
    // and nothing epic or better was pulled onto the plain set, a Heroic copy included
    // (it resolves through its base item)
    const better = Object.values(ITEMS).filter(
      (item) => item.kind === 'weapon' && !drawsPlain(item.quality),
    );
    expect(better.length).toBeGreaterThan(50);
    for (const item of better) {
      const key = keyOf(itemWeaponModelUrl(item.id));
      expect(isFieldKey(key), `${item.id} (${item.quality}) on ${key}`).toBe(false);
      expect(key.endsWith('_starter'), `${item.id} (${item.quality}) on ${key}`).toBe(false);
    }
  });

  // The other direction: no common, uncommon or rare weapon is left behind on another
  // model. A new one takes a field look (or a starter model, for a starting item).
  it('every common, uncommon or rare weapon and shield draws a field or starter model', () => {
    const rares = Object.values(ITEMS).filter((item) => item.quality === 'rare');
    for (const item of rares.filter((r) => r.kind === 'weapon')) {
      const key = keyOf(itemWeaponModelUrl(item.id));
      expect(isFieldKey(key), `${item.id} (rare) draws ${key}`).toBe(true);
    }
    // the rare shields: the walls take the heater, the buckler the starting buckler
    expect(
      rares
        .filter((item) => isShieldItem(item))
        .map((item) => [item.id, keyOf(itemOffhandModelUrl(item.id))])
        .sort(),
    ).toEqual([
      ['pearlward_aegis', SHIELD_KEY],
      ['rare_glacier_hewn_bulwark', SHIELD_KEY],
      ['rare_storm_tuned_buckler', 'shield_starter'],
    ]);
    const plain = Object.values(ITEMS).filter((item) => isPlain(item.quality));
    const weapons = plain.filter((item) => item.kind === 'weapon');
    expect(weapons.length).toBeGreaterThan(40);
    for (const item of weapons) {
      const key = keyOf(itemWeaponModelUrl(item.id));
      expect(isFieldKey(key) || key.endsWith('_starter'), `${item.id} draws ${key}`).toBe(true);
    }
    const shields = plain.filter((item) => isShieldItem(item));
    expect(shields.map((item) => item.id).sort()).toEqual([
      'eastbrook_buckler',
      'highwatch_wallshield',
    ]);
    expect(keyOf(itemOffhandModelUrl('eastbrook_buckler'))).toBe('shield_starter');
    expect(keyOf(itemOffhandModelUrl('highwatch_wallshield'))).toBe(SHIELD_KEY);
  });

  // The looks only vary the paint, but a weapon named for a metal should not wear another
  // one (copper has no look of its own; bronze is the nearest).
  it('gives an item named for a metal the look of that metal', () => {
    const lookFor: Record<string, string> = {
      iron: 'iron',
      steel: 'steel',
      bronze: 'bronze',
      copper: 'bronze',
    };
    const named = fieldItems.filter(([id]) => /iron|steel|bronze|copper/.test(id));
    expect(named.length).toBeGreaterThan(8);
    for (const [itemId, key] of named) {
      const metal = /iron|steel|bronze|copper/.exec(itemId)?.[0] ?? '';
      expect(key.endsWith(`_${lookFor[metal]}`), `${itemId} on ${key}`).toBe(true);
    }
  });

  it('gives a two-hand sword or maul the long shape, and a one-hander the short one', () => {
    for (const [itemId, key] of fieldItems) {
      const item = ITEMS[itemId];
      if (item.kind !== 'weapon') continue;
      const stem = shapeOf(key) ?? '';
      const twoHand = weaponHand(item) === 'twohand';
      // the spear is the one polearm shape: a one-hand polearm (two rare ones) draws it too
      if (SHAPES[stem].twoHand && SHAPES[stem].type !== 'polearm') {
        expect(twoHand, `${itemId} on ${key}`).toBe(true);
      }
      // a staff has one shape for both hands; the sword and the mace have two
      if (stem === 'sword_field' || stem === 'hammer_field') {
        expect(twoHand, `${itemId} on ${key}`).toBe(false);
      }
    }
  });

  it('follows the gameplay hand, not the name, for the three misnamed one-handers', () => {
    // "maul", "spade" and a saber once on the greatsword model: all three are one-hand items
    for (const itemId of ['bristleback_maul', 'tunnelkings_spade', 'moonscale_saber']) {
      const item = ITEMS[itemId];
      expect(item.kind === 'weapon' && weaponHand(item), itemId).toBe('onehand');
    }
    expect(itemWeaponModelUrl('bristleback_maul')).toBe(model('hammer_field_steel'));
    expect(itemWeaponModelUrl('tunnelkings_spade')).toBe(model('axe_field_iron'));
    expect(itemWeaponModelUrl('moonscale_saber')).toBe(model('sword_field_steel'));
    // and the one two-hand staff shares the staff shape
    const briarroot = ITEMS.briarroot_staff;
    expect(briarroot.kind === 'weapon' && weaponHand(briarroot)).toBe('twohand');
    expect(itemWeaponModelUrl('briarroot_staff')).toBe(model('staff_field_bronze'));
  });

  it('draws one known item per shape', () => {
    expect(itemWeaponModelUrl('eastbrook_arming_sword')).toBe(model('sword_field_steel'));
    expect(itemWeaponModelUrl('eastbrook_greatsword')).toBe(model('sword_field_2h_iron'));
    expect(itemWeaponModelUrl('highwatch_greatsword')).toBe(model('sword_field_2h_steel'));
    expect(itemWeaponModelUrl('icevein_dirk')).toBe(model('dagger_field_iron'));
    expect(itemWeaponModelUrl('bogiron_mace')).toBe(model('hammer_field_iron'));
    expect(itemWeaponModelUrl('ironshod_maul')).toBe(model('hammer_field_2h_iron'));
    expect(itemWeaponModelUrl('fenshadow_maul')).toBe(model('hammer_field_2h_steel'));
    expect(itemWeaponModelUrl('gorraks_cleaver')).toBe(model('axe_field_steel'));
    expect(itemWeaponModelUrl('craghorn_staff')).toBe(model('staff_field_iron'));
    expect(itemWeaponModelUrl('ironbark_boar_spear')).toBe(model('spear_field_iron'));
    expect(itemWeaponModelUrl('palecoil_rod')).toBe(model('wand_field_iron'));
    expect(itemWeaponModelUrl('corpse_candle_focus')).toBe(model('wand_field_steel'));
  });

  it('gives the common and rare wall shields the heater, and no epic shield', () => {
    expect(itemOffhandModelUrl('highwatch_wallshield')).toBe(model(SHIELD_KEY));
    const onHeater = Object.entries(ITEM_OFFHAND_MODELS)
      .filter(([, key]) => key === SHIELD_KEY)
      .map(([id]) => id)
      .sort();
    expect(onHeater).toEqual([
      'highwatch_wallshield',
      'pearlward_aegis',
      'rare_glacier_hewn_bulwark',
    ]);
    expect(ITEMS.highwatch_wallshield.quality).toBe('common');
    // the starting buckler keeps the starter shield; the crafted epic bulwark draws the
    // rare set's pointed shield
    expect(itemOffhandModelUrl('eastbrook_buckler')).toBe(model('shield_starter'));
    expect(itemOffhandModelUrl('duskforged_bulwark')).toBe(model('shield_rare_a_violet'));
  });

  // One rarity up, the next set: an epic weapon draws the rare set, a legendary one the
  // epic set, and the forge legendaries the models made for them.
  it('leaves the epic and legendary weapons to the sets above it', () => {
    expect(itemWeaponModelUrl('duskforged_warblade')).toBe(model('sword_rare_a_teal'));
    expect(itemWeaponModelUrl('forgemaster_crag_cleaver')).toBe(model('axe_rare_b_ember'));
    expect(itemWeaponModelUrl('kingsbane_last_oath')).toBe(
      model('sword_epic_deathless_crucible_heart'),
    );
    expect(itemWeaponModelUrl('varkhul_forgebreaker')).toBe(model('hammer_varkhul'));
  });

  it('is in the preload set, keeps its own painted surface, and has a preview', () => {
    const preloaded = new Set(manifestUrls());
    // exactly the looks an item uses are shipped: no stray look file, none missing
    const onDisk = (dir: string, ext: string): string[] =>
      readdirSync(dir)
        .filter((file) => file.endsWith(ext))
        .map((file) => file.slice(0, -ext.length))
        .filter(isFieldKey)
        .sort();
    expect(onDisk('public/models/weapons', '.glb')).toEqual([...ALL_KEYS].sort());
    expect(onDisk('public/ui/weapons', '.jpg')).toEqual(WEAPON_KEYS.map(([key]) => key).sort());
    for (const key of ALL_KEYS) {
      expect(existsSync(`public/${model(key)}`), `${key} file`).toBe(true);
      expect(preloaded.has(model(key)), `${key} preloaded`).toBe(true);
      expect(isAuthoredHeldModelUrl(model(key)), `${key} authored surface`).toBe(true);
    }
    // every weapon variant key ships the preview the armory and pipeline tools list
    for (const [key] of WEAPON_KEYS) {
      expect(existsSync(`public/ui/weapons/${key}.jpg`), `${key} preview`).toBe(true);
    }
  });

  // A flat plate takes the character rim over its whole face when it turns edge-on to the
  // camera (the purple-grey film found on the starter shield), so the heater draws without
  // it. The weapons are narrow or rounded and keep their silhouette rim.
  it('draws the heater shield without the rim, and every weapon with it', () => {
    expect(isRimlessHeldModelUrl(model(SHIELD_KEY))).toBe(true);
    for (const [key] of WEAPON_KEYS) {
      expect(isRimlessHeldModelUrl(model(key)), key).toBe(false);
    }
  });
});

describe('the field model files', () => {
  it('each is one mesh and one material on a compressed texture', () => {
    for (const key of ALL_KEYS) {
      const json = readGlb(key);
      expect(json.meshes.length, key).toBe(1);
      expect(json.materials.length, key).toBe(1);
      expect(json.materials[0].name, key).toBe(key);
      expect(json.extensionsRequired, key).toEqual(
        expect.arrayContaining(['EXT_meshopt_compression', 'KHR_texture_basisu']),
      );
      expect(json.textures?.length, key).toBe(1);
      for (const texture of json.textures ?? []) {
        expect(Object.keys(texture.extensions ?? {}), key).toContain('KHR_texture_basisu');
      }
    }
  });

  // The whole set loads before the world opens. The pack shipped 1024 px textures (about
  // 210 KB a file); these are rebuilt from its editable sources at the repo's weapon size,
  // 512 px, with the starter set's compression. A file swapped back for a pack original, or
  // re-exported without meshopt or KTX2, shows here.
  it('stays small: every file under 120 KB, the set under 2 MB', () => {
    let total = 0;
    for (const key of ALL_KEYS) {
      const bytes = statSync(`public/${model(key)}`).size;
      expect(bytes, key).toBeLessThan(120_000);
      total += bytes;
    }
    expect(total).toBeLessThan(2_000_000);
  });

  // The attach path (assets.ts flattenWeaponScene) resets the transform of a scene's only
  // child. A model whose offset sat on that child would lose it and hang from its bounding
  // box centre, so each of these files carries one identity wrapper above the node that
  // holds the offset.
  it('each keeps its offset under an identity wrapper, where the attach path cannot reset it', () => {
    for (const key of ALL_KEYS) {
      const json = readGlb(key);
      expect(json.scenes[0].nodes.length, key).toBe(1);
      const wrapper = json.nodes[json.scenes[0].nodes[0]];
      expect(wrapper.name, key).toBe(key);
      expect(wrapper.translation, `${key} wrapper`).toBeUndefined();
      expect(wrapper.rotation, `${key} wrapper`).toBeUndefined();
      expect(wrapper.scale, `${key} wrapper`).toBeUndefined();
      expect(wrapper.mesh, `${key} wrapper`).toBeUndefined();
      expect(wrapper.children?.length, key).toBe(1);
      expect(json.nodes[wrapper.children?.[0] ?? -1].mesh, key).toBe(0);
    }
  });

  it('seats each weapon at its grip: the origin sits on the handle, the weapon along Y', () => {
    for (const [key, stem] of WEAPON_KEYS) {
      const [low, high] = SHAPES[stem].span;
      const { min, max } = authoredBounds(key);
      expect(min[1], `${key} low`).toBeCloseTo(low, 2);
      expect(max[1], `${key} high`).toBeCloseTo(high, 2);
      expect(max[1] - min[1], key).toBeGreaterThan(max[0] - min[0]);
      expect(max[1] - min[1], key).toBeGreaterThan(max[2] - min[2]);
      // centred on its own axis
      expect(min[0] + max[0], key).toBeCloseTo(0, 3);
      expect(min[2] + max[2], key).toBeCloseTo(0, 3);
    }
    // a blade's broad face lies across X
    for (const key of [
      'sword_field_iron',
      'sword_field_2h_iron',
      'dagger_field_iron',
      'axe_field_iron',
    ]) {
      const { min, max } = authoredBounds(key);
      expect(max[0] - min[0], key).toBeGreaterThan(1.5 * (max[2] - min[2]));
    }
  });

  // +Y is the end a held weapon points at the ground and hangs low in the carry (a blade's
  // tip). A staff's head and a spear's point belong UP over the shoulder, so those files
  // are turned over about the grip: the long head end runs along -Y.
  it('turns the long hafts head-up in the file, and no other shape', () => {
    for (const [key, stem] of WEAPON_KEYS) {
      const { min, max } = authoredBounds(key);
      // the long end from the grip is the head; turned over, it runs along -Y
      const longEndAlongMinusY = Math.abs(min[1]) > max[1];
      expect(longEndAlongMinusY, key).toBe(SHAPES[stem].headUp === true);
      const json = readGlb(key);
      const inner = json.nodes[json.nodes[json.scenes[0].nodes[0]].children?.[0] ?? -1];
      expect(inner.mesh, key).toBe(0);
      if (SHAPES[stem].headUp) expect(inner.rotation, key).toEqual([1, 0, 0, 0]);
      else expect(inner.rotation, key).toBeUndefined();
    }
  });

  it('gives every look of a shape the same geometry: only the paint differs', () => {
    for (const [stem, shape] of Object.entries(SHAPES)) {
      const first = authoredBounds(`${stem}_${shape.looks[0]}`);
      for (const look of shape.looks.slice(1)) {
        const other = authoredBounds(`${stem}_${look}`);
        for (let i = 0; i < 3; i++) {
          expect(other.min[i], `${stem}_${look}`).toBeCloseTo(first.min[i], 5);
          expect(other.max[i], `${stem}_${look}`).toBeCloseTo(first.max[i], 5);
        }
      }
    }
  });

  it('centres the heater shield on its board: taller than wide, thin along its face', () => {
    const { min, max } = authoredBounds(SHIELD_KEY);
    for (let i = 0; i < 3; i++) expect(min[i] + max[i]).toBeCloseTo(0, 3);
    expect(max[1] - min[1]).toBeCloseTo(1.2, 2);
    expect(max[0] - min[0]).toBeCloseTo(0.73, 2);
    expect(max[2] - min[2]).toBeLessThan(0.35);
  });
});

describe('the field grips', () => {
  it('ride the family seat of their shape, hand and back', () => {
    for (const [key, stem] of WEAPON_KEYS) {
      const family = SHAPES[stem].family;
      expect(KAYKIT_WEAPON_ACCESSORY[key], key).toBe(family);
      expect(VARIANT_GRIPS[family], family).toBeDefined();
      expect(BACK_GRIP_FAMILIES.has(family), family).toBe(true);
    }
  });

  // The family clamp only ever shrinks, to stop a long blade dragging. The one-hand shapes
  // sit under their clamps. The greatsword and the maul ride one-hand families, whose
  // clamps would cut them to one-hand length, so each carries a scale that hands back
  // exactly the length its file has. The owner's sizing pass then took three shapes down
  // from that (they looked too big for the hand): the dagger, the greatsword and the maul.
  it('draws every shape at the length its file has, or the size the owner set', () => {
    for (const [key, stem] of WEAPON_KEYS) {
      const [low, high] = SHAPES[stem].span;
      expect(drawnLength(key), key).toBeCloseTo((high - low) * (SHAPES[stem].sized ?? 1), 2);
    }
    expect(drawnLength('sword_field_2h_iron')).toBeCloseTo(GREATSWORD, 2);
    expect(drawnLength('dagger_field_iron')).toBeCloseTo(0.896, 2);
    expect(drawnLength('hammer_field_2h_iron')).toBeCloseTo(1.575, 2);
    // a scale is carried by the two shapes over their clamp (without one the clamp would
    // bind) and by the ones the sizing pass took down, and by nothing else
    for (const [key, stem] of WEAPON_KEYS) {
      const [low, high] = SHAPES[stem].span;
      const over = high - low > VARIANT_GRIPS[SHAPES[stem].family].maxHeight + 1e-6;
      expect(over, key).toBe(stem === 'sword_field_2h' || stem === 'hammer_field_2h');
      expect(WEAPON_GRIP_OVERRIDES[key]?.scale !== undefined, `${key} scale`).toBe(
        over || SHAPES[stem].sized !== undefined,
      );
    }
  });

  // What "fits the hand" came to, against the body: a WOC body is 2.14 hand-slot units tall.
  it('sizes a dagger under half a sword and a greatsword to the body, not past it', () => {
    const BODY = 2.14;
    expect(drawnLength('dagger_field_iron')).toBeLessThan(0.5 * drawnLength('sword_field_iron'));
    expect(drawnLength('dagger_field_iron') / BODY).toBeLessThan(0.45);
    expect(drawnLength('sword_field_2h_iron') / BODY).toBeLessThan(1.01);
  });

  it('keeps each two-hander longer than its one-hand sibling', () => {
    // after the sizing pass the greatsword is the longer by its hilt more than its blade
    expect(drawnLength('sword_field_2h_iron')).toBeGreaterThan(
      1.05 * drawnLength('sword_field_iron'),
    );
    // the maul's haft was shortened on the owner's review: it stays the longer of the two,
    // and its head is the big one (three times the one-hand mace head across)
    expect(drawnLength('hammer_field_2h_iron')).toBeGreaterThan(
      1.1 * drawnLength('hammer_field_iron'),
    );
    const across = (key: string): number => {
      const { min, max } = authoredBounds(key);
      return max[0] - min[0];
    };
    expect(across('hammer_field_2h_iron')).toBeGreaterThan(1.8 * across('hammer_field_iron'));
    expect(drawnLength('spear_field_iron')).toBeGreaterThan(drawnLength('staff_field_iron'));
  });

  // In the hand the head is the front end (the owner's call on the starter staff): the
  // hand alone turns the head-up file back, so the carry keeps the head over the shoulder.
  it('points a staff head and a spear point forward in the hand', () => {
    for (const [key, stem] of WEAPON_KEYS) {
      const override = WEAPON_GRIP_OVERRIDES[key];
      if (!SHAPES[stem].headUp) {
        expect(override?.rot, key).toBeUndefined();
        continue;
      }
      expect(override, key).toEqual({ rot: [180, 0, 0] });
      // +Y of the slot is where a held blade points (forward and down in the idle hold)
      const head = rotate(handGrip(key).quaternion, [0, -1, 0]);
      expect(head[0], key).toBeCloseTo(0, 6);
      expect(head[1], key).toBeCloseTo(1, 6);
      expect(head[2], key).toBeCloseTo(0, 6);
    }
  });

  it('give the heater shield a hand seat and a carry of its own', () => {
    expect(KAYKIT_SHIELD_ACCESSORIES[SHIELD_KEY]).toBe('Heater_Shield');
    expect(KAYKIT_WEAPON_ACCESSORY[SHIELD_KEY]).toBe('Heater_Shield');
    const seat = KAYKIT_SHIELD_GRIPS.Heater_Shield;
    // shipped at world size, so the seat does not rescale it
    expect(seat.l.scale).toBe(1);
    expect(seat.r.scale).toBe(1);
    expect(BACK_GRIP_FAMILIES.has('Heater_Shield')).toBe(true);
  });

  // A shield has an up, and the pose that decides it is the battle stance, where the shield
  // is presented in front of the body: there it stands straight up and down. The roll about
  // the face points the board's top at world up in that stance. Up was read off the WOC rig
  // in the shield hand's own frame (the same on the male and female bodies, and on the
  // warrior and the paladin); the forearm directions the same way, in the idle hold.
  it("stand the heater straight up and down in the battle stance, clear of the arm's armor", () => {
    /** World up in the left slot's frame in the battle stance, as measured: its part in
     *  the plane of the board, normalised. The right slot is the mirror. */
    const stanceUp = { l: [-0.157, 0.988], r: [0.157, 0.988] } as const;
    const forearm = { l: [0.859, -0.511], r: [-0.869, -0.495] } as const;
    for (const side of ['l', 'r'] as const) {
      const seat = KAYKIT_SHIELD_GRIPS.Heater_Shield[side];
      // a pure roll about the face normal: the face keeps pointing straight out along +Z,
      // flat to the arm in every pose
      expect(seat.quaternion[0], side).toBe(0);
      expect(seat.quaternion[1], side).toBe(0);
      const face = rotate(seat.quaternion, [0, 0, 1]);
      expect(face[2], side).toBeCloseTo(1, 6);
      // the shield's top lies along up in the battle stance, within two degrees
      const top = rotate(seat.quaternion, [0, 1, 0]);
      const cos = top[0] * stanceUp[side][0] + top[1] * stanceUp[side][1];
      expect(cos, `${side} top up in the stance`).toBeGreaterThan(Math.cos((2 * Math.PI) / 180));
      // ...which is NOT up the forearm: in the idle hold the arm hangs the other way up and
      // the board hangs with its top low. That pose is the accepted consequence, not a fit.
      const [ux, uy] = forearm[side];
      expect(top[0] * ux + top[1] * uy, `${side} top against the idle forearm`).toBeLessThan(0);
      // its middle sits a little up the arm from the hand, on the arm's line
      const up = seat.position[0] * ux + seat.position[1] * uy;
      const across = Math.abs(seat.position[0] * uy - seat.position[1] * ux);
      expect(up, `${side} along the forearm`).toBeGreaterThan(0);
      expect(across, `${side} off the forearm`).toBeLessThan(0.01);
      // stood off the arm far enough to clear a plate vambrace (0.10 let one through the
      // face, 0.12 was the first clean value)
      expect(seat.position[2], side).toBeGreaterThanOrEqual(0.12);
      expect(seat.position[2], side).toBeLessThan(0.16);
    }
    // the two rows mirror each other
    const { l, r } = KAYKIT_SHIELD_GRIPS.Heater_Shield;
    expect(r.quaternion[2]).toBeCloseTo(-l.quaternion[2], 6);
    expect(r.quaternion[3]).toBeCloseTo(l.quaternion[3], 6);
  });

  // A sheathed one-hander lies UNDER the shield. At the kit shields' distance off the spine
  // a stowed staff, axe or mace came through the board's face (measured on the live rig:
  // 0.11 past the staff's own carry was the first distance none of ten models crossed).
  it('carry the heater flat on the back, point down, over a sheathed one-hander', () => {
    for (const side of ['l', 'r'] as const) {
      const carry = backGripFor('Heater_Shield', side);
      // half a turn about the spine: the face points backward, the top stays up
      const face = rotate(carry.quaternion, [0, 0, 1]);
      const top = rotate(carry.quaternion, [0, 1, 0]);
      expect(face[2], side).toBeCloseTo(-1, 6);
      expect(top[1], side).toBeCloseTo(1, 6);
      // centred on the spine
      expect(carry.position[0], side).toBeCloseTo(0, 6);
      // lower than the kit rectangle's carry: the tall board's top edge sits at the
      // shoulder line instead of across the back of the head
      expect(carry.position[1], side).toBeLessThan(
        backGripFor('Rectangle_Shield', side).position[1],
      );
      // and well clear of every one-hand carry on the upper back, the staff's (the
      // farthest out) included
      for (const family of ['VAR_SWORD', 'VAR_AXE', 'VAR_MACE', 'VAR_HAMMER', 'VAR_STAFF']) {
        expect(carry.position[2], `${side} over ${family}`).toBeLessThanOrEqual(
          backGripFor(family, 'r').position[2] - 0.11,
        );
      }
      // without drifting off into the air behind the character
      expect(carry.position[2], side).toBeGreaterThan(-0.46);
    }
  });
});
