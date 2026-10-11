// The Currencies tab's pure view core: every balance the character can spend
// that is NOT coin, in two groups. Activities: the Heroic Mark (an inventory
// item today, counted across the bags), Honor, Delve Marks and the $WOC token
// (the account-linked wallet, injected by the painter because it is host state,
// not IWorld). Factions: one row per allied faction, PENDING until Stage 2 of
// the World Quests scope chooses the currency model; standing is shown on the
// Reputation tab and is deliberately not a currency here.
import { FACTION_IDS, type FactionId } from '../../../sim/factions';
import type { InvSlot } from '../../../sim/types';

export type ActivityCurrencyId = 'heroic_mark' | 'honor' | 'delve_mark' | 'woc_token';

export interface ActivityCurrencyRow {
  readonly id: ActivityCurrencyId;
  /** The spendable amount; null when the source is unavailable (no wallet linked). */
  readonly amount: number | null;
  /** A lifetime or verification note the painter may show beside the amount. */
  readonly lifetime: number | null;
  /** For the token: whether the shown balance is the verified one. */
  readonly verified: boolean;
}

export interface FactionCurrencyRow {
  readonly factionId: FactionId;
  readonly amount: number;
  /** True until the faction currency model ships (Stage 2). */
  readonly pending: boolean;
}

export interface CurrenciesView {
  readonly activities: readonly ActivityCurrencyRow[];
  readonly factions: readonly FactionCurrencyRow[];
}

export interface CurrenciesViewInput {
  readonly inventory: readonly Pick<InvSlot, 'itemId' | 'count'>[];
  readonly honor: number;
  readonly lifetimeHonor: number;
  readonly delveMarks: number;
  readonly factionCurrencies?: Readonly<Record<FactionId, number>>;
  readonly woc: {
    readonly enabled: boolean;
    readonly balance: number | null;
    readonly verified: boolean;
  };
}

export const HEROIC_MARK_ITEM_ID = 'heroic_mark';

/** Marks live in the bags as an ordinary stackable item; sum every stack. */
export function heroicMarkCount(inventory: readonly Pick<InvSlot, 'itemId' | 'count'>[]): number {
  let total = 0;
  for (const slot of inventory) {
    if (slot.itemId === HEROIC_MARK_ITEM_ID) total += Math.max(0, Math.floor(slot.count));
  }
  return total;
}

const whole = (value: number): number =>
  Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));

export function buildCurrenciesView(input: CurrenciesViewInput): CurrenciesView {
  const activities: ActivityCurrencyRow[] = [
    { id: 'heroic_mark', amount: heroicMarkCount(input.inventory), lifetime: null, verified: true },
    {
      id: 'honor',
      amount: whole(input.honor),
      lifetime: whole(input.lifetimeHonor),
      verified: true,
    },
    { id: 'delve_mark', amount: whole(input.delveMarks), lifetime: null, verified: true },
  ];
  if (input.woc.enabled) {
    activities.push({
      id: 'woc_token',
      amount: input.woc.balance === null ? null : Math.max(0, input.woc.balance),
      lifetime: null,
      verified: input.woc.verified,
    });
  }
  return {
    activities,
    factions: FACTION_IDS.map((factionId) => ({
      factionId,
      amount: whole(input.factionCurrencies?.[factionId] ?? 0),
      pending: false,
    })),
  };
}
