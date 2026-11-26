// The shared-soak marker for a soak carried on a player (Varkhul's Shared Pyre
// in fire, Balgath's Barrow Burden in shadow): the one look every "stack on
// the marked player and share it" circle wears (floor_telegraph/
// soak_marker.ts): the element's vortex, the crisp rim at the sim's radius,
// rings converging on the middle, inward chevrons, wisps rising, a pip per
// player the soak wants (lit one per player inside: the old occupancy runes)
// and the countdown arc (the old timer band). The marker blooms in when the
// mark shows and is drawn back into the middle when it goes.

import * as THREE from 'three';
import {
  VARKHUL_SHARED_PYRE_RADIUS,
  VARKHUL_SHARED_PYRE_REQUIRED_NORMAL,
} from '../sim/varkhul_shared_pyre';
import { buildSoakMarkerGeometry, SoakMarker } from './floor_telegraph/soak_marker';
import type { SoakElement } from './floor_telegraph/soak_marker_core';
import { floorVfxRenderOrder } from './floor_vfx_layer';

export const IGNIVAR_SOAK_VISUAL_NAME = 'ignivarSoakCircle';
/** The marker's group, its floor disc and its rising wisps. */
export const IGNIVAR_SOAK_MARKER_NAME = 'ignivarSoak';
export const IGNIVAR_SOAK_DISC_NAME = 'ignivarSoakDisc';
export const IGNIVAR_SOAK_WISPS_NAME = 'ignivarSoakWisps';

/** The encounter-band rung of the disc (the wisps take the next). */
const SOAK_RUNG = 2;

/**
 * The look of one shared-soak marker: the sim's radius and the element that
 * drives its palette. The default is the Shared Pyre's fire; Balgath's Barrow
 * Burden (balgath_ranged_fx.ts) passes its own radius and element and keeps
 * its own dust vortex overhead.
 */
export interface SoakTelegraphStyle {
  radius: number;
  element: SoakElement;
}

export const IGNIVAR_SOAK_DEFAULT_STYLE: Readonly<SoakTelegraphStyle> = Object.freeze({
  radius: VARKHUL_SHARED_PYRE_RADIUS,
  element: 'fire',
});

export function buildIgnivarSoakTelegraph(
  requiredPlayers = VARKHUL_SHARED_PYRE_REQUIRED_NORMAL,
  style: Readonly<SoakTelegraphStyle> = IGNIVAR_SOAK_DEFAULT_STYLE,
): THREE.Group {
  const materials: THREE.Material[] = [];
  const marker = new SoakMarker(
    buildSoakMarkerGeometry(),
    materials,
    SOAK_RUNG,
    IGNIVAR_SOAK_MARKER_NAME,
  );
  // On the encounter band over every player ground piece (the marker sets
  // the same rungs; restated here, the module's own place on the ladder).
  marker.disc.renderOrder = floorVfxRenderOrder('encounter', SOAK_RUNG);
  marker.wisps.renderOrder = floorVfxRenderOrder('encounter', SOAK_RUNG + 1);
  // The owner places the root; the marker lays itself at the root's origin.
  const root = new THREE.Group();
  root.name = IGNIVAR_SOAK_VISUAL_NAME;
  root.userData.renderCategory = 'ui3d';
  root.userData.requiredPlayers = Math.max(1, Math.floor(requiredPlayers));
  root.userData.occupancySlots = root.userData.requiredPlayers;
  root.userData.soakMarker = marker;
  root.userData.soakStyle = style;
  root.userData.elapsed = 0;
  root.add(marker.group);
  // Laid once (held still) so a prewarm or a test sees it whole and
  // yard-true; the root stays hidden until a sync shows it.
  marker.paint({
    x: 0,
    y: 0,
    z: 0,
    radius: style.radius,
    element: style.element,
    fill: 0,
    clock: 0,
    reduced: true,
    need: root.userData.requiredPlayers,
    have: 0,
    timer: 0,
  });
  root.visible = false;
  return root;
}

/** The marker a built soak telegraph carries. */
export function soakMarkerOf(root: THREE.Object3D): SoakMarker | null {
  return (root.userData.soakMarker as SoakMarker | undefined) ?? null;
}

export function syncIgnivarSoakTelegraph(
  root: THREE.Object3D,
  visible: boolean,
  playersInside: number,
  requiredPlayers: number,
  progress: number,
  inverseEntityScale: number,
  dt: number,
  reducedMotion = false,
): void {
  const marker = soakMarkerOf(root);
  root.scale.setScalar(inverseEntityScale);
  root.userData.playersInside = Math.max(0, Math.floor(playersInside));
  root.userData.requiredPlayers = Math.max(1, Math.floor(requiredPlayers));
  root.userData.progress = Math.max(0, Math.min(1, progress));
  root.userData.ready = visible && root.userData.playersInside >= root.userData.requiredPlayers;
  root.userData.elapsed = Number(root.userData.elapsed ?? 0) + Math.max(0, dt);
  const clock = Number(root.userData.elapsed);
  if (!marker) {
    root.visible = visible;
    return;
  }
  if (!visible) {
    // The mark is gone: the marker is drawn back into the middle, then hides
    // (at once under reduced motion, or if it never showed).
    if (!root.visible) marker.hide();
    marker.release();
    marker.settle(clock);
    root.visible = marker.shown;
    return;
  }
  // A root shown fresh (or again) blooms in.
  if (!root.visible) marker.hide();
  const style =
    (root.userData.soakStyle as SoakTelegraphStyle | undefined) ?? IGNIVAR_SOAK_DEFAULT_STYLE;
  marker.paint({
    x: 0,
    y: 0,
    z: 0,
    radius: style.radius,
    element: style.element,
    fill: root.userData.progress,
    clock,
    reduced: reducedMotion,
    need: root.userData.requiredPlayers,
    have: root.userData.playersInside,
    timer: root.userData.progress,
  });
  root.visible = true;
}
