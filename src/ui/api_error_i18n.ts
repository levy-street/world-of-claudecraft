// Localizes a failed REST/WS call into player-facing text. Two layers, tried in
// order:
//
//   1. CODE-FIRST. The API request pipeline (server/http/) answers errors
//      with a stable machine `code` (`domain.reason`) drawn from the server
//      catalog (server/http/error_codes.ts): either the RFC 9457 problem+json
//      `code`, or the additive `code` on a migrated legacy `{ error, code, date }`
//      body. A code in API_ERROR_KEYS resolves to its `apiError.<domain>.<reason>`
//      key, with the two parametric cases (a suspension date, a rate-limit
//      duration) formatted CLIENT-side (the server never localizes or formats).
//   2. PROSE FALLBACK. Routes still on the old ladder (until it is removed) answer with
//      bare English text and no code. The historical string matcher recognizes
//      those and re-renders them through `t()` / `tServer()`; a code that is NOT
//      in the table (an un-migrated route that grew one) also lands here.
//
// Anything neither layer recognizes is a transport/protocol diagnostic and stays
// English by design (browser logs and support reports match the server source).
//
// This module is DOM-free and host-agnostic (a Vitest drives it directly): it reads
// the stable code + params structurally off the thrown value, never importing the
// `net/` ApiError class (the src/ui -> net dependency ban).

import { formatDateTime, formatDuration, type TranslationKey, t } from './i18n';
import { tServer } from './server_i18n';

// The stable-code -> translation-key table, the fixed cross-layer convention:
// code `domain.reason` maps to key `apiError.domain.reason` VERBATIM. It covers
// every code in the server catalog (server/http/error_codes.ts); the parity guard
// (tests/api_error_code_parity.test.ts) cross-checks this table against that
// catalog so a new server code without a client key (or vice versa) fails the gate.
// `satisfies Record<string, TranslationKey>` keeps every value a real, typed
// translation key (a typo or a key missing from the catalog is a tsc error).
export const API_ERROR_KEYS = {
  // Structural pipeline primitives.
  'validation.failed': 'apiError.validation.failed',
  'json.malformed': 'apiError.json.malformed',
  'auth.token_missing': 'apiError.auth.token_missing',
  'auth.token_invalid': 'apiError.auth.token_invalid',
  'auth.forbidden': 'apiError.auth.forbidden',
  'body.too_large': 'apiError.body.too_large',
  'db.conflict': 'apiError.db.conflict',
  'rate_limit.exceeded': 'apiError.rate_limit.exceeded',
  'internal.error': 'apiError.internal.error',

  // auth: authentication, session, and credential-check failures.
  'auth.invalid_credentials': 'apiError.auth.invalid_credentials',
  'auth.required': 'apiError.auth.required',
  'auth.web_login_only': 'apiError.auth.web_login_only',
  'auth.too_many_attempts': 'apiError.auth.too_many_attempts',
  'auth.too_many_failed_attempts': 'apiError.auth.too_many_failed_attempts',
  'auth.current_password_incorrect': 'apiError.auth.current_password_incorrect',
  'auth.password_incorrect': 'apiError.auth.password_incorrect',
  'auth.verification_failed': 'apiError.auth.verification_failed',

  // account: account-field validation and self-service account state.
  'account.username_invalid': 'apiError.account.username_invalid',
  'account.username_not_allowed': 'apiError.account.username_not_allowed',
  'account.username_taken': 'apiError.account.username_taken',
  'account.username_mismatch': 'apiError.account.username_mismatch',
  'account.password_too_short': 'apiError.account.password_too_short',
  'account.password_too_long': 'apiError.account.password_too_long',
  'account.characters_online': 'apiError.account.characters_online',
  'account.deactivated': 'apiError.account.deactivated',
  'account.not_found': 'apiError.account.not_found',

  // character: creation, selection, and world-entry failures.
  'character.name_invalid': 'apiError.character.name_invalid',
  'character.name_not_allowed': 'apiError.character.name_not_allowed',
  'character.invalid_class': 'apiError.character.invalid_class',
  'character.limit_reached': 'apiError.character.limit_reached',
  'character.name_taken': 'apiError.character.name_taken',
  'character.not_found': 'apiError.character.not_found',
  'character.online': 'apiError.character.online',
  'character.rename_not_permitted': 'apiError.character.rename_not_permitted',
  'character.delete_confirm': 'apiError.character.delete_confirm',
  'character.already_in_world': 'apiError.character.already_in_world',
  'character.taken_over': 'apiError.character.taken_over',
  'character.rename_required': 'apiError.character.rename_required',

  // moderation: enforcement states set by a moderator.
  'moderation.suspended_until': 'apiError.moderation.suspended_until',
  'moderation.suspended': 'apiError.moderation.suspended',
  'moderation.banned': 'apiError.moderation.banned',
  'moderation.force_rename': 'apiError.moderation.force_rename',

  // email: email-change validation.
  'email.invalid': 'apiError.email.invalid',
  'email.unchanged': 'apiError.email.unchanged',

  // two_factor: two-factor setup and verification state.
  'two_factor.code_invalid': 'apiError.two_factor.code_invalid',
  'two_factor.setup_required': 'apiError.two_factor.setup_required',
  'two_factor.already_enabled': 'apiError.two_factor.already_enabled',
  'two_factor.not_enabled': 'apiError.two_factor.not_enabled',

  // The Content-Type / Origin gate hardening contracts (no legacy English identity).
  'body.unsupported_media_type': 'apiError.body.unsupported_media_type',
  'origin.cross_site': 'apiError.origin.cross_site',

  // discord: Discord link / sign-in / reward-claim failures.
  'discord.not_configured': 'apiError.discord.not_configured',
  'discord.expired': 'apiError.discord.expired',
  'discord.already_linked': 'apiError.discord.already_linked',
  'discord.password_required': 'apiError.discord.password_required',
  'discord.unknown_swag': 'apiError.discord.unknown_swag',
  'discord.link_required': 'apiError.discord.link_required',
  'discord.swag_claimed': 'apiError.discord.swag_claimed',
  'discord.swag_tier': 'apiError.discord.swag_tier',
  'discord.swag_points': 'apiError.discord.swag_points',
  'deeds.invalid_input': 'apiError.deeds.invalid_input',

  // steam: the env-gated Steam link family (server/steam/).
  'steam.disabled': 'apiError.steam.disabled',
  'steam.invalid_ticket': 'apiError.steam.invalid_ticket',
  'steam.banned': 'apiError.steam.banned',
  'steam.already_linked': 'apiError.steam.already_linked',
  'steam.account_taken': 'apiError.steam.account_taken',
  'steam.upstream': 'apiError.steam.upstream',
} satisfies Record<string, TranslationKey>;

