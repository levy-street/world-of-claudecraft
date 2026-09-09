// Browser side of the farm prop export: serializes each procedural asset through
// GLTFExporter and renders the evidence previews, including the bed mounting
// check that proves a stage mesh seats cleanly on Socket_Soil.
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createFarmProp, FARM_PROP_CONTRACTS, FARM_SOIL_SOCKET_NODE } from './model.js';

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
  const textures = new Set();
  root.traverse((object) => {
    if (!object.isMesh) return;
    meshes++;
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
    }
    const geometry = object.geometry;
    triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
  });
  const box = new THREE.Box3().setFromObject(root);
  return {
    triangles,
    meshes,
    materials: materials.size,
    textures: textures.size,
    materialNames: [...materials].map((material) => material.name).sort(),
    bounds: {
      min: box.min.toArray(),
      max: box.max.toArray(),
      size: box.getSize(new THREE.Vector3()).toArray(),
    },
  };
}

window.exportFarmProp = async (id) => {
  const root = createFarmProp(id);
  root.updateMatrixWorld(true);
  const stats = modelStats(root);
  const glb = await new Promise((resolve, reject) => {
    new GLTFExporter().parse(root, resolve, reject, { binary: true, onlyVisible: true });
  });
  return { b64: arrayBufferToBase64(glb), stats };
};

function cameraDirection(viewName) {
  if (viewName === 'front') return new THREE.Vector3(0, 0.05, 1);
  if (viewName === 'grazing') return new THREE.Vector3(0.7, 0.09, 1);
  if (viewName === 'top') return new THREE.Vector3(0.001, 1, 0.35);
  return new THREE.Vector3(0.68, 0.42, 1);
}

function previewRig(viewName) {
  if (viewName === 'grazing') {
    return {
      background: 0xc9cfd5,
      ground: 0x6f7468,
      hemi: { sky: 0xdde8f2, ground: 0x3e3a35, intensity: 1.3 },
      key: { color: 0xffd5a1, intensity: 3.6, position: [-4.4, 2.4, 4.2] },
      rim: { color: 0x6f9bd9, intensity: 1.1, position: [4.2, 3.4, -3] },
    };
  }
  return {
    background: 0xd1d6dc,
    ground: 0x76806c,
    hemi: { sky: 0xeff5ff, ground: 0x4b4136, intensity: 1.7 },
    key: { color: 0xffdfb2, intensity: 3.2, position: [3.6, 5.4, 4.6] },
    rim: { color: 0x7aaeff, intensity: 1.15, position: [-3.6, 3.6, -3.2] },
  };
}

function disposeScene(scene, renderer) {
  scene.traverse((object) => {
    object.geometry?.dispose();
    if (!object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
  renderer.dispose();
  renderer.forceContextLoss();
}

function renderPreviewRoot(root, viewName) {
  const rig = previewRig(viewName);
  document.body.replaceChildren();
  document.body.style.margin = '0';

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(640, 512);
  renderer.setClearColor(rig.background, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(rig.background);
  scene.add(root);
  root.updateMatrixWorld(true);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshStandardMaterial({ color: rig.ground, roughness: 0.96 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.005;
  ground.receiveShadow = true;
  scene.add(ground);

  scene.add(new THREE.HemisphereLight(rig.hemi.sky, rig.hemi.ground, rig.hemi.intensity));
  const key = new THREE.DirectionalLight(rig.key.color, rig.key.intensity);
  key.position.fromArray(rig.key.position);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -3;
  key.shadow.camera.right = 3;
  key.shadow.camera.top = 3;
  key.shadow.camera.bottom = -1;
  key.shadow.bias = -0.0004;
  scene.add(key);
  const rim = new THREE.DirectionalLight(rig.rim.color, rig.rim.intensity);
  rim.position.fromArray(rig.rim.position);
  scene.add(rim);

  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const target = box.getCenter(new THREE.Vector3());
  target.y = Math.max(size.y * 0.42, 0.08);
  const fov = 30;
  const radius = Math.max(size.length() * 0.5, 0.6);
  const distance = (radius / Math.tan(THREE.MathUtils.degToRad(fov / 2))) * 1.1;
  const camera = new THREE.PerspectiveCamera(fov, 640 / 512, 0.05, distance * 4);
  camera.position.copy(target).addScaledVector(cameraDirection(viewName).normalize(), distance);
  camera.lookAt(target);
  scene.add(camera);
  renderer.render(scene, camera);

  const result = { ...modelStats(root), viewName, dataUrl: renderer.domElement.toDataURL() };
  disposeScene(scene, renderer);
  return result;
}

function applyPreviewShading(root) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
}

window.renderFarmPropSolo = async (base64, viewName) => {
  const gltf = await parseSerializedGlb(base64);
  applyPreviewShading(gltf.scene);
  return renderPreviewRoot(gltf.scene, viewName);
};

// Mounts a stage GLB on the bed's Socket_Soil exactly the way the renderer will,
// so the evidence sheet proves the socket contract instead of asserting it.
window.renderFarmPropOnBed = async (bedBase64, stageBase64, viewName) => {
  const bed = await parseSerializedGlb(bedBase64);
  applyPreviewShading(bed.scene);
  const socket = bed.scene.getObjectByName(FARM_SOIL_SOCKET_NODE);
  if (!socket) throw new Error(`farm_bed is missing ${FARM_SOIL_SOCKET_NODE}`);
  if (stageBase64) {
    const stage = await parseSerializedGlb(stageBase64);
    applyPreviewShading(stage.scene);
    socket.add(stage.scene);
  }
  return renderPreviewRoot(bed.scene, viewName);
};

window.farmPropContracts = FARM_PROP_CONTRACTS;
window.__ready = true;
