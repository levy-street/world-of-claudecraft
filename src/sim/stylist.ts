// The Stylist's counter: buying a character redesign credit, server-authoritative,
// a sibling system behind SimContext (never a method cluster on the sim.ts
// coordinator).
//
// What a credit IS: one entitlement to reopen the character creator on this
// character and author a new look, spent at char-select through the redesign
// endpoint. It is bound to the character and is NOT an item: it never enters the
// bags, so it cannot be traded, mailed, or listed on the World Market. That is why
// this is its own service verb rather than a `vendorItems` row: the copper-vendor
// path (items.ts buyItem) exists to put an ITEM in a bag, and every one of its
// laundering routes is exactly what a cosmetic entitlement must not have.
// learnRiding (mounts_training.ts) is the shape this follows: a gold-charging
// service that grants a flag on PlayerMeta and hands over nothing.
//
// The price comes from the level band table (content/redesign_pricing.ts), read
// ONCE here at purchase time. Everything below happens inside the sim tick that
// dispatched the command, so validate-funds / deduct / increment is atomic with
// respect to every other player action: there is no await between the balance
// compare and the two writes.
//
// Determinism: driven off live player state only, so this system draws NO rng and
// perturbs no draw order. `src/sim`-pure: no DOM/Three, no Math.random/Date.now/
// performance.now (enforced by tests/architecture.test.ts).

import { redesignPriceCopper } from './content/redesign_pricing';
import { STYLIST_NPC_ID } from './content/stylist';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { dist2d, type Entity, INTERACT_RANGE } from './types';

/** Defensive ceiling on stacked credits. Holding several is legal by design (the
 *  field is an integer, not a boolean), but an unbounded counter is a fuzzing
 *  target and nobody has a use for a four-figure stack. Refusing at the counter
 *  keeps the stored integer small and the refusal readable, instead of letting a
 *  scripted buy loop inflate the blob. */
export const MAX_REDESIGN_CREDITS = 99;

// Player notices and errors (English at the emit site; re-localized client-side
// by the sim_i18n matcher, S3-guarded). ALL of them are placeholder-free, which
// is deliberate: they register in the EXACT matcher automatically, with no
// bespoke regex arm and no money fragment to reverse. The price does not belong
// in the confirmation line because the player just clicked a button that quoted
// it, through the locale-aware formatMoney; re-stating it here would mean
// emitting a formatted money string from the language-agnostic sim and parsing
// it back at the HUD boundary for no added information.
const ERROR_NOT_STYLIST = 'You must speak to the Stylist to change your look.';
const ERROR_TOO_FAR = 'Too far away.';
const ERROR_DEAD = "You can't do that while dead.";
const ERROR_NO_MONEY = 'Not enough money.';
const ERROR_CREDIT_CAP = 'You already hold as many redesigns as you can carry.';
const NOTICE_CREDIT_BOUGHT =
  'The Stylist takes your coin. Your new look is ready to design at character select.';

/** How many redesign credits this character holds. Absent means zero: the field
 *  is omitted from the save while it is falsy (the sim's zero-default omission
 *  convention), so every pre-feature character reads as 0 without a migration. */
export function redesignCreditsOf(meta: PlayerMeta): number {
  const held = meta.redesignCredits;
  return typeof held === 'number' && Number.isFinite(held) && held > 0 ? Math.floor(held) : 0;
}

/** The price THIS character would pay right now, in copper. Exported for the
 *  dialog's price line, which must quote the same number the purchase charges. */
export function redesignCreditPriceFor(e: Entity): number {
  return redesignPriceCopper(e.level);
}

function findStylist(ctx: SimContext, npcId: number): Entity | null {
  const npc = ctx.entities.get(npcId);
  if (!npc || npc.kind !== 'npc' || npc.templateId !== STYLIST_NPC_ID) return null;
  return npc;
}

/**
 * Buy one redesign credit from the Stylist.
 *
 * Gate order mirrors the vendor family (items.ts buyItem / learnRiding): identity
 * first, then the dead and range refusals a legitimate frame can also hit, then
 * the cap, then funds LAST so the "Not enough money" line is only ever reached by
 * a request that was otherwise valid. The two writes happen together at the
 * bottom, after every refusal has returned, so no path can charge without
 * crediting or credit without charging.
 *
 * `npcId` is the entity the client says it is talking to, validated here against
 * the Stylist template: the client is never trusted to name the price or the
 * counter.
 */
export function buyRedesignCredit(ctx: SimContext, npcId: number, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  const npc = findStylist(ctx, npcId);
  if (!npc) {
    ctx.error(meta.entityId, ERROR_NOT_STYLIST);
    return;
  }
  if (p.dead) {
    ctx.error(meta.entityId, ERROR_DEAD);
    return;
  }
  if (dist2d(p.pos, npc.pos) > INTERACT_RANGE + 2) {
    ctx.error(meta.entityId, ERROR_TOO_FAR);
    return;
  }
  const held = redesignCreditsOf(meta);
  if (held >= MAX_REDESIGN_CREDITS) {
    ctx.error(meta.entityId, ERROR_CREDIT_CAP);
    return;
  }
  // Priced off the buyer's CURRENT level and fixed here: the credit is worth one
  // redesign forever, so out-levelling the band later never costs more, and a
  // future re-band never reprices a credit already bought.
  const price = redesignCreditPriceFor(p);
  if (meta.copper < price) {
    ctx.error(meta.entityId, ERROR_NO_MONEY);
    return;
  }
  meta.copper -= price;
  meta.redesignCredits = held + 1;
  // TODO(economy-watch): once the Economy Watch gold ledger lands
  // (feature/economy-watch-p1), emit this spend as the closed-allowlist event
  // kind `cosmetic_redesign`. Until then the deduction is a plain PlayerMeta
  // copper write in the sim tick, which is the same shape every vendor purchase
  // uses (items.ts buyItem, mounts_training.ts learnRiding), so the ledger picks
  // it up automatically when it starts observing that path.
  ctx.notice(meta.entityId, NOTICE_CREDIT_BOUGHT);
}
