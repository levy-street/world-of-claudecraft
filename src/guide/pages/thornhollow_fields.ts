// Thornhollow Fields: a spoiler-safe overview of the 5v5 capture-the-flag battleground.
// Concepts only (the mode, the field, flags, wave respawns, runes, the ladder);
// no honor amounts, rating math, or tuning constants (guide spoiler policy).

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { callout, pageHeader, related, section } from './ui';

export const thornhollowFields: GuidePage = {
  titleKey: 'guide.nav.ravenrift',
  render() {
    return `
      <article class="guide-article guide-thornhollow-fields">
        ${pageHeader('guide.ravenriftPage.heading', 'guide.ravenriftPage.intro')}
        ${section('guide.ravenriftPage.queueHeading', `<p>${esc(t('guide.ravenriftPage.queueBody'))}</p>`)}
        ${section('guide.ravenriftPage.fieldHeading', `<p>${esc(t('guide.ravenriftPage.fieldBody'))}</p>`)}
        ${section(
          'guide.ravenriftPage.flagsHeading',
          `<p>${esc(t('guide.ravenriftPage.flagsBody'))}</p>${callout(esc(t('guide.ravenriftPage.pickupNote')), { variant: 'note' })}`,
        )}
        ${section('guide.ravenriftPage.respawnHeading', `<p>${esc(t('guide.ravenriftPage.respawnBody'))}</p>`)}
        ${section('guide.ravenriftPage.carrierHeading', `<p>${esc(t('guide.ravenriftPage.carrierBody'))}</p>`)}
        ${section('guide.ravenriftPage.ladderHeading', `<p>${esc(t('guide.ravenriftPage.ladderBody'))}</p>`)}
        ${related([
          { href: hrefFor('arena'), key: 'guide.nav.arena' },
          { href: hrefFor('classes'), key: 'guide.nav.classes' },
          { href: hrefFor('reference/combat'), key: 'guide.nav.combat' },
        ])}
      </article>`;
  },
};
