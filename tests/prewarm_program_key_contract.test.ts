import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

// The prewarm compile-unit dedupe (prewarmProgramContentKeys) skips any root
// whose program-content keys an earlier root already produced. That is only
// sound while the key covers every object/geometry bit three folds into a
// program's cache key: a bit the key misses makes the dedupe SKIP a variant
// that then links synchronously at first draw, the stall class the compile
// lane exists to prevent. Two rot vectors, one guard each:
//
// 1. A three upgrade changes the parameter surface. The tripwire below pins
//    the EXACT parameter list of the installed three's getParameters, so any
//    bump that adds, removes, or renames a parameter goes red here and forces
//    a deliberate re-audit of prewarmProgramContentKeys (the same bump-means-
//    re-verify policy src/render/CLAUDE.md applies to patched shader chunks).
//
// 2. The repo adopts a feature the key deliberately does not cover. For
//    BatchedMesh (its batchingColor bit) the source scan below fails the
//    moment one is constructed under src/render, naming the key to extend
//    first. Points-with-uv (pointsUvs) has NO tripwire here on purpose:
//    Points are already constructed in several src/render files and land on
//    the compile path today, so a construction grep cannot discriminate; the
//    bit only flips for a uv-mapped TEXTURED Points, which no cheap static
//    scan can see. It stays comment-only in the key's doc, covered at
//    runtime by the same first-draw link it always was.

const THREE_PROGRAM_PARAMETERS = [
  'shaderID',
  'shaderType',
  'shaderName',
  'vertexShader',
  'fragmentShader',
  'defines',
  'customVertexShaderID',
  'customFragmentShaderID',
  'isRawShaderMaterial',
  'glslVersion',
  'precision',
  'batching',
  'batchingColor',
  'instancing',
  'instancingColor',
  'instancingMorph',
  'supportsVertexTextures',
  'outputColorSpace',
  'alphaToCoverage',
  'map',
  'matcap',
  'envMap',
  'envMapMode',
  'envMapCubeUVHeight',
  'aoMap',
  'lightMap',
  'bumpMap',
  'normalMap',
  'displacementMap',
  'emissiveMap',
  'normalMapObjectSpace',
  'normalMapTangentSpace',
  'metalnessMap',
  'roughnessMap',
  'anisotropy',
  'anisotropyMap',
  'clearcoat',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'dispersion',
  'iridescence',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'sheen',
  'sheenColorMap',
  'sheenRoughnessMap',
  'specularMap',
  'specularColorMap',
  'specularIntensityMap',
  'transmission',
  'transmissionMap',
  'thicknessMap',
  'gradientMap',
  'opaque',
  'alphaMap',
  'alphaTest',
  'alphaHash',
  'combine',
  'mapUv',
  'aoMapUv',
  'lightMapUv',
  'bumpMapUv',
  'normalMapUv',
  'displacementMapUv',
  'emissiveMapUv',
  'metalnessMapUv',
  'roughnessMapUv',
  'anisotropyMapUv',
  'clearcoatMapUv',
  'clearcoatNormalMapUv',
  'clearcoatRoughnessMapUv',
  'iridescenceMapUv',
  'iridescenceThicknessMapUv',
  'sheenColorMapUv',
  'sheenRoughnessMapUv',
  'specularMapUv',
  'specularColorMapUv',
  'specularIntensityMapUv',
  'transmissionMapUv',
  'thicknessMapUv',
  'alphaMapUv',
  'vertexTangents',
  'vertexColors',
  'vertexAlphas',
  'pointsUvs',
  'fog',
  'useFog',
  'fogExp2',
  'flatShading',
  'sizeAttenuation',
  'logarithmicDepthBuffer',
  'skinning',
  'morphTargets',
  'morphNormals',
  'morphColors',
  'morphTargetsCount',
  'morphTextureStride',
  'numDirLights',
  'numPointLights',
  'numSpotLights',
  'numSpotLightMaps',
  'numRectAreaLights',
  'numHemiLights',
  'numDirLightShadows',
  'numPointLightShadows',
  'numSpotLightShadows',
  'numSpotLightShadowsWithMaps',
  'numLightProbes',
  'numClippingPlanes',
  'numClipIntersection',
  'dithering',
  'shadowMapEnabled',
  'shadowMapType',
  'toneMapping',
  'decodeVideoTexture',
  'premultipliedAlpha',
  'doubleSided',
  'flipSided',
  'useDepthPacking',
  'depthPacking',
  'index0AttributeName',
  'extensionClipCullDistance',
  'extensionMultiDraw',
  'rendererExtensionParallelShaderCompile',
  'customProgramCacheKey',
];

describe('prewarm program key contract', () => {
  it('pins the installed three program-parameter surface (bump tripwire)', () => {
    const three = readFileSync(
      new URL('../node_modules/three/build/three.module.js', import.meta.url),
      'utf8',
    );
    const start = three.indexOf('const parameters = {');
    const end = three.indexOf('};', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const names = [...three.slice(start, end).matchAll(/^\t{3}(\w+):/gm)].map((m) => m[1]);
    expect(
      names,
      'three program cache-key parameter surface changed: re-audit prewarmProgramContentKeys ' +
        '(src/render/prewarm_policy.ts) against the new getParameters before re-pinning this list',
    ).toEqual(THREE_PROGRAM_PARAMETERS);
  });

  it('fails on adoption of the features the dedupe key deliberately omits', () => {
    const renderRoot = path.join(path.dirname(new URL(import.meta.url).pathname), '../src/render');
    const offenders: string[] = [];
    for (const { file, full } of tsFilesUnder(renderRoot)) {
      const source = readFileSync(full, 'utf8');
      // Constructions only: the dedupe key and this guard may NAME the
      // feature in comments and flags without adopting it.
      if (/new THREE\.BatchedMesh\(|new BatchedMesh\(/.test(source)) {
        offenders.push(`${file}: BatchedMesh`);
      }
    }
    expect(
      offenders,
      'BatchedMesh adoption reached src/render: extend prewarmProgramContentKeys with the ' +
        'batchingColor bit (and its test) before shipping, or the prewarm dedupe will skip ' +
        'batched-colour variants that then link synchronously at first draw',
    ).toEqual([]);
  });

  it('scans only through the shared walkers', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });
});
