// Thin DOM consumer for the bag-item action menu (Professions 2.0).
// Composes the shared #ctx-menu popup family (the same element, .ctx-item rows,
// placement, and bindContextMenuActions the player context menu uses; never a
// second bespoke menu pattern) to surface the enchanting actions on a bag stack:
//
//   - Right-click / touch tap on an item with an enchanting action opens the menu.
//     Row one is the classic left-click action (so that binding survives), then
//     Disenchant / Salvage / Apply Enchant as eligible.
//   - Disenchant and Salvage route through the ONE canonical destroy-confirm
//     family (Hud.confirmDialog), with a STRONGER warning variant when the copy
//     that would actually be consumed is special (signed / masterwork /
//     enchanted): bag_item_context_menu.ts decides that predicate.
//   - Apply Enchant opens a two-step picker (also on #ctx-menu): the enchants
//     that consume the reagent, each with affordability + target slot, then the
//     held eligible targets, then world.applyEnchant. enchant_apply_view.ts
//     models both steps.
//
// The pure decisions live in the two view cores; this owns only DOM + dispatch,
// talks to the world exclusively through IWorld, and never decides an outcome.

import { ITEMS } from '../sim/data';
import type { ItemDef, ItemSlot } from '../sim/types';
import type { IWorld } from '../world_api';
import {
  type BagItemContextActionId,
  bagItemContextActions,
  destroyConsumesSpecialCopy,
} from './bag_item_context_menu';
import { enchantNameKey, enchantsForReagent, enchantTargets } from './enchant_apply_view';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { t } from './i18n';

/** Modifier class the picker states set on the shared #ctx-menu element: the
 *  Apply Enchant pickers size differently from every other menu in the family
 *  (wider, height-capped, scrolling), so the sizing rules are scoped to this
 *  class alone and every plain paint site clears it (the player/chat menus and
 *  the plain bag action menu render exactly as before). */
export const CTX_MENU_PICKER_CLASS = 'ctx-menu-picker';

/** The desktop CSS cap for a picker menu (hud.css #ctx-menu.ctx-menu-picker
 *  max-height: min(60vh, 560px)), mirrored so placement can reserve the real
 *  rendered box instead of the full uncapped list estimate. */
const PICKER_MAX_HEIGHT_VIEWPORT_FRACTION = 0.6;
const PICKER_MAX_HEIGHT_DESKTOP_PX = 560;

/** The #ctx-menu seam this painter drives, wired by the HUD from the same
 *  helpers the player menus use (placePopupAt + keepPopupOnScreen, and
 *  bindContextMenuActions). */
export interface CtxMenuSeam {
  element(): HTMLElement;
  place(el: HTMLElement, x: number, y: number, reserveRight: number, reserveBottom: number): void;
  bind(onActivate: (act: string) => void): void;
}

export interface BagItemActionMenuDeps {
  world(): IWorld;
  ctxMenu: CtxMenuSeam;
  /** Hud.confirmDialog: the single focus-trapped destroy-confirm family. */
  confirmDialog(
    title: string,
    body: string,
    okText: string,
    cancelText: string,
    onOk: () => void,
  ): void;
  /** Localized equip-slot label (Hud.itemSlotName), for the enchant rows. */
  slotName(slot: ItemSlot): string;
  isMobileLayout(): boolean;
  /** Repaint the bags grid after a command (offline immediacy; online the loot
   *  mirror repaints again when it lands). */
  afterAction(): void;
}

export class BagItemActionMenu {
  constructor(private readonly deps: BagItemActionMenuDeps) {}

  /** Open the action menu for a bag stack. `runDefault` runs the exact classic
   *  left-click action for the clicked slot, so the menu's first row is
   *  byte-identical to a plain click. */
  open(def: ItemDef, itemId: string, x: number, y: number, runDefault: () => void): void {
    const rows = bagItemContextActions(def, itemId).map((action) => ({
      act: action.id,
      html: esc(t(action.labelKey)),
    }));
    this.paint(rows, x, y, (act) => {
      const id = act as BagItemContextActionId;
      if (id === 'default') runDefault();
      else if (id === 'disenchant') this.confirmDestroy('disenchant', itemId);
      else if (id === 'salvage') this.confirmDestroy('salvage', itemId);
      else if (id === 'applyEnchant') this.openEnchantPicker(itemId, x, y);
    });
  }

  // Disenchant / Salvage: both route through the one confirm-dialog family, with
  // the stronger warning body when the copy that would actually be consumed is
  // special (signed / masterwork / enchanted). The OK label reuses the menu verb.
  private confirmDestroy(action: 'disenchant' | 'salvage', itemId: string): void {
    const world = this.deps.world();
    const def = ITEMS[itemId];
    const name = def ? itemDisplayName(def) : itemId;
    const copies = world.inventory.filter((slot) => slot.itemId === itemId);
    const special = destroyConsumesSpecialCopy(action, copies);
    const c =
      action === 'disenchant'
        ? {
            title: 'hudChrome.enchanting.disenchantConfirmTitle' as const,
            body: special
              ? ('hudChrome.enchanting.disenchantConfirmBodySpecial' as const)
              : ('hudChrome.enchanting.disenchantConfirmBody' as const),
            ok: 'hudChrome.itemMenu.disenchant' as const,
          }
        : {
            title: 'hudChrome.enchanting.salvageConfirmTitle' as const,
            body: special
              ? ('hudChrome.enchanting.salvageConfirmBodySpecial' as const)
              : ('hudChrome.enchanting.salvageConfirmBody' as const),
            ok: 'hudChrome.itemMenu.salvage' as const,
          };
    this.deps.confirmDialog(
      t(c.title, { item: name }),
      t(c.body, { item: name }),
      t(c.ok),
      t('hud.chat.context.cancel'),
      () => {
        if (action === 'disenchant') world.disenchantItem(itemId);
        else world.salvageItem(itemId);
        this.deps.afterAction();
      },
    );
  }

