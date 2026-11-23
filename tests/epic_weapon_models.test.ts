// The epic set: one design per named weapon line, each in up to three painted finishes, plus
// two shield designs. Which items draw them, the shape their files must keep for the attach
// path to seat them, and the fit each design takes.
//
// A weapon draws the set one rarity below its own, so LEGENDARY items draw this one (the two
// forge legendaries keep the models made for them). There are few legendary weapons, so most
// of the set's finishes are drawn by nothing yet. Common, uncommon and rare weapons draw the
// field set (tests/field_weapon_models.test.ts), epic weapons the rare set
// (tests/rare_weapon_models.test.ts).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KAYKIT_WEAPON_ACCESSORY, VARIANT_GRIPS } from '../src/render/characters/assets';
import { BACK_GRIP_FAMILIES } from '../src/render/characters/back_grips';
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

interface EpicDesign {
  /** Gameplay weapon type of every item that may draw this design. */
  type: string;
  /** Grip family the design rides in the hand and on the back. */
  family: string;
  /** Painted finishes in the game (every finish is used by an item). */
  looks: readonly string[];
  /** [lowest point under the grip, highest point above it] along the weapon, in the file. */
  span: readonly [number, number];
  /** The file is longer than its family's clamp, and a per-model scale gives the length back. */
  scaled?: true;
  /** The file is turned head-up about the grip (the carry reads the file); the hand turns
   *  it back. */
  headUp?: true;
  /** The owner's sizing pass: the design draws at this fraction of the length its file has. */
  sized?: number;
  /** The file curls its point to the side a hand holds DOWN; the hand gives it a half turn
   *  about the hilt (tests/pack_weapon_hand_seat.test.ts measures which way a point falls). */
  pointTurned?: true;
}

/** Every greatsword draws a tenth under the length it was made (the field and rare ones are
 *  2.15 where they were 2.4): the owner's sizing pass. An epic dagger draws at 0.85, less
 *  of a cut than the other daggers' 0.7, because its hilt is barely a fist long. */
const GREATSWORD_SIZE = 2.15 / 2.4;

const DESIGNS: Record<string, EpicDesign> = {
  // the three greatswords: two-hand length on the one-hand sword family
  sword_epic_ossuary: {
    type: 'sword',
    family: 'VAR_SWORD',
    looks: ['ivory_amethyst', 'wyrm_teal'],
    span: [-0.55, 1.95],
    scaled: true,
    sized: GREATSWORD_SIZE,
  },
  sword_epic_tusk: {
    type: 'sword',
    family: 'VAR_SWORD',
    looks: ['ivory_jade', 'predator_steel'],
    span: [-0.49, 1.96],
    scaled: true,
    sized: GREATSWORD_SIZE,
  },
  sword_epic_deathless: {
    type: 'sword',
    family: 'VAR_SWORD',
    looks: ['spectral_teal', 'crucible_heart'],
    span: [-0.51, 2.04],
    scaled: true,
    sized: GREATSWORD_SIZE,
  },
  dagger_epic_dragonfang: {
    type: 'dagger',
    family: 'VAR_DAGGER',
    looks: ['ivory_violet', 'basin_jade', 'moonlit_pearl'],
    span: [-0.322, 0.828],
    pointTurned: true,
    sized: 0.85,
  },
  dagger_epic_marrow: {
    type: 'dagger',
    family: 'VAR_DAGGER',
    looks: ['ivory_amber'],
    span: [-0.319, 0.781],
    sized: 0.85,
  },
  dagger_epic_cinder: {
    type: 'dagger',
    family: 'VAR_DAGGER',
    looks: ['coal_ember'],
    span: [-0.302, 0.818],
    sized: 0.85,
  },
  // the two-hand maul
  hammer_epic_wildwood: {
    type: 'mace',
    family: 'VAR_HAMMER',
    looks: ['living_forest', 'scorched_resin'],
    span: [-0.594, 1.606],
    scaled: true,
  },
  // the one-hand crozier
  hammer_epic_spring: {
    type: 'mace',
    family: 'VAR_MACE',
    looks: ['verdant_ivory'],
    span: [-0.42, 1.03],
  },
  // a one-hand axe made a tenth longer than the axe clamp
  axe_epic_gravecleaver: {
    type: 'axe',
    family: 'VAR_AXE',
    looks: ['fossil_gravegreen', 'slag_ember'],
    span: [-0.429, 1.221],
    scaled: true,
  },
  staff_epic_gravewyrm: {
    type: 'staff',
    family: 'VAR_STAFF',
    looks: ['bone_emerald'],
    span: [-1.449, 0.851],
    headUp: true,
  },
  staff_epic_moonfang: {
    type: 'staff',
    family: 'VAR_STAFF',
    looks: ['bone_moon', 'lunar_tide'],
    span: [-1.574, 0.776],
    headUp: true,
  },
  staff_epic_hexwood: {
    type: 'staff',
    family: 'VAR_STAFF',
    looks: ['basin_turquoise', 'last_spring'],
    span: [-1.495, 0.805],
    headUp: true,
  },
  wand_epic_deathless: {
    type: 'wand',
    family: 'VAR_WAND',
    looks: ['royal_amethyst', 'storm_crystal', 'quenched_ember'],
    span: [-0.333, 0.816],
  },
};

