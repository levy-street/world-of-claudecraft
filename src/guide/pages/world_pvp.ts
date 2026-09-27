// World PvP: a spoiler-safe overview of the /pvp flag. Concepts only (opt-in,
// the flag and its countdown, the three kinds of ground and what marks you on
// each, who counts as an enemy, the stakes shape, the fair-play rules); no
// honor amounts, gold caps or tuning constants (guide spoiler policy). The
// Honor currency itself is explained once, on the arena page, which is the PvP
// hub. The rules this page states come from src/sim/pvp/world_pvp_rules.ts and
// src/sim/pvp/world_pvp_zones.ts.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { pageHeader, related, section } from './ui';

export const worldPvp: GuidePage = {
  titleKey: 'guide.nav.worldPvp',
  render() {
    return `
      <article class="guide-article guide-world-pvp">
        ${pageHeader('guide.worldPvpPage.heading', 'guide.worldPvpPage.introZones')}
        ${section('guide.worldPvpPage.flagHeading', `<p>${esc(t('guide.worldPvpPage.flagBodyAid'))}</p>`)}
        ${section('guide.worldPvpPage.zonesHeading', `<p>${esc(t('guide.worldPvpPage.zonesBody'))}</p>`)}
        ${section(
          'guide.worldPvpPage.stakesHeading',
          `<p>${esc(t('guide.worldPvpPage.stakesBodyFlagged'))}</p><p>${esc(t('guide.worldPvpPage.stakesUnflaggedTake'))}</p>`,
        )}
        ${section('guide.worldPvpPage.limitsHeading', `<p>${esc(t('guide.worldPvpPage.limitsBodyRaids'))}</p>`)}
        ${section('guide.worldPvpPage.hillHeading', `<p>${esc(t('guide.worldPvpPage.hillBodyRamp'))}</p>`)}
        ${related([
          { href: hrefFor('arena'), key: 'guide.nav.arena' },
          { href: hrefFor('thornhollow-fields'), key: 'guide.nav.thornhollow' },
          { href: hrefFor('commands'), key: 'guide.nav.commands' },
        ])}
      </article>
    `;
  },
};