  // Step one: the enchants that consume the chosen reagent. Each row shows the
  // localized enchant name, its target slot, and the per-reagent affordability;
  // an unaffordable enchant is shown but not selectable (aria-disabled).
  private openEnchantPicker(reagentItemId: string, x: number, y: number): void {
    const world = this.deps.world();
    const picks = enchantsForReagent(world.inventory, reagentItemId);
    const title = esc(t('hudChrome.enchanting.pickerTitle'));
    if (picks.length === 0) {
      this.paint(
        [{ html: esc(t('hudChrome.enchanting.noEnchants')), disabled: true }],
        x,
        y,
        () => {},
        title,
        true,
      );
      return;
    }
    const rows = picks.map((pick) => {
      // Each unsatisfied reagent carries a class the CSS tints (the crafting
      // window's reagent-line idiom): redundant beside the have/required
      // counts the text already carries, so the color is a hint, never the
      // only signal (fairness).
      const reagentsHtml = pick.reagents
        .map(
          (reagent) =>
            `<span class="ctx-reagent${reagent.have >= reagent.required ? '' : ' unsat'}">${esc(
              t('hudChrome.crafting.reagentLine', {
                name: itemDisplayName(ITEMS[reagent.itemId]),
                have: reagent.have,
                required: reagent.required,
              }),
            )}</span>`,
        )
        .join(', ');
      const html = `${esc(t(enchantNameKey(pick.enchantId)))}<span class="ctx-item-meta">${esc(this.deps.slotName(pick.itemSlot as ItemSlot))}: ${reagentsHtml}</span>`;
      return pick.affordable
        ? { act: `enchant:${pick.enchantId}`, html }
        : { html, disabled: true };
    });
    this.paint(
      rows,
      x,
      y,
      (act) => this.openTargetPicker(act.slice('enchant:'.length), x, y),
      title,
      true,
    );
  }

  // Step two: the held items eligible as the enchant target (def slot matches,
  // a non-already-enchanted copy is held), then world.applyEnchant.
  private openTargetPicker(enchantId: string, x: number, y: number): void {
    const world = this.deps.world();
    const targets = enchantTargets(world.inventory, enchantId);
    const title = esc(t('hudChrome.enchanting.targetTitle'));
    if (targets.length === 0) {
      this.paint(
        [{ html: esc(t('hudChrome.enchanting.noTargets')), disabled: true }],
        x,
        y,
        () => {},
        title,
        true,
      );
      return;
    }
    const rows = targets.map((target) => {
      const def = ITEMS[target.itemId];
      return {
        act: `target:${target.itemId}`,
        html: esc(def ? itemDisplayName(def) : target.itemId),
      };
    });
    this.paint(
      rows,
      x,
      y,
      (act) => {
        world.applyEnchant(act.slice('target:'.length), enchantId);
        this.deps.afterAction();
      },
      title,
      true,
    );
  }

  // Build the #ctx-menu popup: an optional title, then the rows. A row with an
  // `act` is a selectable .ctx-item[data-act]; a `disabled` row is inert
  // (bindContextMenuActions ignores rows without data-act). Reuses the shared
  // placement + action binding, never a bespoke menu.
  private paint(
    rows: { act?: string; html: string; disabled?: boolean }[],
    x: number,
    y: number,
    onActivate: (act: string) => void,
    titleHtml?: string,
    picker = false,
  ): void {
    const el = this.deps.ctxMenu.element();
    el.classList.toggle(CTX_MENU_PICKER_CLASS, picker);
    let html = titleHtml ? `<div class="ctx-title">${titleHtml}</div>` : '';
    for (const row of rows) {
      if (row.act) html += `<div class="ctx-item" data-act="${row.act}">${row.html}</div>`;
      else html += `<div class="ctx-item" aria-disabled="true">${row.html}</div>`;
    }
    el.innerHTML = html;
    el.style.display = 'block';
    const naturalReserve = 80 + rows.length * (this.deps.isMobileLayout() ? 48 : 32);
    // A picker box is height-capped by CSS, so reserve the capped box, not the
    // full list estimate (the estimate ignores the UI scale divisor, which only
    // over-reserves; keepPopupOnScreen pulls back any residual overflow).
    const cappedReserve = this.deps.isMobileLayout()
      ? window.innerHeight * PICKER_MAX_HEIGHT_VIEWPORT_FRACTION
      : Math.min(
          window.innerHeight * PICKER_MAX_HEIGHT_VIEWPORT_FRACTION,
          PICKER_MAX_HEIGHT_DESKTOP_PX,
        );
    const reserveBottom = picker
      ? Math.min(naturalReserve, Math.round(cappedReserve) + 24)
      : naturalReserve;
    this.deps.ctxMenu.place(el, x, y, picker ? 410 : 190, reserveBottom);
    this.deps.ctxMenu.bind(onActivate);
  }
}
