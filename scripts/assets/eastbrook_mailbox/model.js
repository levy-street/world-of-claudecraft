import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const EASTBROOK_MAILBOX_STAGES = Object.freeze([
  'blockout',
  'structural',
  'form',
  'material',
  'final',
]);

export const EASTBROOK_MAILBOX_CONTRACT = Object.freeze({
  id: 'eastbrook-ravenpost-mailbox',
  rootName: 'EastbrookRavenpostMailbox',
  outputName: 'mailbox_pillar.glb',
  dimensions: Object.freeze({ width: 1.65, height: 2.9, depth: 1.05 }),
  triangleTarget: 2000,
  triangleCeiling: 3000,
  byteCeiling: 100 * 1024,
  serviceCues: Object.freeze([
    'raven-crest',
    'gold-mail-slot',
    'cobalt-rain-hood',
    'stone-footing',
  ]),
  sockets: Object.freeze([
    Object.freeze({
      id: 'mail-slot',
      name: 'Socket_MailSlot',
      position: [0, 1.94, 0.4491666667],
      authoredPosition: [0, 1.94, 0.462],
      purpose: 'mail service interaction cue',
    }),
    Object.freeze({
      id: 'unread-glow',
      name: 'Socket_UnreadGlow',
      position: [0, 1.62, 0.4783333333],
      authoredPosition: [0, 1.62, 0.492],
      purpose: 'per-viewer unread mail effect anchor',
    }),
  ]),
});

const PALETTE = Object.freeze({
  stoneDeep: 0x30343a,
  stone: 0x555b61,
  stoneLight: 0x777d80,
  stoneEdge: 0x979b98,
  timberDeep: 0x211813,
  timberDark: 0x33251c,
  timber: 0x4c3829,
  timberLight: 0x704e32,
  roofDeep: 0x0c2454,
  roof: 0x153b88,
  roofLight: 0x2658b1,
  iron: 0x31363b,
  ironLight: 0x596067,
  gold: 0xa27320,
  goldLight: 0xd4a23c,
});

const MATERIAL_DEFINITIONS = Object.freeze({
  opaque: Object.freeze({ name: 'MailboxOpaque', metalness: 0.02, roughness: 0.84 }),
  metal: Object.freeze({ name: 'MailboxMetal', metalness: 0.62, roughness: 0.42 }),
});

function matrixFor(position, rotation = [0, 0, 0], scale = [1, 1, 1]) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
}

function preparedGeometry(source, color, transform) {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('uv1');
  if (transform) geometry.applyMatrix4(transform);
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

function addGeometry(buckets, bucket, geometry, color, options = {}) {
  buckets[bucket].push(
    preparedGeometry(
      geometry,
      color,
      matrixFor(options.position ?? [0, 0, 0], options.rotation, options.scale),
    ),
  );
}

function addBox(buckets, bucket, size, position, color, rotation = [0, 0, 0]) {
  addGeometry(buckets, bucket, new THREE.BoxGeometry(...size), color, { position, rotation });
}

function addRoundedBox(buckets, bucket, size, position, color, radius) {
  addGeometry(
    buckets,
    bucket,
    new RoundedBoxGeometry(size[0], size[1], size[2], 1, radius),
    color,
    { position },
  );
}

function addCylinder(
  buckets,
  bucket,
  radiusTop,
  radiusBottom,
  height,
  segments,
  position,
  color,
  rotation = [0, 0, 0],
) {
  addGeometry(
    buckets,
    bucket,
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, false),
    color,
    { position, rotation },
  );
}

function addOctahedron(buckets, bucket, radius, position, color, scale = [1, 1, 1]) {
  addGeometry(buckets, bucket, new THREE.OctahedronGeometry(radius, 0), color, {
    position,
    scale,
  });
}

function addBeamXY(buckets, bucket, start, end, z, thickness, depth, color) {
  const deltaX = end[0] - start[0];
  const deltaY = end[1] - start[1];
  const length = Math.hypot(deltaX, deltaY);
  addBox(
    buckets,
    bucket,
    [length, thickness, depth],
    [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, z],
    color,
    [0, 0, Math.atan2(deltaY, deltaX)],
  );
}

