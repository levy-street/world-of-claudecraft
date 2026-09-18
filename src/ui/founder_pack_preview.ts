// The Founder Pack store's side preview panel (#founder-pack-preview-window):
// a small window to the left of the store that shows a live 3D model for
// whatever the player is looking at. Two modes on one host element, never
// both at once: 'skin' mounts the SAME shared CharacterPreview the character
// sheet's skin picker uses (hud.ts mountCharPreview), so a Founder skin
// previews exactly the body the world would render; 'mount' owns its own
// small standalone turntable (render/founder_pack_mount_preview.ts), the
// armory_preview.ts showcase-mode idiom, since no shared mount-preview
// context exists yet.
import { createFounderPackMountPreview } from '../render/founder_pack_mount_preview';
import type { FounderSkinDef } from '../sim/content/founder_pack';
import type { MountKey } from '../sim/content/mounts';
import type { PlayerClass } from '../sim/types';
import { activeCharacterAppearancePreview } from './character_appearance';
import { esc } from './esc';
import { t } from './i18n';
import { svgIcon } from './ui_icons';

export interface FounderPackPreviewDeps {
  mountCharPreview(
    container: HTMLElement,
    cls: PlayerClass,
    skin: number,
    previewKey?: string,
  ): void;
  onClose(): void;
}

export class FounderPackPreviewPanel {
  private el: HTMLElement | null = null;
  private modelHost: HTMLElement | null = null;
  private mountCanvas: HTMLCanvasElement | null = null;
  private mountPreview: ReturnType<typeof createFounderPackMountPreview> | null = null;

  get isOpen(): boolean {
    return this.el !== null && this.el.style.display === 'block';
  }

  /** Build the panel shell into `el` once (idempotent); called every open so a
   *  locale change or a first-open re-paints the static chrome. */
  private ensureShell(el: HTMLElement, deps: FounderPackPreviewDeps): void {
    if (this.el === el && this.modelHost) return;
    this.el = el;
    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('hudChrome.founderShop.previewTitle'))}</span>` +
      `<button type="button" class="x-btn" data-preview-close aria-label="${esc(t('hudChrome.founderShop.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="founder-preview-stage">` +
      `<div class="founder-preview-model" data-founder-preview-model></div>` +
      `<canvas class="founder-preview-canvas" data-founder-preview-canvas></canvas>` +
      `</div>` +
      `<p class="founder-preview-empty" data-founder-preview-empty>${esc(t('hudChrome.founderShop.previewEmpty'))}</p>`;
    el.querySelector('[data-preview-close]')?.addEventListener('click', () => deps.onClose());
    this.modelHost = el.querySelector<HTMLElement>('[data-founder-preview-model]');
    this.mountCanvas = el.querySelector<HTMLCanvasElement>('[data-founder-preview-canvas]');
  }

  private setMode(next: 'skin' | 'mount' | null): void {
    if (this.modelHost) this.modelHost.style.display = next === 'skin' ? 'block' : 'none';
    if (this.mountCanvas) this.mountCanvas.style.display = next === 'mount' ? 'block' : 'none';
    const empty = this.el?.querySelector<HTMLElement>('[data-founder-preview-empty]');
    if (empty) empty.style.display = next === null ? 'block' : 'none';
    this.mountPreview?.setActive(next === 'mount');
  }

  open(el: HTMLElement, deps: FounderPackPreviewDeps): void {
    this.ensureShell(el, deps);
    el.style.display = 'block';
    this.setMode(null);
  }

  close(): void {
    this.mountPreview?.setActive(false);
    if (this.el) this.el.style.display = 'none';
  }

  /** Preview a Founder skin on the class it belongs to: the same body the
   *  world would render (no chroma; skin index is always 0). */
  showSkin(skin: FounderSkinDef, deps: FounderPackPreviewDeps): void {
    if (!this.el || !this.modelHost) return;
    this.setMode('skin');
    const preview = activeCharacterAppearancePreview(skin.requiredClass, 0, skin.catalog);
    deps.mountCharPreview(this.modelHost, skin.requiredClass, preview.skin, preview.visualKey);
  }

  showMount(key: MountKey): void {
    if (!this.el || !this.mountCanvas) return;
    this.setMode('mount');
    if (!this.mountPreview) {
      this.mountPreview = createFounderPackMountPreview(this.el, this.mountCanvas);
    }
    this.mountPreview.setMount(key);
    this.mountPreview.setActive(true);
  }

  dispose(): void {
    this.mountPreview?.dispose();
    this.mountPreview = null;
    this.el = null;
    this.modelHost = null;
    this.mountCanvas = null;
  }
}
