import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { createRickshawMount, RICKSHAW_SCALE, RICKSHAW_SOCKET_DEFINITIONS } from './model.js';

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
let ktx2Ready = false;
// public/models GLBs (skeleton_minion_free.glb, this preview's puller,
// included) carry KTX2/Basis
// compressed textures, matching the game's own assets/ktx2_support.ts
// convention. This preview harness is served from ROOT (see
// export_rickshaw_mount.mjs), so the plain '/basis/' path resolves the same
// way it does in the real client.
function ensureKtx2(renderer) {
  if (ktx2Ready) return;
  const ktx2 = new KTX2Loader();
  ktx2.setTranscoderPath('/basis/');
  ktx2.detectSupport(renderer);
  gltfLoader.setKTX2Loader(ktx2);
  ktx2Ready = true;
}

function loadGlbFromBase64(base64) {
  return new Promise((resolve, reject) => {
    gltfLoader.parse(base64ToArrayBuffer(base64), '', resolve, reject);
  });
}

function modelStats(root) {
  let triangles = 0;
  let meshes = 0;
  const materials = new Set();
  root.traverse((object) => {
    if (!object.isMesh) return;
    meshes++;
    materials.add(object.material);
    const geometry = object.geometry;
    const count = geometry.index ? geometry.index.count : geometry.getAttribute('position').count;
    triangles += count / 3;
  });
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return {
    triangles,
    meshes,
    materials: materials.size,
    bounds: {
      min: box.min.toArray(),
      max: box.max.toArray(),
      size: size.toArray(),
      center: center.toArray(),
    },
  };
}

// The game's own convention for the SHIPPED puller: manifest.ts's
// skel_rickshaw_puller VisualDef (skeleton_minion_free.glb) carries the
// measured height 2.166, not skeleton_warrior.glb's 2.5. Keep these two in
// sync (and PULLER_GLB in export_rickshaw_mount.mjs), or this preview reviews
// a different rig at the wrong height.
const PULLER_TARGET_WORLD_HEIGHT = 2.166;

// Loads skel_rickshaw_puller's own rig (reused, not hand-built), scales it to
// the game's real character height, and attaches it at the same runtime
// offset src/render/rickshaw_mount.ts actually uses (RICKSHAW_PULLER_OFFSET_Z/
// Y), not the raw authored Socket_Puller position: those two constants were
// independently tuned after a live look and no longer match the socket. This
// is a rough PLACEMENT pass, not a re-posed one: the rig keeps its authored
// rest pose, so the hands are not yet gripping the shaft handles. That
// re-pose is the next step once the placement itself is confirmed to look
// right.
async function attachPuller(root, pullerB64) {
  if (!pullerB64) return null;
  const gltf = await loadGlbFromBase64(pullerB64);
  const character = gltf.scene;
  character.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  character.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(character);
  const nativeHeight = box.max.y - box.min.y;
  // wrapper is parented under `root`, which itself carries RICKSHAW_SCALE:
  // divide it back out here so the character's TRUE world height lands on
  // PULLER_TARGET_WORLD_HEIGHT instead of being scaled twice.
  const scale = PULLER_TARGET_WORLD_HEIGHT / nativeHeight / RICKSHAW_SCALE;
  const wrapper = new THREE.Group();
  wrapper.name = 'PullerCharacter';
  wrapper.add(character);
  character.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  wrapper.scale.setScalar(scale);

  // The real runtime placement (src/render/rickshaw_mount.ts's
  // RICKSHAW_PULLER_OFFSET_Y/Z, world units), not RICKSHAW_SOCKET_DEFINITIONS's
  // authored 'puller' entry, which no longer matches what the game does.
  // Divided by RICKSHAW_SCALE for the same reason `scale` above is: wrapper is
  // parented under `root`, which already carries it, so a raw world value here
  // would land at double the intended offset.
  const PULLER_WORLD_OFFSET_Y = 0.12;
  const PULLER_WORLD_OFFSET_Z = 1.8;
  wrapper.position.set(
    0,
    PULLER_WORLD_OFFSET_Y / RICKSHAW_SCALE,
    PULLER_WORLD_OFFSET_Z / RICKSHAW_SCALE,
  );
  root.add(wrapper);
  return wrapper;
}

