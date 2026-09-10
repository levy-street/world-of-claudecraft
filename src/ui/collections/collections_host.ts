// The Collections window's construction bag: everything the window needs from
// the Hud coordinator, assembled here instead of inline in hud.ts.
//
// hud.ts is a firewall under a zero-slack line ratchet (tests/
// monolith_budget.test.ts), so a new window's deps object lives beside the
// window it feeds and the coordinator keeps one field plus one toggle. The host
// interface names the Hud capabilities as bound closures rather than taking Hud
// structurally: the members it needs (the shared turntable mount, the world,
// the focus pair) are private on Hud, so a structural cast would have to go
// through `unknown` and lose every compile-time check on the seam. Same idiom
// as CharSkinPainterHost.

import type { WocMarketClient } from '../../net/woc_market_sdk';
import { mobVisualKey } from '../../render/characters/manifest';
import type { PreviewFramingName } from '../../render/characters/preview_framing';
import { MOUNT_VISUAL_SPECS } from '../../render/mount_visuals';
import { BUDDY_KEYS } from '../../sim/content/buddies';
import { buddyTemplateId } from '../../sim/content/buddy_mobs';
import type { PlayerClass } from '../../sim/types';
import type { IWorld } from '../../world_api';
import type { PainterHostPresentation } from '../painter_host';
import {
  type CollectionPreviewKind,
  CollectionsWindow,
  type CollectionsWindowDeps,
} from './collections_window';

/** mount key -> renderer visual key, flattened once at module load. Built here
 *  rather than in collections_view.ts so the view core keeps its no-render-import
 *  rule; the window only ever sees plain strings. */
export const MOUNT_VISUAL_KEYS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(MOUNT_VISUAL_SPECS).map(([key, spec]) => [key, spec.visualKey]),
  ),
);

/** buddy key -> renderer visual key, resolved through the SAME lookup the world
 *  draws a buddy with (mobVisualKey). Going straight to the template id would
 *  miss the two buddies that share the Quaternius animal rigs rather than
 *  shipping one of their own, and the preview would silently come up empty. */
export const BUDDY_VISUAL_KEYS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(BUDDY_KEYS.map((key) => [key, mobVisualKey(buddyTemplateId(key))])),
);

/** The shared-turntable options a collection row mounts with. A buddy stands
 *  well under a player's height and a mount well over it, so each takes its own
 *  framing (preview_framing.ts) rather than either player crop, and neither
 *  carries hands, a cosmetic skin or a weapon skin. Built here so the Hud
 *  coordinator keeps one bound call instead of the options literal. */
export function collectionsPreviewOptions(
  previewKey: string,
  cls: PlayerClass,
  kind: CollectionPreviewKind,
  tint = 0xffffff,
): {
  cls: PlayerClass;
  skin: number;
  previewKey: string;
  mainhand: null;
  offhand: null;
  weaponSkinId: null;
  framing: PreviewFramingName;
  tint: number;
} {
  return {
    cls,
    skin: 0,
    previewKey,
    mainhand: null,
    offhand: null,
    weaponSkinId: null,
    framing: kind === 'mount' ? 'collectionMount' : 'collectionBuddy',
    tint,
  };
}

/** The one Exchange call the window needs: a lowest-price browse over a named
 *  set of item ids. Narrowed to a Pick of the SDK client rather than the client
 *  itself so this module (and its test) never depends on the rest of the
 *  marketplace surface. */
export type CollectionsExchangeClient = Pick<WocMarketClient, 'browse'>;

/** Lowest live buy-now price per item id, in USD cents, from ONE price-ascending
 *  browse over the given ids. Listings with no buy-now (bid-only auctions) are
 *  skipped: the window shows a price a player could actually pay today, and a
 *  standing bid is neither a floor nor a purchase. A failed or unavailable
 *  browse resolves empty rather than throwing, so the pane degrades to "no
 *  listings" instead of blanking the row. */
export async function exchangeLowestCentsFor(
  client: CollectionsExchangeClient | null,
  itemIds: readonly string[],
): Promise<Map<string, number>> {
  const lowest = new Map<string, number>();
  if (!client || itemIds.length === 0) return lowest;
  const res = await client.browse({
    page: 0,
    quality: null,
    format: null,
    category: null,
    subcategory: null,
    itemIds,
    sort: 'price_asc',
  });
  if (!res.ok) return lowest;
  for (const listing of res.listings) {
    const cents = listing.buyNowCents;
    if (cents === null || cents === undefined) continue;
    const current = lowest.get(listing.itemId);
    if (current === undefined || cents < current) lowest.set(listing.itemId, cents);
  }
  return lowest;
}

export interface CollectionsHost extends PainterHostPresentation {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  /** Mount the SHARED character turntable on this visual key (Hud's
   *  mountSharedPreview). One canvas serves the sheet, the inspect stage and
   *  this window, so Collections adds no GPU producer of its own. */
  mountPreview(
    container: HTMLElement,
    visualKey: string,
    kind: CollectionPreviewKind,
    tint: number,
  ): void;
  /** The live Exchange client, or null when the Exchange is not attached to
   *  this build (desktop, native, offline) or has not attached yet. Read per
   *  call and never captured, so a client that attaches after the window was
   *  built still answers. */
  exchangeClient(): CollectionsExchangeClient | null;
}

/** Ownership straight off the IWorld facets: buddies and mounts answer at KEY
 *  level (the sim already resolves "is the whistle/reins in bags or bank"),
 *  set pieces are ordinary gear and answer at item-id level from what the
 *  viewer carries or wears. */
export function collectionsWindowDeps(host: CollectionsHost): CollectionsWindowDeps {
  return {
    // The presentation bag rides straight through: icons and tooltips are the
    // HUD's, so a set piece here reads exactly as it does in the bags.
    itemIcon: host.itemIcon,
    moneyHtml: host.moneyHtml,
    itemTooltip: host.itemTooltip,
    attachTooltip: host.attachTooltip,
    root: host.root,
    world: host.world,
    closeOthers: host.closeOthers,
    captureFocus: host.captureFocus,
    restoreFocus: host.restoreFocus,
    mountPreview: host.mountPreview,
    ownedBuddyKeys: () => new Set<string>(host.world().ownedBuddies()),
    ownedMountKeys: () => new Set<string>(host.world().ownedMounts()),
    ownedItemIds: () =>
      new Set<string>([
        ...host.world().inventory.map((slot) => slot.itemId),
        ...Object.values(host.world().equipment).filter(
          (id): id is string => typeof id === 'string',
        ),
      ]),
    buddyVisualKeys: () => BUDDY_VISUAL_KEYS,
    mountVisualKeys: () => MOUNT_VISUAL_KEYS,
    // Null, not an empty map, when there is no Exchange to ask: the window
    // tells those two apart ("not available on this client" against "no
    // listings"), and a player deserves the difference.
    exchangeLowestCents: (itemIds) => {
      const client = host.exchangeClient();
      return client ? exchangeLowestCentsFor(client, itemIds) : null;
    },
  };
}

/** One call for the coordinator: build the window on its host bag. */
export function buildCollectionsWindow(host: CollectionsHost): CollectionsWindow {
  return new CollectionsWindow(collectionsWindowDeps(host));
}
