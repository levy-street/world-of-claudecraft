import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  createEastbrookMailbox,
  EASTBROOK_MAILBOX_CONTRACT,
  EASTBROOK_MAILBOX_STAGES,
} from './model.js';

const serializedLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
let atlasTexture = null;

const ATLAS_COLUMNS = 4;
const ATLAS_ROWS = 4;
const ATLAS_SIZE = 512;
const ATLAS_PADDING = 4 / ATLAS_SIZE;
const ATLAS_CELL = 1 / ATLAS_COLUMNS;
const PALETTE_CELLS = [
  [0x30343a, 0],
  [0x555b61, 15],
  [0x777d80, 1],
  [0x979b98, 14],
  [0x211813, 3],
  [0x33251c, 3],
  [0x4c3829, 7],
  [0x704e32, 7],
  [0x0c2454, 4],
  [0x153b88, 4],
  [0x2658b1, 4],
  [0x31363b, 5],
  [0x596067, 5],
  [0xa27320, 6],
  [0xd4a23c, 6],
].map(([hex, cell]) => ({ color: new THREE.Color(hex), cell }));

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
    materials.add(object.material);
    for (const value of Object.values(object.material)) {
      if (value?.isTexture) textures.add(value);
    }
    triangles +=
      (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
  });
  const bounds = new THREE.Box3().setFromObject(root);
  return {
    triangles,
    meshes,
    materials: materials.size,
    textures: textures.size,
    bounds: {
      min: bounds.min.toArray(),
      max: bounds.max.toArray(),
      size: bounds.getSize(new THREE.Vector3()).toArray(),
      center: bounds.getCenter(new THREE.Vector3()).toArray(),
    },
  };
}

function nearestCell(red, green, blue) {
  let selected = PALETTE_CELLS[0];
  let distance = Number.POSITIVE_INFINITY;
  for (const candidate of PALETTE_CELLS) {
    const dr = red - candidate.color.r;
    const dg = green - candidate.color.g;
    const db = blue - candidate.color.b;
    const next = dr * dr + dg * dg + db * db;
    if (next < distance) {
      selected = candidate;
      distance = next;
    }
  }
  return selected.cell;
}

function normalized(value, minimum, maximum) {
  const span = maximum - minimum;
  return span > 1e-8 ? THREE.MathUtils.clamp((value - minimum) / span, 0, 1) : 0.5;
}

function atlasUv(cell, localU, localV) {
  const column = cell % ATLAS_COLUMNS;
  const rowFromTop = Math.floor(cell / ATLAS_ROWS);
  const usable = ATLAS_CELL - ATLAS_PADDING * 2;
  return [
    column * ATLAS_CELL + ATLAS_PADDING + localU * usable,
    1 - (rowFromTop + 1) * ATLAS_CELL + ATLAS_PADDING + localV * usable,
  ];
}

async function loadAtlas(dataUrl) {
  if (atlasTexture) return atlasTexture;
  atlasTexture = await new THREE.TextureLoader().loadAsync(dataUrl);
  atlasTexture.colorSpace = THREE.NoColorSpace;
  atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
  atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
  return atlasTexture;
}

