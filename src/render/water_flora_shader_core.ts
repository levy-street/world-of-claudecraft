// Pure shader-source transform for water flora. The shipped GLBs bind one
// packed occlusion, roughness, and metalness image through equivalent texture
// samplers. The runtime adapter guards that identity before applying this.

/** Reuse the roughness-map texel for the packed ORM R, G, and B channels. */
export function reusePackedOrmSample(fragmentShader: string): string {
  return fragmentShader
    .replace(
      '#include <roughnessmap_fragment>',
      `float roughnessFactor = roughness;

#ifdef USE_ROUGHNESSMAP

  vec4 waterFloraOrm = texture2D( roughnessMap, vRoughnessMapUv );
  roughnessFactor *= waterFloraOrm.g;

#endif`,
    )
    .replace(
      '#include <metalnessmap_fragment>',
      `float metalnessFactor = metalness;

#ifdef USE_METALNESSMAP

  metalnessFactor *= waterFloraOrm.b;

#endif`,
    )
    .replace(
      '#include <aomap_fragment>',
      `#ifdef USE_AOMAP

  float ambientOcclusion = ( waterFloraOrm.r - 1.0 ) * aoMapIntensity + 1.0;

  reflectedLight.indirectDiffuse *= ambientOcclusion;

  #if defined( USE_CLEARCOAT )
    clearcoatSpecularIndirect *= ambientOcclusion;
  #endif

  #if defined( USE_SHEEN )
    sheenSpecularIndirect *= ambientOcclusion;
  #endif

  #if defined( USE_ENVMAP ) && defined( STANDARD )

    float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );

    reflectedLight.indirectSpecular *= computeSpecularOcclusion(
      dotNV,
      ambientOcclusion,
      material.roughness
    );

  #endif

#endif`,
    );
}
