// Thin DOM painter for the Last Bell scene overlay: the top/bottom letterbox
// bars (CSS transition, class-toggled), the bottom-center subtitle line
// (speaker + line, both stable keys rendered through t()), the full-screen
// fade layer, and the "Skip scene" hint button. Per-frame writes route
// through the shared PainterHost write-elision facet; the elements are built
// once at construction (cold path) and live directly under the HUD container.
// All styling lives in the scene overlay CSS section (tokens), never here.

import type { TranslationKey } from '../../i18n';
import { getLanguage, t } from '../../i18n';
import { ReannounceMarker } from '../../live_region_reannounce';
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
  private readonly liveEl: HTMLElement;
  private readonly speakerEl: HTMLElement;
  private readonly lineEl: HTMLElement;
  private readonly skipBtn: HTMLButtonElement;
  private localizedLanguage = '';
  private localizedSpeakerKey: string | null = null;
  private localizedLineKey: string | null = null;
  private localizedSpeaker = '';
  private localizedLine = '';
  private announcedId = 0;
  private announcedLanguage = '';
  private readonly reannounce = new ReannounceMarker();
  private lastFadeOpacity = Number.NaN;
  private fadeOpacityText = '0.000';

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
    this.subtitleEl.setAttribute('aria-hidden', 'true');
    this.speakerEl = doc.createElement('span');
    this.speakerEl.className = 'scene-subtitle-speaker';
    this.lineEl = doc.createElement('span');
    this.lineEl.className = 'scene-subtitle-line';
    this.subtitleEl.append(this.speakerEl, this.lineEl);
    this.liveEl = make('div', 'scene-subtitle-live visually-hidden');
    this.liveEl.setAttribute('role', 'status');
    this.liveEl.setAttribute('aria-live', 'polite');
    this.liveEl.setAttribute('aria-atomic', 'true');
    this.skipBtn = doc.createElement('button');
    this.skipBtn.type = 'button';
    this.skipBtn.className = 'scene-skip';
    this.skipBtn.textContent = t('hudChrome.scene.skipHint');
    this.skipBtn.style.display = 'none';
    this.skipBtn.addEventListener('click', () => this.deps.onSkip());
    deps.container.appendChild(this.skipBtn);
  }

  /** Re-resolve construction-time chrome after a live locale switch. */
  relocalize(): void {
    this.skipBtn.textContent = t('hudChrome.scene.skipHint');
    this.localizedLanguage = '';
    this.announcedLanguage = '';
  }

  paint(model: SceneOverlayModel): void {
    const w = this.deps.writers;
    // Cinematic mode: the whole HUD hides while a scene runs. The class lands on
    // <body> (not the #ui container) because two hidden roots, #nameplates and the
    // mobile #mobile-controls, are SIBLINGS of #ui, not descendants. The end op
    // clears model.cinematic, so this one write restores the HUD. Elided, so an
    // unchanged frame costs no DOM mutation.
    w.toggleClass(this.deps.document.body, 'cinematic-mode', model.cinematic);
    w.toggleClass(this.barTop, 'on', model.letterbox);
    w.toggleClass(this.barBottom, 'on', model.letterbox);
    // The fade layer hides entirely at 0 so an idle HUD composites nothing.
    w.setDisplay(this.fadeEl, model.fadeOpacity > 0 ? '' : 'none');
    if (model.fadeOpacity !== this.lastFadeOpacity) {
      this.lastFadeOpacity = model.fadeOpacity;
      this.fadeOpacityText = model.fadeOpacity.toFixed(3);
      w.setStyleProp(this.fadeEl, 'opacity', this.fadeOpacityText);
    }
    const hasLine = model.lineKey !== null;
    w.setDisplay(this.subtitleEl, hasLine ? '' : 'none');
    if (hasLine) {
      // Dialogue arrives as stable keys (S3). Cache the resolved strings by
      // language + key so a held subtitle does not re-run translation every
      // frame; PainterHost still elides the actual DOM writes.
      const language = getLanguage();
      if (
        language !== this.localizedLanguage ||
        model.speakerKey !== this.localizedSpeakerKey ||
        model.lineKey !== this.localizedLineKey
      ) {
        this.localizedLanguage = language;
        this.localizedSpeakerKey = model.speakerKey;
        this.localizedLineKey = model.lineKey;
        this.localizedSpeaker =
          model.speakerKey !== null ? t(model.speakerKey as TranslationKey) : '';
        this.localizedLine = t(model.lineKey as TranslationKey);
      }
      w.setText(this.speakerEl, this.localizedSpeaker);
      w.setText(this.lineEl, this.localizedLine);
      if (
        model.announcementId !== this.announcedId ||
        this.localizedLanguage !== this.announcedLanguage
      ) {
        const announcement = (
          this.localizedSpeaker !== ''
            ? `${this.localizedSpeaker}: ${this.localizedLine}`
            : this.localizedLine
        ).trim();
        w.setText(this.liveEl, this.reannounce.mark(announcement));
        this.announcedId = model.announcementId;
        this.announcedLanguage = this.localizedLanguage;
      }
    } else if (this.announcedId !== 0) {
      w.setText(this.liveEl, '');
      this.reannounce.reset();
      this.announcedId = 0;
      this.announcedLanguage = '';
    }
    w.setDisplay(this.skipBtn, model.skipHintVisible ? '' : 'none');
  }
}
