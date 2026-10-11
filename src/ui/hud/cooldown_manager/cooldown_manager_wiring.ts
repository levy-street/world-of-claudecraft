// Composition seam for the Cooldown Manager: the one call the Hud makes to stand
// it up, so hud.ts (on the monolith ratchet) spends a single line on it. The Hud
// supplies only what it alone owns (the live world, its writer facet, the aura
// overlay whose hotbar glow set this row unions with); this module attaches the
// shared sfx engine and the desktop-bar test, exactly as aura_overlay_wiring.ts
// does for the Auras panel. Wiring, not logic: every rule is in the pure cores.

import { audio } from '../../../game/audio';
import type { PainterHostWriters } from '../../painter_host';
import {
  CooldownManagerController,
  type CooldownManagerWorld,
} from './cooldown_manager_controller';

/** Whether the desktop action bar is the live bar: the only bar that paints a
 *  proc glow (the same body-class test the Auras panel's Hotbar Glow uses). */
function desktopActionBarLive(): boolean {
  return !document.body.classList.contains('mobile-touch');
}

export function mountCooldowns(
  world: CooldownManagerWorld,
  writers: PainterHostWriters,
  auraOverlay: { readyGlowAbilityIds(): ReadonlySet<string> },
): CooldownManagerController {
  return new CooldownManagerController({
    world,
    writers,
    playCue: (cueId, volume) => audio.auraCue(cueId, volume),
    hotbarGlowAvailable: desktopActionBarLive,
    auraGlowIds: () => auraOverlay.readyGlowAbilityIds(),
  });
}