/** Every held weapon key of the set, with the design it belongs to. */
const WEAPON_KEYS: [string, string][] = Object.entries(DESIGNS).flatMap(([stem, design]) =>
  design.looks.map((look): [string, string] => [`${stem}_${look}`, stem]),
);
/** Shield key -> [arm seat and back carry family, board height, board width]. */
const SHIELDS: Record<string, readonly [string, number, number]> = {
  shield_epic_votive_bone_votive: ['Heater_Shield', 1.2, 1.0],
  shield_epic_votive_ember_warden: ['Heater_Shield', 1.2, 1.0],
  shield_epic_crucible_heat_blue_iron: ['Tower_Shield', 1.5, 0.77],
};
const SHIELD_KEYS = Object.keys(SHIELDS);
const ALL_KEYS = [...WEAPON_KEYS.map(([key]) => key), ...SHIELD_KEYS];

const designOf = (key: string): string | undefined => WEAPON_KEYS.find(([k]) => k === key)?.[1];
const EPIC_KEY = /^(sword|dagger|hammer|axe|staff|wand|shield)_epic_[a-z]+(_[a-z]+)+$/;
const isEpicKey = (key: string): boolean => EPIC_KEY.test(key);
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

describe('which items draw the epic set', () => {
  const epicItems = Object.entries(ITEM_WEAPON_VARIANTS).filter(([, key]) => isEpicKey(key));
  /** The finishes an item draws. The rest of the set is in the tree and drawn by nothing
   *  yet: the owner is choosing what they go on. */
  const USED = [
    'dagger_epic_dragonfang_ivory_violet',
    'staff_epic_hexwood_basin_turquoise',
    'sword_epic_deathless_crucible_heart',
  ];

  it('is drawn by the three legendary weapons that are not forge legendaries', () => {
    expect(epicItems.sort(([a], [b]) => a.localeCompare(b))).toEqual([
      ['deathless_heartwood', 'staff_epic_hexwood_basin_turquoise'],
      ['kingsbane_last_oath', 'sword_epic_deathless_crucible_heart'],
      ['voidsong_dirk', 'dagger_epic_dragonfang_ivory_violet'],
    ]);
    expect(epicItems.map(([, key]) => key).sort()).toEqual(USED);
    // every finish of the set is a file, used or not: no stray file, none missing
    const onDisk = (dir: string, ext: string): string[] =>
      readdirSync(dir)
        .filter((file) => file.endsWith(ext))
        .map((file) => file.slice(0, -ext.length))
        .filter(isEpicKey)
        .sort();
    expect(onDisk('public/models/weapons', '.glb')).toEqual([...ALL_KEYS].sort());
    expect(onDisk('public/ui/weapons', '.jpg')).toEqual(WEAPON_KEYS.map(([key]) => key).sort());
    for (const key of USED) expect(ALL_KEYS, key).toContain(key);
  });

  // A weapon draws the set one rarity below its own, so only a legendary draws this one.
  // A Heroic copy has no row of its own and resolves through its base item.
  it('is drawn only by legendary weapons of the matching type', () => {
    for (const [itemId, key] of epicItems) {
      const item = ITEMS[itemId];
      expect(item?.kind, itemId).toBe('weapon');
      expect(item.quality, itemId).toBe('legendary');
      expect(item.heroicOf, `${itemId} has its own row`).toBeUndefined();
      expect(weaponTypeForItem(itemId), `${itemId} on ${key}`).toBe(
        DESIGNS[designOf(key) ?? ''].type,
      );
    }
    for (const item of Object.values(ITEMS)) {
      if (item.kind !== 'weapon' || item.quality === 'legendary') continue;
      const key = keyOf(itemWeaponModelUrl(item.id));
      expect(isEpicKey(key), `${item.id} (${item.quality}) draws ${key}`).toBe(false);
    }
  });

  // The two Ignivar forge legendaries were designed on their own and keep those models.
  it('leaves the forge legendaries on the models made for them', () => {
    const legendary = Object.values(ITEMS)
      .filter((item) => item.quality === 'legendary' && !item.heroicOf)
      .filter((item) => item.kind === 'weapon' || isShieldItem(item))
      .map((item) => [item.id, keyOf(itemWeaponModelUrl(item.id) ?? itemOffhandModelUrl(item.id))])
      .sort(([a], [b]) => a.localeCompare(b));
    expect(legendary).toEqual([
      ['deathless_heartwood', 'staff_epic_hexwood_basin_turquoise'],
      ['kingsbane_last_oath', 'sword_epic_deathless_crucible_heart'],
      ['varkhul_emberward', 'varkhul_emberward'],
      ['varkhul_forgebreaker', 'hammer_varkhul'],
      ['voidsong_dirk', 'dagger_epic_dragonfang_ivory_violet'],
    ]);
  });

  it('follows the gameplay hand, not the shape', () => {
    // a one-hand legendary sword draws a greatsword design at one-hand length: its finish
    // carries no scale, so the sword family's limit holds it
    const kingsbane = ITEMS.kingsbane_last_oath;
    expect(kingsbane.kind === 'weapon' ? weaponHand(kingsbane) : undefined).toBe('onehand');
    expect(WEAPON_GRIP_OVERRIDES.sword_epic_deathless_crucible_heart?.scale).toBeUndefined();
    expect(drawnLength('sword_epic_deathless_crucible_heart')).toBeCloseTo(2.0, 2);
    // the same design's other finish draws at two-hand length (made 2.55, a tenth under it
    // after the sizing pass)
    expect(drawnLength('sword_epic_deathless_spectral_teal')).toBeCloseTo(
      2.55 * GREATSWORD_SIZE,
      2,
    );
  });

  it("gives a Heroic copy its base item's model", () => {
    expect(itemWeaponModelUrl('heroic_deathless_heartwood')).toBe(
      model('staff_epic_hexwood_basin_turquoise'),
    );
    expect(itemWeaponModelUrl('heroic_kingsbane_last_oath')).toBe(
      model('sword_epic_deathless_crucible_heart'),
    );
  });

  it('gives no item an epic shield yet', () => {
    expect(Object.entries(ITEM_OFFHAND_MODELS).filter(([, key]) => isEpicKey(key))).toEqual([]);
  });

  it('preloads only the finishes in use, and keeps every painted surface and preview', () => {
    const preloaded = new Set(manifestUrls());
    for (const key of ALL_KEYS) {
      // a finish nothing draws is never downloaded
      expect(preloaded.has(model(key)), `${key} preloaded`).toBe(USED.includes(key));
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

describe('the epic model files', () => {
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

  // The pack shipped 1024 px textures (about 300 KB a file). These are rebuilt from its
  // editable sources at the repo's weapon size, 512 px, with the starter set's compression.
  it('stays small: every file under 120 KB, the set under 3 MB', () => {
    let total = 0;
    for (const key of ALL_KEYS) {
      const bytes = statSync(`public/${model(key)}`).size;
      expect(bytes, key).toBeLessThan(120_000);
      total += bytes;
    }
    expect(total).toBeLessThan(3_000_000);
  });

  it('seats each weapon at its grip, along Y, staves turned head-up', () => {
    for (const [key, stem] of WEAPON_KEYS) {
      const design = DESIGNS[stem];
      const { min, max } = authoredBounds(key);
      expect(min[1], `${key} low`).toBeCloseTo(design.span[0], 2);
      expect(max[1], `${key} high`).toBeCloseTo(design.span[1], 2);
      expect(max[1] - min[1], key).toBeGreaterThan(max[0] - min[0]);
      expect(min[0] + max[0], key).toBeCloseTo(0, 3);
      // +Y is the end a held weapon hangs low in the carry. A staff's head belongs up over
      // the shoulder, so those files are turned over about the grip and the hand turns
      // them back.
      const json = readGlb(key);
      const inner = json.nodes[json.nodes[json.scenes[0].nodes[0]].children?.[0] ?? -1];
      if (design.headUp) {
        expect(inner.rotation, key).toEqual([1, 0, 0, 0]);
        expect(WEAPON_GRIP_OVERRIDES[key]?.rot, key).toEqual([180, 0, 0]);
      } else {
        expect(inner.rotation, key).toBeUndefined();
        // no turn in the hand, bar the half turn about the hilt of a point-down file
        expect(WEAPON_GRIP_OVERRIDES[key]?.rot, key).toEqual(
          design.pointTurned ? [0, 180, 0] : undefined,
        );
      }
    }
  });

  it('centres each shield on its board, thin along its face', () => {
    for (const [key, [, height, width]] of Object.entries(SHIELDS)) {
      const { min, max } = authoredBounds(key);
      for (let i = 0; i < 3; i++) expect(min[i] + max[i], key).toBeCloseTo(0, 3);
      expect(max[1] - min[1], key).toBeCloseTo(height, 2);
      expect(max[0] - min[0], key).toBeCloseTo(width, 2);
      expect(max[2] - min[2], key).toBeLessThan(0.35);
    }
  });
});

describe('the epic grips', () => {
  it('ride the family seat of their design, hand and back', () => {
    for (const [key, stem] of WEAPON_KEYS) {
      const family = DESIGNS[stem].family;
      expect(KAYKIT_WEAPON_ACCESSORY[key], key).toBe(family);
      expect(VARIANT_GRIPS[family], family).toBeDefined();
      expect(BACK_GRIP_FAMILIES.has(family), family).toBe(true);
    }
    // the round shield shares the heater's arm seat and back carry; the tower shield has
    // its own, set lower for its taller board
    const seats: Record<string, string> = KAYKIT_SHIELD_ACCESSORIES;
    for (const [key, [family]] of Object.entries(SHIELDS)) {
      expect(seats[key], key).toBe(family);
      expect(KAYKIT_WEAPON_ACCESSORY[key], key).toBe(family);
      expect(KAYKIT_SHIELD_GRIPS[family], family).toBeDefined();
      expect(BACK_GRIP_FAMILIES.has(family), family).toBe(true);
    }
  });

  // The tower shield takes the heater's seat (tests/field_weapon_models.test.ts): the same
  // roll, set in the battle stance, face flat to the arm, the same stand-off from it. Only
  // where its middle sits along the arm differs: lower than the heater's by what its board
  // is taller.
  it('seat the tower shield like the heater, lower by what its board is taller', () => {
    const forearm = { l: [0.859, -0.511], r: [-0.869, -0.495] } as const;
    const { min, max } = authoredBounds('shield_epic_crucible_heat_blue_iron');
    const heater = authoredBounds('shield_field_steel');
    const taller = (max[1] - min[1] - (heater.max[1] - heater.min[1])) / 2;
    expect(taller).toBeCloseTo(0.15, 2);
    for (const side of ['l', 'r'] as const) {
      const tower = KAYKIT_SHIELD_GRIPS.Tower_Shield[side];
      const base = KAYKIT_SHIELD_GRIPS.Heater_Shield[side];
      expect(tower.quaternion, side).toEqual(base.quaternion);
      expect(tower.scale, side).toBe(1);
      const up = (p: readonly number[]): number =>
        p[0] * forearm[side][0] + p[1] * forearm[side][1];
      expect(up(base.position) - up(tower.position), `${side} middle`).toBeCloseTo(taller, 2);
      // on the arm's line, and the same stand-off from the arm
      const across = tower.position[0] * forearm[side][1] - tower.position[1] * forearm[side][0];
      expect(Math.abs(across), `${side} off the forearm`).toBeLessThan(0.01);
      expect(tower.position[2], side).toBeCloseTo(base.position[2], 6);
    }
  });

  // A design longer than its family's clamp carries a scale that sets its length against the
  // clamp; every other design sits at or under the clamp. It draws at the length its file
  // has, or the fraction of it the owner's sizing pass set. The one exception is the finish
  // a one-hand legendary draws (above).
  it('draws every design at the length it was made, or the size the owner set', () => {
    const ONE_HAND_FINISH = 'sword_epic_deathless_crucible_heart';
    for (const [key, stem] of WEAPON_KEYS) {
      const design = DESIGNS[stem];
      const [low, high] = design.span;
      const clamp = VARIANT_GRIPS[design.family].maxHeight;
      expect(high - low > clamp, `${key} over its clamp`).toBe(design.scaled === true);
      if (key === ONE_HAND_FINISH) continue;
      expect(WEAPON_GRIP_OVERRIDES[key]?.scale !== undefined, `${key} scale`).toBe(
        design.scaled === true || design.sized !== undefined,
      );
      expect(drawnLength(key), key).toBeCloseTo((high - low) * (design.sized ?? 1), 2);
    }
  });
});
