import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  createEastbrookTownAsset,
  EASTBROOK_TOWN_ASSET_IDS,
  EASTBROOK_TOWN_CONTRACTS,
} from './model.js';

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
  let shadowCasters = 0;
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    if (!object.isMesh) return;
    meshes++;
    if (object.castShadow) shadowCasters++;
    materials.add(object.material);
    for (const value of Object.values(object.material)) {
      if (value?.isTexture) textures.add(value);
    }
    const geometry = object.geometry;
    triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
  });
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return {
    triangles,
    meshes,
    materials: materials.size,
    textures: textures.size,
    shadowCasters,
    materialNames: [...materials].map((material) => material.name).sort(),
    bounds: {
      min: box.min.toArray(),
      max: box.max.toArray(),
      size: size.toArray(),
      center: center.toArray(),
    },
  };
}

window.exportEastbrookTownAsset = async (assetId) => {
  const root = createEastbrookTownAsset(assetId);
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

function cameraDirection(viewName) {
  if (viewName === 'front') return new THREE.Vector3(0, 0.08, 1);
  if (viewName === 'right') return new THREE.Vector3(1, 0.08, 0);
  if (viewName === 'back') return new THREE.Vector3(0, 0.08, -1);
  if (viewName === 'left') return new THREE.Vector3(-1, 0.08, 0);
  if (viewName === 'front-3q') return new THREE.Vector3(0.76, 0.34, 1);
  if (viewName === 'rear-3q') return new THREE.Vector3(-0.76, 0.34, -1);
  if (viewName === 'grazing') return new THREE.Vector3(0.86, 0.16, 1);
  if (viewName === 'collider-overlay') return new THREE.Vector3(0.82, 0.58, 1);
  return new THREE.Vector3(0.76, 0.48, 1);
}

function addPlayerScaleProxy(scene, contract) {
  const material = new THREE.MeshStandardMaterial({ color: 0x2a3543, roughness: 0.82 });
  const proxy = new THREE.Group();
  proxy.name = 'PreviewOnly_PlayerScaleProxy';
  proxy.position.set(contract.dimensions.width / 2 + 0.45, 0, contract.dimensions.depth / 2 - 0.2);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.02, 4, 8), material);
  body.position.y = 0.75;
  body.castShadow = true;
  proxy.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 7), material);
  head.position.y = 1.62;
  head.castShadow = true;
  proxy.add(head);
  scene.add(proxy);
  return proxy;
}

function addColliderAudit(scene, root, contract) {
  const group = new THREE.Group();
  group.name = 'PreviewOnly_ContractBoundsAndSockets';
  const { width, height, depth } = contract.dimensions;
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const fill = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: 0x4fe5ff,
      transparent: true,
      opacity: 0.055,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  fill.position.y = height / 2;
  group.add(fill);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({
      color: 0x4fe5ff,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    }),
  );
  edges.position.y = height / 2;
  edges.renderOrder = 10;
  group.add(edges);

  const socketColors = [0xffd15c, 0xc582ff];
  for (const [index, definition] of contract.sockets.entries()) {
    const socket = root.getObjectByName(definition.name);
    if (!socket) continue;
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 10, 7),
      new THREE.MeshBasicMaterial({ color: socketColors[index], depthTest: false }),
    );
    marker.position.copy(socket.getWorldPosition(new THREE.Vector3()));
    marker.renderOrder = 11;
    group.add(marker);
  }
  scene.add(group);
  return group;
}

function previewRig(viewName) {
  if (viewName === 'neutral') {
    return {
      name: 'neutral-evaluation',
      background: 0xd8dde2,
      ground: 0x777970,
      exposure: 1,
      hemi: { sky: 0xf2f4f6, ground: 0x514b43, intensity: 1.8 },
      key: { color: 0xffffff, intensity: 3.1 },
      rim: { color: 0xaabbd2, intensity: 0.65 },
    };
  }
  if (viewName === 'dusk') {
    return {
      name: 'source-inspired-dusk',
      background: 0x1d3560,
      ground: 0x273444,
      exposure: 1.05,
      hemi: { sky: 0x6388c4, ground: 0x293044, intensity: 1.65 },
      key: { color: 0xffc08a, intensity: 1.65 },
      rim: { color: 0x89afff, intensity: 2.25 },
    };
  }
  return {
    name: 'baseline',
    background: 0xd1d6dc,
    ground: 0x7a8078,
    exposure: 1.04,
    hemi: { sky: 0xeff5ff, ground: 0x4b4136, intensity: 1.75 },
    key: { color: 0xffdfb2, intensity: 3.45 },
    rim: { color: 0x7aaeff, intensity: 1.25 },
  };
}

