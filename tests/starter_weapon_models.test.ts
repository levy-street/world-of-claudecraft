// The weapons a new character starts with: which model each class's starting kit draws,
// and the shape those model files must keep for the attach path to seat them.
//
// The five starting weapon items and the starting shield resolve through the item tables;
// the hunter's crossbow is the class body's own fixed attach (a hunter's equipped hatchet
// never shows: the body has no weapon swap slot), and so is the open spellbook in the
// warlock's off hand. Every other item keeps the model it had.
import { readFileSync } from 'node:fs';
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
  NPC_PROP_ATTACH,
  VISUALS,
} from '../src/render/characters/manifest';
import { variantGripTransform, WEAPON_GRIP_OVERRIDES } from '../src/render/characters/weapon_grip';
import { CLASSES } from '../src/sim/data';
import { ITEM_WEAPON_VARIANTS } from '../src/ui/weapon_variants';

const model = (key: string): string => `models/weapons/${key}.glb`;

/** What each class holds the moment it is created: [mainhand model, offhand model]. */
const STARTING_KIT: Record<string, [string, string | null]> = {
  warrior: ['sword_starter', 'shield_starter'],
  paladin: ['hammer_starter', 'shield_starter'],
  rogue: ['dagger_starter', 'dagger_starter'],
  shaman: ['hammer_starter', null],
  mage: ['staff_starter', null],
  priest: ['staff_starter', null],
  warlock: ['staff_starter', null],
  druid: ['staff_starter', null],
  // the hatchet is what the hunter CARRIES; what it holds is pinned separately below
  hunter: ['axe_starter', null],
};

const STARTER_MODELS = [
  'sword_starter',
  'dagger_starter',
  'hammer_starter',
  'axe_starter',
  'staff_starter',
  'shield_starter',
  'crossbow_starter',
  'spellbook_starter',
] as const;

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
  materials: unknown[];
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

