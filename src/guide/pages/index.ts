// Page registry. Maps a route id to its GuidePage. Routes without a registered page
// render the placeholder (with the route's nav label as the heading) until their phase
// fills them in; unmatched paths render notFound.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { arena } from './arena';
import { bestiary } from './bestiary';
import { classes } from './classes';
import { combat } from './combat';
import { controls } from './controls';
import { delves } from './delves';
import { dungeons } from './dungeons';
import { economy } from './economy';
import { faq } from './faq';
import { gear } from './gear';
import { glossary } from './glossary';
import { home } from './home';
import { howToPlay } from './how_to_play';
import { models } from './models';
import { professions } from './professions';
import { progression } from './progression';
import { quests } from './quests';
import { settings } from './settings';
import { social } from './social';
import { stats } from './stats';
import { talents } from './talents';
import type { GuidePage, PageContext } from './types';
import { valeCup } from './vale_cup';
import { wishIKnew } from './wish_i_knew';
import { world } from './world';

export type { GuidePage, PageContext } from './types';

const PAGES: Record<string, GuidePage> = {
  home,
  'how-to-play': howToPlay,
  'wish-i-knew': wishIKnew,
  social,
  classes,
  bestiary,
  models,
  world,
  gear,
  professions,
  economy,
  quests,
  dungeons,
  delves,
  arena,
  'vale-cup': valeCup,
  combat,
  stats,
  progression,
  controls,
  settings,
  talents,
  glossary,
  faq,
};

export function pageFor(id: string): GuidePage | null {
  return PAGES[id] ?? null;
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
