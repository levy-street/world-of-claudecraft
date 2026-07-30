// The Vale Cup: a spoiler-safe overview of the boarball minigame at the
// Sowfield (docs/prd/vale-cup.md). The lore (boarball, the Old Sow, the Copper
// Pail, the harvest truce), how to play, the eight banner nations, and the
// sport roles. Concepts only: no kick powers, cooldowns, timers, or matchmaker
// internals. Nation and role NAMES reuse the game's own hudChrome.vcup.* keys
// so the wiki and the HUD can never drift apart on a proper noun.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { VCUP_NATION_NAME_KEYS } from '../../ui/vale_cup_flag';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { callout, loreBeat, pageHeader, related, section } from './ui';

// One beat card per banner nation: title = the shared nation-name key,
// body = a colors-and-emblem flavor line.
const NATIONS = [
  [VCUP_NATION_NAME_KEYS.vale, 'guide.valeCupPage.nationVale'],
  [VCUP_NATION_NAME_KEYS.mirefen, 'guide.valeCupPage.nationMirefen'],
  [VCUP_NATION_NAME_KEYS.thornpeak, 'guide.valeCupPage.nationThornpeak'],
  [VCUP_NATION_NAME_KEYS.coliseum, 'guide.valeCupPage.nationColiseum'],
  [VCUP_NATION_NAME_KEYS.choir, 'guide.valeCupPage.nationChoir'],
  [VCUP_NATION_NAME_KEYS.ogre, 'guide.valeCupPage.nationOgre'],
  [VCUP_NATION_NAME_KEYS.moon, 'guide.valeCupPage.nationMoon'],
  [VCUP_NATION_NAME_KEYS.copperdig, 'guide.valeCupPage.nationCopperdig'],
] as const;

const ROLES = [
  ['hudChrome.vcup.role.allrounder.name', 'hudChrome.vcup.role.allrounder.desc'],
  ['hudChrome.vcup.role.striker.name', 'hudChrome.vcup.role.striker.desc'],
  ['hudChrome.vcup.role.sweeper.name', 'hudChrome.vcup.role.sweeper.desc'],
  ['hudChrome.vcup.role.keeper.name', 'hudChrome.vcup.role.keeper.desc'],
] as const;

export const valeCup: GuidePage = {
  titleKey: 'guide.nav.valeCup',
  render() {
    const nations = NATIONS.map(([title, body]) => loreBeat(title, body)).join('');
    const roles = ROLES.map(([title, body]) => loreBeat(title, body)).join('');
    return `
      <article class="guide-article guide-vale-cup">
        ${pageHeader('guide.valeCupPage.heading', 'guide.valeCupPage.intro')}
        ${section(
          'guide.valeCupPage.loreHeading',
          `<p>${esc(t('guide.valeCupPage.loreOldSow'))}</p><p>${esc(t('guide.valeCupPage.loreTruce'))}</p>`,
        )}
        ${section(
          'guide.valeCupPage.howHeading',
          `<p>${esc(t('guide.valeCupPage.howQueue'))}</p>` +
            `<p>${esc(t('guide.valeCupPage.howMatch'))}</p>` +
            `${callout(esc(t('guide.valeCupPage.howTruce')), { variant: 'note' })}` +
            `<p>${esc(t('guide.valeCupPage.spectateBody'))}</p>`,
        )}
        ${section('guide.valeCupPage.bettingHeading', `<p>${esc(t('guide.valeCupPage.bettingBody'))}</p>`)}
        ${section('guide.valeCupPage.practiceHeading', `<p>${esc(t('guide.valeCupPage.practiceBody'))}</p>`)}
        ${section(
          'guide.valeCupPage.nationsHeading',
          `<p>${esc(t('guide.valeCupPage.nationsBody'))}</p><div class="guide-beat-grid">${nations}</div>`,
        )}
        ${section(
          'guide.valeCupPage.rolesHeading',
          `<p>${esc(t('guide.valeCupPage.rolesBody'))}</p><div class="guide-beat-grid">${roles}</div>`,
        )}
        ${section('guide.valeCupPage.rewardsHeading', `<p>${esc(t('guide.valeCupPage.rewardsBody'))}</p>`)}
        ${related([
          { href: hrefFor('how-to-play'), key: 'guide.nav.howToPlay' },
          { href: hrefFor('arena'), key: 'guide.nav.arena' },
          { href: hrefFor('world'), key: 'guide.nav.world' },
        ])}
      </article>`;
  },
};
