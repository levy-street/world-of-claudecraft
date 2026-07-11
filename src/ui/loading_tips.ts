// Rotating "did you know" style tips shown under the loading-screen progress
// bar. Pure and DOM-free: picks/rotates a tip key, the caller renders it via
// t(). Kept separate from main.ts (a firewall, not a home for new logic).
import { type TranslationKey, t } from './i18n';

const LOADING_TIP_KEYS: TranslationKey[] = [
  'loading.tips.classes',
  'loading.tips.talents',
  'loading.tips.dungeons',
  'loading.tips.market',
  'loading.tips.guilds',
  'loading.tips.professions',
  'loading.tips.loadouts',
  'loading.tips.pvp',
];

export interface LoadingTipRotation {
  /** Current tip text, already resolved through t(). */
  current(): string;
  /** Advances to the next tip (wraps around) and returns its text. */
  next(): string;
}

/**
 * Starts a rotation at a pseudo-random offset (Date.now()-seeded is fine here:
 * this is cosmetic UI copy, not sim state, so it's exempt from the sim's
 * Rng-only randomness rule) so repeat page loads don't always open on the
 * same tip.
 */
export function createLoadingTipRotation(
  startIndex = Math.floor(Math.random() * LOADING_TIP_KEYS.length),
): LoadingTipRotation {
  let index =
    ((startIndex % LOADING_TIP_KEYS.length) + LOADING_TIP_KEYS.length) % LOADING_TIP_KEYS.length;
  return {
    current(): string {
      return t(LOADING_TIP_KEYS[index]);
    },
    next(): string {
      index = (index + 1) % LOADING_TIP_KEYS.length;
      return t(LOADING_TIP_KEYS[index]);
    },
  };
}
