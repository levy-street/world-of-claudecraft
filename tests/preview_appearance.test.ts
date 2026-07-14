import { beforeEach, describe, expect, it, vi } from 'vitest';
import { preloadMechAssets } from '../src/render/characters/assets';
import { mechHeldWeaponOverride } from '../src/render/characters/manifest';
import { CharacterPreview } from '../src/render/characters/preview';
import {
  appearanceSignature,
  type PreviewAppearance,
  previewAppearanceVisual,
} from '../src/render/characters/preview_appearance';

const mechAssets = vi.hoisted(() => ({
  ready: false,
  promise: null as Promise<void> | null,
  resolve: null as (() => void) | null,
}));

vi.mock('../src/render/characters/assets', () => ({
  mechAssetsReady: () => mechAssets.ready,
  preloadMechAssets: vi.fn(() => {
    if (!mechAssets.promise) {
      mechAssets.promise = new Promise<void>((resolve) => {
        mechAssets.resolve = () => {
          mechAssets.ready = true;
          resolve();
        };
      });
    }
    return mechAssets.promise;
  }),
}));

vi.mock('../src/render/characters/visual', () => ({
  CharacterVisual: class {},
}));

const appearance = (over: Partial<PreviewAppearance>): PreviewAppearance => ({
  cls: 'warrior',
  skin: 0,
  skinCatalog: 'class',
  mainhandItemId: null,
  ...over,
});

function barePreview(): {
  preview: CharacterPreview;
  setVisualKey: ReturnType<typeof vi.fn>;
} {
  const preview = Object.create(CharacterPreview.prototype) as CharacterPreview;
  const state = preview as unknown as Record<string, unknown>;
  const setVisualKey = vi.fn();
  state.destroyed = false;
  state.appearanceSig = null;
  state.currentSkin = 0;
  preview.setVisualKey = setVisualKey;
  return { preview, setVisualKey };
}

async function finishMechLoad(): Promise<void> {
  mechAssets.resolve?.();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  mechAssets.ready = false;
  mechAssets.promise = null;
  mechAssets.resolve = null;
  vi.mocked(preloadMechAssets).mockClear();
});

describe('previewAppearanceVisual', () => {
  it('uses the class rig for a class-catalog character and holds its mainhand', () => {
    const v = previewAppearanceVisual(appearance({ cls: 'mage', mainhandItemId: 'staff_x' }));
    expect(v.visualKey).toBe('player_mage');
    expect(v.weaponItemId).toBe('staff_x');
    expect(v.weaponOverride).toBeNull();
  });

  it('shows no weapon when the character is unarmed', () => {
    const v = previewAppearanceVisual(appearance({ cls: 'priest', mainhandItemId: null }));
    expect(v.visualKey).toBe('player_priest');
    expect(v.weaponItemId).toBeNull();
  });

  it('uses the Combat Mech body for an event skin (skinCatalog mech)', () => {
    const v = previewAppearanceVisual(appearance({ cls: 'warrior', skinCatalog: 'mech' }));
    expect(v.visualKey).toBe('player_mech');
  });

  it('mirrors the wearer class hand layout on the mech (rogue dual-wields)', () => {
    const rogue = previewAppearanceVisual(
      appearance({ cls: 'rogue', skinCatalog: 'mech', mainhandItemId: 'dagger_x' }),
    );
    expect(rogue.visualKey).toBe('player_mech');
    expect(rogue.weaponItemId).toBe('dagger_x');
    // Same override the in-world mech render applies for the dual-wield class.
    expect(rogue.weaponOverride).toEqual(mechHeldWeaponOverride('rogue'));
    expect(rogue.weaponOverride).not.toBeNull();

    // A single-mainhand class keeps the mech's own default (no override).
    const warrior = previewAppearanceVisual(appearance({ cls: 'warrior', skinCatalog: 'mech' }));
    expect(warrior.weaponOverride).toBeNull();
  });
});

