// The seasonal toys' use arms (items.ts useItem routes `use.type 'seasonal'` and
// the Gourdlight treat pouch here). Every arm is refused while the event is
// closed, so a cosmetic bought during the event waits in the bags for next year.

import { bagsFullError } from '../bags';
import {
  GOURDLIGHT_COSTUMES,
  GOURDLIGHT_POUCH_SWEETS,
  GOURDLIGHT_SWEET_ID,
  GOURDLIGHT_TITLE_WRITS,
  GOURDLIGHT_TRICKS,
  PUMPKIN_HEAD_AURA_ID,
} from '../content/gourdlight_eve';
import { THATCHGRIN_SACK_SWEETS } from '../content/gourdlight_eve_scarecrow';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity, ItemInstancePayload } from '../types';
import {
  playCostume,
  playStrawlingGuise,
  playTrick,
  pumpkinHeadAura,
  stripSeasonalAura,
} from './seasonal_cosmetics';
import { activeSeasonalEventOf } from './seasonal_state';
import { useGourdlightToy } from './seasonal_toys';

export type SeasonalItemAction =
  | 'pumpkinHead'
  | 'trickJar'
  | 'strawlingCharm'
  | 'costume'
  | 'titleWrit'
  | 'toy';

function eventClosed(ctx: SimContext, meta: PlayerMeta): boolean {
  if (activeSeasonalEventOf(ctx.seasonal) !== null) return false;
  ctx.emit({ type: 'seasonal', what: 'notActive', pid: meta.entityId });
  return true;
}

/** The Carved Pumpkin Head toggles on and off (never consumed); the Jar of
 *  Mischief plays a random trick on its user and is spent; a costume draught wears its
 *  body for ten minutes and is spent; a title writ grants its title Feat and is spent
 *  (refused, unspent, when the title is already earned). */
export function useSeasonalItem(
  ctx: SimContext,
  meta: PlayerMeta,
  p: Entity,
  action: SeasonalItemAction,
  consumeOne: () => ItemInstancePayload | undefined,
  itemId = '',
): void {
  if (eventClosed(ctx, meta)) return;
  // A writ is paperwork, not a body swap: readable anywhere, in combat too.
  if (action === 'titleWrit') {
    useTitleWrit(ctx, meta, itemId, consumeOne);
    return;
  }
  // Hester's toys: reusable, never consumed, each on its own cooldown (seasonal_toys.ts).
  if (action === 'toy') {
    useGourdlightToy(ctx, meta, p, itemId);
    return;
  }
  if (action === 'pumpkinHead') {
    if (meta.pumpkinHeadWorn) {
      meta.pumpkinHeadWorn = false;
      stripSeasonalAura(ctx, p, PUMPKIN_HEAD_AURA_ID);
      ctx.emit({ type: 'seasonal', what: 'pumpkinOff', pid: meta.entityId });
    } else {
      meta.pumpkinHeadWorn = true;
      if (!p.dead) ctx.applyAura(p, pumpkinHeadAura(p.id));
      ctx.emit({ type: 'seasonal', what: 'pumpkinOn', pid: meta.entityId });
    }
    meta.wireRev++;
    return;
  }
  // A trick body hides a fighter's class, weapon and casts: never mid-fight (the
  // fairness rule), and a trick already running drops the moment combat starts
  // (seasonal_tick.ts). Refused before any rng draw.
  if (p.inCombat) {
    ctx.error(meta.entityId, "You can't do that while in combat.");
    return;
  }
  // A costume draught: its body for ten minutes, the draught spent. No rng.
  if (action === 'costume') {
    const costume = GOURDLIGHT_COSTUMES.find((c) => c.itemId === itemId);
    if (!costume) return;
    consumeOne();
    const aura = playCostume(ctx, p, costume);
    ctx.emit({ type: 'seasonal', what: 'costume', trick: aura, pid: meta.entityId });
    return;
  }
  // The Strawling Charm (Old Thatchgrin's cosmetic): reusable, never consumed, no rng.
  if (action === 'strawlingCharm') {
    const guise = playStrawlingGuise(ctx, p);
    ctx.emit({ type: 'seasonal', what: 'guise', trick: guise, pid: meta.entityId });
    return;
  }
  consumeOne();
  const index = ctx.rng.int(0, GOURDLIGHT_TRICKS.length - 1);
  const trick = playTrick(ctx, p, index, p.id);
  ctx.emit({ type: 'seasonal', what: 'jarTrick', trick, pid: meta.entityId });
}

/** A title writ: its Feat (and so its title) is granted, the writ spent. A writ for a
 *  title already earned is refused and kept, so nothing is ever wasted. */
function useTitleWrit(
  ctx: SimContext,
  meta: PlayerMeta,
  itemId: string,
  consumeOne: () => ItemInstancePayload | undefined,
): void {
  const writ = GOURDLIGHT_TITLE_WRITS.find((w) => w.itemId === itemId);
  if (!writ) return;
  if (meta.deedsEarned.has(writ.deedId)) {
    ctx.emit({ type: 'seasonal', what: 'titleKnown', pid: meta.entityId });
    return;
  }
  if (!ctx.grantDeed(meta, writ.deedId)) return;
  consumeOne();
  ctx.emit({ type: 'seasonal', what: 'titleGranted', trick: writ.deedId, pid: meta.entityId });
}

/** Old Thatchgrin's sweet sack, opened like the rounds pouch (a full bag keeps it). */
export function openThatchgrinSack(
  ctx: SimContext,
  meta: PlayerMeta,
  consumeOne: () => ItemInstancePayload | undefined,
): void {
  if (!ctx.canAddItem(GOURDLIGHT_SWEET_ID, THATCHGRIN_SACK_SWEETS, meta.entityId)) {
    bagsFullError(ctx, meta.entityId, GOURDLIGHT_SWEET_ID);
    return;
  }
  consumeOne();
  ctx.addItem(GOURDLIGHT_SWEET_ID, THATCHGRIN_SACK_SWEETS, meta.entityId);
}

/** The rounds quest's pouch: opened, it hands over its sweets and is spent. A
 *  full bag keeps the pouch rather than losing the sweets. Works out of season:
 *  a pouch is already earned. */
export function openGourdlightPouch(
  ctx: SimContext,
  meta: PlayerMeta,
  consumeOne: () => ItemInstancePayload | undefined,
): void {
  if (!ctx.canAddItem(GOURDLIGHT_SWEET_ID, GOURDLIGHT_POUCH_SWEETS, meta.entityId)) {
    bagsFullError(ctx, meta.entityId, GOURDLIGHT_SWEET_ID);
    return;
  }
  consumeOne();
  ctx.addItem(GOURDLIGHT_SWEET_ID, GOURDLIGHT_POUCH_SWEETS, meta.entityId);
}
