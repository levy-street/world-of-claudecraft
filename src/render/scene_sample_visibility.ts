import * as THREE from 'three';

/** Demand for the opaque framebuffer copy, shared by every scene consumer. */
export class SceneSampleVisibility {
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();

  hasVisibleConsumer(
    consumers: ReadonlySet<THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>>,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ): boolean {
    if (!scene.visible) return false;
    let frustumReady = false;
    for (const mesh of consumers) {
      if (!mesh.material.visible || !camera.layers.test(mesh.layers)) continue;
      const geometry = mesh.geometry;
      const count = geometry.index?.count ?? geometry.attributes.position?.count ?? 0;
      if (geometry.drawRange.count <= 0 || geometry.drawRange.start >= count) continue;
      const instanced = mesh as THREE.Mesh & { isInstancedMesh?: boolean; count?: number };
      if (instanced.isInstancedMesh && (instanced.count ?? 0) <= 0) continue;
      if (
        (geometry as THREE.InstancedBufferGeometry).isInstancedBufferGeometry &&
        (geometry as THREE.InstancedBufferGeometry).instanceCount <= 0
      )
        continue;
      let ancestor: THREE.Object3D | null = mesh;
      while (ancestor?.visible && ancestor !== scene) ancestor = ancestor.parent;
      if (ancestor !== scene) continue;
      // Match the renderer's cull, including its opt-out for shader-displaced
      // VFX. At the capture sentinel the render already updated these matrices.
      if (!mesh.frustumCulled) return true;
      if (!frustumReady) {
        this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(
          this.projection,
          camera.coordinateSystem,
          camera.reversedDepth,
        );
        frustumReady = true;
      }
      if (this.frustum.intersectsObject(mesh)) return true;
    }
    return false;
  }
}