/** The message of an Error, or the string form of any other thrown value. */
export function technicalErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// The stable code carried on a thrown value (an ApiError-shaped object, or any
// object with a string `code`), read structurally so this module never imports the
// net/ ApiError class. An empty or non-string code is treated as absent.
function errorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return undefined;
}

// The params bag carried alongside the code (the parsed problem+json / legacy body;
// e.g. `retryAfterSeconds` for a rate limit, `date` for a suspension).
function errorParams(err: unknown): Record<string, unknown> | undefined {
  if (err && typeof err === 'object' && 'params' in err) {
    const params = (err as { params?: unknown }).params;
    if (params && typeof params === 'object') return params as Record<string, unknown>;
  }
  return undefined;
}

// Resolves a coded error to localized text, or null to defer to the prose fallback.
// null when: the code is not in the table (an un-migrated route), or a parametric
// code arrives without the value it needs (a rate limit with no seconds).
function resolveByCode(code: string, params: Record<string, unknown> | undefined): string | null {
  const key = (API_ERROR_KEYS as Partial<Record<string, TranslationKey>>)[code];
  if (key === undefined) return null;

  if (code === 'moderation.suspended_until') {
    // The server sends the suspension deadline as an ISO/epoch value; format it
    // client-side. With no date to render, defer to prose (which may still capture
    // the legacy `suspended until <toUTCString>` text); an unparseable but present
    // value passes through raw so the message is never empty.
    const raw = params?.date;
    if (raw === undefined || raw === null || raw === '') return null;
    const ms = new Date(raw as string | number).getTime();
    return Number.isFinite(ms)
      ? t(key, { date: formatDateTime(new Date(ms)) })
      : t(key, { date: String(raw) });
  }

  if (code === 'rate_limit.exceeded') {
    // {seconds} in the catalog receives an already-localized duration phrase, not a
    // bare number. Without a numeric retryAfterSeconds, defer to prose.
    const seconds = params?.retryAfterSeconds;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
    return t(key, { seconds: formatDuration(seconds) });
  }

  return t(key);
}

