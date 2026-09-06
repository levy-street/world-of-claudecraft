// The waystone arches: one modeled stone arch + portal swirl on EACH side of
// every `gate: 'waystone'` overworld portal (PORTALS, today the Wyrmgate
// Waystone in content/drakelands.ts), so a tolled crossing reads as a gate you
// walk through, not an invisible spot. The body is the dungeon-door family
// (door_portal.ts buildDoorBody: the same arch, plinths, and additive swirl
// every dungeon entrance wears, so the prewarm and shared-material story is
// already paid), seated on the terrain and turned to face its own landing,
// which is the direction a traveler walks through it.
//
// Renderer wiring: one entry of static_world_dressing.ts, attached through
// attachZoneFeature like the Duskfall cave mouths (hollow_gates.ts). That
// attach freezes every matrix in the group, so the swirl spins itself from an
// onBeforeRender hook that recomposes only its own matrices (the jail gate's
// swirl precedent, jail_scene.ts): no per-frame renderer call, no thaw of the
// static arch around it. The swirl gets its OWN copy of the door membrane
// material (an owned clone, shared_resource.ts): the shared one is written
// per frame by whichever dungeon-door entity is in view, so a static arch on
// it would read as a constant membrane at a brightness decided elsewhere in
// the world. The hook pulses the owned copy the way the door loop pulses
// the shared one. Each side registers as its own cull group, so the far arch
// culls on its own footprint instead of one world-spanning box.

import * as THREE from 'three';
import { PORTALS } from '../sim/data';
import type { PortalDef, PortalSide } from '../sim/types';
import { terrainHeight } from '../sim/world';
import { buildDoorBody } from './door_portal';
import { markOwnedMaterial } from './shared_resource';

export interface WaystonePortalsView {
  group: THREE.Group;
  /** One cull footprint per arch: the two sides are zones apart. */
  cullGroups: THREE.Group[];
}

const SWIRL_SPIN_RATE = 1.4; // rad/s, the dungeon-door swirl's rate
const SWIRL_PULSE_RATE = 2.2; // the door loop's opacity pulse

/** Yaw that points an arch's walk-through axis (+z of the door body) at the
 *  side's landing, so a traveler crosses the swirl face-on. */
export function waystoneFacing(side: PortalSide): number {
  return Math.atan2(side.landing.x - side.x, side.landing.z - side.z);
}

/** The portals that wear an arch: every `gate: 'waystone'` record. */
export function waystonePortals(portals: readonly PortalDef[] = PORTALS): PortalDef[] {
  return portals.filter((portal) => portal.gate === 'waystone');
}

function spinSwirl(swirl: THREE.Mesh, phase: number): void {
  const t = (performance.now() % 3_600_000) / 1000;
  swirl.rotation.z = t * SWIRL_SPIN_RATE;
  (swirl.material as THREE.MeshBasicMaterial).opacity =
    0.45 + Math.sin(t * SWIRL_PULSE_RATE + phase) * 0.15;
  // The group is matrix-frozen (attachZoneFeature): recompose this mesh only,
  // against the parent's baked world matrix, before the renderer reads it.
  // updateMatrix flags matrixWorldNeedsUpdate; clear it, or the next scene
  // walk recomposes this node a second time and the freeze is defeated.
  swirl.updateMatrix();
  if (swirl.parent) swirl.matrixWorld.multiplyMatrices(swirl.parent.matrixWorld, swirl.matrix);
  swirl.matrixWorldNeedsUpdate = false;
}

export function buildWaystonePortals(
  seed: number,
  lowGfx: boolean,
  portals: readonly PortalDef[] = PORTALS,
): WaystonePortalsView {
  const group = new THREE.Group();
  group.name = 'waystone-portals';
  const cullGroups: THREE.Group[] = [];
  for (const portal of waystonePortals(portals)) {
    for (const [i, side] of [portal.a, portal.b].entries()) {
      const { body, portal: swirl } = buildDoorBody(true, null, lowGfx);
      body.name = `waystone:${portal.id}`;
      body.position.set(side.x, terrainHeight(side.x, side.z, seed), side.z);
      body.rotation.y = waystoneFacing(side);
      if (swirl) {
        swirl.material = markOwnedMaterial((swirl.material as THREE.Material).clone());
        swirl.userData.waystoneSwirl = true;
        const phase = i * Math.PI;
        swirl.onBeforeRender = () => spinSwirl(swirl, phase);
      }
      group.add(body);
      cullGroups.push(body);
    }
  }
  return { group, cullGroups };
}
