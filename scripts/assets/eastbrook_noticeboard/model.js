import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const NOTICEBOARD_STAGES = Object.freeze([
  'blockout',
  'structural',
  'form',
  'material',
  'surface',
  'lighting',
  'interaction',
  'optimization',
  'final',
]);
export const NOTICEBOARD_UNLOCKED_STAGE = 'final';

export const NOTICEBOARD_NATIVE_BOUNDS = Object.freeze({
  width: 2.4,
  height: 2.6,
  depth: 0.6,
});

export const NOTICEBOARD_SOCKET_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'interaction',
    nodeName: 'Socket_Interaction',
    position: Object.freeze([0, 1.3, 0.31]),
    forward: Object.freeze([0, 0, 1]),
    purpose: 'public-facing interaction anchor',
    interactive: true,
  }),
  Object.freeze({
    id: 'notices',
    nodeName: 'Socket_Notices',
    position: Object.freeze([0, 1.51, 0.15]),
    forward: Object.freeze([0, 0, 1]),
    purpose: 'future notice-content attachment anchor',
    interactive: false,
  }),
]);

export const NOTICEBOARD_INTERACTION_CONTRACT = Object.freeze({
  mode: 'interactable-civic-prop',
  frontAxis: Object.freeze([0, 0, 1]),
  rootPivot: Object.freeze({
    nodeName: 'EastbrookNoticeboard',
    floorCenter: Object.freeze([0, 0, 0]),
    rotationEuler: Object.freeze([0, 0, 0]),
    scale: Object.freeze([1, 1, 1]),
  }),
  collider: Object.freeze({
    type: 'obb',
    center: Object.freeze([0, NOTICEBOARD_NATIVE_BOUNDS.height / 2, 0]),
    size: Object.freeze([
      NOTICEBOARD_NATIVE_BOUNDS.width,
      NOTICEBOARD_NATIVE_BOUNDS.height,
      NOTICEBOARD_NATIVE_BOUNDS.depth,
    ]),
    halfExtents: Object.freeze([
      NOTICEBOARD_NATIVE_BOUNDS.width / 2,
      NOTICEBOARD_NATIVE_BOUNDS.height / 2,
      NOTICEBOARD_NATIVE_BOUNDS.depth / 2,
    ]),
    shippingCollisionMesh: false,
  }),
  destruction: Object.freeze({
    breakable: false,
    fractureGroup: null,
    detachableParts: Object.freeze([]),
  }),
});

const PALETTE = Object.freeze({
  stoneDark: 0x30343a,
  stone: 0x555b61,
  stoneLight: 0x777d80,
  timberDeep: 0x211813,
  timber: 0x33251c,
  timberLight: 0x4c3829,
  cobaltDeep: 0x0c2454,
  cobalt: 0x153b88,
  cobaltLight: 0x2658b1,
  goldDark: 0x72501e,
  gold: 0xb48335,
  goldLight: 0xd4a23c,
  parchmentDark: 0xb2976b,
  parchment: 0xd6c29a,
  parchmentLight: 0xe2d2ad,
  blockoutSurface: 0x69717a,
  blockoutHardware: 0x9b7f50,
});

function stageIndex(stage) {
  const index = NOTICEBOARD_STAGES.indexOf(stage);
  if (index < 0) throw new Error(`unknown Eastbrook noticeboard stage: ${stage}`);
  return index;
}

function atLeast(stage, threshold) {
  return stageIndex(stage) >= stageIndex(threshold);
}

function stageColor(stage, finished, blockout) {
  return atLeast(stage, 'material') ? finished : blockout;
}

function matrixFor(position, rotation = [0, 0, 0], scale = [1, 1, 1]) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
}

function prepareGeometry(source, color, matrix = null) {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('uv1');
  if (matrix) geometry.applyMatrix4(matrix);
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const tint = new THREE.Color(color);
  const colors = new Float32Array(geometry.getAttribute('position').count * 3);
  for (let index = 0; index < colors.length; index += 3) {
    colors[index] = tint.r;
    colors[index + 1] = tint.g;
    colors[index + 2] = tint.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function addGeometry(bucket, geometry, color, options = {}) {
  bucket.push(
    prepareGeometry(
      geometry,
      color,
      matrixFor(options.position ?? [0, 0, 0], options.rotation, options.scale),
    ),
  );
}

function addBox(bucket, size, position, color, rotation = [0, 0, 0]) {
  addGeometry(bucket, new THREE.BoxGeometry(...size), color, { position, rotation });
}

function makeFrustum(widthBottom, widthTop, height, depthBottom, depthTop) {
  const y0 = -height / 2;
  const y1 = height / 2;
  const xb = widthBottom / 2;
  const xt = widthTop / 2;
  const zb = depthBottom / 2;
  const zt = depthTop / 2;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        -xb,
        y0,
        -zb,
        xb,
        y0,
        -zb,
        xb,
        y0,
        zb,
        -xb,
        y0,
        zb,
        -xt,
        y1,
        -zt,
        xt,
        y1,
        -zt,
        xt,
        y1,
        zt,
        -xt,
        y1,
        zt,
      ],
      3,
    ),
  );
  geometry.setIndex([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0,
    4, 3, 4, 7,
  ]);
  geometry.computeVertexNormals();
  return geometry;
}

