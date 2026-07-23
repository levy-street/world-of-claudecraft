import { skinCount } from '../../../render/characters/manifest';
import { playerPortraitDataUrl, visualPortraitDataUrl } from '../../../render/characters/portrait';
import { SKIN_RANKS, skinRankOrder } from '../../../sim/content/skins';
import type { PlayerClass, SkinRank } from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import { esc } from '../../esc';
import type { FocusTrapHandle } from '../../focus_manager';
import { t } from '../../i18n';
import { QUALITY_COLOR } from '../../icons';
import { svgIcon } from '../../ui_icons';
import { mechChromaName, skinRankName } from './skin_event_i18n';
import {
  defaultSkinEventChoice,
  type SkinEventChoice,
  type SkinEventMode,
  skinEventChoices,
  skinEventLandingAngle,
} from './skin_event_model';

type SkinEventWorld = Pick<IWorld, 'cfg' | 'claimEventSkin'>;

export interface SkinEventPreviewPort {
  mount(container: HTMLElement, playerClass: PlayerClass, skin: number, previewKey?: string): void;
  setSkin(skin: number): void;
}

export interface SkinEventControllerDeps {
  document: Document;
  window: Window;
  world(): SkinEventWorld;
  closeTop(): boolean;
  hideTooltip(): void;
  onPortraitsReady(callback: () => void): void;
  preloadMechAssets(): Promise<void>;
  preview: SkinEventPreviewPort;
  openFocusTrap(root: () => HTMLElement | null): FocusTrapHandle;
  attachTooltip(element: HTMLElement, html: () => string): void;
  showBanner(text: string): void;
  renderBagsIfOpen(): void;
  random(): number;
  audio: {
    bagOpen(): void;
    bagClose(): void;
    click(): void;
    cosmeticUnlock(): void;
  };
}

/** Owns the cosmetic roll reveal, selection state, focus, and claim UI. */
export class SkinEventController {
  private element: HTMLElement | null = null;
  private trap: FocusTrapHandle | null = null;
  private rank: SkinRank | null = null;
  private selected = -1;
  private selectedKey = '';
  private revealTimer: number | null = null;
  private wheelAngle = 0;
  private mode: SkinEventMode = 'class';
  private mechAssets: Promise<void> | null = null;

  constructor(private readonly deps: SkinEventControllerDeps) {}