async function applyPreviewSurface(root, atlasDataUrl, lowMaterial) {
  const atlas = await loadAtlas(atlasDataUrl);
  root.traverse((object) => {
    if (!object.isMesh) return;
    const geometry = object.geometry.clone();
    const position = geometry.getAttribute('position');
    let normal = geometry.getAttribute('normal');
    if (!normal) {
      geometry.computeVertexNormals();
      normal = geometry.getAttribute('normal');
    }
    const color = geometry.getAttribute('color');
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    const uv = new Float32Array(position.count * 2);
    for (let index = 0; index < position.count; index++) {
      const nx = Math.abs(normal.getX(index));
      const ny = Math.abs(normal.getY(index));
      const nz = Math.abs(normal.getZ(index));
      let localU;
      let localV;
      if (nx >= ny && nx >= nz) {
        localU = normalized(position.getZ(index), bounds.min.z, bounds.max.z);
        localV = normalized(position.getY(index), bounds.min.y, bounds.max.y);
      } else if (ny >= nz) {
        localU = normalized(position.getX(index), bounds.min.x, bounds.max.x);
        localV = normalized(position.getZ(index), bounds.min.z, bounds.max.z);
      } else {
        localU = normalized(position.getX(index), bounds.min.x, bounds.max.x);
        localV = normalized(position.getY(index), bounds.min.y, bounds.max.y);
      }
      const cell = nearestCell(
        color?.getX(index) ?? 1,
        color?.getY(index) ?? 1,
        color?.getZ(index) ?? 1,
      );
      const mapped = atlasUv(cell, localU, localV);
      uv[index * 2] = mapped[0];
      uv[index * 2 + 1] = mapped[1];
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    object.geometry = geometry;

    const source = object.material;
    const params = {
      name: source.name,
      color: source.color,
      map: atlas,
      vertexColors: source.vertexColors,
      flatShading: lowMaterial,
    };
    object.material = lowMaterial
      ? new THREE.MeshLambertMaterial(params)
      : new THREE.MeshStandardMaterial({
          ...params,
          roughness: source.roughness,
          metalness: source.metalness,
        });
    object.castShadow = true;
    object.receiveShadow = true;
  });
}

window.exportEastbrookMailbox = async () => {
  const root = createEastbrookMailbox('final');
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

function previewRig(viewName) {
  if (viewName === 'dusk') {
    return {
      background: 0x172746,
      ground: 0x26354a,
      exposure: 1.08,
      hemi: { sky: 0x6c8fc7, ground: 0x282d39, intensity: 1.45 },
      key: { color: 0xffc285, intensity: 1.8 },
      rim: { color: 0x6fa8ff, intensity: 2.4 },
    };
  }
  if (viewName === 'neutral' || viewName === 'low') {
    return {
      background: 0xdce1e6,
      ground: 0x777b74,
      exposure: 1,
      hemi: { sky: 0xf4f6f8, ground: 0x514a42, intensity: 1.8 },
      key: { color: 0xffffff, intensity: 3 },
      rim: { color: 0xaabbd2, intensity: 0.7 },
    };
  }
  return {
    background: 0xd5d9de,
    ground: 0x7a7d75,
    exposure: 1.04,
    hemi: { sky: 0xf0f5ff, ground: 0x4c4238, intensity: 1.7 },
    key: { color: 0xffdfb2, intensity: 3.35 },
    rim: { color: 0x7caeff, intensity: 1.25 },
  };
}

function cameraDirection(viewName) {
  if (viewName === 'front') return new THREE.Vector3(0, 0.06, 1);
  if (viewName === 'right') return new THREE.Vector3(1, 0.06, 0);
  if (viewName === 'back') return new THREE.Vector3(0, 0.06, -1);
  if (viewName === 'left') return new THREE.Vector3(-1, 0.06, 0);
  if (viewName === 'rear-3q') return new THREE.Vector3(-0.72, 0.25, -1);
  if (viewName === 'grazing') return new THREE.Vector3(0.82, -0.05, 1);
  return new THREE.Vector3(0.72, 0.25, 1);
}

function addPlayerScaleProxy(scene) {
  const material = new THREE.MeshStandardMaterial({ color: 0x75808d, roughness: 0.85 });
  const proxy = new THREE.Group();
  proxy.name = 'PreviewOnly_PlayerScaleProxy';
  proxy.position.set(1.25, 0, -0.05);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.6, 4, 8), material);
  body.position.y = 1.02;
  body.castShadow = true;
  proxy.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 7), material);
  head.position.y = 2.38;
  head.castShadow = true;
  proxy.add(head);
  scene.add(proxy);
}

let disposeActivePreview = null;

window.renderEastbrookMailboxPreview = async ({ kind, b64, viewName, stage, atlasDataUrl }) => {
  disposeActivePreview?.();
  disposeActivePreview = null;
  let root;
  if (kind === 'procedural') {
    root = createEastbrookMailbox(stage ?? 'final');
  } else {
    const gltf = await parseSerializedGlb(b64);
    root = gltf.scene;
  }
  await applyPreviewSurface(root, atlasDataUrl, viewName === 'low');

  const rig = previewRig(viewName);
  document.body.replaceChildren();
  document.body.style.margin = '0';
  document.body.style.background = `#${rig.background.toString(16).padStart(6, '0')}`;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
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
  if (viewName === 'player-scale') addPlayerScaleProxy(scene);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 9),
    new THREE.MeshStandardMaterial({ color: rig.ground, roughness: 0.96 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);
  scene.add(new THREE.HemisphereLight(rig.hemi.sky, rig.hemi.ground, rig.hemi.intensity));
  const key = new THREE.DirectionalLight(rig.key.color, rig.key.intensity);
  key.position.set(3.5, 5.3, 4.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -3;
  key.shadow.camera.right = 3;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -2;
  key.shadow.bias = -0.00035;
  scene.add(key);
  const rim = new THREE.DirectionalLight(rig.rim.color, rig.rim.intensity);
  rim.position.set(-3.2, 3.6, -2.8);
  scene.add(rim);

  const direction = cameraDirection(viewName);
  const distance = viewName === 'player-scale' ? 6.6 : 5.7;
  const camera = new THREE.PerspectiveCamera(31, 900 / 720, 0.05, 30);
  camera.position.copy(direction.normalize().multiplyScalar(distance));
  camera.position.y += viewName === 'grazing' ? 1.1 : 1.25;
  camera.lookAt(viewName === 'player-scale' ? 0.3 : 0, 1.4, 0);
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

window.__eastbrookMailboxReady = {
  stages: EASTBROOK_MAILBOX_STAGES,
  contract: EASTBROOK_MAILBOX_CONTRACT,
};
