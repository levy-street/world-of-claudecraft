// Professions hub (/wiki/professions) and the dispatcher for its detail pages
// (/wiki/professions/<id>), the classes-page parameterized precedent: ONE
// route entry, with the craft pages (professions_craft.ts), the gathering
// pages (professions_gathering.ts), and the economy/FAQ pages
// (professions_economy.ts / professions_faq.ts) selected by the first param.
// The overview renders the full ten-craft ring (honest about the two
// wave-one content-empty crafts), the four gathering professions, the ten
// pair-named archetypes, and the shared numbers, all from GUIDE_PROF_*
// generated data. TRANSPARENCY POLICY: professions
// pages publish EXACT numbers; guards in tests/guide.test.ts.

import { esc } from '../../ui/esc';
import { formatNumber, type TranslationKey, t } from '../../ui/i18n';
import {
  GUIDE_PROF_ARCHETYPES,
  GUIDE_PROF_CURVE,
  GUIDE_PROF_GATHERING,
  GUIDE_PROF_RING,
  GUIDE_PROF_STATIONS,
} from '../content.generated';
import { hrefFor } from '../routes';
import { craftById, craftDetailHtml, craftLabel, stationLabel } from './professions_craft';
import { economyDetailHtml } from './professions_economy';
import { faqDetailHtml } from './professions_faq';
import { gatheringById, gatheringDetailHtml, gatheringLabel } from './professions_gathering';
import type { GuidePage, PageContext } from './types';
import { lead, paras, related } from './ui';

function notFoundInline(): string {
  return `<article class="guide-article guide-notfound">
    <h1>${esc(t('guide.notFound.title'))}</h1>
    <p class="guide-lead">${esc(t('guide.notFound.body'))}</p>
    <p><a class="guide-cta" href="${esc(hrefFor('professions'))}">${esc(t('guide.profPages.back'))}</a></p>
  </article>`;
}

// ------------------------------------------------------------------ overview
function ringSection(): string {
  const cards = GUIDE_PROF_RING.map((c) => {
    const cap = t('guide.professions.capFmt', { cap: formatNumber(c.maxSkill) });
    if (!c.hasContent) {
      return `<div class="guide-prof-card guide-prof-card-empty">
          <span class="guide-prof-card-name">${esc(craftLabel(c.id))}</span>
          <span class="guide-prof-card-cap">${esc(cap)}</span>
          <span class="guide-prof-card-soon">${esc(t('guide.professions.comingSoon'))}</span>
        </div>`;
    }
    return `<a class="guide-prof-card" href="${esc(hrefFor(`professions/${c.id}`))}">
        <span class="guide-prof-card-name">${esc(craftLabel(c.id))}</span>
        <span class="guide-prof-card-cap">${esc(cap)}</span>
      </a>`;
  }).join('');
  return `<section class="guide-block" id="prof-ring">
      <h2>${esc(t('guide.professions.ringHeading'))}</h2>
      ${paras('guide.professions.ringBody')}
      <div class="guide-prof-cards">${cards}</div>
      <p class="guide-callout guide-callout-note">${esc(t('guide.professions.ringWaveNote'))}</p>
    </section>`;
}

function gatheringSection(): string {
  const cards = GUIDE_PROF_GATHERING.map(
    (g) => `<a class="guide-prof-card" href="${esc(hrefFor(`professions/${g.id}`))}">
        <span class="guide-prof-card-name">${esc(gatheringLabel(g.id))}</span>
        <span class="guide-prof-card-cap">${esc(
          t('guide.professions.capFmt', { cap: formatNumber(g.maxSkill) }),
        )}</span>
      </a>`,
  ).join('');
  return `<section class="guide-block" id="prof-gathering">
      <h2>${esc(t('guide.professions.gatherHubHeading'))}</h2>
      ${paras('guide.professions.gatherHubBody')}
      <div class="guide-prof-cards">${cards}</div>
    </section>`;
}

function archetypesSection(): string {
  const items = GUIDE_PROF_ARCHETYPES.map((a) => {
    const title = t(`hudChrome.archetypePair.${a.pairId}` as TranslationKey);
    const pair = t('guide.professions.pairFmt', {
      a: craftLabel(a.crafts[0]),
      b: craftLabel(a.crafts[1]),
    });
    return `<li class="guide-prof-archetype"><span class="guide-prof-archetype-title">${esc(title)}</span> <span class="guide-prof-archetype-pair">${esc(pair)}</span></li>`;
  }).join('');
  return `<section class="guide-block" id="prof-archetypes">
      <h2>${esc(t('guide.professions.archetypesHeading'))}</h2>
      ${paras('guide.professions.archetypesBody')}
      <ul class="guide-prof-archetypes">${items}</ul>
    </section>`;
}

