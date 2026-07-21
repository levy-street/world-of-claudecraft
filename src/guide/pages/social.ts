// Social and Groups: chat channels, parties and party loot, friends and ignore, and
// guilds. Systems and direction only, no moderation thresholds or filter internals.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { lead, p, related, section } from './ui';

// Each chat channel: a name and a one-line note on what it is for. Order follows the
// in-game channel set (say is the local default; world and lfg are opt-in globals).
const CHANNELS = [
  ['guide.social.chanSay', 'guide.social.chanSayBody'],
  ['guide.social.chanYell', 'guide.social.chanYellBody'],
  ['guide.social.chanWhisper', 'guide.social.chanWhisperBody'],
  ['guide.social.chanParty', 'guide.social.chanPartyBody'],
  ['guide.social.chanGeneral', 'guide.social.chanGeneralBody'],
  ['guide.social.chanWorld', 'guide.social.chanWorldBody'],
  ['guide.social.chanLfg', 'guide.social.chanLfgBody'],
  ['guide.social.chanGuild', 'guide.social.chanGuildBody'],
] as const;

// Party loot rules, in reading order. Names and direction only, no thresholds.
const LOOT = [
  ['guide.social.lootCoinTitle', 'guide.social.lootCoinBody'],
  ['guide.social.lootCommonTitle', 'guide.social.lootCommonBody'],
  ['guide.social.lootRollTitle', 'guide.social.lootRollBody'],
  ['guide.social.lootMasterTitle', 'guide.social.lootMasterBody'],
] as const;

export const social: GuidePage = {
  titleKey: 'guide.nav.social',
  render() {
    const channels = CHANNELS.map(
      ([name, body]) => `<li><strong>${esc(t(name))}</strong> ${esc(t(body))}</li>`,
    ).join('');
    const loot = LOOT.map(
      ([title, body]) => `<li><strong>${esc(t(title))}</strong> ${esc(t(body))}</li>`,
    ).join('');
    return `
      <article class="guide-article">
        <h1>${esc(t('guide.nav.social'))}</h1>
        ${lead('guide.social.intro')}

        <section class="guide-block">
          <h2>${esc(t('guide.social.chatHeading'))}</h2>
          <p>${esc(t('guide.social.chatBody'))}</p>
          <ul class="guide-list">${channels}</ul>
          <p>${esc(t('guide.social.emotesBody'))}</p>
        </section>

        ${section('guide.social.communityHeading', p('guide.social.communityBody'))}
        ${section('guide.social.slashHeading', p('guide.social.slashBody'))}

        <section class="guide-block">
          <h2>${esc(t('guide.social.partyHeading'))}</h2>
          <p>${esc(t('guide.social.partyBody'))}</p>
          <p>${esc(t('guide.social.partyCredit'))}</p>
          <p>${esc(t('guide.social.raidBody'))}</p>
        </section>

        ${section('guide.social.readyHeading', p('guide.social.readyBody'))}
        ${section('guide.social.markersHeading', p('guide.social.markersBody'))}

        <section class="guide-block">
          <h2>${esc(t('guide.social.lootHeading'))}</h2>
          <p>${esc(t('guide.social.lootBody'))}</p>
          <ul class="guide-list">${loot}</ul>
        </section>

        ${section('guide.social.friendsHeading', p('guide.social.friendsBody') + p('guide.social.ignoreBody'))}

        <section class="guide-block">
          <h2>${esc(t('guide.social.guildHeading'))}</h2>
          <p>${esc(t('guide.social.guildBody'))}</p>
          <p>${esc(t('guide.social.guildChatBody'))}</p>
        </section>

        ${section('guide.social.calendarHeading', p('guide.social.calendarBody'))}

        <section class="guide-block">
          <h2>${esc(t('guide.social.etiquetteHeading'))}</h2>
          <p>${esc(t('guide.social.etiquetteBody'))}</p>
        </section>

        ${related([
          { href: hrefFor('how-to-play'), key: 'guide.nav.howToPlay' },
          { href: hrefFor('dungeons'), key: 'guide.nav.dungeons' },
          { href: hrefFor('economy'), key: 'guide.nav.economy' },
        ])}
      </article>`;
  },
};
