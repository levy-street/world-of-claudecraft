// Arena and PvP: a spoiler-safe overview of player versus player, the Ashen
// Coliseum's ranked duel brackets, and the ladder. Concepts only, no ratings
// math or matchmaking internals. (The Fiesta and Protect Yumi modes are
// retired from the menu, so the page no longer documents them.)

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { pageHeader, related, section } from './ui';

export const arena: GuidePage = {
  titleKey: 'guide.nav.arena',
  render() {
    return `
      <article class="guide-article guide-arena">
        ${pageHeader('guide.arenaPage.heading', 'guide.arenaPage.intro')}
        ${section('guide.arenaPage.duelsHeading', `<p>${esc(t('guide.arenaPage.duelsBody'))}</p>`)}
        ${section('guide.arenaPage.coliseumHeading', `<p>${esc(t('guide.arenaPage.coliseumBody'))}</p>`)}
        ${section('guide.arenaPage.ladderHeading', `<p>${esc(t('guide.arenaPage.ladderBody'))}</p>`)}
        ${related([
          { href: hrefFor('dungeons'), key: 'guide.nav.dungeons' },
          { href: hrefFor('classes'), key: 'guide.nav.classes' },
          { href: hrefFor('reference/combat'), key: 'guide.nav.combat' },
        ])}
      </article>`;
  },
};
