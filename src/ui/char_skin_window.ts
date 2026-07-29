import { audio } from '../game/audio';
import { MECH_CHROMAS } from '../sim/content/skins';
import { CLASSES } from '../sim/data';
import type { PlayerClass } from '../sim/types';
import {
  activeCharacterAppearancePreview,
  armorSetIconUrl,
  characterAppearanceOptions,
  offersArmorSet,
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
    player: { skin?: number; skinCatalog?: 'class' | 'mech' | 'armored'; level?: number };
    accountCosmetics: { mechChromaIds: string[] };
    changeSkin(skin: number, catalog: 'class' | 'mech' | 'armored'): void;
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
  const showArmorToggle = offersArmorSet(cls, host.sim.player.level ?? 0);
  // One chroma and no armor set means there is nothing to choose between.
  if (options.length <= 1 && !showArmorToggle) return;
  if (options.some((option) => option.kind === 'mech')) void host.preloadMechAssets();
  const current = Math.max(0, host.sim.player.skin ?? 0);
  const currentCatalog = host.sim.player.skinCatalog ?? 'class';
  const armorOn = currentCatalog === 'armored';
  // Clicking a chroma does not repaint the row, so anything a click handler needs
  // must be read LIVE rather than captured here: otherwise picking chroma 2 and then
  // pressing the armor toggle equips over a stale skin 0 and loses the chroma.
  const liveSkin = (): number => Math.max(0, host.sim.player.skin ?? 0);
  const liveArmorOn = (): boolean => (host.sim.player.skinCatalog ?? 'class') === 'armored';
  for (const option of options) {
    const labelNumber = formatNumber(option.label, { maximumFractionDigits: 0 });
    const b = document.createElement('button');
    b.type = 'button';
    // While the armor set is worn the underlying chroma stays visibly selected: it
    // is what removing the armor returns to, so showing nothing selected would be a
    // lie about the character's state.
    const selected =
      option.kind === 'mech'
        ? currentCatalog === 'mech' && option.skin === current
        : currentCatalog !== 'mech' && option.skin === current;
    b.className = `skin-swatch${selected ? ' sel' : ''}`;
    b.dataset.kind = option.kind;
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
        // Picking a chroma keeps the armor set on if it is on: the two are
        // independent, and the armored body carries the chroma index for the
        // moment the player takes the armor off again.
        const catalog = liveArmorOn() ? 'armored' : 'class';
        host.sim.changeSkin(option.skin, catalog);
        const preview = activeCharacterAppearancePreview(
          host.sim.cfg.playerClass,
          option.skin,
          catalog,
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

  // The level-20 armor set: a TOGGLE worn over the selected chroma, not one more
  // chroma. It carries `current` through so taking the armor off restores the
  // chroma the player picked instead of dumping them on the default.
  if (showArmorToggle) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = `skin-swatch skin-swatch-armor-toggle${armorOn ? ' sel' : ''}`;
    toggle.dataset.kind = 'armored';
    // role=listitem: the row is painted role=list, and an img-only button with no
    // text needs the label on the button itself for a screen reader.
    toggle.setAttribute('role', 'listitem');
    toggle.setAttribute('aria-pressed', String(armorOn));
    toggle.setAttribute('aria-label', t('skinEvent.armoredAria'));
    const art = document.createElement('img');
    art.className = 'skin-swatch-img';
    art.src = armorSetIconUrl(cls);
    art.alt = ''; // decorative: the button already carries the label
    art.draggable = false;
    art.decoding = 'async';
    toggle.appendChild(art);
    toggle.addEventListener('click', () => {
      const skin = liveSkin();
      const nextCatalog = liveArmorOn() ? 'class' : 'armored';
      host.sim.changeSkin(skin, nextCatalog);
      const preview = activeCharacterAppearancePreview(cls, skin, nextCatalog);
      host.mountCharPreview($('#char-model-preview'), cls, preview.skin, preview.visualKey);
      audio.click();
      // Repaint so the pressed state, the tooltip and the chroma selection all
      // follow the new catalog rather than going stale until the sheet reopens.
      host.renderCharIfOpen();
    });
    host.attachTooltip(
      toggle,
      () =>
        `<div class="tt-name">${esc(t('skinEvent.armored'))}</div><div class="tt-sub">${esc(
          armorOn ? t('skinEvent.armoredToggleOff') : t('skinEvent.armoredToggleOn'),
        )}</div>`,
    );
    row.appendChild(toggle);
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
