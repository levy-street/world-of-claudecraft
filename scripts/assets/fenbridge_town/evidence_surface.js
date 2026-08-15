import * as THREE from 'three';
import {
  FENBRIDGE_SURFACE_NORMAL_SCALE,
  fenbridgeSemanticForColor,
  fenbridgeSurfaceGeometry,
} from '../../../src/render/fenbridge_surface_mapping';

function materialColor(material) {
  return material.color?.isColor ? material.color : new THREE.Color(0xffffff);
}

function materialIsEmissive(material) {
  return (
    material.name.toLowerCase().includes('emissive') ||
    (material.emissive?.isColor && material.emissive.getHex() !== 0)
  );
}

function mappedGeometry(source, material) {
  const color = source.getAttribute('color');
  if (!color) throw new Error('Fenbridge evidence surface requires authored vertex colors');
  const tint = materialColor(material);
  return fenbridgeSurfaceGeometry(source, (index) =>
    fenbridgeSemanticForColor(
      color.getX(index) * tint.r,
      color.getY(index) * tint.g,
      color.getZ(index) * tint.b,
    ),
  );
}

function mappedMaterial(source, textures) {
  const material = source.clone();
  const emissive = materialIsEmissive(material);
  material.map = emissive ? null : textures.base;
  material.vertexColors = emissive;
  if (material.isMeshStandardMaterial && !emissive) {
    material.normalMap = textures.normal;
    material.normalScale.setScalar(FENBRIDGE_SURFACE_NORMAL_SCALE);
    material.roughnessMap = textures.roughness;
    material.roughness = 1;
    material.metalnessMap = textures.roughness;
    material.metalness = 1;
  }
  material.needsUpdate = true;
  return material;
}

/** Apply the live Fenbridge shared-map contract to a preview-only object graph. */
export function applyFenbridgeEvidenceSurface(root, textures) {
  let meshCount = 0;
  let textureBindings = 0;
  let pbrBindings = 0;
  const uvMinimum = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const uvMaximum = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (Array.isArray(object.material)) {
      throw new Error('Fenbridge evidence surface does not support material arrays');
    }
    object.geometry = mappedGeometry(object.geometry, object.material);
    const uv = object.geometry.getAttribute('uv');
    for (let index = 0; index < uv.count; index++) {
      uvMinimum[0] = Math.min(uvMinimum[0], uv.getX(index));
      uvMinimum[1] = Math.min(uvMinimum[1], uv.getY(index));
      uvMaximum[0] = Math.max(uvMaximum[0], uv.getX(index));
      uvMaximum[1] = Math.max(uvMaximum[1], uv.getY(index));
    }
    object.material = mappedMaterial(object.material, textures);
    meshCount++;
    if (object.material.map === textures.base) textureBindings++;
    if (
      object.material.isMeshStandardMaterial &&
      object.material.normalMap === textures.normal &&
      object.material.roughnessMap === textures.roughness &&
      object.material.metalnessMap === textures.roughness
    ) {
      pbrBindings++;
    }
  });
  return {
    meshCount,
    textureBindings,
    pbrBindings,
    uvBounds: {
      minimum: uvMinimum,
      maximum: uvMaximum,
      span: [uvMaximum[0] - uvMinimum[0], uvMaximum[1] - uvMinimum[1]],
    },
  };
}
