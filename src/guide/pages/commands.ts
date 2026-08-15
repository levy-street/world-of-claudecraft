// Slash-command reference. The command tokens and their aliases are literal typed
// text, not localized copy, so they live in this module the way controls.ts holds
// its key glyphs; only the "what it does" column comes from the catalog.
//
// The list mirrors the game's own routers: the sim dispatch in
// src/sim/social/chat.ts (talking, channels, party, readouts, presence, recovery)
// plus the server-side chat commands (guild and officer chat, /who, ignore and
// block). The ALLOW_DEV_COMMANDS-gated /dev surface is deliberately absent: it is
// a development cheat set, never available in normal play.

import { esc } from '../../ui/esc';
import { type TranslationKey, t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { callout, lead, p, related, section } from './ui';

interface Row {
  /** The command plus its aliases, exactly as typed. */
  cmds: string[];
  desc: TranslationKey;
}
interface Group {
  heading: TranslationKey;
  /** Optional lead-in shown above the table. */
  intro?: TranslationKey;
  rows: Row[];
  /** Optional footnote shown under the table. */
  note?: TranslationKey;
}

const GROUPS: Group[] = [
  {
    heading: 'guide.commandsPage.groupTalking',
    rows: [
      { cmds: ['/say <message>', '/s <message>'], desc: 'guide.commandsPage.say' },
      { cmds: ['/yell <message>', '/y <message>'], desc: 'guide.commandsPage.yell' },
      {
        cmds: ['/whisper <name> <message>', '/w', '/t', '/tell'],
        desc: 'guide.commandsPage.whisper',
      },
      { cmds: ['/reply <message>', '/r'], desc: 'guide.commandsPage.reply' },
      { cmds: ['/me <action>', '/emote', '/e'], desc: 'guide.commandsPage.me' },
      { cmds: ['/party <message>', '/p <message>'], desc: 'guide.commandsPage.partyChat' },
    ],
  },
  {
    heading: 'guide.commandsPage.groupChannels',
    intro: 'guide.commandsPage.channelsIntro',
    rows: [
      { cmds: ['/general <message>', '/1 <message>'], desc: 'guide.commandsPage.general' },
      { cmds: ['/g <message>'], desc: 'guide.commandsPage.gAlias' },
      { cmds: ['/guild <message>', '/gu <message>'], desc: 'guide.commandsPage.guild' },
      { cmds: ['/officer <message>', '/o <message>'], desc: 'guide.commandsPage.officer' },
      { cmds: ['/join <channel>', '/leave <channel>'], desc: 'guide.commandsPage.join' },
      { cmds: ['/world <message>'], desc: 'guide.commandsPage.world' },
      { cmds: ['/lfg <message>'], desc: 'guide.commandsPage.lfg' },
    ],
  },
  {
    heading: 'guide.commandsPage.groupParty',
    rows: [
      { cmds: ['/invite <name>'], desc: 'guide.commandsPage.invite' },
      { cmds: ['/party', '/group', '/grp'], desc: 'guide.commandsPage.partyRoster' },
      { cmds: ['/ready', '/readycheck'], desc: 'guide.commandsPage.ready' },
      { cmds: ['/assist [name]', '/as [name]'], desc: 'guide.commandsPage.assist' },
      { cmds: ['/follow [name]'], desc: 'guide.commandsPage.follow' },
      { cmds: ['/unfollow'], desc: 'guide.commandsPage.unfollow' },
      { cmds: ['/roll', '/roll N', '/roll M-N'], desc: 'guide.commandsPage.roll' },
    ],
  },
  {
    heading: 'guide.commandsPage.groupPeople',
    rows: [
      { cmds: ['/who [text]'], desc: 'guide.commandsPage.who' },
      { cmds: ['/inspect <name>', '/ins', '/examine'], desc: 'guide.commandsPage.inspect' },
      {
        cmds: ['/ignore <name>', '/unignore <name>', '/ignorelist'],
        desc: 'guide.commandsPage.ignore',
      },
      {
        cmds: ['/block <name>', '/unblock <name>', '/blocklist'],
        desc: 'guide.commandsPage.block',
      },
    ],
    note: 'guide.commandsPage.peopleNote',
  },
  {
    heading: 'guide.commandsPage.groupSelf',
    intro: 'guide.commandsPage.selfIntro',
    rows: [
      { cmds: ['/played'], desc: 'guide.commandsPage.played' },
      { cmds: ['/playtime'], desc: 'guide.commandsPage.playtime' },
      { cmds: ['/xp', '/exp', '/experience'], desc: 'guide.commandsPage.xp' },
      { cmds: ['/gold', '/money', '/coins'], desc: 'guide.commandsPage.gold' },
      { cmds: ['/stats', '/st', '/sheet'], desc: 'guide.commandsPage.stats' },
      { cmds: ['/gear', '/equip', '/equipment'], desc: 'guide.commandsPage.gear' },
      { cmds: ['/bags', '/inv', '/inventory'], desc: 'guide.commandsPage.bags' },
      { cmds: ['/abilities', '/spells', '/spellbook'], desc: 'guide.commandsPage.abilities' },
      { cmds: ['/talents', '/talent', '/spec'], desc: 'guide.commandsPage.talents' },
      { cmds: ['/quest', '/quests', '/ql'], desc: 'guide.commandsPage.quests' },
      { cmds: ['/completed', '/questsdone', '/qdone'], desc: 'guide.commandsPage.completed' },
      { cmds: ['/session', '/sess', '/sessionstats'], desc: 'guide.commandsPage.session' },
      { cmds: ['/arena', '/pvp', '/rating'], desc: 'guide.commandsPage.arena' },
      { cmds: ['/listings', '/mylistings', '/auctions'], desc: 'guide.commandsPage.listings' },
      { cmds: ['/buyback', '/bb', '/repurchase'], desc: 'guide.commandsPage.buyback' },
    ],
  },
  {
    heading: 'guide.commandsPage.groupState',
    rows: [
      { cmds: ['/buffs', '/buff', '/auras'], desc: 'guide.commandsPage.buffs' },
      { cmds: ['/cooldowns', '/cooldown', '/cd', '/cds'], desc: 'guide.commandsPage.cooldowns' },
      { cmds: ['/pet', '/pets', '/companion'], desc: 'guide.commandsPage.pet' },
      { cmds: ['/pettaunt', '/petgrowl', '/growl'], desc: 'guide.commandsPage.petTaunt' },
      { cmds: ['/speed', '/movespeed', '/ms'], desc: 'guide.commandsPage.speed' },
      { cmds: ['/form', '/stance', '/shapeshift'], desc: 'guide.commandsPage.form' },
      { cmds: ['/manaregen', '/regen', '/5sr'], desc: 'guide.commandsPage.manaRegen' },
      { cmds: ['/savedmana', '/parkedmana', '/sm'], desc: 'guide.commandsPage.savedMana' },
      { cmds: ['/combo', '/cp', '/combopoints'], desc: 'guide.commandsPage.combo' },
      {
        cmds: ['/consumable', '/consumables', '/eat', '/drink'],
        desc: 'guide.commandsPage.consumable',
      },
      { cmds: ['/potion', '/potioncd', '/pot'], desc: 'guide.commandsPage.potion' },
      { cmds: ['/falling', '/jump', '/airborne'], desc: 'guide.commandsPage.falling' },
    ],
  },
  {
    heading: 'guide.commandsPage.groupCombat',
    rows: [
      { cmds: ['/target', '/tar'], desc: 'guide.commandsPage.target' },
      { cmds: ['/targetbuffs', '/debuffs', '/tb'], desc: 'guide.commandsPage.targetBuffs' },
      { cmds: ['/range', '/dist', '/distance'], desc: 'guide.commandsPage.range' },
      { cmds: ['/attack', '/autoattack', '/aa'], desc: 'guide.commandsPage.attack' },
      { cmds: ['/casting', '/cast', '/castbar'], desc: 'guide.commandsPage.casting' },
      { cmds: ['/combat', '/cb', '/incombat'], desc: 'guide.commandsPage.combat' },
      { cmds: ['/threat', '/aggro'], desc: 'guide.commandsPage.threat' },
      { cmds: ['/consider', '/con', '/difficulty'], desc: 'guide.commandsPage.consider' },
      { cmds: ['/queued', '/onswing', '/swingqueue'], desc: 'guide.commandsPage.queued' },
      { cmds: ['/overpower', '/op', '/overpowered'], desc: 'guide.commandsPage.overpower' },
    ],
  },
  {
    heading: 'guide.commandsPage.groupWorld',
    rows: [
      { cmds: ['/where', '/loc', '/zone'], desc: 'guide.commandsPage.where' },
      { cmds: ['/zones', '/zonelist', '/worldmap'], desc: 'guide.commandsPage.zones' },
      { cmds: ['/nearby', '/near', '/around'], desc: 'guide.commandsPage.nearby' },
      { cmds: ['/pois', '/poi', '/landmarks'], desc: 'guide.commandsPage.pois' },
      { cmds: ['/graveyard', '/gy', '/spirithealer'], desc: 'guide.commandsPage.graveyard' },
      { cmds: ['/dungeons', '/dungeon', '/instances'], desc: 'guide.commandsPage.dungeons' },
      { cmds: ['/dungeon normal', '/dungeon heroic'], desc: 'guide.commandsPage.dungeonMode' },
      { cmds: ['/dungeon reset'], desc: 'guide.commandsPage.dungeonReset' },
    ],
  },
  {
    heading: 'guide.commandsPage.groupRecovery',
    rows: [
      { cmds: ['/unstuck'], desc: 'guide.commandsPage.unstuck' },
      { cmds: ['/afk [message]'], desc: 'guide.commandsPage.afk' },
      { cmds: ['/dnd [message]'], desc: 'guide.commandsPage.dnd' },
      { cmds: ['/sit', '/stand'], desc: 'guide.commandsPage.sit' },
      { cmds: ['/help', '/commands', '/?'], desc: 'guide.commandsPage.help' },
    ],
  },
];

// Command tokens are literal typed text (like the key glyphs on the Controls page),
// so they are never routed through t().
function cmd(text: string): string {
  return `<kbd>${esc(text)}</kbd>`;
}

function renderGroup(g: Group): string {
  const rows = g.rows
    .map((r) => `<tr><td>${r.cmds.map(cmd).join(' ')}</td><td>${esc(t(r.desc))}</td></tr>`)
    .join('');
  return `
      <section class="guide-block">
        <h2>${esc(t(g.heading))}</h2>
        ${g.intro ? `<p>${esc(t(g.intro))}</p>` : ''}
        <div class="guide-table-scroll">
          <table class="guide-keytable">
            <thead><tr><th>${esc(t('guide.commandsPage.cmdHeader'))}</th><th>${esc(t('guide.commandsPage.doesHeader'))}</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${g.note ? `<p>${esc(t(g.note))}</p>` : ''}
      </section>`;
}

export const commands: GuidePage = {
  titleKey: 'guide.nav.commands',
  render() {
    return `
      <article class="guide-article">
        <h1>${esc(t('guide.nav.commands'))}</h1>
        ${lead('guide.commandsPage.intro')}
        ${p('guide.commandsPage.slashBody')}
        ${p('guide.commandsPage.aliasBody')}
        ${p('guide.commandsPage.stickyBody')}
        ${callout(p('guide.commandsPage.helpTipBody'), {
          variant: 'tip',
          titleKey: 'guide.commandsPage.helpTipTitle',
        })}
        ${GROUPS.map(renderGroup).join('')}
        ${section(
          'guide.commandsPage.emotesHeading',
          `${p('guide.commandsPage.emotesBody')}
           <p class="guide-section-more"><a href="${esc(hrefFor('social'))}">${esc(t('guide.commandsPage.emotesMore'))}</a></p>`,
        )}
        ${section(
          'guide.commandsPage.bangHeading',
          `${p('guide.commandsPage.bangBody')}${p('guide.commandsPage.bangList')}`,
        )}
        ${section('guide.commandsPage.unknownHeading', p('guide.commandsPage.unknownBody'))}
        ${related([
          { href: hrefFor('reference/controls'), key: 'guide.nav.controls' },
          { href: hrefFor('social'), key: 'guide.nav.social' },
          { href: hrefFor('reference/interface'), key: 'guide.nav.interface' },
        ])}
      </article>`;
  },
};
