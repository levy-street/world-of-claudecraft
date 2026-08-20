import * as THREE from 'three';
import {
  VARKHUL_ANVIL_LANE_HALF_WIDTH,
  VARKHUL_ANVIL_LANE_INNER_RADIUS,
  VARKHUL_ANVIL_LANE_RANGE,
  VARKHUL_BLUEPRINT_HALF_WIDTH,
  VARKHUL_BLUEPRINT_INNER_RADIUS,
  VARKHUL_BLUEPRINT_RANGE,
  VARKHUL_BOSS_ID,
} from '../sim/encounters/varkhul';
import { type VarkhulVisualEntity, varkhulEncounterVisualPlan } from './varkhul_encounter_core';

export const VARKHUL_BLUEPRINT_VISUAL_NAME = 'varkhulLivingBlueprintTelegraph';
export const VARKHUL_ANVIL_VISUAL_NAME = 'varkhulAnvilDecreeTelegraph';
export const VARKHUL_BRAND_VISUAL_NAME = 'varkhulMakersBrandTelegraph';

function warningMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function buildRadialLaneTelegraph(
  name: string,
  range: number,
  halfWidth: number,
  innerRadius: number,
  color: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.userData.renderCategory = 'ui3d';
  group.userData.actionable = true;
  group.userData.range = range;
  group.userData.halfWidth = halfWidth;
  group.userData.innerRadius = innerRadius;
  const laneLength = range - innerRadius;
  const geometry = new THREE.PlaneGeometry(halfWidth * 2, laneLength).rotateX(-Math.PI / 2);
  const fill = warningMaterial(color, 0.3);
  const edge = new THREE.LineBasicMaterial({
    color: 0xffd27a,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  for (let lane = 0; lane < 4; lane++) {
    const arm = new THREE.Group();
    arm.rotation.y = (lane * Math.PI) / 2;
    const mesh = new THREE.Mesh(geometry, fill);
    mesh.name = `${name}Fill`;
    mesh.position.set(0, 0.055, innerRadius + laneLength / 2);
    arm.add(mesh);
    const outlineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-halfWidth, 0.075, innerRadius),
      new THREE.Vector3(-halfWidth, 0.075, range),
      new THREE.Vector3(halfWidth, 0.075, range),
      new THREE.Vector3(halfWidth, 0.075, innerRadius),
    ]);
    const outline = new THREE.LineLoop(outlineGeometry, edge);
    outline.name = `${name}Outline`;
    arm.add(outline);
    group.add(arm);
  }
  group.userData.fillMaterial = fill;
  group.userData.edgeMaterial = edge;
  group.visible = false;
  return group;
}

export function buildVarkhulBlueprintTelegraph(): THREE.Group {
  return buildRadialLaneTelegraph(
    VARKHUL_BLUEPRINT_VISUAL_NAME,
    VARKHUL_BLUEPRINT_RANGE,
    VARKHUL_BLUEPRINT_HALF_WIDTH,
    VARKHUL_BLUEPRINT_INNER_RADIUS,
    0xff3d18,
  );
}

export function buildVarkhulAnvilTelegraph(): THREE.Group {
  return buildRadialLaneTelegraph(
    VARKHUL_ANVIL_VISUAL_NAME,
    VARKHUL_ANVIL_LANE_RANGE,
    VARKHUL_ANVIL_LANE_HALF_WIDTH,
    VARKHUL_ANVIL_LANE_INNER_RADIUS,
    0xff671c,
  );
}

export function buildVarkhulMakersBrandTelegraph(): THREE.Group {
  const group = new THREE.Group();
  group.name = VARKHUL_BRAND_VISUAL_NAME;
  group.userData.renderCategory = 'ui3d';
  group.userData.actionable = true;
  const colors = [0xffb02e, 0xff6a1c, 0xff2714];
  for (let stack = 0; stack < colors.length; stack++) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.05 + stack * 0.27, 1.15 + stack * 0.27, 32).rotateX(-Math.PI / 2),
      warningMaterial(colors[stack], 0.82),
    );
    ring.name = `varkhulMakersBrandStack${stack + 1}`;
    ring.position.y = 0.08 + stack * 0.012;
    ring.visible = false;
    group.add(ring);
  }
  group.visible = false;
  return group;
}

