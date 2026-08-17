// Page registry. Maps a route id to its GuidePage. Routes without a registered page
// render the placeholder (with the route's nav label as the heading) until their phase
// fills them in; unmatched paths render notFound.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { arena } from './arena';
import { bestiary } from './bestiary';
import { classes } from './classes';
import { combat } from './combat';
import { commands } from './commands';
import { controls } from './controls';
import { deeds } from './deeds';
import { delves } from './delves';
import { dungeons } from './dungeons';
import { economy } from './economy';
import { editor } from './editor';
import { faq } from './faq';
import { gear } from './gear';
import { glossary } from './glossary';
import { home } from './home';
import { howToPlay } from './how_to_play';
import { interfacePage } from './interface';
import { models } from './models';
import { mounts } from './mounts';
import { professions } from './professions';
import { progression } from './progression';
import { quests } from './quests';
import { reliquary } from './reliquary';
import { rifts } from './rifts';
import { settings } from './settings';
import { social } from './social';
import { stats } from './stats';
import { talents } from './talents';
import { thornhollowFields } from './thornhollow_fields';
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
  rifts,
  mounts,
  arena,
  'thornhollow-fields': thornhollowFields,
  'vale-cup': valeCup,
  deeds,
  reliquary,
  combat,
  stats,
  progression,
  controls,
  commands,
  interface: interfacePage,
  settings,
  talents,
  glossary,
  editor,
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
