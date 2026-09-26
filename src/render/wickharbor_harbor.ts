// Wickharbor's wooden harbor on screen: the one Blender-authored model
// (public/models/props/wickharbor_harbor.glb, scripts/assets/wickharbor_harbor/) placed on the
// waterline at the harbor frame's origin, the boardwalk's centre (WICKHARBOR_HARBOR_FRAME in
// sim/content/wickharbor_harbor.ts; the model reaches from there to the Beacon dock): the shore
// boardwalk, the great quay with its crane and cargo shelter, the two piers out from it, the
// two bluff stairs and the Old Beacon's dock and stair, in
// the ferry wharf's wood (its sibling model, wickharbor_wharf.ts). Its plank fields are the
// surfaces the sim walks (sim/gale_harbor.ts), each laid once and clipped to its deck, so no
// two floors share a plane on screen either.
//
// Which parts a graphics tier keeps is the pure core's call (wickharbor_harbor_core.ts): the
// walkable structure, rails, lanterns and cargo on every tier; the iron trim from medium, the
// loose dressing from high. The painter, its GPU contract (props-root build, props material
// prewarm) and its residency (about 31k triangles, 19k on low, the parsed GLB and the per-tier templates
// kept for the session) are the shared tiered model's (tiered_vertex_colour_model.ts); the
// resetter is registered in assets/graphics_profile.ts. Nothing here runs per frame.

import { WICKHARBOR_HARBOR_FRAME } from '../sim/content/wickharbor_harbor';
import { registerDeferredPreload } from './assets/preload';
import { tieredVertexColourModel } from './tiered_vertex_colour_model';
import { wickharborHarborParts } from './wickharbor_harbor_core';

const HARBOR_URL = '/models/props/wickharbor_harbor.glb';

const harbor = tieredVertexColourModel({
  url: HARBOR_URL,
  name: 'wickharborHarbor',
  label: 'wickharbor harbor',
  parts: wickharborHarborParts,
  origin: WICKHARBOR_HARBOR_FRAME,
});

export const prepareWickharborHarborAssets = harbor.prepare;

if (typeof window !== 'undefined') registerDeferredPreload(prepareWickharborHarborAssets);

/** Drop the prepared templates (graphics-profile rebuilds convert materials anew; the parsed
 *  source survives). Registered in assets/graphics_profile.ts. */
export const resetWickharborHarborCaches = harbor.reset;

/** The harbor, built once into the props root (built-in world only). */
export const buildWickharborHarbor = harbor.build;

/** The harbor's distinct (geometry, material) programs at the live tier, for the props
 *  material prewarm (props.ts). Empty until buildProps has built the harbor. */
export const wickharborHarborPrewarmParts = harbor.prewarmParts;

export const wickharborHarborInternalsForTest = {
  assetUrl: HARBOR_URL,
  /** Hand a parsed GLB to the preload slot (Node tests have no fetch path). */
  setLoadedGltfForTest: harbor.setLoadedGltfForTest,
};
