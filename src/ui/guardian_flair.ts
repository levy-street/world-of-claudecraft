// Liquidity Guardian flair: the staking-gated cosmetic ladder's presentation
// (names, titles, colours, glyphs, badge art), the client sibling of
// src/ui/holder_tier.ts over the shared pure src/sim/guardian_tier.ts.
//
// Purely cosmetic honor flair for LP stakers: NO gameplay power, ever. The
// badge is deliberately a SHIELD (the guardian device) where the holder badge
// is a disc, so the two ladders read apart at a glance on a nameplate.
// Like holder_tier.ts this module is free of DOM, Three.js, and network
// imports: plain data + lookups, Node-tested, reused by the card and the
// nameplate painter.
import {
  GUARDIAN_TIER_DEFS,
  type GuardianTierCore,
  type GuardianTierKey,
  guardianTierByIndex as sharedGuardianTierByIndex,
} from '../sim/guardian_tier';
import { type TranslationKey, t } from './i18n';

export interface GuardianTier extends Omit<GuardianTierCore, 'key'> {
  /** 1-based rung (1 = Wader ... 5 = Abyssguard). */
  index: number;
  /** Stable machine key (CSS hooks / analytics). */
  key: GuardianTierKey;
  /** Primary accent colour (hex). */
  ring: string;
  /** Outer glow colour (hex); also the nameplate aura colour. */
  glow: string;
  /** Inner SVG markup for the rung's glyph, centred in a 0 0 64 64 box. */
  glyph: string;
}

const GLYPH_FILL = '#eafcff';

// One wave arc per rung up to three, then the storm bolt and the abyss
// trident: the rung reads from the device without text.
function waves(count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) {
    const y = 30 + i * 8;
    out += `<path d="M18 ${y}q4.5-6 9-0t9 0t9 0" fill="none" stroke="${GLYPH_FILL}" stroke-width="3" stroke-linecap="round"/>`;
  }
  return out;
}

type GuardianTierPresentation = Omit<GuardianTier, keyof GuardianTierCore>;

const GUARDIAN_TIER_PRESENTATION: Record<GuardianTierKey, GuardianTierPresentation> = {
  wader: {
    ring: '#3fa7b8',
    glow: '#1b5e6b',
    glyph: waves(1),
  },
  tidewatcher: {
    ring: '#2fc0c9',
    glow: '#146a75',
    glyph: waves(2),
  },
  currentkeeper: {
    ring: '#27d3b4',
    glow: '#0e7a68',
    glyph: waves(3),
  },
  stormwarden: {
    ring: '#4f9ff0',
    glow: '#1d4d9c',
    glyph: waves(2) + `<path d="M35 18l-8 13h6l-4 13 11-16h-6l5-10z" fill="${GLYPH_FILL}"/>`,
  },
  abyssguard: {
    ring: '#8f6ff0',
    glow: '#3d1d8c',
    glyph:
      `<path d="M32 14v30M32 44l-4 6h8z" stroke="${GLYPH_FILL}" stroke-width="3" fill="${GLYPH_FILL}" stroke-linecap="round"/>` +
      `<path d="M24 18v8q0 6 8 6t8-6v-8" fill="none" stroke="${GLYPH_FILL}" stroke-width="3" stroke-linecap="round"/>`,
  },
};

/** All five rungs with presentation merged onto the shared core. */
export const GUARDIAN_TIERS: readonly GuardianTier[] = GUARDIAN_TIER_DEFS.map((core) => ({
  ...core,
  ...GUARDIAN_TIER_PRESENTATION[core.key],
}));

const GUARDIAN_TIER_TEXT_KEYS = {
  wader: { name: 'wallet.guardianTiers.wader.name', title: 'wallet.guardianTiers.wader.title' },
  tidewatcher: {
    name: 'wallet.guardianTiers.tidewatcher.name',
    title: 'wallet.guardianTiers.tidewatcher.title',
  },
  currentkeeper: {
    name: 'wallet.guardianTiers.currentkeeper.name',
    title: 'wallet.guardianTiers.currentkeeper.title',
  },
  stormwarden: {
    name: 'wallet.guardianTiers.stormwarden.name',
    title: 'wallet.guardianTiers.stormwarden.title',
  },
  abyssguard: {
    name: 'wallet.guardianTiers.abyssguard.name',
    title: 'wallet.guardianTiers.abyssguard.title',
  },
} satisfies Record<GuardianTierKey, { name: TranslationKey; title: TranslationKey }>;

/** The rung's display name (localized). */
export function guardianTierDisplayName(tier: GuardianTier): string {
  return t(GUARDIAN_TIER_TEXT_KEYS[tier.key].name);
}

/** The rung's cosmetic TITLE line (localized), e.g. for the player card. */
export function guardianTierTitle(tier: GuardianTier): string {
  return t(GUARDIAN_TIER_TEXT_KEYS[tier.key].title);
}

/** The rung at a 1-based index (1-5), or undefined for 0/out-of-range. */
export function guardianTierByIndex(index: number): GuardianTier | undefined {
  const shared = sharedGuardianTierByIndex(index);
  return shared ? GUARDIAN_TIERS[shared.index - 1] : undefined;
}

/**
 * A standalone SVG data URL for the rung's badge: a glowing SHIELD filled with
 * a ring-to-glow radial, the glyph centred on top. Suitable for an <img> src
 * or canvas drawing; the viewBox is always 0 0 64 64.
 */
export function guardianTierBadgeDataUrl(tier: GuardianTier, px = 128): string {
  const shield = 'M32 4l24 8v20q0 18-24 28Q8 50 8 32V12z';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 64 64">` +
    `<defs>` +
    `<radialGradient id="g" cx="38%" cy="30%" r="75%">` +
    `<stop offset="0%" stop-color="${tier.ring}"/>` +
    `<stop offset="100%" stop-color="${tier.glow}"/>` +
    `</radialGradient>` +
    `</defs>` +
    `<path d="${shield}" fill="url(#g)"/>` +
    `<path d="${shield}" fill="none" stroke="#101c1e" stroke-width="2"/>` +
    `<path d="M32 8l20 6.7V32q0 15-20 23.6Q12 47 12 32V14.7z" fill="none" stroke="#eafcff" stroke-opacity="0.3" stroke-width="1.5"/>` +
    tier.glyph +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** The nameplate aura (a soft drop-shadow stack in the rung's glow colour). */
export function guardianAuraFilter(tier: GuardianTier): string {
  return `drop-shadow(0 0 3px ${tier.ring}) drop-shadow(0 0 6px ${tier.glow})`;
}
