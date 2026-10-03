// The Graveyard Shift's HUD state while the player holds the Morthen identity.
// The kit itself shows on the NORMAL action bar and the pad's cross hotbar (a
// possess-bar override, src/game/morthen_controls.ts), so this owns no bar: it
// stamps the morthen-shift body class (the bars Morthen has no use for stand
// down), cancels a ground aim or empowered hold carried in, asks the pad bar to
// re-show its resting row when the kit comes or goes, and shows each kit hint
// line (morthen_hint_view.ts) through the HUD banner.

import { morthenControlsActive } from '../../../game/morthen_controls';
import type { IWorld } from '../../../world_api';
import type { PainterHostWriters } from '../../painter_host';
import {
  createMorthenHints,
  MORTHEN_HINT_MS,
  type MorthenHintId,
  morthenCorpseInReach,
  morthenHintText,
} from './morthen_hint_view';

export const MORTHEN_SHIFT_BODY_CLASS = 'morthen-shift';

export type MorthenShiftWorld = Pick<IWorld, 'player' | 'entities'>;

export interface MorthenShiftDeps {
  world: MorthenShiftWorld;
  writers: PainterHostWriters;
  cancelOnEnter: readonly { cancel(): void }[];
  showHint(text: string, durationMs: number): void;
  refreshPadBar(): void;
  now?(): number;
}

export class MorthenShiftController {
  private readonly hints = createMorthenHints();
  private active = false;
  private hintId: MorthenHintId | null = null;
  private readonly corpseInReach = (): boolean =>
    morthenCorpseInReach(this.deps.world.entities.values(), this.deps.world.player);

  constructor(private readonly deps: MorthenShiftDeps) {}

  update(): void {
    const active = morthenControlsActive(this.deps.world);
    if (active !== this.active) {
      this.active = active;
      if (active) for (const controller of this.deps.cancelOnEnter) controller.cancel();
      else {
        this.hints.reset();
        this.hintId = null;
      }
      this.deps.writers.toggleClass(document.body, MORTHEN_SHIFT_BODY_CLASS, active);
      this.deps.refreshPadBar();
    }
    if (!active) return;
    const now = this.deps.now?.() ?? performance.now();
    const id = this.hints.tick(now, this.deps.world.player.resource, this.corpseInReach);
    if (id === this.hintId) return;
    this.hintId = id;
    if (id !== null) this.deps.showHint(morthenHintText(id), MORTHEN_HINT_MS);
  }
}
