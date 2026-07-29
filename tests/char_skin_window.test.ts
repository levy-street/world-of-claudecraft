// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/characters/assets', () => ({
  preloadMechAssets: vi.fn(() => Promise.resolve()),
}));

import { MECH_CHROMAS, SKIN_COUNTS } from '../src/sim/content/skins';
import { type CharSkinPainterHost, paintCharSkinPicker } from '../src/ui/char_skin_window';

function makeHost(overrides?: {
  playerClass?: string;
  skin?: number;
  skinCatalog?: 'class' | 'mech';
  mechChromaIds?: string[];
}): CharSkinPainterHost & {
  changeSkinCalls: [number, 'class' | 'mech'][];
  unequipCalls: string[];
  renderBagsCalls: number;
  renderCharIfOpenCalls: number;
  preloadMechAssetsCalls: number;
} {
  const changeSkinCalls: [number, 'class' | 'mech'][] = [];
  const unequipCalls: string[] = [];
  let renderBagsCalls = 0;
  let renderCharIfOpenCalls = 0;
  let preloadMechAssetsCalls = 0;
  return {
    sim: {
      cfg: { playerClass: (overrides?.playerClass ?? 'mage') as never },
      player: {
        skin: overrides?.skin ?? 0,
        skinCatalog: overrides?.skinCatalog ?? 'class',
      },
      accountCosmetics: { mechChromaIds: overrides?.mechChromaIds ?? [] },
      changeSkin(skin: number, catalog: 'class' | 'mech') {
        changeSkinCalls.push([skin, catalog]);
      },
      unequipMechChroma(id: string) {
        unequipCalls.push(id);
      },
    },
    preloadMechAssets: () => {
      preloadMechAssetsCalls++;
      return Promise.resolve();
    },
    mountCharPreview: vi.fn(),
    attachTooltip: vi.fn(),
    renderBags: () => {
      renderBagsCalls++;
    },
    renderCharIfOpen: () => {
      renderCharIfOpenCalls++;
    },
    get changeSkinCalls() {
      return changeSkinCalls;
    },
    get unequipCalls() {
      return unequipCalls;
    },
    get renderBagsCalls() {
      return renderBagsCalls;
    },
    get renderCharIfOpenCalls() {
      return renderCharIfOpenCalls;
    },
    get preloadMechAssetsCalls() {
      return preloadMechAssetsCalls;
    },
  } as unknown as CharSkinPainterHost & {
    changeSkinCalls: [number, 'class' | 'mech'][];
    unequipCalls: string[];
    renderBagsCalls: number;
    renderCharIfOpenCalls: number;
    preloadMechAssetsCalls: number;
  };
}

describe('char_skin_window: paintCharSkinPicker (extracted from hud.ts)', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="char-skin-row"></div>' +
      '<div id="char-window" style="display:block"></div>' +
      '<div id="char-model-preview"></div>';
  });

  it('does nothing when the row is missing from the DOM', () => {
    document.body.innerHTML = '';
    expect(() => paintCharSkinPicker(makeHost())).not.toThrow();
  });

  // The numbered class chromas are retired: the appearance customizer composes
  // the body, so the row is empty for a player who owns no mech chroma.
  it('renders no swatch at all for the retired class chromas', () => {
    const host = makeHost({ skin: 1 });
    paintCharSkinPicker(host);
    const row = document.getElementById('char-skin-row') as HTMLElement;
    expect(row.querySelectorAll('.skin-swatch')).toHaveLength(0);
    expect(row.querySelector('.skin-unequip-btn')).toBeNull();
  });

  it('shows ONLY the mech catalog, never a class swatch, once a chroma is unlocked', () => {
    const chromaId = MECH_CHROMAS[0].id;
    const host = makeHost({ skinCatalog: 'mech', skin: 0, mechChromaIds: [chromaId] });
    paintCharSkinPicker(host);
    const row = document.getElementById('char-skin-row') as HTMLElement;
    // One swatch per OWNED chroma, and not one of the class skins with them
    // (the old row opened with SKIN_COUNTS.mage of those before the mech set).
    const swatches = row.querySelectorAll('.skin-swatch');
    expect(swatches).toHaveLength(1);
    expect(swatches.length).toBeLessThan(SKIN_COUNTS.mage);
  });

  // A mech wearer must keep a way back to their own character: the row is the
  // only host for that control, so it survives the class-chroma retirement.
  it('keeps the unequip control so a mech wearer is never stranded', () => {
    const chromaId = MECH_CHROMAS[0].id;
    const host = makeHost({ skinCatalog: 'mech', skin: 0, mechChromaIds: [chromaId] });
    paintCharSkinPicker(host);
    const row = document.getElementById('char-skin-row') as HTMLElement;
    const unequip = row.querySelector<HTMLButtonElement>('.skin-unequip-btn');
    expect(unequip).not.toBeNull();
    unequip?.click();
    expect(host.unequipCalls).toEqual([chromaId]);
    expect(host.renderBagsCalls).toBe(1);
    expect(host.renderCharIfOpenCalls).toBe(1);
  });

  it('omits the unequip control when the equipped chroma is not in the unlocked set', () => {
    const host = makeHost({ skinCatalog: 'mech', skin: 0, mechChromaIds: [] });
    paintCharSkinPicker(host);
    const row = document.getElementById('char-skin-row') as HTMLElement;
    expect(row.querySelector('.skin-unequip-btn')).toBeNull();
  });

  it('clicking a mech swatch commits the skin and re-mounts the preview once assets load', async () => {
    const chromaId = MECH_CHROMAS[0].id;
    const host = makeHost({ skinCatalog: 'class', skin: 0, mechChromaIds: [chromaId] });
    paintCharSkinPicker(host);
    const row = document.getElementById('char-skin-row') as HTMLElement;
    // First swatch in the row is now the first MECH chroma: the class skins
    // that used to occupy those slots are gone.
    const mechSwatch = row.querySelectorAll<HTMLButtonElement>('.skin-swatch')[0];
    mechSwatch.click();
    expect(host.changeSkinCalls).toEqual([[0, 'mech']]);
    expect(mechSwatch.classList.contains('sel')).toBe(true);
    // preloadMechAssets is prewarmed once on render (mech options present), then
    // again on click, mirroring the display:block + .sel guard in the mocked promise chain.
    expect(host.preloadMechAssetsCalls).toBeGreaterThanOrEqual(2);
    expect(host.mountCharPreview).not.toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(host.mountCharPreview).toHaveBeenCalled();
  });
});
