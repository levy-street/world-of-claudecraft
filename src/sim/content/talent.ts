// Featured-talent wares on the Logol pipeline (docs/prd/woc/talent-checkout.md):
// data-as-code only (no engine logic). A featured creator ("talent") owns one or
// more prestige COSMETIC wares a buyer purchases in their CHOICE of currency
// (USDC, SOL, or $WOC). Each ware carries an explicit human-readable price PER
// currency (authored, not derived from a live exchange rate, so a sale is
// deterministic and never depends on an oracle); the server converts to base
// units and splits 80/20 (talent/treasury) on confirm.
//
// Everything here is cosmetic-only and account-bound, the same non-pay-to-win
// invariant Logol's wares hold (root CLAUDE.md): no ware grants or scales a
// stat. Purchase/verification/grant is server-side (server/talent.ts); the
// weekly-merchant appearance and quest-unlock live in the Logol modules and are
// unchanged by this feature.
import type { TalentWare } from '../types';

// The three prices a ware carries, one per accepted currency (human-readable
// units: whole USDC, whole SOL, whole $WOC). A buyer picks one at checkout.
// Prices are placeholders pending a per-talent pricing pass and legal sign-off.
export const TALENT_WARES: TalentWare[] = [
  {
    id: 'talent_title_golema_sigil',
    talentId: 'logan_golema',
    kind: 'title',
    name: 'Bearer of the Golema Sigil',
    description: 'A prestige title granted by the featured creator Logan Golema. Cosmetic only.',
    price: { usdc: 25, sol: 0.15, woc: 20000 },
    rarity: 'epic',
  },
  {
    id: 'talent_flair_golema_halo',
    talentId: 'logan_golema',
    kind: 'flair',
    name: 'Golema Halo',
    description: "A drifting nameplate halo in the featured creator's mark. Cosmetic only.",
    price: { usdc: 40, sol: 0.25, woc: 35000 },
    rarity: 'legendary',
  },
];

const TALENT_WARE_BY_ID: Record<string, TalentWare> = Object.fromEntries(
  TALENT_WARES.map((w) => [w.id, w]),
);

/** Resolve a talent ware by id, or undefined if it is not in the catalog. */
export function talentWare(id: string): TalentWare | undefined {
  return TALENT_WARE_BY_ID[id];
}

/** The wares a given talent owns (their storefront). */
export function talentWaresFor(talentId: string): TalentWare[] {
  return TALENT_WARES.filter((w) => w.talentId === talentId);
}
