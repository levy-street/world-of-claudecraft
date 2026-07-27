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
//     eligible targets (the held copies AND the WORN ones, which enchant in
//     place), then world.applyEnchant. enchant_apply_view.ts models both steps.
//     An already-enchanted target is a flagged REPLACE row (#2415): it routes
//     through the same destroy-confirm family before sending, and only that
//     dialog's OK sends the apply with the explicit confirm flag. That row
//     paints as DESTRUCTIVE rather than informational, its confirm states what
//     the swap KEEPS as well as what it destroys, and the plain twin of a mixed
//     holding (an enchanted copy of the same id in the bags OR on the body)
//     states its own state so the pair never differs by a sub-line alone
//     (#2421); the pure core decides all three.
//
// The pure decisions live in the two view cores; this owns only DOM + dispatch,
// talks to the world exclusively through IWorld, and never decides an outcome.

import { ENCHANTS } from '../sim/content/enchants';
import { ITEMS } from '../sim/data';
import type { EquipSlot, ItemDef, ItemSlot } from '../sim/types';
import type { IWorld } from '../world_api';
import {
  type BagItemContextActionId,
  bagItemContextActions,
  destroyConsumesSpecialCopy,
} from './bag_item_context_menu';
import { disenchantYieldLines } from './disenchant_yield_view';
import {
  type EnchantReplaceTargetInfo,
  enchantNameKey,
  enchantSectionsForReagent,
  enchantTargets,
  preservedTraitKey,
  wornEnchantTargets,
} from './enchant_apply_view';
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

/** Modifier class on a picker meta sub-line whose row is DESTRUCTIVE (#2421):
 *  the replace flag, which promises to destroy an enchant, versus the purely
 *  informational Worn / Not enchanted tags that render in the same muted style.
 *  Styled in hud.css from the picker's existing warning token, with a
 *  forced-colors arm that swaps the tint for a non-color cue. */
