import type { AugmentCategory } from '../../../sim/content/augments';

export const FIESTA_AUGMENT_IMAGE_IDS: ReadonlySet<string> = new Set([
  'aug_brutality',
  'aug_spellfire',
  'aug_toughness',
  'aug_keen_eye',
  'aug_fleetfoot',
  'aug_ironhide',
  'aug_mending',
  'aug_warlords_might',
  'aug_arcane_surge',
  'aug_vampirism',
  'aug_juggernaut',
  'aug_bloodhunter',
  'aug_lightwell',
  'aug_bounty_hunter',
  'aug_apex_predator',
  'aug_archmage',
  'aug_unkillable',
  'aug_overdrive',
  'aug_avatar',
  'aug_ascendant',
]);

export const FIESTA_POWERUP_IMAGE_IDS: ReadonlySet<string> = new Set([
  'pow_speed_demon',
  'pow_colossus',
  'pow_moon_boots',
  'pow_berserker',
]);

export function fiestaAugmentImageUrl(id: string): string | null {
  return FIESTA_AUGMENT_IMAGE_IDS.has(id) ? `/ui/fiesta/augments/${id}.webp` : null;
}

export function fiestaPowerupImageUrl(id: string): string | null {
  return FIESTA_POWERUP_IMAGE_IDS.has(id) ? `/ui/fiesta/powerups/${id}.webp` : null;
}

const FIESTA_AUGMENT_FALLBACK_PATHS: Readonly<Record<AugmentCategory, string>> = {
  offense: '<path d="M3 21l6-6m0 0l9-9 2 2-9 9m-2-2l-2 2 2 2 2-2m-2-2l2 2"/>',
  defense: '<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/>',
  sustain:
    '<path d="M12 21s-7-4.6-9.2-9C1.3 8.7 3 5 6.5 5c2 0 3.5 1.5 5.5 4 2-2.5 3.5-4 5.5-4C21 5 22.7 8.7 21.2 12 19 16.4 12 21 12 21z"/>',
  mobility: '<path d="M5 18l6-6-6-6m7 12l6-6-6-6"/>',
  utility:
    '<path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.8 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/>',
};

/**
 * Small category identity used only while exact Fiesta art is unavailable or
 * fails to decode. The painted WebP remains the primary surface.
 */
export function fiestaAugmentFallbackSvg(category: AugmentCategory): string {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' +
    `${FIESTA_AUGMENT_FALLBACK_PATHS[category]}</svg>`
  );
}
