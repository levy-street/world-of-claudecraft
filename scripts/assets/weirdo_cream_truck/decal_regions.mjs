// Where each Weirdo Cream decal lives inside the signage atlas.
//
// Its own leaf module because BOTH sides of the export need it and only one of
// them can have Node builtins: the browser factory (model.js, bundled by esbuild
// for the headless page) reads the regions to author its quads' UVs, while the
// Node rasterizer (decal_atlas.mjs) reads them to paint. Importing the
// rasterizer from the factory would drag sharp into the browser bundle, which
// does not resolve.

/** Atlas edge in pixels. One texture, three regions, mip-friendly. */
export const DECAL_ATLAS_SIZE = 1024;

/** Region rectangles in UV units, v measured from the top. The banner is 2:1;
 *  the portrait and badge are square. */
export const DECAL_REGIONS = Object.freeze({
  banner: Object.freeze({ u0: 0, v0: 0, u1: 1, v1: 0.5 }),
  portrait: Object.freeze({ u0: 0, v0: 0.5, u1: 0.5, v1: 1 }),
  badge: Object.freeze({ u0: 0.5, v0: 0.5, u1: 1, v1: 1 }),
});
