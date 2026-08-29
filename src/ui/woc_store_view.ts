// Pure projection for the WOC Store weapon-cosmetic grid and the Season 1
// Armory. The economy service remains authoritative for availability, prices,
// balances, and grants; the Season 1 catalog (src/sim/content/weapon_skins.ts)
// supplies the skins themselves (model and rarity) and the apply rules
// decide which skins the player can attach right now. DOM-free and unit-tested.

import {
  eligibleClassesForWeaponSkinType,
  skinnableWeaponTypesFor,
} from '../sim/content/weapon_skin_rules';
import {
  WEAPON_SKIN_LIST,
  WEAPON_SKIN_RARITY_ORDER,
  type WeaponSkinCollection,
  type WeaponSkinDef,
  type WeaponSkinRarity,
} from '../sim/content/weapon_skins';
import type { PlayerClass, SkinCatalog, WeaponSkinType } from '../sim/types';
import type { AccountCosmetics } from '../world_api/cosmetics';

export interface WocStoreItemInput {
  itemId: string;
  name: string;
  /** Storage rows are the Strongbox charters: repeatable purchases that carry no
   *  ownership, so the charter path below ignores `owned` entirely. */
  kind: 'cosmetic' | 'skin' | 'item' | 'storage';
  costClaudium: number;
  owned: boolean;
}

// ── Season 1 Armory ─────────────────────────────────────────────────────────

export interface ArmorySkinRow {
  skin: WeaponSkinDef;
  /** Store card / inspect thumbnail (rarity-themed render). */
  art: string;
  /** Claudium cost from the economy service, or null when the SKU is unavailable. */
  costClaudium: number | null;
  /** The economy service has this SKU with a valid price, so Buy can succeed. */
  purchasable: boolean;
  owned: boolean;
  /** This exact skin is in the account loadout for its weapon type. */
  applied: boolean;
  /** A weapon of the skin's type is equipped right now, so Apply is possible. */
  canApplyNow: boolean;
  affordable: boolean;
  shortfall: number | null;
  /** Classes that can ever apply this skin (the card's face chips). */
  eligibleClasses: readonly PlayerClass[];
}

export interface ArmorySection {
  collection: WeaponSkinCollection;
  rarity: WeaponSkinRarity;
  rows: ArmorySkinRow[];
}

export interface ArmoryContext {
  cosmetics: Pick<AccountCosmetics, 'weaponSkinIds' | 'weaponSkinLoadout'>;
  cls: string;
  mainhandItemId: string | null;
  /** The body being worn: the Combat Mech shows the equipped mainhand, so it
   *  decides which skin types a hunter can apply (weapon_skin_rules). */
  skinCatalog: SkinCatalog;
}

/** The Armory thumbnail directory, exported so consumers reasoning about the
 *  FAMILY (the reliquary's opaque-art carve-out) share this one path instead
 *  of re-spelling it. These cards paint their own bright background with no
 *  alpha matte, unlike the dark-card item icon style. */
export const ARMORY_SKIN_ART_DIR = '/ui/store/armory';

export function armorySkinArt(skinId: string): string {
  return `${ARMORY_SKIN_ART_DIR}/${skinId}.webp`;
}

/** Season 1 Armory sections, highest rarity first (the hero collection leads).
 *  Every catalog skin always shows; a skin missing from the service snapshot
 *  renders unavailable with no price. Owned unions the service grant flag
 *  with the account mirror so a fresh purchase reflects immediately even
 *  before the next store fetch. */
