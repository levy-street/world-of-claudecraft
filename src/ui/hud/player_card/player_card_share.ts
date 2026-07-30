// Bridge for hosting a shared player card.
//
// Publishing a card requires the network layer (an authenticated upload to the
// current realm), but src/ui must not import src/net. So, exactly like
// wallet_balance.ts, main.ts (the one layer that knows both) injects an
// uploader here, and the HUD reads it out. When no uploader is set (offline
// play, or before world entry) the HUD falls back to download / native share
// only, with no hosted link.

declare const absoluteUrlBrand: unique symbol;
export type AbsoluteUrl = string & { readonly [absoluteUrlBrand]: true };

/**
 * Normalize the raw upload response before it crosses into the share UI.
 * The server currently returns realm-relative paths such as `/p/<slug>`;
 * PublishedCard.url must always be absolute so native/share-link consumers do
 * not need to know which realm produced the card.
 */
export function absolutePublishedCardUrl(
  url: string,
  realmOrigin: string,
  pageOrigin: string,
): AbsoluteUrl {
  return new URL(url, realmOrigin || pageOrigin).href as AbsoluteUrl;
}

/** Result of publishing a card. The card page itself embeds the `?ref=` CTA
 *  server-side, so clients share this URL directly. */
export interface PublishedCard {
  /** Absolute URL of the public card page. */
  url: AbsoluteUrl;
}

/** Card details the uploader needs so the hosted page matches the composited PNG. */
export interface PublishedCardMeta {
  /** The character level drawn on the PNG (live), used for the hosted card title. */
  level: number;
}

export type CardUploader = (png: Blob, meta: PublishedCardMeta) => Promise<PublishedCard>;

/** Referral count + the player's published-card slug (null before first publish). */
export interface ReferralInfo {
  count: number;
  slug: string | null;
}
export type ReferralProvider = () => Promise<ReferralInfo>;

/** A character's realm standing by lifetime XP (rank 1 = highest of `total`). */
export interface CharacterStanding {
  rank: number;
  total: number;
}
export type StandingProvider = () => Promise<CharacterStanding | null>;

let uploader: CardUploader | null = null;
let referralProvider: ReferralProvider | null = null;
let standingProvider: StandingProvider | null = null;

/** main.ts injects the authenticated uploader on world entry (null to clear). */
export function setCardUploader(fn: CardUploader | null): void {
  uploader = fn;
}

/** main.ts injects a referral-stats fetcher on world entry (null to clear). */
export function setReferralProvider(fn: ReferralProvider | null): void {
  referralProvider = fn;
}

/** main.ts injects a character-standing fetcher on world entry (null to clear). */
export function setStandingProvider(fn: StandingProvider | null): void {
  standingProvider = fn;
}

/** True when the current session can host a card (online play). */
export function cardHostingAvailable(): boolean {
  return uploader !== null;
}

/** Publish the card PNG; resolves to its hosted page URL. */
export function publishCard(png: Blob, meta: PublishedCardMeta): Promise<PublishedCard> {
  if (!uploader) throw new Error('card hosting is unavailable in this session');
  return uploader(png, meta);
}

/** Referral stats for the card footer, or null when unavailable (offline). */
export function fetchReferralInfo(): Promise<ReferralInfo | null> {
  return referralProvider ? referralProvider() : Promise.resolve(null);
}

/** Character standing for the card's "Top N%", or null when unavailable. */
export function fetchStanding(): Promise<CharacterStanding | null> {
  return standingProvider ? standingProvider() : Promise.resolve(null);
}
