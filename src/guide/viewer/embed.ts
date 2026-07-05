// Pure markup for an inline 3D-model embed. Renders a poster (the page's existing 2D
// crest/icon) with a "View in 3D" affordance; the heavy three.js model loads only when
// the reader activates it (wired by mount.ts). No three.js import here, so this stays in
// the main Guide bundle while the renderer/loader cost is deferred to the lazy chunk.

import { t } from '../../ui/i18n';
import { esc } from '../../ui/esc';

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
  /** Framing: inline (default), feature (hero/gallery), or thumb (compact list cell). */
  variant?: 'inline' | 'feature' | 'thumb';
  /** Poster pixel box (square). Defaults to 96. */
  posterSize?: number;
}

const VARIANT_CLASS: Record<NonNullable<ModelEmbedOptions['variant']>, string> = {
  inline: '',
  feature: ' guide-viewer-feature',
  thumb: ' guide-viewer-thumb',
};

export function modelViewerEmbed(opts: ModelEmbedOptions): string {
  const size = opts.posterSize ?? 96;
  const cls = `guide-viewer${VARIANT_CLASS[opts.variant ?? 'inline']}`;
  const viewLabel = t('guide.viewer.view3d', { name: opts.name });
  const poster = opts.poster
    ? `<img class="guide-viewer-poster" src="${esc(opts.poster)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async" />`
    : '';
  return `
    <figure class="${cls}" data-model="${esc(opts.modelKey)}"${opts.tint ? ` data-tint="${esc(opts.tint)}"` : ''}
      data-name="${esc(opts.name)}" data-state="idle">
      <div class="guide-viewer-stage">
        ${poster}
        <button type="button" class="guide-viewer-load" aria-label="${esc(viewLabel)}">
          <span class="guide-viewer-load-icon" aria-hidden="true"></span>
          <span class="guide-viewer-load-text">${esc(t('guide.viewer.view3dShort'))}</span>
        </button>
        <p class="guide-viewer-status" role="status" aria-live="polite">
          <span class="guide-viewer-status-loading">${esc(t('guide.viewer.loading'))}</span>
          <span class="guide-viewer-status-error">${esc(t('guide.viewer.error', { name: opts.name }))}</span>
        </p>
      </div>
      <figcaption class="guide-viewer-hint">${esc(t('guide.viewer.dragHint'))}</figcaption>
    </figure>`;
}
