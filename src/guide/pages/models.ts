// 3D model gallery (/guide/models): one big turntable plus a grouped picker over every
// class, creature, and warlock demon. A single lazy viewer is reused as the reader picks,
// so the page costs nothing until it mounts and only ever holds one WebGL context.

import { t } from '../../ui/i18n';
import { esc } from '../../ui/esc';
import { iconDataUrl } from '../../ui/icons';
import { GUIDE_CLASSES, GUIDE_FAMILIES, GUIDE_WARLOCK_PETS, GUIDE_MODELS } from '../content.generated';
import { className, classCrest } from '../class_view';
import { hrefFor } from '../routes';
import { related, lead } from './ui';
import { createViewer, hasWebGL, type ModelViewer } from '../viewer';
import type { GuidePage } from './types';

interface ModelOption {
  modelKey: string;
  name: string;
  tint?: string;
  /** Optional accent (class color) for the option rail. */
  color?: string;
  /** Optional small 2D crest. */
  poster?: string;
}

const familyCrest = (family: string): string => iconDataUrl('crest', `family_${family}`, 64);

// Dedupe by model key: many creatures share one rig (every wolf is the wolf model), so the
// gallery shows each distinct model once, labeled by the first creature that uses it.
function dedupeByModel(options: ModelOption[]): ModelOption[] {
  const seen = new Set<string>();
  return options.filter((o) => (seen.has(o.modelKey) ? false : (seen.add(o.modelKey), true)));
}

function classOptions(): ModelOption[] {
  return GUIDE_CLASSES.map((c) => ({
    modelKey: c.model, name: className(c.id), tint: c.tint, color: c.color, poster: classCrest(c.id, 64),
  }));
}

function creatureOptions(): ModelOption[] {
  const all: ModelOption[] = [];
  for (const f of GUIDE_FAMILIES) {
    for (const c of f.creatures) {
      all.push({ modelKey: c.model, name: c.name, tint: c.tint, poster: familyCrest(f.family) });
    }
  }
  return dedupeByModel(all);
}

function petOptions(): ModelOption[] {
  return dedupeByModel(GUIDE_WARLOCK_PETS.map((p) => ({ modelKey: p.model, name: p.name, tint: p.tint })));
}

function optionHtml(o: ModelOption): string {
  const style = o.color ? ` style="--opt-color:${esc(o.color)}"` : '';
  const tint = o.tint ? ` data-tint="${esc(o.tint)}"` : '';
  const img = o.poster ? `<img src="${esc(o.poster)}" alt="" width="28" height="28" loading="lazy" decoding="async" />` : '';
  // A toggle button (aria-pressed): one is active at a time and it loads that model.
  return `<button type="button" class="guide-gallery-opt" aria-pressed="false"
    data-model="${esc(o.modelKey)}"${tint} data-name="${esc(o.name)}"${style}>
    ${img}<span class="guide-gallery-opt-name">${esc(o.name)}</span>
  </button>`;
}

function groupHtml(labelKey: 'guide.models.groupClasses' | 'guide.models.groupCreatures' | 'guide.models.groupPets', options: ModelOption[]): string {
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
          <div class="guide-gallery-picker" aria-label="${esc(t('guide.models.pickerLabel'))}">
            ${groupHtml('guide.models.groupClasses', classes)}
            ${groupHtml('guide.models.groupCreatures', creatures)}
            ${groupHtml('guide.models.groupPets', pets)}
          </div>
          <div class="guide-gallery-viewer">
            <div class="guide-viewer-stage guide-gallery-stage" data-stage>
              <p class="guide-gallery-fallback" data-fallback hidden>${esc(t('guide.models.noWebgl'))}</p>
            </div>
            <p class="guide-gallery-caption" data-caption aria-live="polite"></p>
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
    if (!stage || !picker) return;

    if (!hasWebGL()) {
      if (fallback) fallback.hidden = false;
      return;
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
      picker.querySelectorAll<HTMLElement>('[aria-pressed="true"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      const name = btn.dataset.name ?? '';
      if (caption) caption.textContent = name;
      const tint = btn.dataset.tint ? parseInt(btn.dataset.tint.replace('#', ''), 16) : null;
      const label = t('guide.viewer.canvasLabel', { name });
      try {
        if (!viewer) {
          viewer = await createViewer(stage, label);
          if (disposed) { viewer.destroy(); viewer = null; return; }
        } else {
          viewer.setLabel(label);
        }
        await viewer.load(spec, tint);
        if (disposed && viewer) { viewer.destroy(); viewer = null; }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Guide gallery failed to load model', err);
        btn.setAttribute('aria-pressed', 'false');
      }
    };

    const select = async (btn: HTMLElement): Promise<void> => {
      if (loading) { queued = btn; return; }
      loading = true;
      await load(btn);
      loading = false;
      if (queued && !disposed) { const next = queued; queued = null; void select(next); }
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
      if (viewer) viewer.destroy();
    };
  },
};
