import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import {
  ARMOURY_INTERACTION_CONTRACT,
  ARMOURY_SOCKET_DEFINITIONS,
  ARMOURY_TIER1_AUDIT_ALBEDOS,
  createEastbrookGrandArmoury,
} from './model.js';

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
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
    textures: textures.size,
    shadowCasters,
    materialContract: [...materials].map((material) => ({
      name: material.name,
      metalness: material.metalness,
      roughness: material.roughness,
      emissive: `#${material.emissive.getHexString()}`,
      emissiveIntensity: material.emissiveIntensity,
      vertexColors: material.vertexColors,
    })),
    bounds: {
      min: box.min.toArray(),
      max: box.max.toArray(),
      size: size.toArray(),
      center: center.toArray(),
    },
  };
}

window.exportEastbrookGrandArmoury = async (stage) => {
  const root = createEastbrookGrandArmoury({ stage });
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

function addPlayerScaleProxy(scene, position = [-2.1, 1.35, 5.25]) {
  const proxy = new THREE.Group();
  proxy.name = 'PreviewOnly_PlayerScaleProxy';
  proxy.position.fromArray(position);
  const material = new THREE.MeshStandardMaterial({ color: 0x243344, roughness: 0.82 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 1.05, 4, 8), material);
  body.position.y = 0.77;
  body.castShadow = true;
  proxy.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), material);
  head.position.y = 1.67;
  head.castShadow = true;
  proxy.add(head);
  scene.add(proxy);
}

function addInteractionColliderAudit(scene) {
  const collider = ARMOURY_INTERACTION_CONTRACT.collider;
  const geometry = new THREE.BoxGeometry(...collider.size);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({
      color: 0x52dfff,
      transparent: true,
      opacity: 0.78,
      depthTest: false,
    }),
  );
  edges.name = 'PreviewOnly_ArmouryObb';
  edges.position.fromArray(collider.center);
  edges.renderOrder = 10;
  scene.add(edges);

  const socketColors = [0xffd15c, 0xc582ff, 0x73f2ff];
  for (const [index, definition] of ARMOURY_SOCKET_DEFINITIONS.entries()) {
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: socketColors[index],
      depthTest: false,
    });
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 6), markerMaterial);
    marker.name = `PreviewOnly_${definition.nodeName}`;
    marker.position.fromArray(definition.position);
    marker.renderOrder = 11;
    scene.add(marker);

    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(...definition.forward),
      new THREE.Vector3(...definition.position),
      0.72,
      socketColors[index],
      0.18,
      0.1,
    );
    arrow.name = `PreviewOnly_${definition.nodeName}_Forward`;
    arrow.renderOrder = 11;
    arrow.traverse((object) => {
      if (object.material) object.material.depthTest = false;
    });
    scene.add(arrow);
  }
}

function previewRig(viewName) {
  const baseline = {
    name: 'baseline',
    background: 0xcbd3dc,
    ground: 0x737a70,
    exposure: 1.05,
    fog: [38, 58],
    hemi: { sky: 0xe8f3ff, ground: 0x46392d, intensity: 1.9 },
    key: { color: 0xffdfb1, intensity: 3.8, position: [13, 23, 17] },
    rim: { color: 0x78aef7, intensity: 1.4, position: [-15, 12, -11] },
  };
  if (viewName === 'lightingNeutral') {
    return {
      ...baseline,
      name: 'neutral-evaluation',
      background: 0xd8dde2,
      ground: 0x777970,
      exposure: 1,
      hemi: { sky: 0xf2f4f6, ground: 0x514b43, intensity: 1.8 },
      key: { color: 0xffffff, intensity: 3.1, position: [11, 22, 15] },
      rim: { color: 0xaabbd2, intensity: 0.65, position: [-14, 11, -12] },
    };
  }
  if (viewName === 'lightingGrazing') {
    return {
      ...baseline,
      name: 'low-angle-grazing',
      background: 0xc5ccd2,
      ground: 0x6e726b,
      exposure: 1.02,
      hemi: { sky: 0xdde8f2, ground: 0x3e3a35, intensity: 1.25 },
      key: { color: 0xffd5a1, intensity: 4.4, position: [-18, 7, 15] },
      rim: { color: 0x6f9bd9, intensity: 1.3, position: [16, 10, -12] },
    };
  }
  if (viewName === 'lightingDusk') {
    return {
      ...baseline,
      name: 'source-inspired-dusk',
      background: 0x1d3560,
      ground: 0x273444,
      exposure: 1.05,
      fog: [34, 56],
      hemi: { sky: 0x6388c4, ground: 0x293044, intensity: 1.65 },
      key: { color: 0xffc08a, intensity: 1.65, position: [13, 12, 18] },
      rim: { color: 0x89afff, intensity: 2.25, position: [-15, 15, -12] },
    };
  }
  return baseline;
}

