// Pure, host-agnostic helpers for the home-page two-factor (TOTP) enrolment
// flow. Kept out of main.ts so the formatting + validation logic is unit-tested
// directly (tests/two_factor_setup.test.ts) and the DOM wiring stays a thin
// consumer (the reference pattern in src/ui/unit_portrait.ts).

// The enrolment wizard moves through these visible stages. The DOM layer shows
// exactly one at a time; this type is the single source of truth for which.
export type TwoFactorStage = 'idle' | 'begin' | 'setup' | 'recovery' | 'enabled';

// Authenticator apps display the secret grouped in fours for legibility. We keep
// the raw (ungrouped) secret for the otpauth URI and only group for display.
export function formatSecretGroups(secret: string, groupSize = 4): string {
  const clean = secret.replace(/\s+/g, '').toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < clean.length; i += groupSize) groups.push(clean.slice(i, i + groupSize));
  return groups.join(' ');
}

// Normalize a code typed into the login or enable field. A 6-digit TOTP is kept
// as bare digits (capped at 6); anything else (a recovery code, which contains a
// dash/letters) is lightly cleaned but preserved so the caller can route it.
export function normalizeAuthCodeInput(raw: string): string {
  const trimmed = raw.trim();
  if (/^[0-9\s]+$/.test(trimmed)) return trimmed.replace(/\D/g, '').slice(0, 6);
  return trimmed;
}

// A complete, submittable TOTP code is exactly 6 digits.
export function isCompleteTotpCode(code: string): boolean {
  return /^[0-9]{6}$/.test(code.replace(/\s/g, ''));
}

// Classify a login/disable second factor so the client sends it on the right
// field: a 6-digit string is a live TOTP code, anything else is a recovery code.
export function classifyAuthCode(raw: string): { code: string; recoveryCode: string } {
  const trimmed = raw.trim();
  if (isCompleteTotpCode(trimmed)) return { code: trimmed.replace(/\s/g, ''), recoveryCode: '' };
  return { code: '', recoveryCode: trimmed };
}

// Plain-text blob for the "Download Codes" button so a user can save recovery
// codes to a file. No DOM/Blob here: the caller wraps this in a download.
export function formatRecoveryCodesFile(codes: string[], username: string, brand = 'World of ClaudeCraft'): string {
  return [
    `${brand} recovery codes`,
    `Account: ${username}`,
    '',
    'Each code can be used once if you lose access to your authenticator app.',
    'Keep this file somewhere safe and private.',
    '',
    ...codes.map((c, i) => `${String(i + 1).padStart(2, '0')}. ${c}`),
    '',
  ].join('\n');
}
