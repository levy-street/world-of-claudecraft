// The system-message matcher: server- and sim-emitted English turned back into
// the player's language.
//
// WHY IT IS NOT ON THE HUD. It is a pure function of one string. It reads no
// coordinator state, holds nothing across calls, and its whole surface is
// "English in, localized out", which is exactly the shape src/ui/CLAUDE.md says
// belongs in its own module: a Vitest can drive every arm of it directly, where
// on the Hud each one needed a constructed coordinator to reach.
//
// It is the client half of the sim/server localization contract (root CLAUDE.md,
// i18n): src/sim and server/ stay language-agnostic and emit stable English, and
// this is where that English is re-localized. A new sim or server message with a
// player-visible string needs its arm HERE in the same change, which is what the
// S3 guard (tests/localization_fixes.test.ts) enforces.
//
// ORDER IS LOAD-BEARING: exact matches first, then the content tables, then the
// regex arms most specific first, then the two shared fallbacks. A general arm
// moved above a specific one silently swallows it.

import { DELVE_LIST, DUNGEON_LIST } from '../sim/data';
import {
  delveText,
  dungeonDisplayNameFromSource,
  dungeonText,
  itemDisplayNameFromSource,
  questTitleFromSource,
} from './entity_display_core';
import { formatNumber, t } from './i18n';
import type { TranslationKey } from './i18n.catalog';
import { localizeServerText } from './server_i18n';
import { localizeSimText } from './sim_i18n';

/** English system text in, the player's language out. Returns the input
 *  unchanged when nothing matches, so an unlocalized message still shows. */
