// Arena-wide visual for Ignivar's Forge Judgment. Three refuge positions and
// the single safe footprint come from the same pure geometry as the sim.

import * as THREE from 'three';
import { IGNIVAR_LAYOUT } from '../sim/dungeon_layout';
import {
  IGNIVAR_JUDGMENT_ARENA_RADIUS,
  IGNIVAR_JUDGMENT_SHELTER_COUNT,
  IGNIVAR_JUDGMENT_SHELTER_RADIUS,
  type IgnivarJudgmentShelterIndex,
  ignivarForgeShelterOffsets,
} from '../sim/ignivar_forge_judgment';
import { sharedUniforms } from './gfx';
import {
  buildIgnivarFireBeam,
  IGNIVAR_FIRE_BEAM_CORE_NAME,
  IGNIVAR_FIRE_BEAM_FLOOR_BOUNDARY_NAME,
  IGNIVAR_FIRE_BEAM_FLOOR_GLOW_NAME,
  IGNIVAR_FIRE_BEAM_OUTER_NAME,
} from './ignivar_fire_beams';

export const IGNIVAR_JUDGMENT_VISUAL_NAME = 'ignivarForgeJudgment';
export const IGNIVAR_JUDGMENT_WARNINGS_NAME = 'ignivarForgeJudgmentWarnings';
export const IGNIVAR_JUDGMENT_FIRE_NAME = 'ignivarForgeJudgmentFire';
export const IGNIVAR_JUDGMENT_SHELTERS_NAME = 'ignivarForgeJudgmentShelters';
export const IGNIVAR_JUDGMENT_SAFE_MARKER_NAME = 'ignivarForgeJudgmentSafeMarker';
export const IGNIVAR_JUDGMENT_SAFE_BOUNDARY_NAME = 'ignivarForgeJudgmentSafeBoundary';
export const IGNIVAR_JUDGMENT_SAFE_CHEVRONS_NAME = 'ignivarForgeJudgmentSafeChevrons';
export const IGNIVAR_JUDGMENT_CUES_NAME = 'ignivarForgeJudgmentCues';
export const IGNIVAR_JUDGMENT_DANGER_SCAR_NAME = 'ignivarForgeJudgmentDangerScar';
export const IGNIVAR_JUDGMENT_WALL_CRACKS_NAME = 'ignivarForgeJudgmentWallCracks';

const FIRE_SEGMENTS = 96;
const CUE_BEAM_BASE_RANGE = 18.25;
const WALL_CRACK_SEGMENTS = 8;
// Shell edges are wall centrelines. Move past the one-yard half-thickness and
// a small epsilon so both glow layers sit visibly in front of the inner face.
const WALL_CRACK_INSET = 1.08;
const WALL_CRACK_HALO_HALF_WIDTH = 0.22;
const WALL_CRACK_CORE_HALF_WIDTH = 0.075;

function additiveMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export function ignivarForgeShelterClipGlsl(): string {
  return 'if (dot(vIgnivarLocalPosition.xz - uIgnivarSafeCenter, vIgnivarLocalPosition.xz - uIgnivarSafeCenter) <= uIgnivarSafeRadiusSq) discard;';
}

export function ignivarForgeGroundFireGlsl(): string {
  return `
vec2 ignivarGrid = vIgnivarLocalPosition.xz * 0.34;
vec2 ignivarCell = floor(ignivarGrid);
vec2 ignivarLocal = fract(ignivarGrid) - 0.5;
float ignivarSeed = fract(sin(dot(ignivarCell, vec2(127.1, 311.7))) * 43758.5453);
vec2 ignivarOffset = vec2(
  fract(ignivarSeed * 17.17) - 0.5,
  fract(ignivarSeed * 31.73) - 0.5
) * 0.38;
float ignivarCoal = 1.0 - smoothstep(0.08, 0.31, length(ignivarLocal - ignivarOffset));
float ignivarCracks = ignivarCoal * smoothstep(0.58, 0.82, ignivarSeed);
float ignivarPulse = 0.72 + 0.28 * sin(uTime * 4.6 + vIgnivarLocalPosition.x * 0.17 + vIgnivarLocalPosition.z * 0.13);
vec3 ignivarChar = vec3(0.018, 0.006, 0.003);
vec3 ignivarEmber = vec3(0.62, 0.045, 0.003);
diffuseColor.rgb = mix(ignivarChar, ignivarEmber, ignivarCracks * ignivarPulse);
diffuseColor.a = mix(0.72, 0.94, ignivarCracks);`;
}

