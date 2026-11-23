// The field weapons through the REAL attach path (assets.ts setHeldWeapon / setHeldOffhand ->
// attachProp -> flattenWeaponScene -> the grip pass -> the back carry), with only the loader
// stubbed. Each stub is rebuilt from the shipped file's own node tree (its wrapper, its inner
// node's offset, turn and scale, and a box the size of its mesh), so what is measured here is
// where the real file lands in the hand and on the back.
//
// tests/field_weapon_models.test.ts pins the tables and the files apart; this is the link
// between them: the grip survives the attach path, a two-hander keeps its length in the hand
// AND in the carry, a long haft leads with its head in the hand and carries it up, and the
// shield takes its own seat and carry.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backGripFor } from '../src/render/characters/back_grips';
import { KAYKIT_SHIELD_GRIPS } from '../src/render/characters/held_item_grips';

vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn((start: () => unknown) => start()),
}));

interface GlbNode {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
}
interface GlbJson {
  scenes: { nodes: number[] }[];
  nodes: GlbNode[];
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  accessors: { min?: number[]; max?: number[] }[];
}

function readGlb(url: string): GlbJson {
  const buf = readFileSync(`public/${url}`);
  return JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as GlbJson;
}

/** The file's node tree as three objects, each mesh a box the size of its bounds (the shipped
 *  positions are normalized int16: a stored 32767 is 1.0). `unwrapped` drops the top node, as
 *  the pack's files were before intake. */
function sceneOf(url: string, unwrapped = false): THREE.Group {
  const json = readGlb(url);
  const build = (index: number): THREE.Object3D => {
    const node = json.nodes[index];
    let object: THREE.Object3D;
    if (node.mesh !== undefined) {
      const accessor = json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION];
      const lo = (accessor.min ?? []).map((n) => n / 32767);
      const hi = (accessor.max ?? []).map((n) => n / 32767);
      const box = new THREE.BoxGeometry(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
      box.translate((hi[0] + lo[0]) / 2, (hi[1] + lo[1]) / 2, (hi[2] + lo[2]) / 2);
      object = new THREE.Mesh(
        box,
        new THREE.MeshStandardMaterial({ map: new THREE.Texture(), roughness: 0.9, metalness: 0 }),
      );
    } else {
      object = new THREE.Group();
    }
    object.name = node.name ?? '';
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
    for (const child of node.children ?? []) object.add(build(child));
    return object;
  };
  const scene = new THREE.Group();
  for (const index of json.scenes[0].nodes) {
    const top = build(index);
    if (unwrapped && top.children.length === 1) scene.add(top.children[0]);
    else scene.add(top);
  }
  return scene;
}

/** A plain box for every model this suite does not measure. */
const anyBox = (): THREE.Group => {
  const scene = new THREE.Group();
  scene.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 0.1),
      new THREE.MeshStandardMaterial({ map: new THREE.Texture() }),
    ),
  );
  return scene;
};

const isField = (url: string): boolean =>
  /^models\/weapons\/[a-z]+_field(_2h)?_(iron|steel|bronze)\.glb$/.test(url);

/** Bounds of a mounted prop in its bone's frame (the stub bones sit at the origin, unturned). */
function boundsOf(holder: THREE.Object3D): THREE.Box3 {
  holder.parent?.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(holder);
}

async function loadAssets(unwrapped: ReadonlySet<string> = new Set()) {
  vi.resetModules();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn((url: string) =>
      Promise.resolve({
        scene: isField(url) ? sceneOf(url, unwrapped.has(url)) : anyBox(),
        animations: [],
      }),
    ),
    loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    releaseGltf: vi.fn(),
  }));
  const assets = await import('../src/render/characters/assets');
  const { VISUALS } = await import('../src/render/characters/manifest');
  await assets.charactersReady();
  // the three bones the attach path asks a rig for: both hand slots and the carry bone
  const root = new THREE.Group();
  for (const name of ['handslotl', 'handslotr', 'chest']) {
    const bone = new THREE.Object3D();
    bone.name = name;
    root.add(bone);
  }
  return { assets, def: VISUALS.player_warrior, root };
}

afterEach(() => {
  vi.doUnmock('../src/render/assets/loader');
  vi.resetModules();
});

/** The size a greatsword draws at against the 2.4 its file has (the owner's sizing pass). */
const GREATSWORD = 2.15 / 2.4;
/** A common or uncommon weapon draws a fifth smaller than its model, about the hand
 *  (held_item_size_core.ts): the whole fit shrinks with it, the lift included. */
