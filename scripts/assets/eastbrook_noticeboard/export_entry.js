import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  createEastbrookNoticeboard,
  NOTICEBOARD_NATIVE_BOUNDS,
  NOTICEBOARD_SOCKET_DEFINITIONS,
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
  [0x706b62, 2],
  [0x999388, 2],
  [0xb7b0a2, 2],
  [0x211813, 3],
  [0x33251c, 3],
  [0x4c3829, 7],
  [0x704e32, 7],
  [0x0c2454, 4],
  [0x153b88, 4],
  [0x2658b1, 4],
  [0x31363b, 5],
  [0x596067, 5],
  [0x72501e, 6],
  [0xb48335, 6],
  [0xd4a23c, 6],
  [0xb2976b, 8],
  [0xd6c29a, 8],
  [0xe2d2ad, 8],
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

function nearestAtlasCell(red, green, blue) {
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

async function applyRuntimePreviewSurface(root, atlasDataUrl, lowMaterial) {
  const atlas = await loadAtlas(atlasDataUrl);
  root.traverse((object) => {
    if (!object.isMesh) return;
    if (Array.isArray(object.material)) {
      throw new Error('noticeboard preview requires one material per mesh');
    }
    const geometry = object.geometry.clone();
    const position = geometry.getAttribute('position');
    let normal = geometry.getAttribute('normal');
    if (!normal) {
      geometry.computeVertexNormals();
      normal = geometry.getAttribute('normal');
    }
    const color = geometry.getAttribute('color');
    const tint = object.material.color ?? new THREE.Color(1, 1, 1);
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
      const cell = nearestAtlasCell(
        (color?.getX(index) ?? 1) * tint.r,
        (color?.getY(index) ?? 1) * tint.g,
        (color?.getZ(index) ?? 1) * tint.b,
      );
      const [u, v] = atlasUv(cell, localU, localV);
      uv[index * 2] = u;
      uv[index * 2 + 1] = v;
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
    object.castShadow = source.name === 'EastbrookNoticeboardSurface';
    object.receiveShadow = true;
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
    shadowCasters,
    materialNames: [...materials].map((material) => material.name).sort(),
    bounds: {
      min: box.min.toArray(),
      max: box.max.toArray(),
      size: box.getSize(new THREE.Vector3()).toArray(),
      center: box.getCenter(new THREE.Vector3()).toArray(),
    },
  };
}

window.exportEastbrookNoticeboard = async (stage) => {
  const root = createEastbrookNoticeboard({ stage });
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
  if (viewName === 'front') return new THREE.Vector3(0, 0.04, 1);
  if (viewName === 'right') return new THREE.Vector3(1, 0.04, 0);
  if (viewName === 'back') return new THREE.Vector3(0, 0.04, -1);
  if (viewName === 'left') return new THREE.Vector3(-1, 0.04, 0);
  if (viewName === 'front-3q') return new THREE.Vector3(0.72, 0.22, 1);
  if (viewName === 'rear-3q') return new THREE.Vector3(-0.72, 0.22, -1);
  if (viewName === 'grazing') return new THREE.Vector3(0.82, 0.08, 1);
  if (viewName === 'collider-overlay') return new THREE.Vector3(0.76, 0.4, 1);
  return new THREE.Vector3(0.72, 0.3, 1);
}

function previewRig(viewName) {
  if (viewName === 'neutral' || viewName === 'low') {
    return {
      name: 'neutral-evaluation',
      background: 0xd8dde2,
      ground: 0x777970,
      exposure: 1,
      hemi: { sky: 0xf2f4f6, ground: 0x514b43, intensity: 1.75 },
      key: { color: 0xffffff, intensity: 3.0, position: [3.8, 5.8, 4.6] },
      rim: { color: 0xaabbd2, intensity: 0.65, position: [-3.6, 3.6, -3.2] },
    };
  }
  if (viewName === 'dusk') {
    return {
      name: 'eastbrook-dusk',
      background: 0x1d3560,
      ground: 0x273444,
      exposure: 1.05,
      hemi: { sky: 0x6388c4, ground: 0x293044, intensity: 1.6 },
      key: { color: 0xffc08a, intensity: 1.7, position: [3.8, 4.6, 5.0] },
      rim: { color: 0x89afff, intensity: 2.1, position: [-3.6, 4.4, -3.2] },
    };
  }
  if (viewName === 'grazing') {
    return {
      name: 'low-angle-grazing',
      background: 0xc9cfd5,
      ground: 0x6e726b,
      exposure: 1.02,
      hemi: { sky: 0xdde8f2, ground: 0x3e3a35, intensity: 1.2 },
      key: { color: 0xffd5a1, intensity: 4.2, position: [-4.8, 2.2, 4.4] },
      rim: { color: 0x6f9bd9, intensity: 1.2, position: [4.4, 3.5, -3.2] },
    };
  }
  return {
    name: 'reference-style',
    background: 0xd1d6dc,
    ground: 0x7a8078,
    exposure: 1.04,
    hemi: { sky: 0xeff5ff, ground: 0x4b4136, intensity: 1.75 },
    key: { color: 0xffdfb2, intensity: 3.35, position: [3.8, 5.6, 4.8] },
    rim: { color: 0x7aaeff, intensity: 1.2, position: [-3.8, 3.8, -3.4] },
  };
}

function addPlayerScaleProxy(scene) {
  const material = new THREE.MeshStandardMaterial({ color: 0x2a3543, roughness: 0.82 });
  const proxy = new THREE.Group();
  proxy.name = 'PreviewOnly_PlayerScaleProxy';
  proxy.position.set(1.6, 0, 0.15);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.55, 4, 8), material);
  body.position.y = 1.22;
  body.castShadow = true;
  proxy.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 7), material);
  head.position.y = 2.34;
  head.castShadow = true;
  proxy.add(head);
  scene.add(proxy);
  return proxy;
}

