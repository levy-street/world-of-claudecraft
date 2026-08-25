// Builds and wires the consumables seat: the ring's 5th arc position plus the
// row it opens (Phase 3 of the touch rework). It replaces the retired top-left
// quick bar, which was designed for mid-combat use yet sat further from the
// nearer thumb than anything else in the HUD; in the ring's own seat it is inside
// the reach the rest of combat already lives in.
//
// Extracted from Hud so the seat lands behind the action_bar seam instead of
// growing the coordinator: Hud keeps the item-use call and one per-frame paint,
// and hands this module a narrow dependency bag. Nothing here imports Hud.
//
// What it composes:
//   - createActionBarView over the seat plus the row, so the seat and the item it
//     duplicates can never disagree (slot 0 is the seat, slots 1..n the row),
//   - consumable_bar_view.ts UNCHANGED for the auto-populated list itself,
//   - the gesture layer (consumable_strip_gesture_controller.ts) and the strip
//     painter.
//
// The static markup lives in index.html / play.html (#mobile-consumable-seat,
// #mobile-consumable-strip). On a build that omits it, buildMobileConsumableSeat
// returns null and the seat silently stays unbuilt, exactly like the ring.

import { audio } from '../../../game/audio';
import type { ItemDef } from '../../../sim/types';
import { formatAbilityNumber } from '../../ability_description';
import { abilityDisplayName } from '../../ability_display_name';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { formatNumber, type TranslationKey, t } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import { StripCaptionPainter } from '../strip_caption_painter';
import { tapMenusEnabled } from '../tap_menu';
import type { ActionBarSlotElements } from './action_bar_painter';
import {
  type ActionBarState,
  type ActionBarWorldInput,
  createActionBarView,
  inventoryCount,
} from './action_bar_view';
import { CONSUMABLE_BAR_SLOTS, consumableBarItems } from './consumable_bar_view';
import { ConsumableStripGesture } from './consumable_strip_gesture_controller';
import { ConsumableStripPainter } from './consumable_strip_painter';
import { itemInBagsLine } from './item_bags_line_core';
import { stripCaptionCenterX } from './radial_action_core';

const SEAT_ID = 'mobile-consumable-seat';
const STRIP_ID = 'mobile-consumable-strip';
const CANCEL_ID = 'mobile-consumable-cancel';
const CAPTION_ID = 'mobile-consumable-caption';
const CAPTION_TEXT_SELECTOR = '.tt-title';
const ITEM_SELECTOR = '.mobile-consumable-item';
const ITEM_INDEX_DATASET = 'consumableIndex';
/** The seat's own slot label, so a screen reader names the control rather than
 *  reading a slot number the player never sees. */
const SEAT_LABEL_KEY: TranslationKey = 'hudChrome.mobile.consumableSeat';
/**
 * Paints between rescans of the carried consumables while the row is CLOSED.
 * The list only moves on a pickup, a use, a sale or a loot, and neither IWorld
 * exposes a revision to gate on, so the scan (four kind passes over the whole
 * inventory plus an insertion sort) rides a divider rather than running on every
 * frame of every touch session. Twelve frames is about 200ms at 60fps, inside
 * the quarter second a player would notice on a seat they are not looking at,
 * and a USE (the one edge they are looking at) forces the next paint to rescan
 * regardless.
 */
const CLOSED_RESCAN_FRAMES = 12;

/** Everything the seat needs from Hud, as callbacks. */
export interface MobileConsumableSeatDeps {
  writers: PainterHostWriters;
  /** Resolve a hotbar icon key to a background-image value. */
  iconBackground(iconKey: string): string;
  lookupItem(itemId: string): ItemDef | undefined;
  /** Use a carried consumable, reporting whether it actually went through (an
   *  open trade window blocks it). Routes through the SAME IWorld.useItem seam
   *  the retired quick bar used, so offline runs the sim directly and online
   *  sends the authoritative 'use' command. */
  useItem(itemId: string): boolean;
  /** The used-flash the cast path gives every other action button. */
  flash(btn: HTMLButtonElement): void;
  /** Bind the shared long-press / focus tooltip to a row item, exactly as the
   *  retired quick bar did: the sticky and tap-mode paths make these real
   *  focusable buttons, so identification cannot rest on the caption alone. */
  attachTooltip(el: HTMLElement, html: () => string): void;
  /** The shared item tooltip body, so the row says what the desktop bar says. */
  itemTooltip(item: ItemDef): string;
  hideTooltip(): void;
  consumePeekGuard(): void;
}

