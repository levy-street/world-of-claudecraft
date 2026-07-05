// Pure markup for an inline 3D-model embed. Renders a poster (the page's existing 2D
// crest/icon) with a "View in 3D" affordance; the heavy three.js model loads only when
// the reader activates it (wired by mount.ts). No three.js import here, so this stays in
// the main Guide bundle while the renderer/loader cost is deferred to the lazy chunk.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';

export interface ModelEmbedOptions {
  /** Visual key into GUIDE_MODELS (data-model); the wirer resolves the spec. */
  modelKey: string;
  /** Tint color hex (e.g. "#c8a972"); omitted when the model is untinted. */
  tint?: string;
  /** Accessible name: the class or creature name (already localized / a proper noun). */
  name: string;
  /** 2D poster shown before load and as the no-WebGL fallback (a procedural crest/icon).
   *  Omit for figures with no 2D art (e.g. warlock demons); the stage shows the button. */
  poster?: string;
  /** Pre-rendered transparent still of THIS exact figure (the default poster when present):
   *  a real, crawlable image of the creature/class, so the reader sees the subject without
   *  any WebGL. Falls back to `poster` (the 2D crest) when absent. */
  still?: string;
  /** Framing: inline (default) or feature (hero/gallery). */
  variant?: 'inline' | 'feature';
  /** Poster pixel box (square). Defaults to 96. */
  posterSize?: number;
  /** Auto-load and spin the model on mount (no click) once it scrolls into view, when WebGL
   *  is available and the reader allows motion. Otherwise the still poster + "View in 3D"
   *  affordance remain (the graceful 2D fallback). Used for the class hero portrait. */
  autoplay?: boolean;
}

const VARIANT_CLASS: Record<NonNullable<ModelEmbedOptions['variant']>, string> = {
  inline: '',
  feature: ' guide-viewer-feature',
};

export function modelViewerEmbed(opts: ModelEmbedOptions): string {
  const size = opts.posterSize ?? 96;
  const cls = `guide-viewer${VARIANT_CLASS[opts.variant ?? 'inline']}`;
  const viewLabel = t('guide.viewer.view3d', { name: opts.name });
  // Prefer the pre-rendered still (a real image of this figure) as the default poster; fall
  // back to the 2D crest. With a still the alt names the subject (it is the content now);
  // the crest stays alt="" decoration.
  const posterSrc = opts.still ?? opts.poster;
  const posterAlt = opts.still ? t('guide.viewer.posterAlt', { name: opts.name }) : '';
  const poster = posterSrc
    ? `<img class="guide-viewer-poster${opts.still ? ' guide-viewer-poster-still' : ''}" src="${esc(posterSrc)}" alt="${esc(posterAlt)}" width="${size}" height="${size}" loading="lazy" decoding="async" />`
    : '';
  // The status line is an empty ARIA live region. mount.ts writes guide.viewer.loading /
  // guide.viewer.error into it on each state transition, because aria-live announces a text
  // mutation, not the CSS show/hide that data-state drives. Keeping the copy out of the static
  // markup (rather than two CSS-toggled spans) is what makes the load and error feedback audible.
  return `
    <figure class="${cls}" data-model="${esc(opts.modelKey)}"${opts.tint ? ` data-tint="${esc(opts.tint)}"` : ''}
      data-name="${esc(opts.name)}"${opts.autoplay ? ' data-autoplay="true"' : ''} data-state="idle">
      <div class="guide-viewer-stage">
        ${poster}
        <button type="button" class="guide-viewer-load" aria-label="${esc(viewLabel)}">
          <span class="guide-viewer-load-icon" aria-hidden="true"></span>
          <span class="guide-viewer-load-text">${esc(t('guide.viewer.view3dShort'))}</span>
        </button>
        <p class="guide-viewer-status" role="status" aria-live="polite"></p>
      </div>
      <figcaption class="guide-viewer-hint">${esc(t('guide.viewer.dragHint'))}</figcaption>
    </figure>`;
}
