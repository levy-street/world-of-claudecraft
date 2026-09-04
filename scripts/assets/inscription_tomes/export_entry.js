// Browser-side entry for the inscription tome exports: builds a variant with
// the deterministic factory, serializes it with GLTFExporter, and renders
// preview turnarounds for both the live procedural build and a serialized GLB
// (raw or optimized), so the evidence shows what actually ships.
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createInscriptionTome, INSCRIPTION_TOME_KEYS } from './model.js';

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

window.exportInscriptionTome = (variantKey) =>
  new Promise((resolve, reject) => {
    const root = createInscriptionTome(variantKey, 'final');
    const scene = new THREE.Scene();
    scene.add(root);
    new GLTFExporter().parse(
      scene,
      (result) => resolve({ b64: arrayBufferToBase64(result) }),
      reject,
      { binary: true },
    );
  });

// Camera orbits around the book's mid height; the book is small, so the
// preview frames a hand-scale object rather than a building.
const VIEWS = Object.freeze({
  front: { azimuth: 0, elevation: 0.12, distance: 0.9 },
  right: { azimuth: Math.PI / 2, elevation: 0.12, distance: 0.9 },
  back: { azimuth: Math.PI, elevation: 0.12, distance: 0.9 },
  left: { azimuth: -Math.PI / 2, elevation: 0.12, distance: 0.9 },
  'front-3q': { azimuth: Math.PI / 5, elevation: 0.32, distance: 0.85 },
  'rear-3q': { azimuth: Math.PI - Math.PI / 5, elevation: 0.32, distance: 0.85 },
  grazing: { azimuth: Math.PI / 7, elevation: 0.04, distance: 0.72 },
});

let renderer = null;
function ensureRenderer() {
  if (renderer) return renderer;
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 720;
  document.body.appendChild(canvas);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(900, 720, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

window.renderInscriptionTomePreview = async ({ kind, variantKey, stage, b64, viewName }) => {
  const view = VIEWS[viewName];
  if (!view) throw new Error(`unknown view: ${viewName}`);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2b3038);
  const hemisphere = new THREE.HemisphereLight(0xdfe8f5, 0x3a3226, 1.05);
  scene.add(hemisphere);
  const key = new THREE.DirectionalLight(0xfff1d6, 1.9);
  key.position.set(1.4, 2.2, 1.8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbcd0ff, 0.7);
  rim.position.set(-1.8, 1.2, -1.4);
  scene.add(rim);

  let model;
  if (kind === 'procedural') {
    model = createInscriptionTome(variantKey, stage ?? 'final');
  } else {
    const gltf = await parseSerializedGlb(b64);
    model = gltf.scene;
  }
  scene.add(model);

  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(38, 900 / 720, 0.01, 20);
  camera.position.set(
    center.x + Math.sin(view.azimuth) * view.distance * Math.cos(view.elevation),
    center.y + Math.sin(view.elevation) * view.distance,
    center.z + Math.cos(view.azimuth) * view.distance * Math.cos(view.elevation),
  );
  camera.lookAt(center);
  ensureRenderer().render(scene, camera);
  return { variants: INSCRIPTION_TOME_KEYS };
};

window.__inscriptionTomesReady = true;
