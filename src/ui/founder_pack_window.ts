// The Founder Salesman's Founder Pack store (#founder-pack-window).
//
// Pure-core + thin-consumer split, the warfare_vendor_view/window pair's
// pattern: buildFounderPackView is DOM/i18n-free (driven directly by
// tests/founder_pack.test.ts); renderFounderPackWindow paints it and
// wires clicks back through the injected callbacks. The claim itself resolves
// server-side (the real $WOC balance check), so this window decides nothing
// about eligibility beyond what the account's own cosmetics state already
// answers (claimed tier, owned skins).
//
// Every skin row and mount chip carries a real icon (a 3D-rendered portrait
// chip for a skin, the reins item's icon for a mount) and, on click, opens
// the side preview panel (founder_pack_preview.ts) with a live model instead
// of just toggling the pick silently.

import {
  FOUNDER_PACK_TIERS,
  FOUNDER_SKIN_CATALOG,
  type FounderPackTier,
  type FounderPackTierDef,
  founderPackMountReinsItemId,
} from '../sim/content/founder_pack';
import type { MountKey } from '../sim/content/mounts';
import type { PlayerClass, SkinCatalog } from '../sim/types';
import type { AccountCosmetics } from '../world_api/cosmetics';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { hydratePortraits, portraitChipHtml } from './portrait_chip';
import { svgIcon } from './ui_icons';
import { knownItemIconHtml } from './unknown_item_icon';

export interface FounderPackTierRow {
  tier: FounderPackTier;
  def: FounderPackTierDef;
  /** This is the tier the account actually claimed. */
  claimed: boolean;
  /** A DIFFERENT tier is already claimed, or this one is: either way the
   *  whole-pack claim button is unavailable. */
  locked: boolean;
}

export interface FounderPackSkinRow {
  catalog: SkinCatalog;
  requiredClass: PlayerClass;
  owned: boolean;
  classMatches: boolean;
}

export interface FounderPackView {
  tiers: readonly FounderPackTierRow[];
  claimedTierDef: FounderPackTierDef | null;
  skinsOwned: number;
  skinsAllowed: number;
  skins: readonly FounderPackSkinRow[];
  mountOptions: readonly MountKey[];
}

/** Pure: derives the whole window's state from the account's own cosmetics
 *  record and the viewer's class. No wallet/balance data here: the balance
 *  gate is real and server-side, so this window never claims to know it. */
export function buildFounderPackView(
  cosmetics: AccountCosmetics,
  playerClass: PlayerClass,
  mountOptions: readonly MountKey[],
): FounderPackView {
  const claimedTier = cosmetics.founderPackTier ?? null;
  const claimedTierDef = claimedTier
    ? (FOUNDER_PACK_TIERS.find((def) => def.tier === claimedTier) ?? null)
    : null;
  const owned = cosmetics.founderSkinIds ?? [];
  return {
    tiers: FOUNDER_PACK_TIERS.map((def) => ({
      tier: def.tier,
      def,
      claimed: claimedTier === def.tier,
      locked: claimedTier !== null,
    })),
    claimedTierDef,
    skinsOwned: owned.length,
    skinsAllowed: claimedTierDef?.skinPicks ?? 0,
    skins: FOUNDER_SKIN_CATALOG.map((skin) => ({
      catalog: skin.catalog,
      requiredClass: skin.requiredClass,
      owned: owned.includes(skin.catalog),
      classMatches: skin.requiredClass === playerClass,
    })),
    mountOptions,
  };
}

export interface FounderPackWindowDeps {
  hideTooltip(): void;
  /** The mounts currently checked in the (tier-scoped) picker, kept on the
   *  coordinator so re-paints do not lose the in-progress selection. */
  selectedMounts: ReadonlySet<MountKey>;
  onToggleMount(key: MountKey): void;
  onClaimTier(tier: FounderPackTier): void;
  onClaimSkin(catalog: SkinCatalog): void;
  onClose(): void;
  /** Open the side preview panel on this mount's live turntable. */
  onPreviewMount(key: MountKey): void;
  /** Open the side preview panel on this skin worn by its own class. */
  onPreviewSkin(catalog: SkinCatalog): void;
}