function disposeScene(scene, renderer) {
  scene.traverse((object) => {
    object.geometry?.dispose();
    if (!object.material) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      material.dispose();
    }
  });
  renderer.dispose();
  renderer.forceContextLoss();
}

let disposeActivePreview = null;

function renderPreviewRoot(root, assetId, viewName, captureDataUrl) {
  disposeActivePreview?.();
  disposeActivePreview = null;
  const contract = EASTBROOK_TOWN_CONTRACTS[assetId];
  if (!contract) throw new Error(`unknown Eastbrook town asset: ${assetId}`);
  const rig = previewRig(viewName);
  document.body.replaceChildren();
  document.body.style.margin = '0';
  document.body.style.background = `#${rig.background.toString(16).padStart(6, '0')}`;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: captureDataUrl,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(900, 720);
  renderer.setClearColor(rig.background, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = rig.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(rig.background);
  scene.add(root);
  root.updateMatrixWorld(true);

  const maxSpan = Math.max(contract.dimensions.width, contract.dimensions.depth);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(maxSpan * 3, maxSpan * 3),
    new THREE.MeshStandardMaterial({ color: rig.ground, roughness: 0.96 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);

  const hemi = new THREE.HemisphereLight(rig.hemi.sky, rig.hemi.ground, rig.hemi.intensity);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(rig.key.color, rig.key.intensity);
  key.position.set(maxSpan * 1.1, contract.dimensions.height * 1.8, maxSpan * 1.35);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -maxSpan;
  key.shadow.camera.right = maxSpan;
  key.shadow.camera.top = maxSpan;
  key.shadow.camera.bottom = -maxSpan;
  key.shadow.bias = -0.00035;
  scene.add(key);
  const rim = new THREE.DirectionalLight(rig.rim.color, rig.rim.intensity);
  rim.position.set(-maxSpan * 1.15, contract.dimensions.height, -maxSpan);
  scene.add(rim);

  const box = new THREE.Box3().setFromObject(root);
  if (viewName === 'player-scale') {
    const proxy = addPlayerScaleProxy(scene, contract);
    proxy.updateMatrixWorld(true);
    box.union(new THREE.Box3().setFromObject(proxy));
  }
  if (viewName === 'collider-overlay') addColliderAudit(scene, root, contract);
  const size = box.getSize(new THREE.Vector3());
  const target = box.getCenter(new THREE.Vector3());
  target.y = size.y * (viewName === 'grazing' ? 0.38 : 0.46);
  const direction = cameraDirection(viewName).normalize();
  const fov = 32;
  const radius = Math.max(size.length() * 0.5, 1);
  const distance = (radius / Math.tan(THREE.MathUtils.degToRad(fov / 2))) * 1.08;
  const camera = new THREE.PerspectiveCamera(fov, 900 / 720, 0.05, distance * 4);
  camera.position.copy(target).addScaledVector(direction, distance);
  camera.lookAt(target);
  scene.add(camera);
  renderer.render(scene, camera);
  const result = {
    assetId,
    viewName,
    ...modelStats(root),
    previewLighting: rig.name,
    previewOnlyPlayerProxy: viewName === 'player-scale',
    previewOnlyContractBounds: viewName === 'collider-overlay',
    shippingCollisionMesh: false,
  };
  const cleanup = () => disposeScene(scene, renderer);
  if (captureDataUrl) {
    result.dataUrl = renderer.domElement.toDataURL('image/png');
    cleanup();
  } else {
    disposeActivePreview = cleanup;
  }
  return result;
}

window.renderEastbrookTownPreview = (assetId, viewName) => {
  return renderPreviewRoot(createEastbrookTownAsset(assetId), assetId, viewName, false);
};

window.renderEastbrookTownSerializedPreview = async (base64, assetId, viewName) => {
  const gltf = await parseSerializedGlb(base64);
  return renderPreviewRoot(gltf.scene, assetId, viewName, true);
};

window.__eastbrookTownAssetIds = [...EASTBROOK_TOWN_ASSET_IDS];
window.__ready = true;