const LOW_TIER = 0.8;

describe('a field weapon through the attach path', () => {
  it('sits in the hand at its grip, at the length it was made', async () => {
    const { assets, def, root } = await loadAssets();
    // [item, lowest and highest point along the hand bone]: the family lift plus the file's
    // span about its grip. A weapon hung from its bounding box centre would straddle zero.
    // The fourth number is the size the MODEL draws at: 1 for the length its file has, less
    // for the three shapes the owner's sizing pass took down (too big for the hand). The
    // fifth is the ITEM's: these are common and uncommon weapons, a fifth smaller again.
    const cases: [string, number, number, number, number][] = [
      ['eastbrook_arming_sword', -0.36, 1.64, 1, LOW_TIER],
      ['eastbrook_greatsword', -0.528, 1.872, GREATSWORD, LOW_TIER],
      ['icevein_dirk', -0.243, 1.037, 0.7, LOW_TIER],
      ['bogiron_mace', -0.364, 1.036, 1, LOW_TIER],
      // the maul's bare haft was shortened by 0.45 in the file (owner: handle too long)
      ['ironshod_maul', -0.616, 1.134, 0.9, LOW_TIER],
      ['copper_bearded_axe', -0.377, 1.073, 1, LOW_TIER],
      ['palecoil_rod', -0.294, 0.796, 1, LOW_TIER],
      // rare weapons on the same field models: the model's own size
      ['drogmars_skullcleaver', -0.377, 1.073, 1, 1],
      ['gravewyrm_thornmaul', -0.616, 1.134, 0.9, 1],
      ['valeborn_spellblade', -0.36, 1.64, 1, 1],
    ];
    for (const [itemId, low, high, size, tier] of cases) {
      const [holder] = assets.setHeldWeapon(root, def, itemId, null, false);
      expect(holder?.parent?.name, itemId).toBe('handslotr');
      const box = boundsOf(holder);
      expect(box.min.y, `${itemId} low`).toBeCloseTo(tier * (0.04 + low * size), 2);
      expect(box.max.y, `${itemId} high`).toBeCloseTo(tier * (0.04 + high * size), 2);
      expect(holder.scale.x, `${itemId} scale`).toBeCloseTo(size * tier, 3);
    }
  });

  // One model, two rarities: the common axe is the rare axe a fifth smaller, about the hand
  // (so its haft stays through the fist: the offset that centres it shrinks with it).
  it('draws a common weapon a fifth smaller than the rare weapon on the same model', async () => {
    const { assets, def, root } = await loadAssets();
    const seat = (itemId: string): { position: THREE.Vector3; scale: number } => {
      const [holder] = assets.setHeldWeapon(root, def, itemId, null, false);
      return { position: holder.position.clone(), scale: holder.scale.x };
    };
    const rare = seat('drogmars_skullcleaver');
    const common = seat('copper_bearded_axe');
    expect(rare.scale).toBeCloseTo(1, 6);
    expect(common.scale).toBeCloseTo(LOW_TIER, 6);
    // the rare axe's seat: the haft offset and the family lift
    expect(rare.position.x).toBeCloseTo(0.148, 6);
    expect(rare.position.y).toBeCloseTo(0.04, 6);
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(common.position[axis], axis).toBeCloseTo(rare.position[axis] * LOW_TIER, 6);
    }
    // the off hand takes the same rule (a rogue's second dagger)
    const [second] = assets.setHeldOffhand(root, def, 'icevein_dirk', null, false);
    expect(second?.parent?.name).toBe('handslotl');
    expect(second.scale.x).toBeCloseTo(0.7 * LOW_TIER, 6);
  });

  it('leads with the head of a staff and the point of a spear', async () => {
    const { assets, def, root } = await loadAssets();
    // the files are head-up about the grip; the hand turns them back, so the long head end
    // runs up the hand bone, the way a blade does
    // (both are common weapons: a fifth smaller about the hand)
    for (const [itemId, butt, head] of [
      ['craghorn_staff', 0.18 - 0.912, 0.18 + 1.368],
      ['ironbark_boar_spear', 0.18 - 0.875, 0.18 + 1.625],
    ] as const) {
      const [holder] = assets.setHeldWeapon(root, def, itemId, null, false);
      const box = boundsOf(holder);
      expect(box.min.y, `${itemId} butt`).toBeCloseTo(LOW_TIER * butt, 2);
      expect(box.max.y, `${itemId} head`).toBeCloseTo(LOW_TIER * head, 2);
    }
  });

  it('keeps its length on the back, and carries a staff head-up', async () => {
    const { assets, def, root } = await loadAssets();
    for (const [itemId, size] of [
      ['eastbrook_greatsword', GREATSWORD * LOW_TIER],
      ['ironshod_maul', 0.9 * LOW_TIER],
      ['craghorn_staff', LOW_TIER],
      // a rare maul on the same model as the uncommon one: full size on the back too
      ['gravewyrm_thornmaul', 0.9],
    ] as const) {
      const [holder] = assets.setHeldWeapon(root, def, itemId, null, true);
      expect(holder?.parent?.name, itemId).toBe('chest');
      // the carry takes its place and lean from the back table and keeps the hand's scale
      expect(holder.scale.x, `${itemId} scale`).toBeCloseTo(size, 3);
    }
    // ...and its place is the table's, whatever size the weapon draws at: the uncommon
    // maul and the rare maul on the same model hang from the same point
    const carried = (itemId: string): THREE.Vector3 =>
      assets.setHeldWeapon(root, def, itemId, null, true)[0].position.clone();
    const uncommon = carried('ironshod_maul');
    const rare = carried('gravewyrm_thornmaul');
    expect(uncommon.length()).toBeGreaterThan(0.1);
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(uncommon[axis], axis).toBeCloseTo(rare[axis], 6);
    }
    // a blade hangs tip down from its grip; the staff's long head end rises from it
    const lowAndHigh = (itemId: string): [number, number] => {
      const [holder] = assets.setHeldWeapon(root, def, itemId, null, true);
      const box = boundsOf(holder);
      return [holder.position.y - box.min.y, box.max.y - holder.position.y];
    };
    const [swordBelow, swordAbove] = lowAndHigh('eastbrook_greatsword');
    expect(swordBelow).toBeGreaterThan(2 * swordAbove);
    const [staffBelow, staffAbove] = lowAndHigh('craghorn_staff');
    expect(staffAbove).toBeGreaterThan(1.2 * staffBelow);
  });

  it('seats the heater shield on its own row in the hand and on the back', async () => {
    const { assets, def, root } = await loadAssets();
    const [held] = assets.setHeldOffhand(root, def, 'highwatch_wallshield', null, false);
    expect(held?.parent?.name).toBe('handslotl');
    const seat = KAYKIT_SHIELD_GRIPS.Heater_Shield.l;
    for (let i = 0; i < 3; i++)
      expect(held.position.getComponent(i)).toBeCloseTo(seat.position[i], 6);
    expect(held.quaternion.toArray()).toEqual(seat.quaternion);
    expect(held.scale.x).toBe(1);

    const [stowed] = assets.setHeldOffhand(root, def, 'highwatch_wallshield', null, true);
    expect(stowed?.parent?.name).toBe('chest');
    const carry = backGripFor('Heater_Shield', 'l', def.rightShoulderSheathe);
    for (let i = 0; i < 3; i++)
      expect(stowed.position.getComponent(i)).toBeCloseTo(carry.position[i], 6);
    expect(stowed.scale.x).toBe(1);
    // flat on the back, face out: the board's thin axis is the carry's depth
    const size = boundsOf(stowed).getSize(new THREE.Vector3());
    expect(size.y).toBeCloseTo(1.2, 2);
    expect(size.x).toBeCloseTo(0.73, 2);
    expect(size.z).toBeLessThan(0.35);
  });
});

// The reason for the wrapper node. The attach path resets the transform of a scene's only
// child; the pack's files kept their grip offset there, with the scale that undoes their
// quantization. The same file with its wrapper taken off loses both: it hangs from the
// middle of its mesh, a sixth shorter.
describe('the same file without its wrapper node', () => {
  it('hangs from the middle of its mesh instead of its grip', async () => {
    const url = 'models/weapons/sword_field_2h_iron.glb';
    const { assets, def, root } = await loadAssets(new Set([url]));
    const [holder] = assets.setHeldWeapon(root, def, 'eastbrook_greatsword', null, false);
    const box = boundsOf(holder);
    // centred on the hand (plus the lift): half the blade would run back through the wrist
    expect(box.min.y + box.max.y).toBeCloseTo(2 * 0.04 * LOW_TIER, 2);
    expect(box.min.y).toBeLessThan(-0.6);
    // and the mesh's own unit size (2.0, not the 2.4 the file's node scale gives it), at the
    // greatsword's drawn size (a common one's: a fifth smaller again)
    expect(box.max.y - box.min.y).toBeCloseTo(2.0 * GREATSWORD * LOW_TIER, 2);
  });
});
