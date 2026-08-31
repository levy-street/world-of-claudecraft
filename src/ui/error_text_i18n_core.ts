// The HUD error-text matcher: the English an `error` event carries from
// `src/sim` or `server` (both language-agnostic by invariant) resolved into the
// client's t() keys. Extracted from hud.ts verbatim so the whole table is unit
// testable; the two pieces that need live HUD state (the mirrored raid lockouts
// and the localized countdown formatter) arrive through ErrorTextLockoutDeps.
// Falls through to the shared localizeServerText / localizeSimText matchers, and
// finally returns the input unchanged when nothing recognizes it.
// The two display-name resolvers the instances-busy arm reads came across with
// the body and stay exported: hud.ts's own remaining call sites import them back
// rather than keeping a second copy of the same one-line delegation.

import { DELVES, DUNGEON_LIST } from '../sim/data';
import { dungeonDisplayName, tEntity } from './entity_i18n';
import { formatDuration, formatNumber, type TranslationKey, t } from './i18n';
import type { RaidLockout } from './raid_lockout';
import { localizeServerText } from './server_i18n';
import { localizeSimText } from './sim_i18n';

/** The live HUD state the lockout arms enrich their toast with: the mirrored
 *  lockouts and the localized "Xd Yh" countdown formatter Hud owns. */
export interface ErrorTextLockoutDeps {
  raidLockouts(): RaidLockout[];
  formatLockoutDuration(ms: number): string;
}

