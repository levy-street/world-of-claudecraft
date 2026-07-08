// i18n source catalog - client localization home for server-emitted stable error codes.
//
// The server (and offline Sim's REST-shaped failures) speak stable machine codes, never
// English prose: server/http/error_codes.ts is the SINGLE source of truth for the code set.
// The client matcher (src/main.ts userFacingApiError) turns a received
// `domain.reason` code into player text via t('apiError.<domain>.<reason>', values).
//
// KEY SHAPE (fixed contract): a code 'domain.reason' maps VERBATIM to the nested key
// apiError.<domain>.<reason>, leaf names snake_case mirroring the code exactly. This is a
// machine-code mirror domain: the identity mapping is deliberate, so keep every leaf name
// byte-identical to its code in error_codes.ts and never rename one (renaming a code is
// forbidden there; renaming the mirror key silently breaks the matcher).
//
// English values only; the locale translations live in src/ui/i18n.locales/<lang>.ts (the
// runtime-authoritative overlays), filled by the maintainer at release. REUSE the existing
// English wording wherever an equivalent string already exists (errors.api.* in shell.ts,
// hudChrome.account.* in hud_chrome.ts, the moderation lines in server_i18n.ts): the duplication
// across apiError.* and those legacy keys is expected and correct while both paths render.
//
// REWORD-STALENESS WARNING (see docs/i18n-scaling/translation-workflow.md): rewording an
// English value here silently stales its overlay translations (the pending count only catches
// a MISSING key, never a changed one). Reword the OVERLAY translations in the same change, and
// for a wordy value refresh its five non-Latin fills.
//
// PLACEHOLDERS: only apiError.moderation.suspended_until ({date}) and apiError.rate_limit.exceeded
// ({seconds}) carry a token. {seconds} receives an ALREADY-LOCALIZED duration phrase (e.g.
// "30 seconds"), so never pre-format a number into these values.