describe('appearanceSignature', () => {
  it('changes when any appearance field changes', () => {
    const base = appearance({ cls: 'rogue', skin: 2, mainhandItemId: 'a' });
    const sig = appearanceSignature(base);
    expect(appearanceSignature(appearance({ cls: 'rogue', skin: 2, mainhandItemId: 'a' }))).toBe(
      sig,
    );
    expect(appearanceSignature({ ...base, skin: 3 })).not.toBe(sig);
    expect(appearanceSignature({ ...base, skinCatalog: 'mech' })).not.toBe(sig);
    expect(appearanceSignature({ ...base, mainhandItemId: 'b' })).not.toBe(sig);
  });

  it('is unchanged when equippedItems is absent, undefined, or empty (Phase 2b seam)', () => {
    const base = appearance({ cls: 'warrior', skin: 1, mainhandItemId: 'sword_x' });
    const sig = appearanceSignature(base);
    expect(appearanceSignature({ ...base, equippedItems: undefined })).toBe(sig);
    expect(appearanceSignature({ ...base, equippedItems: {} })).toBe(sig);
  });

  it('changes when an equipped item id changes on any slot (Phase 2b equipment seam)', () => {
    const base = appearance({
      cls: 'warrior',
      skin: 1,
      mainhandItemId: 'sword_x',
      equippedItems: { chest: 'chest_a', legs: 'legs_a' },
    });
    const sig = appearanceSignature(base);
    // Same map (a fresh object, same contents) stays stable.
    expect(
      appearanceSignature({
        ...base,
        equippedItems: { chest: 'chest_a', legs: 'legs_a' },
      }),
    ).toBe(sig);
    // Changing one slot's item id changes the signature, so a future armor
    // swap on any slot (not just the mainhand) invalidates a cached appearance.
    expect(
      appearanceSignature({ ...base, equippedItems: { chest: 'chest_b', legs: 'legs_a' } }),
    ).not.toBe(sig);
    // A different slot (legs only, chest unchanged) is equally decisive.
    expect(
      appearanceSignature({ ...base, equippedItems: { chest: 'chest_a', legs: 'legs_b' } }),
    ).not.toBe(sig);
    // Adding or dropping a slot also changes it.
    expect(appearanceSignature({ ...base, equippedItems: { chest: 'chest_a' } })).not.toBe(sig);
    expect(
      appearanceSignature({
        ...base,
        equippedItems: { chest: 'chest_a', legs: 'legs_a', feet: 'feet_a' },
      }),
    ).not.toBe(sig);
    // Insertion order does not matter (sorted by slot internally).
    expect(
      appearanceSignature({
        ...base,
        equippedItems: { legs: 'legs_a', chest: 'chest_a' },
      }),
    ).toBe(sig);
  });
});

describe('CharacterPreview.setAppearance', () => {
  it('re-applies the current mech appearance once its lazy assets are ready', async () => {
    const { preview, setVisualKey } = barePreview();
    const mech = appearance({
      cls: 'rogue',
      skin: 2,
      skinCatalog: 'mech',
      mainhandItemId: 'dagger_x',
    });

    preview.setAppearance(mech);
    expect(setVisualKey).toHaveBeenCalledOnce();
    expect(setVisualKey).toHaveBeenLastCalledWith('player_rogue', 'dagger_x');

    await finishMechLoad();

    expect(preloadMechAssets).toHaveBeenCalledOnce();
    expect(setVisualKey).toHaveBeenCalledTimes(2);
    expect(setVisualKey).toHaveBeenLastCalledWith(
      'player_mech',
      'dagger_x',
      mechHeldWeaponOverride('rogue'),
    );
  });

  it('does not let a stale mech re-apply overwrite a newer selection', async () => {
    const { preview, setVisualKey } = barePreview();
    preview.setAppearance(appearance({ cls: 'rogue', skinCatalog: 'mech' }));
    preview.setAppearance(
      appearance({ cls: 'mage', skin: 1, skinCatalog: 'class', mainhandItemId: 'staff_x' }),
    );

    expect(setVisualKey).toHaveBeenCalledTimes(2);
    expect(setVisualKey).toHaveBeenLastCalledWith('player_mage', 'staff_x', null);

    await finishMechLoad();

    expect(setVisualKey).toHaveBeenCalledTimes(2);
    expect(setVisualKey).toHaveBeenLastCalledWith('player_mage', 'staff_x', null);
  });
});

