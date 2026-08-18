// Read a GLB into world-space triangles, and write one back out.
//
// The measuring side (mesh_collision.mjs) is deliberately free of any glTF
// dependency so tests can drive it with literal triangles. This module is the
// only place that knows about the file format, and it is shared by the
// exporter, the edit stage, and the contract test, so all three measure the
// exact same geometry.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

export function glbIO() {
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
}

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

/** Column-major TRS compose, matching the glTF convention. */
function trsMatrix(node) {
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

function transformPoint(matrix, point) {
  const [x, y, z] = point;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Every triangle in the document's default scene, in world space.
 *
 * Node order follows the document, and each mesh's primitives follow their
 * declared order, so two runs over the same file produce the identical list.
 * That determinism is what lets the contract test compare measurements.
 */
export function documentTriangles(document) {
  const triangles = [];
  const visit = (node, parentMatrix) => {
    const matrix = multiply(parentMatrix, trsMatrix(node));
    const mesh = node.getMesh();
    if (mesh) {
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute('POSITION');
        if (!position) continue;
        const indices = primitive.getIndices();
        const count = indices ? indices.getCount() : position.getCount();
        const vertex = (slot) => {
          const element = [0, 0, 0];
          position.getElement(indices ? indices.getScalar(slot) : slot, element);
          return transformPoint(matrix, element);
        };
        for (let slot = 0; slot + 2 < count; slot += 3) {
          triangles.push([vertex(slot), vertex(slot + 1), vertex(slot + 2)]);
        }
      }
    }
    for (const child of node.listChildren()) visit(child, matrix);
  };
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
  for (const node of scene.listChildren()) visit(node, IDENTITY);
  return triangles;
}

export async function readGlbTriangles(path) {
  const document = await glbIO().read(path);
  return { document, triangles: documentTriangles(document) };
}

/**
 * Drop mesh compression so an edited document can be written back out.
 *
 * A shipped art file usually arrives meshopt-compressed. Reading it decodes
 * fine, but writing it again would demand the ENCODER, and re-compressing a
 * build intermediate is pointless anyway: the optimizer stage applies the
 * real compression to the final artifact. Stripping it here keeps the
 * intermediate plain and the pipeline single-purpose.
 */
export function decompressForEditing(document) {
  for (const extension of document.getRoot().listExtensionsUsed()) {
    if (extension.extensionName === 'EXT_meshopt_compression') extension.dispose();
  }
  return document;
}
