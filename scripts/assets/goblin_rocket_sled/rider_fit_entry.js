import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createGoblinRocketSled, SLED_SOCKET_DEFINITIONS } from './model.js';

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

function makeRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(760, 760);
  renderer.setClearColor(0x1c2028, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  document.body.replaceChildren(renderer.domElement);
  document.body.style.margin = '0';
  return renderer;
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xcad9ff, 0x34261e, 2.2));
  const key = new THREE.DirectionalLight(0xffedda, 3.2);
  key.position.set(-3, 6, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbacbff, 1.6);
  rim.position.set(4, 3, -4);
  scene.add(rim);
}

function fitCamera(camera, object, view) {
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
  const distance = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.18;
  if (view === 'top') {
    camera.position.set(center.x, center.y + distance, center.z + 0.01);
    camera.up.set(0, 0, -1);
  } else if (view === 'right') {
    camera.position.set(center.x + distance, center.y + distance * 0.12, center.z);
  } else {
    camera.position.set(
      center.x + distance * 0.72,
      center.y + distance * 0.24,
      center.z + distance,
    );
  }
  camera.lookAt(center);
}

function skinnedBounds(root) {
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (object.isSkinnedMesh) object.skeleton.update();
  });
  const bounds = new THREE.Box3();
  const vertex = new THREE.Vector3();
  root.traverse((object) => {
    if (!object.isSkinnedMesh || !object.visible) return;
    const position = object.geometry.getAttribute('position');
    for (let index = 0; index < position.count; index++) {
      vertex.fromBufferAttribute(position, index);
      object.applyBoneTransform(index, vertex);
      vertex.applyMatrix4(object.matrixWorld);
      bounds.expandByPoint(vertex);
    }
  });
  return bounds;
}

function intersectsAnyMesh(bounds, root) {
  let intersects = false;
  root.traverse((object) => {
    if (intersects || !object.isMesh) return;
    if (bounds.intersectsBox(new THREE.Box3().setFromObject(object))) intersects = true;
  });
  return intersects;
}

window.renderGoblinRocketSledRiderFit = async (riderB64, stage, view) => {
  const renderer = makeRenderer();
  const scene = new THREE.Scene();
  addLights(scene);
  const assembly = new THREE.Group();
  scene.add(assembly);
  const sled = createGoblinRocketSled({ stage });
  assembly.add(sled);

  const gltf = await parseGlb(riderB64);
  const rider = gltf.scene;
  const mixer = new THREE.AnimationMixer(rider);
  const idle = gltf.animations.find((candidate) => candidate.name === 'Idle');
  if (!idle) throw new Error('knight preview is missing Idle');
  mixer.clipAction(idle).play();
  mixer.update(Math.min(0.5, idle.duration * 0.5));
  const idleBounds = skinnedBounds(rider);
  const normScale = 2.6 / (idleBounds.max.y - idleBounds.min.y);
  const normalizedRider = new THREE.Group();
  normalizedRider.name = 'RuntimePlayerNormalization';
  normalizedRider.scale.setScalar(normScale);
  normalizedRider.position.y = -idleBounds.min.y * normScale;
  normalizedRider.add(rider);
  const riderRoot = new THREE.Group();
  const socket = SLED_SOCKET_DEFINITIONS.find((definition) => definition.id === 'rider');
  riderRoot.position.fromArray(socket.position);
  riderRoot.add(normalizedRider);
  assembly.add(riderRoot);

  const clip = gltf.animations.find((candidate) => candidate.name === 'Sit_Floor_Idle');
  if (!clip) throw new Error('knight preview is missing Sit_Floor_Idle');
  mixer.stopAllAction();
  mixer.clipAction(clip).reset().play();
  mixer.update(Math.min(1.5, clip.duration * 0.55));

  riderRoot.updateMatrixWorld(true);
  const seatedLandmarks = {};
  rider.traverse((object) => {
    if (!object.isBone || !/(hip|pelvis|root)/i.test(object.name)) return;
    seatedLandmarks[object.name] = object.getWorldPosition(new THREE.Vector3()).toArray();
  });

  const riderBounds = new THREE.Box3().setFromObject(riderRoot);
  const overlaps = {
    leftRocket: intersectsAnyMesh(riderBounds, sled.getObjectByName('Rocket_L')),
    rightRocket: intersectsAnyMesh(riderBounds, sled.getObjectByName('Rocket_R')),
    tank: intersectsAnyMesh(riderBounds, sled.getObjectByName('FuelTank')),
  };

  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 50);
  fitCamera(camera, assembly, view);
  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');
  renderer.dispose();
  return {
    dataUrl,
    riderBounds: { min: riderBounds.min.toArray(), max: riderBounds.max.toArray() },
    seatedLandmarks,
    overlaps,
  };
};

window.__ready = true;