  open(rank: SkinRank, options?: { mech?: boolean }): void {
    for (let index = 0; index < 20 && this.deps.closeTop(); index++) {
      // Close stacked HUD surfaces before the roll reveal.
    }
    this.rank = rank;
    this.mode = options?.mech ? 'mech' : 'class';
    if (this.mode === 'mech') this.mechAssets = this.deps.preloadMechAssets();
    this.wheelAngle = skinEventLandingAngle(rank, this.deps.random);
    const selected = defaultSkinEventChoice(rank, skinEventChoices(this.mode), (choice) =>
      this.choiceAvailable(choice.index),
    );
    this.selected = selected?.index ?? -1;
    this.selectedKey = selected?.key ?? '';
    this.deps.hideTooltip();
    const reveal = (): void => {
      if (this.rank === null) return;
      if (this.mode === 'mech' && this.mechAssets) {
        void this.mechAssets.then(() => {
          if (this.rank !== null) this.renderChoices();
        });
      } else {
        this.renderChoices();
      }
    };
    this.deps.onPortraitsReady(() => {
      if (this.element?.classList.contains('open') && this.revealTimer === null) reveal();
    });
    this.renderWheel();
    const reduceMotion = this.deps.window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.revealTimer !== null) this.deps.window.clearTimeout(this.revealTimer);
    this.revealTimer = this.deps.window.setTimeout(
      () => {
        this.revealTimer = null;
        reveal();
      },
      reduceMotion ? 140 : 6600,
    );
    this.deps.audio.bagOpen();
  }

  close(): void {
    if (!this.element) return;
    if (this.revealTimer !== null) {
      this.deps.window.clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
    this.element.classList.remove('open');
    this.trap?.release();
    this.trap = null;
    this.rank = null;
    this.mode = 'class';
    this.selectedKey = '';
    this.wheelAngle = 0;
    this.deps.audio.bagClose();
  }

  private root(): HTMLElement {
    if (this.element) return this.element;
    const element = this.deps.document.createElement('div');
    element.id = 'skin-event';
    element.className = 'skin-event-overlay';
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });
    element.addEventListener('mousedown', (event) => {
      if (event.target === element) this.close();
    });
    this.deps.document.body.appendChild(element);
    this.element = element;
    return element;
  }

  private choiceAvailable(index: number): boolean {
    if (this.mode === 'mech') return true;
    return index < skinCount(`player_${this.deps.world().cfg.playerClass}`);
  }

  private choiceThumb(index: number): string | null {
    return this.mode === 'mech'
      ? visualPortraitDataUrl('player_mech', index)
      : playerPortraitDataUrl(this.deps.world().cfg.playerClass, index);
  }

  private choiceName(choice: Pick<SkinEventChoice, 'rank' | 'id'>): string {
    return this.mode === 'mech' && choice.id
      ? mechChromaName(choice.id)
      : skinRankName(choice.rank);
  }

  private renderWheel(): void {
    const rank = this.rank;
    if (rank === null) return;
    const element = this.root();
    const title = esc(t('skinEvent.title'));
    const landed = esc(skinRankName(rank));
    element.innerHTML =
      `<div class="se-wheel-stage" role="dialog" aria-modal="true" aria-label="${title}">` +
      `<div class="se-wheel-pointer" aria-hidden="true"></div>` +
      `<div class="se-wheel" style="--land-angle:${this.wheelAngle}deg" aria-hidden="true">` +
      `<svg class="se-wheel-labels" viewBox="0 0 200 200">` +
      `<defs><path id="se-wheel-label-ring" d="M 100 25 A 75 75 0 1 1 99.9 25"/></defs>` +
      `<text class="se-wheel-label-bg uncommon"><textPath href="#se-wheel-label-ring" startOffset="4%">${esc(skinRankName('uncommon'))}</textPath></text>` +
      `<text class="se-wheel-label-bg rare"><textPath href="#se-wheel-label-ring" startOffset="48%">${esc(skinRankName('rare'))}</textPath></text>` +
      `<text class="se-wheel-label-bg epic"><textPath href="#se-wheel-label-ring" startOffset="69%">${esc(skinRankName('epic'))}</textPath></text>` +
      `<text class="se-wheel-label-fg"><textPath href="#se-wheel-label-ring" startOffset="4%">${esc(skinRankName('uncommon'))}</textPath></text>` +
      `<text class="se-wheel-label-fg"><textPath href="#se-wheel-label-ring" startOffset="48%">${esc(skinRankName('rare'))}</textPath></text>` +
      `<text class="se-wheel-label-fg"><textPath href="#se-wheel-label-ring" startOffset="69%">${esc(skinRankName('epic'))}</textPath></text>` +
      `</svg>` +
      `</div>` +
      `<div class="se-wheel-result" style="--tier-color:${QUALITY_COLOR[rank] ?? '#fff'}">` +
      `<span>${landed}</span>` +
      `<i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>` +
      `<b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b>` +
      `<b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b></div>` +
      `</div>`;
    if (!this.trap) this.trap = this.deps.openFocusTrap(() => this.element);
    element.classList.add('open');
  }

  private renderChoices(): void {
    const rank = this.rank;
    if (rank === null) return;
    const world = this.deps.world();
    const playerClass = world.cfg.playerClass;
    const granted = skinRankOrder(rank);
    const mech = this.mode === 'mech';
    const previewKey = mech ? 'player_mech' : `player_${playerClass}`;
    const element = this.root();
    const title = esc(t('skinEvent.title'));
    const rankName = skinRankName(rank);
    element.innerHTML =
      `<div class="panel skin-event-panel" role="dialog" aria-modal="true" aria-label="${title}">` +
      `<div class="se-body"><div class="se-left">` +
      `<div class="se-roll-banner" style="--tier-color:${QUALITY_COLOR[rank] ?? '#fff'}">${esc(t('skinEvent.rolled', { rank: rankName }))}</div>` +
      `<div class="se-tiers" role="radiogroup" aria-label="${title}"></div>` +
      `<button type="button" class="btn se-lockin" data-lockin>${esc(t('skinEvent.lockIn'))}</button>` +
      `</div><div class="se-preview-col">` +
      `<div class="se-preview"><div class="se-preview-hint">${esc(t('skinEvent.previewHint'))}</div></div>` +
      `<div class="se-preview-name" data-preview-name></div>` +
      `</div></div></div>`;

    const tiersElement = element.querySelector('.se-tiers') as HTMLElement;
    const lockButton = element.querySelector('[data-lockin]') as HTMLButtonElement;
    const swatches: HTMLButtonElement[] = [];
    const syncSelection = (): void => {
      let selectedCanLock = false;
      for (const swatch of swatches) {
        const selected = swatch.dataset.choice === this.selectedKey;
        swatch.classList.toggle('sel', selected);
        swatch.setAttribute('aria-checked', String(selected));
        swatch.tabIndex = selected ? 0 : -1;
        if (selected && swatch.dataset.lockable === 'true') selectedCanLock = true;
      }
      lockButton.disabled = !selectedCanLock;
    };
    const nameElement = element.querySelector('[data-preview-name]') as HTMLElement;
    const select = (choice: SkinEventChoice): void => {
      this.selected = choice.index;
      this.selectedKey = choice.key;
      this.deps.preview.setSkin(choice.index);
      nameElement.textContent = this.choiceName(choice);
      syncSelection();
      this.deps.audio.click();
    };

    const choices = skinEventChoices(this.mode);
    for (const tierRank of [...SKIN_RANKS].reverse()) {
      const rankChoices = choices.filter((choice) => choice.rank === tierRank);
      if (rankChoices.length === 0) continue;
      const unlocked = skinRankOrder(tierRank) <= granted;
      const anyAvailable = rankChoices.some((choice) => this.choiceAvailable(choice.index));
      const rawName = skinRankName(tierRank);
      const row = this.deps.document.createElement('div');
      row.className = `se-tier${unlocked ? '' : ' locked'}`;
      row.style.setProperty('--tier-color', QUALITY_COLOR[tierRank] ?? '#fff');
      const hint = !unlocked
        ? `<span class="se-tier-hint">${svgIcon('lock')}${esc(t('skinEvent.lockedHint', { rank: rawName }))}</span>`
        : !anyAvailable
          ? `<span class="se-tier-hint">${esc(t('skinEvent.unavailable'))}</span>`
          : '';
      row.innerHTML =
        `<div class="se-tier-head"><span class="se-tier-name">${esc(rawName)}</span>${hint}</div>` +
        `<div class="se-swatches"></div>`;
      const swatchesElement = row.querySelector('.se-swatches') as HTMLElement;
      rankChoices.forEach((choice, index) => {
        const available = this.choiceAvailable(choice.index);
        const label = this.choiceName(choice);
        const button = this.deps.document.createElement('button');
        button.type = 'button';
        button.className = 'se-swatch';
        button.dataset.skin = String(choice.index);
        button.dataset.choice = choice.key;
        button.dataset.lockable = String(unlocked && available);
        button.setAttribute('role', 'radio');
        if (available) {
          const url = this.choiceThumb(choice.index);
          if (!unlocked) button.classList.add('locked');
          button.innerHTML = url ? `<img src="${esc(url)}" alt="">` : String(index + 1);
          button.setAttribute(
            'aria-label',
            mech ? label : t('skinEvent.optionAria', { rank: rawName, index: index + 1 }),
          );
          button.addEventListener('click', () => select(choice));
          this.deps.attachTooltip(
            button,
            () =>
              `<div class="tt-name">${esc(label)}</div>` +
              (unlocked
                ? ''
                : `<div class="tt-sub">${esc(t('skinEvent.lockedHint', { rank: rawName }))}</div>`),
          );
          swatches.push(button);
        } else {
          button.classList.add('unavailable');
          button.setAttribute('aria-disabled', 'true');
          button.innerHTML = unlocked
            ? '<span class="se-lock">&#8212;</span>'
            : `<span class="se-lock">${svgIcon('lock')}</span>`;
          button.setAttribute(
            'aria-label',
            unlocked ? t('skinEvent.unavailable') : t('skinEvent.locked'),
          );
          this.deps.attachTooltip(
            button,
            () =>
              `<div class="tt-name">${esc(rawName)}</div><div class="tt-sub">${esc(t('skinEvent.unavailable'))}</div>`,
          );
        }
        swatchesElement.appendChild(button);
      });
      tiersElement.appendChild(row);
    }

    lockButton.addEventListener('click', () => {
      if (this.selected < 0 || lockButton.disabled) return;
      this.deps.world().claimEventSkin(this.selected);
      this.deps.showBanner(t('skinEvent.unlocked'));
      this.deps.audio.cosmeticUnlock();
      this.close();
      this.deps.renderBagsIfOpen();
    });
    if (!this.trap) this.trap = this.deps.openFocusTrap(() => this.element);
    element.classList.add('open');
    this.deps.preview.mount(
      element.querySelector('.se-preview') as HTMLElement,
      playerClass,
      this.selected >= 0 ? this.selected : 0,
      mech ? previewKey : undefined,
    );
    const selectedChoice = choices.find((choice) => choice.key === this.selectedKey);
    if (selectedChoice) nameElement.textContent = this.choiceName(selectedChoice);
    syncSelection();
    (swatches.find((swatch) => swatch.dataset.choice === this.selectedKey) ?? swatches[0])?.focus();
  }
}