// A rough player-scale stand-in at the rider seat. NOT a standing-height
// figure: renderer.ts sets riderMounted -> sitting:true, which resolves to a
// real 'sit' animation clip (anim_state.ts), not just a raw upright
// translate. A standing-height proxy tests the wrong pose and over-demands
// canopy clearance. 1.6 feet-to-head-top is a rough seated estimate for this
// project's ~2.5-tall standing convention; not exact without sampling the
// real 'sit' clip's bone transforms, but far closer than testing standing
// height.
function addPlayerScaleProxy(root) {
  const socketDef = RICKSHAW_SOCKET_DEFINITIONS.find((s) => s.id === 'rider');
  const proxy = new THREE.Group();
  proxy.name = 'PreviewOnly_PlayerScaleProxy';
  // socketDef.position is expressed in root's LOCAL (pre-scale) space, so
  // this position inherits RICKSHAW_SCALE correctly via the parent transform
  // exactly like every other socket child. The figure's own GEOMETRY must
  // cancel that same parent scale (see the puller wrapper above) or a real
  // figure renders twice too tall.
  proxy.position.fromArray(socketDef.position);
  proxy.scale.setScalar(1 / RICKSHAW_SCALE);
  const material = new THREE.MeshStandardMaterial({ color: 0xd9c86a, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.72, 4, 8), material);
  body.position.y = 0.58;
  body.castShadow = true;
  proxy.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 7), material);
  head.position.y = 1.38;
  head.castShadow = true;
  proxy.add(head);
  root.add(proxy);
}

window.exportRickshawMount = async () => {
  const root = createRickshawMount();
  root.updateMatrixWorld(true);
  const stats = modelStats(root);
  const glb = await new Promise((resolve, reject) => {
    new GLTFExporter().parse(root, resolve, reject, {
      binary: true,
      onlyVisible: true,
      // Currently always empty: this mount's wheels are spun procedurally by
      // the renderer, not by clips (model.js explains why authored clips were
      // abandoned). Kept wired because GLTFExporter takes clips from the
      // options object and NOT off root.animations, so a future clip would
      // otherwise be silently dropped.
      animations: root.animations ?? [],
    });
  });
  return { b64: arrayBufferToBase64(glb), stats };
};

window.renderRickshawMountPreview = async (viewName, pullerB64) => {
  document.body.replaceChildren();
  document.body.style.margin = '0';
  document.body.style.background = '#241a14';

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(900, 900);
  renderer.setClearColor(0x241a14, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x241a14);
  const root = createRickshawMount();
  scene.add(root);
  ensureKtx2(renderer);
  await attachPuller(root, pullerB64);
  addPlayerScaleProxy(root);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.ShadowMaterial({ color: 0x0c0906, opacity: 0.35 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // A cool moonlit rig rather than the chest's warm interior lighting: this
  // is an outdoor Halloween mount, not a bank-vault prop. Brighter than a
  // true in-game moonlit read on purpose: this is the AUTHORING review rig,
  // and the dim first pass made it impossible to judge proportions.
  const hemi = new THREE.HemisphereLight(0xaebde8, 0x3a2c1e, 2.4);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xf0ecff, 4.4);
  key.position.set(3.6, 5.2, 4.4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -3;
  key.shadow.camera.right = 3;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -2;
  key.shadow.bias = -0.0004;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8a5cff, 1.6);
  rim.position.set(-3.8, 3.0, -2.8);
  scene.add(rim);

  // Framed for the post-RICKSHAW_SCALE size (roughly twice the original
  // authored dimensions).
  const cameras = {
    front: [0, 2.7, 8.4],
    side: [8.6, 2.5, 0],
    threeQuarter: [6.4, 3.6, 7.1],
    grazing: [6.6, 1.9, 7.1],
    rear3q: [-5.8, 3.6, -6.5],
    // Every camera above sits at or above the canopy's own peak (world Y 4.0)
    // looking steeply down: from that angle the opaque roof sits BETWEEN
    // the camera and the lower-seated rider, which is a real occlusion
    // artifact of the authoring angle, not a canopy design problem. This is
    // a level, near-eye-height shot from the front (rider head is ~world Y
    // 2.63) approximating how another player would actually see this mount.
    faceCheck: [0, 2.5, 5.5],
    faceCheckSide: [5.5, 2.5, -0.2],
  };
  const camera = new THREE.PerspectiveCamera(32, 900 / 900, 0.05, 30);
  camera.position.fromArray(cameras[viewName] ?? cameras.threeQuarter);
  const lookTarget = viewName?.startsWith('faceCheck') ? [0, 2.5, -0.2] : [0, 2.0, 0];
  camera.lookAt(...lookTarget);
  scene.add(camera);
  renderer.render(scene, camera);
  return modelStats(root);
};

window.__ready = true;
