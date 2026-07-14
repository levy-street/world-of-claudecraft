// Thin DOM painter for the character window (the tabbed EQUIPMENT/OVERVIEW sheet).
//
// The consumer half of the pure-core + thin-painter split: it paints
// #char-window from the structured PaperdollView (char_view.ts) plus the
// HUD-supplied money/tooltip fragments, and wires the equip-slot unequip /
// drag / tooltip affordances. It owns no Sim reference and reaches into Hud
// only through its deps.
//
// SHELL (char-equipment redesign, docs/char-equipment/): the shared window
// frame carries the tab rail (EQUIPMENT default, OVERVIEW), the player's name
// as the title, the level/class + earned-title identity as a subtitle, and the
// token balances, coin purse, and Share action as a persistent titlebar utility
// lane in this character-local shell. The EQUIPMENT tab
// paints the full-screen radial-orbit equipment stage (helmet above the model,
// balanced 5-slot side rails, honest data: no Off Hand), the six right-column stat panels
// (Attributes/Combat/Defense/Progression/Specialization/Gathering, Phase 3),
// and the embedded bags section (Phase 4). OVERVIEW (Phase 5) carries the
// identity strip (portrait, name, archetype title, hobby craft), the talent/
// spec summary with a Change/Choose button, the milestones/prestige block, and
// player-card detail blocks: everything the pre-Phase-2 sheet showed that the
// Equipment tab does not. Share stays persistent in the titlebar on both tabs.
//
// Two regions stay HUD concerns and are triggered here through callbacks, never
// built in this module: the shared 3D turntable preview (the single WebGL preview
// is borrowed by the skin-event overlay and the player card, so its lifecycle
// stays HUD-owned) and the cosmetic skin picker (its async mech-asset loading +
// preview remounts live with the preview). The pure core stays paperdoll-only; no
// 3D types or RNG cross into it.
//
// Colors live in the extracted stylesheet: item rarity is a `data-quality`
// attribute the shared `.item-cell` AAA grammar borders (components.css), and
// the empty-slot greys are the two CSS tokens below, so no raw hex sits in
// this painter.

