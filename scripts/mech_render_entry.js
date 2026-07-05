// Browser-side entry for the Combat-Mech chroma previewer. Mirrors
// weapon_render_entry.js: bundled by esbuild into a self-contained IIFE
// (tmp/mech_render_bundle.js) and injected into a blank page by
// scripts/render_mech_chromas.mjs. Exposes
//   window.renderMech(glbBase64, texBase64) -> png data URL
// It parses the mech GLB once, then for each call swaps the single shared
// material's baseColor map to the supplied chroma PNG and re-renders a
// 3/4 hero pose. Runs offline under headless swiftshader.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const SIZE = 1920; // supersample; the driver downscales

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
renderer.setSize(SIZE, SIZE);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

function makeLights() {
  const g = new THREE.Group();
  const key = new THREE.DirectionalLight(0xfff0dc, 2.6); key.position.set(2.5, 4, 3); g.add(key);
  const fill = new THREE.DirectionalLight(0x9fb6e0, 1.2); fill.position.set(-3, 1.5, 1.5); g.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 1.6); rim.position.set(-1, 2, -4); g.add(rim);
  g.add(new THREE.AmbientLight(0xffffff, 0.6));
  return g;
}

function b64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

function loadImage(dataUrl) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = dataUrl;
  });
}

let gltfScene = null;     // parsed once
let material = null;      // the single shared combatMech material

function parseOnce(glbB64) {
  if (gltfScene) return Promise.resolve();
  return new Promise((resolve, reject) => {
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(
      b64ToArrayBuffer(glbB64), '', (gltf) => {
        gltfScene = gltf.scene;
        gltfScene.traverse((o) => {
          if (o.isMesh && o.material) { material = o.material; }
        });
        resolve();
      }, reject);
  });
}

window.renderMech = async (glbB64, texB64) => {
  await parseOnce(glbB64);

  // build chroma texture (glTF baseColor conventions: sRGB, flipY=false)
  const img = await loadImage('data:image/png;base64,' + texB64);
  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;

  if (material.map) material.map.dispose();
  material.map = tex;
  material.needsUpdate = true;

  const scene = new THREE.Scene();
  scene.add(makeLights());

  const obj = gltfScene;
  // 3/4 hero view facing the camera (mech authored upright +Y)
  obj.rotation.set(0, Math.PI * 0.16, 0);

  const root = new THREE.Group();
  root.add(obj);
  scene.add(root);

  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  obj.position.sub(center);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const r = sphere.radius || 1;

  const fov = 30;
  const cam = new THREE.PerspectiveCamera(fov, 1, 0.01, 100);
  const dist = (r / Math.sin((fov * Math.PI) / 360)) * 1.02;
  cam.position.set(dist * 0.26, dist * 0.10, dist);
  cam.lookAt(0, r * 0.06, 0);

  renderer.setClearColor(0x14171d, 1);
  renderer.render(scene, cam);
  return renderer.domElement.toDataURL('image/png');
};

window.__ready = true;
