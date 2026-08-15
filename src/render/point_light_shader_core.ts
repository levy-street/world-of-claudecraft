const PATCH_MARKER = 'WOC_SKIP_ZERO_POINT_LIGHT';
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
    throw new Error(`Three r165 point-light chunk ${label} anchor changed`);
  }
  return index;
}

/**
 * Three r165 runs its compiled point-light loop for zero-intensity pad slots.
 * The outer guard is uniform across a draw because pointLight.color is a light
 * uniform. The existing Standard-only attenuation guard stays Standard-only:
 * directLight.visible depends on fragment position near a light cutoff.
 */
export function patchPointLightFragmentChunk(source: string): string {
  if (source.includes(PATCH_MARKER)) return source;

  const spotLights = pinnedAnchor(source, SPOT_LIGHT_ANCHOR, 'spot-boundary');
  const pointInfo = pinnedAnchor(source, POINT_INFO_ANCHOR, 'point-info', 0, spotLights);
  const pointDirect = pinnedAnchor(
    source,
    POINT_DIRECT_ANCHOR,
    'point-direct',
    pointInfo + POINT_INFO_ANCHOR.length,
    spotLights,
  );
  if (pointInfo >= pointDirect || pointDirect >= spotLights) {
    throw new Error('Three r165 point-light chunk anchor order changed');
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
