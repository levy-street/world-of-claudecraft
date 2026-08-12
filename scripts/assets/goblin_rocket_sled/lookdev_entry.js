import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function parseGlb(value) {
  return new Promise((resolve, reject) => loader.parse(fromBase64(value), '', resolve, reject));
}

function addLight(scene, color, intensity, position) {
  const light = new THREE.DirectionalLight(color, intensity);
  light.position.fromArray(position);
  scene.add(light);
}

window.renderSledLookdev = async (b64, mode) => {
  document.body.replaceChildren();
  document.body.style.margin = '0';
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(900, 900);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = mode === 'grazing' ? 1.18 : 1.05;
  renderer.setClearColor(mode === 'reference-match' ? 0x30251e : 0x20242b, 1);
  document.body.append(renderer.domElement);

  const gltf = await parseGlb(b64);
  const object = gltf.scene;
  object.rotation.y = -Math.PI / 5;
  const scene = new THREE.Scene();
  scene.add(object);
  if (mode === 'neutral') {
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.0));
    addLight(scene, 0xffffff, 2.5, [3, 5, 5]);
    addLight(scene, 0xb7c8e6, 0.9, [-4, 2, -2]);
  } else if (mode === 'grazing') {
    scene.add(new THREE.AmbientLight(0xffffff, 0.18));
    addLight(scene, 0xffe1bc, 5.2, [-5, 1.1, 1.5]);
    addLight(scene, 0x94adff, 1.1, [4, 3, -4]);
  } else {
    scene.add(new THREE.HemisphereLight(0xffead0, 0x3a2b23, 1.7));
    addLight(scene, 0xffd2a3, 3.4, [-3, 5, 4]);
    addLight(scene, 0xc4d0ff, 1.0, [4, 2, -3]);
    addLight(scene, 0xff8a45, 0.55, [0, 1, -5]);
  }

  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  const center = bounds.getCenter(new THREE.Vector3());
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
  if (mode === 'grazing') {
    // Close enough that scratches, wood grain, quilting, and roughness breakup
    // occupy real pixels; aimed across the right rocket, seat, and deck.
    camera.position.set(3.2, 1.65, 3.0);
    camera.lookAt(0.55, 0.82, 0.0);
  } else {
    const distance = (sphere.radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.06;
    camera.position.set(center.x + distance * 0.7, center.y + distance * 0.18, center.z + distance);
    camera.lookAt(center);
  }
  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');
  renderer.dispose();
  return dataUrl;
};

window.__ready = true;