const TIER_BG_CLASS: Record<FounderPackTier, string> = {
  uncommon: 'founder-tier-uncommon',
  rare: 'founder-tier-rare',
  epic: 'founder-tier-epic',
};

function tierTitleKey(tier: FounderPackTier): string {
  return tier === 'uncommon'
    ? 'hudChrome.founderShop.tierUncommon'
    : tier === 'rare'
      ? 'hudChrome.founderShop.tierRare'
      : 'hudChrome.founderShop.tierEpic';
}

function mountLabel(key: MountKey): string {
  return t(`hudChrome.mounts.name_${key}` as Parameters<typeof t>[0]);
}

/** A mount chip's icon: the same reins item icon the Reliquary and the bag
 *  show for this mount (reliquary_cell_art.ts's mount arm), so the chip never
 *  needs its own icon table. */
function mountIconHtml(key: MountKey): string {
  const reinsId = founderPackMountReinsItemId(key);
  return reinsId ? knownItemIconHtml({ id: reinsId }) : '';
}

function renderTierCard(row: FounderPackTierRow, deps: FounderPackWindowDeps): string {
  const { def } = row;
  const mountChips = FOUNDER_MOUNT_ORDER.map((key) => {
    const checked = deps.selectedMounts.has(key);
    const disabled = row.locked || row.claimed;
    return `<button type="button" class="founder-mount-chip${checked ? ' checked' : ''}" data-mount="${esc(key)}" data-tier="${esc(row.tier)}" ${disabled ? 'disabled' : ''} aria-pressed="${checked}">${mountIconHtml(key)}<span>${esc(mountLabel(key))}</span></button>`;
  }).join('');
  const mountLine =
    def.mountPicks === 1
      ? t('hudChrome.founderShop.mountPickOne')
      : t('hudChrome.founderShop.mountPicks', { count: String(def.mountPicks) });
  const claimDisabled = row.locked || deps.selectedMounts.size !== def.mountPicks;
  const claimLabel = row.claimed
    ? t('hudChrome.founderShop.claimedButton')
    : t('hudChrome.founderShop.claimButton');
  return `
    <div class="founder-tier-card ${TIER_BG_CLASS[row.tier]}" data-tier-card="${esc(row.tier)}">
      <h3 class="founder-tier-title">${esc(t(tierTitleKey(row.tier) as Parameters<typeof t>[0]))}</h3>
      <p class="founder-tier-line">${esc(t('hudChrome.founderShop.titleReward', { title: def.title }))}</p>
      <p class="founder-tier-line">${esc(mountLine)}</p>
      <div class="founder-mount-chips">${mountChips}</div>
      <p class="founder-tier-line">${esc(t('hudChrome.founderShop.petReward', { pet: bagPetName(def.bagItemId), slots: String(bagPetSlots(def.bagItemId)) }))}</p>
      <p class="founder-tier-line">${esc(t('hudChrome.founderShop.skinPicks', { claimed: '0', total: String(def.skinPicks) }))}</p>
      <p class="founder-tier-line">${esc(t('hudChrome.founderShop.claudiumReward', { amount: formatNumber(def.claudium, { maximumFractionDigits: 0 }) }))}</p>
      ${def.goldenAura ? `<p class="founder-tier-line">${esc(t('hudChrome.founderShop.goldenAuraReward'))}</p>` : ''}
      <p class="founder-tier-line founder-tier-wallet">${esc(t('hudChrome.founderShop.walletRequirement', { amount: formatNumber(def.wocThreshold, { maximumFractionDigits: 0 }) }))}</p>
      <button type="button" class="btn founder-claim-btn" data-claim-tier="${esc(row.tier)}" ${claimDisabled ? 'disabled' : ''}>${esc(claimLabel)}</button>
    </div>`;
}

