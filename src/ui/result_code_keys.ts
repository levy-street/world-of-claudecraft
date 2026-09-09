// The wire-union result-code key maps the HUD's event switch renders from
// (extracted from src/ui/hud.ts, which stays the thin consumer): the server
// answers a command with a structured CODE (mail, guild calendar, guild
// billboard, roster expansion) or a REASON (honor), never English, and the
// client picks the catalog line here. Every map is TOTAL over its code union,
// so a code added on the server without a line fails tsc; the paired
// *_FALLBACK_KEY is the wire-union fallback (R34's enum axis): every code is a
// SERVER value a newer deploy can widen, and t() throws on an undefined key,
// so an off-vocabulary code degrades to the family's most generic line
// instead of killing the event batch. tests/hud_wire_enum_fallbacks.test.ts
// pins the fallback arms in hud.ts and that each fallback key resolves;
// tests/result_code_keys.test.ts pins every key.

import type {
  CalendarResultCode,
  GuildRosterResultCode,
  HonorReason,
  MailResultCode,
  MotdResultCode,
} from '../sim/types';
import type { TranslationKey } from './i18n';

// Ravenpost mailResult refusal codes to their toast lines. `sent`/`collected`
// are successes rendered as chat-log lines in handleEvents, but they map here
// too; codes outside THIS bundle's union take the fallback below.
export const MAIL_RESULT_ERROR_KEYS: Record<MailResultCode, TranslationKey> = {
  sent: 'hudChrome.mailbox.result.sent',
  collected: 'hudChrome.mailbox.result.collected',
  tooFar: 'hudChrome.mailbox.result.tooFar',
  needRecipient: 'hudChrome.mailbox.result.needRecipient',
  noRecipient: 'hudChrome.mailbox.result.noRecipient',
  tooManyParcels: 'hudChrome.mailbox.result.tooManyParcels',
  noMailQuestItems: 'hudChrome.mailbox.result.noMailQuestItems',
  noMailBound: 'hudChrome.mailbox.result.noMailBound',
  noMailSoulbound: 'hudChrome.itemSoulbound',
  notEnoughItems: 'hudChrome.mailbox.result.notEnoughItems',
  cantAffordPostage: 'hudChrome.mailbox.result.cantAffordPostage',
  recipientBoxFull: 'hudChrome.mailbox.result.recipientBoxFull',
  letterGone: 'hudChrome.mailbox.result.letterGone',
  takeParcelsFirst: 'hudChrome.mailbox.result.takeParcelsFirst',
};
export const MAIL_RESULT_FALLBACK_KEY: TranslationKey = 'hudChrome.mailbox.result.letterGone';

// Guild calendar outcome lines (created/removed are chat-log successes).
export const CALENDAR_RESULT_KEYS: Record<CalendarResultCode, TranslationKey> = {
  created: 'hudChrome.calendar.result.created',
  removed: 'hudChrome.calendar.result.removed',
  notInGuild: 'hudChrome.calendar.result.notInGuild',
  notOfficer: 'hudChrome.calendar.result.notOfficer',
  badInput: 'hudChrome.calendar.result.badInput',
  calendarFull: 'hudChrome.calendar.result.calendarFull',
  eventGone: 'hudChrome.calendar.result.eventGone',
};
export const CALENDAR_RESULT_FALLBACK_KEY: TranslationKey = 'hudChrome.calendar.result.badInput';

// Guild billboard outcome lines (`set` is the chat-log success).
export const MOTD_RESULT_KEYS: Record<MotdResultCode, TranslationKey> = {
  set: 'hudChrome.social.billboard.result.set',
  notInGuild: 'hudChrome.calendar.result.notInGuild',
  notOfficer: 'hudChrome.social.billboard.result.notOfficer',
};
export const MOTD_RESULT_FALLBACK_KEY: TranslationKey =
  'hudChrome.social.billboard.result.notOfficer';

// Guild roster expansion refusals (every code is a refusal; the success is
// the guild-wide guildRosterExpanded event). cannotAfford takes {price}.
export const GUILD_ROSTER_RESULT_KEYS: Record<GuildRosterResultCode, TranslationKey> = {
  notInGuild: 'hudChrome.calendar.result.notInGuild',
  notLeader: 'hudChrome.social.roster.result.notLeader',
  maxed: 'hudChrome.social.roster.result.maxed',
  cannotAfford: 'hudChrome.social.roster.result.cannotAfford',
  retry: 'hudChrome.social.roster.result.retry',
};
export const GUILD_ROSTER_RESULT_FALLBACK_KEY: TranslationKey =
  'hudChrome.social.roster.result.retry';

// Honor grant reasons to their combat-log lines.
export const HONOR_REASON_KEYS: Record<HonorReason, TranslationKey> = {
  arena_win: 'hudChrome.warfare.reasons.arenaWin',
  arena_complete: 'hudChrome.warfare.reasons.arenaComplete',
  fiesta_kill: 'hudChrome.warfare.reasons.fiestaKill',
  fiesta_complete: 'hudChrome.warfare.reasons.fiestaComplete',
  fiesta_win: 'hudChrome.warfare.reasons.fiestaWin',
  battleground_win: 'hudChrome.warfare.reasons.battlegroundWin',
  battleground_first_win: 'hudChrome.warfare.reasons.battlegroundFirstWin',
  battleground_complete: 'hudChrome.warfare.reasons.battlegroundComplete',
  battleground_kill: 'hudChrome.warfare.reasons.battlegroundKill',
  battleground_assist: 'hudChrome.warfare.reasons.battlegroundAssist',
};
export const HONOR_REASON_FALLBACK_KEY: TranslationKey = 'hudChrome.warfare.reasons.arenaWin';