export function localizeErrorText(text: string, deps: ErrorTextLockoutDeps): string {
  // Named `quota` rather than the longer hud.ts identifier for one reason: it keeps
  // the literal and the exec call it feeds on ONE line. The S3 drift guard harvests
  // an arm's patterns with a single-line scan, so a formatter-wrapped call would
  // drop this arm out of the guard's set without failing anything.
  const quota = /^General chat limit reached\. Try again in ([1-9]\d*) seconds\.$/.exec(text);
  if (quota) {
    return t('hudChrome.chatQuota.limitReached', {
      seconds: formatDuration(Number(quota[1])),
    });
  }
  // Raid entry while locked: enrich the toast with the live unlock countdown
  // from the mirrored lockout state. Falls through to the base sim_i18n message
  // (still recognized there) if the lockout already cleared client-side.
  if (text === 'You are locked to Nythraxis Raid Arena.') {
    const lock = deps.raidLockouts().find((l) => l.id === 'nythraxis_boss_arena');
    if (lock) {
      return t('hudChrome.raidLockout.lockedToast', {
        raid: dungeonDisplayName('nythraxis_boss_arena'),
        time: deps.formatLockoutDuration(lock.msRemaining),
      });
    }
  }
  // Normal-difficulty raid lockout (the weekly rooms): the same enrichment
  // keyed on the plain dungeon id. The negative lookahead keeps "Heroic X"
  // for the heroic arm below instead of relying on arm ordering.
  const normalLock = /^You are locked to (?!Heroic )(.+)\.$/.exec(text);
  if (normalLock) {
    const base = DUNGEON_LIST.find((d) => d.name === normalLock[1]);
    const lock = base ? deps.raidLockouts().find((l) => l.id === base.id) : undefined;
    if (base && lock) {
      return t('hudChrome.raidLockout.lockedToast', {
        raid: dungeonDisplayName(base.id),
        time: deps.formatLockoutDuration(lock.msRemaining),
      });
    }
  }
  // Heroic daily lockout (any heroic instance): resolve the dungeon name and
  // enrich with the live countdown when the mirrored lockout is present.
  const heroicLock = /^You are locked to Heroic (.+)\.$/.exec(text);
  if (heroicLock) {
    const base = DUNGEON_LIST.find((d) => d.name === heroicLock[1]);
    const name = base ? dungeonDisplayName(base.id) : heroicLock[1];
    const lock = base ? deps.raidLockouts().find((l) => l.id === `${base.id}:heroic`) : undefined;
    if (lock) {
      return t('hudChrome.raidLockout.lockedToast', {
        raid: t('hudChrome.raidLockout.heroicName', { name }),
        time: deps.formatLockoutDuration(lock.msRemaining),
      });
    }
    return t('hudChrome.raidLockout.heroicLocked', { name });
  }
  const exact: Record<string, TranslationKey> = {
    'General chat is temporarily unavailable. Try again shortly.':
      'hudChrome.chatQuota.unavailable',
    'Your previous General chat message is still sending. Try again in a moment.':
      'hudChrome.chatQuota.pending',
    'You are stunned!': 'hud.errors.stunned',
    'You are silenced!': 'hud.errors.silenced',
    // The rooted-charge refusal. Reuses the existing combat key rather than
    // minting an errors.* twin: the string is already carried in every
    // locale, and a second English spelling of "you cannot move" would be a
    // translation ask for no player-visible gain.
    "Can't move!": 'hud.combat.cannotMove',
    'You are busy.': 'hud.errors.busy',
    'That ability is not ready yet.': 'hud.errors.abilityNotReady',
    'Not enough rage!': 'hud.errors.notEnoughRage',
    'Not enough energy!': 'hud.errors.notEnoughEnergy',
    'Not enough mana!': 'hud.errors.notEnoughMana',
    'Not enough Devotion!': 'hud.errors.notEnoughDevotion',
    'Not enough health.': 'hud.errors.notEnoughHealth',
    'Your target must dodge first.': 'hud.errors.targetMustDodge',
    'That ability requires combo points.': 'hud.errors.requiresCombo',
    "You can't do that while shapeshifted.": 'hud.errors.shapeshifted',
    'You must be stealthed.': 'hud.errors.stealthed',
    "You can't do that while in combat.": 'hud.errors.inCombat',
    'Out of range.': 'hud.errors.outOfRange',
    'You have no target.': 'hud.errors.noTarget',
    'Too close!': 'hud.errors.tooClose',
    // The friendly-rush refusal. A new key rather than a reuse of noTarget: the
    // player may well HAVE a target (an enemy one), and telling them they have
    // none would send them looking for the wrong problem.
    'You must target an ally.': 'hud.errors.mustTargetAlly',
    'You must be facing your target.': 'hud.errors.facing',
    'You must wield a dagger.': 'hud.errors.dagger',
    'You must be behind your target.': 'hud.errors.behindTarget',
    'This creature cannot be polymorphed.': 'hud.errors.polymorph',
    'You have no active Seal.': 'hud.errors.noSeal',
    'You cannot taunt that.': 'hud.errors.cannotTaunt',
    'You have no pet.': 'hud.errors.noPet',
    'Invalid attack target.': 'hud.errors.invalidAttackTarget',
    'You are sending messages too quickly.': 'hud.errors.chatTooFast',
    'You are sending messages too quickly. Slow down.': 'hud.errors.chatSlowDown',
    'No one has whispered you recently.': 'hud.errors.noRecentWhisper',
    'You mutter to yourself. Nobody hears it.': 'hud.errors.whisperSelf',
    'You are not in a party.': 'hud.errors.notInParty',
    'You must be in a party to start a ready check.': 'hudChrome.readyCheck.notInPartyError',
    'Recovery: /unstuck starts a stationary countdown, then moves you to the nearest graveyard, reviving you if you had fallen. It leaves you with Unstuck Sickness for up to 5 minutes.':
      'hudChrome.unstuck.helpUnstuckSickness',
    // Pre-0.32.1 wording: still arrives from a not-yet-updated server when an OTA
    // bundle runs ahead of it, so keep it re-localizable.
    "Recovery: /unstuck starts a stationary countdown, then sends your spirit to the nearest graveyard. Returning through the Pale Keeper requires The Keeper's Toll.":
      'hudChrome.unstuck.helpAtGraveyard',
    'A ready check is already in progress.': 'hudChrome.readyCheck.inProgressError',
    'Only the party leader can change the loot method.': 'hudChrome.masterLoot.leaderOnly',
    'Only the party leader may invite.': 'hud.errors.partyLeaderInvite',
    'Your party is full.': 'hud.errors.partyFull',
    'That party is full.': 'hud.errors.partyFull',
    'The invitation has expired.': 'hud.errors.invitationExpired',
    'Target is too far away.': 'hud.errors.targetTooFar',
    'A duel is already in progress.': 'hud.errors.duelInProgress',
    'The challenge has expired.': 'hud.errors.challengeExpired',
    'You are already in an arena match.': 'hud.errors.arenaAlreadyInMatch',
    'You cannot queue for the arena while dead.': 'hud.errors.arenaQueueDead',
    'You cannot queue while dueling.': 'hud.errors.arenaQueueDueling',
    'Finish your trade before queueing.': 'hud.errors.arenaQueueTrading',
    'You cannot queue from inside an instance.': 'hud.errors.arenaQueueInstance',
    'A trade is already in progress.': 'hud.errors.tradeInProgress',
    'That player is already trading.': 'hud.errors.tradeAlreadyTrading',
    'Target is too far away to trade.': 'hud.errors.tradeTooFar',
    'The trade request has expired.': 'hud.errors.tradeExpired',
    'Trade failed: items or money no longer available.': 'hud.errors.tradeFailed',
    'That item is bound and cannot be traded.': 'hud.errors.tradeBound',
    'That can only be traded to players who shared its drop.': 'hud.errors.tradeWindowIneligible',
    'That item is bound and cannot be listed.': 'hud.errors.marketListBound',
    'That quest is not available.': 'questUi.errors.unavailable',
    'That quest is not in your log.': 'questUi.errors.notInLog',
    'That quest is not complete.': 'questUi.errors.incomplete',
    'That quest giver is not nearby.': 'questUi.errors.giverMissing',
    'That quest turn-in is not nearby.': 'questUi.errors.turnInMissing',
    'Too far away.': 'questUi.errors.tooFar',
    "This quest can't be shared.": 'hudChrome.questShare.notShareable',
    'That item is not sold here.': 'itemUi.errors.notSoldHere',
    'Not enough money.': 'itemUi.errors.notEnoughMoney',
    'Not enough honor.': 'hudChrome.warfare.notEnoughHonor',
    'You must bring your goods to the Merchant.': 'itemUi.errors.bringGoods',
    'The Merchant will not broker quest items.': 'itemUi.errors.noQuestItems',
    'You do not have that many to sell.': 'itemUi.errors.notEnoughToSell',
    'Name a price of at least 1 copper.': 'itemUi.errors.minPrice',
    'That price is beyond what the Merchant will broker.': 'itemUi.errors.priceTooHigh',
    'You are too far from the Merchant.': 'itemUi.errors.tooFar',
    'That listing is no longer available.': 'itemUi.errors.listingUnavailable',
    'You cannot afford that.': 'itemUi.errors.cannotAfford',
    'That is not your listing.': 'itemUi.errors.notYourListing',
    'You have nothing to collect.': 'itemUi.errors.nothingToCollect',
    "You can't assist yourself.": 'hud.errors.assistSelf',
    'Assist whom? Target a player or use /assist <name>.': 'hud.errors.assistWhom',
    'Invite whom? Usage: /invite <name>.': 'hudChrome.party.inviteUsage',
  };
  const key = exact[text];
  if (key) return t(key);

  let match = /^You must be in (Bruin|Wolf) Form\.$/.exec(text);
  if (match)
    return t('hud.errors.requiresForm', {
      form: t(match[1] === 'Bruin' ? 'hud.errors.bear' : 'hud.errors.cat'),
    });
  match = /^You can't do that in (Bruin|Wolf|Fleet) Form\.$/.exec(text);
  if (match)
    return t('hud.errors.cantInForm', {
      form: t(
        match[1] === 'Bruin'
          ? 'hud.errors.bear'
          : match[1] === 'Fleet'
            ? 'hud.errors.travel'
            : 'hud.errors.cat',
      ),
    });
  match = /^That ability requires the target below (\d+)% health\.$/.exec(text);
  if (match) return t('hud.errors.targetHealthBelow', { percent: match[1] });
  match = /^Not enough (.+)!$/.exec(text);
  if (match) return t('hud.errors.notEnoughResource', { resource: match[1] });
  match = /^Several players match '(.+)'\. Use exact capitalization\.$/.exec(text);
  if (match) return t('hud.errors.whisperAmbiguous', { name: match[1] });
  match = /^There is no player named '(.+)' online\.$/.exec(text);
  if (match) return t('hud.errors.whisperMissing', { name: match[1] });
  match = /^Assisting (.+)\.$/.exec(text);
  if (match) return t('hud.errors.assisting', { name: match[1] });
  // Assist reply only: anchor the name to a single un-punctuated token run so a
  // future unmapped "... has no target." sim line is not mis-localized with a wrong
  // {name}. Player names never contain a period, so excluding "." keeps this specific.
  match = /^([^.]+) has no target\.$/.exec(text);
  if (match) return t('hud.errors.assistNoTarget', { name: match[1] });
  // Lenient suffix match: the sim's command-help list (". Try /s /y /w /p /g, /me, …")
  // evolves over time; capture the command non-greedily and tolerate any "Try /…" tail
  // so this never silently falls through to raw English again.
  match = /^Unknown command: (.+?)\. Try \/.*$/.exec(text);
  if (match) return t('hud.errors.unknownCommand', { command: match[1] });
  match = /^Chat is on cooldown for (\d+)s\.$/.exec(text);
  if (match) return t('hud.errors.chatCooldown', { seconds: match[1] });
  match = /^Chat locked for (\d+)s because you are sending messages too quickly\.$/.exec(text);
  if (match) return t('hud.errors.chatLocked', { seconds: match[1] });
  match = /^(.+) is already in a party\.$/.exec(text);
  if (match) return t('hud.errors.alreadyInParty', { name: match[1] });
  match = /^(.+) already has a pending invitation\.$/.exec(text);
  if (match) return t('hud.errors.pendingInvite', { name: match[1] });
  match = /^You must be in (.+)'s party to accept that quest\.$/.exec(text);
  if (match) return t('hudChrome.questShare.notInSharerParty', { name: match[1] });
  match = /^You may keep at most (\d+) goods on the market at once\.$/.exec(text);
  if (match)
    return t('itemUi.errors.tooManyListings', {
      count: formatNumber(Number(match[1]), { maximumFractionDigits: 0 }),
    });
  match = /^That is your own listing (?:\u2014|-) cancel it to reclaim it\.$/.exec(text);
  if (match) return t('itemUi.errors.ownListing');
  match = /^All instances of (.+) are busy\. Try again soon\.$/.exec(text);
  if (match) {
    const busyName = match[1];
    // The same line is emitted for dungeons and delves; resolve the name in the
    // matching table so a delve name does not fall through as raw English.
    const delve = Object.values(DELVES).find((d) => d.name === busyName);
    if (delve)
      return t('sim.delve.instancesBusy', {
        name: delveDisplayName(delve.id),
      });
    return t('worldContent.dungeonInstanceBusy', {
      name: dungeonDisplayNameFromSource(busyName),
    });
  }
  const server = localizeServerText(text);
  if (server !== null) return server;
  // Sim-emitted log/error/loot text (src/sim) is English at the source; localize it
  // here, the same way server-sent text is handled above.
  const simLocalized = localizeSimText(text);
  if (simLocalized !== null) return simLocalized;
  return text;
}

export function delveDisplayName(delveId: string): string {
  return tEntity({ kind: 'delve', id: delveId, field: 'name' });
}

export function dungeonDisplayNameFromSource(name: string): string {
  const dungeon = DUNGEON_LIST.find((candidate) => candidate.name === name);
  return dungeon ? dungeonDisplayName(dungeon.id) : name;
}
