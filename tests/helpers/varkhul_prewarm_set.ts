/**
 * The Varkhul set's staged roots, built by the same builders the interior
 * encounter prewarm pass calls, the rig aside (building it needs the character
 * asset gate). The real-GL browser test stages exactly these, and the driven
 * Node test holds this list equal to what the pass compiles for the set, so
 * the browser proof cannot drift from the pass it stands for.
 */
import type * as THREE from 'three';
import { buildVarkhulForgePortalPrewarmVisual } from '../../src/render/necromancy_army_portal_fx';
import { buildVarkhulAssemblyPrewarmVisual } from '../../src/render/varkhul_assembly_visual';
import { buildVarkhulEncounterPrewarmVisual } from '../../src/render/varkhul_encounter';
import { buildVarkhulForgeBeamPrewarmVisual } from '../../src/render/varkhul_forge_beam_visual';
import { buildVarkhulForgestormPrewarmVisual } from '../../src/render/varkhul_forgestorm_visual';
import { buildVarkhulInterceptBeamPrewarmVisual } from '../../src/render/varkhul_intercept_beam_visual';
import { buildVarkhulWorldfirePrewarmVisual } from '../../src/render/varkhul_worldfire_visual';

/** `forgestormTwin: false` leaves the Forgestorm warning twin out, for a leg
 *  that isolates what the twin alone covers. */
export function buildVarkhulPrewarmSetRoots(
  opts: { forgestormTwin?: boolean } = {},
): THREE.Object3D[] {
  const roots: THREE.Object3D[] = [
    buildVarkhulEncounterPrewarmVisual(),
    buildVarkhulForgeBeamPrewarmVisual(),
    buildVarkhulInterceptBeamPrewarmVisual(),
    buildVarkhulForgePortalPrewarmVisual().root,
    buildVarkhulWorldfirePrewarmVisual(),
    buildVarkhulAssemblyPrewarmVisual(),
  ];
  if (opts.forgestormTwin !== false) roots.push(buildVarkhulForgestormPrewarmVisual());
  return roots;
}