function syncLaneTelegraph(
  visual: THREE.Object3D,
  visible: boolean,
  progress: number,
  worldRotation: number,
  ownerWorldRotation: number,
  inverseScale: number,
): void {
  visual.visible = visible;
  if (!visible) return;
  visual.scale.setScalar(inverseScale);
  visual.rotation.y = worldRotation - ownerWorldRotation;
  const pulse = 0.24 + progress * 0.18;
  const fill = visual.userData.fillMaterial as THREE.MeshBasicMaterial;
  const edge = visual.userData.edgeMaterial as THREE.LineBasicMaterial;
  fill.opacity = pulse;
  edge.opacity = 0.72 + progress * 0.26;
}

function syncBrandTelegraph(visual: THREE.Object3D, stacks: number, inverseScale: number): void {
  visual.visible = stacks > 0;
  visual.scale.setScalar(inverseScale);
  for (let stack = 1; stack <= 3; stack++) {
    const ring = visual.getObjectByName(`varkhulMakersBrandStack${stack}`);
    if (ring) ring.visible = stack <= stacks;
  }
}

export function syncVarkhulEncounterVisuals(group: THREE.Group, entity: VarkhulVisualEntity): void {
  const plan = varkhulEncounterVisualPlan(entity);
  if (entity.templateId === VARKHUL_BOSS_ID) {
    let anvil = group.getObjectByName(VARKHUL_ANVIL_VISUAL_NAME);
    if (!anvil && plan.anvilVisible) {
      anvil = buildVarkhulAnvilTelegraph();
      group.add(anvil);
    }
    if (anvil) {
      syncLaneTelegraph(
        anvil,
        plan.anvilVisible,
        plan.anvilProgress,
        plan.anvilWorldRotation,
        group.rotation.y,
        plan.inverseEntityScale,
      );
    }
  }
  if (entity.kind !== 'player') return;

  let blueprint = group.getObjectByName(VARKHUL_BLUEPRINT_VISUAL_NAME);
  if (!blueprint && plan.blueprintVisible) {
    blueprint = buildVarkhulBlueprintTelegraph();
    group.add(blueprint);
  }
  if (blueprint) {
    syncLaneTelegraph(
      blueprint,
      plan.blueprintVisible,
      plan.blueprintProgress,
      plan.blueprintWorldRotation,
      group.rotation.y,
      plan.inverseEntityScale,
    );
  }

  let brand = group.getObjectByName(VARKHUL_BRAND_VISUAL_NAME);
  if (!brand && plan.makersBrandStacks > 0) {
    brand = buildVarkhulMakersBrandTelegraph();
    group.add(brand);
  }
  if (brand) syncBrandTelegraph(brand, plan.makersBrandStacks, plan.inverseEntityScale);
}

export function hasVisibleVarkhulEncounterTelegraph(group: THREE.Group): boolean {
  return (
    group.getObjectByName(VARKHUL_BLUEPRINT_VISUAL_NAME)?.visible === true ||
    group.getObjectByName(VARKHUL_ANVIL_VISUAL_NAME)?.visible === true
  );
}

export function disposeVarkhulEncounterVisuals(group: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  for (const name of [
    VARKHUL_BLUEPRINT_VISUAL_NAME,
    VARKHUL_ANVIL_VISUAL_NAME,
    VARKHUL_BRAND_VISUAL_NAME,
  ]) {
    const visual = group.getObjectByName(name);
    if (!visual) continue;
    visual.traverse((child) => {
      const renderable = child as THREE.Mesh | THREE.Line;
      if ('geometry' in renderable && renderable.geometry) geometries.add(renderable.geometry);
      if ('material' in renderable && renderable.material) {
        for (const material of Array.isArray(renderable.material)
          ? renderable.material
          : [renderable.material]) {
          materials.add(material);
        }
      }
    });
    visual.removeFromParent();
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}
