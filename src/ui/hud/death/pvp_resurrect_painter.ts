// The death screen's PvP Resurrect button and its note line: the thin painter over
// death_prompt_view.ts. While the death's PVP_RESURRECT_WAIT_SECONDS run the button
// is disabled and counts down, and the note says when the raise opens and that it
// lands at the nearest graveyard; once the wait is over the button reads plain
// "PvP Resurrect" and the note says it is ready. Every write rides the PainterHost
// elided writers (visibility through setStyleProp, so it never shares setText's
// single-slot cache entry), so a frame inside the same second writes nothing. The click is
// bound here too (the server re-checks the wait, the ghost, the instance and jail).

import { durationText } from '../../duration_text';
import { t } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import { bindTouchTap } from '../../touch_tap';
import type { DeathPromptView } from './death_prompt_view';

/** The static markup this paints (index.html and play.html, inside #death-overlay). */
const BUTTON_ID = 'pvp-resurrect-btn';
const NOTE_ID = 'pvp-resurrect-note';

export class PvpResurrectPrompt {
  private readonly button: HTMLElement | null;
  private readonly note: HTMLElement | null;
  /** The last painted state: a press while waiting goes nowhere (a touch tap can
   *  reach a disabled button; the sim and the server refuse it anyway). */
  private waiting = false;

  constructor(
    private readonly writers: Pick<PainterHostWriters, 'setAttr' | 'setStyleProp' | 'setText'>,
    onPress: () => void,
    root: Pick<Document, 'getElementById'> = document,
  ) {
    this.button = root.getElementById(BUTTON_ID);
    this.note = root.getElementById(NOTE_ID);
    if (this.button) {
      bindTouchTap(this.button, () => {
        if (!this.waiting) onPress();
      });
    }
  }

  paint(view: DeathPromptView): void {
    if (!this.button || !this.note) return;
    const w = this.writers;
    // Visibility rides setStyleProp, its own cache slot: setText on the same
    // element would otherwise share the single-slot entry and never elide.
    w.setStyleProp(this.button, 'display', view.pvpResurrect ? '' : 'none');
    w.setStyleProp(this.note, 'display', view.pvpResurrect ? '' : 'none');
    if (!view.pvpResurrect) return;
    const waiting = view.pvpResurrectWait > 0;
    this.waiting = waiting;
    const seconds = durationText(view.pvpResurrectWait);
    w.setText(
      this.button,
      waiting
        ? t('hudChrome.death.pvpResurrectWaitButton', { seconds })
        : t('hudChrome.death.pvpResurrect'),
    );
    w.setAttr(this.button, 'disabled', waiting ? '' : null);
    w.setText(
      this.note,
      waiting
        ? t('hudChrome.death.pvpResurrectWaitNote', { seconds })
        : t('hudChrome.death.pvpResurrectReadyNote'),
    );
  }
}
