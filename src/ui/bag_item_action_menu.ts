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
import { disenchantYieldLines } from './disenchant_yield_view';
import { enchantNameKey, enchantSectionsForReagent, enchantTargets } from './enchant_apply_view';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { t } from './i18n';
import { itemNumber, itemStatName } from './item_instance_tooltip';

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

/** One painted row of the shared #ctx-menu popup: a selectable action (`act`),
 *  an inert disabled row, or a non-interactive tier section caption. */
interface PickerRow {
  act?: string;
  html: string;
  disabled?: boolean;
  header?: boolean;
}

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
    // The disenchant arm also states what the destroy PAYS OUT (the sim's own
    // yield functions, via the pure view core), so an irreversible action is
    // not a blind trade. Salvage keeps its existing body: its generic yield is
    // a separate system (professions/salvage.ts).
    const yieldLines = action === 'disenchant' ? disenchantYieldLines(def) : [];
    const body = [t(c.body, { item: name }), ...yieldLines].join('\n');
    this.deps.confirmDialog(
      t(c.title, { item: name }),
      body,
      t(c.ok),
      t('hud.chat.context.cancel'),
      () => {
        if (action === 'disenchant') world.disenchantItem(itemId);
        else world.salvageItem(itemId);
        this.deps.afterAction();
      },
    );
  }

  // Step one: the enchants that consume the chosen reagent, grouped into the
  // three tier sections and slot-sorted inside each (enchant_apply_view.ts owns
  // both decisions). Each row shows the localized enchant name, WHAT THE ENCHANT
  // DOES (its stat bonus, inline: the picker also lives on touch, where there is
  // no hover to reveal it), its target slot, and the per-reagent affordability;
  // an unaffordable enchant is shown but not selectable (aria-disabled).
  private openEnchantPicker(reagentItemId: string, x: number, y: number): void {
    const world = this.deps.world();
    const sections = enchantSectionsForReagent(world.inventory, reagentItemId);
    const title = esc(t('hudChrome.enchanting.pickerTitle'));
    if (sections.length === 0) {
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
    const rows: PickerRow[] = [];
    for (const section of sections) {
      rows.push({ html: esc(t(section.titleKey)), header: true });
      for (const pick of section.rows) {
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
        // The effect line reuses the item tooltip's own stat-line key and stat
        // names, so "+4 Stamina" reads identically here and on the enchanted
        // copy's tooltip; no new i18n for the effect itself.
        const effectsText = pick.effects
          .map((effect) =>
            t('itemUi.tooltip.stat', {
              value: itemNumber(effect.value),
              stat: itemStatName(effect.stat),
            }),
          )
          .join(', ');
        const effectHtml = effectsText
          ? `<span class="ctx-item-effect">${esc(effectsText)}</span>`
          : '';
        const html = `${esc(t(enchantNameKey(pick.enchantId)))}${effectHtml}<span class="ctx-item-meta">${esc(this.deps.slotName(pick.itemSlot as ItemSlot))}: ${reagentsHtml}</span>`;
        rows.push(
          pick.affordable ? { act: `enchant:${pick.enchantId}`, html } : { html, disabled: true },
        );
      }
    }
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
  // (bindContextMenuActions ignores rows without data-act); a `header` row is a
  // non-interactive tier caption that also NAMES the group of rows under it.
  // Reuses the shared placement + action binding, never a bespoke menu.
  private paint(
    rows: PickerRow[],
    x: number,
    y: number,
    onActivate: (act: string) => void,
    titleHtml?: string,
    picker = false,
  ): void {
    const el = this.deps.ctxMenu.element();
    el.classList.toggle(CTX_MENU_PICKER_CLASS, picker);
    let html = titleHtml ? `<div class="ctx-title">${titleHtml}</div>` : '';
    // A tier caption opens a labelled GROUP around the rows beneath it, so the
    // ladder reaches assistive tech too: the rows are role=button stops
    // (bindContextMenuActions), and without the group a keyboard user would step
    // row to row never learning which tier they are in. The caption itself stays
    // unfocusable; it is the group's accessible name, not a menu item.
    let openGroup = false;
    let sectionSeq = 0;
    for (const row of rows) {
      if (row.header) {
        if (openGroup) html += '</div>';
        const id = `ctx-section-${sectionSeq++}`;
        html += `<div class="ctx-group" role="group" aria-labelledby="${id}"><div class="ctx-section" id="${id}">${row.html}</div>`;
        openGroup = true;
      } else if (row.act) html += `<div class="ctx-item" data-act="${row.act}">${row.html}</div>`;
      else html += `<div class="ctx-item" aria-disabled="true">${row.html}</div>`;
    }
    if (openGroup) html += '</div>';
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
