// Browser-side entry for the weapon-thumbnail renderer. Bundled by esbuild into
// a self-contained IIFE (tmp/weapon_render_bundle.js) and injected into a blank
// page by scripts/render_weapon_icons.mjs. Exposes window.renderWeapon(base64)
// -> jpeg data URL. We parse GLB bytes directly (no fetch) so it runs offline
// under headless swiftshader.
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const DEFAULT_SIZE = 256;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(DEFAULT_SIZE, DEFAULT_SIZE);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

// Soft 3-point rig — flat KayKit albedo reads well with a warm key + cool fill.
function makeLights() {
  const g = new THREE.Group();
  const key = new THREE.DirectionalLight(0xfff0dc, 2.4);
  key.position.set(2.5, 4, 3);
  g.add(key);
  const fill = new THREE.DirectionalLight(0x9fb6e0, 1.0);
  fill.position.set(-3, 1, -1.5);
  g.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 1.2);
  rim.position.set(0, 2, -4);
  g.add(rim);
  g.add(new THREE.AmbientLight(0xffffff, 0.55));
  return g;
}

function b64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

window.renderWeapon = (b64, size = DEFAULT_SIZE) =>
  new Promise((resolve, reject) => {
    loader.parse(
      b64ToArrayBuffer(b64),
      '',
      (gltf) => {
        try {
          renderer.setSize(size, size);
          const scene = new THREE.Scene();
          scene.add(makeLights());

          const obj = gltf.scene;
          // Diagonal hero pose. Most KayKit weapons are authored upright (+Y).
          obj.rotation.set(0.18, -0.5, -0.42);
          scene.add(obj);

          // center on bounding box, frame by bounding sphere (orientation-agnostic)
          const box = new THREE.Box3().setFromObject(obj);
          const center = box.getCenter(new THREE.Vector3());
          obj.position.sub(center);
          const sphere = box.getBoundingSphere(new THREE.Sphere());
          const r = sphere.radius || 1;

          const fov = 32;
          const cam = new THREE.PerspectiveCamera(fov, 1, 0.01, 100);
          const dist = (r / Math.sin((fov * Math.PI) / 360)) * 1.06;
          cam.position.set(dist * 0.18, dist * 0.12, dist);
          cam.lookAt(0, 0, 0);

          renderer.setClearColor(0x14171d, 1);
          renderer.render(scene, cam);
          const url = renderer.domElement.toDataURL('image/jpeg', 0.86);

          obj.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material)
              (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
                m.dispose();
              });
          });
          scene.clear();
          resolve(url);
        } catch (e) {
          reject(e);
        }
      },
      reject,
    );
  });

window.__ready = true;