export const CTX_ITEM_DANGER_CLASS = 'ctx-item-danger';

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
  open(
    def: ItemDef,
    itemId: string,
    slotIndex: number,
    x: number,
    y: number,
    runDefault: () => void,
  ): void {
    const rows = bagItemContextActions(def, itemId).map((action) => ({
      act: action.id,
      html: esc(t(action.labelKey)),
    }));
    this.paint(rows, x, y, (act) => {
      const id = act as BagItemContextActionId;
      if (id === 'default') runDefault();
      else if (id === 'disenchant') this.confirmDestroy('disenchant', itemId, slotIndex);
      else if (id === 'salvage') this.confirmDestroy('salvage', itemId);
      else if (id === 'applyEnchant') this.openEnchantPicker(itemId, x, y);
    });
  }

  // Disenchant / Salvage: both route through the one confirm-dialog family, with
  // the stronger warning body when the copy that would actually be consumed is
  // special (signed / masterwork / enchanted). The OK label reuses the menu verb.
  private confirmDestroy(
    action: 'disenchant' | 'salvage',
    itemId: string,
    slotIndex?: number,
  ): void {
    const world = this.deps.world();
    const def = ITEMS[itemId];
    const name = def ? itemDisplayName(def) : itemId;
    const selected = slotIndex === undefined ? undefined : world.inventory[slotIndex];
    const copies =
      action === 'disenchant' && selected?.itemId === itemId
        ? [selected]
        : world.inventory.filter((slot) => slot.itemId === itemId);
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
        if (action === 'disenchant') {
          if (slotIndex === undefined) world.disenchantItem(itemId);
          else world.disenchantItem(itemId, { slotIndex });
        } else world.salvageItem(itemId);
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

  // The plain-text description of what a REPLACE would destroy (#2415), for
  // the flagged row's meta tag and the confirm body: the doomed enchant's
  // localized name for a marker copy, or, for a legacy pre-marker copy with no
  // id to name, its raw baked stats formatted with the same tooltip stat key
  // the picker's effect lines use ("+5 Strength"), so the two surfaces read
  // identically.
  private replacedEnchantText(replace: EnchantReplaceTargetInfo): string {
    if (replace.enchantId !== undefined) return t(enchantNameKey(replace.enchantId));
    const statsText = Object.entries(replace.stats ?? {})
      .filter(([, value]) => value !== 0)
      .map(([stat, value]) =>
        t('itemUi.tooltip.stat', { value: itemNumber(value), stat: itemStatName(stat) }),
      )
      .join(', ');
    return statsText || t('hudChrome.itemTooltip.enchantedFallback');
  }

  // The #2415 replace confirm: the one destroy-confirm family, naming exactly
  // what is being destroyed (the pinned victim's enchant, or a legacy copy's
  // raw stats), that the old enchant is not refunded, and the reagent cost
  // being paid, BEFORE the command is sent. OK sends the apply with the
  // explicit confirm flag; the sim re-validates everything server-side.
  private confirmReplace(
    itemId: string,
    enchantId: string,
    replace: EnchantReplaceTargetInfo,
    slot?: EquipSlot,
  ): void {
    const world = this.deps.world();
    const def = ITEMS[itemId];
    const name = def ? itemDisplayName(def) : itemId;
    const oldText = this.replacedEnchantText(replace);
    const newText = t(enchantNameKey(enchantId));
    const costText = (ENCHANTS[enchantId]?.reagents ?? [])
      .map((reagent) =>
        t('hudChrome.enchanting.replaceConfirmCostItem', {
          name: itemDisplayName(ITEMS[reagent.itemId]),
          // itemNumber, not the raw number: t()'s interpolation is String(v),
          // so a raw count would never see Intl. Same formatter the stat lines
          // above use and the disenchant yield line's count uses.
          count: itemNumber(reagent.count),
        }),
      )
      .join(', ');
    // What the swap does NOT destroy (#2421), between the destroy warning and
    // the price. The pure core decided WHICH traits the pinned victim actually
    // carries (and, on the worn arm, which the online wire can honestly speak
    // for), so an ordinary copy is never told its signature is safe: an empty
    // list drops the line entirely rather than printing "Kept: ".
    const keptText = (replace.preserved ?? [])
      .map((trait) => t(preservedTraitKey(trait)))
      .join(', ');
    const body = [
      t('hudChrome.enchanting.replaceConfirmBody', { item: name, old: oldText, new: newText }),
      t('hudChrome.enchanting.replaceConfirmNoRefund'),
      ...(keptText ? [t('hudChrome.enchanting.replaceConfirmKeeps', { kept: keptText })] : []),
      t('hudChrome.enchanting.replaceConfirmCost', { cost: costText }),
    ].join('\n');
    this.deps.confirmDialog(
      t('hudChrome.enchanting.replaceConfirmTitle', { item: name }),
      body,
      t('hudChrome.enchanting.replaceConfirmAccept'),
      t('hud.chat.context.cancel'),
      () => {
        world.applyEnchant(itemId, enchantId, slot, true);
        this.deps.afterAction();
      },
    );
  }

  // Step two: every eligible enchant target, then world.applyEnchant. Two
  // families, in one list: the bagged copies (def slot matches, a
  // non-already-enchanted copy is held) and the WORN copies (the same match
  // against the equipped set), since worn gear is enchanted in place and needs no
  // unequip / re-equip round trip. A worn row carries its equipment slot both in
  // its label and in its dispatch, which is what separates a dual-wielded pair or
  // two rings holding identical copies. Already-enchanted copies paint as
  // FLAGGED replace rows (#2415): their meta names the enchant that would be
  // destroyed, activation runs the replace confirm (confirmReplace above), and
  // a row whose victim already carries the picked enchant paints disabled (the
  // sim would deny same_enchant; a confirm that can only lose reagents is
  // never offered).
  private openTargetPicker(enchantId: string, x: number, y: number): void {
    const world = this.deps.world();
    // The self entity mirror carries equippedInstances in BOTH worlds (offline
    // Sim and online ClientWorld), the same read the paperdoll tooltip uses.
    const worn = wornEnchantTargets(
      world.equipment,
      world.entities.get(world.playerId)?.equippedInstances ?? {},
      enchantId,
    );
    // Worn FIRST, because the bagged family needs it: an enchanted copy on the
    // body leaves a bagged plain copy of the same id just as ambiguous as an
    // enchanted bagged one would (#2421), and both paint into the one list a
    // player reads. enchantTargets owns that decision; this only supplies it.
    const targets = enchantTargets(world.inventory, enchantId, worn);
    const title = esc(t('hudChrome.enchanting.targetTitle'));
    if (targets.length === 0 && worn.length === 0) {
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
    const nameOf = (itemId: string): string => {
      const def = ITEMS[itemId];
      return esc(def ? itemDisplayName(def) : itemId);
    };
    // A row that will DESTROY an enchant must not read like the purely
    // informational Worn tag beside it (#2421), so the replace flag takes the
    // picker's own warning modifier (CTX_ITEM_DANGER_CLASS, the .ctx-reagent
    // .unsat token next door). The tint stays a redundant hint: the tag names
    // the doomed enchant in words either way. The already-applied tag is NOT
    // destructive (that row is inert) and keeps the plain meta style.
    const replaceMeta = (replace: EnchantReplaceTargetInfo): string =>
      replace.sameEnchant
        ? `<span class="ctx-item-meta">${esc(t('hudChrome.enchanting.sameEnchantTag'))}</span>`
        : `<span class="ctx-item-meta ${CTX_ITEM_DANGER_CLASS}">${esc(
            t('hudChrome.enchanting.replaceTag', { enchant: this.replacedEnchantText(replace) }),
          )}</span>`;
    // The plain twin of a MIXED HOLDING (#2421) states its own state, so the
    // two rows sharing one item name differ by what each SAYS rather than by
    // one of them carrying a sub-line and the other carrying none, which is all
    // an assistive-tech user or a quick scan had to go on. The enchanted twin
    // counts from EITHER family, bags or body, since this list shows both. Only
    // on that twin: an unambiguous plain row stays tag-free (enchant_apply_view
    // mixedHolding). Scoped to the ONE-ITEM-ID pair that flag describes, not to
    // every possible duplicate name: a base item and its heroic variant share a
    // display name across two ids (#2466), and two rings of one id both label
    // "Worn (Finger)". Both predate this change and neither is claimed fixed
    // here. A function, not a const string, so an ordinary target list with no
    // mixed holding pays no t() call at all.
    const plainMeta = (): string =>
      `<span class="ctx-item-meta">${esc(t('hudChrome.enchanting.plainTag'))}</span>`;
    const rows = [
      ...worn.map((target) => {
        const html = `${nameOf(target.itemId)}<span class="ctx-item-meta">${esc(
          t('hudChrome.enchanting.wornTag', { slot: this.deps.slotName(target.slot) }),
        )}</span>${target.replace ? replaceMeta(target.replace) : ''}`;
        return target.replace?.sameEnchant
          ? { html, disabled: true }
          : { act: `worn:${target.slot}`, html };
      }),
      ...targets.map((target) => {
        if (!target.replace) {
          const html = `${nameOf(target.itemId)}${target.mixedHolding ? plainMeta() : ''}`;
          return { act: `target:${target.itemId}`, html };
        }
        const html = `${nameOf(target.itemId)}${replaceMeta(target.replace)}`;
        return target.replace.sameEnchant
          ? { html, disabled: true }
          : { act: `replace:${target.itemId}`, html };
      }),
    ];
    this.paint(
      rows,
      x,
      y,
      (act) => {
        // The two dialog-opening paths return early (the dialog sends and
        // repaints on OK); every other path, hits and misses alike, falls
        // through to afterAction exactly as before this feature.
        if (act.startsWith('worn:')) {
          const slot = act.slice('worn:'.length) as EquipSlot;
          const target = worn.find((row) => row.slot === slot);
          if (target?.replace) {
            this.confirmReplace(target.itemId, enchantId, target.replace, slot);
            return;
          }
          if (target) world.applyEnchant(target.itemId, enchantId, slot);
        } else if (act.startsWith('replace:')) {
          const itemId = act.slice('replace:'.length);
          const target = targets.find((row) => row.itemId === itemId && row.replace);
          if (target?.replace) {
            this.confirmReplace(itemId, enchantId, target.replace);
            return;
          }
        } else {
          world.applyEnchant(act.slice('target:'.length), enchantId);
        }
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
