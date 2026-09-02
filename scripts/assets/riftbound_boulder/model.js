// The Riftbound Boulder: the deterministic procedural factory for the rolling
// mount's GLB. No reference image and no textures. The stone is an icosphere
// pushed around by layered value noise, flat-shaded, and painted through vertex
// colors; the rift cracks are a marching-triangles isoline of a second noise
// field, ribboned into thin glowing seams. Nothing here is random at runtime:
// every number falls out of the vertex position, so two runs on two machines
// emit byte-identical geometry.
//
// Why the cracks are an isoline and not a set of coloured faces: colouring whole
// faces makes contiguous BLOBS (adjacent faces share the field's low regions),
// which reads as paint splashed on a rock rather than as light coming out of it.
// The zero-crossing of a scalar field is by construction a one-dimensional
// curve, so it gives thin, connected, winding seams for the same money. The
// isoline is solved on the SAME displaced topology as the stone, so each seam
// segment lies exactly on the flat facet it crosses and can never float off it.
//
// The model is authored at UNIT radius and then normalized so its bounding box
// is exactly 2.0 tall and centred on the origin. That is load-bearing rather
// than tidiness: the renderer rolls this mount by rotating its visual root, so
// the root's origin has to BE the stone's centre, and the manifest reaches that
// by pairing `height: 1.6` with `hover: -0.8`. Both of those numbers are only
// correct while the authored extent is exactly 2.0, so the normalization lives
// here (where the contract test can pin it) instead of being assumed downstream.
//
// Used by export_entry.js (browser-side GLTFExporter) and by the contract test
// through the shipped GLB. See export_riftbound_boulder.mjs for the driver.

import * as THREE from 'three';

/** Authored radius before normalization. */
const BASE_RADIUS = 1;
/** Icosphere subdivision. three subdivides each edge into (detail + 1)
 *  segments, so this is 20 * 25 = 500 faces: chunky enough that the flat
 *  shading still reads as broken stone, fine enough that a one-facet-wide
 *  crack segment is a seam rather than a stripe. */
const STONE_DETAIL = 4;
/** Peak-to-trough displacement as a fraction of BASE_RADIUS. Past about 0.18
 *  the crags start reading as a potato rather than a broken stone. */
const RELIEF = 0.15;
/** Half-width of a crack ribbon, in authored units. */
const CRACK_HALF_WIDTH = 0.022;
/** How far a ribbon floats off its facet. Enough to never z-fight, small
 *  enough to stay invisible at any camera distance the game uses. */
const CRACK_LIFT = 0.006;

const STONE_DARK = new THREE.Color('#2f323b');
const STONE_LIGHT = new THREE.Color('#61667a');
const CRACK_HOT = new THREE.Color('#d7bcff');
const CRACK_DEEP = new THREE.Color('#7a4fd6');

/** Integer hash to [0,1). The only entropy source in this file. */
function hash3(x, y, z) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (z | 0) * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/** Trilinear value noise over the integer lattice, sampled at a point. */
function valueNoise(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const tx = smoothstep(x - xi);
  const ty = smoothstep(y - yi);
  const tz = smoothstep(z - zi);
  let result = 0;
  for (let dz = 0; dz <= 1; dz++) {
    const wz = dz ? tz : 1 - tz;
    for (let dy = 0; dy <= 1; dy++) {
      const wy = dy ? ty : 1 - ty;
      for (let dx = 0; dx <= 1; dx++) {
        const wx = dx ? tx : 1 - tx;
        result += hash3(xi + dx, yi + dy, zi + dz) * wx * wy * wz;
      }
    }
  }
  return result;
}

/** Octaved value noise in [-1, 1] at a point, with a per-field offset so the
 *  relief and the crack network are independent shapes rather than the same
 *  shape twice. */
function fbm(nx, ny, nz, octaves, baseFrequency, offset) {
  let sum = 0;
  let amplitude = 1;
  let frequency = baseFrequency;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave++) {
    sum +=
      (valueNoise(
        nx * frequency + offset[0],
        ny * frequency + offset[1],
        nz * frequency + offset[2],
      ) -
        0.5) *
      2 *
      amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.17;
  }
  return sum / norm;
}

/** The stone's surface relief along a unit direction, in [-1, 1]. */
function relief(nx, ny, nz) {
  return fbm(nx, ny, nz, 3, 2.4, [11.7, 4.3, 27.1]);
}

/** The crack field along a unit direction. Its ZERO CROSSING is the seam. */
function crackField(nx, ny, nz) {
  return fbm(nx, ny, nz, 2, 1.9, [63.2, 18.5, 41.9]);
}

/** Displace the icosphere's shared vertices onto the stone surface, keeping the
 *  original index buffer so the crack isoline can be solved on the same
 *  topology (and therefore land exactly on the facets). */
function displaceVertices(source) {
  const position = source.getAttribute('position');
  const index = source.getIndex();
  const points = [];
  const crack = new Float32Array(position.count);
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).normalize();
    const radius = BASE_RADIUS * (1 + relief(v.x, v.y, v.z) * RELIEF);
    points.push(new THREE.Vector3(v.x * radius, v.y * radius, v.z * radius));
    crack[i] = crackField(v.x, v.y, v.z);
  }
  const faces = [];
  const faceCount = index ? index.count / 3 : position.count / 3;
  for (let face = 0; face < faceCount; face++) {
    faces.push(
      index
        ? [index.getX(face * 3), index.getX(face * 3 + 1), index.getX(face * 3 + 2)]
        : [face * 3, face * 3 + 1, face * 3 + 2],
    );
  }
  return { points, crack, faces };
}

