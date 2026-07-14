// Phase 2b equipment-visual base seam: CharacterVisual.setEquipment stores the
// full equipped-item map and delegates ONLY the mainhand slot to the existing
// setWeapon path (weapon-only rendering today; per-slot armor lands on the same
// seam later). Contract section 5 requires proving that delegation.
//
// Importing the real visual.ts pulls in ./assets, whose module-load GLTFLoader
// preloads throw in a headless Node test, so stub EVERY assets export at file
// top (vi.mock is file-hoisted, so this runs before the CharacterVisual import
// resolves the module). We only bare-construct the class (Object.create, no
// constructor) and drive setEquipment, so the stubs never actually run: setWeapon
// early-returns after storing weaponItemId when def.weaponSlots is falsy, which
// is exactly the delegation edge we assert.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/characters/assets', () => ({
  skinTexture: vi.fn(() => null),
  ensureSkinTexture: vi.fn(() => null),
  skinEmissiveTexture: vi.fn(() => null),
  preloadMechAssets: vi.fn(() => Promise.resolve()),
  mechAssetsReady: vi.fn(() => true),
  assembleModel: vi.fn(() => ({})),
  setHeldWeapon: vi.fn(),
  tintedMaterial: vi.fn(() => ({})),
  applyMaterials: vi.fn(),
  tintedFarMaterials: vi.fn(() => ({})),
  prepareVisual: vi.fn(() => ({
    def: {},
    normScale: 1,
    yOffset: 0,
    clips: new Map(),
    idleGeo: null,
    clickRadius: 0.5,
  })),
}));

import { CharacterVisual } from '../src/render/characters/visual';

/** Bare-construct the real class (no constructor, so no GLB/WebGL) with only the
 *  fields setEquipment -> setWeapon touches. def has no weaponSlots, so setWeapon
 *  stores weaponItemId then early-returns before any prop/material work. */
function bareVisual(seedWeapon: string | null = null): CharacterVisual {
  const visual = Object.create(CharacterVisual.prototype) as CharacterVisual;
  const state = visual as unknown as { def: unknown; weaponItemId: string | null };
  state.def = {};
  state.weaponItemId = seedWeapon;
  return visual;
}

describe('CharacterVisual.setEquipment (Phase 2b weapon delegation)', () => {
  it('delegates the mainhand slot (not another slot) to the weapon path', () => {
    const visual = bareVisual();
    const state = visual as unknown as { weaponItemId: string | null };
    visual.setEquipment({ mainhand: 'sword_a', chest: 'chest_a' });
    // Decisive: if the delegation read the wrong slot (e.g. chest) weaponItemId
    // would be 'chest_a'; if setEquipment dropped the setWeapon call it would
    // stay null. Only reading equipped.mainhand yields 'sword_a'.
    expect(state.weaponItemId).toBe('sword_a');
  });

  it('sets the weapon to null when no mainhand is equipped (the ?? null branch)', () => {
    // Seed a held weapon so the transition to null is real, not a no-op: setWeapon
    // early-returns when the value is unchanged, so start from a different value.
    const visual = bareVisual('old_sword');
    const state = visual as unknown as { weaponItemId: string | null };
    visual.setEquipment({ chest: 'chest_a' });
    expect(state.weaponItemId).toBeNull();
  });
});
