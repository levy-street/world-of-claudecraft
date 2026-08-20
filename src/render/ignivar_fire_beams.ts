// Shared procedural fire-beam VFX for Ignivar's fixed and rotating ray mechanics.
// Every decorative vertex stays inside the authoritative floor footprint so the
// spectacle cannot imply a wider hitbox than the simulation uses.

import * as THREE from 'three';
import { sharedUniforms } from './gfx';

export const IGNIVAR_FIRE_BEAM_OUTER_NAME = 'ignivarFireBeamOuter';
export const IGNIVAR_FIRE_BEAM_CORE_NAME = 'ignivarFireBeamCore';
export const IGNIVAR_FIRE_BEAM_FLOOR_GLOW_NAME = 'ignivarFireBeamFloorGlow';
export const IGNIVAR_FIRE_BEAM_FLOOR_BOUNDARY_NAME = 'ignivarFireBeamFloorBoundary';
export const IGNIVAR_FIRE_BEAM_VEIL_NAME = 'ignivarFireBeamVeil';
export const IGNIVAR_FIRE_BEAM_FLAMES_NAME = 'ignivarFireBeamFlames';
export const IGNIVAR_FIRE_BEAM_EMBERS_NAME = 'ignivarFireBeamEmbers';

export type IgnivarFireBeamPhase = 'hidden' | 'windup' | 'active';

export interface IgnivarFireBeamOptions {
  innerRange: number;
  range: number;
  startHalfWidth: number;
  endHalfWidth: number;
}

function beamPrismGeometry(
  options: IgnivarFireBeamOptions,
  widthScale: number,
  bottom: number,
  top: number,
): THREE.BufferGeometry {
  const startWidth = options.startHalfWidth * widthScale;
  const endWidth = options.endHalfWidth * widthScale;
  const positions = [
    -startWidth,
    bottom,
    options.innerRange,
    startWidth,
    bottom,
    options.innerRange,
    -endWidth,
    bottom,
    options.range,
    endWidth,
    bottom,
    options.range,
    -startWidth,
    top,
    options.innerRange,
    startWidth,
    top,
    options.innerRange,
    -endWidth,
    top,
    options.range,
    endWidth,
    top,
    options.range,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex([
    0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5, 2, 6, 3, 3, 6, 7,
  ]);
  geometry.computeVertexNormals();
  return geometry;
}

function beamFloorGeometry(
  options: IgnivarFireBeamOptions,
  widthScale: number,
  height: number,
): THREE.BufferGeometry {
  const startWidth = options.startHalfWidth * widthScale;
  const endWidth = options.endHalfWidth * widthScale;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        -startWidth,
        height,
        options.innerRange,
        startWidth,
        height,
        options.innerRange,
        -endWidth,
        height,
        options.range,
        endWidth,
        height,
        options.range,
      ],
      3,
    ),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  return geometry;
}

function addBoundaryQuad(
  positions: number[],
  indices: number[],
  points: readonly [number, number, number, number, number, number, number, number],
  height: number,
): void {
  const vertex = positions.length / 3;
  positions.push(
    points[0],
    height,
    points[1],
    points[2],
    height,
    points[3],
    points[4],
    height,
    points[5],
    points[6],
    height,
    points[7],
  );
  indices.push(vertex, vertex + 2, vertex + 1, vertex + 1, vertex + 2, vertex + 3);
}

