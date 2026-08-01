// @vitest-environment jsdom
// The held weapon's OWN baked idle clip. The magical Armory tiers ship split
// models — a base weapon plus moving parts on pivot nodes — and each carries a
// looping clip that spins/orbits/bobs them. Nothing drove those clips before:
// CharacterVisual's mixer animates the humanoid rig, and the weapon is a plain
// attached prop, so a legendary's sun-disk sat frozen in the hand, on the
// character sheet, and on the store's showcase turntable.
//
// Two guards here: the ON-DISK assertion that the split models still ship their
// clip (a flat re-export from Blender silently drops it, which is exactly the
// state this fixed), and the animator's own contract.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { WEAPON_SKINS } from '../src/sim/content/weapon_skins';

vi.mock('../src/render/characters/assets', () => ({
  weaponModelClips: (url: string | undefined) => mockClips.get(url ?? '') ?? [],
}));

const mockClips = new Map<string, THREE.AnimationClip[]>();

const { WeaponIdleAnimator } = await import('../src/render/characters/weapon_idle_anim');

/** The glTF JSON chunk of a .glb, without a three loader (node, no GPU). */
function glbJson(path: string): { animations?: { name?: string; channels: unknown[] }[] } {
  const buf = readFileSync(path);
  expect(buf.readUInt32LE(0), `${path} is not a glb`).toBe(0x46546c67);
  let offset = 12;
  while (offset < buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    if (type === 0x4e4f534a) {
      return JSON.parse(new TextDecoder().decode(buf.subarray(offset + 8, offset + 8 + length)));
    }
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  throw new Error(`${path} has no JSON chunk`);
}

// The skins whose models are authored as split rigs with a baked idle clip.
// Adding a skin here is the contract: the artist's animation must survive
// whatever export/compression the model goes through on its way into public/.
const ANIMATED_SKIN_IDS: readonly string[] = [
  'solheim_sword',
  'astravyr_dagger',
  'skyrender_axe',
  'starfall_mace',
  'emberwish_wand',
  'hoarfrost_vigil_staff',
  'everwinter_wand',
  // Its ring_spin was built in the asset-pipeline job dir back in July and never
  // applied, so public/ carried the FLAT single-mesh export for weeks while the
  // tool showed the animated one. That is exactly the drift this list catches.
  'cosmarch_staff',
];

describe('animated weapon-skin models', () => {
  it.each(ANIMATED_SKIN_IDS)('%s ships a looping idle clip in its GLB', (skinId) => {
    const skin = WEAPON_SKINS[skinId];
    expect(skin, `${skinId} is not a catalogued skin`).toBeDefined();
    const gltf = glbJson(`public/models/weapons/${skin.model}.glb`);
    const animations = gltf.animations ?? [];
    expect(animations.length, `${skin.model}.glb has no animation`).toBeGreaterThan(0);
    // A clip with no channels drives nothing — the shape a bad export leaves.
    for (const clip of animations) {
      expect(clip.channels.length, `${skin.model}.glb clip drives no node`).toBeGreaterThan(0);
    }
  });
});

/** A stand-in payload: a pivot node under a root, plus a clip that spins it —
 *  the exact shape of every split weapon model in the catalog. */
function pivotPayload(url: string): THREE.Object3D {
  const root = new THREE.Object3D();
  root.userData.weaponModelUrl = url;
  const pivot = new THREE.Object3D();
  pivot.name = 'ring_spin_pivot';
  root.add(pivot);
  const half = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  mockClips.set(url, [
    new THREE.AnimationClip('legendary_idle', 2, [
      new THREE.QuaternionKeyframeTrack(
        'ring_spin_pivot.quaternion',
        [0, 1, 2],
        [0, 0, 0, 1, half.x, half.y, half.z, half.w, 0, 0, 0, -1],
      ),
    ]),
  ]);
  return root;
}

describe('WeaponIdleAnimator', () => {
  it('plays a payload clip, advancing the model node it targets', () => {
    const payload = pivotPayload('models/weapons/solheim_last_light_of_the_dawn.glb');
    const pivot = payload.children[0];
    const animator = new WeaponIdleAnimator();
    animator.build([payload]);
    expect(animator.active).toBe(true);
    expect(pivot.quaternion.y).toBeCloseTo(0, 5);

    animator.update(0.5);
    expect(pivot.quaternion.y).toBeGreaterThan(0);
  });

  it('loops forever rather than stopping at the end of the clip', () => {
    const payload = pivotPayload('models/weapons/starfall_judgment_of_the_heavens.glb');
    const pivot = payload.children[0];
    const animator = new WeaponIdleAnimator();
    animator.build([payload]);
    // Well past the 2s clip length: a one-shot would have frozen on its last
    // frame, so a mid-clip pose here is the proof it wrapped.
    animator.update(2.5);
    expect(pivot.quaternion.y).toBeGreaterThan(0);
    animator.update(1.0);
    expect(pivot.quaternion.length()).toBeCloseTo(1, 5);
  });

  it('allocates nothing for a plain one-piece model', () => {
    const payload = new THREE.Object3D();
    payload.userData.weaponModelUrl = 'models/weapons/sword_a.glb';
    const animator = new WeaponIdleAnimator();
    animator.build([payload]);
    expect(animator.active).toBe(false);
    // The per-frame call must stay a no-op, not a crash, on every other rig.
    expect(() => animator.update(0.016)).not.toThrow();
  });

  it('ignores a payload with no source url (a non-skin attach)', () => {
    const animator = new WeaponIdleAnimator();
    animator.build([new THREE.Object3D()]);
    expect(animator.active).toBe(false);
  });

  it('rebuilds cleanly across a re-attach and goes quiet on dispose', () => {
    const first = pivotPayload('models/weapons/skyrender_the_firmament_s_wound.glb');
    const animator = new WeaponIdleAnimator();
    animator.build([first]);
    animator.update(0.5);

    expect(first.children[0].quaternion.y).toBeGreaterThan(0);

    // A gear swap / sheathe removes the old prop and attaches a fresh clone.
    // The discarded payload is released back to its REST pose and never
    // written again, so a re-attach can never inherit a mid-clip transform.
    const second = pivotPayload('models/weapons/skyrender_the_firmament_s_wound.glb');
    animator.build([second]);
    animator.update(0.5);
    expect(first.children[0].quaternion.y).toBeCloseTo(0, 5);
    expect(second.children[0].quaternion.y).toBeGreaterThan(0);

    animator.dispose();
    expect(animator.active).toBe(false);
    const parked = second.children[0].quaternion.clone();
    expect(parked.y).toBeCloseTo(0, 5);
    animator.update(0.5);
    expect(second.children[0].quaternion.equals(parked)).toBe(true);
  });

  it('drives every payload of a mirrored dual-wield pair', () => {
    const left = pivotPayload('models/weapons/astravyr_fang_of_the_fallen_star.glb');
    const right = pivotPayload('models/weapons/astravyr_fang_of_the_fallen_star.glb');
    const animator = new WeaponIdleAnimator();
    animator.build([left, right]);
    animator.update(0.5);
    expect(left.children[0].quaternion.y).toBeGreaterThan(0);
    expect(right.children[0].quaternion.y).toBeGreaterThan(0);
  });
});
