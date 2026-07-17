import { audio } from '../game/audio';
import { MECH_CHROMAS } from '../sim/content/skins';
import { CLASSES } from '../sim/data';
import type { PlayerClass } from '../sim/types';
import {
  activeCharacterAppearancePreview,
  characterAppearanceOptions,
} from './character_appearance';
import { esc } from './esc';
import { mechChromaName } from './hud/cosmetics';
import { formatNumber, t } from './i18n';

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;

const classCss = (cls: string): string =>
  `#${((CLASSES as Record<string, { color: number }>)[cls]?.color ?? 0x5fa8ff).toString(16).padStart(6, '0')}`;

/** The explicit dependency object `hud.ts`'s `skinHost()` builds for this module.
 *  `sim`/`mechAssetsPromise`/`mountCharPreview`/`renderCharIfOpen` all name private
 *  `Hud` members, so a structural `Hud`-as-host cast would have to go through
 *  `unknown` and lose all compile-time coverage of the seam; passing bound
 *  closures instead (the same idiom `SkinEventController` and `BagsWindow` use)
 *  keeps tsc checking every member. */
export interface CharSkinPainterHost {
  readonly sim: {
    cfg: { playerClass: PlayerClass };
    player: { skin?: number; skinCatalog?: 'class' | 'mech' };
    accountCosmetics: { mechChromaIds: string[] };
    changeSkin(skin: number, catalog: 'class' | 'mech'): void;
    unequipMechChroma(id: string): void;
  };
  preloadMechAssets(): Promise<void>;
  mountCharPreview(
    container: HTMLElement,
    cls: PlayerClass,
    skin: number,
    previewKey?: string,
  ): void;
  attachTooltip(el: HTMLElement, html: () => string): void;
  renderBags(): void;
  renderCharIfOpen(): void;
}

/** The character-sheet skin (chroma) picker row: renders one swatch per
 *  unlocked class skin plus, once at least one mech chroma is owned, the
 *  Combat Mech catalog swatches and an unequip control. Wired via the
 *  `CharSkinPainterHost` deps object `hud.ts`'s `skinHost()` builds.
 *  Distinct from the cosmetic skin-roll reveal overlay, which lives in
 *  `hud/cosmetics/skin_event_controller.ts`. */
export function paintCharSkinPicker(host: CharSkinPainterHost): void {
  const row = $('#char-skin-row') as HTMLElement | null;
  if (!row) return;
  const cls = host.sim.cfg.playerClass;
  const options = characterAppearanceOptions(cls, host.sim.accountCosmetics.mechChromaIds);
  row.innerHTML = '';
  row.style.setProperty('--class-color', classCss(cls));
  if (options.length <= 1) return;
  if (options.some((option) => option.kind === 'mech')) void host.preloadMechAssets();
  const current = Math.max(0, host.sim.player.skin ?? 0);
  const currentCatalog = host.sim.player.skinCatalog ?? 'class';
  for (const option of options) {
    const labelNumber = formatNumber(option.label, { maximumFractionDigits: 0 });
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `skin-swatch${option.kind === currentCatalog && option.skin === current ? ' sel' : ''}`;
    b.textContent = labelNumber;
    b.setAttribute('role', 'listitem');
    b.setAttribute(
      'aria-label',
      option.kind === 'class'
        ? t('auth.chromaOption', { n: labelNumber })
        : mechChromaName(option.chromaId),
    );
    b.addEventListener('click', () => {
      row.querySelectorAll('.skin-swatch').forEach((x) => {
        x.classList.remove('sel');
      });
      b.classList.add('sel');
      if (option.kind === 'class') {
        host.sim.changeSkin(option.skin, 'class');
        const preview = activeCharacterAppearancePreview(
          host.sim.cfg.playerClass,
          option.skin,
          'class',
        );
        host.mountCharPreview(
          $('#char-model-preview'),
          host.sim.cfg.playerClass,
          preview.skin,
          preview.visualKey,
        );
        return;
      }
      host.sim.changeSkin(option.skin, 'mech');
      void host
        .preloadMechAssets()
        .then(() => {
          if (
            ($('#char-window') as HTMLElement).style.display === 'block' &&
            b.classList.contains('sel')
          ) {
            const preview = activeCharacterAppearancePreview(
              host.sim.cfg.playerClass,
              option.skin,
              'mech',
            );
            host.mountCharPreview(
              $('#char-model-preview'),
              host.sim.cfg.playerClass,
              preview.skin,
              preview.visualKey,
            );
          }
        })
        .catch((err) => console.error('failed to load mech cosmetic preview:', err));
      audio.click();
    });
    if (option.kind === 'mech') {
      host.attachTooltip(
        b,
        () =>
          `<div class="tt-name">${esc(mechChromaName(option.chromaId))}</div><div class="tt-sub">${esc(t('skinEvent.unlocked'))}</div>`,
      );
    }
    row.appendChild(b);
  }
  const currentChroma = currentCatalog === 'mech' ? MECH_CHROMAS[current] : null;
  if (currentChroma && host.sim.accountCosmetics.mechChromaIds.includes(currentChroma.id)) {
    const unequip = document.createElement('button');
    unequip.type = 'button';
    unequip.className = 'skin-unequip-btn';
    unequip.textContent = t('skinEvent.unequip');
    unequip.setAttribute('aria-label', t('skinEvent.unequip'));
    unequip.addEventListener('click', () => {
      host.sim.unequipMechChroma(currentChroma.id);
      audio.click();
      host.renderBags();
      host.renderCharIfOpen();
    });
    host.attachTooltip(
      unequip,
      () =>
        `<div class="tt-name">${esc(mechChromaName(currentChroma.id))}</div><div class="tt-sub">${esc(t('skinEvent.unequip'))}</div>`,
    );
    row.appendChild(unequip);
  }
}
