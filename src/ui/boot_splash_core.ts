/** On body from the HTML until the boot splash lifts; hides everything but the splash. */
export const BOOT_PENDING_CLASS = 'boot-pending';
export const BOOT_SPLASH_ID = 'boot-splash';
export const BOOT_SPLASH_LEAVING_CLASS = 'boot-splash-leaving';
/** Dispatched on document when the boot module takes the splash over from the inline fail-safe. */
export const BOOT_SPLASH_OWNED_EVENT = 'woc:boot-splash-owned';
/** The inline script's `data-boot-settled` mark on a stylesheet link that loaded or failed. */
export const BOOT_STYLESHEET_SETTLED_KEY = 'bootSettled';

/**
 * How long cosmetic readiness (web fonts, the backdrop image) may hold the splash
 * after the required work settled. A bound, not a tuning: past it the page shows
 * with fallback fonts or a plain backdrop rather than keeping the player waiting.
 */
export const BOOT_SPLASH_COSMETIC_WAIT_MS = 3000;

/**
 * Settles once every required probe settled (a rejection counts: the page must
 * never stay behind the splash because a probe failed) and then the cosmetic probes
 * settled or `cosmeticWaitMs` elapsed, whichever comes first.
 */
export async function bootSplashReady(
  required: readonly PromiseLike<unknown>[],
  cosmetic: readonly PromiseLike<unknown>[],
  cosmeticWaitMs: number,
  delay: (ms: number) => PromiseLike<void>,
): Promise<void> {
  await Promise.allSettled(required);
  await Promise.race([Promise.allSettled(cosmetic), delay(cosmeticWaitMs)]);
}

/** The first `url(...)` of a computed `background-image`, or null for `none` or a gradient. */
export function firstBackgroundImageUrl(backgroundImage: string): string | null {
  const match = /url\(\s*(["']?)(.*?)\1\s*\)/.exec(backgroundImage);
  return match?.[2] ? match[2] : null;
}