window.renderEastbrookGrandArmouryPreview = (stage, viewName) => {
  const rig = previewRig(viewName);
  const background = new THREE.Color(rig.background);
  document.body.replaceChildren();
  document.body.style.margin = '0';
  document.body.style.background = `#${background.getHexString()}`;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(1200, 900);
  renderer.setClearColor(rig.background, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = rig.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = background;
  scene.fog = new THREE.Fog(rig.background, rig.fog[0], rig.fog[1]);
  const root = createEastbrookGrandArmoury({ stage });
  scene.add(root);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: rig.ground, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 1.35;
  ground.receiveShadow = true;
  scene.add(ground);
  if (
    viewName !== 'materialAudit' &&
    !viewName.startsWith('lighting') &&
    !viewName.startsWith('interaction')
  ) {
    addPlayerScaleProxy(scene);
  }
  if (viewName === 'interactionScaleAudit') {
    addPlayerScaleProxy(scene, [-2.55, 1.35, 5.15]);
  }
  if (viewName === 'interactionColliderAudit') addInteractionColliderAudit(scene);

  const hemi = new THREE.HemisphereLight(rig.hemi.sky, rig.hemi.ground, rig.hemi.intensity);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(rig.key.color, rig.key.intensity);
  key.position.fromArray(rig.key.position);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -14;
  key.shadow.camera.right = 14;
  key.shadow.camera.top = 19;
  key.shadow.camera.bottom = -5;
  key.shadow.bias = -0.00025;
  scene.add(key);
  const rim = new THREE.DirectionalLight(rig.rim.color, rig.rim.intensity);
  rim.position.fromArray(rig.rim.position);
  scene.add(rim);

  const cameras = {
    front: [0, 9.5, 29],
    frontThreeQuarter: [20.5, 12.5, 25],
    side: [29, 9.5, 0],
    rearThreeQuarter: [-20.5, 11.5, -25],
    grazing: [19, 5.2, 27],
    materialAudit: [0, 4.8, 20],
    lightingNeutral: [20.5, 12.5, 25],
    lightingGrazing: [19, 5.2, 27],
    lightingDusk: [20.5, 10.5, 25],
    interactionScaleAudit: [0, 4.8, 20],
    interactionColliderAudit: [22, 19, 27],
  };
  const camera = new THREE.PerspectiveCamera(
    viewName === 'interactionColliderAudit' ? 39 : 35,
    1200 / 900,
    0.1,
    100,
  );
  camera.position.fromArray(cameras[viewName] ?? cameras.frontThreeQuarter);
  const target =
    viewName === 'materialAudit'
      ? [0, 4.4, 3]
      : viewName === 'lightingGrazing'
        ? [0, 6.3, 0]
        : viewName === 'interactionScaleAudit'
          ? [0, 3.3, 3.15]
          : viewName === 'interactionColliderAudit'
            ? [0, 8.1, 0]
            : [0, 7.4, 0];
  camera.lookAt(...target);
  scene.add(camera);
  renderer.render(scene, camera);
  const stats = {
    ...modelStats(root),
    previewLighting: {
      rig: rig.name,
      exposure: rig.exposure,
      nonPunctualLights: 3,
      punctualLights: 0,
    },
  };
  if (stage === 'interaction' || stage === 'optimization' || stage === 'final') {
    stats.interactionContract = {
      mode: root.userData.sculptRuntime.interaction.mode,
      rootPivot: root.userData.sculptRuntime.rootPivot,
      collider: root.userData.sculptRuntime.collider,
      sockets: ARMOURY_SOCKET_DEFINITIONS.map((definition) => ({
        nodeName: definition.nodeName,
        position: root.getObjectByName(definition.nodeName)?.position.toArray(),
        interactive: false,
      })),
      shippingCollisionMeshes: 0,
      previewOnlyAudit: viewName.startsWith('interaction'),
    };
  }
  return stats;
};

window.renderEastbrookGrandArmouryTier1PaletteAudit = () => {
  document.body.replaceChildren();
  document.body.style.margin = '0';

  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 900;
  document.body.append(canvas);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Tier-1 palette audit canvas did not provide a 2D context');

  const cssColor = (value) => `#${value.toString(16).padStart(6, '0')}`;
  const panels = [
    ARMOURY_TIER1_AUDIT_ALBEDOS.stone,
    ARMOURY_TIER1_AUDIT_ALBEDOS.cobalt,
    ARMOURY_TIER1_AUDIT_ALBEDOS.timber,
    ARMOURY_TIER1_AUDIT_ALBEDOS.arcane,
  ];
  const panelWidth = canvas.width / 5;
  for (const [index, color] of panels.entries()) {
    context.fillStyle = cssColor(color);
    context.fillRect(index * panelWidth, 0, panelWidth, canvas.height);
  }

  const splitPanelX = panelWidth * 4;
  context.fillStyle = cssColor(ARMOURY_TIER1_AUDIT_ALBEDOS.gold);
  context.fillRect(splitPanelX, 0, panelWidth / 2, canvas.height);
  context.fillStyle = cssColor(ARMOURY_TIER1_AUDIT_ALBEDOS.warm);
  context.fillRect(splitPanelX + panelWidth / 2, 0, panelWidth / 2, canvas.height);

  return {
    purpose: 'Tier-1 k=5 palette diagnostic only; not model preview evidence',
    panelCount: 5,
    splitPanel: ['gold', 'warm'],
    sourceAlbedos: Object.fromEntries(
      Object.entries(ARMOURY_TIER1_AUDIT_ALBEDOS).map(([key, value]) => [key, cssColor(value)]),
    ),
  };
};

window.__ready = true;