function stationsSection(): string {
  const rows = GUIDE_PROF_STATIONS.stations
    .map(
      (s) => `<tr>
        <td>${esc(stationLabel(s.type))}</td>
        <td>${esc(s.hub)}</td>
        <td>${esc(s.master ? t('guide.professions.masterCellFmt', { name: s.master.name, title: s.master.title }) : '')}</td>
      </tr>`,
    )
    .join('');
  return `<section class="guide-block" id="prof-stations">
      <h2>${esc(t('guide.professions.stationsHeading'))}</h2>
      ${paras('guide.professions.stationsBody')}
      <div class="guide-table-scroll"><table class="guide-keytable guide-prof-table">
        <thead><tr>
          <th scope="col">${esc(t('guide.professions.colStation'))}</th>
          <th scope="col">${esc(t('guide.professions.colHub'))}</th>
          <th scope="col">${esc(t('guide.professions.colMaster'))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;
}

function overviewHtml(): string {
  return `
    <article class="guide-article guide-prof-overview">
      <h1>${esc(t('guide.nav.professions'))}</h1>
      ${lead('guide.professions.intro')}
      <section class="guide-block" id="prof-what">
        <h2>${esc(t('guide.professions.whatHeading'))}</h2>
        ${paras('guide.professions.whatBody')}
      </section>
      ${ringSection()}
      ${gatheringSection()}
      ${archetypesSection()}
      <section class="guide-block" id="prof-letter">
        <h2>${esc(t('guide.professions.archetypeChooseTitle'))}</h2>
        ${paras('guide.professions.archetypeChooseBody')}
        ${paras('guide.professions.archetypeSwitchBody')}
      </section>
      <section class="guide-block" id="prof-curve">
        <h2>${esc(t('guide.professions.curveHeading'))}</h2>
        ${paras('guide.professions.curveBody', { step: formatNumber(GUIDE_PROF_CURVE.tierStep) })}
      </section>
      <section class="guide-block" id="prof-pace">
        <h2>${esc(t('guide.professions.craftMasteryTitle'))}</h2>
        ${paras('guide.professions.craftMasteryBody')}
      </section>
      <section class="guide-block" id="prof-provenance">
        <h2>${esc(t('guide.professions.provenanceHeading'))}</h2>
        ${paras('guide.professions.provenanceBody')}
      </section>
      ${stationsSection()}
      <section class="guide-block" id="prof-deeds">
        <h2>${esc(t('guide.professions.deedsHeading'))}</h2>
        ${paras('guide.professions.deedsBody')}
      </section>
      <section class="guide-block" id="prof-start">
        <h2>${esc(t('guide.professions.startHeading'))}</h2>
        ${paras('guide.professions.startBody')}
      </section>
      ${related([
        { href: hrefFor('professions/economy'), key: 'guide.profPages.econ.title' },
        { href: hrefFor('professions/faq'), key: 'guide.profPages.faq.title' },
        { href: hrefFor('gear'), key: 'guide.nav.gear' },
        { href: hrefFor('economy'), key: 'guide.nav.economy' },
      ])}
    </article>`;
}

// ---------------------------------------------------------------- dispatcher
export const professions: GuidePage = {
  titleKey: 'guide.nav.professions',
  titleFor(ctx: PageContext) {
    const id = ctx.params[0];
    if (!id) return t('guide.nav.professions');
    if (craftById(id)) return craftLabel(id);
    if (gatheringById(id)) return gatheringLabel(id);
    if (id === 'economy') return t('guide.profPages.econ.title');
    if (id === 'faq') return t('guide.profPages.faq.title');
    return t('guide.nav.professions');
  },
  render(ctx: PageContext) {
    const id = ctx.params[0];
    if (!id) return overviewHtml();
    const craft = craftById(id);
    if (craft) return craftDetailHtml(craft);
    const gathering = gatheringById(id);
    if (gathering) return gatheringDetailHtml(gathering);
    if (id === 'economy') return economyDetailHtml();
    if (id === 'faq') return faqDetailHtml();
    return notFoundInline();
  },
};
