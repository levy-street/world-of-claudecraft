import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createHoardEntrance, HOARD_ENTRANCE_CONTRACT, HOARD_ENTRANCE_STAGES } from './model.js';

const serializedLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function parseSerializedGlb(base64) {
  return new Promise((resolve, reject) => {
    serializedLoader.parse(base64ToArrayBuffer(base64), '', resolve, reject);
  });
}

function modelStats(root) {
  let triangles = 0;
  let meshes = 0;
  const materials = new Set();
  root.traverse((object) => {
    if (!object.isMesh) return;
    meshes++;
    materials.add(object.material);
    triangles +=
      (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
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

window.exportHoardEntrance = async (stage = 'final') => {
  const root = createHoardEntrance(stage);
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

function cameraFor(viewName, target) {
  const direction = {
    front: [0, 0.65, 1],
    right: [1, 0.65, 0],
    back: [0, 0.65, -1],
    left: [-1, 0.65, 0],
    'front-3q': [0.82, 0.7, 1],
    'rear-3q': [-0.82, 0.7, -1],
    grazing: [0.92, 0.25, 1],
    top: [0.25, 1.8, 0.45],
  }[viewName] ?? [0.82, 0.7, 1];
  const camera = new THREE.PerspectiveCamera(34, 900 / 720, 0.05, 40);
  camera.position
    .fromArray(direction)
    .normalize()
    .multiplyScalar(viewName === 'top' ? 7.8 : 7.2);
  camera.position.y += 0.6;
  camera.lookAt(target);
  return camera;
}

let disposeActivePreview = null;

window.renderHoardEntrancePreview = async ({ kind, b64, viewName, stage }) => {
  disposeActivePreview?.();
  disposeActivePreview = null;
  const root =
    kind === 'procedural'
      ? createHoardEntrance(stage ?? 'final')
      : (await parseSerializedGlb(b64)).scene;

  document.body.replaceChildren();
  document.body.style.margin = '0';
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(900, 720);
  renderer.setClearColor(0xcac4b7, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  document.body.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcac4b7);
  scene.add(root);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.MeshStandardMaterial({ color: 0x817763, roughness: 0.98 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);
  scene.add(new THREE.HemisphereLight(0xf5ead5, 0x3b3129, 2.1));
  const key = new THREE.DirectionalLight(0xffd7a0, 3.3);
  key.position.set(5, 8, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8eaece, 1.1);
  rim.position.set(-4, 4, -5);
  scene.add(rim);

  const camera = cameraFor(viewName, new THREE.Vector3(0, 0.72, 0));
  renderer.render(scene, camera);
  const stats = modelStats(root);
  disposeActivePreview = () => {
    scene.traverse((object) => {
      object.geometry?.dispose();
      if (!object.material) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        material.dispose();
      }
    });
    renderer.dispose();
    renderer.forceContextLoss();
  };
  return stats;
};

window.__hoardEntranceReady = {
  stages: HOARD_ENTRANCE_STAGES,
  contract: HOARD_ENTRANCE_CONTRACT,
};
