// Composition seam for the aura overlay: the two blocks the Hud used to spell out
// inline to stand the feature up and hand it to Options > Auras.
//
// Both are pure DELEGATION, and neither needs any of the Hud's private mutable
// state, which is the deciding question in root CLAUDE.md (Modularity): if the
// code does not need the coordinator's live state, it is a sibling module, every
// time. The Hud keeps only what it alone knows (the world readers, the icon
// source, the audio sink) and this module owns the rest:
//
//   createAuraOverlayController  mounts the reticle tick ring and builds the
//     controller with its OUTPUT channels attached (rumble and reticle here,
//     ground rings and cue audio passed through from the Hud).
//   auraOverlaySettingsHooks     projects that controller into the
//     `AuraOverlayHooks` surface the Options window consumes.
//
// This is wiring, not logic. Every rule the feature has lives in the pure cores
// beside it (aura_watchlist_core, proc_ready_glow_core, reticle_ticks_core,
// haptic_pulse_core) and is unit-tested there, so there is deliberately no
// behavior here for a test to pin that those tests do not already cover.

import { playAuraHaptic } from '../game/haptics';
import type { PlayerClass } from '../sim/types';
import { AuraOverlayController, type AuraOverlayControllerDeps } from './aura_overlay_controller';
import type { AuraOverlayHooks } from './aura_overlay_settings';
import type { ReticleTicksState } from './reticle_ticks_core';
import { ReticleTicksPainter } from './reticle_ticks_painter';

/** What the Hud alone can supply. The channels this module owns are omitted. */
export type AuraOverlayWiringDeps = Omit<
  AuraOverlayControllerDeps,
  'playHaptic' | 'paintReticleTicks'
>;

/**
 * Build the controller with its notification channels attached, mounting the
 * reticle tick ring under `host` (the document body by default, which is where
 * the Hud mounted it when this was inline).
 */
export function createAuraOverlayController(
  deps: AuraOverlayWiringDeps,
  host?: HTMLElement,
): AuraOverlayController {
  const doc = deps.doc ?? document;
  const reticleRoot = ReticleTicksPainter.buildRoot(doc);
  (host ?? doc.body).appendChild(reticleRoot);
  const reticleTicks = new ReticleTicksPainter(deps.writers, reticleRoot);
  return new AuraOverlayController({
    ...deps,
    playHaptic: (shape) => playAuraHaptic(shape),
    paintReticleTicks: (state) => reticleTicks.paint(state as unknown as ReticleTicksState),
  });
}

/**
 * The Options > Auras surface over one controller. `playerClass` and
 * `previewCue` stay injected because the class comes from the live world and the
 * audition sink is the Hud's shared sfx engine.
 */
export function auraOverlaySettingsHooks(
  controller: AuraOverlayController,
  deps: {
    playerClass: () => PlayerClass;
    previewCue: (cueId: string, volume: number) => void;
  },
): AuraOverlayHooks {
  return {
    playerClass: deps.playerClass,
    previewCue: deps.previewCue,
    defs: () => controller.defs(),
    get: (id) => controller.get(id),
    patch: (id, patch) => controller.patch(id, patch),
    getLayout: () => controller.getLayout(),
    patchLayout: (patch) => controller.patchLayout(patch),
    watchOptions: () => controller.watchOptions(),
    setWatched: (id, on) => controller.setWatched(id, on),
    reset: (id) => controller.reset(id),
    nudge: (id, part, deltaX, deltaY) => controller.nudge(id, part, deltaX, deltaY),
    setAll: (enabled) => controller.setAll(enabled),
    beginPlacement: (id, part) => controller.beginPlacement(id, part),
    endPlacement: () => controller.endPlacement(),
    setPlacement: (on) => controller.setPlacement(on),
    onPositionChange: (listener) => controller.onPositionChange(listener),
    onPlacementChange: (listener) => controller.onPlacementChange(listener),
  };
}
