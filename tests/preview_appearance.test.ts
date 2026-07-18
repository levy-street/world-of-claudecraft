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
  offhandItemId: null,
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
    const v = previewAppearanceVisual(
      appearance({ cls: 'rogue', mainhandItemId: 'dagger_x', offhandItemId: 'dagger_y' }),
    );
    expect(v.visualKey).toBe('player_rogue');
    expect(v.weaponItemId).toBe('dagger_x');
    expect(v.offhandItemId).toBe('dagger_y');
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

  it('mirrors the wearer class hand layout and actual offhand on the mech', () => {
    const rogue = previewAppearanceVisual(
      appearance({
        cls: 'rogue',
        skinCatalog: 'mech',
        mainhandItemId: 'dagger_x',
        offhandItemId: 'dagger_y',
      }),
    );
    expect(rogue.visualKey).toBe('player_mech');
    expect(rogue.weaponItemId).toBe('dagger_x');
    expect(rogue.offhandItemId).toBe('dagger_y');
    // Same override the in-world mech render applies for the dual-wield class.
    expect(rogue.weaponOverride).toEqual(mechHeldWeaponOverride('rogue'));
    expect(rogue.weaponOverride).not.toBeNull();

    // Winning Warrior also needs its independent shield / Fury offhand layout.
    const warrior = previewAppearanceVisual(appearance({ cls: 'warrior', skinCatalog: 'mech' }));
    expect(warrior.weaponOverride).toEqual(mechHeldWeaponOverride('warrior'));
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
    expect(appearanceSignature({ ...base, offhandItemId: 'b' })).not.toBe(sig);
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
      offhandItemId: 'dagger_y',
    });

    preview.setAppearance(mech);
    expect(setVisualKey).toHaveBeenCalledOnce();
    expect(setVisualKey).toHaveBeenLastCalledWith('player_rogue', 'dagger_x', null, 'dagger_y');

    await finishMechLoad();

    expect(preloadMechAssets).toHaveBeenCalledOnce();
    expect(setVisualKey).toHaveBeenCalledTimes(2);
    expect(setVisualKey).toHaveBeenLastCalledWith(
      'player_mech',
      'dagger_x',
      mechHeldWeaponOverride('rogue'),
      'dagger_y',
    );
  });

  it('does not let a stale mech re-apply overwrite a newer selection', async () => {
    const { preview, setVisualKey } = barePreview();
    preview.setAppearance(appearance({ cls: 'rogue', skinCatalog: 'mech' }));
    preview.setAppearance(
      appearance({ cls: 'mage', skin: 1, skinCatalog: 'class', mainhandItemId: 'staff_x' }),
    );

    expect(setVisualKey).toHaveBeenCalledTimes(2);
    expect(setVisualKey).toHaveBeenLastCalledWith('player_mage', 'staff_x', null, null);

    await finishMechLoad();

    expect(setVisualKey).toHaveBeenCalledTimes(2);
    expect(setVisualKey).toHaveBeenLastCalledWith('player_mage', 'staff_x', null, null);
  });
});

describe('CharacterPreview.setClass', () => {
  it('shows starter offhands and accepts the live equipped hands from callers', () => {
    const { preview, setVisualKey } = barePreview();

    preview.setClass('warrior');
    expect(setVisualKey).toHaveBeenLastCalledWith(
      'player_warrior',
      'worn_sword',
      null,
      'eastbrook_buckler',
    );

    preview.setClass('rogue', 'rusty_dagger', 'keen_dirk');
    expect(setVisualKey).toHaveBeenLastCalledWith(
      'player_rogue',
      'rusty_dagger',
      null,
      'keen_dirk',
    );
  });
});
