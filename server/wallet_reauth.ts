// Re-authorization for wallet-link CHANGES (the R11 pre-enable gate): once an
// account has a linked wallet, marketplace sale proceeds pay to it, so
// changing or removing the link is a custody-adjacent action. A stolen bearer
// session alone must not be able to move it: the caller has to prove either
// the CURRENT wallet (sign the same challenge message with it) or the account
// itself (password, plus the second factor when one is enrolled). The route
// layer offers the signature arm on RELINK only (a link challenge cannot be
// action-scoped to a removal, so unlink is password-only). First-time
// linking stays signature-only: there is no prior wallet to protect, and the
// wallet-changed email is the compensating alert for that path.
//
// The decision lives here as a pure core (typed fakes in the tests); the
// wallet route layer supplies the verifiers.

import type { ErrorCode } from './http/error_codes';

export interface WalletReauthBody {
  /** The CURRENT wallet's signature over the same challenge message the
   *  incoming wallet signed. Relink only: the unlink route never forwards
   *  this field (a link challenge cannot be action-scoped to a removal). */
  currentSignature?: unknown;
  password?: unknown;
  totp?: unknown;
  recoveryCode?: unknown;
}

export interface WalletReauthDeps {
  /** Verify a base58 signature by the CURRENT wallet over `message`. */
  verifyCurrentSignature(message: string, signature: string): boolean;
  /** Verify the account password. False when the account has no password. */
  verifyPassword(password: string): Promise<boolean>;
  /** True when the account has a TOTP secret enrolled. */
  hasTwoFactor(): boolean;
  /** Verify and CLAIM the second factor (replay-safe); false on mismatch. */
  verifyTwoFactor(code: string, recoveryCode: string): Promise<boolean>;
  /** True when the account has a password set at all (passwordless Apple or
   *  Discord accounts have not, until Set a Password). */
  hasPassword(): boolean;
}

/** Stable machine codes for the refusal arms, mirrored in the client matcher
 *  (API_ERROR_KEYS in src/ui/api_error_i18n.ts): the wallet UI keys on the
 *  code, never the prose. Extract<> ties every member to the server catalog
 *  (server/http/error_codes.ts) so a typo is a compile error, the
 *  woc_market_routes REFUSAL_ERRORS pattern. auth.too_many_failed_attempts is
 *  the shared login-lockout identity the throttled arm answers with. */
export type WalletReauthErrorCode = Extract<
  ErrorCode,
  | 'wallet.reauth_required'
  | 'wallet.reauth_two_factor'
  | 'wallet.reauth_no_password'
  | 'wallet.reauth_bad_signature'
  | 'wallet.reauth_bad_password'
  | 'wallet.reauth_bad_two_factor'
  | 'auth.too_many_failed_attempts'
>;

export type WalletReauthOutcome =
  | { ok: true; via: 'current_wallet' | 'password' }
  | { ok: false; status: number; error: string; code: WalletReauthErrorCode };

/** The English prose is the dev-channel fallback; localization rides the code. */
export const WALLET_REAUTH_REQUIRED_ERROR =
  'confirm this wallet change: sign with the currently linked wallet, or send your password';
export const WALLET_REAUTH_TWO_FACTOR_ERROR =
  'confirm this wallet change: your account has two-factor enabled, send the code too';
export const WALLET_REAUTH_NO_PASSWORD_ERROR =
  'this account has no password: set one in account settings first';

export async function authorizeWalletChange(
  body: WalletReauthBody,
  message: string,
  deps: WalletReauthDeps,
): Promise<WalletReauthOutcome> {
  const currentSignature =
    typeof body.currentSignature === 'string' ? body.currentSignature.trim() : '';
  if (currentSignature) {
    // Defense in depth: an empty challenge message means no server-issued
    // challenge backs this request, so there is nothing sound to verify a
    // signature against (an empty-message signature would be unbound,
    // domain-separation-free, and replayable forever). Fail closed; never
    // fall through to the password arm on a presented-but-unusable proof.
    if (!message || !deps.verifyCurrentSignature(message, currentSignature)) {
      return {
        ok: false,
        status: 401,
        error: 'current wallet signature verification failed',
        code: 'wallet.reauth_bad_signature',
      };
    }
    return { ok: true, via: 'current_wallet' };
  }

  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) {
    return {
      ok: false,
      status: 401,
      error: WALLET_REAUTH_REQUIRED_ERROR,
      code: 'wallet.reauth_required',
    };
  }
  if (!deps.hasPassword()) {
    // Password sent but none exists: the honest answer names the recovery
    // path (Set a Password ships self-service) instead of a bare mismatch.
    return {
      ok: false,
      status: 403,
      error: WALLET_REAUTH_NO_PASSWORD_ERROR,
      code: 'wallet.reauth_no_password',
    };
  }
  if (!(await deps.verifyPassword(password))) {
    return {
      ok: false,
      status: 401,
      error: 'password verification failed',
      code: 'wallet.reauth_bad_password',
    };
  }
  if (deps.hasTwoFactor()) {
    const totp = typeof body.totp === 'string' ? body.totp.trim() : '';
    const recoveryCode = typeof body.recoveryCode === 'string' ? body.recoveryCode.trim() : '';
    if (!totp && !recoveryCode) {
      return {
        ok: false,
        status: 401,
        error: WALLET_REAUTH_TWO_FACTOR_ERROR,
        code: 'wallet.reauth_two_factor',
      };
    }
    if (!(await deps.verifyTwoFactor(totp, recoveryCode))) {
      return {
        ok: false,
        status: 401,
        error: 'two-factor verification failed',
        code: 'wallet.reauth_bad_two_factor',
      };
    }
  }
  return { ok: true, via: 'password' };
}
