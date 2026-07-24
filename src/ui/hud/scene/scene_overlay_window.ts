// Thin DOM painter for the Last Bell scene overlay: the top/bottom letterbox
// bars (CSS transition, class-toggled), the bottom-center subtitle line
// (speaker + line, both stable keys rendered through t()), the full-screen
// fade layer, and the "Skip scene" hint button. Per-frame writes route
// through the shared PainterHost write-elision facet; the elements are built
// once at construction (cold path) and live directly under the HUD container.
// All styling lives in the scene overlay CSS section (tokens), never here.

import type { TranslationKey } from '../../i18n';
import { t } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import type { SceneOverlayModel } from './scene_overlay_view';

export interface SceneOverlayWindowDeps {
  document: Document;
  /** The HUD layer the overlay elements append to (#ui). */
  container: HTMLElement;
  writers: PainterHostWriters;
  /** The skip button's action (routes to IWorld.sceneSkip via the director). */
  onSkip(): void;
}

export class SceneOverlayWindow {
  private readonly barTop: HTMLElement;
  private readonly barBottom: HTMLElement;
  private readonly fadeEl: HTMLElement;
  private readonly subtitleEl: HTMLElement;
  private readonly speakerEl: HTMLElement;
  private readonly lineEl: HTMLElement;
  private readonly skipBtn: HTMLButtonElement;

  constructor(private readonly deps: SceneOverlayWindowDeps) {
    const doc = deps.document;
    const make = (tag: string, className: string): HTMLElement => {
      const el = doc.createElement(tag) as HTMLElement;
      el.className = className;
      deps.container.appendChild(el);
      return el;
    };
    this.barTop = make('div', 'scene-letterbox scene-letterbox-top');
    this.barBottom = make('div', 'scene-letterbox scene-letterbox-bottom');
    this.fadeEl = make('div', 'scene-fade');
    // Decorative layers: never announced, never hit-tested.
    for (const el of [this.barTop, this.barBottom, this.fadeEl]) {
      el.setAttribute('aria-hidden', 'true');
    }
    this.subtitleEl = make('div', 'scene-subtitle');
    this.speakerEl = doc.createElement('span');
    this.speakerEl.className = 'scene-subtitle-speaker';
    this.lineEl = doc.createElement('span');
    this.lineEl.className = 'scene-subtitle-line';
    this.subtitleEl.append(this.speakerEl, this.lineEl);
    this.skipBtn = doc.createElement('button');
    this.skipBtn.type = 'button';
    this.skipBtn.className = 'scene-skip';
    this.skipBtn.textContent = t('hudChrome.scene.skipHint');
    this.skipBtn.style.display = 'none';
    this.skipBtn.addEventListener('click', () => this.deps.onSkip());
    deps.container.appendChild(this.skipBtn);
  }

  paint(model: SceneOverlayModel): void {
    const w = this.deps.writers;
    w.toggleClass(this.barTop, 'on', model.letterbox);
    w.toggleClass(this.barBottom, 'on', model.letterbox);
    // The fade layer hides entirely at 0 so an idle HUD composites nothing.
    w.setDisplay(this.fadeEl, model.fadeOpacity > 0 ? '' : 'none');
    w.setStyleProp(this.fadeEl, 'opacity', model.fadeOpacity.toFixed(3));
    const hasLine = model.lineKey !== null;
    w.setDisplay(this.subtitleEl, hasLine ? '' : 'none');
    if (hasLine) {
      // Dialogue arrives as stable keys (S3): render t(key) directly.
      w.setText(
        this.speakerEl,
        model.speakerKey !== null ? t(model.speakerKey as TranslationKey) : '',
      );
      w.setText(this.lineEl, t(model.lineKey as TranslationKey));
    }
    w.setDisplay(this.skipBtn, model.skipHintVisible ? '' : 'none');
  }
}
