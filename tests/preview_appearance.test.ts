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
