// 3D model gallery (/guide/models): one big turntable plus a grouped picker over every
// class, creature, and warlock demon. A single lazy viewer is reused as the reader picks,
// so the page costs nothing until it mounts and only ever holds one WebGL context.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { iconDataUrl } from '../../ui/icons';
import { classCrest, className } from '../class_view';
import {
  GUIDE_CLASSES,
  GUIDE_FAMILIES,
  GUIDE_MODELS,
  GUIDE_WARLOCK_PETS,
} from '../content.generated';
import { hrefFor } from '../routes';
import { createViewer, hasWebGL, type ModelViewer } from '../viewer';
import type { GuidePage } from './types';
import { lead, related } from './ui';

interface ModelOption {
  modelKey: string;
  name: string;
  tint?: string;
  /** Optional accent (class color) for the option rail. */
  color?: string;
  /** Optional small 2D crest (fallback when no still). */
  poster?: string;
  /** Pre-rendered still of this figure, preferred over the crest for the option icon. */
  still?: string;
}

const familyCrest = (family: string): string => iconDataUrl('crest', `family_${family}`, 64);

// Dedupe by model key: many creatures share one rig (every wolf is the wolf model), so the
// gallery shows each distinct model once, labeled by the first creature that uses it.
function dedupeByModel(options: ModelOption[]): ModelOption[] {
  const seen = new Set<string>();
  return options.filter((o) => {
    if (seen.has(o.modelKey)) return false;
    seen.add(o.modelKey);
    return true;
  });
}

function classOptions(): ModelOption[] {
  return GUIDE_CLASSES.map((c) => ({
    modelKey: c.model,
    name: className(c.id),
    tint: c.tint,
    color: c.color,
    poster: classCrest(c.id, 64),
    still: c.still,
  }));
}

function creatureOptions(): ModelOption[] {
  const all: ModelOption[] = [];
  for (const f of GUIDE_FAMILIES) {
    for (const c of f.creatures) {
      all.push({
        modelKey: c.model,
        name: c.name,
        tint: c.tint,
        poster: familyCrest(f.family),
        still: c.still,
      });
    }
  }
  return dedupeByModel(all);
}

function petOptions(): ModelOption[] {
  return dedupeByModel(
    GUIDE_WARLOCK_PETS.map((p) => ({
      modelKey: p.model,
      name: p.name,
      tint: p.tint,
      still: p.still,
    })),
  );
}

function optionHtml(o: ModelOption): string {
  const style = o.color ? ` style="--opt-color:${esc(o.color)}"` : '';
  const tint = o.tint ? ` data-tint="${esc(o.tint)}"` : '';
  const icon = o.still ?? o.poster;
  const img = icon
    ? `<img src="${esc(icon)}" alt="" width="28" height="28" loading="lazy" decoding="async" />`
    : '';
  // A toggle button (aria-pressed): one is active at a time and it loads that model.
  // data-still carries the baked still so the stage can show it while the live model loads
  // and as a fallback if WebGL fails (the turntable itself is the primary surface).
  const still = o.still ? ` data-still="${esc(o.still)}"` : '';
  return `<button type="button" class="guide-gallery-opt" aria-pressed="false"
    data-model="${esc(o.modelKey)}"${tint} data-name="${esc(o.name)}"${still}${style}>
    ${img}<span class="guide-gallery-opt-name">${esc(o.name)}</span>
  </button>`;
}

function groupHtml(
  labelKey: 'guide.models.groupClasses' | 'guide.models.groupCreatures' | 'guide.models.groupPets',
  options: ModelOption[],
): string {
  if (options.length === 0) return '';
  return `
    <div class="guide-gallery-group" role="group" aria-label="${esc(t(labelKey))}">
      <h2 class="guide-gallery-group-h">${esc(t(labelKey))}</h2>
      <div class="guide-gallery-options">${options.map(optionHtml).join('')}</div>
    </div>`;
}