export function localizeSystemText(text: string): string {
  const exact: Record<string, TranslationKey> = {
    'You stand up.': 'hud.logs.standUp',
    'Your party has disbanded.': 'hud.logs.partyDisbanded',
    'The duel has begun!': 'hud.logs.duelBegun',
    'The duel has ended.': 'hud.logs.duelEnded',
    'You join the Ashen Coliseum queue. Stand by for a worthy opponent...': 'hud.logs.arenaJoin',
    'You join the Ashen Coliseum queue. Stand by for a worthy opponent…': 'hud.logs.arenaJoin',
    'You leave the Ashen Coliseum queue.': 'hud.logs.arenaLeave',
    'You step onto the sands of the Ashen Coliseum.': 'hud.logs.arenaSands',
    'You step onto the flooded stones of the Drowned Court.': 'hud.logs.arenaSandsDrowned',
    'Fight!': 'hud.system.arenaStart',
    'Trade window opened.': 'hud.logs.tradeOpened',
    'Trade complete.': 'hud.logs.tradeComplete',
    'Trade cancelled.': 'hud.logs.tradeCancelled',
    'Trade window closed.': 'hudChrome.trade.windowClosed',
    'Loot method set to Group Loot.': 'hudChrome.masterLoot.methodGroup',
    'Loot Settings: Group Loot.': 'hudChrome.masterLoot.summaryGroup',
  };
  const key = exact[text];
  if (key) return t(key);
  // The DEPLOY-WINDOW alias for the one wire-carried reword this packet makes
  // (Masterwrought phase 18 QA, the Drowned Temple enterText de-dash). The sim
  // emits enterText as RAW ENGLISH and this loop matches it by exact bytes, so
  // the CONTENT copy is the match key: a server that has not restarted yet still
  // sends the pre-reword sentence, which the new client would fail to match and
  // render raw, em dash and all, which is the very thing the reword removed.
  // Same practice as the phase 03 wire-carried renames (pinned in
  // tests/localization_fixes.test.ts, as is this arm) and the same shape as the
  // arena queue line's ellipsis twin in the exact map above. RULED
  // qr-19-drowned-temple-entertext-deploy-alias (2026-09-02): ratified; retire
  // this arm and its pin once the release carrying this branch's reword
  // (release/v0.42.0 at the time of writing) is fully deployed. The old separator
  // is spelled as an ESCAPE, never as the byte: the repo forbids an em dash in
  // source (a raw-NUL guard once made git classify this whole file as binary).
  if (
    text ===
    `You step through the moongate \u2014 the air turns to cold water and pale light, and the singing closes over your head.`
  ) {
    return dungeonText('drowned_temple', 'enterText');
  }
  for (const dungeon of DUNGEON_LIST) {
    if (text === dungeon.enterText) return dungeonText(dungeon.id, 'enterText');
    if (text === dungeon.leaveText) return dungeonText(dungeon.id, 'leaveText');
  }
  for (const delve of DELVE_LIST) {
    if (text === delve.enterText) return delveText(delve.id, 'enterText');
    if (text === delve.leaveText) return delveText(delve.id, 'leaveText');
  }

  let match = /^Loot method set to Master Loot\. Master Looter: (.+)\.$/.exec(text);
  if (match) return t('hudChrome.masterLoot.methodMaster', { name: match[1] });
  match = /^Master Looter is now (.+)\.$/.exec(text);
  if (match) return t('hudChrome.masterLoot.looterChanged', { name: match[1] });
  match = /^Loot threshold set to (uncommon|rare|epic)\.$/.exec(text);
  if (match)
    return t('hudChrome.masterLoot.thresholdSet', {
      threshold: t(
        `hudChrome.masterLoot.threshold${match[1][0].toUpperCase()}${match[1].slice(1)}` as TranslationKey,
      ),
    });
  match = /^Loot Settings: Master Loot, Master Looter (.+), threshold (uncommon|rare|epic)\.$/.exec(
    text,
  );
  if (match)
    return t('hudChrome.masterLoot.summaryMaster', {
      name: match[1],
      threshold: t(
        `hudChrome.masterLoot.threshold${match[2][0].toUpperCase()}${match[2].slice(1)}` as TranslationKey,
      ),
    });
  match = /^You have invited (.+) to your party\.$/.exec(text);
  if (match) return t('hud.logs.partyInviteSent', { name: match[1] });
  match = /^(.+) joins the party\.$/.exec(text);
  if (match) return t('hud.logs.partyJoin', { name: match[1] });
  match = /^(.+) declines your invitation\.$/.exec(text);
  if (match) return t('hud.logs.partyDecline', { name: match[1] });
  match = /^(.+) is now the party leader\.$/.exec(text);
  if (match) return t('hud.logs.partyLeader', { name: match[1] });
  match = /^You have challenged (.+) to a duel\.$/.exec(text);
  if (match) return t('hud.logs.duelChallengeSent', { name: match[1] });
  match = /^(.+) declines your challenge\.$/.exec(text);
  if (match) return t('hud.logs.duelDecline', { name: match[1] });
  match = /^You have requested to trade with (.+)\.$/.exec(text);
  if (match) return t('hud.logs.tradeRequestSent', { name: match[1] });
  match = /^(.+) has come online\.$/.exec(text);
  if (match) return t('hud.logs.friendOnline', { name: match[1] });
  match = /^(.+) has gone offline\.$/.exec(text);
  if (match) return t('hud.logs.friendOffline', { name: match[1] });
  match = /^Quest accepted: (.+)$/.exec(text);
  if (match)
    return t('questUi.logs.accepted', {
      name: questTitleFromSource(match[1]),
    });
  match = /^Quest abandoned: (.+)$/.exec(text);
  if (match)
    return t('questUi.logs.abandoned', {
      name: questTitleFromSource(match[1]),
    });
  match = /^Quest completed: (.+)$/.exec(text);
  if (match)
    return t('questUi.logs.completed', {
      name: questTitleFromSource(match[1]),
    });
  match = /^(.+) accepted your shared quest\.$/.exec(text);
  if (match) return t('hudChrome.questShare.accepted', { name: match[1] });
  match = /^(.+) \(Complete\)$/.exec(text);
  if (match)
    return t('questUi.logs.ready', {
      name: questTitleFromSource(match[1]),
      status: t('questUi.log.readyStatus'),
    });
  match = /^Your market listing of (.+) expired and waits at the Merchant\.$/.exec(text);
  if (match)
    return t('itemUi.logs.expiredListing', {
      item: itemDisplayNameFromSource(match[1]),
    });
  // The dungeon party-size warning is emitted as a 'log' event (sim.ts), so it must be
  // matched on this path, not in localizeLootText.
  match = /^(.+) is meant for a full party of (\d+)\. Tread carefully\.$/.exec(text);
  if (match) {
    return t('worldContent.dungeonPartyWarning', {
      name: dungeonDisplayNameFromSource(match[1]),
      count: formatNumber(Number(match[2]), { maximumFractionDigits: 0 }),
    });
  }
  match = /^(\d+) daily rewards points gained\.$/.exec(text);
  if (match)
    return t('hudChrome.dailyRewards.pointsGained', {
      points: formatNumber(Number(match[1]), { maximumFractionDigits: 0 }),
    });
  // Server-sent friends/guild/who/world messages arrive as 'log' events; fall
  // back to the shared server-message localizer (same as localizeErrorText /
  // localizeLootText) so they are not displayed in raw English.
  const server = localizeServerText(text);
  if (server !== null) return server;
  // Sim-emitted log/error/loot text (src/sim) is English at the source; localize it
  // here, the same way server-sent text is handled above.
  const simLocalized = localizeSimText(text);
  if (simLocalized !== null) return simLocalized;
  return text;
}
