const PATCH_MARKER = 'WOC_SKIP_ZERO_POINT_LIGHT';
const LOOP_MARKER = 'WOC_POINT_LIGHT_LOOP';
const POINT_SECTION_ANCHOR = '#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )';
const POINT_LOOP_START_ANCHOR =
  '\t#pragma unroll_loop_start\n\tfor ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {\n';
const POINT_LOOP_HEAD = '\tfor ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {\n';
const UNROLL_START_LINE = '\t#pragma unroll_loop_start\n';
const UNROLL_END_LINE = '\t#pragma unroll_loop_end\n';
const POINT_SHADOW_ANCHOR =
  '\t\t#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )';
const POINT_SHADOW_END = '\t\t#endif\n';
const POINT_SHADOW_ARM = '\t#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0\n';
const POINT_INFO_ANCHOR = 'getPointLightInfo( pointLight, geometryPosition, directLight );';
const POINT_DIRECT_ANCHOR =
  'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
const SPOT_LIGHT_ANCHOR = '#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )';
const SUPPORTED_MATERIAL_GUARD =
  '#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )';

function pinnedAnchor(
  source: string,
  anchor: string,
  label: string,
  start = 0,
  end = source.length,
): number {
  const index = source.indexOf(anchor, start);
  if (
    index < 0 ||
    index >= end ||
    (source.indexOf(anchor, index + anchor.length) >= 0 &&
      source.indexOf(anchor, index + anchor.length) < end)
  ) {
    throw new Error(`pinned three point-light chunk ${label} anchor changed`);
  }
  return index;
}

/**
 * three runs its compiled point-light loop for zero-intensity slots.
 * The outer guard is uniform across a draw because pointLight.color is a light
 * uniform. The existing Standard-only attenuation guard stays Standard-only:
 * directLight.visible depends on fragment position near a light cutoff.
 */
function guardPointLightBody(source: string, spotLights: number): string {
  const pointInfo = pinnedAnchor(source, POINT_INFO_ANCHOR, 'point-info', 0, spotLights);
  const pointDirect = pinnedAnchor(
    source,
    POINT_DIRECT_ANCHOR,
    'point-direct',
    pointInfo + POINT_INFO_ANCHOR.length,
    spotLights,
  );
  if (pointInfo >= pointDirect || pointDirect >= spotLights) {
    throw new Error('pinned three point-light chunk anchor order changed');
  }

  const guardedPointInfo = `${SUPPORTED_MATERIAL_GUARD}
\t\t// ${PATCH_MARKER}: uniform-coherent pad-light fast path.
\t\tif ( pointLight.color != vec3( 0.0 ) ) {
\t\t#endif

\t\t${POINT_INFO_ANCHOR}`;
  const guardedPointDirect = `#ifdef STANDARD
\t\tif ( directLight.visible ) {
\t\t#endif

\t\t${POINT_DIRECT_ANCHOR}

\t\t#ifdef STANDARD
\t\t}
\t\t#endif
\t\t${SUPPORTED_MATERIAL_GUARD}
\t\t}
\t\t#endif`;

  return (
    source.slice(0, pointInfo) +
    guardedPointInfo +
    source.slice(pointInfo + POINT_INFO_ANCHOR.length, pointDirect) +
    guardedPointDirect +
    source.slice(pointDirect + POINT_DIRECT_ANCHOR.length)
  );
}

/**
 * The unrolled form inlines one BRDF call chain per light, and fxc under ANGLE
 * D3D11 prices every copy at link time. The point-shadow sub-block reads
 * UNROLLED_LOOP_INDEX, which only three's JS unroller defines, so the plain
 * loop drops it and serves only programs without point shadows; the unrolled
 * arm keeps shadow-casting point lights working.
 *
 * A dynamic loop pays for every idle slot it walks (0.23 ms per slot and
 * full-screen lit layer on an Intel HD 530), so it stops at the first black
 * slot. That is exact only while no live light follows a black one in three's
 * light array: the world scene packs its live lights into the leading
 * carriers (point_light_carriers.ts). The break shares the pad skip's
 * material guard.
 */
function loopPointLights(guarded: string): string {
  const pointSection = pinnedAnchor(guarded, POINT_SECTION_ANCHOR, 'point-section');
  const spotLights = pinnedAnchor(guarded, SPOT_LIGHT_ANCHOR, 'spot-boundary');
  const loopStart = pinnedAnchor(
    guarded,
    POINT_LOOP_START_ANCHOR,
    'point-loop-start',
    pointSection,
    spotLights,
  );
  const loopEnd = pinnedAnchor(guarded, UNROLL_END_LINE, 'point-loop-end', loopStart, spotLights);
  const unrolled = guarded.slice(loopStart, loopEnd + UNROLL_END_LINE.length);

  const body = unrolled.slice(UNROLL_START_LINE.length, -UNROLL_END_LINE.length);
  const shadowStart = pinnedAnchor(body, POINT_SHADOW_ANCHOR, 'point-shadow');
  const shadowEnd = body.indexOf(POINT_SHADOW_END, shadowStart);
  const shadowBlock = shadowEnd < 0 ? '' : body.slice(shadowStart, shadowEnd);
  if (shadowEnd < 0 || shadowBlock.slice(POINT_SHADOW_ANCHOR.length).includes('#')) {
    throw new Error('pinned three point-light chunk point-shadow block changed');
  }
  const loopBody = body.slice(0, shadowStart) + body.slice(shadowEnd + POINT_SHADOW_END.length);
  if (loopBody.includes('UNROLLED_LOOP_INDEX') || loopBody.includes('#pragma')) {
    throw new Error('pinned three point-light chunk loop body still needs the unroller');
  }
  const loop = `${POINT_LOOP_HEAD}
\t\t${SUPPORTED_MATERIAL_GUARD}
\t\tif ( pointLights[ i ].color == vec3( 0.0 ) ) break;
\t\t#endif
${loopBody.slice(POINT_LOOP_HEAD.length)}`;

  return (
    guarded.slice(0, loopStart) +
    POINT_SHADOW_ARM +
    unrolled +
    '\t#else\n' +
    `\t// ${LOOP_MARKER}: one loop body instead of an inlined copy per light.\n` +
    loop +
    '\t#endif\n' +
    guarded.slice(loopEnd + UNROLL_END_LINE.length)
  );
}

export function patchPointLightFragmentChunk(source: string): string {
  if (source.includes(PATCH_MARKER)) return source;
  const spotLights = pinnedAnchor(source, SPOT_LIGHT_ANCHOR, 'spot-boundary');
  return loopPointLights(guardPointLightBody(source, spotLights));
}
