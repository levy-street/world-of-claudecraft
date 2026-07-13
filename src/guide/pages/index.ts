// Page registry. Maps a route id to its GuidePage. Routes without a registered page
// render the placeholder (with the route's nav label as the heading) until their phase
// fills them in; unmatched paths render notFound.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import type { GuidePage, PageContext } from './types';

export type { GuidePage, PageContext } from './types';

type PageLoader = () => Promise<GuidePage>;

// Keep every import path literal so Vite emits one lazy chunk per page module. This
// prevents route-specific dependencies such as procedural icons and Vale Cup flags
// from joining the initial Guide bundle.
const PAGE_LOADERS: Readonly<Record<string, PageLoader>> = {
  home: () => import('./home').then(({ home }) => home),
  'how-to-play': () => import('./how_to_play').then(({ howToPlay }) => howToPlay),
  'wish-i-knew': () => import('./wish_i_knew').then(({ wishIKnew }) => wishIKnew),
  social: () => import('./social').then(({ social }) => social),
  classes: () => import('./classes').then(({ classes }) => classes),
  bestiary: () => import('./bestiary').then(({ bestiary }) => bestiary),
  models: () => import('./models').then(({ models }) => models),
  world: () => import('./world').then(({ world }) => world),
  gear: () => import('./gear').then(({ gear }) => gear),
  professions: () => import('./professions').then(({ professions }) => professions),
  economy: () => import('./economy').then(({ economy }) => economy),
  quests: () => import('./quests').then(({ quests }) => quests),
  dungeons: () => import('./dungeons').then(({ dungeons }) => dungeons),
  delves: () => import('./delves').then(({ delves }) => delves),
  arena: () => import('./arena').then(({ arena }) => arena),
  'vale-cup': () => import('./vale_cup').then(({ valeCup }) => valeCup),
  deeds: () => import('./deeds').then(({ deeds }) => deeds),
  combat: () => import('./combat').then(({ combat }) => combat),
  stats: () => import('./stats').then(({ stats }) => stats),
  progression: () => import('./progression').then(({ progression }) => progression),
  controls: () => import('./controls').then(({ controls }) => controls),
  settings: () => import('./settings').then(({ settings }) => settings),
  talents: () => import('./talents').then(({ talents }) => talents),
  glossary: () => import('./glossary').then(({ glossary }) => glossary),
  faq: () => import('./faq').then(({ faq }) => faq),
};

export async function loadPage(id: string): Promise<GuidePage | null> {
  const loader = PAGE_LOADERS[id];
  return loader ? loader() : null;
}

export function placeholderHtml(ctx: PageContext): string {
  return `<article class="guide-article guide-placeholder">
    <h1>${esc(t(ctx.titleKey))}</h1>
    <p class="guide-lead">${esc(t('guide.placeholder.note'))}</p>
  </article>`;
}

export function notFoundHtml(): string {
  return `<article class="guide-article guide-notfound">
    <h1>${esc(t('guide.notFound.title'))}</h1>
    <p class="guide-lead">${esc(t('guide.notFound.body'))}</p>
    <p><a class="guide-cta" href="/wiki">${esc(t('guide.notFound.home'))}</a></p>
  </article>`;
}
