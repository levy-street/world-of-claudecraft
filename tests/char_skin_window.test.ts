// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/characters/assets', () => ({
  preloadMechAssets: vi.fn(() => Promise.resolve()),
}));

import { MECH_CHROMAS, SKIN_COUNTS } from '../src/sim/content/skins';
import { type CharSkinPainterHost, paintCharSkinPicker } from '../src/ui/char_skin_window';

type Catalog = 'class' | 'mech' | 'armored';

function makeHost(overrides?: {
  playerClass?: string;
  skin?: number;
  skinCatalog?: Catalog;
  mechChromaIds?: string[];
  level?: number;
}): CharSkinPainterHost & {
  changeSkinCalls: [number, Catalog][];
  unequipCalls: string[];
  renderBagsCalls: number;
  renderCharIfOpenCalls: number;
  preloadMechAssetsCalls: number;
} {
  const changeSkinCalls: [number, Catalog][] = [];
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
        // Below the armor-set unlock level unless a case opts in.
        level: overrides?.level ?? 1,
      },
      accountCosmetics: { mechChromaIds: overrides?.mechChromaIds ?? [] },
      changeSkin(skin: number, catalog: Catalog) {
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

  it('renders one swatch per class skin and marks the current one selected', () => {
    const host = makeHost({ skin: 1 });
    paintCharSkinPicker(host);
    const row = document.getElementById('char-skin-row') as HTMLElement;
    const swatches = row.querySelectorAll<HTMLButtonElement>('.skin-swatch');
    expect(swatches).toHaveLength(SKIN_COUNTS.mage);
    expect(swatches[1].classList.contains('sel')).toBe(true);
    expect(swatches[0].classList.contains('sel')).toBe(false);
  });

  it('clicking a class swatch commits the skin and re-mounts the preview', () => {
    const host = makeHost({ skin: 0 });
    paintCharSkinPicker(host);
    const row = document.getElementById('char-skin-row') as HTMLElement;
    const swatches = row.querySelectorAll<HTMLButtonElement>('.skin-swatch');
    swatches[2].click();
    expect(host.changeSkinCalls).toEqual([[2, 'class']]);
    expect(swatches[2].classList.contains('sel')).toBe(true);
    expect(host.mountCharPreview).toHaveBeenCalled();
  });

  it('adds the mech catalog and an unequip control once a chroma is unlocked', () => {
    const chromaId = MECH_CHROMAS[0].id;
    const host = makeHost({ skinCatalog: 'mech', skin: 0, mechChromaIds: [chromaId] });
    paintCharSkinPicker(host);
    const row = document.getElementById('char-skin-row') as HTMLElement;
    expect(row.querySelectorAll('.skin-swatch').length).toBeGreaterThan(SKIN_COUNTS.mage);
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
    const mechSwatch = row.querySelectorAll<HTMLButtonElement>('.skin-swatch')[SKIN_COUNTS.mage];
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

describe('level-20 armor-set toggle', () => {
  const armorToggle = (): HTMLButtonElement | null =>
    document.querySelector('#char-skin-row [data-kind="armored"]');

  it('is absent below the unlock level and present at it', () => {
    paintCharSkinPicker(makeHost({ level: 19 }));
    expect(armorToggle()).toBeNull();

    paintCharSkinPicker(makeHost({ level: 20 }));
    expect(armorToggle()).not.toBeNull();
  });

  it('shows the class armor art, not a chroma number', () => {
    paintCharSkinPicker(makeHost({ playerClass: 'druid', level: 20 }));
    const toggle = armorToggle();

    const art = toggle?.querySelector('img');
    expect(art?.getAttribute('src')).toBe('/ui/armor-sets/druid.webp');
    // Decorative: the accessible name lives on the button, so a screen reader must
    // not hear the filename twice.
    expect(art?.getAttribute('alt')).toBe('');
    expect(toggle?.textContent).toBe('');
    expect(toggle?.getAttribute('aria-label')).toBeTruthy();
    // The row is painted role=list, so every child has to be a listitem.
    expect(toggle?.getAttribute('role')).toBe('listitem');
  });

  it('wears the armor over the CHROMA the player already picked', () => {
    const host = makeHost({ level: 20, skin: 2, skinCatalog: 'class' });
    paintCharSkinPicker(host);

    expect(armorToggle()?.getAttribute('aria-pressed')).toBe('false');
    armorToggle()?.click();

    // skin 2, not 0: equipping the set must not silently reset the chroma.
    expect(host.changeSkinCalls).toEqual([[2, 'armored']]);
  });

  it('restores that chroma when the armor is toggled back off', () => {
    const host = makeHost({ level: 20, skin: 2, skinCatalog: 'armored' });
    paintCharSkinPicker(host);

    expect(armorToggle()?.getAttribute('aria-pressed')).toBe('true');
    armorToggle()?.click();

    expect(host.changeSkinCalls).toEqual([[2, 'class']]);
  });

  it('keeps the underlying chroma visibly selected while the armor is worn', () => {
    paintCharSkinPicker(makeHost({ level: 20, skin: 2, skinCatalog: 'armored' }));

    const chromas = [...document.querySelectorAll('#char-skin-row [data-kind="class"]')];
    // Showing nothing selected would misreport what removing the armor returns to.
    expect(chromas.findIndex((el) => el.classList.contains('sel'))).toBe(2);
    expect(armorToggle()?.classList.contains('sel')).toBe(true);
  });

  it('wears the armor over a chroma picked AFTER the row was painted', () => {
    // The regression this pins: clicking a chroma does not repaint the row, so a
    // handler that captured the skin at paint time equips over a stale 0 and throws
    // the chroma away. Only a live read survives this ordering.
    const host = makeHost({ level: 20, skin: 0, skinCatalog: 'class' });
    let liveSkin = 0;
    let liveCatalog: Catalog = 'class';
    host.sim.player.skin = 0;
    const originalChange = host.sim.changeSkin.bind(host.sim);
    host.sim.changeSkin = (skin: number, catalog: Catalog) => {
      liveSkin = skin;
      liveCatalog = catalog;
      host.sim.player.skin = skin;
      host.sim.player.skinCatalog = catalog;
      originalChange(skin, catalog);
    };
    paintCharSkinPicker(host);

    document.querySelectorAll<HTMLButtonElement>('#char-skin-row [data-kind="class"]')[2]?.click();
    expect(liveSkin).toBe(2);

    armorToggle()?.click();

    expect([liveSkin, liveCatalog]).toEqual([2, 'armored']);
  });

  it('changes chroma without taking the armor off', () => {
    const host = makeHost({ level: 20, skin: 0, skinCatalog: 'armored' });
    paintCharSkinPicker(host);

    const chromas = document.querySelectorAll<HTMLButtonElement>(
      '#char-skin-row [data-kind="class"]',
    );
    chromas[3]?.click();

    // Still 'armored': the two choices are independent.
    expect(host.changeSkinCalls).toEqual([[3, 'armored']]);
  });

  it('repaints after a toggle so the pressed state cannot go stale', () => {
    const host = makeHost({ level: 20 });
    paintCharSkinPicker(host);
    const before = host.renderCharIfOpenCalls;

    armorToggle()?.click();

    expect(host.renderCharIfOpenCalls).toBe(before + 1);
  });
});
