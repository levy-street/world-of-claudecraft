// Referral attribution is signup input, never login authority. Keep only the
// bounded slug across an OAuth redirect in this tab; no identity or token lives here.
export const REFERRAL_SIGNUP_KEY = 'woc_referral_signup';
export const REFERRAL_SIGNUP_TTL_MS = 15 * 60 * 1000;
type ReferralStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const validSlug = (value: unknown): string => {
  const slug = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug) ? slug : '';
};

export function captureReferralSlug(
  search: string,
  storage: () => ReferralStorage = () => sessionStorage,
  now = Date.now(),
): string {
  const param = new URLSearchParams(search).get('ref');
  const slug = validSlug(param);
  try {
    const tab = storage();
    if (param !== null) {
      if (slug) tab.setItem(REFERRAL_SIGNUP_KEY, JSON.stringify({ slug, capturedAt: now }));
      else tab.removeItem(REFERRAL_SIGNUP_KEY);
      return slug;
    }
    const saved = JSON.parse(tab.getItem(REFERRAL_SIGNUP_KEY) ?? 'null');
    if (
      saved &&
      validSlug(saved.slug) &&
      Number.isFinite(saved.capturedAt) &&
      now >= saved.capturedAt &&
      now - saved.capturedAt < REFERRAL_SIGNUP_TTL_MS
    )
      return validSlug(saved.slug);
    tab.removeItem(REFERRAL_SIGNUP_KEY);
  } catch {
    // Restricted storage does not prevent direct referral signup.
  }
  return slug;
}