function addColliderAudit(scene, root) {
  const group = new THREE.Group();
  group.name = 'PreviewOnly_ContractBoundsAndSockets';
  const geometry = new THREE.BoxGeometry(
    NOTICEBOARD_NATIVE_BOUNDS.width,
    NOTICEBOARD_NATIVE_BOUNDS.height,
    NOTICEBOARD_NATIVE_BOUNDS.depth,
  );
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
  fill.position.y = NOTICEBOARD_NATIVE_BOUNDS.height / 2;
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
  edges.position.y = NOTICEBOARD_NATIVE_BOUNDS.height / 2;
  edges.renderOrder = 10;
  group.add(edges);

  const socketColors = [0xffd15c, 0xc582ff];
  for (const [index, definition] of NOTICEBOARD_SOCKET_DEFINITIONS.entries()) {
    const socket = root.getObjectByName(definition.nodeName);
    if (!socket) continue;
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 6),
      new THREE.MeshBasicMaterial({ color: socketColors[index], depthTest: false }),
    );
    marker.position.copy(socket.getWorldPosition(new THREE.Vector3()));
    marker.renderOrder = 11;
    group.add(marker);
    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(...definition.forward),
      marker.position,
      0.36,
      socketColors[index],
      0.09,
      0.05,
    );
    arrow.renderOrder = 11;
    group.add(arrow);
  }
  scene.add(group);
  return group;
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

let disposeActivePreview = null;

function renderPreviewRoot(root, viewName, captureDataUrl) {
  disposeActivePreview?.();
  disposeActivePreview = null;
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

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshStandardMaterial({ color: rig.ground, roughness: 0.96 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);

  scene.add(new THREE.HemisphereLight(rig.hemi.sky, rig.hemi.ground, rig.hemi.intensity));
  const key = new THREE.DirectionalLight(rig.key.color, rig.key.intensity);
  key.position.fromArray(rig.key.position);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -3.5;
  key.shadow.camera.right = 3.5;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -1;
  key.shadow.bias = -0.00035;
  scene.add(key);
  const rim = new THREE.DirectionalLight(rig.rim.color, rig.rim.intensity);
  rim.position.fromArray(rig.rim.position);
  scene.add(rim);

  const box = new THREE.Box3().setFromObject(root);
  if (viewName === 'player-scale') {
    const proxy = addPlayerScaleProxy(scene);
    proxy.updateMatrixWorld(true);
    box.union(new THREE.Box3().setFromObject(proxy));
  }
  if (viewName === 'collider-overlay') addColliderAudit(scene, root);
  const size = box.getSize(new THREE.Vector3());
  const target = box.getCenter(new THREE.Vector3());
  target.y = size.y * (viewName === 'grazing' ? 0.4 : 0.48);
  const direction = cameraDirection(viewName).normalize();
  const fov = 31;
  const radius = Math.max(size.length() * 0.5, 1);
  const distance = (radius / Math.tan(THREE.MathUtils.degToRad(fov / 2))) * 1.08;
  const camera = new THREE.PerspectiveCamera(fov, 900 / 720, 0.05, distance * 4);
  camera.position.copy(target).addScaledVector(direction, distance);
  camera.lookAt(target);
  scene.add(camera);
  renderer.render(scene, camera);

  const result = {
    ...modelStats(root),
    viewName,
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

window.renderEastbrookNoticeboardPreview = async (stage, viewName, atlasDataUrl) => {
  const root = createEastbrookNoticeboard({ stage });
  if (['material', 'surface', 'lighting', 'interaction', 'optimization', 'final'].includes(stage)) {
    await applyRuntimePreviewSurface(root, atlasDataUrl, viewName === 'low');
  }
  return renderPreviewRoot(root, viewName, false);
};

window.renderEastbrookNoticeboardSerializedPreview = async (base64, viewName, atlasDataUrl) => {
  const gltf = await parseSerializedGlb(base64);
  await applyRuntimePreviewSurface(gltf.scene, atlasDataUrl, viewName === 'low');
  return renderPreviewRoot(gltf.scene, viewName, true);
};

window.__ready = true;
