// Arena and PvP: a spoiler-safe overview of player versus player, the Ashen Coliseum,
// the two versus two Fiesta augment mode, and the ladder. Concepts only, no ratings math,
// augment numbers, or matchmaking internals.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { callout, loreBeat, pageHeader, related, section } from './ui';

// The three escalating Fiesta augment waves, as title + body beat cards.
const WAVES = [
  ['guide.arenaPage.waveSilverTitle', 'guide.arenaPage.waveSilverBody'],
  ['guide.arenaPage.waveGoldTitle', 'guide.arenaPage.waveGoldBody'],
  ['guide.arenaPage.wavePrismaticTitle', 'guide.arenaPage.wavePrismaticBody'],
] as const;

export const arena: GuidePage = {
  titleKey: 'guide.nav.arena',
  render() {
    const waves = WAVES.map(([title, body]) => loreBeat(title, body)).join('');
    return `
      <article class="guide-article guide-arena">
        ${pageHeader('guide.arenaPage.heading', 'guide.arenaPage.intro')}
        ${section('guide.arenaPage.duelsHeading', `<p>${esc(t('guide.arenaPage.duelsBody'))}</p>`)}
        ${section('guide.arenaPage.coliseumHeading', `<p>${esc(t('guide.arenaPage.coliseumBody'))}</p>`)}
        ${section('guide.arenaPage.fiestaHeading', `<p>${esc(t('guide.arenaPage.fiestaBody'))}</p>${callout(esc(t('guide.arenaPage.augmentsNote')), { variant: 'note' })}`)}
        ${section(
          'guide.arenaPage.wavesTitle',
          `<p>${esc(t('guide.arenaPage.wavesBody'))}</p><div class="guide-beat-grid">${waves}</div>`,
        )}
        ${section('guide.arenaPage.powerupsTitle', `<p>${esc(t('guide.arenaPage.powerupsBody'))}</p>`)}
        ${section('guide.arenaPage.yumiHeading', `<p>${esc(t('guide.arenaPage.yumiBody'))}</p>`)}
        ${section('guide.arenaPage.ladderHeading', `<p>${esc(t('guide.arenaPage.ladderBody'))}</p>`)}
        ${related([
          { href: hrefFor('dungeons'), key: 'guide.nav.dungeons' },
          { href: hrefFor('classes'), key: 'guide.nav.classes' },
          { href: hrefFor('reference/combat'), key: 'guide.nav.combat' },
        ])}
      </article>`;
  },
};
