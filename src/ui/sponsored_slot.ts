// Pure ad-selection + sanitization for sponsored placements in the daily-rewards
// HUD (the "sponsored spin" slot). Contract-compatible with the ad-marketplace's
// server ActiveAd (placementId, kind, text, clickUrl, cta, advertiser, endSec) so
// the HUD can consume `adService.getForPlacement('daily_spin')` directly once that
// feature lands; until then a sample ad drives the UI. Zero DOM so the selection,
// rotation, and URL/CTA hardening are unit-tested and the HUD is a thin consumer.

export type AdKind = 'image' | 'text';

export interface SponsoredAd {
  /** Placement this booking targets, e.g. 'daily_spin'. */
  placementId: string;
  advertiser: string;
  /** Text-creative copy (the ad-marketplace `text` field). */
  headline: string;
  /** Real-world call to action ("Get the app", "20% off"). */
  cta: string;
  /** External destination; only http(s) is rendered (see safeClickUrl). */
  clickUrl: string;
  kind: AdKind;
  /** For image creatives: the served banner image URL (e.g. /api/ads/creative/:id). */
  imageUrl?: string;
  /** The advertiser's square logo URL for the spinner hub, if they uploaded one. */
  logoUrl?: string;
  /** Unix seconds when this booking ends; past bookings are never shown. */
  endSec: number;
}

/** How long each live sponsor holds the slot before rotating to the next (seconds). */
export const ROTATE_SECONDS = 30;

/**
 * The sponsor to show for `placementId` at `nowSec`: among the bookings live now
 * (endSec > nowSec) for that placement, rotate deterministically by wall-clock so
 * co-booked advertisers share the slot evenly. Returns null when nothing is live,
 * so the HUD cleanly shows no sponsor (the empty space stays empty, not broken).
 */
export function activeSponsor(ads: readonly SponsoredAd[], placementId: string, nowSec: number): SponsoredAd | null {
  const live = ads.filter((a) => a.placementId === placementId && a.endSec > nowSec);
  if (live.length === 0) return null;
  const slot = Math.floor(Math.max(0, nowSec) / ROTATE_SECONDS) % live.length;
  return live[slot];
}

/**
 * Return `url` only when it is a safe external http(s) link, else null. Blocks
 * javascript:, data:, and relative/garbage URLs so a malicious creative cannot
 * smuggle script into the HUD via the click target. The HUD renders the CTA as a
 * plain link only when this returns non-null.
 */
export function safeClickUrl(url: string): string | null {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return null;
  // URL must parse and keep an http(s) protocol (rejects "http://" with no host).
  const parsed = parseUrl(u);
  if (!parsed) return null;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.host) return null;
  return parsed.href;
}

// new URL() throws on malformed input; wrap once so callers stay total. (This is
// input validation of attacker-controlled creative data, not a defensive default.)
function parseUrl(u: string): URL | null {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

/** A trimmed, length-capped CTA label safe to drop into a button. */
export function ctaLabel(cta: string, max = 28): string {
  const c = cta.trim().replace(/\s+/g, ' ');
  if (c.length <= max) return c;
  return `${c.slice(0, max - 1).trimEnd()}…`;
}

/** "Sponsored by <advertiser>" attribution, with a sane fallback when unnamed. */
export function attribution(ad: SponsoredAd): string {
  const name = ad.advertiser.trim();
  return name ? `Sponsored by ${name}` : 'Sponsored';
}

/**
 * The logo to show in the spinner hub: the active sponsor's uploaded logo when
 * present, otherwise the default (World of ClaudeCraft) logo. `ad` is null when no
 * sponsor is live, so the hub always falls back to the brand mark.
 */
export function hubLogo(ad: SponsoredAd | null, fallbackUrl: string): string {
  const url = ad?.logoUrl?.trim();
  return url ? url : fallbackUrl;
}