import { audio } from '../game/audio';
import type { GatheringProfessionId } from '../sim/content/professions';
import { talentsFor } from '../sim/content/talents';
import { ITEMS } from '../sim/data';
import type { EquipSlot, ItemDef } from '../sim/types';
import type { IWorld } from '../world_api';
import { type BagMode, bagItemAction } from './bags_view';
import { buildCharBags, type CharBagCell, type CharBagsModel } from './char_bags_view';
import {
  ATTRIBUTE_PANEL_STATS,
  buildProgressionPanel,
  buildSpecPanel,
  COMBAT_PANEL_STATS,
  DEFENSE_PANEL_STATS,
} from './char_panels_view';
import { buildPaperdollView, type PaperdollSlot } from './char_view';
import { markDialogRoot } from './dialog_root';
import { classDisplayName, itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { buildGatheringProficiencyRows } from './gathering_view';
import { formatMoney, formatNumber, moneyParts, type TranslationKey, t } from './i18n';
import { iconDataUrl } from './icons';
import type { PainterHostPresentation } from './painter_host';
import { hydratePortraits, portraitChipHtml } from './portrait_chip';
import { rovingTarget } from './roving_index';
import type { StatId } from './stat_tooltip';
import { tTalent } from './talent_i18n';
import { svgIcon, type UiIconName } from './ui_icons';

// Empty-slot / empty-socket greys as CSS custom properties (char_window.ts uses
// these so the painter carries no raw hex): the muted outside label and the
// dimmed placeholder-icon cell border. Exact pre-existing values.
const SLOT_EMPTY_TEXT_COLOR = 'var(--color-slot-empty-text)';
const SLOT_EMPTY_BORDER_COLOR = 'var(--color-slot-empty-border)';

// The ten craft-archetype title keys (issue 1130), one per craft id on the ring (see
// src/sim/content/professions.ts CRAFT_RING and src/sim/professions/archetype.ts
// getArchetypeTitle: the title identifier IS the craft id). Every player-visible
// string is a t() key, so this is a literal id-to-key table, never a built string.
// Painted in the OVERVIEW tab's identity strip (Phase 5); the two resolvers below
// are also exported for tests/char_window.test.ts's id-to-key coverage.
const ARCHETYPE_TITLE_KEYS: Record<string, TranslationKey> = {
  armorcrafting: 'hudChrome.archetypeTitle.armorcrafting',
  weaponcrafting: 'hudChrome.archetypeTitle.weaponcrafting',
  jewelcrafting: 'hudChrome.archetypeTitle.jewelcrafting',
  alchemy: 'hudChrome.archetypeTitle.alchemy',
  engineering: 'hudChrome.archetypeTitle.engineering',
  cooking: 'hudChrome.archetypeTitle.cooking',
  inscription: 'hudChrome.archetypeTitle.inscription',
  enchanting: 'hudChrome.archetypeTitle.enchanting',
  tailoring: 'hudChrome.archetypeTitle.tailoring',
  leatherworking: 'hudChrome.archetypeTitle.leatherworking',
};

/** Localized text for the granted archetype title, or the "no title yet" copy
 *  when the player has not completed the zone-1 acceptance quest (or the id is
 *  somehow unrecognized). Exported for the view-model test. */
export function archetypeTitleText(craftId: string | null): string {
  const key = craftId !== null ? ARCHETYPE_TITLE_KEYS[craftId] : undefined;
  return t(key ?? 'hudChrome.archetypeTitle.none');
}

/** Localized text for the hobby craft (issue 1294): the same per-craft name
 *  table as the archetype title (a hobby id IS a craft id on the ring), or
 *  the "no hobby yet" copy before an archetype has ever been chosen.
 *  Exported for the view-model test. */
export function hobbyCraftText(craftId: string | null): string {
  const key = craftId !== null ? ARCHETYPE_TITLE_KEYS[craftId] : undefined;
  return t(key ?? 'hudChrome.archetypeTitle.none');
}

/**
 * Hud-supplied glue. Composes the shared PainterHostPresentation bag
 * (icon/tooltip/money) and adds the character-sheet surface: world reads, the
 * localized slot name, the unequip + drag plumbing (the bags drop target
 * reads HUD's drag slot), focus capture for WCAG focus-return, and the two
 * HUD-owned render regions (3D preview + skin picker) invoked by callback.
 * Phase 3 (stat panels) consumes statCellHtml/statTooltipHtml directly, building
 * the Attributes/Combat/Defense/Progression/Specialization/Gathering panels off
 * the char_panels_view models; talentSummaryHtml/progressionHtml feed the
 * OVERVIEW tab (Phase 5): talentSummaryHtml is the talent/spec summary block,
 * and progressionHtml is now trimmed (hud.ts) to the milestones/prestige-action
 * content the Equipment tab's Progression panel does not already show.
 */
export interface CharWindowDeps extends PainterHostPresentation {
  root(): HTMLElement;
  world(): IWorld;
  /** Current on-chain $WOC balance, or null when no wallet balance is available. */
  wocBalance(): number | null;
  /** Whether the current $WOC balance belongs to the account-verified wallet. */
  wocBalanceVerified(): boolean;
  /** Account-wide Claudium balance. The current world seam does not expose one yet. */
  claudiumBalance(): number | null;
  closeOthers(): void;
  hideTooltip(): void;
  /** Consume the release click armed by a touch long-press tooltip peek. */
  consumePeek(): boolean;
  captureFocus(): HTMLElement | null;
  focusFirst(): void;
  restoreFocus(target: HTMLElement | null): void;
  slotName(slot: EquipSlot): string;
  /** `idNamespace` (per-panel) disambiguates the cell's aria-describedby id so
   *  a StatId shown in two panels at once does not collide (see stat_tooltip_view). */
  statCellHtml(stat: StatId, idNamespace?: string): string;
  statTooltipHtml(stat: StatId): string;
  talentSummaryHtml(): string;
  progressionHtml(level: number): string;
  /** Remove the equipped piece in `slot` to bags and repaint bags + the sheet. */
  unequip(slot: EquipSlot): void;
  /** Stage a drag-to-unequip: record the slot HUD-side and reveal the bags drop. */
  beginUnequipDrag(slot: EquipSlot): void;
  /** End a drag-to-unequip: clear the HUD slot and the bags drop-target hint. */
  endUnequipDrag(): void;
  /** Mount the shared 3D turntable into the model panel (HUD-owned lifecycle). */
  renderPreview(): void;
  /** Paint the cosmetic skin picker into the skin row (HUD-owned cosmetics). */
  renderSkinPicker(): void;
  openPlayerCard(): void;
  openPrestige(): void;
  /** Open the Book of Deeds (the active-title line's button). */
  openDeeds(): void;
  /** Open the Talents & Specializations window (the Specialization panel's
   *  Choose/Change button; the same toggle the talents keybind uses). */
  openTalents(): void;
  /** Open the standalone #bags window (the embedded bags header's "+"
   *  control, locked decision 8). */
  openBags(): void;
  /** The equip slot currently mid-drag-to-unequip (set by a paperdoll row's
   *  dragstart via beginUnequipDrag), or null when no drag is in progress.
   *  Lets the embedded bags grid become a SECOND drop target for the same
   *  drag, alongside the standalone #bags window (hud.ts's own drop wiring
   *  there is untouched). */
  dragUnequipSlot(): EquipSlot | null;
  /** Return the equipped bag in `socket` to the inventory from its owned-bag card. */
  unequipBag(socket: number): void;
  /** Repaint the standalone #bags window IF it is currently shown, so the two
   *  windows stay in sync when both are open and the player uses/equips an item
   *  from the embedded grid (the mirror of bags_window.ts's own
   *  renderCharIfOpen() on its 'use' branch). A no-op when #bags is hidden. */
  renderBagsIfOpen(): void;
}

// The embedded grid's click dispatch always runs bagItemAction in "default"
// mode: none of the standalone bags window's cross-window transactional
// flags (trade/mail/market/vendor/bank-deposit/pet-feed) ever apply inside
// the character window, so every click resolves to the SAME use/equipBag/
// discardQuest fallback the standalone window's plain (no-mode) click uses.
// This is what "click parity with the standalone window's default mode"
// means: the identical bagItemAction call, just always fed the all-off mode.
const BAGS_GRID_MODE: BagMode = {
  tradeOpen: false,
  mailAttach: false,
  marketSell: false,
  vendorOpen: false,
  bankDeposit: false,
  petFeed: false,
};

// Maps each gathering profession id to its hud_chrome display-name key (issue
// 1124), reused verbatim from the pre-Phase-2 gatheringHtml this panel restyles.
const GATHERING_PROFESSION_LABEL_KEY: Record<GatheringProfessionId, TranslationKey> = {
  mining: 'hudChrome.gathering.mining',
  logging: 'hudChrome.gathering.logging',
  herbalism: 'hudChrome.gathering.herbalism',
};

const GATHERING_PROFESSION_ICON: Record<GatheringProfessionId, UiIconName> = {
  mining: 'mining',
  logging: 'logging',
  herbalism: 'herbalism',
};

// release/v0.26 adds Warfare as the single player-facing PvP stat. Keep it in
// the redesigned Combat panel without reviving the retired offense/defense pair.
const CHARACTER_COMBAT_PANEL_STATS: readonly StatId[] = [...COMBAT_PANEL_STATS, 'warfare'];

// The persistent titlebar share-card glyph, reused verbatim from the
// pre-Phase-2 sheet's share row: a styled SVG glyph, not an in-game icon, so it
// is not a procedural icons.ts recipe.
const SHARE_GLYPH =
  '<svg class="pc-share-ico" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M18 16.1a3 3 0 0 0-2.3 1.1l-6.7-3.9a3 3 0 0 0 0-2.6l6.7-3.9A3 3 0 1 0 15 4l-6.7 3.9a3 3 0 1 0 0 8.2L15 20a3 3 0 1 0 3-3.9z"/></svg>';

type CharTab = 'equipment' | 'overview';

const COMPACT_LANDSCAPE_MIN_WIDTH = 720;
const COMPACT_LANDSCAPE_MAX_HEIGHT = 680;
const COMPACT_LANDSCAPE_MIN_ASPECT = 1.5;

// Geometry mode for a manually resized desktop character sheet. This is
// deliberately independent from body.mobile-touch: pointer capability controls
// input semantics across the HUD, while this helper controls only this window's
// presentation. Exported so the threshold contract stays unit-testable.
export function shouldUseCompactCharLandscape(width: number, height: number): boolean {
  return (
    width >= COMPACT_LANDSCAPE_MIN_WIDTH &&
    height > 0 &&
    height <= COMPACT_LANDSCAPE_MAX_HEIGHT &&
    width / height >= COMPACT_LANDSCAPE_MIN_ASPECT
  );
}

// v0.26 reverted the shared window_frame modules. Keep the redesigned character
// anatomy local to this painter and use the release branch's markDialogRoot
// contract on #char-window itself.
interface CharFrameParts {
  root: HTMLElement;
  body: HTMLElement;
  tabButtons: HTMLButtonElement[];
}

const CHAR_TAB_LABEL_KEYS: Record<CharTab, TranslationKey> = {
  equipment: 'hudChrome.character.tabs.equipment',
  overview: 'hudChrome.character.tabs.overview',
};

// Ornate redesign (docs/char-equipment/, mockup Round 1): a small glyph before
// each tab label (a bag for Equipment, a bust for Overview).
const CHAR_TAB_ICONS: Record<CharTab, UiIconName> = {
  equipment: 'bags',
  overview: 'character',
};

// Full-screen orbiting redesign (docs/char-equipment/), arc refinement round:
// the DATA-DRIVEN anchor map placing each real equip slot at a percentage
// position around the character niche, replacing the old flanking-column
// paperdoll grid. One anchor entry per array INDEX in PAPERDOLL_LEFT_SLOTS /
// PAPERDOLL_RIGHT_SLOTS (char_view.ts), so the side arrays stay the single
// source of truth for "which slots exist on which side" and this table stays
// purely positional. `x` is the percentage inset from the STAGE's left edge
// (left side) or right edge (right side); `y` is the percentage from the
// top, in both cases the coordinate of the anchored cell's CENTER (the CSS
// below centers each cell on its anchor via a side-aware transform).
//
// Desktop and mobile both show a clean 5-left / 5-right presentation, with the
// helmet in a dedicated top-center crown. The desktop sides share one mirrored
// arch profile: the first two rows step outward with the rounded stone crown,
// then the final three rows settle into a straight rail beside the vertical
// stonework. This follows the niche instead of bowing the middle icons far away
// and pulling the bottom row back inward. The right side has 5 real slots (no
// Off Hand: honest data, no fake slot), so both sides use identical coordinates.
interface OrbitAnchor {
  x: number;
  y: number;
}

// Percentage insets measured from each side of the stage. The 25 -> 21 -> 20
// shoulder echoes the rounded crown, then settles into a straight outer rail.
// The rail deliberately stays clear of the 48%-wide stone niche so equipment
// surrounds the arch instead of sitting on top of it. Percentages keep that
// negative space proportional while orbitInset() supplies the narrow-width floor.
const ORBIT_X_INSETS = [25, 21, 20, 20, 20] as const;
const ORBIT_ROWS = ORBIT_X_INSETS.length;
// Use almost the full arch height and keep a consistent vertical rhythm. The
// bottom pair can sit level with the appearance selector because the separated
// outer rails leave ample horizontal clearance on both sides.
const ORBIT_Y_POSITIONS = [9, 29.25, 49.5, 69.75, 90] as const;

function orbitRow(row: number): OrbitAnchor {
  return {
    x: ORBIT_X_INSETS[row] ?? ORBIT_X_INSETS[4],
    y: ORBIT_Y_POSITIONS[row] ?? ORBIT_Y_POSITIONS[4],
  };
}
const ORBIT_ARC: readonly OrbitAnchor[] = Array.from({ length: ORBIT_ROWS }, (_, i) => orbitRow(i));

// Desktop-only visual arrangement: Neck takes the first upper-left row,
// mirrored by Shoulder on the right, and Main Hand sits on the second row.
// This leaves five deliberate anchors on both sides. The CSS anchors the
// CELL rather than the label+cell pair, so label length can no longer bend the
// mathematical curve out of proportion. Mobile ignores these overrides and
// retains the established five-left / five-right source order.
const DESKTOP_ORBIT_OVERRIDES: Partial<Record<EquipSlot, OrbitAnchor>> = {
  neck: ORBIT_ARC[0],
  mainhand: ORBIT_ARC[1],
  shoulder: ORBIT_ARC[0],
};

// Each icon cell is centered ON its anchor point; its label is absolutely
// positioned outside the cell by CSS and does not distort that coordinate.
// `orbitInset` still guarantees a minimum pixel clearance for the framed cell
// when the character window is resized narrower, while tracking the percentage
// at normal desktop widths. Vertical coordinates remain simple percentages.
const ORBIT_EDGE_CLEARANCE = 60;
function orbitInset(percent: number): string {
  return `clamp(${ORBIT_EDGE_CLEARANCE}px, ${percent}%, calc(100% - ${ORBIT_EDGE_CLEARANCE}px))`;
}
const LEFT_ANCHORS: readonly OrbitAnchor[] = ORBIT_ARC;
const RIGHT_ANCHORS: readonly OrbitAnchor[] = ORBIT_ARC;

// Empty-slot silhouette glyphs (ornate redesign Round 2): one per equip slot,
// shown via ui_icons.ts's svgIcon instead of the old generic procedural
// `slot_empty` icon, so an empty cell clearly reads as "a helmet goes here"
// per the mockup rather than a blank placeholder square. Both rings share one
// glyph; inventory containers live in the Bags panel and are not EquipSlots.
const SLOT_EMPTY_ICON: Record<EquipSlot, UiIconName> = {
  helmet: 'slotHelmet',
  neck: 'slotNeck',
  shoulder: 'slotShoulder',
  chest: 'slotChest',
  gloves: 'slotGloves',
  mainhand: 'slotMainhand',
  waist: 'slotWaist',
  legs: 'slotLegs',
  feet: 'slotFeet',
  ring1: 'slotRing',
  ring2: 'slotRing',
};

// Ornate redesign (Round 2): the mockup's titlebar coin display always shows
// THREE denominations (gold/silver/copper), even a zero one, e.g. "Level 2
// Rogue" reads "1g 59s 0c" rather than dropping the copper coin. The shared
// hud.ts moneyHtml collapses a zero gold/silver denomination for every OTHER
// consumer (loot toasts, quest rewards, the bags footer, mail postage), where
// that compact read is correct and must not change; rippling the collapse
// change into moneyHtml would restyle every one of those screens, not just
// this window (the round's own stopping rule). This is a char-window-local
// twin instead, built from the exact same primitives (moneyParts/formatMoney/
// formatNumber/esc/t) and the exact same coin-part/coin/coin-amount/
// visually-hidden classes hud.ts's moneyHtml uses, so it renders identically
// styled, just never collapses. No fake amounts: a 0-copper character
// legitimately shows "0" on all three coins.
function charMoneyHtml(copper: number): string {
  const parts = moneyParts(copper);
  const coin = (value: number, cls: 'g' | 's' | 'c', unitKey: TranslationKey): string =>
    `<span class="coin-part"><span class="coin-amount">${esc(formatNumber(value, { maximumFractionDigits: 0 }))}</span><span class="coin ${cls}" aria-hidden="true"></span><span class="visually-hidden">${esc(t(unitKey))}</span></span>`;
  const html =
    coin(parts.gold, 'g', 'itemUi.money.gold') +
    coin(parts.silver, 's', 'itemUi.money.silver') +
    coin(parts.copper, 'c', 'itemUi.money.copper');
  return `<span class="money-inline" aria-label="${esc(formatMoney(copper, 'long'))}">${html}</span>`;
}

export class CharWindow {
  private openerFocus: HTMLElement | null = null;
  private activeTab: CharTab = 'equipment';
  private compactLandscape = false;
  private layoutObserver: ResizeObserver | null = null;
  // The embedded bags section's selected container (Phase 4), session-local
  // on this window, default the backpack; buildCharBags resolves a stale id
  // back to the backpack, and render() keeps this field in sync with that
  // resolution so the selector's active state always matches reality.
  private selectedBagContainer = 'backpack';
  // Session-local visibility preference for the embedded inventory. Empty
  // sockets are useful while arranging items, but can be collapsed into one
  // honest count when the player wants a compact inventory scan.
  private showEmptyBagSlots = true;

  constructor(private readonly deps: CharWindowDeps) {}

  private ensureLayoutObserver(el: HTMLElement): void {
    if (this.layoutObserver || typeof ResizeObserver === 'undefined') return;
    this.layoutObserver = new ResizeObserver(() => this.syncCompactLayout(el));
    this.layoutObserver.observe(el);
  }

  private syncCompactLayout(el: HTMLElement): void {
    const width = el.clientWidth;
    const height = el.clientHeight;
    // display:none reports a zero box. Preserve the last real mode while the
    // sheet is closed so reopening never flashes through a false transition.
    if (width <= 0 || height <= 0) return;
    const next = shouldUseCompactCharLandscape(width, height);
    if (next === this.compactLandscape) return;
    this.compactLandscape = next;
    el.classList.toggle('is-compact-landscape', next);
    // The compact inventory moves Empty spaces into the header. Repaint only
    // when the mode crosses its threshold; ordinary resizes stay CSS-only.
    if (this.isOpen) this.render();
  }

  /** Stamp the character-local shell once, then repaint only its live regions. */
  private ensureFrame(el: HTMLElement): CharFrameParts {
    this.ensureLayoutObserver(el);
    const mounted = el.querySelector<HTMLElement>(':scope > .char-window-frame');
    const body = mounted?.querySelector<HTMLElement>('.window-body');
    if (mounted && body) {
      const tabButtons = Array.from(
        mounted.querySelectorAll<HTMLButtonElement>('[data-window-tab]'),
      );
      return { root: mounted, body, tabButtons };
    }
    const mount = document.createElement('div');
    mount.className = 'char-window-frame';
    const tabHtml = (tab: CharTab): string =>
      `<button type="button" class="tab" role="tab" id="char-window-tab-${tab}" ` +
      `data-window-tab="${tab}" data-panel-id="char-window-panel-${tab}">` +
      `${esc(t(CHAR_TAB_LABEL_KEYS[tab]))}${svgIcon(CHAR_TAB_ICONS[tab], { cls: 'tab-icon' })}</button>`;
    mount.innerHTML =
      `<div class="panel-title window-titlebar">` +
      `<div class="window-title-col" id="char-window-title-col">` +
      `<span class="char-title-text window-title" id="char-title">${esc(t('hud.keybinds.actions.char'))}</span>` +
      `<span class="window-subtitle" id="char-window-subtitle"></span></div>` +
      `<div class="window-accessory" id="char-window-accessory"></div>` +
      `<button type="button" class="x-btn window-close" id="char-window-close" data-window-close ` +
      `aria-label="${esc(t('hud.options.returnToGame'))}">${svgIcon('close')}</button></div>` +
      `<div class="tab-rail" role="tablist" aria-labelledby="char-title" id="char-window-tabs">` +
      `${tabHtml('equipment')}${tabHtml('overview')}</div>` +
      `<div class="window-body char-window-body" role="tabpanel"></div>`;
    el.replaceChildren(mount);
    mount.querySelector('[data-window-close]')?.addEventListener('click', () => this.close());
    const mountedBody = mount.querySelector<HTMLElement>('.window-body') as HTMLElement;
    const tabButtons = Array.from(mount.querySelectorAll<HTMLButtonElement>('[data-window-tab]'));
    for (const btn of tabButtons) {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.windowTab === 'overview' ? 'overview' : 'equipment';
        this.render();
      });
    }
    this.wireTabRoving(tabButtons);
    return { root: mount, body: mountedBody, tabButtons };
  }

  private applyActiveTab(tabButtons: readonly HTMLButtonElement[], body: HTMLElement): void {
    for (const btn of tabButtons) {
      const selected = btn.dataset.windowTab === this.activeTab;
      btn.setAttribute('aria-selected', String(selected));
      btn.tabIndex = selected ? 0 : -1;
      if (!selected) {
        btn.removeAttribute('aria-controls');
        continue;
      }
      const panelId = btn.dataset.panelId ?? `char-window-panel-${this.activeTab}`;
      btn.setAttribute('aria-controls', panelId);
      body.id = panelId;
      body.setAttribute('aria-labelledby', btn.id);
    }
  }

  // Roving Arrow/Home/End across the character-local tab rail.
  private wireTabRoving(tabButtons: HTMLButtonElement[]): void {
    tabButtons.forEach((tab, i) => {
      tab.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        const next = rovingTarget(ke.key, i, tabButtons.length, 'horizontal');
        if (next !== null) {
          ke.preventDefault();
          const target = tabButtons[next];
          if (target && target !== tab) {
            target.click();
            target.focus();
          }
          return;
        }
        if (ke.key === 'Enter' || ke.key === ' ') {
          ke.preventDefault();
          tab.click();
          tab.focus();
        }
      });
    });
  }

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    const el = this.deps.root();
    this.openerFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    this.render();
    el.style.display = 'block';
    this.syncCompactLayout(el);
    this.deps.focusFirst();
  }

  close(): void {
    const el = this.deps.root();
    if (el.style.display !== 'block') return;
    el.style.display = 'none';
    this.deps.hideTooltip();
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  renderIfOpen(): void {
    if (this.isOpen) this.render();
  }

  render(): void {
    const el = this.deps.root();
    const world = this.deps.world();
    const p = world.player;

    const { root: frame, body, tabButtons } = this.ensureFrame(el);
    markDialogRoot(el, { labelledBy: 'char-title' });
    const subtitle = frame.querySelector<HTMLElement>('.window-subtitle');
    if (subtitle) subtitle.innerHTML = this.subtitleHtml(world);
    const accessory = frame.querySelector<HTMLElement>('.window-accessory');
    if (accessory) accessory.innerHTML = this.headerAccessoryHtml(world);
    const close = frame.querySelector<HTMLElement>('[data-window-close]');
    close?.setAttribute('aria-label', t('hud.options.returnToGame'));
    for (const btn of tabButtons) {
      const tab = btn.dataset.windowTab === 'overview' ? 'overview' : 'equipment';
      btn.innerHTML = `${esc(t(CHAR_TAB_LABEL_KEYS[tab]))}${svgIcon(CHAR_TAB_ICONS[tab], { cls: 'tab-icon' })}`;
    }
    this.applyActiveTab(tabButtons, body);

    // The dialog's real title is the player's live name.
    const titleEl = frame.querySelector<HTMLElement>('.window-title');
    if (titleEl) titleEl.textContent = p.name;
    frame.querySelector('[data-act="share-card"]')?.addEventListener('click', () => {
      audio.click();
      this.deps.openPlayerCard();
    });

    // Mobile landscape header (docs/char-equipment/, mobile-landscape-brief):
    // a small portrait chip beside the name/level-class column, reusing the
    // exact identity-strip chip markup. Rendered unconditionally (cheap: one
    // small HTML string) and hidden by CSS on desktop (components.css/
    // hud.mobile.css), so no host branching lives here; hydratePortraits
    // upgrades the placeholder the same way the Overview tab's identity strip
    // already does.
    const titleCol = frame.querySelector<HTMLElement>('.window-title-col');
    if (titleCol) {
      let chip = titleCol.querySelector<HTMLElement>('.char-header-chip');
      if (!chip) {
        chip = document.createElement('span');
        chip.className = 'char-header-chip';
        titleCol.prepend(chip);
      }
      chip.innerHTML = portraitChipHtml({
        cls: world.cfg.playerClass,
        skin: p.skin ?? 0,
        name: p.name,
        variant: 'sm',
        badge: false,
      });
      hydratePortraits(chip);
    }

    body.innerHTML =
      this.activeTab === 'equipment' ? this.equipmentTabHtml() : this.overviewTabHtml(world);
    if (this.activeTab !== 'equipment') {
      this.wireOverviewTab(body);
      return;
    }

    const view = buildPaperdollView(world.equipment, ITEMS);
    body.querySelector('#equip-top-center')?.appendChild(this.buildSlotRow(view.top, 'top'));
    const leftCol = body.querySelector('#equip-col-left');
    for (let i = 0; i < view.left.length; i++) {
      leftCol?.appendChild(this.buildSlotRow(view.left[i], 'left', LEFT_ANCHORS[i]));
    }
    const rightCol = body.querySelector('#equip-col-right');
    for (let i = 0; i < view.right.length; i++) {
      rightCol?.appendChild(this.buildSlotRow(view.right[i], 'right', RIGHT_ANCHORS[i]));
    }

    const panels = body.querySelector<HTMLElement>('#char-panels');
    if (panels) {
      panels.innerHTML = this.panelsHtml(world);
      // Lazy stat tooltips: resolved on show so the breakdown reflects the
      // player's current stats at hover time, not at render time (same
      // pattern the pre-Phase-2 flat stat grid used).
      for (const cell of panels.querySelectorAll<HTMLElement>('[data-stat]')) {
        const stat = cell.dataset.stat as StatId;
        this.deps.attachTooltip(cell, () => this.deps.statTooltipHtml(stat));
      }
      panels
        .querySelector('[data-act="open-talents"]')
        ?.addEventListener('click', () => this.deps.openTalents());
      panels
        .querySelector('[data-act="prestige"]')
        ?.addEventListener('click', () => this.deps.openPrestige());
      panels.querySelector('[data-act="open-deeds"]')?.addEventListener('click', () => {
        audio.click();
        this.deps.openDeeds();
      });
    }

    this.renderBagsSection(body, world);

    this.deps.renderPreview();
    this.deps.renderSkinPicker();
  }

  // Phase 4: the embedded BAGS section (header + container selector + grid),
  // built from the pure char_bags_view core off the same world reads the
  // standalone bags window uses (inventory/bags/bagCapacity).
  private renderBagsSection(body: HTMLElement, world: IWorld): void {
    const mount = body.querySelector<HTMLElement>('#char-bags');
    if (!mount) return;
    const model = buildCharBags({
      inventory: world.inventory,
      bags: world.bags,
      items: ITEMS,
      selectedId: this.selectedBagContainer,
    });
    // A stale selection resolves to the backpack inside the core; keep this
    // field in sync with that resolution so the NEXT render (and the
    // selector's active state right now) reflects the real choice, not the
    // stale id that was asked for.
    this.selectedBagContainer = model.selected.id;
    const compactLayout = document.body.classList.contains('mobile-touch') || this.compactLandscape;

    mount.replaceChildren(
      this.buildBagsHeader(body, model, compactLayout),
      this.buildBagsControls(body, model, world.bags, compactLayout),
      this.buildBagsGrid(model),
    );
  }

  // Header row: bags icon + title and used/total counter. Desktop retains the
  // "+" open-full-window action; touch uses that scarce header position for
  // the compact Empty spaces toggle so inventory cells get the vertical room.
  private buildBagsHeader(
    body: HTMLElement,
    model: CharBagsModel,
    compactLayout: boolean,
  ): HTMLElement {
    const header = document.createElement('div');
    header.className = 'char-bags-header';
    const title = document.createElement('div');
    title.className = 'char-bags-title';
    title.innerHTML = svgIcon('bags');
    const label = document.createElement('span');
    // Reuse the standalone bags window's own title key (already translated in
    // every locale), never a duplicate hudChrome.character.bags.title.
    label.textContent = t('itemUi.bags.title');
    title.appendChild(label);
    const counter = document.createElement('span');
    counter.className = 'char-bags-counter';
    counter.textContent = t('hudChrome.character.bags.counter', {
      used: formatNumber(model.used, { maximumFractionDigits: 0 }),
      total: formatNumber(model.selected.capacity, {
        maximumFractionDigits: 0,
      }),
    });
    header.append(title, counter);
    if (compactLayout) {
      header.appendChild(this.buildEmptySpacesToggle(body, true));
    } else {
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'icon-btn char-bags-open';
      // The mockup shows a gold "+" here; the action is unchanged (opens the
      // standalone #bags window, locked decision 8), only the glyph reads as
      // an ornate plus rather than the generic ellipsis `more` used elsewhere.
      openBtn.innerHTML = svgIcon('plus');
      openBtn.setAttribute('aria-label', t('hudChrome.character.bags.openFull'));
      openBtn.addEventListener('click', () => this.deps.openBags());
      header.appendChild(openBtn);
    }
    return header;
  }

  // The upper inventory shelf: owned-bag icon tabs plus the desktop's labeled
  // Empty spaces checkbox. Touch moves that checkbox into the header instead,
  // so this row contains only owned bags and leaves more room for inventory.
  private buildBagsControls(
    body: HTMLElement,
    model: CharBagsModel,
    equippedBags: readonly (string | null)[],
    compactLayout: boolean,
  ): HTMLElement {
    const controls = document.createElement('div');
    controls.className = 'char-bags-controls';
    controls.append(this.buildBagsSelector(model, equippedBags));
    if (!compactLayout) controls.append(this.buildEmptySpacesToggle(body));
    return controls;
  }

  // One visual bag card per container the player actually owns: the implicit
  // backpack followed by equipped bag items. Equipped bags also get a separate
  // corner remove control, keeping bag management in this shelf after the
  // redundant paperdoll socket strip was removed.
  private buildBagsSelector(
    model: CharBagsModel,
    equippedBags: readonly (string | null)[],
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'char-bags-selector';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', t('itemUi.bags.title'));
    for (const container of model.containers) {
      const card = document.createElement('div');
      card.className = 'char-bags-tab-wrap';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'char-bags-tab';
      btn.dataset.bagContainer = container.id;
      const active = container.id === model.selected.id;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
      const itemId = container.socket === null ? null : equippedBags[container.socket];
      const item = itemId ? (ITEMS[itemId] ?? null) : null;
      const displayName =
        container.socket === null
          ? t('hudChrome.bags.backpack')
          : item
            ? itemDisplayName(item)
            : '';
      const capacity = t('itemUi.tooltip.bagSlots', {
        slots: formatNumber(container.capacity, { maximumFractionDigits: 0 }),
      });

      const icon = document.createElement('span');
      icon.className = 'char-bags-tab-icon';
      icon.innerHTML =
        container.socket === null
          ? `<img class="item-icon q-common" src="${iconDataUrl('item', 'backpack')}" alt="" draggable="false">`
          : item
            ? this.deps.itemIcon(item)
            : svgIcon('bags');
      const ordinal = document.createElement('span');
      ordinal.className = 'char-bags-tab-ordinal';
      ordinal.setAttribute('aria-hidden', 'true');
      ordinal.textContent = container.label;
      icon.appendChild(ordinal);

      const copy = document.createElement('span');
      copy.className = 'char-bags-tab-copy';
      const name = document.createElement('span');
      name.className = 'char-bags-tab-name';
      name.textContent = displayName;
      const meta = document.createElement('span');
      meta.className = 'char-bags-tab-meta';
      meta.textContent = capacity;
      copy.append(name, meta);
      btn.append(icon, copy);
      btn.setAttribute('aria-label', `${displayName}, ${capacity}`);
      if (item) this.deps.attachTooltip(btn, () => this.deps.itemTooltip(item));
      btn.addEventListener('click', () => {
        if (this.selectedBagContainer === container.id) return;
        this.selectedBagContainer = container.id;
        this.render();
        const rebuilt = this.deps
          .root()
          .querySelector<HTMLElement>(`[data-bag-container="${container.id}"]`);
        this.deps.restoreFocus(rebuilt);
      });
      card.appendChild(btn);
      if (item && container.socket !== null) {
        const socket = container.socket;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'char-bags-tab-remove';
        remove.textContent = '×';
        remove.title = t('hudChrome.bags.unequipHint');
        remove.setAttribute(
          'aria-label',
          t('hudChrome.paperdoll.unequipAria', { item: displayName }),
        );
        remove.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (this.deps.consumePeek()) {
            this.deps.hideTooltip();
            return;
          }
          if (this.selectedBagContainer === container.id) {
            this.selectedBagContainer = 'backpack';
          }
          this.deps.hideTooltip();
          this.deps.unequipBag(socket);
        });
        btn.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          if (this.isTouchContextMenu(ev)) return;
          if (this.selectedBagContainer === container.id) {
            this.selectedBagContainer = 'backpack';
          }
          this.deps.hideTooltip();
          this.deps.unequipBag(socket);
        });
        card.appendChild(remove);
      }
      row.appendChild(card);
    }
    return row;
  }

  private buildEmptySpacesToggle(body: HTMLElement, compact = false): HTMLElement {
    const label = document.createElement('label');
    label.className = 'char-bags-empty-toggle';
    label.classList.toggle('is-compact', compact);
    const emptySpacesLabel = t('hudChrome.character.bags.emptySpaces');
    label.title = emptySpacesLabel;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'char-bags-empty-input';
    input.checked = this.showEmptyBagSlots;
    input.setAttribute('aria-controls', 'char-bags-slot-grid');
    input.setAttribute('aria-label', emptySpacesLabel);
    const mark = document.createElement('span');
    mark.className = 'char-bags-empty-mark';
    mark.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'char-bags-empty-label';
    text.textContent = emptySpacesLabel;
    input.addEventListener('change', () => {
      this.showEmptyBagSlots = input.checked;
      this.deps.hideTooltip();
      this.renderBagsSection(body, this.deps.world());
      body.querySelector<HTMLInputElement>('.char-bags-empty-input')?.focus();
    });
    label.append(input, mark, text);
    return label;
  }

  // The selected container's slot grid: an .item-cell button per occupied
  // slot (shared AAA rarity-border grammar), a decorative .is-empty cell per
  // free slot. Also the SECOND drop target for the paperdoll's
  // drag-to-unequip flow: extends, never replaces, hud.ts's own #bags
  // dragover/dragleave/drop wiring.
  private buildBagsGrid(model: CharBagsModel): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'char-bags-grid';
    grid.id = 'char-bags-slot-grid';
    grid.classList.toggle('is-empty-collapsed', !this.showEmptyBagSlots);
    const emptyCount = model.cells.filter((cell) => cell.item === null).length;
    const visibleCells = this.showEmptyBagSlots
      ? model.cells
      : model.cells.filter((cell) => cell.item !== null);
    for (const cell of visibleCells) grid.appendChild(this.buildBagCell(cell));
    if (!this.showEmptyBagSlots && emptyCount > 0) {
      const summary = document.createElement('div');
      summary.className = 'char-bags-empty-summary';
      summary.setAttribute('role', 'status');
      summary.textContent = t('hudChrome.character.bags.emptySummary', {
        count: formatNumber(emptyCount, { maximumFractionDigits: 0 }),
      });
      grid.appendChild(summary);
    }
    grid.addEventListener('dragover', (e) => {
      if (this.deps.dragUnequipSlot() === null) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      grid.classList.add('drop-target');
    });
    grid.addEventListener('dragleave', (e) => {
      if (e.target === grid) grid.classList.remove('drop-target');
    });
    grid.addEventListener('drop', (e) => {
      const slot = this.deps.dragUnequipSlot();
      if (slot === null) return;
      e.preventDefault();
      grid.classList.remove('drop-target');
      this.deps.unequip(slot);
      this.deps.endUnequipDrag();
    });
    return grid;
  }

  private buildBagCell(cell: CharBagCell): HTMLElement {
    const { item } = cell;
    if (!item) {
      const empty = document.createElement('div');
      empty.className = 'item-cell is-empty';
      empty.setAttribute('aria-hidden', 'true');
      return empty;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'item-cell';
    btn.setAttribute('data-quality', item.quality ?? 'common');
    btn.innerHTML = this.deps.itemIcon(item);
    if (cell.count > 1) {
      const count = document.createElement('span');
      count.className = 'item-cell-count';
      count.textContent = t('itemUi.bags.stackCount', {
        count: formatNumber(cell.count, { maximumFractionDigits: 0 }),
      });
      btn.appendChild(count);
    }
    btn.setAttribute(
      'aria-label',
      t('itemUi.bags.itemAria', {
        item: itemDisplayName(item),
        count: formatNumber(cell.count, { maximumFractionDigits: 0 }),
      }),
    );
    btn.addEventListener('click', () => {
      if (this.deps.consumePeek()) {
        this.deps.hideTooltip();
        return;
      }
      this.bagCellAction(item);
    });
    this.deps.attachTooltip(btn, () => this.deps.itemTooltip(item));
    return btn;
  }

  // Click semantics IDENTICAL to the standalone bags window's DEFAULT mode:
  // the same bagItemAction (bags_view.ts) call, fed the all-off BAGS_GRID_MODE.
  // That leaves exactly three reachable outcomes: 'use' and 'equipBag'
  // dispatch through the SAME world methods the standalone window calls
  // (useItem/equipBag); 'discardQuest' (a quest item's plain-click fallback)
  // is a deliberate no-op here, the destroy-quantity prompt stays a standalone
  // -window-only affordance this phase does not duplicate.
  private bagCellAction(item: ItemDef): void {
    const action = bagItemAction(item, BAGS_GRID_MODE);
    switch (action) {
      case 'equipBag':
        this.deps.world().equipBag(item.id);
        this.deps.hideTooltip();
        this.render();
        // Keep an open standalone #bags window fresh (it does not auto-repaint
        // on a local action from this window): the mirror of bags_window.ts
        // calling renderCharIfOpen() on its own 'use' branch.
        this.deps.renderBagsIfOpen();
        return;
      case 'use':
        this.deps.world().useItem(item.id);
        this.render();
        this.deps.renderBagsIfOpen();
        return;
      default:
        return;
    }
  }

  private subtitleHtml(world: IWorld): string {
    const p = world.player;
    const className = classDisplayName(world.cfg.playerClass);
    const level = formatNumber(p.level, { maximumFractionDigits: 0 });
    const levelClass = esc(t('itemUi.equipment.levelClass', { level, className }));
    const earnedTitle =
      world.archetypeTitle === null
        ? ''
        : `<span class="char-earned-title">${esc(archetypeTitleText(world.archetypeTitle))}</span>`;
    return `<span class="char-level-class">${levelClass}</span>${earnedTitle}`;
  }

  private headerAccessoryHtml(world: IWorld): string {
    const balanceChip = (
      kind: 'woc' | 'claudium',
      labelKey: 'hudChrome.character.balances.woc' | 'hudChrome.character.balances.claudium',
      balance: number | null,
      verified = false,
    ): string => {
      const normalizedBalance =
        typeof balance === 'number' && Number.isFinite(balance) ? balance : null;
      const value =
        normalizedBalance === null
          ? '--'
          : formatNumber(normalizedBalance, {
              maximumFractionDigits: 2,
              minimumFractionDigits: 0,
            });
      const stateClass =
        normalizedBalance === null ? ' is-unavailable' : verified ? ' is-verified' : ' is-preview';
      const label = t(labelKey);
      return (
        `<span class="char-balance-chip char-balance-${kind}${stateClass}" title="${esc(`${label}: ${value}`)}">` +
        `<span class="char-balance-icon" aria-hidden="true"></span>` +
        `<span class="char-balance-label">${esc(label)}</span><b>${esc(value)}</b></span>`
      );
    };
    const shareLabel = t('playerCard.shareButton');
    return (
      `<span class="char-header-balances">` +
      balanceChip(
        'woc',
        'hudChrome.character.balances.woc',
        this.deps.wocBalance(),
        this.deps.wocBalanceVerified(),
      ) +
      balanceChip(
        'claudium',
        'hudChrome.character.balances.claudium',
        this.deps.claudiumBalance(),
      ) +
      `</span><span class="char-header-money">${charMoneyHtml(world.copper)}</span>` +
      `<button type="button" class="char-header-share" data-act="share-card" aria-label="${esc(shareLabel)}" title="${esc(shareLabel)}">` +
      `${SHARE_GLYPH}<span class="char-header-share-label">${esc(shareLabel)}</span></button>`
    );
  }

  // Full-screen radial-orbit layout (docs/char-equipment/): LEFT column stacks
  // the equipment STAGE (the character niche with 11 slots orbiting it at
  // fixed anchor percentages, helmet above, loadout row below) over the embedded bags section
  // (Phase 4, now full-left-column width); RIGHT column holds the six stat
  // panels (Phase 3, filled below via panelsHtml). `.char-equip-grid` is a CSS
  // grid (char-scoped ornate chrome section) that stacks to one column on
  // narrow/mobile widths. The stage keeps its ORIGINAL `.paperdoll` class
  // (mobile-touch's existing grid fallback, hud.mobile.css, still targets it
  // unchanged) alongside the new `.char-equip-stage` hook the desktop-only
  // orbit CSS targets; every existing id/class the pure core and the frame
  // tests key off (#equip-col-left/right, #char-panels, #char-bags, the model
  // preview mounts) is unchanged, just re-parented under the two new wrapper
  // columns and (desktop only) repositioned via CSS, never moved in the DOM.
  // The `.char-equip-rail` wrapper around the top slot + both equip
  // columns is `display: contents`, so the desktop orbit stage's absolute
  // percentage anchors (which resolve against `.paperdoll`, the nearest
  // positioned ancestor: a contents box generates no box of its own) and the
  // mobile grid areas keep working unchanged. Mobile landscape assigns the
  // wrapper's children to two equipment columns and a top-center helmet.
  private equipmentTabHtml(): string {
    return `<div class="char-equip-grid">
      <div class="char-equip-col-left">
        <div class="paperdoll char-equip-stage">
          <div class="char-equip-rail">
            <div class="equip-top-center" id="equip-top-center"></div>
            <div class="equip-col" id="equip-col-left"></div>
            <div class="equip-col equip-col-right" id="equip-col-right"></div>
          </div>
          <div class="char-model-panel">
            <div id="char-model-preview" class="char-model-preview" role="img" aria-label="${esc(t('hudChrome.character.modelPreview'))}"></div>
          </div>
          <div id="char-skin-row" class="skin-row char-skin-row" role="group" aria-label="${esc(t('auth.appearance'))}"></div>
        </div>
        <div class="char-phase-mount char-bags" id="char-bags"></div>
      </div>
      <div class="char-equip-col-right">
        <div class="char-phase-mount char-panels" id="char-panels"></div>
      </div>
    </div>`;
  }

  // The six right-column stat panels, in the LOCKED order (state.md decision
  // 5): Attributes, Combat, Defense, Progression, Specialization, Gathering.
  // `attack`/`talents` are reused glyphs (Combat/Specialization); the other
  // four icons are new, added for this phase (ui_icons.ts). The three stat
  // panels pass a per-panel id-namespace so a StatId shown in two panels at
  // once (armor/dodge, attackPower/dps/critChance; locked decision 6) does not
  // collide on the cell's aria-describedby target id.
  private panelsHtml(world: IWorld): string {
    return (
      this.statPanelHtml(
        'hudChrome.character.sections.attributes',
        'attributes',
        ATTRIBUTE_PANEL_STATS,
        'attributes',
      ) +
      this.statPanelHtml(
        'hudChrome.character.sections.combat',
        'attack',
        CHARACTER_COMBAT_PANEL_STATS,
        'combat',
      ) +
      this.statPanelHtml(
        'hudChrome.character.sections.defense',
        'shield',
        DEFENSE_PANEL_STATS,
        'defense',
      ) +
      this.progressionPanelHtml(world) +
      this.specPanelHtml(world) +
      this.gatheringPanelHtml(world)
    );
  }

  // One `.char-panel`: an icon + localized title header, then a body. Shared by
  // every panel below so the header grammar (docs/char-equipment/phase-03-stat-
  // panels.md section 1) is built in exactly one place. The header carries a
  // `data-icon` marker (the UiIconName) so a test can pin the icon-to-panel
  // identity, not merely that some icon exists.
  private panelHtml(titleKey: TranslationKey, icon: UiIconName, bodyHtml: string): string {
    return (
      `<div class="char-panel"><div class="char-panel-header" data-icon="${icon}">${svgIcon(icon)}` +
      `<span>${esc(t(titleKey))}</span></div><div class="char-panel-body">${bodyHtml}</div></div>`
    );
  }

  // ATTRIBUTES / COMBAT / DEFENSE: a two-column grid of deps.statCellHtml cells
  // in the exact locked array order, filling the LEFT column first (ceil half),
  // then the right (design contract section 1). Reuses deps.statCellHtml (and
  // therefore its lazy-tooltip data-stat attribute) verbatim; never a second
  // stat-cell renderer. `idNamespace` (per panel) namespaces each cell's
  // aria-describedby id so the duplicated stats do not share an element id.
  private statPanelHtml(
    titleKey: TranslationKey,
    icon: UiIconName,
    stats: readonly StatId[],
    idNamespace: string,
    bodySuffix = '',
  ): string {
    const mid = Math.ceil(stats.length / 2);
    const col = (ids: readonly StatId[]) =>
      `<div class="char-stat-col">${ids
        .map((s) => this.deps.statCellHtml(s, idNamespace))
        .join('')}</div>`;
    const grid = `<div class="char-stats">${col(stats.slice(0, mid))}${col(stats.slice(mid))}</div>`;
    return this.panelHtml(titleKey, icon, `${grid}${bodySuffix}`);
  }

  // PROGRESSION: Total XP / Virtual Level / Prestige Rank (only when > 0), then
  // a level-XP bar on the shared `.bar`/`.bar-fill` frame grammar. The painter
  // computes the width percent and the centered label text; CSS owns the bar's
  // colors. At atMaxLevel the model already zeroes levelXp/levelXpMax (no
  // division by zero here), so the bar renders full with no label.
  private progressionPanelHtml(world: IWorld): string {
    const model = buildProgressionPanel({
      lifetimeXp: world.lifetimeXp,
      xp: world.xp,
      level: world.player.level,
      prestigeRank: world.prestigeRank,
    });
    // Reuse the existing (already-translated) progression keys the HUD XP
    // block uses (state.md LOCKED "Reuse, do not duplicate"); only xpLabel is
    // new. Their English is byte-identical to the panel's prior copy.
    let rows =
      `<span class="char-progression-metric"><span>${esc(t('game.progression.totalXp'))}</span>` +
      `<b>${formatNumber(model.totalXp)}</b></span>`;
    rows +=
      `<span class="char-progression-metric"><span>${esc(t('game.progression.virtualLevel'))}</span>` +
      `<b>${formatNumber(model.virtualLevel)}</b></span>`;
    if (model.prestigeRank > 0) {
      rows +=
        `<span class="char-progression-metric"><span>${esc(t('game.progression.prestigeRank'))}</span>` +
        `<b>${formatNumber(model.prestigeRank)}</b></span>`;
    }
    const percent = model.atMaxLevel
      ? 100
      : model.levelXpMax > 0
        ? (model.levelXp / model.levelXpMax) * 100
        : 0;
    // The visible label and the aria-valuetext share the exact same string
    // (current/max at level, or the reused "MAX LEVEL" copy at cap): a
    // screen-reader user gets the identical value a sighted player reads off
    // the bar, not just the bare 0-100 percent aria-valuenow already carried.
    const valueText = model.atMaxLevel
      ? t('game.xp.maxLevel')
      : t('hudChrome.character.progression.xpLabel', {
          current: formatNumber(model.levelXp),
          max: formatNumber(model.levelXpMax),
        });
    const barLabel = model.atMaxLevel ? '' : `<span class="cp-bar-label">${esc(valueText)}</span>`;
    const bar =
      `<div class="bar cp-bar" role="progressbar" aria-label="${esc(t('game.progression.heading'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(percent)}" aria-valuetext="${esc(valueText)}">` +
      `<div class="bar-fill" style="width:${percent}%"></div>${barLabel}</div>`;
    const milestones = `<div class="char-equipment-milestones-inline">${this.deps.progressionHtml(world.player.level)}</div>`;
    return this.panelHtml(
      'game.progression.heading',
      'banner',
      `<div class="char-progression-metrics">${rows}</div>${bar}${milestones}`,
    );
  }

  // SPECIALIZATION: one row, either the none-state copy + a primary Choose
  // button, or the localized spec name + a plain Change button. The spec name
  // resolves through tTalent (talent_i18n.ts), the exact surface talents_window.ts
  // uses for the same text, never the raw id; both buttons call deps.openTalents().
  // The header title and the none-state copy reuse the existing talent keys
  // (game.talents.specTab / game.talents.noSpec), byte-identical to the panel's
  // prior copy; only the Choose/Change button labels are new (spec.choose/change).
  private specPanelHtml(world: IWorld): string {
    const model = buildSpecPanel(world.talentSpec);
    const ct = talentsFor(world.cfg.playerClass);
    const spec = model.specId ? (ct?.specs.find((s) => s.id === model.specId) ?? null) : null;
    const nameHtml = spec
      ? esc(tTalent({ kind: 'talentSpec', spec, field: 'name' }))
      : esc(t('game.talents.noSpec'));
    const btnLabel = spec
      ? t('hudChrome.character.spec.change')
      : t('hudChrome.character.spec.choose');
    const btnClass = spec ? 'btn' : 'btn is-primary';
    const body =
      `<div class="char-equipment-spec-summary">${this.deps.talentSummaryHtml()}</div>` +
      `<div class="cp-spec-row"><span class="cp-spec-name">${nameHtml}</span>` +
      `<button type="button" class="${btnClass}" data-act="open-talents">${esc(btnLabel)}</button></div>`;
    return this.panelHtml('game.talents.specTab', 'talents', body);
  }

  // GATHERING: buildGatheringProficiencyRows restyled into the panel body
  // (same rows/keys as the pre-Phase-2 gatheringHtml, minus its own redundant
  // title text: the panel header above already carries the localized name). The
  // header reuses the existing hudChrome.gathering.title key (byte-identical).
  private gatheringPanelHtml(world: IWorld): string {
    const rows = buildGatheringProficiencyRows(world)
      .map((r) => {
        const icon = GATHERING_PROFESSION_ICON[r.professionId];
        return (
          `<span class="char-gathering-row" data-profession="${r.professionId}">` +
          `<span class="char-gathering-mark" data-icon="${icon}">${svgIcon(icon)}</span>` +
          `<span class="char-gathering-copy"><span>${esc(t(GATHERING_PROFESSION_LABEL_KEY[r.professionId]))}</span>` +
          `<b>${formatNumber(r.value, { maximumFractionDigits: 0 })}</b></span></span>`
        );
      })
      .join('');
    return this.panelHtml(
      'hudChrome.gathering.title',
      'leaf',
      `<div class="char-gathering-stats">${rows}</div>`,
    );
  }

  // OVERVIEW tab (Phase 5, docs/char-equipment/phase-05-overview-tab.md): the
  // migration destination for everything the pre-Phase-2 sheet showed that the
  // Equipment tab does not. In order: the identity strip (portrait, name,
  // archetype title, hobby craft; the level/class line already lives in the
  // titlebar subtitle, so it is deliberately NOT repeated here), the talent/spec
  // summary with its Change/Choose button and the milestones/prestige block.
  // Share Player Card lives in the persistent titlebar utility rail, so it is
  // available from either tab without becoming a loose Overview footer row.
  private overviewTabHtml(world: IWorld): string {
    return (
      `<div class="char-phase-mount char-overview" id="char-overview">` +
      `${this.identityStripHtml(world)}${this.talentOverviewHtml(world)}` +
      `${this.deps.progressionHtml(world.player.level)}</div>`
    );
  }

  // The class identity strip: portrait chip, character name, archetype title
  // row, and (when set) the hobby craft row. Reuses the pre-Phase-2 sheet's
  // exact classes (char-identity/char-title-text/portrait-chip) so the
  // components.css rules Phase 2 left dead (docs/char-equipment/state.md) stay
  // live, just re-scoped from the old sticky header to this tab's first row.
  private identityStripHtml(world: IWorld): string {
    const p = world.player;
    const archetypeTitle = archetypeTitleText(world.archetypeTitle);
    const hobbyCraft = hobbyCraftText(world.hobbyCraft);
    const hobbyRow =
      world.hobbyCraft !== null
        ? `<span class="panel-subtitle char-hobby-craft">${esc(t('hudChrome.archetypeTitle.hobbyLabel'))}: ${esc(hobbyCraft)}</span>`
        : '';
    const portrait = portraitChipHtml({
      cls: world.cfg.playerClass,
      skin: p.skin ?? 0,
      name: p.name,
      variant: 'md',
    });
    return (
      `<div class="char-identity">${portrait}<span class="char-title-text">${esc(p.name)}` +
      `<span class="panel-subtitle char-archetype-title">${esc(t('hudChrome.archetypeTitle.label'))}: ${esc(archetypeTitle)}</span>${hobbyRow}</span></div>`
    );
  }

  // The talent/spec summary block: deps.talentSummaryHtml() (Hud-built, HUD
  // owns the mastery/role text) plus a Change/Choose button that opens the
  // Talents window, reusing the exact SAME dep, the SAME Choose/Change keys,
  // and the SAME primary-button treatment (none chosen yet) the Equipment
  // tab's Specialization panel uses (locked, per the design contract): both
  // buttons trigger the identical action, never a fork.
  private talentOverviewHtml(world: IWorld): string {
    const model = buildSpecPanel(world.talentSpec);
    const btnLabel = model.specId
      ? t('hudChrome.character.spec.change')
      : t('hudChrome.character.spec.choose');
    const btnClass = model.specId ? 'btn' : 'btn is-primary';
    return (
      `${this.deps.talentSummaryHtml()}` +
      `<div class="char-progression"><div class="cp-actions">` +
      `<button type="button" class="${btnClass}" data-act="open-talents">${esc(btnLabel)}</button>` +
      `</div></div>`
    );
  }

  // Overview-only wiring: hydrate the portrait chip's placeholder once the
  // character portraits finish preloading, route the Change/Choose button to
  // deps.openTalents(), and the (at-cap) Prestige button to deps.openPrestige().
  private wireOverviewTab(body: HTMLElement): void {
    hydratePortraits(body);
    body
      .querySelector('[data-act="open-talents"]')
      ?.addEventListener('click', () => this.deps.openTalents());
    body
      .querySelector('[data-act="prestige"]')
      ?.addEventListener('click', () => this.deps.openPrestige());
    body.querySelector('[data-act="open-deeds"]')?.addEventListener('click', () => {
      audio.click();
      this.deps.openDeeds();
    });
  }

  private buildSlotRow(
    cell: PaperdollSlot,
    side: 'left' | 'right' | 'top',
    anchor?: OrbitAnchor,
  ): HTMLElement {
    const { slot, item } = cell;
    const row = document.createElement('div');
    row.className = 'equip-slot';
    // Stable id + programmatic focusability so the corner-x rebuild can hand focus
    // back to this slot (the rebuilt row may be empty, with no x to focus).
    row.id = `equip-slot-${slot}`;
    row.tabIndex = -1;
    row.setAttribute('role', 'group');
    const slotName = this.deps.slotName(slot);
    const equippedName = item ? itemDisplayName(item) : t('itemUi.equipment.empty');
    row.setAttribute('aria-label', `${slotName}: ${equippedName}`);
    // Radial orbit anchor (desktop-only CSS turns this into an absolute
    // position; on mobile-touch, where the slot stays a normal in-flow flex
    // row, `left`/`right`/`top` on a `position:static` element are simply
    // ignored, so this inline style is harmless there). left-side anchors set
    // `left`, right-side anchors set `right`, both from the STAGE edge; the
    // matching CSS transform (`#equip-col-left`/`#equip-col-right` scoped)
    // centers the cell ON that percentage point.
    const desktopAnchor = DESKTOP_ORBIT_OVERRIDES[slot] ?? anchor;
    if (desktopAnchor) {
      row.style.setProperty('--orbit-x', orbitInset(desktopAnchor.x));
      row.style.setProperty('--orbit-y', `${desktopAnchor.y}%`);
    }

    // The slot name is an OUTSIDE label (the mockup): left-column labels sit
    // to the left of the icon cell, right-column labels to the right, both
    // achieved by DOM order alone (no flex-direction reversal needed).
    const label = document.createElement('div');
    label.className = 'slot-label';
    label.textContent = slotName;
    if (!item) label.style.color = SLOT_EMPTY_TEXT_COLOR;

    // The square item-cell (the shared AAA .item-cell family, 44x44 with a
    // data-quality rarity border), icon via deps.itemIcon / the empty-slot
    // recipe. The corner-x unequip button overlays this cell (position:
    // relative on .equip-item-cell), not the outer row, so its placement is
    // identical regardless of which side the outside label sits on.
    const cellEl = document.createElement('div');
    cellEl.className = 'item-cell equip-item-cell';
    if (item) cellEl.setAttribute('data-quality', item.quality ?? 'common');
    else cellEl.style.borderColor = SLOT_EMPTY_BORDER_COLOR;
    cellEl.innerHTML = item
      ? this.deps.itemIcon(item)
      : svgIcon(SLOT_EMPTY_ICON[slot], { cls: 'slot-glyph' });

    if (side === 'left') row.append(label, cellEl);
    else row.append(cellEl, label);

    if (item) {
      this.deps.attachTooltip(
        cellEl,
        () =>
          `${this.deps.itemTooltip(item)}<div class="tt-sub">${esc(t('hudChrome.paperdoll.unequipHint'))}</div>`,
      );
      // Corner x: a styled glyph control (not an in-game icon), softly visible
      // on desktop and fully shown on hover/focus/touch.
      const unequip = document.createElement('button');
      unequip.type = 'button';
      unequip.className = 'equip-unequip-btn';
      unequip.textContent = '×';
      unequip.setAttribute(
        'aria-label',
        t('hudChrome.paperdoll.unequipAria', { item: itemDisplayName(item) }),
      );
      unequip.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (this.deps.consumePeek()) {
          this.deps.hideTooltip();
          return;
        }
        this.doUnequip(slot, true);
      });
      cellEl.appendChild(unequip);
      // Right-click the slot (classic-MMO muscle memory; matches the bags grid).
      row.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        if (this.isTouchContextMenu(ev)) return;
        this.doUnequip(slot, false);
      });
      // Drag the piece out onto the bags window to unequip it.
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        this.deps.beginUnequipDrag(slot);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        this.deps.hideTooltip();
      });
      row.addEventListener('dragend', () => this.deps.endUnequipDrag());
    } else {
      // Empty slot: still swallow the native menu so right-click feels consistent.
      row.addEventListener('contextmenu', (ev) => ev.preventDefault());
    }
    return row;
  }

  // Chromium can synthesize contextmenu before the touch-tooltip timer fires.
  // Treat touch/pen context menus as inspect gestures, never unequip actions.
  // Firefox Android may expose no pointerType, so mobile-touch fails safe too.
  private isTouchContextMenu(ev: Event): boolean {
    const pointerType = (ev as PointerEvent).pointerType;
    return (
      pointerType === 'touch' ||
      pointerType === 'pen' ||
      (document.body.classList.contains('mobile-touch') && pointerType !== 'mouse')
    );
  }

  // `keepFocus` hands focus back to the now-empty slot row after the unequip
  // rebuilds the paperdoll (the innerHTML rebuild otherwise drops focus to
  // <body>); the keyboard/touch x path needs this, right-click and drag do not.
  private doUnequip(slot: EquipSlot, keepFocus: boolean): void {
    this.deps.unequip(slot);
    if (keepFocus) {
      const rebuilt = document.getElementById(`equip-slot-${slot}`);
      this.deps.restoreFocus(rebuilt instanceof HTMLElement ? rebuilt : null);
    }
  }
}
