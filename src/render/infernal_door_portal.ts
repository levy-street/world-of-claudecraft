import * as THREE from 'three';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

const INFERNAL_GATE_URL = 'models/props/abyss_giant_demonic_skull_gate.glb';
const INFERNAL_GATE_SCALE = 0.68;
const INFERNAL_GATE_HEIGHT = 6.8;

let infernalGateSource: THREE.Object3D | null = null;
let infernalGatePromise: Promise<void> | null = null;

let basaltMat: THREE.MeshLambertMaterial | null = null;
let thresholdOuterMat: THREE.MeshBasicMaterial | null = null;
let thresholdInnerMat: THREE.MeshBasicMaterial | null = null;
let emberMat: THREE.PointsMaterial | null = null;
let pillarGeo: THREE.BoxGeometry | null = null;
let lintelGeo: THREE.BoxGeometry | null = null;
let plinthGeo: THREE.BoxGeometry | null = null;
let hornGeo: THREE.ConeGeometry | null = null;
let thresholdGeo: THREE.ShapeGeometry | null = null;
let embersGeo: THREE.BufferGeometry | null = null;

function cloneLoadedGate(root: THREE.Object3D): THREE.Object3D {
  const owned = root.clone(true);
  owned.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry = markSharedGeometry(node.geometry.clone());
    node.material = Array.isArray(node.material)
      ? node.material.map((material) => markSharedMaterial(material.clone()))
      : markSharedMaterial(node.material.clone());
  });
  return owned;
}

export function ensureInfernalDoorAsset(): Promise<void> {
  infernalGatePromise ??= loadGltf(INFERNAL_GATE_URL)
    .then((gltf) => {
      infernalGateSource = cloneLoadedGate(gltf.scene);
    })
    .catch((error: unknown) => {
      infernalGateSource = null;
      console.warn('Infernal exterior gate asset unavailable, using procedural fallback:', error);
    });
  return infernalGatePromise;
}

if (typeof window !== 'undefined') registerPreload(ensureInfernalDoorAsset());

function fallbackBasaltMaterial(): THREE.MeshLambertMaterial {
  basaltMat ??= markSharedMaterial(
    new THREE.MeshLambertMaterial({
      color: 0x4a2720,
      emissive: 0x170402,
    }),
  );
  return basaltMat;
}

function infernalThresholdGeometry(): THREE.ShapeGeometry {
  if (thresholdGeo) return thresholdGeo;
  const shape = new THREE.Shape();
  shape.moveTo(-1.42, 0);
  shape.lineTo(-1.42, 2.5);
  shape.quadraticCurveTo(-1.25, 3.55, 0, 4.08);
  shape.quadraticCurveTo(1.25, 3.55, 1.42, 2.5);
  shape.lineTo(1.42, 0);
  shape.closePath();
  thresholdGeo = markSharedGeometry(new THREE.ShapeGeometry(shape, 16));
  return thresholdGeo;
}

