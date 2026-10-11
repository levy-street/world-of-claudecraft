// The one camera-relative vertex transform for a shader that builds its own
// WORLD-space point (a draped floor patch, a beam between two world spots, a
// GPU-advected particle, any `modelMatrix * position` it then shades with).
//
// Why: the dungeon instance bands sit a hundred thousand yards out (the
// Hollow Crypt at x ~ 100300). There a float32 world point is only good to
// about 0.004 yd, and the old `viewMatrix * world` product on the GPU rounds
// every term of the rotation at that magnitude before the camera's own
// translation cancels it: the view-space depth wobbles by one to two
// hundredths of a yard, differently for every vertex and every camera move.
// That is more than the lift a floor effect floats over the stone (the floor
// itself draws with three's `modelViewMatrix`, composed on the CPU in double
// precision), so floor and effect traded depth as the camera moved: the
// flicker and the broken patches seen in every dungeon.
//
// `wocCamRelView(world)` subtracts the camera FIRST (two nearby float32
// values subtract exactly) and only then rotates a small vector, so the only
// error left is the camera position's own float32 rounding: one rigid shift
// shared by every vertex in the frame, a few thousandths of a yard, which
// never reorders two surfaces. It is the same view-space point
// `viewMatrix * vec4(world, 1.0)` names (viewMatrix is [R | -R c]), so
// visuals are unchanged; it returns the view-space position (name it
// `mvPosition` where the fog chunk reads it).
//
// Splice it at global scope, before any function that calls it. The include
// guard lets two composed chunks both splice it. A shader whose point is
// exactly `modelMatrix * vec4(local, 1.0)` on a positioned mesh may instead
// use three's `modelViewMatrix` directly (the sight field does). Never
// `viewMatrix * <world point>`: tests/camera_relative_floor_shaders.test.ts
// fails it in every floor-ladder module and every dungeon-instance render
// directory.

export const CAMERA_RELATIVE_GLSL = /* glsl */ `
#ifndef WOC_CAMERA_RELATIVE
#define WOC_CAMERA_RELATIVE
vec4 wocCamRelView(vec3 world) {
  return vec4(mat3(viewMatrix) * (world - cameraPosition), 1.0);
}
#endif
`;