export const apiErrorStrings = {
  // Structural pipeline codes (the 9 primitives the error serializers map an HTTP status onto).
  validation: {
    failed: 'Some fields are invalid. Check the form and try again.',
  },
  json: {
    malformed: 'That request could not be read. Please try again.',
  },
  body: {
    too_large: 'That request is too large. Try again with less data.',
    // Content-Type 415 gate (server/http/middleware/content_type.ts); reuses errors.api.unsupportedMediaType.
    unsupported_media_type: 'Unsupported request format.',
  },
  db: {
    conflict: 'That change conflicted with another update. Please try again.',
  },
  rate_limit: {
    // {seconds} is an already-localized duration phrase (e.g. "30 seconds").
    exceeded: 'Too many requests. Try again in {seconds}.',
  },
  internal: {
    error: 'Something went wrong on our end. Please try again.',
  },
  // auth: authentication, session, and credential-check failures.
  auth: {
    token_missing: 'You need to be signed in to do that.',
    token_invalid: 'Your session has expired. Please sign in again.',
    forbidden: 'You do not have permission to do that.',
    // reuses errors.api.invalidCredentials
    invalid_credentials: 'Invalid username or password.',
    // reuses errors.api.notAuthenticated
    required: 'Not authenticated.',
    // reuses errors.api.webLoginOnly
    web_login_only: 'Logins are only allowed from the game client.',
    // reuses errors.api.tooManyAttempts
    too_many_attempts: 'Too many attempts. Wait a minute and try again.',
    // reuses server_i18n moderation.tooManyFailed
    too_many_failed_attempts: 'Too many failed attempts. Wait a few minutes and try again.',
    // reuses hudChrome.account.errCurrentPassword
    current_password_incorrect: 'Your current password is incorrect.',
    // reuses hudChrome.account.errPasswordIncorrect
    password_incorrect: 'Your password is incorrect.',
    // reuses errors.api.verificationFailed
    verification_failed: 'Verification failed. Please try again.',
  },
  // account: account-field validation and self-service account state.
  account: {
    // reuses errors.api.usernameShape
    username_invalid: 'Username must be 3-24 characters and use letters, digits, or underscore.',
    // reuses errors.api.usernameNotAllowed
    username_not_allowed: 'That username is not allowed.',
    // reuses errors.api.usernameTaken
    username_taken: 'That username is already taken.',
    // reuses hudChrome.account.errUsernameMatch
    username_mismatch: 'That username does not match your account.',
    // reuses errors.api.passwordMin
    password_too_short: 'Password must be at least 6 characters.',
    // reuses hudChrome.account.errPasswordLong
    password_too_long: 'New password must be at most 128 characters.',
    // reuses hudChrome.account.errCharactersOnline
    characters_online: 'Log out all of your characters before deactivating.',
    // reuses hudChrome.account.deactivatedLocked
    deactivated: 'This account has been deactivated. Contact an admin to restore it.',
    not_found: 'Account not found.',
  },
  // character: character creation, selection, and world-entry failures.
  character: {
    // reuses errors.api.invalidCharacterName
    name_invalid: 'Invalid character name. Use 2-16 letters.',
    // reuses errors.api.characterNameNotAllowed
    name_not_allowed: 'That character name is not allowed.',
    // reuses errors.api.invalidClass
    invalid_class: 'Invalid class.',
    // reuses errors.api.characterLimit
    limit_reached: 'Character limit reached.',
    // reuses errors.api.nameTaken
    name_taken: 'That name is taken.',
    // reuses errors.api.characterNotFound
    not_found: 'Character not found.',
    // reuses errors.api.characterOnline
    online: 'Character is currently online.',
    // reuses errors.api.renameNotPermitted
    rename_not_permitted: 'Renaming this character is not allowed.',
    // reuses errors.api.deleteConfirm
    delete_confirm: 'Type the character name to confirm deletion.',
    // reuses errors.api.alreadyInWorld
    already_in_world: 'Character is already in world.',
    // reuses errors.api.takenOver
    taken_over: 'Your character was taken over by another session.',
    // reuses errors.api.renameBeforeEntering
    rename_required: 'This character must be renamed before entering the world.',
  },
  // moderation: enforcement states set by a moderator.
  moderation: {
    // reuses errors.api.accountSuspended
    suspended_until: 'This account is suspended until {date}.',
    // reuses server_i18n moderation.suspended
    suspended: 'This account is suspended.',
    // reuses errors.api.accountBanned
    banned: 'This account has been banned.',
    // reuses server_i18n moderation.forceRename
    force_rename: 'A moderator requires one of your characters to be renamed.',
  },
  // email: email-change validation.
  email: {
    // reuses hudChrome.account.errEmailInvalid
    invalid: 'Enter a valid email address.',
    // reuses hudChrome.account.errEmailUnchanged
    unchanged: 'That is already your email address.',
  },
  // two_factor: two-factor setup and verification state.
  two_factor: {
    // reuses hudChrome.account.errTwoFactorCode
    code_invalid: 'That code is not valid, try again.',
    setup_required: 'Start two-factor setup first.',
    already_enabled: 'Two-factor is already enabled.',
    not_enabled: 'Two-factor is not enabled.',
  },
  // origin: the cross-site Origin gate (server/http/middleware/origin_check.ts).
  origin: {
    // reuses errors.api.crossSiteOrigin
    cross_site: 'Request blocked for security reasons.',
  },
  // discord: the Discord family codes (server/discord.ts), riding alongside
  // the untouched legacy JSON prose. The shared 'rate limited' body is NOT here (it is
  // the cross-cutting rate_limit.exceeded identity).
  discord: {
    // reuses hudChrome.discord.disabled
    not_configured: 'Discord integration is not available right now.',
    // reuses hudChrome.discord.choice.expired
    expired: 'That Discord sign-in expired. Please sign in with Discord again.',
    already_linked: 'That Discord account is already linked to another account.',
    password_required: 'Set a password before unlinking your Discord account.',
    unknown_swag: 'That reward is not available.',
    link_required: 'Link your Discord account first.',
    swag_claimed: 'You have already claimed this reward.',
    // reuses hudChrome.discord.swag.needTier
    swag_tier: 'Reach a higher rank to claim this.',
    // reuses hudChrome.discord.swag.needPoints
    swag_points: 'Not enough points.',
  },
};
