import type * as THREE from 'three';

/** Three sets up shader state before rejecting an empty draw. Scenery keeps
 * empty source meshes as reveal and shadow owners, so reject only their empty
 * submissions here. onBeforeShadow has already restored a source's real count
 * before this method is called; populated shadow draws still take the normal path. */
export function skipEmptySceneryDraws(
  renderer: Pick<THREE.WebGLRenderer, 'renderBufferDirect'>,
  owns: (object: THREE.Object3D) => boolean,
): () => void {
  const original = renderer.renderBufferDirect;
  let enabled = true;
  const render: THREE.WebGLRenderer['renderBufferDirect'] = function (
    this: Pick<THREE.WebGLRenderer, 'renderBufferDirect'>,
    camera,
    scene,
    geometry,
    material,
    object,
    group,
  ): void {
    const instanced = object as THREE.InstancedMesh;
    if (
      enabled &&
      owns(object) &&
      ((instanced.isInstancedMesh && instanced.count === 0) || geometry.drawRange.count === 0)
    )
      return;
    original.call(this, camera, scene, geometry, material, object, group);
  };
  renderer.renderBufferDirect = render;
  return () => {
    enabled = false;
    if (renderer.renderBufferDirect === render) renderer.renderBufferDirect = original;
  };
}