const FOUNDER_MOUNT_ORDER: readonly MountKey[] = ['cinderjaw_rex', 'ancient_devourer', 'shiba_inu'];

// Bag-pet display names/slot counts mirror src/sim/content/items.ts exactly
// (founder_bag_phantom/triplet/emberfall_phoenix); kept local since the item
// defs carry no class restriction worth importing ITEMS for here.
function bagPetName(itemId: string): string {
  if (itemId === 'founder_bag_phantom') return 'Phantom';
  if (itemId === 'founder_bag_triplet') return 'TripleT';
  return 'Emberfall Phoenix';
}
function bagPetSlots(itemId: string): number {
  if (itemId === 'founder_bag_phantom') return 10;
  if (itemId === 'founder_bag_triplet') return 15;
  return 20;
}

function renderSkinRow(row: FounderPackSkinRow, budgetLeft: boolean): string {
  const disabled = row.owned || !row.classMatches || !budgetLeft;
  const label = row.owned
    ? t('hudChrome.founderShop.claimedButton')
    : t('hudChrome.founderShop.claimButton');
  const chip = portraitChipHtml({
    cls: row.requiredClass,
    catalog: row.catalog,
    name: row.catalog,
    variant: 'sm',
    framing: 'headshot',
  });
  return `<div class="founder-skin-row${row.owned ? ' owned' : ''}">
    <button type="button" class="founder-skin-preview" data-preview-skin="${esc(row.catalog)}" aria-label="${esc(t('hudChrome.founderShop.previewSkinAria', { skin: row.catalog }))}">
      ${chip}<span class="founder-skin-name">${esc(row.catalog)}</span>
    </button>
    <button type="button" class="btn founder-skin-claim" data-claim-skin="${esc(row.catalog)}" ${disabled ? 'disabled' : ''}>${esc(label)}</button>
  </div>`;
}

export function renderFounderPackWindow(
  el: HTMLElement,
  view: FounderPackView,
  deps: FounderPackWindowDeps,
): void {
  const title = t('hudChrome.founderShop.title');
  markDialogRoot(el, { label: title });
  const budgetLeft = view.skinsOwned < view.skinsAllowed;
  el.innerHTML = `
    <div class="panel-title"><span>${esc(title)}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.founderShop.close'))}">${svgIcon('close')}</button></div>
    <div class="founder-tier-grid">${view.tiers.map((row) => renderTierCard(row, deps)).join('')}</div>
    ${
      view.claimedTierDef
        ? `<div class="founder-skin-list">
            <p class="founder-tier-line">${esc(t('hudChrome.founderShop.skinPicks', { claimed: String(view.skinsOwned), total: String(view.skinsAllowed) }))}</p>
            ${view.skins.map((row) => renderSkinRow(row, budgetLeft)).join('')}
          </div>`
        : ''
    }
    <p class="founder-tradeable-note">${esc(t('hudChrome.founderShop.tradeableNote'))}</p>
  `;
  el.style.display = 'block';
  hydratePortraits(el);
  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.querySelectorAll<HTMLButtonElement>('[data-mount]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const key = chip.dataset.mount as MountKey;
      deps.onToggleMount(key);
      deps.onPreviewMount(key);
    });
  });
  el.querySelectorAll<HTMLButtonElement>('[data-claim-tier]').forEach((btn) => {
    btn.addEventListener('click', () => deps.onClaimTier(btn.dataset.claimTier as FounderPackTier));
  });
  el.querySelectorAll<HTMLButtonElement>('[data-claim-skin]').forEach((btn) => {
    btn.addEventListener('click', () => deps.onClaimSkin(btn.dataset.claimSkin as SkinCatalog));
  });
  el.querySelectorAll<HTMLButtonElement>('[data-preview-skin]').forEach((btn) => {
    btn.addEventListener('click', () => deps.onPreviewSkin(btn.dataset.previewSkin as SkinCatalog));
  });
}