// Phase 2b equipment-visual base seam: CharacterVisual itself is GLB/WebGL-heavy
// (mocked to a bare class above), so these cover the cheap, Three-free part of
// the seam: CharacterPreview.setEquipment's delegation to whatever visual is
// currently mounted, and setAppearance's pass-through when the field is set.
describe('CharacterPreview.setEquipment', () => {
  it('delegates to the current visual, and no-ops when none is mounted yet', () => {
    const { preview } = barePreview();
    const state = preview as unknown as { currentVisual: unknown };

    // No visual mounted (e.g. construction still pending): must not throw.
    expect(() => preview.setEquipment({ mainhand: 'sword_x' })).not.toThrow();

    const setEquipment = vi.fn();
    state.currentVisual = { setEquipment };
    const equipped = { mainhand: 'sword_x', chest: 'chest_a' };
    preview.setEquipment(equipped);
    expect(setEquipment).toHaveBeenCalledOnce();
    expect(setEquipment).toHaveBeenCalledWith(equipped);
  });
});

// Phase 2b pedestal opt-in: the headline behavior of this phase. buildPedestal
// is real (plain THREE geometry/material, no WebGL), so a fake scene with add/
// remove spies is enough to assert the full state machine: default off, add on
// enable, no-op (and never rebuilt) on a repeat enable, remove on disable.
describe('CharacterPreview.setPedestal (Phase 2b state machine)', () => {
  it('is default off, adds once on enable, no-ops on repeat, and removes on disable', () => {
    const { preview } = barePreview();
    const state = preview as unknown as {
      scene: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
      pedestal: unknown;
      pedestalVisible: boolean;
    };
    state.scene = { add: vi.fn(), remove: vi.fn() };
    state.pedestalVisible = false;
    state.pedestal = null;

    // Default off: disabling while already off never touches the scene or builds.
    preview.setPedestal(false);
    expect(state.scene.add).not.toHaveBeenCalled();
    expect(state.scene.remove).not.toHaveBeenCalled();
    expect(state.pedestal).toBeNull();

    // Enable: builds once and adds it to the scene.
    preview.setPedestal(true);
    expect(state.scene.add).toHaveBeenCalledOnce();
    const built = state.pedestal;
    expect(built).not.toBeNull();

    // Repeat enable: no-op (guarded by the visible === pedestalVisible early
    // return), and the pedestal is never rebuilt (per-instance alloc discipline).
    preview.setPedestal(true);
    expect(state.scene.add).toHaveBeenCalledOnce();
    expect(state.pedestal).toBe(built);

    // Disable: removes from the scene, keeps the built instance for reuse.
    preview.setPedestal(false);
    expect(state.scene.remove).toHaveBeenCalledOnce();
    expect(state.pedestal).toBe(built);
  });
});

describe('CharacterPreview.setAppearance equipment pass-through (Phase 2b seam)', () => {
  it('calls setEquipment with the appearance equippedItems map when provided', () => {
    const { preview } = barePreview();
    const setEquipmentSpy = vi.spyOn(preview, 'setEquipment').mockImplementation(() => {});
    const equippedItems = { chest: 'chest_a', legs: 'legs_a' };
    preview.setAppearance(appearance({ cls: 'mage', mainhandItemId: 'staff_x', equippedItems }));
    expect(setEquipmentSpy).toHaveBeenCalledOnce();
    expect(setEquipmentSpy).toHaveBeenCalledWith(equippedItems);
  });

  it('does not call setEquipment when equippedItems is absent (unchanged behavior)', () => {
    const { preview } = barePreview();
    const setEquipmentSpy = vi.spyOn(preview, 'setEquipment').mockImplementation(() => {});
    preview.setAppearance(appearance({ cls: 'mage', mainhandItemId: 'staff_x' }));
    expect(setEquipmentSpy).not.toHaveBeenCalled();
  });
});
