import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const PALETTE = {
  walnutDark: 0x24120d,
  walnut: 0x3f2115,
  walnutWarm: 0x5a321d,
  walnutEdge: 0x70472b,
  ironDark: 0x18191a,
  iron: 0x343334,
  ironEdge: 0x57514b,
  bronzeDark: 0x4a3523,
  bronze: 0x7c5b34,
  bronzeEdge: 0xa07b45,
  cyan: 0x35d8df,
  cyanPale: 0x8bf5ee,
  violet: 0x8d49e8,
  violetPale: 0xc17aff,
  amber: 0xe09b37,
};

function prepareGeometry(source, color, matrix = null) {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('uv1');
  if (matrix) geometry.applyMatrix4(matrix);
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();

  const tint = new THREE.Color(color);
  const colors = new Float32Array(geometry.getAttribute('position').count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = tint.r;
    colors[i + 1] = tint.g;
    colors[i + 2] = tint.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function matrixFor(position, rotation = [0, 0, 0], scale = [1, 1, 1]) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
}

function addGeometry(bucket, geometry, color, options = {}) {
  const position = options.position ?? [0, 0, 0];
  const rotation = options.rotation ?? [0, 0, 0];
  const scale = options.scale ?? [1, 1, 1];
  bucket.push(prepareGeometry(geometry, color, matrixFor(position, rotation, scale)));
}

function addBox(bucket, size, position, color, rotation = [0, 0, 0]) {
  addGeometry(bucket, new THREE.BoxGeometry(...size), color, { position, rotation });
}

function makeBarrelStrip(width, theta0, theta1, radiusY, radiusZ, baseY) {
  const point = (x, theta) => [x, baseY + radiusY * Math.sin(theta), radiusZ * Math.cos(theta)];
  const vertices = [
    ...point(-width / 2, theta0),
    ...point(width / 2, theta0),
    ...point(-width / 2, theta1),
    ...point(width / 2, theta1),
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex([0, 1, 2, 1, 3, 2]);
  geometry.computeVertexNormals();
  return geometry;
}

function makeLidEndcap(x, radiusY, radiusZ, baseY, segments) {
  const vertices = [x, baseY, 0];
  for (let i = 0; i <= segments; i++) {
    const theta = (Math.PI * i) / segments;
    vertices.push(x, baseY + radiusY * Math.sin(theta), radiusZ * Math.cos(theta));
  }
  const indices = [];
  for (let i = 0; i < segments; i++) {
    if (x > 0) indices.push(0, i + 2, i + 1);
    else indices.push(0, i + 1, i + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeShield(width, height, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(-width * 0.46, height * 0.3);
  shape.lineTo(-width * 0.4, -height * 0.18);
  shape.lineTo(0, -height * 0.5);
  shape.lineTo(width * 0.4, -height * 0.18);
  shape.lineTo(width * 0.46, height * 0.3);
  shape.lineTo(width * 0.27, height * 0.48);
  shape.lineTo(-width * 0.27, height * 0.48);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.012,
    bevelThickness: 0.008,
    curveSegments: 1,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function addGear(buckets, centerY, radius, z, toothCount) {
  addGeometry(
    buckets.iron,
    new THREE.TorusGeometry(radius * 0.72, radius * 0.09, 4, 12),
    PALETTE.ironEdge,
    { position: [0, centerY, z] },
  );

  for (let i = 0; i < toothCount; i++) {
    const angle = (i / toothCount) * Math.PI * 2;
    addBox(
      buckets.iron,
      [radius * 0.29, radius * 0.15, 0.04],
      [Math.cos(angle) * radius * 0.84, centerY + Math.sin(angle) * radius * 0.84, z],
      i % 2 === 0 ? PALETTE.iron : PALETTE.ironEdge,
      [0, 0, angle],
    );
  }

  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    addBox(
      buckets.bronze,
      [radius * 0.63, radius * 0.075, 0.026],
      [Math.cos(angle) * radius * 0.25, centerY + Math.sin(angle) * radius * 0.25, z + 0.014],
      i % 2 === 0 ? PALETTE.bronze : PALETTE.bronzeDark,
      [0, 0, angle],
    );
  }
}

function addKeyhole(bucket, y, z, scale) {
  addGeometry(bucket, new THREE.CircleGeometry(0.04 * scale, 8), PALETTE.ironDark, {
    position: [0, y + 0.035 * scale, z],
  });
  addBox(
    bucket,
    [0.045 * scale, 0.095 * scale, 0.012],
    [0, y - 0.015 * scale, z],
    PALETTE.ironDark,
  );
}

function addRuneBlock(bucket, position, size, color, rotation = [0, 0, 0]) {
  addBox(bucket, size, position, color, rotation);
}

function makeMaterials() {
  return {
    wood: new THREE.MeshStandardMaterial({
      name: 'Walnut',
      color: 0xffffff,
      vertexColors: true,
      metalness: 0.02,
      roughness: 0.76,
    }),
    iron: new THREE.MeshStandardMaterial({
      name: 'WornIron',
      color: 0xffffff,
      vertexColors: true,
      metalness: 0.72,
      roughness: 0.47,
    }),
    bronze: new THREE.MeshStandardMaterial({
      name: 'AgedBronze',
      color: 0xffffff,
      vertexColors: true,
      metalness: 0.68,
      roughness: 0.4,
    }),
    arcane: new THREE.MeshStandardMaterial({
      name: 'ArcaneAccents',
      color: 0xffffff,
      vertexColors: true,
      emissive: 0x0c1523,
      emissiveIntensity: 0.55,
      metalness: 0.08,
      roughness: 0.24,
    }),
  };
}

export function createBankerChest() {
  const buckets = { wood: [], iron: [], bronze: [], arcane: [] };
  const materials = makeMaterials();

  addBox(buckets.wood, [1.9, 0.58, 0.96], [0, 0.42, 0], PALETTE.walnutDark);
  const frontBoardColors = [
    PALETTE.walnut,
    PALETTE.walnutWarm,
    PALETTE.walnutDark,
    PALETTE.walnutWarm,
    PALETTE.walnut,
  ];
  for (let i = 0; i < 5; i++) {
    addBox(buckets.wood, [0.35, 0.47, 0.022], [-0.72 + i * 0.36, 0.43, 0.493], frontBoardColors[i]);
  }
  for (const x of [-0.961, 0.961]) {
    for (let i = 0; i < 3; i++) {
      addBox(
        buckets.wood,
        [0.022, 0.47, 0.27],
        [x, 0.43, -0.3 + i * 0.3],
        frontBoardColors[(i + (x > 0 ? 1 : 0)) % frontBoardColors.length],
      );
    }
  }

  const lidBaseY = 0.75;
  const lidRadiusY = 0.5;
  const lidRadiusZ = 0.52;
  const lidSlats = 10;
  for (let i = 0; i < lidSlats; i++) {
    const theta0 = (i / lidSlats) * Math.PI;
    const theta1 = ((i + 1) / lidSlats) * Math.PI;
    addGeometry(
      buckets.wood,
      makeBarrelStrip(1.9, theta0, theta1, lidRadiusY - 0.014, lidRadiusZ - 0.014, lidBaseY),
      PALETTE.walnutDark,
    );
  }
  for (let i = 0; i < lidSlats; i++) {
    const theta0 = (i / lidSlats) * Math.PI + 0.012;
    const theta1 = ((i + 1) / lidSlats) * Math.PI - 0.012;
    addGeometry(
      buckets.wood,
      makeBarrelStrip(1.92, theta0, theta1, lidRadiusY, lidRadiusZ, lidBaseY),
      i % 3 === 1 ? PALETTE.walnutWarm : i % 3 === 2 ? PALETTE.walnutDark : PALETTE.walnut,
    );
  }
  addGeometry(
    buckets.wood,
    makeLidEndcap(-0.956, lidRadiusY, lidRadiusZ, lidBaseY, 10),
    PALETTE.walnutDark,
  );
  addGeometry(
    buckets.wood,
    makeLidEndcap(0.956, lidRadiusY, lidRadiusZ, lidBaseY, 10),
    PALETTE.walnut,
  );

  addBox(buckets.iron, [2.08, 0.12, 1.08], [0, 0.13, 0], PALETTE.ironDark);
  addBox(buckets.iron, [2.08, 0.1, 1.08], [0, 0.7, 0], PALETTE.ironEdge);
  for (const x of [-0.96, 0.96]) {
    for (const z of [-0.5, 0.5]) {
      addBox(buckets.iron, [0.14, 0.64, 0.14], [x, 0.4, z], PALETTE.iron);
      addBox(buckets.iron, [0.28, 0.08, 0.22], [x, 0.04, z], PALETTE.ironDark);
    }
  }
  for (const x of [-0.44, 0.44]) {
    addBox(buckets.iron, [0.085, 0.53, 0.06], [x, 0.41, 0.53], PALETTE.iron);
  }
  addBox(buckets.iron, [2.02, 0.085, 0.1], [0, 0.765, 0.515], PALETTE.ironEdge);
  addBox(buckets.iron, [2.02, 0.085, 0.1], [0, 0.765, -0.515], PALETTE.iron);

  const bandPositions = [-0.92, -0.46, 0, 0.46, 0.92];
  const bandSegments = 8;
  for (const x of bandPositions) {
    const bandBucket = Math.abs(x) < 0.5 ? buckets.bronze : buckets.iron;
    for (let i = 0; i < bandSegments; i++) {
      const theta0 = (i / bandSegments) * Math.PI;
      const theta1 = ((i + 1) / bandSegments) * Math.PI;
      const theta = (theta0 + theta1) / 2;
      const delta = theta1 - theta0;
      const tangentY = lidRadiusY * Math.cos(theta);
      const tangentZ = -lidRadiusZ * Math.sin(theta);
      const tangentLength = Math.hypot(tangentY, tangentZ) * delta * 1.08;
      const rotationX = Math.atan2(tangentZ, tangentY);
      addBox(
        bandBucket,
        [0.11, tangentLength, 0.055],
        [
          x,
          lidBaseY + (lidRadiusY + 0.027) * Math.sin(theta),
          (lidRadiusZ + 0.027) * Math.cos(theta),
        ],
        Math.abs(x) < 0.5
          ? i % 3 === 0
            ? PALETTE.bronzeEdge
            : PALETTE.bronzeDark
          : i % 3 === 0
            ? PALETTE.ironEdge
            : PALETTE.iron,
        [rotationX, 0, 0],
      );
    }
  }

  addGear(buckets, 0.91, 0.255, 0.59, 10);
  addGear(buckets, 0.43, 0.275, 0.59, 10);

  addGeometry(buckets.bronze, makeShield(0.3, 0.34, 0.065), PALETTE.bronzeEdge, {
    position: [0, 0.84, 0.635],
  });
  addGeometry(buckets.bronze, makeShield(0.36, 0.4, 0.07), PALETTE.bronze, {
    position: [0, 0.39, 0.64],
  });
  addGeometry(
    buckets.bronze,
    new THREE.TorusGeometry(0.105, 0.024, 4, 8, Math.PI),
    PALETTE.bronzeEdge,
    { position: [0, 1.01, 0.625] },
  );
  addKeyhole(buckets.iron, 0.84, 0.675, 0.78);
  addKeyhole(buckets.iron, 0.39, 0.68, 0.9);

  for (const x of [-0.69, 0.69]) {
    addGeometry(buckets.iron, new THREE.TorusGeometry(0.105, 0.017, 4, 8), PALETTE.ironEdge, {
      position: [x, 0.46, 0.575],
    });
    addGeometry(buckets.bronze, new THREE.OctahedronGeometry(0.032, 0), PALETTE.bronzeEdge, {
      position: [x, 0.58, 0.58],
      scale: [1, 0.8, 0.55],
    });
  }

  const rivetPoints = [
    [-0.83, 0.69],
    [-0.62, 0.69],
    [0.62, 0.69],
    [0.83, 0.69],
    [-0.96, 0.24],
    [-0.96, 0.57],
    [0.96, 0.24],
    [0.96, 0.57],
    [-0.43, 0.19],
    [0.43, 0.19],
  ];
  for (const [x, y] of rivetPoints) {
    addGeometry(buckets.bronze, new THREE.OctahedronGeometry(0.027, 0), PALETTE.bronzeEdge, {
      position: [x, y, 0.575],
      scale: [1, 1, 0.55],
    });
  }

  addBox(buckets.arcane, [1.58, 0.018, 0.018], [0, 0.759, 0.57], PALETTE.amber);
  for (const x of [-0.72, -0.24, 0.24, 0.72]) {
    const color = x < 0 ? PALETTE.cyan : PALETTE.cyanPale;
    addRuneBlock(
      buckets.arcane,
      [x, 0.93 + (Math.abs(x) > 0.5 ? 0.025 : 0), 0.515],
      [0.035, 0.09, 0.014],
      color,
      [0.14, 0, x * 0.22],
    );
    addRuneBlock(buckets.arcane, [x + 0.055, 0.885, 0.525], [0.03, 0.04, 0.014], color, [
      0.14,
      0,
      -x * 0.18,
    ]);
  }
  for (const x of [-0.96, 0.96]) {
    for (const y of [0.3, 0.49]) {
      addRuneBlock(buckets.arcane, [x, y, 0.577], [0.032, 0.07, 0.014], PALETTE.cyan, [
        0,
        0,
        y > 0.4 ? 0.18 : -0.18,
      ]);
    }
    for (const y of [0.18, 0.62]) {
      addGeometry(
        buckets.arcane,
        new THREE.OctahedronGeometry(0.061, 0),
        y < 0.4 ? PALETTE.violet : PALETTE.violetPale,
        { position: [x, y, 0.605], scale: [0.72, 1.2, 0.45] },
      );
    }
  }

  const root = new THREE.Group();
  root.name = 'BankerChest';
  const meshDefs = [
    ['wood', 'TimberBodyAndLid'],
    ['iron', 'IronFrameAndGears'],
    ['bronze', 'BronzeBandsAndLocks'],
    ['arcane', 'ArcaneInlays'],
  ];
  for (const [key, name] of meshDefs) {
    const geometry = mergeGeometries(buckets[key], false);
    if (!geometry) throw new Error(`failed to merge ${key} geometry`);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials[key]);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const center = bounds.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -bounds.min.y, -center.z);
  root.updateMatrixWorld(true);
  return root;
}