export function buildArmorySections(
  balance: number | null,
  items: readonly WocStoreItemInput[],
  ctx: ArmoryContext,
): ArmorySection[] {
  const serviceRows = new Map(items.filter((i) => i.kind === 'skin').map((i) => [i.itemId, i]));
  const applicableTypes = new Set<WeaponSkinType>(
    skinnableWeaponTypesFor(ctx.cls, ctx.mainhandItemId, ctx.skinCatalog),
  );
  const sections = new Map<string, ArmorySection>();
  for (const skin of WEAPON_SKIN_LIST) {
    const service = serviceRows.get(skin.id);
    const owned = (service?.owned ?? false) || ctx.cosmetics.weaponSkinIds.includes(skin.id);
    const costClaudium =
      service && Number.isFinite(service.costClaudium) && service.costClaudium > 0
        ? service.costClaudium
        : null;
    const row: ArmorySkinRow = {
      skin,
      art: armorySkinArt(skin.id),
      costClaudium,
      purchasable: costClaudium !== null,
      owned,
      applied: owned && ctx.cosmetics.weaponSkinLoadout[skin.weaponType] === skin.id,
      canApplyNow: owned && applicableTypes.has(skin.weaponType),
      affordable: !owned && balance !== null && costClaudium !== null && balance >= costClaudium,
      shortfall:
        costClaudium === null || balance === null
          ? null
          : owned
            ? 0
            : Math.max(0, costClaudium - balance),
      eligibleClasses: eligibleClassesForWeaponSkinType(skin.weaponType),
    };
    let section = sections.get(skin.collection);
    if (!section) {
      section = { collection: skin.collection, rarity: skin.rarity, rows: [] };
      sections.set(skin.collection, section);
    }
    section.rows.push(row);
  }
  const rarityRank = (r: WeaponSkinRarity) => WEAPON_SKIN_RARITY_ORDER.indexOf(r);
  return [...sections.values()].sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity));
}
// ── Strongbox charters ──────────────────────────────────────────────────────
//
// The storage half of the WOC Store: Claudium charters that grant purchasable
// bank-ladder slots. Three rules separate this path from the Armory above,
// and every one of them is load-bearing.
//
// THE FIT GATE. A charter grants its FULL slot count or nothing. The server
// validates the whole grant against the ladder's purchasable ceiling before
// any money moves and never applies a partial grant, so a charter that would
// overshoot is OMITTED from the section entirely rather than shown disabled:
// a row the player can see is a row the server would accept. Never clamp a
// grant down to the remaining room; that would sell slots nobody asked for.
//
// `owned` IS IGNORED. A storage spend writes no grant row, so the economy
// service answers owned:false for every storage SKU forever, by construction.
// Charters are repeatable purchases. Reading `owned` here would be reading a
// flag that is structurally meaningless, and the armory ownership union is
// exactly the wrong thing to copy.
//
// `purchasedSlots` CAN STILL BE NULL, though it no longer means what it did.
// The caller reads the ALWAYS-available ladder read (IWorldBank
// bankPurchasedSlots), so "away from a bursar" stopped being a null case in
// Bank Storage phase 15; what is left is "no answer has arrived yet" (offline
// with no resolvable player, or online before the first snapshot lands). When
// the count is not observable the section runs NO fit gate and reports
// fitUnknown, so the caller can say so plainly instead of hiding charters or
// inventing a count. An empty rows list therefore means something different
// from fitUnknown, and different again from ladderFull.
//
// The slot counts, the ceiling, and the charter list are all INPUTS. This
// module holds no slot literal, derives no ceiling, and reads nothing from
// the sim; prices come only from the service rows, with no client-side
// arithmetic beyond the shortfall subtraction.

export interface CharterDef {
  /** Service catalog item id; also the registry key. */
  id: string;
  /** Slots the charter grants, always the FULL grant (never clamped). */
  grantSlots: number;
}

export interface CharterContext {
  /** Purchased ladder slots on the CURRENT character, or null when no count
   *  has arrived yet (no resolvable player offline, no snapshot yet online).
   *  null means no fit gating ran, and NEVER zero: a coerced zero would
   *  advertise the whole ladder as free room. */
  purchasedSlots: number | null;
  /** The ladder's purchasable slot ceiling. An INPUT: never derived here. */
  ceilingSlots: number;
  /** The charters on offer, in the order they should render. */
  charters: readonly CharterDef[];
  /** Grant sizes the SERVER has already refused as overshooting, this store
   *  visit and this character. Applied INDEPENDENTLY of the count-based gate, and
   *  kept ALONGSIDE it rather than replaced by it now that a count is available
   *  everywhere: it still covers the pre-first-snapshot window and any
   *  disagreement between this arithmetic and the server's verdict. A
   *  does_not_fit on grant G proves G does not fit, and every grant at or above
   *  G therefore does not fit either.
   *
   *  Carrying it forward is safe only while the count it was derived from holds.
   *  The count only ever grows for as long as one character stays RESIDENT
   *  server-side, which is narrower than a client session (src/sim/bank.ts names
   *  the two cases where a fresh join brings a lower one back). The CALLER owns
   *  that: src/ui/charter_fit_memory.ts drops these the moment it sees the count
   *  fall, because a stale refusal at a lower count hides a charter that fits. */
  refusedGrantSlots?: ReadonlySet<number>;
}