export const models: GuidePage = {
  titleKey: 'guide.models.title',
  render() {
    const classes = classOptions();
    const creatures = creatureOptions();
    const pets = petOptions();
    return `
      <article class="guide-article guide-models">
        <h1>${esc(t('guide.models.title'))}</h1>
        ${lead('guide.models.lead')}
        <div class="guide-gallery">
          <div class="guide-gallery-picker" role="group" aria-label="${esc(t('guide.models.pickerLabel'))}">
            ${groupHtml('guide.models.groupClasses', classes)}
            ${groupHtml('guide.models.groupCreatures', creatures)}
            ${groupHtml('guide.models.groupPets', pets)}
          </div>
          <div class="guide-gallery-viewer">
            <div class="guide-viewer-stage guide-gallery-stage" data-stage>
              <img class="guide-viewer-poster guide-viewer-poster-still" data-poster alt="" decoding="async" hidden />
              <p class="guide-gallery-fallback" data-fallback hidden>${esc(t('guide.models.noWebgl'))}</p>
            </div>
            <p class="guide-gallery-caption" data-caption aria-live="polite"></p>
            <p class="guide-gallery-hint">${esc(t('guide.viewer.dragHint'))}</p>
          </div>
        </div>
        ${related([
          { href: hrefFor('classes'), key: 'guide.nav.classes' },
          { href: hrefFor('bestiary'), key: 'guide.nav.bestiary' },
          { href: hrefFor('world'), key: 'guide.nav.world' },
        ])}
      </article>`;
  },
  mount(root: HTMLElement) {
    const stage = root.querySelector<HTMLElement>('[data-stage]');
    const picker = root.querySelector<HTMLElement>('.guide-gallery-picker');
    const caption = root.querySelector<HTMLElement>('[data-caption]');
    const fallback = root.querySelector<HTMLElement>('[data-fallback]');
    const poster = root.querySelector<HTMLImageElement>('[data-poster]');
    if (!stage || !picker) return;

    // Show the selected figure's baked still over the stage while the live model loads and as
    // a graceful fallback if WebGL fails; hide it once the turntable is up. The turntable is
    // the primary surface (it now frames every rig); this is a safety net, like the inline
    // embeds (viewer/embed.ts). A still that 404s just hides itself.
    let currentStill: string | undefined;
    const showPoster = (still?: string): void => {
      if (!poster) return;
      if (still) {
        poster.src = still;
        poster.hidden = false;
      } else {
        poster.hidden = true;
      }
    };
    const hidePoster = (): void => {
      if (poster) poster.hidden = true;
    };
    const onPosterError = (): void => hidePoster();
    poster?.addEventListener('error', onPosterError);
    // A broken option thumbnail (missing still) hides itself rather than showing a torn icon.
    // error does not bubble, so listen in the capture phase on the picker.
    const onImgError = (e: Event): void => {
      const img = e.target;
      if (img instanceof HTMLImageElement && img.closest('.guide-gallery-opt')) {
        img.style.visibility = 'hidden';
      }
    };
    picker.addEventListener('error', onImgError, true);

    if (!hasWebGL()) {
      if (fallback) fallback.hidden = false;
      // No turntable: the picker still browses the baked 2D stills (the buttons stay live, not
      // inert), swapping the selected figure's still into the stage poster.
      const showStill = (btn: HTMLElement): void => {
        picker.querySelectorAll<HTMLElement>('[aria-pressed="true"]').forEach((b) => {
          b.setAttribute('aria-pressed', 'false');
        });
        btn.setAttribute('aria-pressed', 'true');
        if (caption) caption.textContent = btn.dataset.name ?? '';
        showPoster(btn.dataset.still);
      };
      const onPick = (e: Event): void => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>('.guide-gallery-opt');
        if (btn) showStill(btn);
      };
      picker.addEventListener('click', onPick);
      const first = picker.querySelector<HTMLElement>('.guide-gallery-opt');
      if (first) showStill(first);
      return () => {
        picker.removeEventListener('click', onPick);
        poster?.removeEventListener('error', onPosterError);
        picker.removeEventListener('error', onImgError, true);
      };
    }

    let viewer: ModelViewer | null = null;
    let disposed = false;
    // Serialize loads: one model builds at a time, and a faster pick queues so only the
    // latest selection wins (buildModel is async, so overlapping loads on one viewer
    // would race). The queued button is always the most recent click.
    let loading = false;
    let queued: HTMLElement | null = null;

    const load = async (btn: HTMLElement): Promise<void> => {
      const spec = GUIDE_MODELS[btn.dataset.model ?? ''];
      if (!spec) return;
      picker.querySelectorAll<HTMLElement>('[aria-pressed="true"]').forEach((b) => {
        b.setAttribute('aria-pressed', 'false');
      });
      btn.setAttribute('aria-pressed', 'true');
      const name = btn.dataset.name ?? '';
      if (caption) caption.textContent = name;
      // Show this figure's still while the live model builds; hide it on success, keep it on
      // failure, and re-show it if the context is later lost.
      currentStill = btn.dataset.still;
      showPoster(currentStill);
      const tint = btn.dataset.tint ? parseInt(btn.dataset.tint.replace('#', ''), 16) : null;
      const label = t('guide.viewer.canvasLabel', { name });
      try {
        if (!viewer) {
          viewer = await createViewer(stage, label);
          if (disposed) {
            viewer.destroy();
            viewer = null;
            return;
          }
          viewer.onContextLost(() => showPoster(currentStill));
        } else {
          viewer.setLabel(label);
        }
        await viewer.load(spec, tint);
        if (disposed && viewer) {
          viewer.destroy();
          viewer = null;
        } else if (!viewer.isContextLost()) {
          // Keep the still up if the context died mid-load: load() resolves over a dead
          // context but renders nothing, so hiding the poster would blank the stage.
          hidePoster();
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Guide gallery failed to load model', err);
        btn.setAttribute('aria-pressed', 'false');
        showPoster(currentStill);
      }
    };

    const select = async (btn: HTMLElement): Promise<void> => {
      if (loading) {
        queued = btn;
        return;
      }
      loading = true;
      await load(btn);
      loading = false;
      if (queued && !disposed) {
        const next = queued;
        queued = null;
        void select(next);
      }
    };

    const onClick = (e: Event): void => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.guide-gallery-opt');
      if (btn) void select(btn);
    };
    picker.addEventListener('click', onClick);

    const first = picker.querySelector<HTMLElement>('.guide-gallery-opt');
    if (first) void select(first);

    return () => {
      disposed = true;
      picker.removeEventListener('click', onClick);
      picker.removeEventListener('error', onImgError, true);
      poster?.removeEventListener('error', onPosterError);
      if (viewer) viewer.destroy();
    };
  },
};
