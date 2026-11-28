// The HUD's world markers, built from the Hud's own members on first use (the
// hud_vehicle_bar.ts pattern: Hud members are private, so the factory takes the
// Hud untyped; the members it reads are welded to hud.ts in
// tests/world_markers_hud.test.ts). Every closure reads the Hud live.

import type { IWorld } from '../../../world_api';
import type { PainterHostWriters } from '../../painter_host';
import { WorldMarkerAim } from './world_marker_aim';
import { WorldMarkersController } from './world_markers_controller';

/** The private Hud members the factory reads. */
interface WorldMarkersHost {
  sim: Pick<
    IWorld,
    | 'partyInfo'
    | 'playerId'
    | 'player'
    | 'sharedMapMarks'
    | 'clearSharedMapMarks'
    | 'placeSharedWorldMark'
  >;
  writerFacet: PainterHostWriters;
  keybinds: { primaryLabel(action: string): string };
  renderer: { setGroundAimReticle(aim: null): void };
  playerGroundAim: { cancel(): boolean };
  attachTooltip(element: HTMLElement, html: () => string): void;
}

/** The Hud's one handle: the aim its groundAim seam routes through, and the
 *  party-column control. */
export interface HudWorldMarkers {
  readonly aim: WorldMarkerAim;
  readonly controller: WorldMarkersController;
  /** The marker aim while one is armed, else `fallback` (the spell aim). */
  aimOr<T>(fallback: T): T | WorldMarkerAim;
}

export function createHudWorldMarkers(hud: object): HudWorldMarkers {
  const h = hud as WorldMarkersHost;
  let controller: WorldMarkersController | null = null;
  const aim = new WorldMarkerAim({
    player: () => h.sim.player,
    place: (page, x, y, z, symbol) => h.sim.placeSharedWorldMark(page, x, y, z, symbol),
    clearReticle: () => h.renderer.setGroundAimReticle(null),
    changed: () => controller?.sync(),
  });
  controller = new WorldMarkersController({
    doc: document,
    writers: h.writerFacet,
    world: () => h.sim,
    aim,
    cancelSpellAim: () => h.playerGroundAim.cancel(),
    attachTooltip: (el, html) => h.attachTooltip(el, html),
    keyLabel: (id) => h.keybinds.primaryLabel(id),
    isTouch: () => document.body.classList.contains('mobile-touch'),
  });
  return {
    aim,
    controller,
    aimOr: (fallback) => (aim.isActive() ? aim : fallback),
  };
}
