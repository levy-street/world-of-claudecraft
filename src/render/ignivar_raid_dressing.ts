import * as THREE from 'three';
import type { DungeonLayout } from '../sim/dungeon_layout';
import { VARKHUL_FORGE_LOCAL_POS } from '../sim/encounters/varkhul';
import { surfaceMat } from './gfx';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';
import { buildVarkhulGrandForge, prepareVarkhulGrandForgeAssets } from './varkhul_grand_forge';

export const IGNIVAR_APPROACH_DRESSING_NAME = 'ignivarForgeApproachDressing';
export const VARKHUL_CRUCIBLE_DRESSING_NAME = 'varkhulInnerCrucibleDressing';
export const IGNIVAR_APPROACH_CLEAR_HALF_WIDTH = 7.5;

let railGeometry: THREE.BoxGeometry | null = null;
let stationGeometry: THREE.CylinderGeometry | null = null;
let trenchGeometry: THREE.BoxGeometry | null = null;

function sharedMaterial(options: Parameters<typeof surfaceMat>[0]): THREE.Material {
  return markSharedMaterial(surfaceMat(options));
}

export function ensureIgnivarRaidDressingAssets(interior: string): Promise<void> {
  return interior === 'ignivar_depths'
    ? prepareVarkhulGrandForgeAssets().catch(() => undefined)
    : Promise.resolve();
}

function markDressing(group: THREE.Group, name: string): THREE.Group {
  group.name = name;
  group.userData.renderCategory = 'dungeon';
  group.userData.collision = 'none';
  group.userData.actionable = false;
  return group;
}

function buildForgeApproachDressing(layout: DungeonLayout, lowGfx: boolean): THREE.Group {
  const group = markDressing(new THREE.Group(), IGNIVAR_APPROACH_DRESSING_NAME);
  const halfWidth = layout.floorHalfX ?? layout.wallX ?? 18;
  const sideX = Math.max(IGNIVAR_APPROACH_CLEAR_HALF_WIDTH + 2, Math.min(halfWidth - 3.5, 13));
  const length = Math.max(12, layout.zMax - layout.zMin - 10);
  const centerZ = (layout.zMin + layout.zMax) / 2;

  railGeometry ??= markSharedGeometry(new THREE.BoxGeometry(0.32, 0.08, 1));
  const railMaterial = sharedMaterial({
    color: 0x493a34,
    metalness: 0.72,
    roughness: 0.48,
  });
  const rails = new THREE.InstancedMesh(railGeometry, railMaterial, 4);
  rails.name = 'ignivarApproachAssemblyRails';
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < 4; index++) {
    const x = (index < 2 ? -1 : 1) * sideX + (index % 2 === 0 ? -0.7 : 0.7);
    matrix.makeScale(1, 1, length);
    matrix.setPosition(x, 0.08, centerZ);
    rails.setMatrixAt(index, matrix);
  }
  rails.instanceMatrix.needsUpdate = true;
  group.add(rails);

  stationGeometry ??= markSharedGeometry(new THREE.CylinderGeometry(1.45, 1.7, 1.1, 12));
  const stationMaterial = sharedMaterial({
    color: 0x241a19,
    emissive: 0x8a2d12,
    emissiveIntensity: lowGfx ? 0.55 : 0.95,
    metalness: 0.55,
    roughness: 0.58,
  });
  const stationCount = lowGfx ? 4 : 6;
  const stations = new THREE.InstancedMesh(stationGeometry, stationMaterial, stationCount);
  stations.name = 'ignivarApproachTemperingStations';
  for (let index = 0; index < stationCount; index++) {
    const lane = index % 2 === 0 ? -1 : 1;
    const row = Math.floor(index / 2);
    const rowCount = Math.ceil(stationCount / 2);
    const z = layout.zMin + 10 + (row / Math.max(1, rowCount - 1)) * (length - 10);
    matrix.makeTranslation(lane * sideX, 0.55, z);
    stations.setMatrixAt(index, matrix);
  }
  stations.instanceMatrix.needsUpdate = true;
  group.add(stations);
  group.userData.clearHalfWidth = IGNIVAR_APPROACH_CLEAR_HALF_WIDTH;
  return group;
}

function buildInnerCrucibleDressing(
  layout: DungeonLayout,
  lowGfx: boolean,
  forgeBuilder: (x: number, z: number) => THREE.Group = buildVarkhulGrandForge,
): THREE.Group {
  const group = markDressing(new THREE.Group(), VARKHUL_CRUCIBLE_DRESSING_NAME);
  const halfWidth = layout.floorHalfX ?? layout.wallX ?? 40;
  const forgeZ = VARKHUL_FORGE_LOCAL_POS.z;
  const forge = forgeBuilder(VARKHUL_FORGE_LOCAL_POS.x, forgeZ);
  group.add(forge);

  trenchGeometry ??= markSharedGeometry(new THREE.BoxGeometry(1, 0.045, 1));
  const trenchMaterial = sharedMaterial({
    color: 0x55180d,
    emissive: 0xff4316,
    emissiveIntensity: lowGfx ? 0.72 : 1.25,
    metalness: 0.08,
    roughness: 0.66,
  });
  const trenches = new THREE.InstancedMesh(trenchGeometry, trenchMaterial, 2);
  trenches.name = 'varkhulMoltenSideTrenches';
  const matrix = new THREE.Matrix4();
  const trenchX = Math.max(18, halfWidth - 5);
  const trenchLength = Math.max(18, layout.zMax - layout.zMin - 14);
  for (let index = 0; index < 2; index++) {
    matrix.makeScale(1.15, 1, trenchLength);
    matrix.setPosition(index === 0 ? -trenchX : trenchX, 0.07, 0);
    trenches.setMatrixAt(index, matrix);
  }
  trenches.instanceMatrix.needsUpdate = true;
  group.add(trenches);
  group.userData.forgeZ = forgeZ;
  group.userData.fightingFloorClearRadius = Math.max(14, trenchX - 3);
  return group;
}

export function buildIgnivarRaidDressing(
  interior: string,
  layout: DungeonLayout,
  lowGfx: boolean,
): THREE.Group | null {
  if (interior === 'ignivar_approach') return buildForgeApproachDressing(layout, lowGfx);
  if (interior === 'ignivar_depths') return buildInnerCrucibleDressing(layout, lowGfx);
  return null;
}

export const ignivarRaidDressingInternalsForTest = {
  buildForgeApproachDressing,
  buildInnerCrucibleDressing,
};
