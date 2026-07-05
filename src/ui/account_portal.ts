// Pure presentation/domain logic for the home-page account portal.
//
// Host-agnostic by design (no DOM, no t(), no network): it turns raw account
// state into a render model and answers the small validation questions the
// portal forms ask. The DOM consumer lives in main.ts; Vitest drives this
// module directly. Keep it free of side effects so it stays trivially testable.

export interface AccountPortalState {
  loggedIn: boolean;
  username: string;
  email: string;
  /** ISO timestamp of account creation, or '' when unknown. */
  createdAt: string;
  /** Account-wide character count (every realm). */
  characterCount: number;
}

export interface AccountPortalModel {
  /** When false the portal shows a "please log in" prompt instead of sections. */
  loggedIn: boolean;
  header: {
    username: string;
    /** Empty string when createdAt is unknown/unparseable. */
    memberSinceIso: string;
    /** Account-wide character count, surfaced in the Characters card. */
    characterCount: number;
  };
  /** Which portal sections are available, in display order. */
  sections: AccountPortalSection[];
  email: string;
}

export type AccountPortalSection = 'settings' | 'wallet' | 'characters' | 'companion' | 'logout';

const SECTION_ORDER: AccountPortalSection[] = [
  'settings',
  'wallet',
  'characters',
  'companion',
  'logout',
];

// Password length bounds — mirror the server's validPassword (6..128 chars) so
// the client gate matches what the server will accept byte-for-byte.
export const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSWORD_LENGTH = 128;

export function accountPortalModel(state: AccountPortalState): AccountPortalModel {
  return {
    loggedIn: state.loggedIn,
    header: {
      username: state.username,
      memberSinceIso: normalizeIso(state.createdAt),
      characterCount: state.characterCount,
    },
    sections: state.loggedIn ? [...SECTION_ORDER] : [],
    email: state.email,
  };
}

function normalizeIso(value: string): string {
  if (!value) return '';
  const t = Date.parse(value);
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}

export type PasswordError =
  | 'empty-current'
  | 'too-short'
  | 'too-long'
  | 'unchanged'
  | 'confirm-mismatch';

/**
 * Validate a password-change form. Returns null when the input is acceptable to
 * send to the server (the server re-verifies the current password and re-checks
 * length — this is only the optimistic client gate). The length bounds match the
 * server exactly so a too-long password is caught here with a clear message
 * rather than bouncing off the server's misleading "at least 6 chars".
 */
export function validateNewPassword(current: string, next: string): PasswordError | null {
  if (!current) return 'empty-current';
  if (next.length < MIN_PASSWORD_LENGTH) return 'too-short';
  if (next.length > MAX_PASSWORD_LENGTH) return 'too-long';
  if (next === current) return 'unchanged';
  return null;
}

export function validatePasswordChange(
  current: string,
  next: string,
  confirm: string,
): PasswordError | null {
  const baseError = validateNewPassword(current, next);
  if (baseError) return baseError;
  if (next !== confirm) return 'confirm-mismatch';
  return null;
}

/**
 * Lenient email shape check, matching the server's tolerance. Empty is valid
 * (it clears the stored address). Returns true when acceptable.
 */
export function validateEmailShape(email: string): boolean {
  const trimmed = email.trim();
  if (trimmed === '') return true;
  if (trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/**
 * The deactivate form is only armed once the player re-types BOTH their exact
 * username and a non-empty password — a deliberate friction gate on an
 * account-locking action.
 */
export function deactivateConfirmReady(
  expectedUsername: string,
  typedUsername: string,
  password: string,
): boolean {
  return typedUsername === expectedUsername && password.length > 0;
}

// ── Companion read-only tokens ──────────────────────────────────────────────
// A read-only token a player can paste into a companion app (an alternative to
// the OAuth flow). The portal section lets them name, create, and revoke tokens.

export const COMPANION_TOKEN_LABEL_MAX = 64;

/** A label is optional; when present it must be within the server's 64-char cap. */
export function validateCompanionTokenLabel(label: string): boolean {
  return label.trim().length <= COMPANION_TOKEN_LABEL_MAX;
}

export interface CompanionTokenSummary {
  prefix: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface CompanionTokenRowView {
  /** 8-char prefix (the revoke handle); never the full secret. */
  prefix: string;
  /** Display label, or a sensible fallback when unnamed. */
  label: string;
  createdAtIso: string;
  expiresAtIso: string;
}

/**
 * Render model for the companion-token list: normalizes timestamps and supplies
 * a fallback label so the DOM consumer stays dumb. The full token secret is
 * never part of this model — it is shown once, at creation, by the create call.
 */
export function companionTokenRows(tokens: CompanionTokenSummary[]): CompanionTokenRowView[] {
  return tokens.map((t) => ({
    prefix: t.prefix,
    label: t.label?.trim() ? t.label.trim() : 'Unnamed token',
    createdAtIso: normalizeIso(t.createdAt),
    expiresAtIso: normalizeIso(t.expiresAt),
  }));
}
