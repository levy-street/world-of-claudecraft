// Pure shader patchers for the raid rooms' roof darkness: a world-height
// black ramp applied AFTER fog, so wall caps, tower tops, chains, and pillar
// heads grade into the roof black no matter where they stand in the room
// (a wall-hugging occluder band cannot catch geometry standing proud of the
// walls). The strength uniform defaults to 0 and only the ignivar light rig
// raises it, so the shared kit materials render unchanged everywhere else.
// String-in string-out and Three-free so it unit-tests headless.

/** Ramp start: just above the ground wall course (nothing at play height
 *  darkens, mobs and players stay untouched). */
export const ROOF_DARK_START_Y = 10.5;
/** Full black here: past the double-height wall top and the tower caps. */
export const ROOF_DARK_END_Y = 22;

export const ROOF_DARK_VERTEX_ANCHOR = '#include <project_vertex>';
export const ROOF_DARK_FRAGMENT_ANCHOR = '#include <fog_fragment>';

const VERTEX_INJECT = `${ROOF_DARK_VERTEX_ANCHOR}
  {
    vec4 roofWorld = modelMatrix * vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      roofWorld = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );
    #endif
    vRoofDarkWorldY = roofWorld.y;
  }`;

const FRAGMENT_INJECT = `${ROOF_DARK_FRAGMENT_ANCHOR}
  gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 0.0 ), uRoofDarkStrength * smoothstep( uRoofDarkStart, uRoofDarkEnd, vRoofDarkWorldY ) );`;

/** Inject the world-Y varying write. Returns the source unchanged when the
 *  anchor is missing or the patch is already present (idempotent). */
export function patchRoofDarknessVertexShader(source: string): string {
  if (source.includes('vRoofDarkWorldY') || !source.includes(ROOF_DARK_VERTEX_ANCHOR))
    return source;
  return `varying float vRoofDarkWorldY;\n${source.replace(ROOF_DARK_VERTEX_ANCHOR, VERTEX_INJECT)}`;
}

/** Inject the post-fog black ramp. Same idempotence contract as the vertex
 *  patcher. */
export function patchRoofDarknessFragmentShader(source: string): string {
  if (source.includes('vRoofDarkWorldY') || !source.includes(ROOF_DARK_FRAGMENT_ANCHOR))
    return source;
  return `varying float vRoofDarkWorldY;\nuniform float uRoofDarkStrength;\nuniform float uRoofDarkStart;\nuniform float uRoofDarkEnd;\n${source.replace(ROOF_DARK_FRAGMENT_ANCHOR, FRAGMENT_INJECT)}`;
}
