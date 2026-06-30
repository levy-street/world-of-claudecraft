// Presentation layer for the Discord status-tier ladder.
//
// Mirrors src/ui/holder_tier.ts: the pure thresholds live in
// src/sim/discord_tier.ts; this module adds the localized display name and the
// accent/badge art the HUD renders. It is DOM-free apart from building an SVG
// data URL string, so it stays unit-testable. All display names resolve through
// t() against the English-only hudChrome.discord.tiers.* keys.
import {
  DISCORD_STATUS_DEFS,
  type DiscordStatusKey,
  discordStatusByIndex as sharedStatusByIndex,
  discordStatusForPoints as sharedStatusForPoints,
} from '../sim/discord_tier';
import { type TranslationKey, t } from './i18n';

export interface DiscordStatusTier {
  index: number;
  key: DiscordStatusKey;
  threshold: number;
  /** Primary ring/accent colour (hex). */
  ring: string;
  /** Outer glow colour (hex). */
  glow: string;
}

// Discord "blurple" climbing into gold for the top rungs, so higher status reads
// as more prestigious at a glance. Cosmetic only (no gameplay power).
const DISCORD_STATUS_ACCENTS: Record<DiscordStatusKey, { ring: string; glow: string }> = {
  initiate: { ring: '#7289da', glow: '#4e5d94' },
  squire: { ring: '#5865f2', glow: '#3b45c4' },
  footman: { ring: '#57a0e0', glow: '#2f6fb0' },
  knight: { ring: '#49c5b1', glow: '#1f9582' },
  champion: { ring: '#5bd86a', glow: '#2ea33c' },
  warlord: { ring: '#e0913f', glow: '#b66a1c' },
  legend: { ring: '#f0c247', glow: '#c8941a' },
  mythic: { ring: '#ff6fb5', glow: '#e0348a' },
};

export const DISCORD_STATUS_TIERS: readonly DiscordStatusTier[] = DISCORD_STATUS_DEFS.map(
  (tier) => ({
    ...tier,
    ...DISCORD_STATUS_ACCENTS[tier.key],
  }),
);

const DISCORD_STATUS_TEXT_KEYS = {
  initiate: 'hudChrome.discord.tiers.initiate',
  squire: 'hudChrome.discord.tiers.squire',
  footman: 'hudChrome.discord.tiers.footman',
  knight: 'hudChrome.discord.tiers.knight',
  champion: 'hudChrome.discord.tiers.champion',
  warlord: 'hudChrome.discord.tiers.warlord',
  legend: 'hudChrome.discord.tiers.legend',
  mythic: 'hudChrome.discord.tiers.mythic',
} satisfies Record<DiscordStatusKey, TranslationKey>;

/** The presentation rung at a 1-based index (1-8), or undefined out of range. */
export function discordStatusTierByIndex(index: number): DiscordStatusTier | undefined {
  const shared = sharedStatusByIndex(index);
  return shared ? DISCORD_STATUS_TIERS[shared.index - 1] : undefined;
}

/** The presentation rung for a lifetime-points total (always defined, >= rung 1). */
export function discordStatusTierForPoints(lifetimePoints: number): DiscordStatusTier {
  const shared = sharedStatusForPoints(lifetimePoints);
  return DISCORD_STATUS_TIERS[shared.index - 1];
}

/** Localized display name for a status rung index (0 = not linked). */
export function discordStatusDisplayName(index: number): string {
  const tier = discordStatusTierByIndex(index);
  return tier ? t(DISCORD_STATUS_TEXT_KEYS[tier.key]) : t('hudChrome.discord.tiers.none');
}

/**
 * A standalone SVG data URL badge for a status rung: a glowing ring with the rung
 * number, suitable for an <img> src or canvas blit. `px` sets the raster box.
 */
export function discordStatusBadgeDataUrl(index: number, px = 96): string {
  const tier = discordStatusTierByIndex(index) ?? DISCORD_STATUS_TIERS[0];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 64 64">` +
    `<defs><radialGradient id="g" cx="38%" cy="32%" r="72%">` +
    `<stop offset="0%" stop-color="${tier.ring}"/>` +
    `<stop offset="100%" stop-color="${tier.glow}"/>` +
    `</radialGradient></defs>` +
    `<circle cx="32" cy="32" r="30" fill="url(#g)"/>` +
    `<circle cx="32" cy="32" r="30" fill="none" stroke="#1c140a" stroke-width="2"/>` +
    `<circle cx="32" cy="32" r="26" fill="none" stroke="#fff6df" stroke-opacity="0.35" stroke-width="1.5"/>` +
    `<text x="32" y="40" text-anchor="middle" font-family="serif" font-size="26" font-weight="700" fill="#fff6df">${tier.index}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