function infernalThresholdOuterMaterial(): THREE.MeshBasicMaterial {
  thresholdOuterMat ??= markSharedMaterial(
    new THREE.MeshBasicMaterial({
      color: 0xff3a08,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  return thresholdOuterMat;
}

function infernalThresholdInnerMaterial(): THREE.MeshBasicMaterial {
  thresholdInnerMat ??= markSharedMaterial(
    new THREE.MeshBasicMaterial({
      color: 0xffb21c,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  return thresholdInnerMat;
}

function buildProceduralFrame(): THREE.Group {
  const frame = new THREE.Group();
  frame.name = 'infernal-gate-frame';
  const material = fallbackBasaltMaterial();
  pillarGeo ??= markSharedGeometry(new THREE.BoxGeometry(1.05, 4.35, 1.25));
  lintelGeo ??= markSharedGeometry(new THREE.BoxGeometry(5.25, 0.82, 1.4));
  plinthGeo ??= markSharedGeometry(new THREE.BoxGeometry(1.45, 0.72, 1.6));
  hornGeo ??= markSharedGeometry(new THREE.ConeGeometry(0.5, 2.25, 7));

  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(pillarGeo, material);
    pillar.position.set(side * 2.18, 2.18, 0);
    pillar.rotation.z = side * -0.07;
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    frame.add(pillar);

    const plinth = new THREE.Mesh(plinthGeo, material);
    plinth.position.set(side * 2.2, 0.36, 0.05);
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    frame.add(plinth);

    const horn = new THREE.Mesh(hornGeo, material);
    horn.position.set(side * 1.9, 5.28, 0.02);
    horn.rotation.z = side * -0.52;
    horn.castShadow = true;
    frame.add(horn);
  }

  const lintel = new THREE.Mesh(lintelGeo, material);
  lintel.position.set(0, 4.35, 0);
  lintel.castShadow = true;
  lintel.receiveShadow = true;
  frame.add(lintel);
  return frame;
}

function buildGateFrame(lowGfx: boolean): THREE.Object3D {
  if (!infernalGateSource) return buildProceduralFrame();
  const frame = infernalGateSource.clone(true);
  frame.name = 'infernal-gate-frame';
  frame.scale.setScalar(INFERNAL_GATE_SCALE);
  frame.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.castShadow = !lowGfx;
    node.receiveShadow = true;
  });
  return frame;
}

function infernalEmbersGeometry(): THREE.BufferGeometry {
  if (embersGeo) return embersGeo;
  const positions = new Float32Array([
    -2.6, 1.1, 1.1, -2.25, 2.4, 0.7, -1.75, 3.7, 0.25, -1.2, 1.65, 1.3, -0.8, 4.7, 0.15, -0.35, 2.9,
    1.05, 0.2, 1.25, 1.35, 0.7, 3.45, 0.8, 1.1, 5.15, 0.1, 1.55, 2.2, 1.25, 2.05, 4.05, 0.3, 2.45,
    1.55, 0.95,
  ]);
  embersGeo = markSharedGeometry(new THREE.BufferGeometry());
  embersGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return embersGeo;
}

function infernalEmberMaterial(): THREE.PointsMaterial {
  emberMat ??= markSharedMaterial(
    new THREE.PointsMaterial({
      color: 0xff7a18,
      size: 0.12,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  return emberMat;
}

export interface InfernalDoorBody {
  body: THREE.Group;
  height: number;
}

export function buildInfernalDoorBody(lowGfx: boolean): InfernalDoorBody {
  const body = new THREE.Group();
  body.name = 'infernal-abyss-exterior-gate';
  body.rotation.y = Math.PI;

  const outerFlame = new THREE.Mesh(infernalThresholdGeometry(), infernalThresholdOuterMaterial());
  outerFlame.name = 'infernal-threshold-flame';
  outerFlame.position.set(0, 0.14, -1.62);
  outerFlame.renderOrder = 1;
  body.add(outerFlame);

  const innerFlame = new THREE.Mesh(infernalThresholdGeometry(), infernalThresholdInnerMaterial());
  innerFlame.name = 'infernal-threshold-core';
  innerFlame.position.set(0, 0.22, -1.58);
  innerFlame.scale.set(0.72, 0.84, 1);
  innerFlame.renderOrder = 2;
  body.add(innerFlame);

  body.add(buildGateFrame(lowGfx));

  if (!lowGfx) {
    const embers = new THREE.Points(infernalEmbersGeometry(), infernalEmberMaterial());
    embers.name = 'infernal-gate-embers';
    body.add(embers);
  }

  for (const side of [-1, 1]) {
    const light = new THREE.PointLight(
      side < 0 ? 0xff5a16 : 0xff3214,
      lowGfx ? 14 : 42,
      lowGfx ? 10 : 17,
      2,
    );
    light.name = 'infernal-gate-light';
    light.position.set(side * 2.25, 2.1, 1.35);
    body.add(light);
  }

  return { body, height: INFERNAL_GATE_HEIGHT };
}