export interface MobileConsumableSeat {
  /** Ticked and painted by Hud each frame; the row rides the same snapshot. */
  paint(world: ActionBarWorldInput): void;
  gesture: ConsumableStripGesture;
  seatBtn: HTMLButtonElement;
}

/** Mint the per-slot child nodes ActionBarPainter writes into. Build-time DOM,
 *  not a per-frame path: everything repeated goes through the painter. */
function slotElements(btn: HTMLElement): ActionBarSlotElements {
  const label = document.createElement('span');
  label.className = 'icon-label';
  const countEl = document.createElement('span');
  countEl.className = 'item-count';
  const keybindEl = document.createElement('span');
  keybindEl.className = 'keybind';
  const cdOverlay = document.createElement('div');
  cdOverlay.className = 'cd-overlay';
  const cdText = document.createElement('div');
  cdText.className = 'cdtext';
  const rechargeOverlay = document.createElement('div');
  rechargeOverlay.className = 'recharge-overlay';
  btn.append(label, countEl, keybindEl, cdOverlay, rechargeOverlay, cdText);
  return { btn, label, countEl, keybindEl, cdOverlay, cdText, rechargeOverlay };
}

/** Build the seat, or return null when the markup is absent. */
export function buildMobileConsumableSeat(
  deps: MobileConsumableSeatDeps,
): MobileConsumableSeat | null {
  const seatBtn = document.getElementById(SEAT_ID) as HTMLButtonElement | null;
  const strip = document.getElementById(STRIP_ID);
  const cancel = document.getElementById(CANCEL_ID);
  const caption = document.getElementById(CAPTION_ID);
  const captionText = caption?.querySelector<HTMLElement>(CAPTION_TEXT_SELECTOR) ?? null;
  const itemBtns = Array.from(document.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR)).sort(
    (a, b) =>
      Number(a.dataset[ITEM_INDEX_DATASET] ?? 0) - Number(b.dataset[ITEM_INDEX_DATASET] ?? 0),
  );
  if (!seatBtn || !strip || !cancel || itemBtns.length !== CONSUMABLE_BAR_SLOTS) return null;
  if (!caption || !captionText) return null;

  // The ONE reused array the pure core fills. It is FROZEN from the moment a
  // press ARMS so an item never shifts out from under the thumb travelling
  // toward it (a depleted stack stays in place, greyed at count 0, exactly like a
  // desktop bar item shortcut), and refreshed on every idle frame so the seat
  // always shows what the player is actually carrying. Armed, never open: the
  // reveal is RADIAL_REVEAL_MS behind the press, and a loot landing inside that
  // window used to re-sort the row between the press and the use it resolved to.
  const ids: string[] = [];
  // The most recent inventory snapshot the paint saw, so a tooltip resolved on a
  // long press reads the same stack counts the row was painted from.
  let inventory: readonly { itemId: string; count: number }[] = [];
  let framesSinceScan = CLOSED_RESCAN_FRAMES;
  let wasArmed = false;
  /** The last state the view ticked, so a gesture-driven repaint between frames
   *  paints the row without a second tick of Hud's snapshot. */
  let lastState: ActionBarState | null = null;
  // The caption's resolve, not just its write, is elided: the row is frozen for
  // the whole press, so the localized name can only change when the finger moves
  // to another item.
  let captionLive = -1;
  let captionName = '';

  const view = createActionBarView(
    {
      slots: [
        {
          slotIndex: 0,
          isAttack: () => false,
          hasAction: () => ids[0] !== undefined,
          ability: () => null,
          item: () => itemAt(deps, ids, 0),
          keybindLabel: () => '',
        },
        ...Array.from({ length: CONSUMABLE_BAR_SLOTS }, (_, i) => ({
          slotIndex: i + 1,
          isAttack: () => false,
          hasAction: () => ids[i] !== undefined,
          ability: () => null,
          item: () => itemAt(deps, ids, i),
          keybindLabel: () => '',
        })),
      ],
    },
    {
      t,
      abilityName: abilityDisplayName,
      itemName: itemDisplayName,
      slotLabel: (i) => (i === 0 ? t(SEAT_LABEL_KEY) : formatAbilityNumber(i)),
      formatCount: (n) => formatNumber(n, { maximumFractionDigits: 0 }),
    },
  );

  const painter = new ConsumableStripPainter(
    deps.writers,
    { strip, cancel, seat: slotElements(seatBtn), items: itemBtns.map(slotElements) },
    (iconKey) => deps.iconBackground(iconKey),
  );
  const captionPainter = new StripCaptionPainter(deps.writers, {
    box: caption,
    text: captionText,
  });

  // The row's items are real focusable buttons in sticky and tap mode, and a
  // long press on one peeks it. Both need the identification the retired quick
  // bar had: the same item tooltip the desktop bar shows, plus the in-bags line.
  // The SEAT itself takes none, by design: a hold there opens the row.
  itemBtns.forEach((btn, i) => {
    deps.attachTooltip(btn, () => {
      const item = itemAt(deps, ids, i);
      if (!item) return `<div class="tt-sub">${esc(t('abilityUi.actionBar.emptySlot'))}</div>`;
      return deps.itemTooltip(item) + itemInBagsLine(inventoryCount(inventory, item.id));
    });
  });

  const gesture = new ConsumableStripGesture({
    seat: seatBtn,
    // Hud's shared facet, the same one the strip painter writes through: the
    // seat's aria-expanded state must elide against the same cache as the rest
    // of the seat's writes, never a second one.
    writers: deps.writers,
    // The row's geometry tokens live on the overlay, which is a sibling of the
    // ring so its items are seated in viewport coordinates rather than inside
    // the ring's own scaled, corner-anchored box.
    metricsHost: strip,
    items: itemBtns,
    cancel,
    tapMenus: () => tapMenusEnabled(),
    count: () => ids.length,
    use: (index) => {
      const id = ids[index];
      if (id === undefined) return;
      deps.consumePeekGuard();
      deps.hideTooltip();
      audio.click();
      if (deps.useItem(id)) deps.flash(seatBtn);
      // A use is the one inventory change the player is watching, so the next
      // painted frame rescans instead of waiting out the divider.
      framesSinceScan = CLOSED_RESCAN_FRAMES;
      seatBtn.blur();
    },
    onCancel: () => {
      deps.consumePeekGuard();
      deps.hideTooltip();
    },
    // The row rides Hud's frame for its ordinary paints, but a sticky open moves
    // focus onto the first item in the same call, and an item the frame has not
    // shown yet is display:none and refuses focus.
    repaint: () => render(),
  });

  /** Paint the seat, the row and the caption from the last ticked state. Called
   *  every frame by paint() below, and by the gesture on a state change. */
  const render = (): void => {
    if (lastState === null) return;
    const open = gesture.openState();
    painter.paint(lastState, open);
    // ONE caption for the item under the finger: the row's icons alone cannot
    // tell a healing potion from a mana one at a glance mid-fight.
    const live = open ? open.live : -1;
    if (live !== captionLive) {
      captionLive = live;
      const item = live >= 0 ? itemAt(deps, ids, live) : null;
      captionName = item ? itemDisplayName(item) : '';
    }
    captionPainter.paint(
      captionName,
      open
        ? stripCaptionCenterX({
            centers: open.placement.centers,
            live,
            viewportWidth: open.viewportWidth,
            margin: open.margin,
          })
        : null,
      open?.anchorY ?? 0,
    );
  };
  gesture.attach();

  return {
    paint(world: ActionBarWorldInput): void {
      inventory = world.inventory;
      // Frozen from the press (an item must not shift out from under a
      // travelling thumb), rescanned on the frame the press ends, and otherwise
      // on the divider above rather than on every frame.
      const armed = gesture.isArmed();
      if (!armed) {
        if (wasArmed || ++framesSinceScan >= CLOSED_RESCAN_FRAMES) {
          consumableBarItems(world.inventory, (id) => deps.lookupItem(id), ids);
          framesSinceScan = 0;
        }
      }
      wasArmed = armed;
      lastState = view.tick(world);
      render();
    },
    gesture,
    seatBtn,
  };
}

function itemAt(deps: MobileConsumableSeatDeps, ids: readonly string[], i: number): ItemDef | null {
  const id = ids[i];
  return id === undefined ? null : (deps.lookupItem(id) ?? null);
}
