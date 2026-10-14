// World clicks and hover on the moving parts of placed building clones (the
// bank's vault door, src/render/placed_movers.ts). Moved out of main.ts's
// world-click and hover-cursor paths so the client keeps one call at each.
//
// Placed kit buildings exist only on authored maps (Tidehold), so the built-in
// world skips the extra raycast outright and its click and hover paths stay
// exactly what they were before the movers landed.

import { PLACED_MOVER_REACH } from '../render/placed_movers';
import type { WorldPicking } from '../render/world_picking';
import { isBuiltinWorldActive } from '../sim/data';
import { t } from '../ui/i18n';

type MoverRenderer = Pick<WorldPicking, 'pickPlacedMover' | 'togglePlacedMover'>;

/** The placed mover under the cursor, or null (always null on the built-in world). */
export function pickPlacedMoverAt(
  renderer: Pick<WorldPicking, 'pickPlacedMover'>,
  clientX: number,
  clientY: number,
  builtinWorld: boolean = isBuiltinWorldActive(),
): ReturnType<WorldPicking['pickPlacedMover']> {
  return builtinWorld ? null : renderer.pickPlacedMover(clientX, clientY);
}

/**
 * A world click on a placed mover: within reach it opens or shuts, out of reach
 * it reports the too-far error. Like a gather node, it is static content with
 * its own raycast, ahead of the sloppy assist. True when the click landed on a
 * mover (the caller stops there), false when it should carry on picking.
 */
export function clickPlacedMover(
  renderer: MoverRenderer,
  hud: { showError(text: string): void },
  playerPos: { x: number; z: number },
  clientX: number,
  clientY: number,
): boolean {
  const mover = pickPlacedMoverAt(renderer, clientX, clientY);
  if (!mover) return false;
  if (Math.hypot(mover.x - playerPos.x, mover.z - playerPos.z) > PLACED_MOVER_REACH) {
    hud.showError(t('questUi.errors.tooFar'));
  } else {
    renderer.togglePlacedMover(mover.id);
  }
  return true;
}