function makePitchedRoof(width, depth, eaveY, peakY) {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const vertices = [
    -halfWidth,
    eaveY,
    -halfDepth,
    0,
    peakY,
    -halfDepth,
    halfWidth,
    eaveY,
    -halfDepth,
    -halfWidth,
    eaveY,
    halfDepth,
    0,
    peakY,
    halfDepth,
    halfWidth,
    eaveY,
    halfDepth,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex([0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2]);
  geometry.computeVertexNormals();
  return geometry;
}

function makeExtrudedPanel(points, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index++)
    shape.lineTo(points[index][0], points[index][1]);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 1,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function addBaseAndPrimaryMasses(buckets) {
  const blockPositions = [
    [-0.205, 0.14, -0.145],
    [0.205, 0.14, -0.145],
    [-0.205, 0.14, 0.145],
    [0.205, 0.14, 0.145],
  ];
  for (const [index, position] of blockPositions.entries()) {
    addRoundedBox(
      buckets,
      'opaque',
      [0.38, 0.28, 0.28],
      position,
      index % 3 === 0 ? PALETTE.stone : PALETTE.stoneLight,
      0.035,
    );
  }
  addRoundedBox(buckets, 'opaque', [0.58, 0.22, 0.44], [0, 0.39, 0], PALETTE.stone, 0.04);

  addBox(buckets, 'opaque', [0.25, 0.9, 0.25], [0, 0.91, 0], PALETTE.timberDark);
  addBox(buckets, 'opaque', [1.34, 0.92, 0.72], [0, 1.62, 0], PALETTE.timberDark);
  addGeometry(
    buckets,
    'opaque',
    makeExtrudedPanel(
      [
        [-0.67, 0],
        [0.67, 0],
        [0, 0.58],
      ],
      0.71,
    ),
    PALETTE.timberDark,
    { position: [0, 2.08, 0] },
  );
  addGeometry(buckets, 'opaque', makePitchedRoof(1.65, 1.05, 2.13, 2.68), PALETTE.roof, {});
  addBox(buckets, 'opaque', [0.16, 0.16, 1.08], [0, 2.69, 0], PALETTE.timberDeep);
  addRoundedBox(buckets, 'metal', [0.26, 0.2, 0.28], [0, 2.8, 0.36], PALETTE.gold, 0.025);
}

function addStructuralSystems(buckets) {
  for (const z of [-0.39, 0.39]) {
    addBeamXY(buckets, 'opaque', [-0.08, 1.05], [-0.51, 1.18], z, 0.1, 0.1, PALETTE.timberDeep);
    addBeamXY(buckets, 'opaque', [0.08, 1.05], [0.51, 1.18], z, 0.1, 0.1, PALETTE.timberDeep);
  }
  for (const z of [-0.382, 0.382]) {
    for (const x of [-0.61, 0.61]) {
      addBox(buckets, 'opaque', [0.12, 0.95, 0.11], [x, 1.62, z], PALETTE.timberLight);
    }
    addBox(buckets, 'opaque', [1.34, 0.11, 0.11], [0, 1.2, z], PALETTE.timberLight);
    addBox(buckets, 'opaque', [1.34, 0.11, 0.11], [0, 2.03, z], PALETTE.timberDeep);
    addBeamXY(buckets, 'opaque', [-0.61, 2.06], [0, 2.62], z, 0.1, 0.11, PALETTE.timberDeep);
    addBeamXY(buckets, 'opaque', [0, 2.62], [0.61, 2.06], z, 0.1, 0.11, PALETTE.timberDeep);
  }

  const slope = Math.atan2(2.68 - 2.13, 1.65 / 2);
  for (const side of [-1, 1]) {
    for (const fraction of [0.2, 0.43, 0.66, 0.87]) {
      const x = side * (1.65 / 2) * (1 - fraction);
      const y = 2.13 + (2.68 - 2.13) * fraction + 0.025;
      addBox(
        buckets,
        'opaque',
        [0.06, 0.035, 1.02],
        [x, y, 0],
        fraction === 0.66 ? PALETTE.roofLight : PALETTE.roofDeep,
        [0, 0, -side * slope],
      );
    }
  }
  for (const side of [-1, 1]) {
    addBeamXY(
      buckets,
      'opaque',
      [side * 0.8, 2.12],
      [0, 2.69],
      0.47,
      0.11,
      0.1,
      PALETTE.timberDark,
    );
    addBeamXY(
      buckets,
      'opaque',
      [side * 0.8, 2.12],
      [0, 2.69],
      -0.47,
      0.11,
      0.1,
      PALETTE.timberDark,
    );
  }
}

function addSurfaceRhythm(buckets) {
  const frontColors = [
    PALETTE.timber,
    PALETTE.timberLight,
    PALETTE.timber,
    PALETTE.timberDark,
    PALETTE.timberLight,
  ];
  for (let index = 0; index < frontColors.length; index++) {
    addBox(
      buckets,
      'opaque',
      [1.08, 0.135, 0.025],
      [0, 1.33 + index * 0.16, 0.381],
      frontColors[index],
    );
    addBox(
      buckets,
      'opaque',
      [1.08, 0.135, 0.025],
      [0, 1.33 + index * 0.16, -0.381],
      frontColors[(index + 2) % frontColors.length],
    );
  }
  for (const side of [-1, 1]) {
    for (let index = 0; index < 4; index++) {
      addBox(
        buckets,
        'opaque',
        [0.025, 0.16, 0.54],
        [side * 0.671, 1.35 + index * 0.19, 0],
        frontColors[(index + (side > 0 ? 1 : 0)) % frontColors.length],
      );
    }
  }
  for (const side of [-1, 1]) {
    addBox(buckets, 'opaque', [0.11, 0.78, 0.11], [side * 0.52, 1.63, 0.41], PALETTE.timberDark);
  }
}

function addMailHardware(buckets) {
  addRoundedBox(buckets, 'metal', [0.72, 0.31, 0.075], [0, 1.83, 0.425], PALETTE.gold, 0.035);
  addRoundedBox(buckets, 'opaque', [0.54, 0.14, 0.09], [0, 1.84, 0.472], PALETTE.timberDeep, 0.025);
  addOctahedron(buckets, 'metal', 0.13, [0, 1.55, 0.45], PALETTE.goldLight, [1, 0.82, 0.35]);
  for (const side of [-1, 1]) {
    addOctahedron(buckets, 'metal', 0.115, [side * 0.675, 1.7, 0], PALETTE.gold, [0.42, 0.9, 1]);
  }
  addCylinder(buckets, 'metal', 0.17, 0.17, 0.12, 8, [0, 0.51, 0], PALETTE.gold);
  for (const side of [-1, 1]) {
    addOctahedron(
      buckets,
      'metal',
      0.075,
      [side * 0.11, 0.51, 0.14],
      PALETTE.goldLight,
      [0.7, 1, 0.32],
    );
  }
}

function addRavenCrest(buckets) {
  const z = 0.444;
  const ravenParts = [
    {
      points: [
        [-0.08, -0.16],
        [0, -0.27],
        [0.09, -0.14],
        [0.1, 0.1],
        [0.04, 0.2],
        [-0.07, 0.16],
        [-0.11, 0.02],
      ],
      position: [0, 2.31, z],
      color: PALETTE.iron,
    },
    {
      points: [
        [0.02, 0.03],
        [0.15, 0.08],
        [0.04, -0.01],
      ],
      position: [0, 2.44, z + 0.008],
      color: PALETTE.gold,
    },
    {
      points: [
        [-0.03, 0.06],
        [-0.28, 0.15],
        [-0.23, 0.03],
        [-0.35, 0.02],
        [-0.25, -0.08],
        [-0.13, -0.17],
      ],
      position: [-0.06, 2.28, z],
      color: PALETTE.ironLight,
    },
    {
      points: [
        [0.03, 0.06],
        [0.28, 0.15],
        [0.23, 0.03],
        [0.35, 0.02],
        [0.25, -0.08],
        [0.13, -0.17],
      ],
      position: [0.06, 2.28, z],
      color: PALETTE.iron,
    },
  ];
  for (const part of ravenParts) {
    addGeometry(
      buckets,
      part.color === PALETTE.gold ? 'metal' : 'opaque',
      makeExtrudedPanel(part.points, 0.055),
      part.color,
      {
        position: part.position,
      },
    );
  }
  addOctahedron(buckets, 'metal', 0.025, [0.035, 2.425, z + 0.045], PALETTE.goldLight, [1, 1, 0.5]);
}

function normalizeBuckets(buckets) {
  const box = new THREE.Box3();
  for (const geometries of Object.values(buckets)) {
    for (const geometry of geometries) {
      geometry.computeBoundingBox();
      box.union(geometry.boundingBox);
    }
  }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const target = EASTBROOK_MAILBOX_CONTRACT.dimensions;
  const translate = new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z);
  const scale = new THREE.Matrix4().makeScale(
    target.width / size.x,
    target.height / size.y,
    target.depth / size.z,
  );
  for (const geometries of Object.values(buckets)) {
    for (const geometry of geometries) {
      geometry.applyMatrix4(translate);
      geometry.applyMatrix4(scale);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    }
  }
  return {
    point(value) {
      return [
        (value[0] - center.x) * (target.width / size.x),
        (value[1] - box.min.y) * (target.height / size.y),
        (value[2] - center.z) * (target.depth / size.z),
      ];
    },
  };
}

