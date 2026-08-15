export interface CanopyShaderPatchConfig {
  fadeStart: number;
  fadeEnd: number;
  creviceDownStart: number;
  creviceDownFull: number;
}

export interface PatchedShaderSource {
  vertexShader: string;
  fragmentShader: string;
}

/** Replace a known all-up normal attribute with the exact shader constant. */
export function patchConstantUpNormalVertexShader(vertexShader: string): string {
  return vertexShader.replace(
    '#include <beginnormal_vertex>',
    'vec3 objectNormal = vec3(0.0, 1.0, 0.0);',
  );
}

/**
 * Patch the grass-card fragment path. The first alpha reject is a strict
 * subset of the stock reject below it: both following smoothstep factors are
 * in [0, 1], so a texel already below alphaTest can never become visible.
 */
export function patchGrassFragmentShader(fragmentShader: string): string {
  return fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
        varying vec2 vTuftWorld;
        uniform vec2 uPlayerPos;
        uniform float uFadeFar;`,
    )
    .replace(
      '#include <normal_fragment_begin>',
      `#include <normal_fragment_begin>
        #ifdef DOUBLE_SIDED
          // The vertex stage forces up normals so cards shade like the
          // meadow, but the double-sided chunk flips backfaces to a DOWN
          // normal: every tuft viewed from its reverse side went black.
          // faceDirection squared undoes the flip; up stays up on both faces.
          normal *= faceDirection;
        #endif`,
    )
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>
        #ifdef USE_ALPHATEST
          if (diffuseColor.a < alphaTest) discard;
        #endif
        diffuseColor.a *= 1.0 - smoothstep(uFadeFar * 0.7, uFadeFar, distance(vTuftWorld, uPlayerPos));
        #ifdef USE_ALPHATEST
          if (diffuseColor.a < alphaTest) discard;
        #endif
        // near fade: a camera brushing the grass otherwise fills the
        // frame with a single giant card
        diffuseColor.a *= smoothstep(0.45, 1.35, length(vViewPosition));`,
    );
}

/**
 * Leaf materials bind one texture as both map and emissiveMap with the same UV
 * channel and transform. Reuse the already sampled map texel for the ambient
 * floor instead of issuing the identical texture lookup a second time.
 */
export function reuseDiffuseMapSampleForEmissive(fragmentShader: string): string {
  return fragmentShader.replace(
    '#include <emissivemap_fragment>',
    `#ifdef USE_EMISSIVEMAP
          totalEmissiveRadiance *= sampledDiffuseColor.rgb;
        #endif`,
  );
}

/**
 * Add canopy detail after alpha testing. The detail block only changes RGB,
 * normals, and emissive light, so discarded fragments and every surviving
 * fragment retain the stock alpha decision.
 */
export function patchCanopyDetailShaderSource(
  vertexShader: string,
  fragmentShader: string,
  config: CanopyShaderPatchConfig,
): PatchedShaderSource {
  const patchedVertex = vertexShader
    .replace(
      '#include <common>',
      `#include <common>
        varying vec3 vCanopyWorldPos;
        varying vec3 vCanopyWorldNormal;
        varying float vCanopyDown;`,
    )
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
        vec4 canopyPos = vec4( transformed, 1.0 );
        vec3 canopyNrm = objectNormal;
        #ifdef USE_INSTANCING
          canopyPos = instanceMatrix * canopyPos;
          canopyNrm = mat3( instanceMatrix ) * canopyNrm;
        #endif
        vCanopyWorldPos = ( modelMatrix * canopyPos ).xyz;
        vCanopyWorldNormal = normalize( mat3( modelMatrix ) * canopyNrm );
        vCanopyDown = max( 0.0, -normalize( normal ).y );`,
    );

  const patchedFragment = fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
        varying vec3 vCanopyWorldPos;
        varying vec3 vCanopyWorldNormal;
        varying float vCanopyDown;
        uniform sampler2D uCanopyNormalTex;
        uniform sampler2D uCanopyAoTex;
        uniform float uCanopyStrength;
        uniform float uCanopyTile;
        uniform float uCanopyAoLo;
        uniform float uCanopyAoSpan;
        uniform float uCanopyCrevice;
        uniform float uCanopyDesat;`,
    )
    .replace(
      '#include <alphatest_fragment>',
      `#include <alphatest_fragment>
        float canopyDetK = 1.0 - smoothstep( ${config.fadeStart.toFixed(1)}, ${config.fadeEnd.toFixed(1)},
          distance( vCanopyWorldPos, cameraPosition ) );
        vec3 canopyP;
        vec3 canopyGN;
        vec3 canopyW;
        float canopyAoTerm = 1.0;
        if ( canopyDetK > 0.0 ) {
          canopyP = vCanopyWorldPos * uCanopyTile;
          canopyGN = normalize( vCanopyWorldNormal );
          canopyW = pow( abs( canopyGN ), vec3( 4.0 ) );
          canopyW /= ( canopyW.x + canopyW.y + canopyW.z );
          float canopyAo = texture2D( uCanopyAoTex, canopyP.zy ).r * canopyW.x
            + texture2D( uCanopyAoTex, canopyP.xz ).r * canopyW.y
            + texture2D( uCanopyAoTex, canopyP.xy ).r * canopyW.z;
          // mean-centered remap: exactly 1.0 at the measured map mean, so
          // easing back to 1.0 with distance cannot shift canopy brightness
          canopyAoTerm = mix( 1.0, uCanopyAoLo + canopyAo * uCanopyAoSpan, canopyDetK );
        }
        float canopyShade = canopyAoTerm
          * ( 1.0 - uCanopyCrevice * smoothstep( ${config.creviceDownStart.toFixed(2)}, ${config.creviceDownFull.toFixed(2)}, vCanopyDown ) );
        diffuseColor.rgb *= canopyShade;
        diffuseColor.rgb = mix( diffuseColor.rgb,
          vec3( dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) ) ), uCanopyDesat );`,
    )
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
        totalEmissiveRadiance *= canopyShade * canopyShade;`,
    )
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
        if ( canopyDetK > 0.0 ) {
          vec3 canopyNx = texture2D( uCanopyNormalTex, canopyP.zy ).xyz * 2.0 - 1.0;
          vec3 canopyNy = texture2D( uCanopyNormalTex, canopyP.xz ).xyz * 2.0 - 1.0;
          vec3 canopyNz = texture2D( uCanopyNormalTex, canopyP.xy ).xyz * 2.0 - 1.0;
          canopyNx = vec3( canopyNx.xy + canopyGN.zy, abs( canopyNx.z ) * canopyGN.x );
          canopyNy = vec3( canopyNy.xy + canopyGN.xz, abs( canopyNy.z ) * canopyGN.y );
          canopyNz = vec3( canopyNz.xy + canopyGN.xy, abs( canopyNz.z ) * canopyGN.z );
          vec3 canopyWorldN = normalize(
            canopyNx.zyx * canopyW.x + canopyNy.xzy * canopyW.y + canopyNz.xyz * canopyW.z );
          vec3 canopyViewN = normalize( ( viewMatrix * vec4( canopyWorldN, 0.0 ) ).xyz );
          normal = normalize( mix( normal, canopyViewN, uCanopyStrength * canopyDetK ) );
        }`,
    );

  return { vertexShader: patchedVertex, fragmentShader: patchedFragment };
}