function applySafeShelterShaderClip<T extends THREE.Material>(material: T): T {
  const safeCenter = { value: new THREE.Vector2() };
  const safeRadiusSq = { value: IGNIVAR_JUDGMENT_SHELTER_RADIUS ** 2 };
  material.userData.ignivarShelterClip = true;
  material.userData.ignivarGroundFire = true;
  material.userData.ignivarSafeCenter = safeCenter;
  material.userData.ignivarSafeRadiusSq = safeRadiusSq;
  material.userData.ignivarFireTime = sharedUniforms.uTime;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uIgnivarSafeCenter = safeCenter;
    shader.uniforms.uIgnivarSafeRadiusSq = safeRadiusSq;
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIgnivarLocalPosition;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvIgnivarLocalPosition = position;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vIgnivarLocalPosition;\nuniform vec2 uIgnivarSafeCenter;\nuniform float uIgnivarSafeRadiusSq;\nuniform float uTime;',
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>\n${ignivarForgeShelterClipGlsl()}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${ignivarForgeGroundFireGlsl()}`,
      );
  };
  material.customProgramCacheKey = () => 'ignivar-forge-charred-ground-v3';
  return material;
}

function buildSafeMarker(): THREE.Group {
  const marker = new THREE.Group();
  marker.name = IGNIVAR_JUDGMENT_SAFE_MARKER_NAME;

  const innerRune = new THREE.Mesh(
    new THREE.RingGeometry(1.15, 1.42, 40),
    additiveMaterial(0xfff4a8, 0.98),
  );
  innerRune.rotation.x = -Math.PI / 2;
  innerRune.position.y = 0.14;

  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 1.45, 6.5, 20, 1, true),
    additiveMaterial(0x79ffd8, 0.3),
  );
  beacon.position.y = 3.25;

  const crown = new THREE.Mesh(
    new THREE.TorusGeometry(1.45, 0.12, 8, 36),
    additiveMaterial(0xffffff, 0.9),
  );
  crown.rotation.x = Math.PI / 2;
  crown.position.y = 2.8;

  // The centre rune is not enough to answer where the safe footprint ends.
  // Outline the exact gameplay radius and point eight chevrons inward.
  const safeBoundary = new THREE.Mesh(
    new THREE.RingGeometry(
      IGNIVAR_JUDGMENT_SHELTER_RADIUS - 0.42,
      IGNIVAR_JUDGMENT_SHELTER_RADIUS,
      64,
    ),
    additiveMaterial(0x8cffe0, 0.98),
  );
  safeBoundary.name = IGNIVAR_JUDGMENT_SAFE_BOUNDARY_NAME;
  safeBoundary.rotation.x = -Math.PI / 2;
  safeBoundary.position.y = 0.18;
  safeBoundary.renderOrder = 10;

  const chevronPoints: THREE.Vector3[] = [];
  for (let index = 0; index < 8; index++) {
    const angle = (index * Math.PI * 2) / 8;
    const apexRadius = IGNIVAR_JUDGMENT_SHELTER_RADIUS - 1.08;
    const armRadius = IGNIVAR_JUDGMENT_SHELTER_RADIUS - 0.32;
    const angularWidth = 0.11;
    const apex = new THREE.Vector3(
      Math.sin(angle) * apexRadius,
      0.19,
      Math.cos(angle) * apexRadius,
    );
    chevronPoints.push(
      new THREE.Vector3(
        Math.sin(angle - angularWidth) * armRadius,
        0.19,
        Math.cos(angle - angularWidth) * armRadius,
      ),
      apex,
      new THREE.Vector3(
        Math.sin(angle + angularWidth) * armRadius,
        0.19,
        Math.cos(angle + angularWidth) * armRadius,
      ),
      apex.clone(),
    );
  }
  const safeChevrons = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(chevronPoints),
    new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  safeChevrons.name = IGNIVAR_JUDGMENT_SAFE_CHEVRONS_NAME;
  safeChevrons.renderOrder = 11;
  marker.userData.gameplayRadius = IGNIVAR_JUDGMENT_SHELTER_RADIUS;
  marker.add(innerRune, beacon, crown, safeBoundary, safeChevrons);
  return marker;
}

function buildShelter(index: number): THREE.Group {
  const shelter = new THREE.Group();
  shelter.name = `ignivarForgeJudgmentShelter:${index}`;

  const foundation = new THREE.Mesh(
    new THREE.CircleGeometry(IGNIVAR_JUDGMENT_SHELTER_RADIUS, 56),
    new THREE.MeshBasicMaterial({
      color: 0x180a08,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  foundation.name = 'ignivarForgeJudgmentShelterFoundation';
  foundation.rotation.x = -Math.PI / 2;
  foundation.position.y = 0.09;

  const rim = new THREE.Mesh(
    new THREE.RingGeometry(
      IGNIVAR_JUDGMENT_SHELTER_RADIUS - 0.28,
      IGNIVAR_JUDGMENT_SHELTER_RADIUS,
      56,
    ),
    additiveMaterial(0xff4318, 0.96),
  );
  rim.name = 'ignivarForgeJudgmentShelterRim';
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.13;

  const cracks: THREE.Vector3[] = [];
  for (let crack = 0; crack < 9; crack++) {
    const angle = (crack * Math.PI * 2) / 9 + index * 0.21;
    cracks.push(
      new THREE.Vector3(Math.sin(angle) * 0.55, 0.15, Math.cos(angle) * 0.55),
      new THREE.Vector3(
        Math.sin(angle + 0.1) * (IGNIVAR_JUDGMENT_SHELTER_RADIUS - 0.55),
        0.15,
        Math.cos(angle + 0.1) * (IGNIVAR_JUDGMENT_SHELTER_RADIUS - 0.55),
      ),
    );
  }
  const fissures = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(cracks),
    new THREE.LineBasicMaterial({
      color: 0xff4e18,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
    }),
  );
  fissures.name = 'ignivarForgeJudgmentShelterFissures';
  shelter.add(foundation, rim, fissures, buildSafeMarker());
  return shelter;
}

function buildWarning(index: number): THREE.Group {
  const warning = new THREE.Group();
  warning.name = `ignivarForgeJudgmentWarning:${index}`;
  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(IGNIVAR_JUDGMENT_SHELTER_RADIUS, 56),
    additiveMaterial(0xff1d08, 0.3),
  );
  fill.name = 'ignivarForgeJudgmentWarningFill';
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.07;
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(
      IGNIVAR_JUDGMENT_SHELTER_RADIUS - 0.2,
      IGNIVAR_JUDGMENT_SHELTER_RADIUS,
      56,
    ),
    additiveMaterial(0xff3b0a, 0.98),
  );
  rim.name = 'ignivarForgeJudgmentWarningRim';
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.1;
  const dangerScar = new THREE.Group();
  dangerScar.name = IGNIVAR_JUDGMENT_DANGER_SCAR_NAME;
  const scarRing = new THREE.Mesh(
    new THREE.RingGeometry(
      IGNIVAR_JUDGMENT_SHELTER_RADIUS - 0.85,
      IGNIVAR_JUDGMENT_SHELTER_RADIUS - 0.58,
      32,
    ),
    additiveMaterial(0x681405, 0.34),
  );
  scarRing.rotation.x = -Math.PI / 2;
  scarRing.position.y = 0.105;
  const scarLines: THREE.Vector3[] = [];
  for (let scar = 0; scar < 7; scar++) {
    const angle = (scar * Math.PI * 2) / 7 + index * 0.37;
    scarLines.push(
      new THREE.Vector3(Math.sin(angle) * 1.2, 0.115, Math.cos(angle) * 1.2),
      new THREE.Vector3(
        Math.sin(angle + 0.13) * (IGNIVAR_JUDGMENT_SHELTER_RADIUS - 1.05),
        0.115,
        Math.cos(angle + 0.13) * (IGNIVAR_JUDGMENT_SHELTER_RADIUS - 1.05),
      ),
    );
  }
  const fissures = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(scarLines),
    new THREE.LineBasicMaterial({
      color: 0x7a1908,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  dangerScar.add(scarRing, fissures);
  dangerScar.visible = false;
  warning.add(fill, rim, buildSafeMarker(), dangerScar);
  return warning;
}

function forEachCueMaterial(root: THREE.Object3D, visit: (material: THREE.Material) => void): void {
  root.traverse((object) => {
    const renderable = object as THREE.Object3D & {
      material?: THREE.Material | THREE.Material[];
    };
    if (!renderable.material) return;
    const materials = Array.isArray(renderable.material)
      ? renderable.material
      : [renderable.material];
    for (const material of materials) visit(material);
  });
}

function buildCue(index: number): THREE.Group {
  const cue = buildIgnivarFireBeam({
    innerRange: 2.8,
    range: CUE_BEAM_BASE_RANGE,
    startHalfWidth: 0.95,
    endHalfWidth: 2.35,
  });
  cue.name = `ignivarForgeJudgmentCue:${index}`;
  cue.userData.baseRange = CUE_BEAM_BASE_RANGE;
  forEachCueMaterial(cue, (material) => {
    material.depthTest = false;
    material.toneMapped = false;
  });
  cue.traverse((object) => {
    if ((object as THREE.Mesh).material) object.renderOrder = 30;
    const material = (object as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
    if (!material?.color) return;
    if (object.name === IGNIVAR_FIRE_BEAM_FLOOR_GLOW_NAME) {
      material.color.setHex(0xb50000);
      material.opacity = 0.34;
    } else if (object.name === IGNIVAR_FIRE_BEAM_FLOOR_BOUNDARY_NAME) {
      material.color.setHex(0xff1608);
      material.opacity = 1;
    } else if (object.name === IGNIVAR_FIRE_BEAM_OUTER_NAME) {
      material.color.setHex(0xff2208);
      material.opacity = 0.18;
    } else if (object.name === IGNIVAR_FIRE_BEAM_CORE_NAME) {
      material.color.setHex(0xff5a24);
      material.opacity = 0.58;
    }
    material.userData.ignivarBaseOpacity = material.opacity;
  });
  cue.visible = false;
  return cue;
}

function buildWallCracks(): THREE.Group {
  const wallCracks = new THREE.Group();
  wallCracks.name = IGNIVAR_JUDGMENT_WALL_CRACKS_NAME;
  wallCracks.userData.gameplayGeometry = false;
  wallCracks.userData.phase = 'hidden';

  const points: THREE.Vector3[] = [];
  const shell = IGNIVAR_LAYOUT.shellPolygon;
  if (!shell || shell.length !== WALL_CRACK_SEGMENTS) {
    throw new Error('Ignivar wall cracks require the canonical octagonal shell');
  }
  for (let wall = 0; wall < WALL_CRACK_SEGMENTS; wall++) {
    const start = shell[wall];
    const end = shell[(wall + 1) % shell.length];
    const edgeLength = Math.hypot(end.x - start.x, end.z - start.z);
    const tangentX = (end.x - start.x) / edgeLength;
    const tangentZ = (end.z - start.z) / edgeLength;
    // The canonical shell is counter-clockwise, so the left normal points
    // into the room. The inset prevents z-fighting on every cardinal and
    // diagonal wall instead of approximating the octagon with a circle.
    const inwardX = -tangentZ;
    const inwardZ = tangentX;
    const wallX = (start.x + end.x) * 0.5 + inwardX * WALL_CRACK_INSET;
    const wallZ = (start.z + end.z) * 0.5 + inwardZ * WALL_CRACK_INSET;
    for (let crack = 0; crack < 5; crack++) {
      const baseTangent = (crack - 2) * 2.15 + Math.sin(wall * 3.1 + crack) * 0.55;
      let previousTangent = baseTangent;
      let previousY = 0.35 + (crack % 2) * 0.35;
      for (let branch = 1; branch <= 4; branch++) {
        const nextTangent =
          baseTangent + Math.sin(wall * 2.7 + crack * 4.3 + branch * 1.9) * (0.45 + branch * 0.18);
        const nextY = previousY + 1.45 + ((wall + crack + branch) % 2) * 0.28;
        points.push(
          new THREE.Vector3(
            wallX + tangentX * previousTangent,
            previousY,
            wallZ + tangentZ * previousTangent,
          ),
          new THREE.Vector3(wallX + tangentX * nextTangent, nextY, wallZ + tangentZ * nextTangent),
        );
        if (branch === 2 || branch === 3) {
          const forkTangent = nextTangent + (branch === 2 ? -1.25 : 1.15);
          points.push(
            new THREE.Vector3(
              wallX + tangentX * nextTangent,
              nextY,
              wallZ + tangentZ * nextTangent,
            ),
            new THREE.Vector3(
              wallX + tangentX * forkTangent,
              nextY + 0.75,
              wallZ + tangentZ * forkTangent,
            ),
          );
        }
        previousTangent = nextTangent;
        previousY = nextY;
      }
    }
  }
  const crackRibbonGeometry = (halfWidth: number): THREE.BufferGeometry => {
    const vertices: number[] = [];
    for (let index = 0; index < points.length; index += 2) {
      const start = points[index];
      const end = points[index + 1];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const horizontalLength = Math.hypot(dx, dz);
      const dy = end.y - start.y;
      const segmentLength = Math.hypot(horizontalLength, dy);
      if (horizontalLength <= 1e-6 || segmentLength <= 1e-6) continue;
      const tangentX = dx / horizontalLength;
      const tangentZ = dz / horizontalLength;
      const horizontalOffset = (dy / segmentLength) * halfWidth;
      const verticalOffset = (-horizontalLength / segmentLength) * halfWidth;
      const offsetX = tangentX * horizontalOffset;
      const offsetZ = tangentZ * horizontalOffset;
      const startLowY = Math.max(0.35, start.y + verticalOffset);
      const startHighY = Math.max(0.35, start.y - verticalOffset);
      const endLowY = Math.max(0.35, end.y + verticalOffset);
      const endHighY = Math.max(0.35, end.y - verticalOffset);
      vertices.push(
        start.x + offsetX,
        startLowY,
        start.z + offsetZ,
        end.x + offsetX,
        endLowY,
        end.z + offsetZ,
        end.x - offsetX,
        endHighY,
        end.z - offsetZ,
        start.x + offsetX,
        startLowY,
        start.z + offsetZ,
        end.x - offsetX,
        endHighY,
        end.z - offsetZ,
        start.x - offsetX,
        startHighY,
        start.z - offsetZ,
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    return geometry;
  };
  const haloMaterial = new THREE.MeshBasicMaterial({
    color: 0xff1600,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const coreMaterial = new THREE.MeshBasicMaterial({
    color: 0xffb13b,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const halo = new THREE.Mesh(crackRibbonGeometry(WALL_CRACK_HALO_HALF_WIDTH), haloMaterial);
  halo.name = 'ignivarForgeJudgmentWallCrackHalo';
  halo.renderOrder = 11;
  const core = new THREE.Mesh(crackRibbonGeometry(WALL_CRACK_CORE_HALF_WIDTH), coreMaterial);
  core.name = 'ignivarForgeJudgmentWallCrackCore';
  core.renderOrder = 12;

  wallCracks.add(halo, core);
  wallCracks.userData.haloMaterial = haloMaterial;
  wallCracks.userData.coreMaterial = coreMaterial;
  return wallCracks;
}

function syncWallCracks(wallCracks: THREE.Object3D, phase: 'hidden' | 'warning' | 'active'): void {
  wallCracks.visible = phase !== 'hidden';
  wallCracks.userData.phase = phase;
  if (phase === 'hidden') return;
  const active = phase === 'active';
  (wallCracks.userData.haloMaterial as THREE.Material).opacity = active ? 0.68 : 0.42;
  (wallCracks.userData.coreMaterial as THREE.Material).opacity = active ? 1 : 0.92;
}

function buildFire(): THREE.Group {
  const fire = new THREE.Group();
  fire.name = IGNIVAR_JUDGMENT_FIRE_NAME;
  const surfaceGeometry = new THREE.CircleGeometry(IGNIVAR_JUDGMENT_ARENA_RADIUS, FIRE_SEGMENTS);
  surfaceGeometry.rotateX(-Math.PI / 2);
  const surface = new THREE.Mesh(
    surfaceGeometry,
    applySafeShelterShaderClip(
      new THREE.MeshBasicMaterial({
        color: 0x120503,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.NormalBlending,
        side: THREE.DoubleSide,
      }),
    ),
  );
  surface.name = 'ignivarForgeJudgmentFireSurface';
  surface.position.y = 0.05;
  surface.renderOrder = 5;
  const boundary = new THREE.Mesh(
    new THREE.RingGeometry(
      IGNIVAR_JUDGMENT_ARENA_RADIUS - 0.35,
      IGNIVAR_JUDGMENT_ARENA_RADIUS,
      FIRE_SEGMENTS,
    ),
    additiveMaterial(0xffd05a, 0.98),
  );
  boundary.name = 'ignivarForgeJudgmentFireBoundary';
  boundary.rotation.x = -Math.PI / 2;
  boundary.position.y = 0.08;
  boundary.renderOrder = 8;
  fire.add(surface, boundary);
  fire.userData.ignivarFireSurface = surface;
  return fire;
}

function setGroupPosition(group: THREE.Object3D, x: number, z: number): void {
  group.position.set(x, 0, z);
}

function syncShelterIdentity(
  group: THREE.Object3D,
  safe: boolean,
  phase: 'warning' | 'active',
  cueRevealed: boolean,
): void {
  group.userData.safeShelter = safe;
  const foundation = group.getObjectByName('ignivarForgeJudgmentShelterFoundation') as
    | THREE.Mesh
    | undefined;
  const rim = group.getObjectByName('ignivarForgeJudgmentShelterRim') as THREE.Mesh | undefined;
  const warningFill = group.getObjectByName('ignivarForgeJudgmentWarningFill') as
    | THREE.Mesh
    | undefined;
  const warningRim = group.getObjectByName('ignivarForgeJudgmentWarningRim') as
    | THREE.Mesh
    | undefined;
  if (foundation)
    (foundation.material as THREE.MeshBasicMaterial).color.setHex(safe ? 0x123b32 : 0x180a08);
  if (rim) (rim.material as THREE.MeshBasicMaterial).color.setHex(safe ? 0xfff2a3 : 0xff4318);
  if (warningFill) (warningFill.material as THREE.MeshBasicMaterial).color.setHex(0xff1d08);
  if (warningRim) (warningRim.material as THREE.MeshBasicMaterial).color.setHex(0xff3b0a);
  const marker = group.getObjectByName(IGNIVAR_JUDGMENT_SAFE_MARKER_NAME);
  if (marker) marker.visible = safe && (phase === 'active' || cueRevealed);
  const dangerScar = group.getObjectByName(IGNIVAR_JUDGMENT_DANGER_SCAR_NAME);
  if (dangerScar) dangerScar.visible = phase === 'warning' && cueRevealed && !safe;
}

function syncCue(
  cue: THREE.Object3D,
  offset: { x: number; z: number },
  visible: boolean,
  intensity: number,
): void {
  const distance = Math.hypot(offset.x, offset.z);
  cue.rotation.y = Math.atan2(offset.x, offset.z);
  cue.scale.set(1, 1.2 + intensity * 0.48, distance / CUE_BEAM_BASE_RANGE);
  cue.visible = visible;
  forEachCueMaterial(cue, (material) => {
    const baseOpacity = Number(material.userData.ignivarBaseOpacity ?? material.opacity);
    material.opacity = baseOpacity * (0.82 + intensity * 0.18);
  });
}

function syncFireSafeCenter(fire: THREE.Object3D, x: number, z: number): void {
  const surface = fire.userData.ignivarFireSurface as THREE.Mesh;
  const material = surface.material as THREE.Material;
  const center = material.userData.ignivarSafeCenter as { value: THREE.Vector2 };
  center.value.set(x, z);
}

export function buildIgnivarForgeJudgmentVisual(): THREE.Group {
  const root = new THREE.Group();
  root.name = IGNIVAR_JUDGMENT_VISUAL_NAME;
  const warnings = new THREE.Group();
  warnings.name = IGNIVAR_JUDGMENT_WARNINGS_NAME;
  const shelters = new THREE.Group();
  shelters.name = IGNIVAR_JUDGMENT_SHELTERS_NAME;
  const cues = new THREE.Group();
  cues.name = IGNIVAR_JUDGMENT_CUES_NAME;
  for (let index = 0; index < IGNIVAR_JUDGMENT_SHELTER_COUNT; index++) {
    warnings.add(buildWarning(index));
    shelters.add(buildShelter(index));
    cues.add(buildCue(index));
  }
  const fire = buildFire();
  const wallCracks = buildWallCracks();
  root.add(warnings, cues, fire, shelters, wallCracks);
  root.userData.ignivarJudgmentFire = fire;
  root.userData.ignivarSafeOffsetX = 0;
  root.userData.ignivarSafeOffsetZ = 0;
  root.userData.renderCategory = 'ui3d';
  root.visible = false;
  return root;
}

/**
 * Stages the full Forge Judgment arena (warnings, cue beams, shelters, the
 * unique shader-clipped charred-ground fire, and the wall cracks) before the
 * boss is pulled. Its own idle unit: three shelters, three warnings, and three
 * cue fire-beams are the heaviest per-entity build in the encounter, so
 * sharing a unit with the other telegraphs would concatenate the builds.
 */
export function buildIgnivarForgeJudgmentPrewarmVisual(): THREE.Group {
  const root = buildIgnivarForgeJudgmentVisual();
  root.name = 'ignivar-forge-judgment-prewarm';
  // Exercise the active phase the way the live sync reveals it (this also
  // seeds the safe-centre uniform of the shader-clip fire surface), then show
  // the phase-hidden warning half too so every program links.
  syncIgnivarForgeJudgmentVisual(root, 'active', 0, 0, 1, 1, true);
  root.traverse((child) => {
    child.visible = true;
  });
  return root;
}

export function syncIgnivarForgeJudgmentVisual(
  root: THREE.Object3D,
  phase: 'hidden' | 'warning' | 'active',
  rotation: number,
  safeIndex: IgnivarJudgmentShelterIndex,
  inverseEntityScale: number,
  cueIntensity = 0,
  cueRevealed = false,
): void {
  if (phase === 'hidden') {
    root.visible = false;
    root.userData.ignivarJudgmentSync = 'hidden';
    return;
  }
  const fire = root.userData.ignivarJudgmentFire as THREE.Object3D;
  const syncKey = `${phase}:${rotation}:${safeIndex}:${inverseEntityScale}:${cueIntensity}:${cueRevealed}`;
  if (root.userData.ignivarJudgmentSync === syncKey) return;
  root.userData.ignivarJudgmentSync = syncKey;
  root.visible = true;
  root.scale.setScalar(inverseEntityScale);
  root.userData.safeShelterIndex = safeIndex;
  const warnings = root.getObjectByName(IGNIVAR_JUDGMENT_WARNINGS_NAME);
  const shelters = root.getObjectByName(IGNIVAR_JUDGMENT_SHELTERS_NAME);
  const cues = root.getObjectByName(IGNIVAR_JUDGMENT_CUES_NAME);
  const wallCracks = root.getObjectByName(IGNIVAR_JUDGMENT_WALL_CRACKS_NAME);
  const offsets = ignivarForgeShelterOffsets(rotation);
  for (let index = 0; index < offsets.length; index++) {
    const warning = warnings?.children[index];
    const shelter = shelters?.children[index];
    if (warning) {
      setGroupPosition(warning, offsets[index].x, offsets[index].z);
      syncShelterIdentity(warning, index === safeIndex, 'warning', cueRevealed);
    }
    if (shelter) {
      setGroupPosition(shelter, offsets[index].x, offsets[index].z);
      syncShelterIdentity(shelter, index === safeIndex, 'active', cueRevealed);
    }
    const cue = cues?.children[index];
    if (cue)
      syncCue(
        cue,
        offsets[index],
        phase === 'warning' && index !== safeIndex && cueRevealed,
        cueIntensity,
      );
  }
  if (warnings) warnings.visible = phase === 'warning';
  if (cues) cues.visible = phase === 'warning';
  if (fire) {
    fire.visible = phase === 'active';
    const safe = offsets[safeIndex];
    syncFireSafeCenter(fire, safe.x, safe.z);
    root.userData.ignivarSafeOffsetX = safe.x;
    root.userData.ignivarSafeOffsetZ = safe.z;
  }
  if (shelters) shelters.visible = phase === 'active';
  if (wallCracks) syncWallCracks(wallCracks, phase);
}
