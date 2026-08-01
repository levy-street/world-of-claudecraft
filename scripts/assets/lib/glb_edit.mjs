// Deterministic edits to a finished art mesh.
//
// An art tool gives you a shape, not a game object. These are the small,
// scripted, re-runnable corrections that turn one into the other: cut an
// opening where a ramp has to mate, lay a floor over structural timbers.
// Every edit is expressed against measured coordinates and re-applied from the
// pristine source on every build, so the shipped asset is never a file someone
// hand-tweaked once and could not reproduce.
//
// All coordinates are in the default scene's world space, the same space
// mesh_collision.mjs measures in, so an edit and a measurement always agree
// about where things are.

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(left, right) {
  const out = new Array(16).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += left[k * 4 + row] * right[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function nodeMatrix(node) {
  const [tx, ty, tz] = node.getTranslation();
  const [qx, qy, qz, qw] = node.getRotation();
  const [sx, sy, sz] = node.getScale();
  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function transformPoint(matrix, x, y, z) {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function insideBox(point, box) {
  return (
    point[0] >= box.x - box.hw &&
    point[0] <= box.x + box.hw &&
    point[1] >= box.y - box.hh &&
    point[1] <= box.y + box.hh &&
    point[2] >= box.z - box.hd &&
    point[2] <= box.z + box.hd
  );
}

function sceneNodes(document) {
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
  const found = [];
  const visit = (node, parentMatrix) => {
    const matrix = multiply(parentMatrix, nodeMatrix(node));
    if (node.getMesh()) found.push({ node, matrix });
    for (const child of node.listChildren()) visit(child, matrix);
  };
  for (const node of scene.listChildren()) visit(node, IDENTITY);
  return { scene, nodes: found };
}

/**
 * Delete every triangle whose centroid falls inside `box`.
 *
 * Centroid rather than any-vertex so a triangle straddling the boundary is
 * decided by where most of it lies, which keeps a cut edge clean instead of
 * chewing a ragged fringe out of the surrounding surface. Orphaned vertices
 * are left behind for the optimizer stage to prune; keeping the vertex buffer
 * untouched means the accessor layout, and therefore the diff, stays small.
 *
 * Returns the number of triangles removed so the caller can assert the edit
 * actually did something. An edit that silently matches nothing is how a
 * pipeline quietly stops applying a fix nobody notices is missing.
 */
export function removeTrianglesInBox(document, box) {
  let removed = 0;
  for (const { node, matrix } of sceneNodes(document).nodes) {
    for (const primitive of node.getMesh().listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;
      const indices = primitive.getIndices();
      const count = indices ? indices.getCount() : position.getCount();
      const read = (slot) => {
        const element = [0, 0, 0];
        position.getElement(indices ? indices.getScalar(slot) : slot, element);
        return transformPoint(matrix, element[0], element[1], element[2]);
      };
      const kept = [];
      for (let slot = 0; slot + 2 < count; slot += 3) {
        const a = read(slot);
        const b = read(slot + 1);
        const c = read(slot + 2);
        const centroid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
        if (insideBox(centroid, box)) {
          removed++;
          continue;
        }
        if (indices) {
          kept.push(indices.getScalar(slot), indices.getScalar(slot + 1), indices.getScalar(slot + 2));
        } else {
          kept.push(slot, slot + 1, slot + 2);
        }
      }
      if (kept.length === count) continue;
      const array = position.getCount() > 65535 ? new Uint32Array(kept) : new Uint16Array(kept);
      if (indices) {
        indices.setArray(array);
      } else {
        primitive.setIndices(
          document.createAccessor().setType('SCALAR').setArray(array).setBuffer(defaultBuffer(document)),
        );
      }
    }
  }
  return removed;
}

function defaultBuffer(document) {
  return document.getRoot().listBuffers()[0] ?? document.createBuffer();
}

const BOX_FACES = [
  { normal: [0, 1, 0], corners: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
  { normal: [0, -1, 0], corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  { normal: [1, 0, 0], corners: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
  { normal: [-1, 0, 0], corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { normal: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { normal: [0, 0, -1], corners: [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]] },
];

/**
 * Add generated boxes as one new vertex-coloured mesh in world space.
 *
 * Vertex colour rather than a texture because the loader already denormalizes
 * COLOR_0 for the hand-authored kits, so tinted geometry lands looking like
 * the rest of the game's carpentry without dragging a new texture into the
 * asset. The node sits at the scene root with an identity transform, which is
 * why the caller's coordinates are simply the measured ones.
 */
export function addBoxMesh(document, name, boxes, material = {}) {
  if (boxes.length === 0) throw new Error(`addBoxMesh("${name}") was given no boxes`);
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  for (const box of boxes) {
    const [r, g, b] = box.color;
    for (const face of BOX_FACES) {
      const base = positions.length / 3;
      for (const [cx, cy, cz] of face.corners) {
        positions.push(box.x + cx * box.hw, box.y + cy * box.hh, box.z + cz * box.hd);
        normals.push(...face.normal);
        colors.push(r, g, b, 1);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const buffer = defaultBuffer(document);
  const accessor = (type, array) =>
    document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const primitive = document
    .createPrimitive()
    .setAttribute('POSITION', accessor('VEC3', new Float32Array(positions)))
    .setAttribute('NORMAL', accessor('VEC3', new Float32Array(normals)))
    .setAttribute('COLOR_0', accessor('VEC4', new Float32Array(colors)))
    .setIndices(
      accessor(
        'SCALAR',
        positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
      ),
    )
    .setMaterial(
      document
        .createMaterial(name)
        .setBaseColorFactor([1, 1, 1, 1])
        .setRoughnessFactor(material.roughness ?? 0.85)
        .setMetallicFactor(material.metalness ?? 0),
    );
  const mesh = document.createMesh(name).addPrimitive(primitive);
  const node = document.createNode(name).setMesh(mesh);
  const { scene } = sceneNodes(document);
  scene.addChild(node);
  return node;
}

/**
 * A planked slab: boards laid along the long axis with staggered butt joints
 * and a repeating tone cycle, the same read as the harbour boardwalk so a deck
 * and the pier it mates with look like they came from the same yard.
 *
 * Deterministic: the stagger and tone come from the board's index, never a
 * random source, so the geometry is identical on every run.
 */
export function plankedSlabBoxes(slab) {
  const { x, z, hw, hd, y, thickness, plankPitch, plankLength, seam, tones } = slab;
  const alongX = hw >= hd;
  const runHalf = alongX ? hw : hd;
  const acrossHalf = alongX ? hd : hw;
  const rows = Math.max(1, Math.round((acrossHalf * 2) / plankPitch));
  const rowPitch = (acrossHalf * 2) / rows;
  const boxes = [];
  for (let row = 0; row < rows; row++) {
    const across = -acrossHalf + rowPitch * (row + 0.5);
    const stagger = (row % 3) * (plankLength / 3);
    let board = 0;
    for (let start = -runHalf - stagger; start < runHalf; start += plankLength) {
      const from = Math.max(start, -runHalf);
      const to = Math.min(start + plankLength - seam, runHalf);
      board++;
      if (to - from < plankPitch * 0.5) continue;
      const mid = (from + to) / 2;
      boxes.push({
        x: x + (alongX ? mid : across),
        y: y - thickness / 2,
        z: z + (alongX ? across : mid),
        hw: (alongX ? to - from : rowPitch - seam) / 2,
        hh: thickness / 2,
        hd: (alongX ? rowPitch - seam : to - from) / 2,
        color: tones[(row + board) % tones.length],
      });
    }
  }
  return boxes;
}
