// The shared character turntable re-links when its weapon skin changes. The open gate's linked
// signature keys the body and the held item ids, not the skin, so two skins of one weapon type
// (Lantern Hall's try-on clicking from Hearthbrand to Squallcrest) used to read as "already
// linked" and draw the new skin's materials cold. A skin GLB that lands after the skin was set
// is dressed and re-armed too.
import { describe, expect, it, vi } from 'vitest';
import { weaponSkinModelUrl } from '../src/render/characters/manifest';
import { CharacterPreview } from '../src/render/characters/preview';
import { createPreviewOpenGate } from '../src/render/characters/preview_open_gate_core';

vi.mock('../src/render/characters/assets', () => ({
  mechAssetsReady: () => true,
  preloadMechAssets: () => Promise.resolve(),
}));

vi.mock('../src/render/characters/visual', () => ({
  CharacterVisual: class {},
}));

function stage(skinId: string | null) {
  const preview = Object.create(CharacterPreview.prototype) as CharacterPreview;
  const gate = createPreviewOpenGate();
  gate.noteLinked('["player_warrior",16777215,"worn_sword",null,null,null]');
  const visual = { setWeaponSkin: vi.fn(), refreshWeaponSkin: vi.fn() };
  const armOpen = vi.fn();
  Object.assign(preview as unknown as Record<string, unknown>, {
    destroyed: false,
    openGate: gate,
    currentVisual: visual,
    currentWeaponSkinId: skinId,
    armOpen,
  });
  return { preview, gate, visual, armOpen };
}

describe('CharacterPreview weapon-skin gate', () => {
  it('forgets the linked signature when the skin changes, keeps it when it does not', () => {
    const { preview, gate, visual } = stage('hearthbrand_sword');
    preview.setWeaponSkin('hearthbrand_sword');
    expect(gate.linkedSig()).not.toBeNull();
    // same weapon type, same held item: only the skin moved, so the next armOpen must link
    preview.setWeaponSkin('squallcrest_sword');
    expect(gate.linkedSig()).toBeNull();
    expect(visual.setWeaponSkin).toHaveBeenLastCalledWith('squallcrest_sword');
    // clearing the skin is a change too (the item's own model comes back)
    gate.noteLinked('sig');
    preview.setWeaponSkin(null);
    expect(gate.linkedSig()).toBeNull();
  });

  it('dresses a skin whose model landed late and re-arms the gate for it', () => {
    const { preview, gate, visual, armOpen } = stage('squallcrest_sword');
    const late = (preview as unknown as { refreshLateWeaponSkin(url: string): void })
      .refreshLateWeaponSkin;
    late.call(preview, weaponSkinModelUrl('hearthbrand_sword') ?? 'other.glb');
    expect(visual.refreshWeaponSkin).not.toHaveBeenCalled();
    expect(armOpen).not.toHaveBeenCalled();
    late.call(preview, weaponSkinModelUrl('squallcrest_sword') ?? '');
    expect(visual.refreshWeaponSkin).toHaveBeenCalledTimes(1);
    expect(gate.linkedSig()).toBeNull();
    expect(armOpen).toHaveBeenCalledTimes(1);
  });
});
