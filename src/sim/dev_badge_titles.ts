// The developer-badge rungs as wearable titles, a title source that is NOT a
// Book of Deeds reward.
//
// Deeds record in-game accomplishments; a contributor's badge rung
// (src/sim/dev_tier.ts) is earned outside the game, resolved server-side from a
// verified GitHub link, and stamped on Entity.devTier. So these titles never
// touch the deed catalog: they reuse only the displayed-title SLOT
// (PlayerMeta.activeTitle / Entity.title, a plain string id) under their own
// `dev:` namespace, which can never collide with a deed id (deed ids are
// lower_snake with a category prefix, no colon).
//
// Wearability is LIVE, like the badge itself: a rung may be worn while the
// resolved tier reaches it, and every rung at or below it is on offer (a
// Worldwright can still wear Artificer). When the resolved tier drops below the
// worn rung (the GitHub link was removed or moved to another account), the
// server clears the title (reconcileDevBadgeTitle).
//
// Pure, host-agnostic, no rng or wall clock: the sim never reads devTier for
// gameplay, and these ids are cosmetic only.

import { DEV_TIER_DEFS, type DevTierKey } from './dev_tier';

type DevTierDef = (typeof DEV_TIER_DEFS)[number];

export const DEV_BADGE_TITLE_PREFIX = 'dev:';

/** The title id for a badge rung, e.g. 'dev:artificer'. */
export function devBadgeTitleId(key: DevTierKey): string {
  return `${DEV_BADGE_TITLE_PREFIX}${key}`;
}

/** The rung a developer-badge title id names, or undefined for any other id. */
export function devBadgeTitleTier(id: string | null | undefined): DevTierDef | undefined {
  if (typeof id !== 'string' || !id.startsWith(DEV_BADGE_TITLE_PREFIX)) return undefined;
  const key = id.slice(DEV_BADGE_TITLE_PREFIX.length);
  return DEV_TIER_DEFS.find((tier) => tier.key === key);
}

/** Whether a resolved badge tier (1-based index, 0 = none) may wear this title id. */
export function canWearDevBadgeTitle(id: string, devTier: number | undefined): boolean {
  const tier = devBadgeTitleTier(id);
  return tier !== undefined && (devTier ?? 0) >= tier.index;
}

/** Every rung title id a resolved tier may wear, lowest rung first. */
export function wearableDevBadgeTitles(devTier: number | undefined): string[] {
  return DEV_TIER_DEFS.filter((tier) => (devTier ?? 0) >= tier.index).map((tier) =>
    devBadgeTitleId(tier.key),
  );
}

/** English rung names for English-by-design server surfaces (the /c/ page).
 *  Client surfaces localize through hudChrome.devBadge.tiers instead; a test
 *  pins these to that catalog's English. */
export const DEV_BADGE_TITLE_ENGLISH: Readonly<Record<DevTierKey, string>> = {
  tinkerer: 'Tinkerer',
  artificer: 'Artificer',
  runesmith: 'Runesmith',
  architect: 'Architect',
  worldwright: 'Worldwright',
};

/**
 * Clear a worn developer-badge title the entity's current tier no longer
 * reaches (meta and entity together, like setActiveTitle). A deed title or no
 * title is left alone. Returns true when it cleared one.
 */
export function reconcileDevBadgeTitle(
  meta: { activeTitle: string | null },
  e: { title?: string | null; devTier?: number },
): boolean {
  const worn = meta.activeTitle;
  if (worn === null || devBadgeTitleTier(worn) === undefined) return false;
  if (canWearDevBadgeTitle(worn, e.devTier)) return false;
  meta.activeTitle = null;
  e.title = null;
  return true;
}
