import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { createGoblinRocketSled } from './model.js';

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function modelStats(root) {
  let triangles = 0;
  let meshes = 0;
  const materials = new Set();
  root.traverse((object) => {
    if (!object.isMesh) return;
    meshes++;
    materials.add(object.material);
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
  });
  const bounds = new THREE.Box3().setFromObject(root);
  return {
    triangles,
    meshes,
    materials: materials.size,
    bounds: {
      min: bounds.min.toArray(),
      max: bounds.max.toArray(),
      size: bounds.getSize(new THREE.Vector3()).toArray(),
      center: bounds.getCenter(new THREE.Vector3()).toArray(),
    },
  };
}

window.exportGoblinRocketSled = async (stage) => {
  const root = createGoblinRocketSled({ stage });
  root.updateMatrixWorld(true);
  const stats = modelStats(root);
  const glb = await new Promise((resolve, reject) => {
    new GLTFExporter().parse(root, resolve, reject, {
      animations: [],
      binary: true,
      onlyVisible: true,
    });
  });
  return { b64: arrayBufferToBase64(glb), stats };
};

window.renderGoblinRocketSledTop = (stage) => {
  document.body.replaceChildren();
  document.body.style.margin = '0';
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(720, 720);
  renderer.setClearColor(0x1c2028, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  document.body.append(renderer.domElement);

  const scene = new THREE.Scene();
  const sled = createGoblinRocketSled({ stage });
  scene.add(sled);
  const riderZone = new THREE.Mesh(
    new THREE.BoxGeometry(0.78, 0.04, 0.62),
    new THREE.MeshBasicMaterial({ color: 0x65c96b, transparent: true, opacity: 0.38 }),
  );
  riderZone.name = 'PreviewOnly_RiderClearance';
  riderZone.position.set(0, 1.7, 0.42);
  scene.add(riderZone);
  scene.add(new THREE.HemisphereLight(0xcad9ff, 0x34261e, 2.4));
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(-3, 6, 4);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
  camera.position.set(0, 7.1, 0.01);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0.45, 0);
  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');
  renderer.dispose();
  return dataUrl;
};

window.__ready = true;
