import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { createTankMount } from './model.js';

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function modelStats(root, animations) {
  let triangles = 0;
  let meshes = 0;
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    if (!object.isMesh) return;
    meshes++;
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
    }
    const geometry = object.geometry;
    triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
  });
  const bounds = new THREE.Box3().setFromObject(root);
  return {
    triangles,
    meshes,
    materials: materials.size,
    textures: textures.size,
    animations: animations.map((clip) => ({ name: clip.name, duration: clip.duration })),
    bounds: {
      min: bounds.min.toArray(),
      max: bounds.max.toArray(),
      size: bounds.getSize(new THREE.Vector3()).toArray(),
      center: bounds.getCenter(new THREE.Vector3()).toArray(),
    },
  };
}

window.exportTankMount = async (stage, sourceFingerprint) => {
  const { root, animations } = createTankMount({ stage, sourceFingerprint });
  root.updateMatrixWorld(true);
  const stats = modelStats(root, animations);
  const glb = await new Promise((resolve, reject) => {
    new GLTFExporter().parse(root, resolve, reject, {
      animations,
      binary: true,
      onlyVisible: true,
    });
  });
  return { b64: arrayBufferToBase64(glb), stats };
};

window.__ready = true;
