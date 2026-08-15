// The Demon Tower's centrepiece: the Demon Core that stands at the middle of
// every arena floor and tears the waves out of the rift. The solid generated
// GLB is part of the authored interior decor, whose key-scoped loader settles
// before the scene attaches. This entity-side builder owns only the shared
// pulse effect, avoiding a one-shot fallback body that could never heal after a
// late load.
//
// A sibling module the rift prop factory delegates to, not another case block
// grown inside door_portal.ts. The GLB is the generated `demon_core` prop (Tripo
// prop lane, see CREDITS.md) and is placed by rift_decor.ts.
//
// Graphics-settings fairness: every tier draws the same GLB at the same position
// and radius as the sim collider. Low only sheds this translucent pulse.

import * as THREE from 'three';
import { DEMON_TOWER_CORE_RADIUS } from '../sim/rift/tower_scaling';

/**
 * Build the Demon Core body for a `rift_tower_core` ground object.
 *
 * `portal` is the pulsing glow shell the renderer already spins/pulses for other
 * rift props, so the core breathes with no per-frame work of its own here.
 */
export function buildDemonTowerCore(lowGfx: boolean): {
  body: THREE.Group;
  portal?: THREE.Mesh;
} {
  const body = new THREE.Group();
  if (lowGfx) return { body };

  // Decoration only, shed on the low tier: a translucent heat shell around the
  // pod. It carries no information a player acts on (the core is never a target
  // and never moves), so dropping it is graphics-fairness safe.
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(DEMON_TOWER_CORE_RADIUS * 1.05, 14, 12),
    new THREE.MeshBasicMaterial({
      color: 0xff5a2a,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.BackSide,
    }),
  );
  shell.position.y = 4.4;
  body.add(shell);

  return { body, portal: shell };
}