function rotate(q: [number, number, number, number], v: Vec3): Vec3 {
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

describe('the starting kit', () => {
  it('draws each class its starter models', () => {
    expect(Object.keys(STARTING_KIT).sort()).toEqual(Object.keys(CLASSES).sort());
    for (const [cls, [mainhand, offhand]] of Object.entries(STARTING_KIT)) {
      const def = CLASSES[cls as keyof typeof CLASSES];
      expect(itemWeaponModelUrl(def.startWeapon), `${cls} mainhand`).toBe(model(mainhand));
      expect(
        def.startOffhand ? itemOffhandModelUrl(def.startOffhand) : null,
        `${cls} offhand`,
      ).toBe(offhand ? model(offhand) : null);
    }
  });

  it("holds the starter crossbow on the hunter's body, whatever it has equipped", () => {
    for (const key of ['player_hunter', 'player_hunter_female']) {
      const def = VISUALS[key];
      expect(
        def.attach?.map((a) => a.url),
        key,
      ).toEqual([model('crossbow_starter')]);
      // no swap slot: the equipped hatchet never replaces the crossbow
      expect(def.weaponSlots, key).toBeUndefined();
    }
  });

  it("holds the starter spellbook in the warlock's off hand, open toward the warlock", () => {
    for (const key of ['player_warlock', 'player_warlock_female']) {
      const book = VISUALS[key].attach?.[1];
      expect(book?.url, key).toBe(model('spellbook_starter'));
      expect(book?.bone, key).toBe('handslot.l');
      // Half a turn about the spine: the pages (the model's +Z) face the body, where the
      // left slot's +Z points away from it. With a turn set, the attach path seats the
      // book on the slot itself and reads no rig accessory node (this rig has none).
      expect(book?.rotationY, key).toBe(Math.PI);
      expect(book?.position, key).toBeUndefined();
      expect(book?.gripRef, key).toBeUndefined();
      // a fixed prop: it shows whatever the warlock has equipped
      expect(book?.swapOnly, key).toBeUndefined();
      expect(VISUALS[key].offhandSlot, key).toBeUndefined();
    }
    // the casters whose book slot is a swap-only base keep the kit file there: it never
    // draws, and their class defs feed the mob portrait ledger (a changed file would stale it)
    expect(VISUALS.player_mage.attach?.[1]).toEqual({
      url: model('spellbook_open'),
      bone: 'handslot.l',
      swapOnly: true,
    });
    // an NPC with a tome holds the starter book too, turned the same way, beside a rare staff
    expect(NPC_PROP_ATTACH.tome).toEqual([
      { url: model('staff_rare_b_violet'), bone: 'handslot.r' },
      { url: model('spellbook_starter'), bone: 'handslot.l', rotationY: Math.PI },
    ]);
  });

  it('moves ONLY the starting items: every other item keeps its model', () => {
    const starterItems = Object.entries(ITEM_WEAPON_VARIANTS)
      .filter(([, variant]) => variant.endsWith('_starter'))
      .map(([id]) => id)
      .sort();
    expect(starterItems).toEqual([
      'gnarled_staff',
      'rusty_dagger',
      'rusty_hatchet',
      'training_mace',
      'worn_sword',
    ]);
    const starterShields = Object.entries(ITEM_OFFHAND_MODELS)
      .filter(([, key]) => key === 'shield_starter')
      .map(([id]) => id);
    // ...and the one rare buckler: a rare item draws a common shape (the set one rarity
    // down), and the starting buckler is the only round common shield
    expect(starterShields.sort()).toEqual(['eastbrook_buckler', 'rare_storm_tuned_buckler']);
    // the common knives and staves that once shared the old starter models draw the
    // field set (tests/field_weapon_models.test.ts), never a starter model
    expect(itemWeaponModelUrl('vale_carving_knife')).toBe(model('dagger_field_steel'));
    expect(itemWeaponModelUrl('hickory_shortstaff')).toBe(model('staff_field_steel'));
    expect(itemWeaponModelUrl('bronzework_mace')).toBe(model('hammer_field_bronze'));
    expect(itemWeaponModelUrl('copper_bearded_axe')).toBe(model('axe_field_bronze'));
    // the epic buckler draws the rare set's round shield, never the starter one
    expect(itemOffhandModelUrl('storm_tuned_buckler')).toBe(model('shield_rare_b_teal'));
    // and an NPC with a crossbow holds the starter one (there is no rare crossbow)
    expect(NPC_PROP_ATTACH.crossbow.map((a) => a.url)).toEqual([model('crossbow_starter')]);
  });

  // A flat plate takes the character rim over its whole face when it turns edge-on to the
  // camera (the purple-grey film the owner saw on the shield's inner face), so the two plate
  // models draw without it. The rounded and narrow ones keep their silhouette rim.
  it('draws the two flat plates, the shield and the open book, without the rim', () => {
    const rimless = STARTER_MODELS.filter((key) => isRimlessHeldModelUrl(model(key)));
    expect(rimless).toEqual(['shield_starter', 'spellbook_starter']);
    // the kit shield and book are not part of the rule, nor is anything outside the folder
    expect(isRimlessHeldModelUrl(model('shield_round'))).toBe(false);
    expect(isRimlessHeldModelUrl(model('spellbook_open'))).toBe(false);
    expect(isRimlessHeldModelUrl('models/chars/npc_gear/shield_starter.glb')).toBe(false);
  });

  it('is in the preload set and keeps its own painted surface', () => {
    const preloaded = new Set(manifestUrls());
    for (const key of STARTER_MODELS) {
      expect(preloaded.has(model(key)), `${key} preloaded`).toBe(true);
      expect(isAuthoredHeldModelUrl(model(key)), `${key} authored surface`).toBe(true);
    }
  });
});

describe('the starter model files', () => {
  it('each is one mesh and one material on a compressed texture', () => {
    for (const key of STARTER_MODELS) {
      const json = readGlb(key);
      expect(json.meshes.length, key).toBe(1);
      expect(json.materials.length, key).toBe(1);
      expect(json.extensionsRequired, key).toEqual(
        expect.arrayContaining(['EXT_meshopt_compression', 'KHR_texture_basisu']),
      );
      for (const texture of json.textures ?? []) {
        expect(Object.keys(texture.extensions ?? {}), key).toContain('KHR_texture_basisu');
      }
    }
  });

  // The attach path (assets.ts flattenWeaponScene) resets the transform of a scene's only
  // child. A model whose offset sat on that child would lose it and hang from its bounding
  // box centre, so each of these files carries one identity wrapper above the node that
  // holds the offset.
  it('each keeps its offset under an identity wrapper, where the attach path cannot reset it', () => {
    for (const key of STARTER_MODELS) {
      // the crossbow's and the spellbook's top nodes are pinned in the cases below
      if (key === 'crossbow_starter' || key === 'spellbook_starter') continue;
      const json = readGlb(key);
      expect(json.scenes[0].nodes.length, key).toBe(1);
      const wrapper = json.nodes[json.scenes[0].nodes[0]];
      expect(wrapper.translation, `${key} wrapper`).toBeUndefined();
      expect(wrapper.rotation, `${key} wrapper`).toBeUndefined();
      expect(wrapper.scale, `${key} wrapper`).toBeUndefined();
      expect(wrapper.mesh, `${key} wrapper`).toBeUndefined();
      expect(wrapper.children?.length, key).toBe(1);
      expect(json.nodes[wrapper.children?.[0] ?? -1].mesh, key).toBe(0);
    }
  });

  // The crossbow takes the old default crossbow's seat, and two readers place it. The game
  // resets the top node and applies the 1H_Crossbow grip. The wiki viewer
  // (src/guide/viewer/model.ts) adds a held model to the bone exactly as the file has it, so
  // the top node must carry the old crossbow's own offset and scale or the wiki draws this
  // one three times the size and off the hand. The layout turn sits one node lower, where
  // the game's reset cannot reach it.
  it("gives the crossbow the old default crossbow's top transform, with its turn below", () => {
    const next = readGlb('crossbow_starter');
    const old = readGlb('crossbow_1handed');
    const top = next.nodes[next.scenes[0].nodes[0]];
    const oldTop = old.nodes[old.scenes[0].nodes[0]];
    expect(oldTop.translation).toBeDefined();
    expect(top.translation).toEqual(oldTop.translation);
    expect(top.scale).toEqual(oldTop.scale);
    expect(top.rotation).toBeUndefined();
    const inner = next.nodes[top.children?.[0] ?? -1];
    expect(inner.mesh).toBe(0);
    expect(inner.translation).toBeUndefined();
    expect(inner.scale).toBeUndefined();
    // half a turn about the (0, 1, 1) diagonal: the upright model's bolt (+Y) onto +Z
    expect(inner.rotation?.[0]).toBeCloseTo(0, 6);
    expect(inner.rotation?.[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(inner.rotation?.[2]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(inner.rotation?.[3]).toBeCloseTo(0, 6);
  });

  it('seats each hand weapon at its grip: the origin sits low on the handle, tip up', () => {
    // [lowest point under the grip, highest point above it], along the weapon
    const expected: Record<string, [number, number]> = {
      sword_starter: [-0.36, 1.64],
      dagger_starter: [-0.24, 1.04],
      hammer_starter: [-0.36, 1.04],
      axe_starter: [-0.38, 1.07],
      // The staff is the one turned over: +Y is the end a held weapon points at the
      // ground and hangs low in the carry, and a staff's crooked head belongs UP, so
      // its long head end runs along -Y and the short butt along +Y.
      staff_starter: [-1.37, 0.91],
    };
    for (const [key, [low, high]] of Object.entries(expected)) {
      const { min, max } = authoredBounds(key);
      expect(min[1], `${key} low`).toBeCloseTo(low, 2);
      expect(max[1], `${key} high`).toBeCloseTo(high, 2);
      // the weapon runs along Y
      expect(max[1] - min[1], key).toBeGreaterThan(max[0] - min[0]);
      expect(max[1] - min[1], key).toBeGreaterThan(max[2] - min[2]);
    }
    // and a blade's broad face lies across X (the mace and the staff are round)
    for (const key of ['sword_starter', 'dagger_starter', 'axe_starter']) {
      const { min, max } = authoredBounds(key);
      expect(max[0] - min[0], key).toBeGreaterThan(1.5 * (max[2] - min[2]));
    }
  });

  it('seats the shield at its rear handle, off the centre of the disc', () => {
    const { min, max } = authoredBounds('shield_starter');
    const centre = [0, 1, 2].map((i) => (min[i] + max[i]) / 2);
    expect(centre[0]).toBeCloseTo(0.08, 2);
    expect(centre[1]).toBeCloseTo(0.24, 2);
    expect(centre[2]).toBeCloseTo(0.03, 2);
    // a disc 0.82 across, thin along Z (its face)
    expect(max[0] - min[0]).toBeCloseTo(0.82, 1);
    expect(max[2] - min[2]).toBeLessThan(0.25);
  });

  it('lays the crossbow out like the KayKit crossbow whose seat it takes', () => {
    // bolt along Z, centred, half a length = one unit: the layout the 1H_Crossbow hand
    // grip, the aim clips and the across-the-shoulders carry were all tuned for
    const { min, max } = authoredBounds('crossbow_starter');
    expect(min[2]).toBeCloseTo(-1, 3);
    expect(max[2]).toBeCloseTo(1, 3);
    expect((min[0] + max[0]) / 2).toBeCloseTo(0, 3);
    expect((min[1] + max[1]) / 2).toBeCloseTo(0, 3);
    // limbs across X, the thin axis up
    expect(max[0] - min[0]).toBeGreaterThan(max[1] - min[1]);
  });
});

describe('the starter spellbook file', () => {
  // The book takes the open kit book's seat with no table row of its own, so it has to BE
  // that book's shape: one uniformly scaled node (the attach path keeps a top node's scale
  // and drops the rest), the spread across X at the full +-1 of the quantized mesh, upright
  // along Y, and the same height.
  it("matches the open kit book's layout and size, so it needs no seat of its own", () => {
    const next = readGlb('spellbook_starter');
    const old = readGlb('spellbook_open');
    for (const [name, json] of [
      ['starter', next],
      ['kit', old],
    ] as const) {
      expect(json.nodes.length, name).toBe(1);
      expect(json.nodes[0].mesh, name).toBe(0);
      expect(json.nodes[0].rotation, name).toBeUndefined();
    }
    expect(next.nodes[0].translation).toBeUndefined();
    const scaleOf = (json: GlbJson): number => json.nodes[0].scale?.[0] ?? 1;
    const boxOf = (json: GlbJson): { min: number[]; max: number[] } => {
      const accessor = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
      expect(accessor.normalized).toBe(true);
      const s = scaleOf(json);
      return {
        min: (accessor.min ?? []).map((n) => (n / 32767) * s),
        max: (accessor.max ?? []).map((n) => (n / 32767) * s),
      };
    };
    const a = boxOf(next);
    const b = boxOf(old);
    const size = (box: { min: number[]; max: number[] }, i: number): number =>
      box.max[i] - box.min[i];
    // the same height (the pack states 0.569) and spread, within two percent
    expect(size(a, 1)).toBeCloseTo(0.569, 2);
    expect(size(a, 1) / size(b, 1)).toBeGreaterThan(0.98);
    expect(size(a, 1) / size(b, 1)).toBeLessThan(1.02);
    expect(size(a, 0) / size(b, 0)).toBeGreaterThan(0.98);
    expect(size(a, 0) / size(b, 0)).toBeLessThan(1.02);
    // the spread is the widest axis and the book is centred on its hand point
    expect(size(a, 0)).toBeGreaterThan(size(a, 1));
    expect(size(a, 1)).toBeGreaterThan(size(a, 2));
    for (const i of [0, 1, 2]) expect(a.min[i] + a.max[i]).toBeCloseTo(0, 6);
  });
});

describe('the starter grips', () => {
  it('ride the family seats the old starters rode', () => {
    expect(KAYKIT_WEAPON_ACCESSORY.sword_starter).toBe('VAR_SWORD');
    expect(KAYKIT_WEAPON_ACCESSORY.dagger_starter).toBe('VAR_DAGGER');
    expect(KAYKIT_WEAPON_ACCESSORY.hammer_starter).toBe('VAR_MACE');
    expect(KAYKIT_WEAPON_ACCESSORY.axe_starter).toBe('VAR_AXE');
    expect(KAYKIT_WEAPON_ACCESSORY.staff_starter).toBe('VAR_STAFF');
    expect(KAYKIT_WEAPON_ACCESSORY.crossbow_starter).toBe('1H_Crossbow');
    for (const family of ['VAR_SWORD', 'VAR_DAGGER', 'VAR_MACE', 'VAR_AXE', 'VAR_STAFF']) {
      expect(VARIANT_GRIPS[family], family).toBeDefined();
      expect(BACK_GRIP_FAMILIES.has(family), family).toBe(true);
    }
    expect(BACK_GRIP_FAMILIES.has('1H_Crossbow')).toBe(true);
  });

  it('give the shield a hand seat and a carry of its own', () => {
    expect(KAYKIT_SHIELD_ACCESSORIES.shield_starter).toBe('Starter_Shield');
    expect(KAYKIT_WEAPON_ACCESSORY.shield_starter).toBe('Starter_Shield');
    const seat = KAYKIT_SHIELD_GRIPS.Starter_Shield;
    // shipped at world size, so the seat does not rescale it
    expect(seat.l.scale).toBe(1);
    expect(seat.r.scale).toBe(1);
    expect(BACK_GRIP_FAMILIES.has('Starter_Shield')).toBe(true);
  });

  // The shield's origin is its handle, which sits off the disc's centre. Seated with no
  // turn, the disc hung forward of the fist and off the arm. The seat rolls it about its
  // face so the disc lies ALONG the forearm: this pins where the disc's centre lands in
  // each hand slot's own frame (the forearm directions were read off the WOC rig).
  it("lay the shield's disc along the forearm, not out past the fist", () => {
    const { min, max } = authoredBounds('shield_starter');
    const centre: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const forearm = { l: [0.859, -0.511], r: [-0.869, -0.495] } as const;
    const forearmLength = 0.47; // hand to elbow, in slot units
    for (const side of ['l', 'r'] as const) {
      const seat = KAYKIT_SHIELD_GRIPS.Starter_Shield[side];
      // a pure roll about the face normal: the face keeps pointing out along +Z
      expect(seat.quaternion[0], side).toBe(0);
      expect(seat.quaternion[1], side).toBe(0);
      const turned = rotate(seat.quaternion, centre);
      const at = [seat.position[0] + turned[0], seat.position[1] + turned[1]];
      const along = at[0] * forearm[side][0] + at[1] * forearm[side][1];
      const across = Math.abs(at[0] * forearm[side][1] - at[1] * forearm[side][0]);
      // up the arm from the fist, short of the elbow, and on the arm's line
      expect(along, `${side} along the forearm`).toBeGreaterThan(0.1);
      expect(along, `${side} along the forearm`).toBeLessThan(forearmLength * 0.6);
      expect(across, `${side} off the forearm`).toBeLessThan(0.03);
      // stood off the arm, face outward, far enough to clear a plate gauntlet (at 0.05 the
      // male warrior's and paladin's came through the face; 0.09 was the first clean value)
      expect(seat.position[2], side).toBeGreaterThanOrEqual(0.09);
      expect(seat.position[2], side).toBeLessThan(0.15);
    }
  });

  // The staff's FILE is head-up about the grip, which is what the carry draws (crook over
  // the shoulder). In the hand the crook is the front end: the hand alone turns it back.
  it('point the crook forward in the hand and leave it up in the carry', () => {
    const { min, max } = authoredBounds('staff_starter');
    // the file: the long head end runs along -Y
    expect(Math.abs(min[1])).toBeGreaterThan(max[1]);
    expect(WEAPON_GRIP_OVERRIDES.staff_starter).toEqual({ rot: [180, 0, 0], pos: [0, -0.34, 0] });
    const grip = variantGripTransform(
      max[1] - min[1],
      false,
      VARIANT_GRIPS.VAR_STAFF.lift,
      VARIANT_GRIPS.VAR_STAFF.maxHeight,
      WEAPON_GRIP_OVERRIDES.staff_starter,
    );
    // +Y of the slot is where a held blade points (forward and down in the idle hold)
    const head = rotate(grip.quaternion, [0, -1, 0]);
    expect(head[0]).toBeCloseTo(0, 6);
    expect(head[1]).toBeCloseTo(1, 6);
    expect(head[2]).toBeCloseTo(0, 6);
    // not shrunk by the family clamp
    expect(grip.scale).toBe(1);
  });
});
