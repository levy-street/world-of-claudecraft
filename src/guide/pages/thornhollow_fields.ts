// Thornhollow Fields: a spoiler-safe overview of the 5v5 capture-the-flag battleground.
// Concepts only (the mode, the field, flags, wave respawns, runes, rewards, the ladder);
// no honor amounts, rating math, or tuning constants (guide spoiler policy). The rewards
// section names the shapes only: result honor, the per-kill drip, the day's first win, the
// repeat-opponent taper and the forfeit rule; the Honor currency itself is explained once,
// on the arena page, which is the PvP hub.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { callout, p, pageHeader, related, section } from './ui';

export const thornhollowFields: GuidePage = {
  titleKey: 'guide.nav.thornhollow',
  render() {
    return `
      <article class="guide-article guide-thornhollow-fields">
        ${pageHeader('guide.thornhollowPage.heading', 'guide.thornhollowPage.intro')}
        ${section('guide.thornhollowPage.queueHeading', `<p>${esc(t('guide.thornhollowPage.queueBody'))}</p>`)}
        ${section('guide.thornhollowPage.fieldHeading', `<p>${esc(t('guide.thornhollowPage.fieldBody'))}</p>`)}
        ${section(
          'guide.thornhollowPage.flagsHeading',
          `<p>${esc(t('guide.thornhollowPage.flagsBody'))}</p>${callout(esc(t('guide.thornhollowPage.pickupNote')), { variant: 'note' })}`,
        )}
        ${section('guide.thornhollowPage.respawnHeading', `<p>${esc(t('guide.thornhollowPage.respawnBody'))}</p>`)}
        ${section('guide.thornhollowPage.carrierHeading', `<p>${esc(t('guide.thornhollowPage.carrierBody'))}</p>`)}
        ${section('guide.thornhollowPage.rewardsHeading', p('guide.thornhollowPage.rewardsBody'))}
        ${section('guide.thornhollowPage.ladderHeading', `<p>${esc(t('guide.thornhollowPage.ladderBody'))}</p>`)}
        ${related([
          { href: hrefFor('arena'), key: 'guide.nav.arena' },
          { href: hrefFor('gear'), key: 'guide.nav.gear' },
          { href: hrefFor('classes'), key: 'guide.nav.classes' },
          { href: hrefFor('reference/combat'), key: 'guide.nav.combat' },
        ])}
      </article>`;
  },
};