export function userFacingApiError(err: unknown): string {
  const code = errorCode(err);
  if (code) {
    const byCode = resolveByCode(code, errorParams(err));
    if (byCode !== null) return byCode;
  }

  // --- Prose fallback (old-ladder routes, until the ladder is removed). Moved verbatim from
  // src/main.ts; each arm re-localizes a stable English source string. ---
  const text = technicalErrorMessage(err);
  const suspended = text.match(/^This account is suspended until (.+)\.$/);
  if (suspended) return t('errors.api.accountSuspended', { date: suspended[1] });

  const normalized = text.toLowerCase();
  if (normalized.startsWith('too many attempts')) return t('errors.api.tooManyAttempts');
  // The Discord rate-limit bucket (server/discord.ts) answers a bare { error: 'rate
  // limited' } 429; resolve it to the same "slow down" message rather than leaking the
  // raw English (the discordRateLimited gap the choice panel already handled inline).
  if (normalized === 'rate limited') return t('errors.api.tooManyAttempts');
  if (normalized === 'username must be 3-24 chars (letters, digits, _)')
    return t('errors.api.usernameShape');
  if (normalized === 'username is not allowed') return t('errors.api.usernameNotAllowed');
  if (normalized === 'password must be at least 6 chars') return t('errors.api.passwordMin');
  if (normalized === 'username already taken') return t('errors.api.usernameTaken');
  if (normalized === 'invalid username or password') return t('errors.api.invalidCredentials');
  if (normalized === 'invalid character name (2-16 letters)')
    return t('errors.api.invalidCharacterName');
  if (normalized === 'character name is not allowed')
    return t('errors.api.characterNameNotAllowed');
  if (normalized === 'invalid class') return t('errors.api.invalidClass');
  if (normalized === 'character limit reached') return t('errors.api.characterLimit');
  if (normalized === 'that name is taken') return t('errors.api.nameTaken');
  if (
    normalized === 'character not found' ||
    normalized === 'no such character' ||
    normalized === 'not found'
  )
    return t('errors.api.characterNotFound');
  if (normalized === 'character is currently online') return t('errors.api.characterOnline');
  if (normalized === 'character rename is not permitted') return t('errors.api.renameNotPermitted');
  if (normalized === 'type the character name to confirm deletion')
    return t('errors.api.deleteConfirm');
  if (normalized === 'not authenticated' || normalized === 'authentication required')
    return t('errors.api.notAuthenticated');
  if (normalized === 'this account has been banned.') return t('errors.api.accountBanned');
  if (normalized === 'character already in world') return t('errors.api.alreadyInWorld');
  if (normalized === 'too many characters on this account are already in the world')
    return t('errors.api.accountSessionLimit');
  if (normalized === 'character taken over') return t('errors.api.takenOver');
  if (normalized === 'this character must be renamed before entering the world.')
    return t('errors.api.renameBeforeEntering');
  if (normalized === 'logins are only allowed from the game client')
    return t('errors.api.webLoginOnly');
  // Account portal REST errors (server/main.ts /api/account/*). English-source,
  // re-localized here onto the English-only hudChrome.account.* keys.
  if (normalized === 'current password is incorrect')
    return t('hudChrome.account.errCurrentPassword');
  if (normalized === 'enter a valid email address') return t('hudChrome.account.errEmailInvalid');
  if (normalized === 'username does not match') return t('hudChrome.account.errUsernameMatch');
  if (normalized === 'password is incorrect') return t('hudChrome.account.errPasswordIncorrect');
  if (normalized === 'log out all characters before deactivating')
    return t('hudChrome.account.errCharactersOnline');
  if (normalized === 'this account has been deactivated.')
    return t('hudChrome.account.deactivatedLocked');
  if (normalized === 'password must be at most 128 chars')
    return t('hudChrome.account.errPasswordLong');
  if (normalized === 'that is already your email address')
    return t('hudChrome.account.errEmailUnchanged');
  // Password-reset ("forgot password") link is invalid or expired (server/account.ts).
  if (normalized === 'invalid or expired link') return t('hudChrome.auth.resetErrInvalid');
  if (
    normalized === 'that code is not valid, try again' ||
    normalized === 'invalid authentication code'
  )
    return t('hudChrome.account.errTwoFactorCode');
  if (
    normalized === 'start two-factor setup first' ||
    normalized === 'two-factor is already enabled' ||
    normalized === 'two-factor is not enabled'
  )
    return t('hudChrome.account.errTwoFactorState');
  // The account row vanished mid-session (404 from /api/account/*); treat as a
  // dropped session rather than rendering raw English in the form.
  if (normalized === 'account not found') return t('errors.api.notAuthenticated');
  // Cloudflare Turnstile rejection on login/register (passesTurnstile in
  // server/turnstile.ts).
  if (normalized === 'verification failed, please try again')
    return t('errors.api.verificationFailed');
  // Desktop app login handoff (server/desktop_login.ts exchange, plus the
  // client-side guard in completeDesktopBrowserLogin when the mint response
  // carries no code).
  if (
    normalized === 'invalid or expired desktop login code' ||
    normalized === 'missing desktop login code'
  )
    return t('errors.api.desktopCodeInvalid');
  // WebSocket disconnect reasons surfaced through the fatal overlay (net/online.ts).
  if (normalized === 'connection to the server was lost.') return t('loading.connectionLost');
  if (normalized === 'rejected by server') return t('loading.connectionRejected');
  // NOTE: protocol/transport diagnostics ('bad auth message', 'authentication timed out',
  // etc.) are intentionally NOT translated, they are developer/diagnostic errors and must
  // stay English so browser logs and support reports match the server source.
  // Moderation kicks and the login brute-force throttle (server/admin.ts, server/main.ts).
  if (normalized === 'this account is suspended.') return tServer('moderation.suspended');
  if (normalized === 'a moderator requires one of your characters to be renamed.')
    return tServer('moderation.forceRename');
  if (normalized.startsWith('too many failed attempts')) return tServer('moderation.tooManyFailed');
  // Transport/runtime failures are diagnostic code errors. Preserve their
  // English source text so browser logs and support reports match exactly.
  return text;
}
