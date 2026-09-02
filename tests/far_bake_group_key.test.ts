// What shares a far-LOD draw. The composed arm is the delicate one: a composed
// group's material is NOT read off the bake's walk, it is looked up per
// character per slot as `recolored(source, look, name facts)`, so two slots may
// only share a group when their source material, their body flag AND their
// node-name facts agree. Hollow any of the three out and a distant body draws
// another slot's colours, silently.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { farBakeGroupKeysForTest, recolorMesh } from '../src/render/characters/assets';
import {
  DEFAULT_APPEARANCE,
  KNIGHT_FULL,
  lipColor,
  MAT_SKIN,
  type ModularAppearance,
  type ModularLook,
  skinColor,
} from '../src/render/characters/modular';

const { farBakeGroupKey, composedFarBakeGroupKey } = farBakeGroupKeysForTest;

function mesh(name: string, material: THREE.Material, bodyMesh = false): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BufferGeometry(), material);
  m.name = name;
  if (bodyMesh) m.userData.bodyMesh = true;
  return m;
}

describe('farBakeGroupKey', () => {
  it('separates two meshes on one material that differ only by the body flag', () => {
    // tintedFarMaterials gates the skin/emissive atlas per SLOT on isBody, so a
    // baked-in weapon and the body it is held by can never share a group.
    const shared = new THREE.MeshStandardMaterial({ name: 'shared' });

    expect(farBakeGroupKey(mesh('body', shared, true))).not.toBe(
      farBakeGroupKey(mesh('prop', shared, false)),
    );
  });

  it('shares a key across meshes agreeing on material and body flag', () => {
    const shared = new THREE.MeshStandardMaterial({ name: 'shared' });

    expect(farBakeGroupKey(mesh('a', shared, true))).toBe(farBakeGroupKey(mesh('b', shared, true)));
  });

  it('separates two materials', () => {
    expect(farBakeGroupKey(mesh('a', new THREE.MeshStandardMaterial()))).not.toBe(
      farBakeGroupKey(mesh('b', new THREE.MeshStandardMaterial())),
    );
  });
});

describe('composedFarBakeGroupKey', () => {
  it('separates the head from a body part on the same material', () => {
    // `mod_skin` is on the head, the ears AND the mouth's lip body. The default
    // key cannot tell them apart; the composed one must, or a lipstick look
    // paints the whole head.
    const skin = new THREE.MeshStandardMaterial({ name: MAT_SKIN });
    const head = mesh('M_Head', skin);
    const torso = mesh('M_Torso', skin);

    // The mutation this kills: composedFarBakeGroupKey = farBakeGroupKey.
    expect(farBakeGroupKey(head)).toBe(farBakeGroupKey(torso));
    expect(composedFarBakeGroupKey(head)).not.toBe(composedFarBakeGroupKey(torso));
  });

  it('separates the mouth lips, the jewellery and the hair band from a plain part', () => {
    const shared = new THREE.MeshStandardMaterial({ name: MAT_SKIN });
    const plain = composedFarBakeGroupKey(mesh('M_Ear_round', shared));
    for (const name of ['M_Mouth_neutral_0', 'E2_hoop', 'E2_band_topknot']) {
      expect(composedFarBakeGroupKey(mesh(name, shared)), name).not.toBe(plain);
    }
  });

  it('still carries the body flag beside the partition', () => {
    // The mutation this kills: dropping the bodyMesh term from the key the
    // composed arm builds on.
    const shared = new THREE.MeshStandardMaterial({ name: 'shared' });

    expect(composedFarBakeGroupKey(mesh('M_Torso', shared, true))).not.toBe(
      composedFarBakeGroupKey(mesh('M_ArmL', shared, false)),
    );
  });

  it('shares a key across parts agreeing on all three dimensions', () => {
    const shared = new THREE.MeshStandardMaterial({ name: 'shared' });

    expect(composedFarBakeGroupKey(mesh('M_Torso', shared))).toBe(
      composedFarBakeGroupKey(mesh('M_ArmL', shared)),
    );
  });
});

// The reader the merge partition exists to protect. `mod_skin` is on the head,
// the ears and the mouth's lip body, and only the lips take lipstick: merging
// two of them into one mesh (which has ONE name) would repaint whichever of
// them lost its name.
describe('recolorMesh reads the node name, not just the material', () => {
  const app = (over: Partial<ModularAppearance> = {}): ModularAppearance => ({
    ...DEFAULT_APPEARANCE,
    ...over,
  });
  const look = (over: Partial<ModularAppearance> = {}): ModularLook => ({
    app: app(over),
    worn: KNIGHT_FULL,
  });

  function recoloured(name: string, l: ModularLook): number {
    const m = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ name: MAT_SKIN }),
    );
    m.name = name;
    recolorMesh(m, l);
    return (m.material as THREE.MeshStandardMaterial).color.getHex();
  }

  it('paints the mouth lips with the lipstick and the ear with the skin tone', () => {
    const wearing = look({ lipstick: 'rose' });
    const lip = lipColor('rose');
    expect(lip).not.toBeNull();

    expect(recoloured('M_Mouth_neutral_0', wearing)).toBe(lip);
    expect(recoloured('M_Ear_round', wearing)).toBe(skinColor(wearing.app));
    expect(recoloured('M_Head', wearing)).toBe(skinColor(wearing.app));
    // ...and the two are genuinely different colours, or the pin proves nothing
    expect(lip).not.toBe(skinColor(wearing.app));
  });

  it('leaves the lips on the skin tone when no lipstick is worn', () => {
    const bare = look({ lipstick: 'none' });

    expect(recoloured('M_Mouth_neutral_0', bare)).toBe(skinColor(bare.app));
  });
});
