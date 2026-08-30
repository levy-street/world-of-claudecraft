// The stance-style choice bar, extracted from hud.ts: one shared surface for
// warrior stances and paladin devotion auras, in the two shapes it ships in.
//
//   - DESKTOP is the historical row of buttons in #stancebar, rebuilt only when
//     the known choice set or the worn choice changes (signature elision, like
//     the pet bar). Byte-identical markup, classes, tooltips and click path.
//   - TOUCH is the radial control (stance_control_controller.ts): the row would
//     have to sit somewhere on the button row, and a row of three circles has
//     nowhere to sit there, so the anchor wears the worn stance and the others
//     hang off the radial the action ring already taught the player.
//
// Both shapes cast through the SAME IWorld.castAbility call the row's buttons
// always used; only the input differs. Hud keeps the frame call and the cast,
// the tooltip and the icon callbacks; this module owns the rest.

import type { ResolvedAbility } from '../../../sim/sim';
import type { Aura } from '../../../sim/types';
import type { PainterHostWriters } from '../../painter_host';
import {
  activeStanceBarAbilityId,
  isStanceBarAbilityGroup,
  type StanceBarModel,
  stanceBarView,
} from '../../stance_bar_view';
import { buildStanceControl, type StanceControl } from './stance_control_controller';
import { type StanceRadialModel, stanceRadialView } from './stance_radial_core';

const GROUP_CLASS = 'stancebar-group';
const BUTTON_CLASS = 'stance-btn';
const ACTIVE_CLASS = 'active';
const ICON_CLASS = 'icon-label';
const ARIA_PRESSED_ATTR = 'aria-pressed';

/** The stance-relevant slice of the world, resolved once per frame by Hud. */
export interface StanceWorldInput {
  playerClass: string;
  known: readonly ResolvedAbility[];
  auras: readonly Aura[];
  ownerId: number;
}

export interface StanceBarControllerDeps {
  writers: PainterHostWriters;
  /** The #stancebar element the desktop row is built into. */
  bar: HTMLElement;
  world(): StanceWorldInput;
  /** Whether the touch HUD is live, which is what chooses the shape. */
  isMobileLayout(): boolean;
  /** Resolved icon URL for a stance ability id (shared with the action bars). */
  iconBackground(iconKey: string): string;
  /** The localized name of a known stance ability. */
  abilityName(known: ResolvedAbility): string;
  /** The touch anchor's accessible name, localized by Hud. `stanceName` is the
   *  worn stance's localized name, or null while none is worn. */
  anchorName(stanceName: string | null): string;
  /** The row's tooltip body for a known stance. */
  abilityTooltip(known: ResolvedAbility): string;
  attachTooltip(el: HTMLElement, html: () => string): void;
  hideTooltip(): void;
  /** The long-press chat-log peek guard: a press it consumed is not a click. */
  consumePeekGuard(): boolean;
  clickSfx(): void;
  cast(abilityId: string): void;
}

export class StanceBarController {
  private lastRowSig = '';
  private readonly control: StanceControl | null;
  /** Names are resolved by id from the live known set, which is what lets the
   *  touch control label a petal without carrying a second copy of the roster. */
  private known: readonly ResolvedAbility[] = [];

  constructor(private readonly deps: StanceBarControllerDeps) {
    this.control = buildStanceControl({
      writers: deps.writers,
      iconBackground: (key) => deps.iconBackground(key),
      name: (id) => this.nameOf(id),
      anchorName: (model) =>
        deps.anchorName(model.activeId === null ? null : this.nameOf(model.activeId)),
      cast: (id) => {
        deps.clickSfx();
        deps.cast(id);
      },
      onCancel: () => deps.hideTooltip(),
    });
  }

  /** The per-frame entry point. Resolves the shared model once, then paints
   *  whichever shape this host wears. */
  render(): void {
    const { playerClass, known, auras, ownerId } = this.deps.world();
    const usesChoiceBar = playerClass === 'warrior' || playerClass === 'paladin';
    const knownStances = usesChoiceBar
      ? known.filter((k) => isStanceBarAbilityGroup(k.def.exclusiveGroup))
      : [];
    this.known = knownStances;
    const knownIds = knownStances.map((k) => k.def.id);
    const activeId = activeStanceBarAbilityId(knownIds, auras, ownerId);
    const model = stanceBarView(playerClass, knownIds, activeId);
    if (this.deps.isMobileLayout() && this.control !== null) {
      // The row stands down whole on touch: its seat is the bottom-centre column
      // and the anchor's is the button row, so leaving both up would draw the
      // same choice twice.
      this.clearRow();
      this.control.render(stanceRadialView(model));
      return;
    }
    this.renderRow(model, knownStances);
  }

  private nameOf(abilityId: string): string {
    const known = this.known.find((k) => k.def.id === abilityId);
    return known === undefined ? abilityId : this.deps.abilityName(known);
  }

  // Both teardown paths replace only the .stancebar-group, never the whole
  // subtree: the bar is a movable HUD frame (interface_unlock), so it also
  // hosts the MovableFrame chrome (corner button, resize grip, name chip),
  // which an innerHTML wipe would silently destroy the first time the known
  // stance set changed.
  private clearRow(): void {
    const { bar } = this.deps;
    bar.style.display = 'none';
    if (this.lastRowSig !== '') {
      bar.querySelector(`.${GROUP_CLASS}`)?.remove();
      this.lastRowSig = '';
    }
  }

  private renderRow(model: StanceBarModel, knownStances: readonly ResolvedAbility[]): void {
    const { bar } = this.deps;
    if (!model.visible) {
      this.clearRow();
      return;
    }
    bar.style.display = 'flex';
    if (model.sig === this.lastRowSig) return;
    this.lastRowSig = model.sig;
    bar.querySelector(`.${GROUP_CLASS}`)?.remove();
    const group = document.createElement('div');
    group.className = GROUP_CLASS;
    bar.appendChild(group);
    for (const slot of model.slots) {
      const known = knownStances.find((k) => k.def.id === slot.id);
      if (!known) continue;
      const name = this.deps.abilityName(known);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = BUTTON_CLASS;
      if (slot.active) btn.classList.add(ACTIVE_CLASS);
      btn.setAttribute(ARIA_PRESSED_ATTR, slot.active ? 'true' : 'false');
      btn.title = name;
      btn.setAttribute('aria-label', name);
      const icon = document.createElement('span');
      icon.className = ICON_CLASS;
      icon.style.backgroundImage = `url(${this.deps.iconBackground(slot.iconKey)})`;
      btn.appendChild(icon);
      btn.addEventListener('click', () => {
        if (this.deps.consumePeekGuard()) {
          this.deps.hideTooltip();
          btn.blur();
          return;
        }
        this.deps.clickSfx();
        this.deps.cast(slot.id);
      });
      this.deps.attachTooltip(btn, () => this.deps.abilityTooltip(known));
      group.appendChild(btn);
    }
  }
}
