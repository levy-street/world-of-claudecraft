// Browser half of the Tank mount look-dev harness: renders the shipped GLB
// under three deliberately different rigs so the material pass can be judged
// the way the object-sculpt spec's screenshotReview asks for.
//
//   studio  - key/fill/rim, the readability reference
//   grazing - one low raking key, which is what exposes flat normals, uniform
//             roughness, plastic highlights, and tiling
//   neutral - flat hemisphere only, which shows the baked albedo and the vertex
//             bake with no lighting to hide behind
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const BACKGROUND = 0x181d24;

function studioRig() {
  const group = new THREE.Group();
  const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
  key.position.set(3.2, 4.4, 3.0);
  group.add(key);
  const fill = new THREE.DirectionalLight(0x9fb6e0, 0.9);
  fill.position.set(-3, 1.2, -1.5);
  group.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 1.1);
  rim.position.set(-1.5, 2.2, -3.4);
  group.add(rim);
  group.add(new THREE.HemisphereLight(0xbcd0ea, 0x3a3026, 0.55));
  return group;
}

function grazingRig() {
  const group = new THREE.Group();
  const key = new THREE.DirectionalLight(0xfff4e2, 4.2);
  key.position.set(4.2, 0.55, 1.1);
  group.add(key);
  group.add(new THREE.AmbientLight(0x2b3440, 0.35));
  return group;
}

function neutralRig() {
  const group = new THREE.Group();
  group.add(new THREE.HemisphereLight(0xffffff, 0xffffff, 1.15));
  group.add(new THREE.AmbientLight(0xffffff, 0.55));
  return group;
}

const RIGS = { studio: studioRig, grazing: grazingRig, neutral: neutralRig };

function loadGlb(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Promise((resolve, reject) => {
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(bytes.buffer, '', resolve, reject);
  });
}

let renderer = null;

function render(object, options) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  scene.add(RIGS[options.rig]());
  scene.add(object);

  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
  const fov = 30;
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.01, 1000);
  const distance = ((radius / Math.sin((fov * Math.PI) / 360)) * 1.04) / options.zoom;
  const yaw = options.yaw;
  const pitch = options.pitch;
  camera.position.set(
    center.x + Math.sin(yaw) * Math.cos(pitch) * distance,
    center.y + Math.sin(pitch) * distance,
    center.z + Math.cos(yaw) * Math.cos(pitch) * distance,
  );
  const target = center.clone();
  target.y += options.lookUp * radius;
  camera.lookAt(target);

  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  }
  renderer.setPixelRatio(1);
  renderer.setSize(options.size, options.size);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = options.exposure;
  renderer.render(scene, camera);
  scene.remove(object);
  return renderer.domElement.toDataURL('image/png');
}

window.renderTankLookdev = async (base64, shots) => {
  const gltf = await loadGlb(base64);
  return shots.map((shot) => ({ name: shot.name, dataUrl: render(gltf.scene, shot) }));
};

window.__ready = true;
