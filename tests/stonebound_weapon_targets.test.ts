import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as assets from '../src/render/characters/assets';
import { SanguineWeaponSheath } from '../src/render/characters/sanguine_weapon_sheath';
import { CharacterVisual } from '../src/render/characters/visual';

function held(hand: 0 | 1) {
  const holder = new THREE.Group();
  holder.userData = {
    heldPropHolder: true,
    heldSlot: hand,
    [hand === 0 ? 'swapWeaponHolder' : 'swapOffhandHolder']: true,
  };
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2, 0.08));
  mesh.userData.weaponMesh = true;
  holder.add(mesh);
  return { holder, mesh };
}

// Real overlay and offhand replacement paths, without loading a character GLB.
function fixture(offhandItemId: string | null = 'rusty_dagger') {
  const main = held(0),
    off = held(1),
    model = new THREE.Group();
  model.add(main.holder);
  if (offhandItemId) model.add(off.holder);
  const state = {
    model,
    weaponItemId: 'training_mace',
    offhandItemId,
    weaponSkinId: null,
    weaponAuraColor: null,
    weaponAuraTip: false,
    weaponAuraSanguine: false,
    weaponAuraMode: 'none',
    weaponAuraMeshes: [] as THREE.Mesh[],
    sanguineSheath: new SanguineWeaponSheath(),
    def: { offhandSlot: 0 },
    stow: { attached: false },
    tintedRigClaims: new Set(),
    rebuildCasters: vi.fn(),
    applyVisualMaterials: vi.fn(),
    buildStoneboundArmorShards: vi.fn(),
  };
  const visual = Object.assign(Object.create(CharacterVisual.prototype), state) as CharacterVisual;
  return { visual, state, main, off, model };
}

afterEach(() => vi.restoreAllMocks());

describe('Stonebound structural weapon targets', () => {
  it('sheathes both independently tagged melee hands with identical materials and releases both', () => {
    const f = fixture();
    f.visual.setWeaponAuraMode('stonebound');
    expect(f.state.weaponAuraMeshes.map((mesh) => mesh.parent)).toEqual([
      f.main.holder,
      f.off.holder,
    ]);
    const overlays = [...f.state.weaponAuraMeshes];
    const [main, off] = overlays.map((mesh) => mesh.material as THREE.MeshBasicMaterial);
    expect(off.color.getHex()).toBe(main.color.getHex());
    expect(off.opacity).toBe(main.opacity);
    expect(off.wireframe).toBe(main.wireframe);
    expect(overlays[1].scale).toEqual(overlays[0].scale);
    const disposals = overlays.map((mesh) => vi.spyOn(mesh.material as THREE.Material, 'dispose'));
    const sources = [f.main, f.off].map(({ mesh }) => vi.spyOn(mesh.geometry, 'dispose'));
    f.visual.setWeaponAuraMode('none');
    expect(f.state.weaponAuraMeshes).toHaveLength(0);
    expect(overlays.every((mesh) => mesh.parent === null)).toBe(true);
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
    for (const dispose of sources) expect(dispose).not.toHaveBeenCalled();
  });

  it.each(['eastbrook_buckler', 'morthen_grimoire', null])(
    'excludes non-melee offhand %s',
    (item) => {
      const f = fixture(item);
      f.visual.setWeaponAuraMode('stonebound');
      expect(f.state.weaponAuraMeshes.map((mesh) => mesh.parent)).toEqual([f.main.holder]);
    },
  );

  it('rebuilds the live shell after an offhand swap and removes it when replaced by a shield', () => {
    const f = fixture();
    f.visual.setWeaponAuraMode('stonebound');
    const old = [...f.state.weaponAuraMeshes];
    const replacement = held(1);
    vi.spyOn(assets, 'setHeldOffhand').mockImplementation(() => {
      f.off.holder.removeFromParent();
      f.model.add(replacement.holder);
      return [replacement.holder];
    });
    vi.spyOn(assets, 'applyMaterials').mockImplementation(() => {});
    vi.spyOn(assets, 'skinTexture').mockReturnValue(null);
    vi.spyOn(assets, 'skinEmissiveTexture').mockReturnValue(null);
    f.visual.setOffhand('worn_sword');
    expect(f.state.weaponAuraMeshes.map((mesh) => mesh.parent)).toEqual([
      f.main.holder,
      replacement.holder,
    ]);
    expect(old.every((mesh) => mesh.parent === null)).toBe(true);
    f.visual.setOffhand('eastbrook_buckler');
    expect(f.state.weaponAuraMeshes.map((mesh) => mesh.parent)).toEqual([f.main.holder]);
  });
});
