// The Forgefather's Isle fortress render: builds the owner's baked exterior
// pass (src/sim/forgefather_fortress.ts, world-space placements) through the
// SAME appendIgnivarEnvProps path the raid dressing uses, so a piece looks
// identical inside and out. Composed into buildEmberFeatures' view: the
// fortress rides the ember zone-feature group and inherits its gated
// attach, freeze, shadow policy, and cull for free (and the renderer
// coordinator grows by zero lines).
import * as THREE from 'three';
import { FORGEFATHER_FORTRESS_PLACEMENTS } from '../sim/forgefather_fortress';
import { registerDeferredPreload } from './assets/preload';
import { appendIgnivarEnvProps, prepareIgnivarEnvProps } from './ignivar_env_props';
import { appendIgnivarMistGates } from './ignivar_mist_gate';
import { addPropGlowPools } from './ignivar_raid_dressing';

// World content: the prop GLBs load in the deferred lane so reaching the
// home screen never decodes them (the preload doctrine); buildEmberFeatures
// runs after assetsReady, so the templates are resident by build time.
registerDeferredPreload(() => prepareIgnivarEnvProps());

/** Build the fortress group (world coordinates; the caller parents it into
 *  the ember features view). Full-quality shadows: the zone-feature shadow
 *  policy governs casting at attach, not the interior lowGfx shed. */
export function buildForgefatherFortress(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'forgefatherFortress';
  // Street lamps render through src/render/streetlamps.ts (the fixture,
  // its flame, and its REAL night light come from the town-lamp pipeline
  // that colliders.ts hands the fortress lamp sites to); the env-prop
  // template here exists only for the placer's live preview.
  const placements = FORGEFATHER_FORTRESS_PLACEMENTS.filter((p) => p.key !== 'street_lamp');
  appendIgnivarEnvProps(group, placements, false);
  addPropGlowPools(group, placements, false);
  // Every placed dungeon_entrance facade gets its boss-gate fog wall over
  // the facade's red membrane (the owner's authored mist target).
  appendIgnivarMistGates(group, placements);
  return group;
}
