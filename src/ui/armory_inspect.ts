// Season 1 Armory inspect panel: a body-level overlay the store opens when a
// skin card is clicked. Left is a live 3D viewport (src/render/armory_preview):
// "tried on" the player's own character under a day / dusk / night scene, or the
// weapon alone on a showcase turntable. Right is the codex side: collection,
// rarity, the in-game look line, the full lore, the price, and the Buy / Apply /
// Detach actions. All player-visible strings, including skin names,
// collections, look and lore, resolve through the runtime locale catalog.
import {
  type ArmoryPreviewHandle,
  type ArmoryPreviewMode,
  type ArmorySceneKey,
  createArmoryPreview,
} from '../render/armory_preview';
import type { PreviewAppearance } from '../render/characters';
import type { WeaponSkinType } from '../sim/types';
import {
  badgeLabel,
  localizeWeaponSkin,
  rarityLabel,
  sceneLabel,
  weaponTypeLabel,
} from './armory_labels';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';
import type { ArmorySkinRow } from './woc_store_view';

export interface ArmoryInspectDeps {
  appearance(): PreviewAppearance;
  requestBuy(row: ArmorySkinRow): void;
  applySkin(skinId: string): void;
  detachSkin(weaponType: WeaponSkinType): void;
}

const SCENES: readonly ArmorySceneKey[] = ['day', 'dusk', 'night'];

export class ArmoryInspect {
  private overlay: HTMLElement | null = null;
  private preview: ArmoryPreviewHandle | null = null;
  private row: ArmorySkinRow | null = null;
  private mode: ArmoryPreviewMode = 'character';
  private sceneKey: ArmorySceneKey = 'day';
  private openerFocus: HTMLElement | null = null;

  constructor(private readonly deps: ArmoryInspectDeps) {}

  get isOpen(): boolean {
    return this.overlay !== null;
  }

  get openSkinId(): string | null {
    return this.row?.skin.id ?? null;
  }