function beamBoundaryGeometry(
  options: IgnivarFireBeamOptions,
  edgeWidth: number,
  height: number,
): THREE.BufferGeometry {
  const startInset = Math.min(edgeWidth, options.startHalfWidth);
  const endInset = Math.min(edgeWidth, options.endHalfWidth);
  const laneLength = options.range - options.innerRange;
  const capDepth = Math.min(edgeWidth, laneLength / 2);
  const nearCapWidth = THREE.MathUtils.lerp(
    options.startHalfWidth,
    options.endHalfWidth,
    capDepth / laneLength,
  );
  const farCapWidth = THREE.MathUtils.lerp(
    options.startHalfWidth,
    options.endHalfWidth,
    1 - capDepth / laneLength,
  );
  const positions: number[] = [];
  const indices: number[] = [];
  addBoundaryQuad(
    positions,
    indices,
    [
      -options.startHalfWidth,
      options.innerRange,
      -options.startHalfWidth + startInset,
      options.innerRange,
      -options.endHalfWidth,
      options.range,
      -options.endHalfWidth + endInset,
      options.range,
    ],
    height,
  );
  addBoundaryQuad(
    positions,
    indices,
    [
      options.startHalfWidth - startInset,
      options.innerRange,
      options.startHalfWidth,
      options.innerRange,
      options.endHalfWidth - endInset,
      options.range,
      options.endHalfWidth,
      options.range,
    ],
    height,
  );
  addBoundaryQuad(
    positions,
    indices,
    [
      -options.startHalfWidth,
      options.innerRange,
      options.startHalfWidth,
      options.innerRange,
      -nearCapWidth,
      options.innerRange + capDepth,
      nearCapWidth,
      options.innerRange + capDepth,
    ],
    height,
  );
  addBoundaryQuad(
    positions,
    indices,
    [
      -farCapWidth,
      options.range - capDepth,
      farCapWidth,
      options.range - capDepth,
      -options.endHalfWidth,
      options.range,
      options.endHalfWidth,
      options.range,
    ],
    height,
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

/** Three vertical sheets give the wall a moving inner body from any raid-camera angle. */
function beamVeilGeometry(
  options: IgnivarFireBeamOptions,
  bottom: number,
  top: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const lateral of [-0.54, 0, 0.54]) {
    const vertex = positions.length / 3;
    const startX = options.startHalfWidth * lateral;
    const endX = options.endHalfWidth * lateral;
    positions.push(
      startX,
      bottom,
      options.innerRange,
      endX,
      bottom,
      options.range,
      startX,
      top,
      options.innerRange,
      endX,
      top,
      options.range,
    );
    uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
    indices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function fireMaterial(
  color: number,
  opacity: number,
  blending: THREE.Blending = THREE.NormalBlending,
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.userData.ignivarBeamBaseOpacity = opacity;
  return material;
}

function animatedFireMaterial(
  color: number,
  opacity: number,
  layer: 'outer' | 'veil',
): THREE.MeshBasicMaterial {
  const material = fireMaterial(color, opacity);
  material.userData.ignivarFireTime = sharedUniforms.uTime;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIgnivarBeamPosition;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvIgnivarBeamPosition = position;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vIgnivarBeamPosition;\nuniform float uTime;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float ignivarRise = fract(vIgnivarBeamPosition.y * 0.23 - uTime * 0.72);
float ignivarLongWave = sin(vIgnivarBeamPosition.z * 0.72 - uTime * 5.4);
float ignivarCrossWave = sin(vIgnivarBeamPosition.z * 1.57 + vIgnivarBeamPosition.x * 4.1 + uTime * 3.2);
float ignivarTongues = smoothstep(0.08, 0.92, 0.52 + ignivarLongWave * 0.31 + ignivarCrossWave * 0.22);
float ignivarFlicker = 0.68 + 0.32 * sin(uTime * 9.0 + vIgnivarBeamPosition.z * 0.83);
float ignivarFade = 1.0 - smoothstep(0.62, 1.0, ignivarRise);
diffuseColor.rgb *= 0.82 + ignivarTongues * 0.5;
diffuseColor.a *= mix(0.48, 1.0, ignivarTongues) * mix(0.72, 1.0, ignivarFade) * ignivarFlicker;`,
      );
  };
  material.customProgramCacheKey = () => `ignivar-fire-beam-${layer}-v1`;
  return material;
}

function pointsMaterial(color: number, size: number, opacity: number): THREE.PointsMaterial {
  const material = new THREE.PointsMaterial({
    color,
    size,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  material.userData.ignivarBeamBaseOpacity = opacity;
  return material;
}

function setBaseOpacity(object: THREE.Object3D, multiplier: number): void {
  const renderable = object as THREE.Object3D & {
    material?: THREE.Material | THREE.Material[];
  };
  const materials = renderable.material
    ? Array.isArray(renderable.material)
      ? renderable.material
      : [renderable.material]
    : [];
  for (const material of materials) {
    const baseOpacity = Number(material.userData.ignivarBeamBaseOpacity ?? material.opacity);
    material.opacity = baseOpacity * multiplier;
  }
}

/** Builds one readable fire wall with tongues and embers along the full lane. */
export function buildIgnivarFireBeam(options: IgnivarFireBeamOptions): THREE.Group {
  const group = new THREE.Group();
  group.userData.vfxLayer = 'fireBeam';
  group.userData.startHalfWidth = options.startHalfWidth;
  group.userData.endHalfWidth = options.endHalfWidth;

  const floorGlow = new THREE.Mesh(
    beamFloorGeometry(options, 0.98, 0.075),
    fireMaterial(0x4a0502, 0.06),
  );
  floorGlow.name = IGNIVAR_FIRE_BEAM_FLOOR_GLOW_NAME;
  floorGlow.renderOrder = 4;

  const floorBoundary = new THREE.Mesh(
    beamBoundaryGeometry(options, 0.09, 0.088),
    fireMaterial(0xc63c16, 0.42),
  );
  floorBoundary.name = IGNIVAR_FIRE_BEAM_FLOOR_BOUNDARY_NAME;
  floorBoundary.renderOrder = 5;

  const outer = new THREE.Mesh(
    beamPrismGeometry(options, 0.92, 0.1, 3.35),
    animatedFireMaterial(0x4c0904, 0.045, 'outer'),
  );
  outer.name = IGNIVAR_FIRE_BEAM_OUTER_NAME;
  outer.renderOrder = 6;

  const core = new THREE.Mesh(
    beamPrismGeometry(options, 0.14, 0.12, 1.05),
    fireMaterial(0xb84216, 0.12),
  );
  core.name = IGNIVAR_FIRE_BEAM_CORE_NAME;
  core.renderOrder = 8;

  const veil = new THREE.Mesh(
    beamVeilGeometry(options, 0.08, 4.1),
    animatedFireMaterial(0x6e1808, 0.035, 'veil'),
  );
  veil.name = IGNIVAR_FIRE_BEAM_VEIL_NAME;
  veil.renderOrder = 7;

  const flameCount = 14;
  const flameGeometry = new THREE.ConeGeometry(1, 1, 5, 1, true);
  const flames = new THREE.InstancedMesh(flameGeometry, fireMaterial(0xa62a0a, 0.09), flameCount);
  flames.name = IGNIVAR_FIRE_BEAM_FLAMES_NAME;
  flames.renderOrder = 9;
  const dummy = new THREE.Object3D();
  for (let index = 0; index < flameCount; index++) {
    const progress = (index + 1) / (flameCount + 1);
    const halfWidth = THREE.MathUtils.lerp(options.startHalfWidth, options.endHalfWidth, progress);
    const radius = Math.min(0.36, halfWidth * 0.2);
    const height = 1.05 + ((index * 7) % 5) * 0.26;
    dummy.position.set(
      Math.sin(index * 2.39996) * halfWidth * 0.56,
      0.1 + height / 2,
      THREE.MathUtils.lerp(options.innerRange, options.range, progress),
    );
    dummy.rotation.set(0, index * 1.17, 0);
    dummy.scale.set(radius, height, radius);
    dummy.updateMatrix();
    flames.setMatrixAt(index, dummy.matrix);
  }
  flames.instanceMatrix.needsUpdate = true;

  const emberCount = 24;
  const emberPositions = new Float32Array(emberCount * 3);
  for (let index = 0; index < emberCount; index++) {
    const progress = (index + 0.5) / emberCount;
    const halfWidth = THREE.MathUtils.lerp(options.startHalfWidth, options.endHalfWidth, progress);
    emberPositions[index * 3] = Math.sin(index * 2.39996) * halfWidth * 0.68;
    emberPositions[index * 3 + 1] = 0.65 + ((index * 11) % 9) * 0.17;
    emberPositions[index * 3 + 2] = THREE.MathUtils.lerp(
      options.innerRange,
      options.range,
      progress,
    );
  }
  const emberGeometry = new THREE.BufferGeometry();
  emberGeometry.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
  const embers = new THREE.Points(emberGeometry, pointsMaterial(0xffa448, 0.2, 0.16));
  embers.name = IGNIVAR_FIRE_BEAM_EMBERS_NAME;
  embers.renderOrder = 10;

  group.add(floorGlow, floorBoundary, outer, veil, core, flames, embers);
  syncIgnivarFireBeamPresentation(group, 'active', 1);
  return group;
}

/** Switches one beam between a floor-only warning and its damaging fire wall. */
export function syncIgnivarFireBeamPresentation(
  group: THREE.Object3D,
  phase: IgnivarFireBeamPhase,
  progress: number,
): void {
  group.userData.phase = phase;
  group.userData.progress = Math.max(0, Math.min(1, progress));
  if (phase === 'hidden') {
    group.visible = false;
    return;
  }

  group.visible = true;
  const clamped = group.userData.progress as number;
  const floor = group.getObjectByName(IGNIVAR_FIRE_BEAM_FLOOR_GLOW_NAME);
  const boundary = group.getObjectByName(IGNIVAR_FIRE_BEAM_FLOOR_BOUNDARY_NAME);
  const outer = group.getObjectByName(IGNIVAR_FIRE_BEAM_OUTER_NAME);
  const veil = group.getObjectByName(IGNIVAR_FIRE_BEAM_VEIL_NAME);
  const core = group.getObjectByName(IGNIVAR_FIRE_BEAM_CORE_NAME);
  const flames = group.getObjectByName(IGNIVAR_FIRE_BEAM_FLAMES_NAME);
  const embers = group.getObjectByName(IGNIVAR_FIRE_BEAM_EMBERS_NAME);

  if (phase === 'active') {
    for (const object of [floor, boundary, outer, veil, core, flames, embers]) {
      if (!object) continue;
      object.visible = true;
      object.scale.y = 1;
      setBaseOpacity(object, 1);
    }
    return;
  }

  if (floor) {
    floor.visible = true;
    floor.scale.y = 1;
    setBaseOpacity(floor, 0.78 + clamped * 0.22);
  }
  if (boundary) {
    boundary.visible = true;
    boundary.scale.y = 1;
    setBaseOpacity(boundary, 0.45 + clamped * 0.15);
  }
  if (outer) {
    outer.visible = true;
    outer.scale.y = 0.12 + clamped * 0.22;
    setBaseOpacity(outer, 0.22 + clamped * 0.18);
  }
  if (veil) {
    veil.visible = clamped >= 0.25;
    veil.scale.y = 0.1 + clamped * 0.27;
    setBaseOpacity(veil, 0.16 + clamped * 0.22);
  }
  if (core) {
    core.visible = clamped >= 0.72;
    core.scale.y = 0.08 + clamped * 0.16;
    setBaseOpacity(core, 0.12 + clamped * 0.18);
  }
  if (flames) {
    flames.visible = clamped >= 0.45;
    flames.scale.y = 0.18 + clamped * 0.32;
    setBaseOpacity(flames, 0.18 + clamped * 0.34);
  }
  if (embers) {
    embers.visible = true;
    embers.scale.y = 0.3 + clamped * 0.5;
    setBaseOpacity(embers, 0.35 + clamped * 0.45);
  }
}
