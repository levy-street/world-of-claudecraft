import * as THREE from 'three';
import { cloneMaterialWithHooks } from '../material_clone_hooks';

/** The measured Low prototype's distant material. It shares the source map,
 * colour and alpha cutout, with live Lambert lighting and the global cel
 * ramp. Near scenery keeps its source material. Higher tiers keep their
 * authored shader hooks through sceneryBandMaterial instead. */
export function lowSceneryBandMaterial(source: THREE.Material): THREE.Material {
  const original = source as THREE.MeshLambertMaterial;
  return new THREE.MeshLambertMaterial({
    map: original.map ?? null,
    color: original.color ?? 0xffffff,
    alphaTest: source.alphaTest,
    side: source.side,
    vertexColors: true,
  });
}

const DECLARATIONS = `
attribute vec3 sceneryLocalPosition;
attribute vec3 sceneryLocalNormal;
attribute vec4 sceneryMatrix0;
attribute vec4 sceneryMatrix1;
attribute vec4 sceneryMatrix2;
attribute vec4 sceneryMatrix3;
#define position sceneryLocalPosition
#define normal sceneryLocalNormal
`;
const MATRIX = 'mat4(sceneryMatrix0, sceneryMatrix1, sceneryMatrix2, sceneryMatrix3)';

/** A merged mesh still executes the source's local-space material work before
 * applying each placement transform. Maps, emissive, canopy normals, wind,
 * biome haze and live lighting therefore keep their existing inputs. Source
 * instance collapse does not run on the plain Mesh; membership owns distance. */
export function sceneryBandMaterial(source: THREE.Material): THREE.Material {
  const material = cloneMaterialWithHooks(source);
  material.vertexColors = true;
  const sourceKey = source.customProgramCacheKey.bind(source);
  material.customProgramCacheKey = () => `${sourceKey()}|scenery-merged-local-v1`;
  material.onBeforeCompile = (shader, renderer): void => {
    // cloneMaterialWithHooks covers the standard layers. This adapter also
    // preserves source-specific hooks such as foliage wind/canopy, which the
    // generic clone service intentionally does not own.
    source.onBeforeCompile(shader, renderer);
    shader.vertexShader =
      DECLARATIONS +
      shader.vertexShader
        .replace('vec2 windOrigin = vec2(0.0);', 'vec2 windOrigin = sceneryMatrix3.xz;')
        .replace(
          '#include <defaultnormal_vertex>',
          `
        objectNormal = transpose(inverse(mat3(${MATRIX}))) * objectNormal;
        #ifdef USE_TANGENT
          objectTangent = mat3(${MATRIX}) * objectTangent;
        #endif
        #include <defaultnormal_vertex>`,
        )
        .replace(
          '#include <project_vertex>',
          `
        transformed = (${MATRIX} * vec4(transformed, 1.0)).xyz;
        #include <project_vertex>`,
        );
  };
  return material;
}

/** Capture authored inputs before applyMatrix4 bakes the batch's bounds. */
export function addSceneryLocalAttributes(
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
): void {
  const count = geometry.attributes.position.count;
  geometry.setAttribute('sceneryLocalPosition', geometry.attributes.position.clone());
  geometry.setAttribute('sceneryLocalNormal', geometry.attributes.normal.clone());
  for (let column = 0; column < 4; column++) {
    const values = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      for (let row = 0; row < 4; row++) values[i * 4 + row] = matrix.elements[column * 4 + row];
    }
    geometry.setAttribute(`sceneryMatrix${column}`, new THREE.BufferAttribute(values, 4));
  }
}
