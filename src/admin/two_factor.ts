// Pure helper for the admin login second-factor field. A local copy of the
// classification rule the game client uses (src/ui/two_factor_setup.ts
// classifyAuthCode): src/admin/ never imports from src/ui (see src/admin/CLAUDE.md),
// so the tiny rule is kept here instead of shared.
//
// A complete 6-digit string is a live TOTP code; anything else typed into the
// same field (a recovery code, which contains dashes/letters) is routed as
// recoveryCode instead.
export function classifyAdminAuthCode(raw: string): { code: string; recoveryCode: string } {
  const trimmed = raw.trim();
  const digitsOnly = trimmed.replace(/\s/g, '');
  if (/^[0-9]{6}$/.test(digitsOnly)) return { code: digitsOnly, recoveryCode: '' };
  return { code: '', recoveryCode: trimmed };
}
