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

const visualDoubles = vi.hoisted(() => ({ built: [] as { setWeaponSkin: unknown }[] }));

vi.mock('../src/render/characters/visual', () => ({
  // A recording double: setVisualKey constructs one per rebuild, so tests can
  // assert what the REAL rebuild path did to the freshly built visual.
  CharacterVisual: class {
    root = {};
    setWeaponSkin = vi.fn();
    setSkin = vi.fn();
    dispose = vi.fn();
    constructor() {
      visualDoubles.built.push(this as unknown as { setWeaponSkin: unknown });
    }
  },
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

  it('changes when the Armory weapon skin changes (apply, swap, and remove)', () => {
    // Without this, applying or removing a purchased skin while a preview is
    // mounted elides as "same appearance" and the stale weapon model survives.
    const base = appearance({ cls: 'rogue', skin: 2, mainhandItemId: 'a' });
    const sig = appearanceSignature(base);
    const skinned = appearanceSignature({ ...base, weaponSkinId: 'frostbite_dagger' });
    expect(skinned).not.toBe(sig);
    expect(appearanceSignature({ ...base, weaponSkinId: 'ashspark_dagger' })).not.toBe(skinned);
    // absent and explicit-null are the SAME identity (both mean "no skin")
    expect(appearanceSignature({ ...base, weaponSkinId: null })).toBe(sig);
  });
});

describe('CharacterPreview.setAppearance', () => {
  it('persists the appearance weapon skin so the rebuilt visual re-applies it', () => {
    const { preview } = barePreview();
    const state = preview as unknown as Record<string, unknown>;
    preview.setAppearance(
      appearance({ cls: 'rogue', mainhandItemId: 'a', weaponSkinId: 'frostbite_dagger' }),
    );
    // setVisualKey rebuilds the CharacterVisual and re-applies this field; the
    // stub harness cannot build a real visual, so pin the persisted state that
    // drives the re-apply.
    expect(state.currentWeaponSkinId).toBe('frostbite_dagger');
    preview.setAppearance(appearance({ cls: 'rogue', mainhandItemId: 'a' }));
    expect(state.currentWeaponSkinId).toBeNull();
  });

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

describe('CharacterPreview visual lifecycle', () => {
  it('disposes the previous cloned rig before replacing it', () => {
    const preview = Object.create(CharacterPreview.prototype) as CharacterPreview;
    const state = preview as unknown as Record<string, unknown>;
    const dispose = vi.fn();
    const remove = vi.fn();
    const add = vi.fn();
    state.destroyed = false;
    state.currentSkin = 0;
    state.currentVisual = { root: {}, dispose };
    state.characterGroup = { remove, add, rotation: { y: 1 } };

    preview.setVisualKey('player_warrior');

    expect(remove).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledOnce();
  });
});

describe('CharacterPreview.setVisualKey: the weapon-skin rebuild contract', () => {
  function rawPreview(persistedSkin: string | null): CharacterPreview {
    const preview = Object.create(CharacterPreview.prototype) as CharacterPreview;
    const state = preview as unknown as Record<string, unknown>;
    state.destroyed = false;
    state.currentSkin = 0;
    state.currentWeaponSkinId = persistedSkin;
    state.currentVisual = null;
    state.characterGroup = { add: vi.fn(), remove: vi.fn(), rotation: { y: 1 } };
    return preview;
  }

  beforeEach(() => {
    visualDoubles.built.length = 0;
  });

  it('re-applies the persisted skin to the freshly BUILT visual, and live changes land', () => {
    const preview = rawPreview('frostbite_dagger');
    preview.setVisualKey('player_rogue', 'rusty_dagger', null, 'rusty_dagger');
    const built = visualDoubles.built.at(-1) as { setWeaponSkin: ReturnType<typeof vi.fn> };
    expect(built).toBeDefined();
    // the rebuild path itself re-applied the persisted cosmetic
    expect(built.setWeaponSkin).toHaveBeenCalledWith('frostbite_dagger');
    // a later mount with a different skin overrides on the same visual...
    preview.setWeaponSkin('ashspark_dagger');
    expect(built.setWeaponSkin).toHaveBeenLastCalledWith('ashspark_dagger');
    // ...and clearing propagates (detach restores the item's own model)
    preview.setWeaponSkin(null);
    expect(built.setWeaponSkin).toHaveBeenLastCalledWith(null);
  });

  it('leaves the skin path untouched when none is persisted (char-create stays bare)', () => {
    const preview = rawPreview(null);
    preview.setVisualKey('player_rogue', 'rusty_dagger', null, null);
    const built = visualDoubles.built.at(-1) as { setWeaponSkin: ReturnType<typeof vi.fn> };
    expect(built.setWeaponSkin).not.toHaveBeenCalled();
  });
});
