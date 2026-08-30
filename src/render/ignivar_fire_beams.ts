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
  thermalLayer?: string,
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.forceSinglePass = true;
  material.userData.ignivarBeamBaseOpacity = opacity;
  if (thermalLayer) material.userData.ignivarThermalLayer = thermalLayer;
  return material;
}

function animatedFireMaterial(
  color: number,
  opacity: number,
  layer: 'outer' | 'veil',
): THREE.MeshBasicMaterial {
  const material = fireMaterial(
    color,
    opacity,
    THREE.NormalBlending,
    layer === 'outer' ? 'turbulentShell' : 'flameVeil',
  );
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
float ignivarHeight = clamp((vIgnivarBeamPosition.y - 0.08) / ${layer === 'outer' ? '3.27' : '4.02'}, 0.0, 1.0);
float ignivarLongWave = sin(vIgnivarBeamPosition.z * 0.81 - uTime * 6.2);
float ignivarCrossWave = sin(vIgnivarBeamPosition.z * 1.71 + vIgnivarBeamPosition.x * 4.8 + uTime * 3.7);
float ignivarFineWave = sin(vIgnivarBeamPosition.z * 3.4 - vIgnivarBeamPosition.x * 7.2 - uTime * 8.4);
float ignivarTongues = smoothstep(-0.18, 0.72, ignivarLongWave * 0.46 + ignivarCrossWave * 0.34 + ignivarFineWave * 0.2);
float ignivarFlameTop = 0.2 + ignivarTongues * 0.66;
float ignivarSilhouette = 1.0 - smoothstep(ignivarFlameTop - 0.12, ignivarFlameTop + 0.08, ignivarHeight);
float ignivarFlicker = 0.72 + 0.28 * sin(uTime * 10.5 + vIgnivarBeamPosition.z * 0.91);
float ignivarBaseHeat = 1.0 - smoothstep(0.04, 0.58, ignivarHeight);
vec3 ignivarTipColor = vec3(0.52, 0.012, 0.001);
vec3 ignivarBodyColor = vec3(1.0, 0.075, 0.003);
vec3 ignivarCoreColor = vec3(1.0, 0.48, 0.045);
diffuseColor.rgb = mix(ignivarTipColor, ignivarBodyColor, 1.0 - ignivarHeight);
diffuseColor.rgb = mix(diffuseColor.rgb, ignivarCoreColor, ignivarBaseHeat * (0.42 + ignivarTongues * 0.58));
diffuseColor.a *= ignivarSilhouette * (0.34 + ignivarTongues * 0.66) * ignivarFlicker;`,
      );
  };
  material.customProgramCacheKey = () => `ignivar-fire-beam-${layer}-v2`;
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
    fireMaterial(0x3a0301, 0.08, THREE.NormalBlending, 'floorHeat'),
  );
  floorGlow.name = IGNIVAR_FIRE_BEAM_FLOOR_GLOW_NAME;
  floorGlow.renderOrder = 4;

  const floorBoundary = new THREE.Mesh(
    beamBoundaryGeometry(options, 0.09, 0.088),
    fireMaterial(0xff5a12, 0.5, THREE.NormalBlending, 'floorBoundary'),
  );
  floorBoundary.name = IGNIVAR_FIRE_BEAM_FLOOR_BOUNDARY_NAME;
  floorBoundary.renderOrder = 5;

  const outer = new THREE.Mesh(
    beamPrismGeometry(options, 0.92, 0.1, 3.35),
    animatedFireMaterial(0xff4a0b, 0.2, 'outer'),
  );
  outer.name = IGNIVAR_FIRE_BEAM_OUTER_NAME;
  outer.renderOrder = 6;

  const core = new THREE.Mesh(
    beamPrismGeometry(options, 0.14, 0.12, 1.05),
    fireMaterial(0xffd36a, 0.38, THREE.AdditiveBlending, 'whiteHotCore'),
  );
  core.name = IGNIVAR_FIRE_BEAM_CORE_NAME;
  core.renderOrder = 8;

  const veil = new THREE.Mesh(
    beamVeilGeometry(options, 0.08, 4.1),
    animatedFireMaterial(0xff7412, 0.14, 'veil'),
  );
  veil.name = IGNIVAR_FIRE_BEAM_VEIL_NAME;
  veil.renderOrder = 7;

  const flameCount = 28;
  const flameGeometry = new THREE.ConeGeometry(1, 1, 5, 1, true);
  const flames = new THREE.InstancedMesh(
    flameGeometry,
    fireMaterial(0xffffff, 0.34, THREE.NormalBlending, 'thermalTongues'),
    flameCount,
  );
  flames.name = IGNIVAR_FIRE_BEAM_FLAMES_NAME;
  flames.renderOrder = 9;
  const dummy = new THREE.Object3D();
  for (let index = 0; index < flameCount; index++) {
    const progress = (index + 1) / (flameCount + 1);
    const halfWidth = THREE.MathUtils.lerp(options.startHalfWidth, options.endHalfWidth, progress);
    const radius = Math.min(0.3, halfWidth * (0.12 + (index % 3) * 0.035));
    const height = 0.82 + ((index * 7) % 7) * 0.25;
    dummy.position.set(
      Math.sin(index * 2.39996) * halfWidth * 0.56,
      0.1 + height / 2,
      THREE.MathUtils.lerp(options.innerRange, options.range, progress),
    );
    dummy.rotation.set(0, index * 1.17, 0);
    dummy.scale.set(radius, height, radius);
    dummy.updateMatrix();
    flames.setMatrixAt(index, dummy.matrix);
    flames.setColorAt(
      index,
      new THREE.Color(index % 5 === 0 ? 0xfff2b0 : index % 2 === 0 ? 0xffb02e : 0xff5a0a),
    );
  }
  flames.instanceMatrix.needsUpdate = true;
  if (flames.instanceColor) flames.instanceColor.needsUpdate = true;

  const emberCount = 48;
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
  const embers = new THREE.Points(emberGeometry, pointsMaterial(0xffa02a, 0.17, 0.46));
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
