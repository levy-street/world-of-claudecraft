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
  // identity: "this account already has a password, use change password instead"
  'account.password_already_set': { params: [] },

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
  // identity: an open paid storage purchase must settle before character deletion
  'character.storage_purchase_open': { params: [] },
  // identity: the realm background gate refused the delete; retry in a moment
  'character.delete_busy': { params: [] },
  // identity: "character already in world"
  'character.already_in_world': { params: [] },
  // identity: "character taken over"
  'character.taken_over': { params: [] },
  // identity: "this character must be renamed before entering the world."
  'character.rename_required': { params: [] },
  // identity: "invalid appearance"
  'character.invalid_appearance': { params: [] },
  // identity: "appearance reroll is not available for this character"
  'character.reroll_unavailable': { params: [] },

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
  // The public guild roster read (server/guild_roster.ts).
  'guilds.invalid_roster_name': { params: [] },
  'guilds.unknown': { params: [] },

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

  // --- Epic link family codes (server/epic/). The whole surface is
  // env-gated: with EPIC_ENABLED unset every route answers epic.disabled.
  // Linking is cosmetic-mirror only; login with Epic does not exist. ---

  // The Epic surface is not enabled on this server (feature-off 503).
  'epic.disabled': { params: [] },
  // The link proof failed shape or upstream verification (400).
  'epic.invalid_token': { params: [] },
  // The proof verified but the Epic account is blocked upstream (403).
  'epic.banned': { params: [] },
  // This account already has a linked Epic account (409).
  'epic.already_linked': { params: [] },
  // That Epic account is linked to a different account (409).
  'epic.account_taken': { params: [] },
  // The Epic / EOS upstream could not be reached or is not provisioned (503).
  'epic.upstream': { params: [] },
  // wallet: the desktop browser handoff was malformed, expired, or mismatched.
  'wallet.handoff_invalid': { params: [] },
  // wallet: changing or removing a LINKED wallet needs re-authorization
  // (server/wallet_reauth.ts, the R11 relink gate): the current wallet's
  // signature over the challenge message, or the account password plus the
  // second factor when one is enrolled.
  'wallet.reauth_required': { params: [] },
  'wallet.reauth_two_factor': { params: [] },
  'wallet.reauth_no_password': { params: [] },
  'wallet.reauth_bad_signature': { params: [] },
  'wallet.reauth_bad_password': { params: [] },
  'wallet.reauth_bad_two_factor': { params: [] },
  'ota_updates.invalid_input': { params: [] },
  // seeker: native distribution, attestation, wallet, token, and entitlement failures.
  'seeker.native_only': { params: [] },
  'seeker.attestation_failed': { params: [] },
  'seeker.solana_artifact_required': { params: [] },
  'seeker.wallet_required': { params: [] },
  'seeker.genesis_token_required': { params: [] },
  'seeker.genesis_token_claimed': { params: [] },
  'seeker.entitlement_required': { params: [] },
  'seeker.current_ownership_required': { params: [] },

  // --- cheater_mark: the operator-applied public Cheater tag (src/sim/moderation/,
  // server/cheater_mark_api.ts). The tag is cosmetic-only, so every code here is
  // about WHO may be branded and for HOW LONG, never a gameplay effect. ---

  // The target account is an operator, and an operator cannot be branded (400).
  'cheater_mark.admin_target': { params: [] },
  // The audited reason was absent or blank on either arm (400).
  'cheater_mark.reason_required': { params: [] },
  // The played-second budget did not normalize to a positive number (400).
  'cheater_mark.invalid_duration': { params: [] },
  // A lift was asked for on an account that is not wearing the tag (409).
  'cheater_mark.not_marked': { params: [] },

  // --- $WOC Exchange family codes (server/woc_market_routes.ts). The whole
  // surface is config-gated: with WOC_MARKET_ENABLED unset every mutating
  // route answers woc_market.disabled. ---

  // Request failed schema validation (400).
  'woc_market.invalid_input': { params: [] },
  // The marketplace is not enabled on this server (feature-off 403).
  'woc_market.disabled': { params: [] },
  // The economy service or its price oracle is down; purchases and
  // settlements are suspended while auctions keep counting down (503).
  'woc_market.paused': { params: [] },
  // A verified wallet link is required for this action (403).
  'woc_market.wallet_required': { params: [] },
  // A directed p2p offer's named recipient has no verified wallet, so they
  // could not accept a $WOC payment (403).
  'woc_market.recipient_wallet_required': { params: [] },
  // A directed p2p offer addressed to the sender's own account (400).
  'woc_market.self_offer': { params: [] },
  // The directed p2p offer's acceptance window elapsed (410).
  'woc_market.offer_expired': { params: [] },
  // The variable-token settlement terms must be accepted first (403).
  'woc_market.terms_required': { params: [] },
  // RETIRED, never enforced (B6/R1): no server path has ever raised either
  // totp code, and none ever will; the wallet step-up
  // (woc_market.stepup_* below, server/woc_market_stepup.ts) is the real
  // second factor on the custody movers. Both rows stay per the append-only
  // contract above; their catalog entries stay with them (the parity test's
  // set-equality dimension).
  'woc_market.totp_required': { params: [] },
  'woc_market.totp_invalid': { params: [] },
  // The account is under a marketplace suspension from settlement defaults (403).
  'woc_market.suspended': { params: [] },
  // The character does not exist on this realm under this account, or the
  // seller is not online to escrow the copy (400).
  'woc_market.character_invalid': { params: [] },
  // No such listing, bid, settlement, or sale (404).
  'woc_market.not_found': { params: [] },
  // The resource belongs to a different account (404, anti-enumeration).
  'woc_market.not_yours': { params: [] },
  // The listing or settlement is no longer open for this action (409).
  'woc_market.not_active': { params: [] },
  // Sellers cannot bid on or buy their own listings (403).
  'woc_market.own_listing': { params: [] },
  // A listing with a standing or pending bid cannot be cancelled (409).
  'woc_market.has_bids': { params: [] },
  // The bid does not clear the standing bid plus its increment (400).
  'woc_market.bid_too_low': { params: [] },
  // One unconfirmed bid per listing per account at a time (409).
  'woc_market.already_pending': { params: [] },
  // The wallet's $WOC balance does not cover the bid plus its bond (400).
  'woc_market.insufficient_balance': { params: [] },
  // The economy service could not issue a quote right now (503).
  'woc_market.quote_unavailable': { params: [] },
  // The quote or settlement window has expired; request a fresh one (409).
  'woc_market.quote_expired': { params: [] },
  // The bid is no longer awaiting its bond (409).
  'woc_market.not_pending': { params: [] },
  // The chain transaction was refused or did not match the quote (409).
  'woc_market.confirm_failed': { params: [] },
  // A submitted signature is still awaiting the chain's verdict: quote
  // refreshes and abandons wait for it rather than orphan money in flight (409).
  'woc_market.confirm_in_flight': { params: [] },
  // Another buyer holds the short buy-now lock on this listing (409).
  'woc_market.buy_now_locked': { params: [] },
  // The seller stamped cancel-intent: the listing takes no new lock claims or
  // bids and closes once the current window resolves (409).
  'woc_market.cancel_pending': { params: [] },
  // The claimer recently abandoned a buy-now window (per-listing re-claim
  // cooldown, or the account-wide abandons-per-hour cap) (409).
  'woc_market.claim_cooldown': { params: ['retryAfterSeconds'] },
  // This bid's payment window is closing: a fresh quote would outlive the
  // bid's own lapse deadline, inviting a payment nothing could record (409).
  'woc_market.bond_window_closed': { params: [] },
  // A buyer's payment for this listing is past the point of no return;
  // cancel/suspend must wait for it to resolve (409).
  'woc_market.settlement_in_flight': { params: [] },
  // The listing row is briefly held by another market transaction; plain
  // contention, retry immediately (409).
  'woc_market.contended': { params: [] },
  // An admin sale correction is blocked by a standing non-excluded sale row
  // for the same listing (409).
  'woc_market.sale_conflict': { params: [] },
  // The listing has no buy-now price (400).
  'woc_market.no_buy_now': { params: [] },
  // The per-account active-listing cap is reached (409).
  'woc_market.cap_reached': { params: [] },
  // The referenced inventory copy changed or moved; re-select it (409).
  'woc_market.stale_item': { params: [] },
  // One live directed deal per (buyer, seller) pair; resolve the standing
  // one first (the strike-farming bound) (409).
  'woc_market.offer_pending': { params: [] },
  // A directed acceptance offered a copy whose fingerprint does not match
  // the one the buyer agreed to at offer time (bait-and-switch guard) (409).
  'woc_market.item_mismatch': { params: [] },
  // The item is not eligible for the $WOC Exchange under this server's
  // policy (soulbound, bound, quest, below the quality floor, excluded) (400).
  'woc_market.not_eligible': { params: [] },
  // Listing parameters out of range (start/reserve/buy-now/duration) (400).
  'woc_market.invalid_params': { params: [] },
  // That transaction signature was already submitted (409).
  'woc_market.signature_reused': { params: [] },
  // The copy is under the owner's own item lock (issue 3042); unlocking it in
  // the bags is the fix, so it gets its own code, not a not_eligible collapse
  // (400).
  'woc_market.item_locked': { params: [] },
  // Wallet step-up on the custody movers (B6/R1): listing and directed
  // acceptance require a fresh challenge signed by the linked wallet.
  // Moving custody without one (403).
  'woc_market.stepup_required': { params: [] },
  // The challenge is unknown, already used, or not this account's (403).
  'woc_market.stepup_challenge_invalid': { params: [] },
  // The challenge lapsed before it was used; request a fresh one (410).
  'woc_market.stepup_challenge_expired': { params: [] },
  // The linked wallet changed since the challenge was issued (403).
  'woc_market.stepup_wallet_mismatch': { params: [] },
  // The challenge authorizes a different action, item, or price (403).
  'woc_market.stepup_binding_mismatch': { params: [] },
  // The wallet signature did not verify against the challenge (403).
  'woc_market.stepup_signature_invalid': { params: [] },
} as const);

/** A stable error code: one of the keys of ERROR_CODES. */
export type ErrorCode = keyof typeof ERROR_CODES;
