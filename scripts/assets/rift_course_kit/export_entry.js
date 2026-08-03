// Browser-side export entry for the rift course kit: builds each kit asset
// from the deterministic factory and serializes it to a binary GLB. Vertex
// colours only, no textures, no atlas: the runtime adapter feeds these
// through surfaceMat, and the course palette does the reading.
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { createRiftCourseProp, RIFT_COURSE_KIT, RIFT_COURSE_KIT_IDS } from './model.js';

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function exportOne(assetKey) {
  const root = createRiftCourseProp(assetKey);
  const scene = new THREE.Scene();
  scene.add(root);
  const exporter = new GLTFExporter();
  const buffer = await exporter.parseAsync(scene, { binary: true, onlyVisible: false });
  return {
    key: assetKey,
    outputName: RIFT_COURSE_KIT[assetKey].outputName,
    base64: arrayBufferToBase64(buffer),
  };
}

window.__exportRiftCourseKit = async () => {
  const out = [];
  for (const key of RIFT_COURSE_KIT_IDS) out.push(await exportOne(key));
  return out;
};

window.__riftCourseKitReady = true;
