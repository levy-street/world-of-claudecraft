import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { createGrandFerryShip, GRAND_FERRY_SHIP_PLAN } from './model.js';

function installNodeFileReader() {
  if (typeof globalThis.FileReader !== 'undefined') return;
  globalThis.FileReader = class {
    result = null;
    onloadend = null;

    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((result) => {
        this.result = result;
        this.onloadend?.();
      });
    }
  };
}

function objectBounds(object) {
  const bounds = new THREE.Box3().setFromObject(object);
  return {
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    size: bounds.getSize(new THREE.Vector3()).toArray(),
    center: bounds.getCenter(new THREE.Vector3()).toArray(),
  };
}

export function grandFerryShipAuthoringStats(root) {
  let triangles = 0;
  let meshes = 0;
  const materials = new Set();
  const semanticBounds = {};
  const socketPositions = {};
  let railOpeningIntrusions = 0;
  root.traverse((object) => {
    if (object.name.startsWith('Socket_')) {
      socketPositions[object.name] = object.getWorldPosition(new THREE.Vector3()).toArray();
    }
    if (!object.isMesh) return;
    meshes++;
    semanticBounds[object.name] = objectBounds(object);
    const geometry = object.geometry;
    triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) materials.add(material);
    if (object.name === 'GrandFerryRails') {
      const position = geometry.getAttribute('position');
      const edge = GRAND_FERRY_SHIP_PLAN.rampMatingEdge;
      const railDepth = GRAND_FERRY_SHIP_PLAN.rails[0].halfThickness * 2.5;
      for (let index = 0; index < position.count; index++) {
        const x = position.getX(index);
        const z = position.getZ(index);
        const insideOpening =
          x > edge.x - edge.halfWidth + 0.001 && x < edge.x + edge.halfWidth - 0.001;
        if (insideOpening && Math.abs(z - edge.z) <= railDepth) railOpeningIntrusions++;
      }
    }
  });
  return {
    triangles,
    meshes,
    materials: materials.size,
    bounds: objectBounds(root),
    semanticBounds,
    socketPositions,
    railOpeningIntrusions,
  };
}

export async function exportGrandFerryShipGlb() {
  installNodeFileReader();
  const root = createGrandFerryShip();
  root.updateMatrixWorld(true);
  const stats = grandFerryShipAuthoringStats(root);
  const glb = await new GLTFExporter().parseAsync(root, {
    binary: true,
    onlyVisible: true,
  });
  return { glb, stats };
}
