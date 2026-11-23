// A pack weapon sits IN the fist, and a one-sided head faces the cut.
//
// Owner review of the weapon sets: the one-hand axes floated beside the hand, the starter
// axe and the curved rare dagger were held edge up, and (found in the same pass) the epic
// daggers were held by the guard. None of that shows in a table. It comes from where a FILE
// puts its handle against its own origin: the pack's axes are centred on their box, blade
// and all, and the epic daggers put the origin where hilt meets guard. So this suite
// measures the files themselves, through the transform the attach path applies.
//
// The hand, measured in game on the WOC rig:
// - A hand slot's origin is the middle of the closed fist. The hand's skinned vertices span
//   slot y -0.092 to 0.096 and their centre lies on the slot's own axis within 0.005.
// - The right slot's +X points at the ground in the idle hold, and at the enemy in the
//   battle stance and through the swing. The left slot is its mirror: there -X does.
//
// The attach path (assets.ts applyVariantGrip) places a weapon with variantGripTransform.
// Each decoded mesh goes through that same transform into the slot's frame, and is cut
// across the palm.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import { KAYKIT_WEAPON_ACCESSORY, VARIANT_GRIPS } from '../src/render/characters/assets';
import { heldWeaponSize, LOW_TIER_WEAPON_SIZE } from '../src/render/characters/held_item_size_core';
import { variantGripTransform, WEAPON_GRIP_OVERRIDES } from '../src/render/characters/weapon_grip';
import { ITEM_WEAPON_VARIANTS } from '../src/ui/weapon_variants';

type Vec3 = [number, number, number];
type Tri = [Vec3, Vec3, Vec3];
type Hand = 'r' | 'l';

/** The pack sets: starter, field, rare, epic. */
const PACK = /_(starter|field|rare|epic)(_|$)/;
/** Every pack weapon the attach path seats with a family grip. Shields seat on the forearm
 *  and the hunter's crossbow on the kit crossbow's node (their own tests). */
const KEYS = Object.keys(KAYKIT_WEAPON_ACCESSORY)
  .filter((key) => PACK.test(key) && VARIANT_GRIPS[KAYKIT_WEAPON_ACCESSORY[key]] !== undefined)
  .sort();

/** Heights across the middle of the fist, in the slot's frame. */
const PALM = [-0.05, -0.025, 0, 0.025, 0.05];
/** How far a handle's centre may sit off the slot's axis. The handles the owner passed are
 *  within 0.027 (a bent glaive shaft is the furthest); the floating ones were 0.13 to 0.2
 *  off, the bowed dagger hilt 0.035. */
const ON_AXIS = 0.03;
/** The widest thing a palm closes on. Handles run 0.06 to 0.15 across (the two-hand axe at
 *  its drawn scale is the thickest); a guard or a head in the palm is 0.2 and up. */
const HANDLE_WIDTH = 0.2;

/** Shapes whose working end is one-sided: the side it overhangs the handle by more is the
 *  cut. (A double-bit axe, a straight dagger and a hammer have no such side.) */
const ONE_SIDED = [
  'axe_starter',
  'axe_field',
  'axe_rare_a',
  'axe_epic_gravecleaver',
  'dagger_rare_b',
] as const;

/** Curved blades whose POINT has a side. At rest it curls up, away from the ground: the
 *  dragonfang curling at the ground hung like a hook (owner review: upside down). */
const POINT_UP = ['dagger_epic_dragonfang'] as const;

const meshes = new Map<string, Tri[]>();

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  for (const key of KEYS) {
    const doc = await io.read(`public/models/weapons/${key}.glb`);
    const tris: Tri[] = [];
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (!mesh) continue;
      const m = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const position = prim.getAttribute('POSITION');
        if (!position) continue;
        const points: Vec3[] = [];
        for (let i = 0; i < position.getCount(); i++) {
          const [x, y, z] = position.getElement(i, [0, 0, 0]);
          points.push([
            m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14],
          ]);
        }
        const indices = prim.getIndices();
        const count = indices ? indices.getCount() : points.length;
        const at = (i: number): Vec3 => points[indices ? indices.getScalar(i) : i];
        for (let i = 0; i + 2 < count; i += 3) tris.push([at(i), at(i + 1), at(i + 2)]);
      }
    }
    meshes.set(key, tris);
  }
});