function stageAtLeast(stage, required) {
  return EASTBROOK_MAILBOX_STAGES.indexOf(stage) >= EASTBROOK_MAILBOX_STAGES.indexOf(required);
}

export function createEastbrookMailbox(stage = 'final') {
  if (!EASTBROOK_MAILBOX_STAGES.includes(stage)) throw new Error(`unknown mailbox stage: ${stage}`);
  const buckets = { opaque: [], metal: [] };
  addBaseAndPrimaryMasses(buckets);
  if (stageAtLeast(stage, 'structural')) addStructuralSystems(buckets);
  if (stageAtLeast(stage, 'form')) {
    addMailHardware(buckets);
    addRavenCrest(buckets);
  }
  if (stageAtLeast(stage, 'material')) addSurfaceRhythm(buckets);

  const normalization = normalizeBuckets(buckets);
  const root = new THREE.Group();
  root.name = EASTBROOK_MAILBOX_CONTRACT.rootName;
  root.userData.sculptRuntime = {
    schemaVersion: 1,
    assetId: EASTBROOK_MAILBOX_CONTRACT.id,
    stage,
    coordinateFrame: { front: '+Z', up: '+Y', right: '+X', units: 'world-yards' },
    nativeBounds: { ...EASTBROOK_MAILBOX_CONTRACT.dimensions },
    serviceCues: [...EASTBROOK_MAILBOX_CONTRACT.serviceCues],
    interaction: {
      mode: 'mailbox-service-prop',
      interactive: true,
      authority: 'ground-object-entity',
    },
    collider: { shippingCollisionMesh: false },
    destruction: { breakable: false, detachableParts: [] },
  };

  const materials = Object.fromEntries(
    Object.entries(MATERIAL_DEFINITIONS).map(([key, definition]) => [
      key,
      new THREE.MeshStandardMaterial({
        name: definition.name,
        color: 0xffffff,
        vertexColors: true,
        metalness: definition.metalness,
        roughness: definition.roughness,
      }),
    ]),
  );
  for (const [key, geometries] of Object.entries(buckets)) {
    const geometry = mergeGeometries(geometries, false);
    if (!geometry) throw new Error(`failed to merge mailbox ${key} geometry`);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials[key]);
    mesh.name = `${EASTBROOK_MAILBOX_CONTRACT.rootName}_${MATERIAL_DEFINITIONS[key].name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  const sockets = {};
  for (const definition of EASTBROOK_MAILBOX_CONTRACT.sockets) {
    const socket = new THREE.Object3D();
    socket.name = definition.name;
    socket.position.fromArray(normalization.point(definition.authoredPosition));
    socket.userData.sculptSocket = {
      id: definition.id,
      purpose: definition.purpose,
      interactive: definition.id === 'mail-slot',
    };
    root.add(socket);
    sockets[definition.id] = {
      nodeName: definition.name,
      position: socket.position.toArray(),
      purpose: definition.purpose,
      interactive: definition.id === 'mail-slot',
    };
  }
  root.userData.sculptRuntime.sockets = sockets;
  root.updateMatrixWorld(true);
  return root;
}
