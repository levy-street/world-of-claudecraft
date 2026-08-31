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
    password_already_set: 'This account already has a password. Use Change Password instead.',
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
    storage_purchase_open:
      'A storage purchase must finish or be resolved before this character can be deleted.',
    // the background-gate saturation refusal on the delete cascade (retryable)
    delete_busy: 'The realm is busy. Try deleting this character again in a moment.',
    // reuses errors.api.alreadyInWorld
    already_in_world: 'Character is already in world.',
    // reuses errors.api.takenOver
    taken_over: 'Your character was taken over by another session.',
    // reuses errors.api.renameBeforeEntering
    rename_required: 'This character must be renamed before entering the world.',
    // the redesign editor's malformed-look rejection
    invalid_appearance: 'That appearance could not be saved. Adjust the design and try again.',
    // the ordinary redesign failure: token already spent, or two racing tabs
    reroll_unavailable: 'This character does not have a free redesign available.',
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
  deeds: {
    invalid_input: 'Invalid input.',
  },
  // The public guild roster read behind the signpost guild board
  // (server/guild_roster.ts).
  guilds: {
    invalid_roster_name: 'Invalid guild name.',
    unknown: 'No guild by that name.',
  },
  // steam: the env-gated Steam link family (server/steam/). Linking mirrors
  // deed unlocks to Steam achievements; it is never a sign-in method.
  steam: {
    disabled: 'Steam linking is not available right now.',
    invalid_ticket: 'Steam could not verify this link request. Try again from the desktop app.',
    banned: 'That Steam account cannot be linked.',
    already_linked: 'Your account already has a linked Steam account.',
    account_taken: 'That Steam account is already linked to another account.',
    upstream: 'Steam did not respond. Try again in a moment.',
  },
  // epic: the env-gated Epic link family (server/epic/). Linking mirrors
  // deed unlocks to Epic achievements; it is never a sign-in method.
  epic: {
    disabled: 'Epic linking is not available right now.',
    invalid_token: 'Epic could not verify this link request. Try again from the desktop app.',
    banned: 'That Epic account cannot be linked.',
    already_linked: 'Your account already has a linked Epic account.',
    account_taken: 'That Epic account is already linked to another account.',
    upstream: 'Epic did not respond. Try again in a moment.',
  },
  wallet: {
    handoff_invalid: 'That wallet authorization expired or could not be verified. Try again.',
    // The R11 relink gate (server/wallet_reauth.ts): changing or removing a
    // linked wallet needs the account password (or the current wallet's
    // signature); reauth_required is the marker the wallet prompt keys on.
    reauth_required: 'Confirm this wallet change with your account password.',
    reauth_two_factor: 'Your account has two-factor enabled. Enter your code to confirm.',
    reauth_no_password: 'Set a password in account settings first, then try again.',
    reauth_bad_signature: 'That wallet signature could not be verified. Try again.',
    // reuses apiError.auth.password_incorrect
    reauth_bad_password: 'Your password is incorrect.',
    // reuses apiError.two_factor.code_invalid
    reauth_bad_two_factor: 'That code is not valid, try again.',
  },
  ota_updates: {
    invalid_input: 'Invalid input.',
  },
  seeker: {
    native_only: 'Seeker entitlement is available only in the native app.',
    attestation_failed: 'Device verification failed. Please try again.',
    solana_artifact_required: 'Use the Solana Store app to continue.',
    wallet_required: 'Link and verify a wallet first.',
    genesis_token_required: 'A verified Seeker Genesis Token is required.',
    genesis_token_claimed: 'That Seeker Genesis Token has already been claimed.',
    entitlement_required: 'Verified Seeker entitlement is required.',
    current_ownership_required: 'Current Seeker Genesis Token ownership is required.',
  },
  // cheater_mark: the operator-applied public Cheater tag (server/cheater_mark_api.ts).
  // Operator-facing copy: only the admin dashboard ever receives these codes.
  cheater_mark: {
    admin_target: 'Operator accounts cannot be marked.',
    reason_required: 'A reason is required.',
    invalid_duration: 'Enter a mark duration of at least one second.',
    not_marked: 'That account is not marked.',
  },
  // woc_market: the config-gated $WOC Exchange family
  // (server/woc_market_routes.ts). USD-denominated auctions settled in $WOC;
  // every code here is a player-actionable refusal.
  woc_market: {
    invalid_input: 'Invalid input.',
    disabled: 'The $WOC Exchange is not available on this realm.',
    paused: 'Exchange trading is paused. Auctions keep counting down.',
    wallet_required: 'Link and verify a wallet before trading on the Exchange.',
    recipient_wallet_required:
      'That player must connect a wallet before they can accept $WOC payments.',
    self_offer: 'You cannot send a $WOC offer to yourself.',
    offer_expired: 'That $WOC offer expired. Ask for a new one.',
    terms_required: 'Accept the Marketplace terms to continue.',
    // RETIRED, never rendered (B6/R1): no server path raises either totp
    // code; the rows stay because the catalog leaf set must equal the
    // append-only ERROR_CODES (tests/api_error_code_parity.test.ts).
    totp_required:
      'This amount requires two-factor authentication. Enable it in account settings, then enter your code.',
    totp_invalid: 'That two-factor code did not verify. Try again.',
    suspended:
      'Your Exchange access is suspended after unpaid deals: no bids, purchases, listings, or $WOC trades.',
    character_invalid: 'Play the character you are listing from, and try again.',
    not_found: 'That Exchange entry no longer exists.',
    not_yours: 'That Exchange entry no longer exists.',
    not_active: 'That listing is no longer open for this action.',
    own_listing: 'You cannot bid on or buy your own listing.',
    has_bids: 'A listing with bids cannot be withdrawn. Contact support if you must cancel.',
    bid_too_low: 'Your bid does not clear the current bid plus its increment.',
    already_pending: 'Confirm or abandon your pending bid on this listing first.',
    insufficient_balance: 'Your wallet does not hold enough $WOC for this bid and its bond.',
    quote_unavailable: 'A price quote could not be issued right now. Try again shortly.',
    // Also answers the lapse-straddle refresh (a bond seat that closed while
    // the quote aged), where no fresh quote will come: the second sentence
    // must not promise one.
    quote_expired:
      'That quote expired. Request a fresh one; if none is offered, that window has closed.',
    not_pending: 'That bid is no longer awaiting its bond.',
    confirm_failed: 'The transaction could not be confirmed. Request a fresh quote and try again.',
    confirm_in_flight: 'Your payment is still confirming. Try again once it resolves.',
    buy_now_locked: 'Another buyer is completing this purchase. Try again in a moment.',
    cancel_pending: 'The seller is cancelling this listing.',
    claim_cooldown: 'You recently walked away from a Buy Now. Try again later.',
    bond_window_closed:
      'This bid can no longer be paid: its payment window has closed. Bid again for a fresh one.',
    settlement_in_flight: 'A buyer is paying for this listing. Try again once the payment settles.',
    contended: 'The Exchange is busy with this listing. Try again in a moment.',
    sale_conflict: 'Another live sale record stands for this listing. Exclude it first.',
    no_buy_now: 'This listing has no buy-now price.',
    cap_reached: 'You have reached your Exchange listing limit.',
    stale_item: 'That item changed or moved. Re-select it and try again.',
    item_mismatch:
      'That is not the exact copy the buyer agreed to, or its state changed (a lock counts). Start a fresh deal for it.',
    offer_pending: 'You already have a deal standing with this player. Resolve it first.',
    not_eligible: 'That item cannot be listed on the $WOC Exchange.',
    invalid_params: 'Check the starting bid, reserve, buy-now price, and duration.',
    signature_reused: 'That transaction was already submitted.',
    item_locked: 'That item is locked. Unlock it in your bags before selling it.',
    stepup_required: 'Selling on the Exchange needs a signature from your linked wallet.',
    stepup_challenge_invalid: 'That wallet confirmation is no longer valid. Start the sale again.',
    stepup_challenge_expired: 'The wallet confirmation expired. Start the sale again.',
    stepup_wallet_mismatch:
      'Your linked wallet changed since this confirmation was issued. Start the sale again.',
    stepup_binding_mismatch:
      'That wallet confirmation does not match this sale. Start the sale again.',
    stepup_signature_invalid: 'The wallet signature did not verify. Start the sale again.',
  },
};
