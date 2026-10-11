// The Wickharbor ferry wharf on screen: the one Blender-authored model
// (public/models/props/wickharbor_wharf.glb, scripts/assets/wickharbor_wharf/) placed on the
// waterline at the wharf origin (sim/content/wickharbor_wharf.ts). Its plank field is the
// surface the sim walks (ferry_piers.ts), laid once: the old crossing decks it replaced are
// gone, so nothing draws a second floor in its plane. The rest of Wickharbor's harbor is its
// sibling model in the same wood (wickharbor_harbor.ts).
//
// Which parts a graphics tier keeps is the pure core's call (wickharbor_wharf_core.ts): the
// walkable structure, rails, lanterns and cargo on every tier; the iron trim from medium, the
// loose dressing from high. The painter, its GPU contract (props-root build, props material
// prewarm) and its residency are the shared tiered model's (tiered_vertex_colour_model.ts);
// the resetter is registered in assets/graphics_profile.ts. Nothing here runs per frame.

import { WICKHARBOR_WHARF_ORIGIN } from '../sim/content/wickharbor_wharf';
import { registerDeferredPreload } from './assets/preload';
import { tieredVertexColourModel } from './tiered_vertex_colour_model';
import { wickharborWharfParts } from './wickharbor_wharf_core';

const WHARF_URL = '/models/props/wickharbor_wharf.glb';

const wharf = tieredVertexColourModel({
  url: WHARF_URL,
  name: 'wickharborWharf',
  label: 'wickharbor wharf',
  parts: wickharborWharfParts,
  origin: WICKHARBOR_WHARF_ORIGIN,
});

export const prepareWickharborWharfAssets = wharf.prepare;

if (typeof window !== 'undefined') registerDeferredPreload(prepareWickharborWharfAssets);

/** Drop the prepared templates (graphics-profile rebuilds convert materials anew; the parsed
 *  source survives). Registered in assets/graphics_profile.ts. */
export const resetWickharborWharfCaches = wharf.reset;

/** The wharf, built once into the props root (built-in world only). */
export const buildWickharborWharf = wharf.build;

/** The wharf's distinct (geometry, material) programs at the live tier, for the props
 *  material prewarm (props.ts). Empty until buildProps has built the wharf. */
export const wickharborWharfPrewarmParts = wharf.prewarmParts;

export const wickharborWharfInternalsForTest = {
  assetUrl: WHARF_URL,
  /** Hand a parsed GLB to the preload slot (Node tests have no fetch path). */
  setLoadedGltfForTest: wharf.setLoadedGltfForTest,
};
