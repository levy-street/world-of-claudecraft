// The monument impostor's GLSL, alone in a module with NO imports.
//
// Why it is not inline in realm_builder_monument_fx.ts any more: a real-context
// test has to link these exact strings (they shipped uncompilable for the whole
// life of v0.42), and importing the fx module to reach them dragged its whole
// dependency graph into the browser test bundle, measured at +1.2 s of import
// time on a file whose assertions cost 110 ms. A dependency-free source module
// costs nothing to import, so the gate that links the shipped shader is cheap
// enough to keep and cheap enough to extend to the next shader.
//
// Data, not logic: no function and no state. It is still covered on two axes,
// which is the point of splitting it out. tests/realm_builder_monument_impostor_glsl.test.ts
// reads the text in Node for a millisecond (no reserved word used as an
// identifier, the billboard's zeroed Y, the alpha test, the tail order), and
// tests/browser/dry_compile_sources.browser.test.ts links these exact strings
// against a real driver. The consumer is realm_builder_monument_fx.ts's
// buildImpostor. The family is post_finite_guard_glsl.ts's.

/**
 * Billboards about the vertical axis ONLY: a statue that tips to face the
 * camera reads as a card the moment you look down at it from a rise.
 *
 * No variable here may be named `flat`, `smooth`, `sample` or any other GLSL
 * ES 3.00 qualifier. That is not style: `vec3 flat` is a syntax error, it made
 * this shader fail to compile on every driver, and with three's link diagnostic
 * off in production (renderer.ts, debug.checkShaderErrors) nothing reported it.
 */
export const MONUMENT_IMPOSTOR_VERTEX = /* glsl */ `
  #include <fog_pars_vertex>
  uniform vec2 uCell;
  uniform vec2 uCellSize;
  varying vec2 vUv;
  void main() {
    vUv = uCell + uv * uCellSize;
    vec3 right = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);
    vec3 flatRight = normalize(vec3(right.x, 0.0, right.z));
    vec3 world = vec3(
      flatRight.x * position.x,
      position.y,
      flatRight.z * position.x
    );
    vec4 mvPosition = modelViewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

/**
 * The atlas is sRGB-tagged, so the sample is linear like every lit surface,
 * and the tail is the one MeshStandardMaterial ends with (tonemapping,
 * colorspace, fog): a card that skipped it would stand un-fogged and un-toned
 * at the fog wall while every building around it fades, and would shift colour
 * against the body on the frame the two swap.
 */
export const MONUMENT_IMPOSTOR_FRAGMENT = /* glsl */ `
  #include <fog_pars_fragment>
  uniform sampler2D uAtlas;
  varying vec2 vUv;
  void main() {
    vec4 texel = texture2D(uAtlas, vUv);
    // Alpha-TEST, not blend: at this range the billboard has to sort against
    // the town like the solid it stands in for, and a blended quad does not.
    if (texel.a < 0.5) discard;
    gl_FragColor = vec4(texel.rgb, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;
