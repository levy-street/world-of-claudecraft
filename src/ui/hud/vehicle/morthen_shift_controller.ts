// The Graveyard Shift's HUD state while the player holds the Morthen identity.
// The kit itself shows on the NORMAL action bar and the pad's cross hotbar (a
// possess-bar override, src/game/morthen_controls.ts), so this owns no bar: it
// stamps the morthen-shift body class (the bars Morthen has no use for stand
// down, and the player frame wears the boss rank), names the player frame
// after Morthen, cancels a ground aim or empowered hold carried in, asks the
// pad bar to re-show its resting row when the kit comes or goes, writes each
// kit hint line (morthen_hint_view.ts) to the chat log as a tip, and drives
// the lost shift's fade to black (morthen_fade_view.ts).

import { morthenControlsActive } from '../../../game/morthen_controls';
import { isGraveyardShiftDefeated } from '../../../sim/graveyard_shift/shift_end_marks';
import type { IWorld } from '../../../world_api';
import { playerFrameName } from '../../graveyard_shift_text_core';
import { getI18nRevision } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import { createMorthenFade } from './morthen_fade_view';
import {
  createMorthenHints,
  type MorthenHintId,
  morthenCorpseInReach,
  morthenHintText,
  morthenStaffExitStanding,
} from './morthen_hint_view';

export const MORTHEN_SHIFT_BODY_CLASS = 'morthen-shift';
export const MORTHEN_FADE_CLASS = 'gshift-fade';

export type MorthenShiftWorld = Pick<IWorld, 'player' | 'entities'>;

export interface MorthenShiftDeps {
  world: MorthenShiftWorld;
  writers: PainterHostWriters;
  cancelOnEnter: readonly { cancel(): void }[];
  showHint(text: string): void;
  refreshPadBar(): void;
  now?(): number;
}

export class MorthenShiftController {
  private readonly hints = createMorthenHints();
  private readonly fade = createMorthenFade();
  private readonly veil = document.createElement('div');
  private readonly frameName = document.getElementById('pf-name');
  private active = false;
  private hintId: MorthenHintId | null = null;
  private nameRevision = -1;
  private readonly corpseInReach = (): boolean =>
    morthenCorpseInReach(this.deps.world.entities.values(), this.deps.world.player);
  private readonly staffExitStanding = (): boolean =>
    morthenStaffExitStanding(this.deps.world.entities.values());

  constructor(private readonly deps: MorthenShiftDeps) {
    this.veil.className = MORTHEN_FADE_CLASS;
    this.veil.setAttribute('aria-hidden', 'true');
    document.body.append(this.veil);
  }

  update(): void {
    const player = this.deps.world.player;
    const now = this.deps.now?.() ?? performance.now();
    // The fade outlives the identity: it lifts after the teardown sent us home.
    const opacity = this.fade.tick(now, isGraveyardShiftDefeated(player));
    this.deps.writers.setStyleProp(this.veil, 'opacity', opacity.toFixed(2));
    const active = morthenControlsActive(this.deps.world);
    if (active !== this.active) {
      this.active = active;
      if (active) for (const controller of this.deps.cancelOnEnter) controller.cancel();
      else {
        this.hints.reset();
        this.hintId = null;
      }
      this.nameRevision = -1;
      this.deps.writers.toggleClass(document.body, MORTHEN_SHIFT_BODY_CLASS, active);
      this.deps.refreshPadBar();
    }
    // Written on the identity edge and on a language change, never per frame.
    const revision = getI18nRevision();
    if (this.frameName && revision !== this.nameRevision) {
      this.nameRevision = revision;
      this.deps.writers.setText(this.frameName, playerFrameName(player));
    }
    if (!active) return;
    const id = this.hints.tick(now, player.resource, this.corpseInReach, this.staffExitStanding);
    if (id === this.hintId) return;
    this.hintId = id;
    if (id !== null) this.deps.showHint(morthenHintText(id));
  }
}
