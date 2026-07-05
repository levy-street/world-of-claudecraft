// Bestiary: overworld creatures grouped by family. Each card shows a pre-rendered still of
// the creature (public/guide-stills, baked from the real GLB by scripts/wiki/render_model_stills.mjs),
// so the page is a fast, crawlable, zero-WebGL gallery (the interactive turntable lives on
// the class pages and the /wiki/models gallery). Data is generated from the per-zone and
// temple mob lists (content.generated.ts), which keeps only creatures that actually spawn in a
// camp and drops elite/boss and summon-only encounter adds, so dungeon and raid encounters
// never appear here.

import { esc } from '../../ui/esc';
import { formatNumber, type TranslationKey, t, tOptional } from '../../ui/i18n';
import { iconDataUrl } from '../../ui/icons';
import { GUIDE_FAMILIES, type GuideCreature } from '../content.generated';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { lead, related } from './ui';

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

// Each creature card pairs a pre-rendered still of the creature with its name and level
// band. The still falls back to the family crest only if a render is somehow absent (the
// guide.test asset guard makes that a build failure, not a runtime hole).
function creatureCard(c: GuideCreature, family: string): string {
  const rare = c.rare
    ? `<span class="guide-badge guide-badge-rare">${esc(t('guide.bestiary.rare'))}</span>`
    : '';
  const img = c.still ?? familyCrest(family);
  // The still IS the subject, so its alt names the creature (via the shared viewer key, the
  // same path embed.ts uses); the crest fallback is decoration (alt="").
  const alt = c.still ? esc(t('guide.viewer.posterAlt', { name: c.name })) : '';
  return `<li class="guide-creature">
    <div class="guide-creature-thumb">
      <img class="guide-creature-still" src="${esc(img)}" alt="${alt}" width="88" height="88" loading="lazy" decoding="async" />
    </div>
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
    const sections = GUIDE_FAMILIES.map((f) => {
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
    }).join('');
    return `
      <article class="guide-article guide-bestiary">
        <h1>${esc(t('guide.bestiary.heading'))}</h1>
        ${lead('guide.bestiary.intro')}
        ${sections}
        ${related([
          { href: hrefFor('world'), key: 'guide.nav.world' },
          { href: hrefFor('classes'), key: 'guide.nav.classes' },
          { href: hrefFor('dungeons'), key: 'guide.nav.dungeons' },
          // The cards above are static stills; the gallery is where a reader can rotate
          // each creature in 3D, so point there from here.
          { href: hrefFor('models'), key: 'guide.nav.models' },
        ])}
      </article>`;
  },
};