export interface CharterRow {
  itemId: string;
  grantSlots: number;
  costClaudium: number | null;
  purchasable: boolean;
  affordable: boolean;
  shortfall: number | null;
}

export interface CharterSection {
  rows: CharterRow[];
  /** True only when the count is KNOWN and the ladder is at or past the
   *  ceiling: nothing can ever fit. Distinct from an empty rows list caused
   *  by a missing service snapshot. */
  ladderFull: boolean;
  /** True when the fit gate could not run, so rows were NOT fit-gated. */
  fitUnknown: boolean;
  /** How many charters the two fit gates dropped (the count-gate overshoots
   *  plus the server-refused prune). The non-empty arm renders an explanatory
   *  line when it is > 0, and so does the empty fitUnknown arm (the refusal
   *  prune runs with the count gate off, so rows can vanish there too); the
   *  other empty arms already explain themselves. It must reach the returned
   *  markup (charterSectionHtml) so the store's markup-identity repaint
   *  elision sees the transition. */
  hiddenByFit: number;
}

/** The nothing-known-yet section (a fresh window, before any snapshot): no
 *  rows, fit unknown, nothing hidden. */
export function emptyCharterSection(): CharterSection {
  return { rows: [], ladderFull: false, fitUnknown: true, hiddenByFit: 0 };
}

/** Defensive coercion, stated once for both inputs: a count that is not a
 *  finite non-negative number, and a ceiling that is not a finite positive
 *  number, are each read as UNKNOWN rather than as zero. Coercing a bad count
 *  to zero would advertise every charter as fitting; coercing a bad ceiling
 *  to zero would hide all of them. Unknown is the honest answer, and the
 *  caller already has to handle it because the bank is banker-gated. */
function knownCount(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

function knownCeiling(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** The smallest server-refused grant, or null when there is none to act on.
 *  Non-finite and non-positive entries are DROPPED rather than trusted: a NaN
 *  would compare false against every grant and silently disable the whole
 *  suppression, and a zero or negative one would hide every charter. */
function smallestRefusedGrant(refused: ReadonlySet<number> | undefined): number | null {
  if (refused === undefined) return null;
  let smallest: number | null = null;
  for (const grant of refused) {
    if (!Number.isFinite(grant) || grant <= 0) continue;
    if (smallest === null || grant < smallest) smallest = grant;
  }
  return smallest;
}

/** The Strongbox charter section, in the caller's charter order. Every charter
 *  that fits gets a row, including one the service snapshot is missing (it
 *  renders unavailable with no price, the same as an armory skin). Charters
 *  are repeatable, so affordability carries no ownership term. */
export function buildCharterSection(
  balance: number | null,
  items: readonly WocStoreItemInput[],
  ctx: CharterContext,
): CharterSection {
  const serviceRows = new Map(items.filter((i) => i.kind === 'storage').map((i) => [i.itemId, i]));
  const purchased = knownCount(ctx.purchasedSlots);
  const ceiling = knownCeiling(ctx.ceilingSlots);
  const fitUnknown = purchased === null || ceiling === null;
  // The smallest grant the server has already refused. Every grant at or above
  // it overshoots too, so one refusal prunes the whole tail in one comparison
  // rather than needing a verdict per charter.
  const refusedFrom = smallestRefusedGrant(ctx.refusedGrantSlots);
  const rows: CharterRow[] = [];
  let hiddenByFit = 0;
  for (const charter of ctx.charters) {
    if (refusedFrom !== null && charter.grantSlots >= refusedFrom) {
      hiddenByFit += 1;
      continue;
    }
    if (purchased !== null && ceiling !== null && purchased + charter.grantSlots > ceiling) {
      hiddenByFit += 1;
      continue;
    }
    const service = serviceRows.get(charter.id);
    const costClaudium =
      service && Number.isFinite(service.costClaudium) && service.costClaudium > 0
        ? service.costClaudium
        : null;
    rows.push({
      itemId: charter.id,
      grantSlots: charter.grantSlots,
      costClaudium,
      purchasable: costClaudium !== null,
      affordable: balance !== null && costClaudium !== null && balance >= costClaudium,
      shortfall:
        costClaudium === null || balance === null ? null : Math.max(0, costClaudium - balance),
    });
  }
  return {
    rows,
    ladderFull: purchased !== null && ceiling !== null && purchased >= ceiling,
    fitUnknown,
    hiddenByFit,
  };
}
