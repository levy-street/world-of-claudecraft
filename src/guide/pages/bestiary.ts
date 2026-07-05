// Bestiary: overworld creatures grouped by family, with procedural family crests.
// Data is generated from the per-zone mob lists (content.generated.ts), which excludes
// elite/boss and summoned creatures, so dungeon and raid encounters never appear here.

import { t, tOptional, formatNumber, type TranslationKey } from '../../ui/i18n';
import { esc } from '../../ui/esc';
import { iconDataUrl } from '../../ui/icons';
import { GUIDE_FAMILIES, type GuideCreature } from '../content.generated';
import { hrefFor } from '../routes';
import { lead, related } from './ui';
import { modelViewerEmbed, wireModelViewers } from '../viewer';
import type { GuidePage } from './types';

const familyCrest = (family: string): string => iconDataUrl('crest', `family_${family}`, 96);

function band(c: GuideCreature): string {
  return c.min === c.max
    ? t('guide.bestiary.levelsSame', { min: formatNumber(c.min) })
    : t('guide.bestiary.levels', { min: formatNumber(c.min), max: formatNumber(c.max) });
}

// A spoiler-safe, mechanics-free flavor line for the standout creatures, looked up by sim
// template id. Most creatures carry no key (tOptional returns null), so nothing renders.
function creatureFlavor(c: GuideCreature): string {
  const line = tOptional(`guide.bestiary.flavor.${c.templateId}`);
  if (!line) return '';
  return `<span class="guide-creature-flavor"><span class="guide-creature-flavor-label">${esc(t('guide.bestiary.notedLabel'))}</span> ${esc(line)}</span>`;
}

// Each creature card pairs a compact rotatable 3D thumbnail (loaded on demand) with its
// name and level band. The family crest is the 2D poster until the reader loads the model.
function creatureCard(c: GuideCreature, family: string): string {
  const rare = c.rare ? `<span class="guide-badge guide-badge-rare">${esc(t('guide.bestiary.rare'))}</span>` : '';
  return `<li class="guide-creature">
    ${modelViewerEmbed({ modelKey: c.model, tint: c.tint, name: c.name, poster: familyCrest(family), posterSize: 64, variant: 'thumb' })}
    <div class="guide-creature-info">
      <span class="guide-creature-name">${esc(c.name)}${rare}</span>
      <span class="guide-creature-band">${esc(band(c))}</span>
      ${creatureFlavor(c)}
    </div>
  </li>`;
}

export const bestiary: GuidePage = {
  titleKey: 'guide.nav.bestiary',
  render() {
    const sections = GUIDE_FAMILIES
      .map((f) => {
        const nameKey = `guide.family.${f.family}.name` as TranslationKey;
        const descKey = `guide.family.${f.family}.desc` as TranslationKey;
        return `
          <section class="guide-family" id="fam-${esc(f.family)}">
            <div class="guide-family-head">
              <img class="guide-family-crest" src="${esc(familyCrest(f.family))}" alt="" width="56" height="56" loading="lazy" decoding="async" />
              <div>
                <h2 class="guide-family-name">${esc(t(nameKey))}</h2>
                <p class="guide-family-desc">${esc(t(descKey))}</p>
              </div>
            </div>
            <ul class="guide-creatures">${f.creatures.map((c) => creatureCard(c, f.family)).join('')}</ul>
          </section>`;
      })
      .join('');
    return `
      <article class="guide-article guide-bestiary">
        <h1>${esc(t('guide.bestiary.heading'))}</h1>
        ${lead('guide.bestiary.intro')}
        ${sections}
        ${related([
          { href: hrefFor('world'), key: 'guide.nav.world' },
          { href: hrefFor('classes'), key: 'guide.nav.classes' },
          { href: hrefFor('dungeons'), key: 'guide.nav.dungeons' },
        ])}
      </article>`;
  },
  // Many creatures share the page, so cap concurrent viewers (LRU) to stay well under the
  // browser's WebGL context limit; offscreen viewers also pause themselves.
  mount(root: HTMLElement) {
    return wireModelViewers(root, { maxConcurrent: 4 });
  },
};