  open(row: ArmorySkinRow): void {
    this.close();
    this.row = row;
    this.openerFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = document.createElement('div');
    overlay.className = 'armory-inspect-overlay open';
    overlay.addEventListener('keydown', (event) => {
      // A confirm prompt stacked above this overlay owns the keyboard: its own
      // focus trap handles Tab, and Escape must not close the inspect panel out
      // from under a live purchase prompt.
      if (document.getElementById('confirm-dialog')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.close();
        return;
      }
      // Modal Tab trap: cycle within the dialog's enabled buttons.
      if (event.key !== 'Tab') return;
      const focusables = overlay.querySelectorAll<HTMLElement>('button:not([disabled])');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !overlay.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !overlay.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    });
    overlay.addEventListener('mousedown', (event) => {
      if (document.getElementById('confirm-dialog')) return;
      if (event.target === overlay) this.close();
    });
    const copy = localizeWeaponSkin(row.skin);
    overlay.innerHTML =
      `<div class="armory-inspect rarity-${esc(row.skin.rarity)}" role="dialog" aria-modal="true" aria-label="${esc(t('hudChrome.wocStore.inspectAria', { item: copy.name }))}">` +
      `<button type="button" class="x-btn armory-inspect-close" data-armory-close aria-label="${esc(t('hudChrome.wocStore.close'))}">${svgIcon('close')}</button>` +
      `<div class="armory-inspect-stage"><canvas data-armory-canvas></canvas>` +
      `<div class="armory-inspect-controls">` +
      `<div class="armory-mode-toggle" role="group" aria-label="${esc(t('hudChrome.wocStore.viewModeLabel'))}">` +
      `<button type="button" data-armory-mode="character">${esc(t('hudChrome.wocStore.tryOn'))}</button>` +
      `<button type="button" data-armory-mode="weapon">${esc(t('hudChrome.wocStore.weaponOnly'))}</button></div>` +
      `<div class="armory-scene-toggle" role="group" aria-label="${esc(t('hudChrome.wocStore.sceneLabel'))}">` +
      SCENES.map(
        (scene) =>
          `<button type="button" data-armory-scene="${scene}">${esc(sceneLabel(scene))}</button>`,
      ).join('') +
      `</div></div></div>` +
      `<div class="armory-inspect-panel">` +
      `<div class="armory-inspect-details">` +
      `<div class="armory-inspect-head">` +
      `<span class="armory-collection">${esc(t('hudChrome.wocStore.collectionLine', { collection: copy.collection }))}</span>` +
      `<span class="armory-rarity-pill">${esc(rarityLabel(row.skin.rarity))}</span>` +
      (row.skin.badge
        ? `<span class="armory-badge">${esc(badgeLabel(row.skin.badge))}</span>`
        : '') +
      `</div>` +
      `<h2>${esc(copy.name)}</h2>` +
      `<p class="armory-type-line">${esc(weaponTypeLabel(row.skin.weaponType))} · ${esc(t('hudChrome.wocStore.seasonOne'))}</p>` +
      `<p class="armory-look">${esc(copy.look)}</p>` +
      `<div class="armory-lore"><h3>${esc(t('hudChrome.wocStore.lore'))}</h3><p>${esc(copy.lore)}</p></div>` +
      `</div>` +
      `<div class="armory-inspect-actions" data-armory-actions></div>` +
      `</div></div>`;
    document.body.appendChild(overlay);
    this.overlay = overlay;
    overlay.querySelector('[data-armory-close]')?.addEventListener('click', () => this.close());
    overlay.querySelectorAll<HTMLButtonElement>('[data-armory-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        const mode = button.dataset.armoryMode as ArmoryPreviewMode;
        this.mode = mode;
        this.preview?.setMode(mode);
        this.syncToggles();
      });
    });
    overlay.querySelectorAll<HTMLButtonElement>('[data-armory-scene]').forEach((button) => {
      button.addEventListener('click', () => {
        const scene = button.dataset.armoryScene as ArmorySceneKey;
        this.sceneKey = scene;
        this.preview?.setScene(scene);
        this.syncToggles();
      });
    });
    const stage = overlay.querySelector<HTMLElement>('.armory-inspect-stage');
    const canvas = overlay.querySelector<HTMLCanvasElement>('[data-armory-canvas]');
    if (stage && canvas) {
      this.preview = createArmoryPreview(stage, canvas, this.deps.appearance());
      this.preview.setScene(this.sceneKey);
      this.preview.setMode(this.mode);
      this.preview.setSkin(row.skin.id);
    }
    this.paintActions();
    this.syncToggles();
    (overlay.querySelector('[data-armory-close]') as HTMLElement | null)?.focus();
  }

  /** Re-project the action row after ownership or loadout changed. */
  refresh(row: ArmorySkinRow): void {
    if (!this.overlay || this.row?.skin.id !== row.skin.id) return;
    this.row = row;
    this.paintActions();
  }

  close(): void {
    const wasOpen = this.overlay !== null;
    this.preview?.dispose();
    this.preview = null;
    this.overlay?.remove();
    this.overlay = null;
    this.row = null;
    if (wasOpen && this.openerFocus?.isConnected) this.openerFocus.focus();
    this.openerFocus = null;
  }

  private syncToggles(): void {
    const overlay = this.overlay;
    if (!overlay) return;
    overlay.querySelectorAll<HTMLButtonElement>('[data-armory-mode]').forEach((button) => {
      const active = button.dataset.armoryMode === this.mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    overlay.querySelectorAll<HTMLButtonElement>('[data-armory-scene]').forEach((button) => {
      const active = button.dataset.armoryScene === this.sceneKey;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  private paintActions(): void {
    const host = this.overlay?.querySelector<HTMLElement>('[data-armory-actions]');
    const row = this.row;
    if (!host || !row) return;
    const price =
      row.costClaudium === null
        ? ''
        : `<span class="armory-price"><img src="/claudium/icons/claudium_coin_64.webp" alt="">` +
          `<strong>${formatNumber(row.costClaudium, { maximumFractionDigits: 0 })}</strong></span>`;
    let actions = '';
    if (!row.owned) {
      const canBuy = row.purchasable && row.costClaudium !== null;
      const label = canBuy ? t('hudChrome.wocStore.buySkin') : t('hudChrome.wocStore.unavailable');
      actions =
        `${price}<button type="button" class="armory-buy" data-armory-buy${canBuy ? '' : ' disabled'}>` +
        `${esc(label)}</button>`;
    } else if (row.applied) {
      actions =
        `<span class="armory-owned-pill applied">${esc(t('hudChrome.wocStore.applied'))}</span>` +
        `<button type="button" class="armory-detach" data-armory-detach>${esc(t('hudChrome.wocStore.detach'))}</button>`;
    } else if (row.canApplyNow) {
      actions =
        `<span class="armory-owned-pill">${esc(t('hudChrome.wocStore.owned'))}</span>` +
        `<button type="button" class="armory-apply" data-armory-apply>${esc(t('hudChrome.wocStore.apply'))}</button>`;
    } else {
      actions =
        `<span class="armory-owned-pill">${esc(t('hudChrome.wocStore.owned'))}</span>` +
        `<span class="armory-equip-hint">${esc(t('hudChrome.wocStore.equipHint', { type: weaponTypeLabel(row.skin.weaponType) }))}</span>`;
    }
    host.innerHTML = actions;
    host.querySelector<HTMLButtonElement>('[data-armory-buy]')?.addEventListener('click', () => {
      if (this.row) this.deps.requestBuy(this.row);
    });
    host.querySelector<HTMLButtonElement>('[data-armory-apply]')?.addEventListener('click', () => {
      if (this.row) this.deps.applySkin(this.row.skin.id);
    });
    host.querySelector<HTMLButtonElement>('[data-armory-detach]')?.addEventListener('click', () => {
      if (this.row) this.deps.detachSkin(this.row.skin.weaponType);
    });
  }
}
