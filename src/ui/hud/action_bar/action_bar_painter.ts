// Thin painter for the action bar (#actionbar). The pure slot-state rules live in
// action_bar_view.ts; this turns that state into DOM, routing EVERY write through the
// host's elided writers so a no-op frame costs no DOM mutation.
//
// It is constructed as new ActionBarPainter(writers, descriptor, resolveBgImage),
// where the descriptor carries the container + the per-slot element refs and the
// keybind set: multiplicity is a constructor arg, not a hardcoded id, so
// every desktop row and mobile variant can reuse the family without a code fork.
//
// Three Top-risk-1/4 details:
//   - The aria-label routes through the elided setAttr (the per-button cache keyed on
//     the rendered string lives in the facet's attr cache). The core still calls t()
//     every frame to build the string, so the i18n key keeps firing; only the DOM
//     write is elided (Top risk 4). The painter never concats and has no `??`
//     fallback or default param.
//   - The icon is resolved + written only when the slot's icon KEY changes (a local
//     per-slot cache), because resolving the background-image data URL is the
//     expensive part; the host injects the resolver so the painter holds no icon
//     table and no literal URL.
//   - Class / custom-property / attribute writes all go through the multi-slot
//     writers, so one button's many classes never clobber each other's cache.

import type { PainterHostWriters } from '../../painter_host';
import type { ActionBarState } from './action_bar_view';

// Attribute / property / class names the painter drives. Named, not inlined, so the
// painter references no bare DOM string literal.
const ARIA_LABEL_ATTR = 'aria-label';
const BACKGROUND_IMAGE_PROP = 'background-image';
const COOLDOWN_HEIGHT_PROP = 'height';
const CLASS_EMPTY = 'empty';
const CLASS_UNUSABLE = 'unusable';
const CLASS_OUT_OF_RANGE = 'oor';
const CLASS_QUEUED = 'queued';
const CLASS_PROC = 'proc';
const CLASS_EMPOWERED = 'empowered';
const CLASS_MANY_SPELLS = 'many-spells';

/** The DOM refs for one slot the painter writes. */
export interface ActionBarSlotElements {
  btn: HTMLElement;
  label: HTMLElement;
  countEl: HTMLElement;
  keybindEl: HTMLElement;
  cdOverlay: HTMLElement;
  cdText: HTMLElement;
}

/** The paint descriptor: the container plus the per-slot element refs. Instance
 *  multiplicity is this constructor arg, not a hardcoded id. */
export interface ActionBarPaintDescriptor {
  container: HTMLElement;
  slots: readonly ActionBarSlotElements[];
}

export class ActionBarPainter {
  // One cached icon key per slot, null until the first paint, so the (expensive)
  // resolveBackgroundImage call and the background-image write only fire when a slot
  // is rebound. null can never equal a real icon key (every icon key is a string,
  // including the empty-slot key ''), so the first paint always writes each slot.
  private readonly lastIcon: (string | null)[];

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly descriptor: ActionBarPaintDescriptor,
    private readonly resolveBackgroundImage: (iconKey: string) => string,
  ) {
    this.lastIcon = descriptor.slots.map(() => null);
  }

  paint(state: ActionBarState): void {
    this.writers.toggleClass(this.descriptor.container, CLASS_MANY_SPELLS, state.manySpells);

    const slots = this.descriptor.slots;
    for (let i = 0; i < slots.length; i++) {
      const el = slots[i];
      const s = state.slots[i];

      if (this.lastIcon[i] !== s.iconKey) {
        this.lastIcon[i] = s.iconKey;
        this.writers.setStyleProp(
          el.label,
          BACKGROUND_IMAGE_PROP,
          this.resolveBackgroundImage(s.iconKey),
        );
      }

      this.writers.setText(el.countEl, s.count);
      this.writers.setStyleProp(el.cdOverlay, COOLDOWN_HEIGHT_PROP, `${s.cooldownPercent}%`);
      this.writers.setText(el.cdText, s.cdText);

      this.writers.toggleClass(el.btn, CLASS_EMPTY, s.kind === 'empty');
      this.writers.toggleClass(el.btn, CLASS_UNUSABLE, !s.usable);
      this.writers.toggleClass(el.btn, CLASS_OUT_OF_RANGE, s.outOfRange);
      this.writers.toggleClass(el.btn, CLASS_QUEUED, s.queued);
      this.writers.toggleClass(el.btn, CLASS_PROC, s.procGlow);
      this.writers.toggleClass(el.btn, CLASS_EMPOWERED, s.empowered);

      this.writers.setAttr(el.btn, ARIA_LABEL_ATTR, s.ariaLabel);
      this.writers.setText(el.keybindEl, s.keybindLabel);
    }
  }
}