function makeShield(width, height, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, height / 2);
  shape.lineTo(width / 2, height / 2);
  shape.lineTo(width * 0.46, -height * 0.1);
  shape.lineTo(0, -height / 2);
  shape.lineTo(-width * 0.46, -height * 0.1);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 1,
  });
}

function makeSunburst(outerRadius, innerRadius, points, depth) {
  const shape = new THREE.Shape();
  for (let index = 0; index < points * 2; index++) {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = Math.PI / 2 + (index * Math.PI) / points;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 1,
  });
}

function addBrace(bucket, start, end, width, depth, color) {
  const a = new THREE.Vector3(...start);
  const b = new THREE.Vector3(...end);
  const direction = b.clone().sub(a);
  const length = direction.length();
  const midpoint = a.clone().add(b).multiplyScalar(0.5);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  const matrix = new THREE.Matrix4().compose(
    midpoint,
    quaternion,
    new THREE.Vector3(width, length, depth),
  );
  bucket.push(prepareGeometry(new THREE.BoxGeometry(1, 1, 1), color, matrix));
}

function mergeBucket(bucket, label) {
  if (bucket.length === 0) return null;
  const merged = mergeGeometries(bucket, false);
  if (!merged) throw new Error(`could not merge Eastbrook noticeboard ${label} geometry`);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function addStoneFeet(surface, stage) {
  const dark = stageColor(stage, PALETTE.stoneDark, PALETTE.blockoutSurface);
  const light = stageColor(stage, PALETTE.stone, PALETTE.blockoutSurface);
  for (const x of [-0.96, 0.96]) {
    addGeometry(surface, makeFrustum(0.44, 0.39, 0.17, 0.42, 0.37), dark, {
      position: [x, 0.085, 0],
    });
    addGeometry(surface, makeFrustum(0.37, 0.31, 0.17, 0.35, 0.29), light, {
      position: [x, 0.255, 0],
    });
  }
}

function addPrimaryMasses(surface, hardware, stage) {
  const timber = stageColor(stage, PALETTE.timber, PALETTE.blockoutSurface);
  const timberDeep = stageColor(stage, PALETTE.timberDeep, PALETTE.blockoutSurface);
  const cobaltDeep = stageColor(stage, PALETTE.cobaltDeep, PALETTE.blockoutSurface);
  const gold = stageColor(stage, PALETTE.gold, PALETTE.blockoutHardware);
  const goldLight = stageColor(stage, PALETTE.goldLight, PALETTE.blockoutHardware);

  addStoneFeet(surface, stage);
  for (const x of [-0.96, 0.96]) {
    addBox(surface, [0.18, 2.08, 0.18], [x, 1.38, 0], timber);
    addBox(hardware, [0.23, 0.07, 0.23], [x, 0.365, 0], gold);
    addBox(hardware, [0.24, 0.08, 0.24], [x, 2.38, 0], gold);
    addBox(hardware, [0.2, 0.18, 0.2], [x, 2.51, 0], goldLight);
  }
  addBox(surface, [1.76, 0.94, 0.12], [0, 1.48, 0.01], timberDeep);
  addBox(surface, [2.26, 0.09, 0.52], [0, 2.24, -0.01], cobaltDeep, [0.34, 0, 0]);
}

function addStructuralFrame(surface, stage) {
  const timber = stageColor(stage, PALETTE.timber, PALETTE.blockoutSurface);
  const timberLight = stageColor(stage, PALETTE.timberLight, PALETTE.blockoutSurface);
  addBox(surface, [1.94, 0.12, 0.18], [0, 1.98, 0.03], timberLight);
  addBox(surface, [1.94, 0.12, 0.18], [0, 0.98, 0.03], timberLight);
  addBox(surface, [0.12, 0.94, 0.18], [-0.86, 1.48, 0.03], timber);
  addBox(surface, [0.12, 0.94, 0.18], [0.86, 1.48, 0.03], timber);

  addBox(surface, [1.74, 0.1, 0.11], [0, 1.86, -0.115], timber);
  addBox(surface, [1.74, 0.1, 0.11], [0, 1.12, -0.115], timber);
  addBox(surface, [0.11, 0.76, 0.11], [-0.67, 1.49, -0.115], timberDeepForStage(stage));
  addBox(surface, [0.11, 0.76, 0.11], [0.67, 1.49, -0.115], timberDeepForStage(stage));

  addBrace(surface, [-0.88, 1.88, -0.11], [-0.68, 2.3, -0.24], 0.09, 0.09, timber);
  addBrace(surface, [0.88, 1.88, -0.11], [0.68, 2.3, -0.24], 0.09, 0.09, timber);
  addBrace(surface, [-0.78, 1.18, -0.16], [-0.5, 1.83, -0.16], 0.075, 0.075, timber);
  addBrace(surface, [0.78, 1.18, -0.16], [0.5, 1.83, -0.16], 0.075, 0.075, timber);
}

function timberDeepForStage(stage) {
  return stageColor(stage, PALETTE.timberDeep, PALETTE.blockoutSurface);
}

function addRoofForm(surface, stage) {
  const cobalt = stageColor(stage, PALETTE.cobalt, PALETTE.blockoutSurface);
  const cobaltDeep = stageColor(stage, PALETTE.cobaltDeep, PALETTE.blockoutSurface);
  const cobaltLight = stageColor(stage, PALETTE.cobaltLight, PALETTE.blockoutSurface);
  const timberDeep = stageColor(stage, PALETTE.timberDeep, PALETTE.blockoutSurface);
  const rowColors = [cobaltDeep, cobalt, cobaltLight];
  const rowZ = [-0.18, 0, 0.18];
  const rowY = [2.37, 2.305, 2.24];
  for (let row = 0; row < rowZ.length; row++) {
    for (let column = 0; column < 5; column++) {
      const x = -0.92 + column * 0.46;
      const tint = column % 2 === 0 ? rowColors[row] : cobalt;
      addBox(surface, [0.44, 0.065, 0.205], [x, rowY[row], rowZ[row]], tint, [0.34, 0, 0]);
    }
  }
  addBox(surface, [2.4, 0.1, 0.11], [0, 2.17, 0.245], cobaltDeep);
  addBox(surface, [2.2, 0.1, 0.13], [0, 2.46, -0.235], timberDeep);
}

function addEastbrookCrest(surface, hardware, stage) {
  const cobalt = stageColor(stage, PALETTE.cobalt, PALETTE.blockoutSurface);
  const gold = stageColor(stage, PALETTE.gold, PALETTE.blockoutHardware);
  const goldLight = stageColor(stage, PALETTE.goldLight, PALETTE.blockoutHardware);
  addGeometry(hardware, makeShield(0.46, 0.5, 0.024), gold, {
    position: [0, 2.04, 0.252],
  });
  addGeometry(surface, makeShield(0.36, 0.4, 0.018), cobalt, {
    position: [0, 2.05, 0.274],
  });
  addGeometry(hardware, makeSunburst(0.095, 0.043, 8, 0.009), goldLight, {
    position: [0, 2.06, 0.291],
  });
}

function addSurfaceDetail(surface, hardware, stage) {
  const timberColors = [PALETTE.timberDeep, PALETTE.timber, PALETTE.timberLight];
  const paperColors = [PALETTE.parchment, PALETTE.parchmentLight, PALETTE.parchmentDark];
  const gold = stageColor(stage, PALETTE.gold, PALETTE.blockoutHardware);
  const goldDark = stageColor(stage, PALETTE.goldDark, PALETTE.blockoutHardware);
  for (let row = 0; row < 5; row++) {
    addBox(
      surface,
      [1.62, 0.155, 0.025],
      [0, 1.16 + row * 0.16, 0.085],
      stageColor(stage, timberColors[row % timberColors.length], PALETTE.blockoutSurface),
    );
  }

  const notices = [
    [-0.56, 1.64, 0.27, 0.34, -0.045],
    [-0.2, 1.76, 0.3, 0.29, 0.035],
    [0.21, 1.68, 0.25, 0.37, -0.025],
    [0.55, 1.74, 0.28, 0.32, 0.045],
    [-0.42, 1.3, 0.25, 0.29, 0.025],
    [0, 1.37, 0.34, 0.38, -0.02],
    [0.42, 1.31, 0.28, 0.31, 0.035],
  ];
  for (const [index, [x, y, width, height, rotation]] of notices.entries()) {
    addBox(
      surface,
      [width, height, 0.018],
      [x, y, 0.118],
      stageColor(stage, paperColors[index % paperColors.length], PALETTE.blockoutSurface),
      [0, 0, rotation],
    );
    for (const pinX of [-width * 0.34, width * 0.34]) {
      addGeometry(
        hardware,
        new THREE.CylinderGeometry(0.022, 0.022, 0.018, 6, 1),
        index % 3 === 0 ? goldDark : gold,
        { position: [x + pinX, y + height * 0.34, 0.137], rotation: [Math.PI / 2, 0, 0] },
      );
    }
  }

  for (const x of [-0.82, 0.82]) {
    for (const y of [1.05, 1.91]) {
      addBox(hardware, [0.14, 0.14, 0.035], [x, y, 0.135], gold);
      addBox(hardware, [0.035, 0.035, 0.045], [x, y, 0.16], goldDark);
    }
  }
}

function addSocket(root, definition) {
  const socket = new THREE.Object3D();
  socket.name = definition.nodeName;
  socket.position.fromArray(definition.position);
  socket.userData.sculptSocket = {
    id: definition.id,
    purpose: definition.purpose,
    forward: [...definition.forward],
    interactive: definition.interactive,
  };
  root.add(socket);
}

function finishModel(stage, surface, hardware) {
  const root = new THREE.Group();
  root.name = 'EastbrookNoticeboard';
  const surfaceGeometry = mergeBucket(surface, 'surface');
  if (surfaceGeometry) {
    const material = new THREE.MeshStandardMaterial({
      name: 'EastbrookNoticeboardSurface',
      color: 0xffffff,
      roughness: 0.84,
      metalness: 0,
      vertexColors: true,
    });
    const mesh = new THREE.Mesh(surfaceGeometry, material);
    mesh.name = 'NoticeboardSurface';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  const hardwareGeometry = mergeBucket(hardware, 'hardware');
  if (hardwareGeometry) {
    const material = new THREE.MeshStandardMaterial({
      name: 'EastbrookNoticeboardHardware',
      color: 0xffffff,
      roughness: 0.48,
      metalness: 0.62,
      vertexColors: true,
    });
    const mesh = new THREE.Mesh(hardwareGeometry, material);
    mesh.name = 'NoticeboardHardware';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  if (atLeast(stage, 'interaction')) {
    for (const definition of NOTICEBOARD_SOCKET_DEFINITIONS) addSocket(root, definition);
  }

  root.userData.sculptRuntime = {
    version: 1,
    stage,
    source: 'deterministic-procedural-threejs',
    frontAxis: [...NOTICEBOARD_INTERACTION_CONTRACT.frontAxis],
    sockets: Object.fromEntries(
      NOTICEBOARD_SOCKET_DEFINITIONS.map((definition) => [
        definition.id,
        { nodeName: definition.nodeName, position: [...definition.position] },
      ]),
    ),
    collider: {
      ...NOTICEBOARD_INTERACTION_CONTRACT.collider,
      center: [...NOTICEBOARD_INTERACTION_CONTRACT.collider.center],
      size: [...NOTICEBOARD_INTERACTION_CONTRACT.collider.size],
      halfExtents: [...NOTICEBOARD_INTERACTION_CONTRACT.collider.halfExtents],
    },
    interaction: { mode: NOTICEBOARD_INTERACTION_CONTRACT.mode, publicFacing: true },
    destruction: { ...NOTICEBOARD_INTERACTION_CONTRACT.destruction },
    serviceCues: [
      'blue-rain-hood',
      'blank-notices',
      'original-eastbrook-shield-crest',
      'gold-hardware',
      'stone-feet',
      'rear-braces',
    ],
  };
  root.updateMatrixWorld(true);
  return root;
}

export function createEastbrookNoticeboard({ stage = NOTICEBOARD_UNLOCKED_STAGE } = {}) {
  stageIndex(stage);
  const surface = [];
  const hardware = [];
  addPrimaryMasses(surface, hardware, stage);
  if (atLeast(stage, 'structural')) addStructuralFrame(surface, stage);
  if (atLeast(stage, 'form')) {
    addRoofForm(surface, stage);
    addEastbrookCrest(surface, hardware, stage);
  }
  if (atLeast(stage, 'surface')) addSurfaceDetail(surface, hardware, stage);
  return finishModel(stage, surface, hardware);
}