function rotate(q: readonly number[], v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

/** The model as the attach path seats it, in the hand slot's own frame. `size` is the
 *  equipped item's (held_item_size_core.ts): the attach path applies it about the hand. */
function inSlot(key: string, hand: Hand, size = 1): Tri[] {
  const tris = meshes.get(key);
  if (!tris) throw new Error(`${key} was not decoded`);
  let low = Infinity;
  let high = -Infinity;
  for (const tri of tris) {
    for (const p of tri) {
      low = Math.min(low, p[1]);
      high = Math.max(high, p[1]);
    }
  }
  const family = VARIANT_GRIPS[KAYKIT_WEAPON_ACCESSORY[key]];
  const grip = variantGripTransform(
    high - low,
    hand === 'l',
    family.lift,
    family.maxHeight,
    WEAPON_GRIP_OVERRIDES[key],
  );
  const place = (p: Vec3): Vec3 => {
    const r = rotate(grip.quaternion, [p[0] * grip.scale, p[1] * grip.scale, p[2] * grip.scale]);
    return [
      (r[0] + grip.position[0]) * size,
      (r[1] + grip.position[1]) * size,
      (r[2] + grip.position[2]) * size,
    ];
  };
  return tris.map((tri) => [place(tri[0]), place(tri[1]), place(tri[2])]);
}

/** The mesh's cross-section on the plane y = height: its box in x and z. */
function section(tris: Tri[], height: number): { x: [number, number]; z: [number, number] } {
  const x: [number, number] = [Infinity, -Infinity];
  const z: [number, number] = [Infinity, -Infinity];
  for (const tri of tris) {
    for (let i = 0; i < 3; i++) {
      const a = tri[i];
      const b = tri[(i + 1) % 3];
      if ((a[1] - height) * (b[1] - height) > 0 || a[1] === b[1]) continue;
      const k = (height - a[1]) / (b[1] - a[1]);
      const px = a[0] + k * (b[0] - a[0]);
      const pz = a[2] + k * (b[2] - a[2]);
      x[0] = Math.min(x[0], px);
      x[1] = Math.max(x[1], px);
      z[0] = Math.min(z[0], pz);
      z[1] = Math.max(z[1], pz);
    }
  }
  return { x, z };
}

/** What the palm closes on: the centre of the cross-sections across it, and the widest. */
function palm(key: string, hand: Hand, size = 1): { centre: [number, number]; widest: number } {
  const tris = inSlot(key, hand, size);
  let cx = 0;
  let cz = 0;
  let widest = 0;
  for (const height of PALM) {
    const cut = section(tris, height);
    // every height across the palm meets the weapon: no handle ends inside the fist
    expect(Number.isFinite(cut.x[0]), `${key} ${hand} has no handle at ${height}`).toBe(true);
    cx += (cut.x[0] + cut.x[1]) / 2 / PALM.length;
    cz += (cut.z[0] + cut.z[1]) / 2 / PALM.length;
    widest = Math.max(widest, cut.x[1] - cut.x[0], cut.z[1] - cut.z[0]);
  }
  return { centre: [cx, cz], widest };
}

/** How far the working end overhangs the handle to each side, along the slot's X. */
function overhang(key: string, hand: Hand): { minusX: number; plusX: number } {
  const tris = inSlot(key, hand);
  const axis = palm(key, hand).centre[0];
  let minusX = 0;
  let plusX = 0;
  for (const tri of tris) {
    for (const p of tri) {
      // beyond the fist, toward the head (+Y of the slot is where a held blade points)
      if (p[1] < 0.2) continue;
      minusX = Math.max(minusX, axis - p[0]);
      plusX = Math.max(plusX, p[0] - axis);
    }
  }
  return { minusX, plusX };
}

/** Which side of the handle the weapon's far point falls on, along the slot's X. */
function point(key: string, hand: Hand): number {
  const axis = palm(key, hand).centre[0];
  let tip: Vec3 | null = null;
  for (const tri of inSlot(key, hand)) {
    for (const p of tri) if (!tip || p[1] > tip[1]) tip = p;
  }
  if (!tip) throw new Error(`${key} has no mesh`);
  return tip[0] - axis;
}

describe('pack weapons in the hand', () => {
  it('covers every pack weapon an item draws', () => {
    const drawn = new Set(Object.values(ITEM_WEAPON_VARIANTS).filter((key) => PACK.test(key)));
    expect(drawn.size).toBeGreaterThan(50);
    for (const key of drawn) expect(KEYS, key).toContain(key);
    for (const key of KEYS) expect(meshes.get(key)?.length ?? 0, key).toBeGreaterThan(100);
  });

  it('pass their handle through the middle of the fist, in either hand', () => {
    for (const key of KEYS) {
      for (const hand of ['r', 'l'] as const) {
        const { centre } = palm(key, hand);
        expect(Math.abs(centre[0]), `${key} ${hand} handle off the fist along X`).toBeLessThan(
          ON_AXIS,
        );
        expect(Math.abs(centre[1]), `${key} ${hand} handle off the fist along Z`).toBeLessThan(
          ON_AXIS,
        );
      }
    }
  });

  it('put a handle in the palm, never a guard or a head', () => {
    for (const key of KEYS) {
      for (const hand of ['r', 'l'] as const) {
        expect(palm(key, hand).widest, `${key} ${hand}`).toBeLessThan(HANDLE_WIDTH);
      }
    }
  });

  // A common or uncommon weapon draws smaller than its model (the item's size, about the
  // hand). The fist does not shrink with it, so it spans more of the hilt: at that size too
  // the palm must close on a handle through its middle, not a guard or a pommel.
  it('still hold a handle in the palm at the size a common or uncommon weapon draws', () => {
    const lowTier = new Set(
      Object.entries(ITEM_WEAPON_VARIANTS)
        .filter(([itemId, key]) => PACK.test(key) && heldWeaponSize(itemId) < 1)
        .map(([, key]) => key),
    );
    // the starter and field sets
    expect(lowTier.size).toBeGreaterThan(20);
    for (const key of lowTier) {
      for (const hand of ['r', 'l'] as const) {
        const { centre, widest } = palm(key, hand, LOW_TIER_WEAPON_SIZE);
        expect(Math.hypot(centre[0], centre[1]), `${key} ${hand} off the fist`).toBeLessThan(
          ON_AXIS,
        );
        expect(widest, `${key} ${hand} in the palm`).toBeLessThan(HANDLE_WIDTH);
      }
    }
  });

  it('turn a one-sided head to the cut: down at rest, at the enemy in the stance', () => {
    const oneSided = KEYS.filter((key) => ONE_SIDED.some((shape) => key.startsWith(shape)));
    // the starter axe, three field axes, three rare ones, two epic ones, three curved daggers
    expect(oneSided).toHaveLength(12);
    for (const key of oneSided) {
      const right = overhang(key, 'r');
      const left = overhang(key, 'l');
      // the right slot's +X is the cut side; the left slot mirrors it. A ratio, so the
      // measure holds whatever size the weapon draws at.
      expect(right.plusX / right.minusX, `${key} right hand`).toBeGreaterThan(1.25);
      expect(left.minusX / left.plusX, `${key} left hand`).toBeGreaterThan(1.25);
    }
  });

  it('curls the point of a fang up at rest, not at the ground', () => {
    const fangs = KEYS.filter((key) => POINT_UP.some((shape) => key.startsWith(shape)));
    expect(fangs).toHaveLength(3);
    for (const key of fangs) {
      // the right slot's +X is the ground side at rest; the left slot mirrors it
      expect(point(key, 'r'), `${key} right hand`).toBeLessThan(-0.05);
      expect(point(key, 'l'), `${key} left hand`).toBeGreaterThan(0.05);
      // a hilt a fist long: nothing wider than a handle anywhere the fist closes
      for (const hand of ['r', 'l'] as const) {
        const tris = inSlot(key, hand);
        for (const height of [-0.09, -0.045, 0, 0.045, 0.09]) {
          const cut = section(tris, height);
          expect(cut.x[1] - cut.x[0], `${key} ${hand} at ${height}`).toBeLessThan(HANDLE_WIDTH);
        }
      }
    }
    // the measure itself: a straight dagger's point is on its handle's line
    expect(Math.abs(point('dagger_field_iron', 'r'))).toBeLessThan(0.01);
  });

  // The starter staff's leather wrap is a band a touch thicker than the wood either side of
  // it, a fist and a quarter long. Owner review: the hand held the staff behind it.
  it('closes the fist on the wrap of the starter staff', () => {
    const tris = inSlot('staff_starter', 'r');
    const width = (height: number): number => {
      const cut = section(tris, height);
      return cut.x[1] - cut.x[0];
    };
    // the fist spans -0.092 to 0.096
    for (const height of [-0.09, -0.045, 0, 0.045, 0.09]) {
      expect(width(height), `across the fist at ${height}`).toBeGreaterThan(0.088);
    }
    // bare wood just past the fist, butt side and crook side
    expect(width(-0.14)).toBeLessThan(0.086);
    expect(width(0.14)).toBeLessThan(0.086);
  });

  it('measures a real overhang on the one-sided shapes and none on the rest', () => {
    // the measure itself: an axe bit overhangs its haft far more to one side, a double-bit
    // axe and a straight dagger do not
    const lopsided = (key: string): number => {
      const { minusX, plusX } = overhang(key, 'r');
      return Math.abs(plusX - minusX);
    };
    expect(lopsided('axe_field_iron')).toBeGreaterThan(0.25);
    expect(lopsided('axe_rare_b_ember')).toBeLessThan(0.03);
    expect(lopsided('dagger_field_iron')).toBeLessThan(0.03);
  });
});