/** A flat-shaded, vertex-coloured mesh from parallel position/colour arrays. */
function buildMesh(positions, colors, material, name) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(colors), 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

function pushVertex(positions, colors, point, tint) {
  positions.push(point.x, point.y, point.z);
  colors.push(tint.r, tint.g, tint.b);
}

/**
 * Build the Riftbound Boulder.
 *
 * @param {{ sourceFingerprint?: string }} options
 * @returns {{ root: THREE.Group, animations: THREE.AnimationClip[] }}
 */
export function createRiftboundBoulder({ sourceFingerprint } = {}) {
  const source = new THREE.IcosahedronGeometry(BASE_RADIUS, STONE_DETAIL);
  const { points, crack, faces } = displaceVertices(source);
  source.dispose();

  const radii = points.map((point) => point.length());
  const minRadius = Math.min(...radii);
  const maxRadius = Math.max(...radii);
  const span = Math.max(1e-6, maxRadius - minRadius);

  // --- the stone -----------------------------------------------------------
  const stonePositions = [];
  const stoneColors = [];
  for (const [a, b, c] of faces) {
    // Exposed crags read lighter, crevice floors darker: the cheapest possible
    // ambient occlusion, and it costs no texture.
    const t = ((radii[a] + radii[b] + radii[c]) / 3 - minRadius) / span;
    const tint = STONE_DARK.clone().lerp(STONE_LIGHT, t * t);
    for (const vertex of [a, b, c]) pushVertex(stonePositions, stoneColors, points[vertex], tint);
  }

  // --- the crack seams -----------------------------------------------------
  // Marching triangles: on a face whose crack field changes sign, the seam
  // enters through one edge and leaves through another. Both crossings are
  // linear interpolations along facet edges, so the segment between them lies
  // exactly ON the flat facet the renderer draws.
  const crackPositions = [];
  const crackColors = [];
  const edge = new THREE.Vector3();
  const side = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  for (const [a, b, c] of faces) {
    const crossings = [];
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const fromValue = crack[from];
      const toValue = crack[to];
      if (fromValue === toValue || fromValue > 0 === toValue > 0) continue;
      const t = fromValue / (fromValue - toValue);
      crossings.push(points[from].clone().lerp(points[to], t));
    }
    // A well-behaved scalar field crosses a triangle exactly twice; anything
    // else is a degenerate corner case and is skipped rather than guessed at.
    if (crossings.length !== 2) continue;
    const [start, end] = crossings;
    normal
      .copy(ab.subVectors(points[b], points[a]))
      .cross(ac.subVectors(points[c], points[a]))
      .normalize();
    edge.subVectors(end, start);
    const length = edge.length();
    if (length < 1e-6) continue;
    edge.divideScalar(length);
    side.crossVectors(normal, edge).multiplyScalar(CRACK_HALF_WIDTH);
    // Overshoot each end by the half-width so consecutive segments meet at the
    // facet boundary instead of leaving a gap at every corner.
    const tail = start.clone().addScaledVector(edge, -CRACK_HALF_WIDTH);
    const head = end.clone().addScaledVector(edge, CRACK_HALF_WIDTH);
    const lift = normal.clone().multiplyScalar(CRACK_LIFT);
    const corners = [
      tail.clone().add(side).add(lift),
      tail.clone().sub(side).add(lift),
      head.clone().sub(side).add(lift),
      head.clone().add(side).add(lift),
    ];
    // Deeper seams burn hotter: the light is coming from inside the stone, so
    // the crevices should be the brightest part of the network, not the crags.
    const depth = 1 - ((start.length() + end.length()) / 2 - minRadius) / span;
    const tint = CRACK_DEEP.clone().lerp(CRACK_HOT, depth);
    for (const corner of [corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]]) {
      pushVertex(crackPositions, crackColors, corner, tint);
    }
  }

  const stone = buildMesh(
    stonePositions,
    stoneColors,
    new THREE.MeshStandardMaterial({
      name: 'riftbound_stone',
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.05,
      flatShading: true,
    }),
    'riftbound_boulder_stone',
  );
  const cracks = buildMesh(
    crackPositions,
    crackColors,
    new THREE.MeshStandardMaterial({
      name: 'riftbound_vein',
      vertexColors: true,
      roughness: 0.3,
      metalness: 0,
      emissive: CRACK_HOT,
      emissiveIntensity: 1,
      flatShading: true,
      // The ribbons are zero-thickness surface strips, so a seam that curls over
      // the horizon must not vanish when its facet turns away.
      side: THREE.DoubleSide,
    }),
    'riftbound_boulder_veins',
  );

  const root = new THREE.Group();
  root.name = 'riftbound_boulder';
  root.add(stone, cracks);

  // Normalize to an exactly 2.0-tall, origin-centred stone (see the header).
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bounds.getSize(size);
  bounds.getCenter(center);
  const fit = 2 / size.y;
  for (const mesh of [stone, cracks]) {
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      position.setXYZ(
        i,
        (position.getX(i) - center.x) * fit,
        (position.getY(i) - center.y) * fit,
        (position.getZ(i) - center.z) * fit,
      );
    }
    position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  }

  if (sourceFingerprint) root.userData.sourceFingerprint = sourceFingerprint;
  // No clips: this mount is deliberately clipless (the prop lane, like the snail
  // and the hover cycle). Its motion IS the roll, and the roll is computed from
  // travel in src/render/mount_visuals.ts, never baked.
  return { root, animations: [] };
}
