// Social and Groups: worlds (the realm picker), chat channels, parties and party loot,
// the Dungeon Finder as a social tool, friends, ignore and block, guilds and the guild
// bank, and reporting. Systems and direction only, no moderation thresholds, no filter
// internals, no bank prices.

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
          <h2>${esc(t('guide.social.realmsHeading'))}</h2>
          <p>${esc(t('guide.social.realmsBody'))}</p>
          <p>${esc(t('guide.social.realmsScopeBody'))}</p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.social.chatHeading'))}</h2>
          <p>${esc(t('guide.social.chatBody'))}</p>
          <ul class="guide-list">${channels}</ul>
          <p>${esc(t('guide.social.emotesBody'))}</p>
          <p class="guide-section-more"><a href="${esc(hrefFor('reference/interface'))}">${esc(t('guide.social.chatMore'))}</a></p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.social.communityHeading'))}</h2>
          <p>${esc(t('guide.social.communityBody'))}</p>
          <p>${esc(t('guide.social.discordLinkBody'))}</p>
        </section>

        ${section('guide.social.slashHeading', p('guide.social.slashBody'))}

        <section class="guide-block">
          <h2>${esc(t('guide.social.partyHeading'))}</h2>
          <p>${esc(t('guide.social.partyBody'))}</p>
          <p>${esc(t('guide.social.partyCredit'))}</p>
          <p>${esc(t('guide.social.raidBody'))}</p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.social.finderHeading'))}</h2>
          <p>${esc(t('guide.social.finderBody'))}</p>
          <p>${esc(t('guide.social.finderBoardBody'))}</p>
          <p class="guide-section-more"><a href="${esc(hrefFor('dungeons'))}">${esc(t('guide.social.finderMore'))}</a></p>
        </section>

        ${section('guide.social.readyHeading', p('guide.social.readyBody'))}
        ${section('guide.social.markersHeading', p('guide.social.markersBody'))}

        <section class="guide-block">
          <h2>${esc(t('guide.social.lootHeading'))}</h2>
          <p>${esc(t('guide.social.lootBody'))}</p>
          <ul class="guide-list">${loot}</ul>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.social.friendsHeading'))}</h2>
          <p>${esc(t('guide.social.friendsBody'))}</p>
          <p>${esc(t('guide.social.ignoreBody'))}</p>
          <p>${esc(t('guide.social.blockBody'))}</p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.social.guildHeading'))}</h2>
          <p>${esc(t('guide.social.guildBody'))}</p>
          <p>${esc(t('guide.social.guildChatBody'))}</p>
          <p>${esc(t('guide.social.guildBoardBody'))}</p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.social.guildBankHeading'))}</h2>
          <p>${esc(t('guide.social.guildBankBody'))}</p>
          <p>${esc(t('guide.social.guildBankRulesBody'))}</p>
        </section>

        ${section('guide.social.calendarHeading', p('guide.social.calendarBody'))}

        <section class="guide-block">
          <h2>${esc(t('guide.social.etiquetteHeading'))}</h2>
          <p>${esc(t('guide.social.etiquetteBody'))}</p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.social.moderationHeading'))}</h2>
          <p>${esc(t('guide.social.moderationBody'))}</p>
        </section>

        <section class="guide-block">
          <h2>${esc(t('guide.social.jailHeading'))}</h2>
          <p>${esc(t('guide.social.jailBody'))}</p>
        </section>

        ${related([
          { href: hrefFor('how-to-play'), key: 'guide.nav.howToPlay' },
          { href: hrefFor('dungeons'), key: 'guide.nav.dungeons' },
          { href: hrefFor('reference/interface'), key: 'guide.nav.interface' },
          { href: hrefFor('economy'), key: 'guide.nav.economy' },
        ])}
      </article>`;
  },
};
