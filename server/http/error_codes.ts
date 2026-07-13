// Stable error-code catalog for the API request pipeline.
//
// The SINGLE source of truth for machine error codes. A code is a stable
// `domain.reason` identifier, NEVER English prose: the error-model serializers
// (errors.ts) reference these literally and the client re-localizes a code to
// player text (the code-matcher, src/ui/api_error_i18n.ts). This module is pure
// data plus types: it has ZERO imports, no DOM, and no sim/client dependency.
//
// APPEND-ONLY (AIP-193): codes are permanent. Never renumber, rename, or remove an
// existing code; only ADD new ones. Renaming a code silently breaks the client
// matcher and every persisted reference. The snapshot test
// (tests/server/http/error_codes.test.ts) fails if a code is removed or renamed.
//
// Each value is `{ params }`, where params is the ordered list of placeholder names
// the code's localized message interpolates (empty when the code carries none). The
// `as const` pins the literal types; deepFreeze pins runtime immutability.

/** Recursively freeze an object and its nested objects/arrays. */
function deepFreeze<T>(value: T): T {
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return value;
}

export const ERROR_CODES = deepFreeze({
  // --- Structural codes (the 9 pipeline primitives; the error-model serializers map an
  // HTTP status onto these). Do not change these names or param keys. ---
  'validation.failed': { params: ['issues'] },
  'json.malformed': { params: [] },
  'auth.token_missing': { params: [] },
  'auth.token_invalid': { params: [] },
  'auth.forbidden': { params: [] },
  'body.too_large': { params: ['maxBytes'] },
  'db.conflict': { params: [] },
  'rate_limit.exceeded': { params: ['retryAfterSeconds'] },
  'internal.error': { params: [] },

  // --- Harvested user-facing identities (seeded from src/main.ts userFacingApiError;
  // the client matcher localizes these). One code per existing identity; the
  // identity comment names the English source string(s) the code stands in for. ---

  // auth: authentication, session, and credential-check failures.
  // identity: "invalid username or password"
  'auth.invalid_credentials': { params: [] },
  // identity: "not authenticated" / "authentication required"
  'auth.required': { params: [] },
  // identity: "logins are only allowed from the game client"
  'auth.web_login_only': { params: [] },
  // identity: "too many attempts ..." (login rate-limit message)
  'auth.too_many_attempts': { params: [] },
  // identity: "too many failed attempts ..." (brute-force throttle)
  'auth.too_many_failed_attempts': { params: [] },
  // identity: "current password is incorrect"
  'auth.current_password_incorrect': { params: [] },
  // identity: "password is incorrect"
  'auth.password_incorrect': { params: [] },
  // identity: "verification failed, please try again" (Turnstile bot gate)
  'auth.verification_failed': { params: [] },

  // account: account-field validation and self-service account state.
  // identity: "username must be 3-24 chars (letters, digits, _)"
  'account.username_invalid': { params: [] },
  // identity: "username is not allowed"
  'account.username_not_allowed': { params: [] },
  // identity: "username already taken"
  'account.username_taken': { params: [] },
  // identity: "username does not match"
  'account.username_mismatch': { params: [] },
  // identity: "password must be at least 6 chars"
  'account.password_too_short': { params: [] },
  // identity: "password must be at most 128 chars"
  'account.password_too_long': { params: [] },
  // identity: "log out all characters before deactivating"
  'account.characters_online': { params: [] },
  // identity: "this account has been deactivated."
  'account.deactivated': { params: [] },
  // identity: "account not found" (the account row vanished mid-session)
  'account.not_found': { params: [] },

  // character: character creation, selection, and world-entry failures.
  // identity: "invalid character name (2-16 letters)"
  'character.name_invalid': { params: [] },
  // identity: "character name is not allowed"
  'character.name_not_allowed': { params: [] },
  // identity: "invalid class"
  'character.invalid_class': { params: [] },
  // identity: "character limit reached"
  'character.limit_reached': { params: [] },
  // identity: "that name is taken" (character name)
  'character.name_taken': { params: [] },
  // identity: "character not found" / "no such character" / "not found"
  'character.not_found': { params: [] },
  // identity: "character is currently online"
  'character.online': { params: [] },
  // identity: "character rename is not permitted"
  'character.rename_not_permitted': { params: [] },
  // identity: "type the character name to confirm deletion"
  'character.delete_confirm': { params: [] },
  // identity: "character already in world"
  'character.already_in_world': { params: [] },
  // identity: "character taken over"
  'character.taken_over': { params: [] },
  // identity: "this character must be renamed before entering the world."
  'character.rename_required': { params: [] },

  // moderation: enforcement states set by a moderator.
  // identity: "this account is suspended until {date}."
  'moderation.suspended_until': { params: ['date'] },
  // identity: "this account is suspended."
  'moderation.suspended': { params: [] },
  // identity: "this account has been banned."
  'moderation.banned': { params: [] },
  // identity: "a moderator requires one of your characters to be renamed."
  'moderation.force_rename': { params: [] },

  // email: email-change validation.
  // identity: "enter a valid email address"
  'email.invalid': { params: [] },
  // identity: "that is already your email address"
  'email.unchanged': { params: [] },

  // two_factor: two-factor setup and verification state.
  // identity: "that code is not valid, try again" / "invalid authentication code"
  'two_factor.code_invalid': { params: [] },
  // identity: "start two-factor setup first"
  'two_factor.setup_required': { params: [] },
  // identity: "two-factor is already enabled"
  'two_factor.already_enabled': { params: [] },
  // identity: "two-factor is not enabled"
  'two_factor.not_enabled': { params: [] },

  // --- Content-Type / Origin gate hardening codes (new contracts, no legacy English
  // identity). Emitted only when the matching gate runs in enforce mode; both gates
  // ship log-only, so no response carries these until the native-traffic audit flips
  // the flags. The client matcher is wired to these. ---

  // The request Content-Type is not application/json on a JSON /api route
  // (the Content-Type 415 gate, server/http/middleware/content_type.ts).
  'body.unsupported_media_type': { params: [] },
  // A mutating request carried a clear cross-site Origin that is neither
  // same-origin nor allowlisted (server/http/middleware/origin_check.ts).
  'origin.cross_site': { params: [] },

  // --- Discord family codes. These ride ALONGSIDE the untouched legacy
  // prose in the server/discord.ts { error } bodies (additive; the format stays
  // JSON, never problem+json). The shared rate-limit prose { error: 'rate limited' }
  // is NOT coded here: it is the cross-cutting rate_limit.exceeded identity whose
  // coded emission lands on the migrated path via the rateLimit(policy) middleware,
  // and Discord's DISCORD_POLICY stays UNMOUNTED (its keying is entangled with the
  // handler; mounting would switch the body to problem+json, out of scope). ---

  // identity: "Discord integration is not configured" (feature-off 503 on start)
  'discord.not_configured': { params: [] },
  // identity: "expired" (the one-time OAuth/pending-login handoff token expired)
  'discord.expired': { params: [] },
  // identity: "already_linked" (this Discord identity is linked to another account)
  'discord.already_linked': { params: [] },
  // identity: "password_required" (unlink a Discord-only account needs a password)
  'discord.password_required': { params: [] },
  // identity: "unknown swag item" (the swagId is not a known reward)
  'discord.unknown_swag': { params: [] },
  // identity: "link your Discord account first" (swag claim needs a linked account)
  'discord.link_required': { params: [] },
  // identity: "claimed" (this swag reward was already claimed)
  'discord.swag_claimed': { params: [] },
  // identity: "tier" (status tier too low to claim this swag reward)
  'discord.swag_tier': { params: [] },
  // identity: "points" (not enough reward points to claim this swag reward)
  'discord.swag_points': { params: [] },
  'deeds.invalid_input': { params: [] },

  // --- Steam link family codes (server/steam/). The whole surface is
  // env-gated: with STEAM_ENABLED unset every route answers steam.disabled.
  // Linking is cosmetic-mirror only; login with Steam does not exist. ---

  // The Steam surface is not enabled on this server (feature-off 503).
  'steam.disabled': { params: [] },
  // The session ticket failed shape or upstream verification (400).
  'steam.invalid_ticket': { params: [] },
  // The ticket verified but the Steam account is VAC- or publisher-banned (403).
  'steam.banned': { params: [] },
  // This account already has a linked Steam account (409).
  'steam.already_linked': { params: [] },
  // That Steam account is linked to a different account (409).
  'steam.account_taken': { params: [] },
  // The Steam Web API could not be reached or answered garbage (503).
  'steam.upstream': { params: [] },
} as const);

/** A stable error code: one of the keys of ERROR_CODES. */
export type ErrorCode = keyof typeof ERROR_CODES;
