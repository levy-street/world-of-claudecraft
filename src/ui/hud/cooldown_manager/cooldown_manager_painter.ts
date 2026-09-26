// The Cooldown Manager's per-frame DOM writer. It builds nothing and decides
// nothing: the controller mints the group and button elements when the groups
// change, the pure core (cooldown_manager_view.ts) decides every button state
// and the controller decides which groups show; this writes the result through
// the elided PainterHostWriters so a steady frame touches no DOM.
//
// Buttons wear the library socket family (`.ui-socket`), so the cooldown sweep,
// the proc rim and the unusable/out-of-range filters are the action bar's own
// look: `is-on` is the ready glow, `is-proc` the transform or class proc.

import type { PainterHostWriters } from '../../painter_host';
import type { CooldownManagerState } from './cooldown_manager_view';

/** The elements one floating button owns. */
export interface CooldownButtonElements {
  btn: HTMLElement;
  art: HTMLElement;
  cd: HTMLElement;
  cdText: HTMLElement;
  count: HTMLElement;
}

const DISPLAY_PROP = 'display';
const VISIBILITY_PROP = 'visibility';
const BACKGROUND_IMAGE_PROP = 'background-image';
const COOLDOWN_FILL_PROP = '--cd-fill';

export class CooldownManagerPainter {
  private lastIcon: string[] = [];

  constructor(
    private readonly writers: PainterHostWriters,
    /** CSS background-image value for an icon key (`ability:<id>`). */
    private readonly iconBackground: (iconKey: string) => string,
  ) {}

  /** Forget icon memos after the controller re-mints the buttons. */
  reset(count: number): void {
    this.lastIcon = new Array<string>(count).fill('');
  }

  /**
   * `buttons[i]` pairs with `state.buttons[i]`; `groups[g]` shows when
   * `groupShown[g]`. A hidden button keeps its cell (visibility, not display),
   * so a grid never reflows when one spell goes out of sight.
   */
  paint(
    layer: HTMLElement,
    shown: boolean,
    groups: readonly HTMLElement[],
    groupShown: readonly boolean[],
    buttons: readonly CooldownButtonElements[],
    state: CooldownManagerState,
  ): void {
    const w = this.writers;
    w.setStyleProp(layer, DISPLAY_PROP, shown ? '' : 'none');
    if (!shown) return;
    for (let g = 0; g < groups.length; g++) {
      w.setStyleProp(groups[g], DISPLAY_PROP, groupShown[g] ? '' : 'none');
    }
    for (let i = 0; i < buttons.length; i++) {
      const el = buttons[i];
      const s = state.buttons[i];
      if (!s) continue;
      w.setStyleProp(el.btn, VISIBILITY_PROP, s.visible ? '' : 'hidden');
      if (!s.visible) continue;
      if (this.lastIcon[i] !== s.iconKey) {
        this.lastIcon[i] = s.iconKey;
        w.setStyleProp(el.art, BACKGROUND_IMAGE_PROP, this.iconBackground(s.iconKey));
      }
      w.toggleClass(el.btn, 'is-ready', s.ready);
      w.toggleClass(el.btn, 'is-on', s.glow);
      w.toggleClass(el.btn, 'is-proc', s.proc);
      w.toggleClass(el.btn, 'is-unusable', s.unusable);
      w.toggleClass(el.btn, 'is-oor', s.outOfRange);
      w.setStyleProp(el.cd, COOLDOWN_FILL_PROP, `${s.cooldownPercent}%`);
      w.setText(el.cdText, s.cdText);
      w.setText(el.count, s.count);
    }
  }
}
