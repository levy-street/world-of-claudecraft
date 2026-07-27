import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { createBankerChest } from './model.js';

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
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
    const geometry = object.geometry;
    const count = geometry.index ? geometry.index.count : geometry.getAttribute('position').count;
    triangles += count / 3;
  });
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return {
    triangles,
    meshes,
    materials: materials.size,
    bounds: {
      min: box.min.toArray(),
      max: box.max.toArray(),
      size: size.toArray(),
      center: center.toArray(),
    },
  };
}

window.exportBankerChest = async () => {
  const root = createBankerChest();
  root.updateMatrixWorld(true);
  const stats = modelStats(root);
  const glb = await new Promise((resolve, reject) => {
    new GLTFExporter().parse(root, resolve, reject, {
      binary: true,
      onlyVisible: true,
    });
  });
  return { b64: arrayBufferToBase64(glb), stats };
};

window.renderBankerChestPreview = (viewName) => {
  document.body.replaceChildren();
  document.body.style.margin = '0';
  document.body.style.background = '#d6d1c8';

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(900, 700);
  renderer.setClearColor(0xd6d1c8, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd6d1c8);
  const root = createBankerChest();
  scene.add(root);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.ShadowMaterial({ color: 0x20242a, opacity: 0.2 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const hemi = new THREE.HemisphereLight(0xeef4ff, 0x4a382b, 1.7);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffe2b4, 3.6);
  key.position.set(3.2, 4.5, 4.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -3;
  key.shadow.camera.right = 3;
  key.shadow.camera.top = 3;
  key.shadow.camera.bottom = -2;
  key.shadow.bias = -0.0004;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8dc8ff, 1.4);
  rim.position.set(-3.5, 2.7, -2.5);
  scene.add(rim);

  const cameras = {
    front: [0, 1.35, 3.55],
    side: [3.65, 1.3, 0],
    threeQuarter: [2.65, 1.75, 3.15],
    grazing: [2.85, 0.92, 3.2],
  };
  const camera = new THREE.PerspectiveCamera(32, 900 / 700, 0.05, 30);
  camera.position.fromArray(cameras[viewName] ?? cameras.threeQuarter);
  camera.lookAt(0, 0.62, 0);
  scene.add(camera);
  renderer.render(scene, camera);
  return modelStats(root);
};

window.__ready = true;
