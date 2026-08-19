// Painted identities for affixes that can actually be rolled by a live Delve.
// Registered-but-inert affixes keep the tracker fallback until their simulation
// hooks and artwork land together.
export const DELVE_AFFIX_IMAGE_IDS: ReadonlySet<string> = new Set([
  'bad_air',
  'belligerent_dead',
  'candleblind',
  'high_water',
  'lively_choir',
  'restless_graves',
]);

const DELVE_AFFIX_ICON_DIR = '/ui/delve-affixes';

export function delveAffixImageUrl(id: string): string | null {
  return DELVE_AFFIX_IMAGE_IDS.has(id) ? `${DELVE_AFFIX_ICON_DIR}/${id}.webp` : null;
}
