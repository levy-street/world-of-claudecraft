// Procedural landmark for Ignivar's four water conduits. All three state
// templates stay in one cloned view so authoritative template swaps only
// change visibility. The cleanse footprint is actionable and tier-independent.

import * as THREE from 'three';
import { IGNIVAR_WATER_CLEANSE_RADIUS } from '../sim/encounters/ignivar';
import { type IgnivarConduitState, ignivarConduitStateForTemplate } from '../sim/ignivar_arena';
import { GFX, surfaceMat } from './gfx';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

const HEIGHT = 7;
const CLEANSE_EDGE_WIDTH = 0.16;

export const IGNIVAR_CONDUIT_CLEANSE_FOOTPRINT_NAME = 'ignivarWaterCleanseFootprint';
export const IGNIVAR_CONDUIT_CLEANSE_BOUNDARY_NAME = 'ignivarWaterCleanseBoundary';
export const IGNIVAR_CONDUIT_ACTIVATION_RUNE_NAME = 'ignivarWaterActivationRune';
export const IGNIVAR_CONDUIT_READY_AIM_RING_NAME = 'ignivarWaterReadyAimRing';
export const IGNIVAR_CONDUIT_ACTIVE_BEACON_NAME = 'ignivarWaterActiveBeacon';

const templates = new Map<IgnivarConduitState, THREE.Group>();
let stableTemplate: THREE.Group | null = null;

function sharedMaterial(options: Parameters<typeof surfaceMat>[0]): THREE.Material {
  return markSharedMaterial(surfaceMat(options));
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, y: number): THREE.Mesh {
  const part = new THREE.Mesh(markSharedGeometry(geometry), material);
  part.position.y = y;
  part.castShadow = true;
  part.receiveShadow = true;
  return part;
}

function waterGlowMaterial(
  color: number,
  opacity: number,
  blending: THREE.Blending = THREE.AdditiveBlending,
): THREE.MeshBasicMaterial {
  return markSharedMaterial(
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
}

function horizontalMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  y: number,
): THREE.Mesh {
  const part = mesh(geometry, material, y);
  part.rotation.x = -Math.PI / 2;
  part.castShadow = false;
  part.receiveShadow = false;
  return part;
}

function addReadyVisual(group: THREE.Group): void {
  const readyMaterial = waterGlowMaterial(0x5bdcf3, 0.78);
  const coreMaterial = waterGlowMaterial(0x9af3ff, 0.92, THREE.NormalBlending);
  const marker = new THREE.Group();
  marker.name = 'ignivarWaterReadyMarker';
  marker.userData.ignivarConduitLayer = 'readyBeacon';

  const core = mesh(new THREE.SphereGeometry(0.3, 12, 8), coreMaterial, 1.58);
  core.name = 'ignivarWaterReadyCore';
  core.castShadow = false;
  core.receiveShadow = false;
  core.renderOrder = 3;
  marker.add(core);

  const halo = horizontalMesh(new THREE.TorusGeometry(0.62, 0.065, 6, 24), readyMaterial, 1.58);
  halo.name = 'ignivarWaterReadyHalo';
  halo.renderOrder = 2;
  marker.add(halo);

  const lowerHalo = horizontalMesh(
    new THREE.TorusGeometry(0.46, 0.045, 6, 20),
    readyMaterial,
    1.18,
  );
  lowerHalo.name = 'ignivarWaterReadyLowerHalo';
  lowerHalo.rotation.z = Math.PI / 8;
  marker.add(lowerHalo);

  // Float above the stone lip so the ready conduit reads as a target from the
  // player camera instead of being hidden inside its own base.
  const aimRing = horizontalMesh(new THREE.RingGeometry(1.48, 1.72, 32), readyMaterial, 0.94);
  aimRing.name = IGNIVAR_CONDUIT_READY_AIM_RING_NAME;
  aimRing.renderOrder = 2;
  marker.add(aimRing);
  group.add(marker);
}

function addCooldownVisual(group: THREE.Group, sealMaterial: THREE.Material): void {
  const capMaterial = sharedMaterial({
    color: 0x202a2d,
    roughness: 0.98,
    metalness: 0.02,
    flatShading: !GFX.standardMaterials,
  });
  const cap = mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.13, 16), capMaterial, 0.92);
  cap.name = 'ignivarWaterCooldownCap';
  group.add(cap);

  const cooldownSeal = new THREE.Group();
  cooldownSeal.name = 'ignivarWaterCooldownSeal';
  cooldownSeal.userData.ignivarConduitLayer = 'closedSeal';
  const firstBar = mesh(new THREE.BoxGeometry(1.95, 0.24, 0.38), sealMaterial, 1.04);
  firstBar.rotation.y = Math.PI / 4;
  const secondBar = firstBar.clone();
  secondBar.rotation.y = -Math.PI / 4;
  cooldownSeal.add(firstBar, secondBar);
  group.add(cooldownSeal);
}

function buildActivationRune(): THREE.Group {
  const rune = new THREE.Group();
  rune.name = IGNIVAR_CONDUIT_ACTIVATION_RUNE_NAME;
  rune.userData.ignivarConduitLayer = 'activationRune';
  const runeMaterial = waterGlowMaterial(0x45dcff, 0.9);

  const outer = horizontalMesh(new THREE.RingGeometry(2.5, 2.78, 8), runeMaterial, 0.055);
  outer.name = 'ignivarWaterActivationRuneGlow';
  outer.renderOrder = 4;
  rune.add(outer);

  const inner = horizontalMesh(new THREE.RingGeometry(1.03, 1.17, 8), runeMaterial, 0.915);
  inner.name = 'ignivarWaterActivationRuneInner';
  inner.rotation.z = Math.PI / 8;
  inner.renderOrder = 4;
  rune.add(inner);

  const spokeGeometry = new THREE.BoxGeometry(0.085, 0.025, 1.35);
  for (let index = 0; index < 4; index++) {
    const spoke = mesh(spokeGeometry, runeMaterial, 0.925);
    spoke.name = `ignivarWaterActivationRuneSpoke:${index}`;
    spoke.rotation.y = (index * Math.PI) / 4;
    spoke.castShadow = false;
    spoke.receiveShadow = false;
    spoke.renderOrder = 4;
    rune.add(spoke);
  }
  return rune;
}

function buildSteamEnergy(material: THREE.Material): THREE.Group {
  const steam = new THREE.Group();
  steam.name = 'ignivarWaterSteamEnergy';
  steam.userData.ignivarConduitLayer = 'steamEnergy';
  const halos = [
    { name: 'ignivarWaterSteamHaloLow', radius: 0.78, y: 1.42, tilt: -0.16 },
    { name: 'ignivarWaterSteamHaloMid', radius: 0.94, y: 2.45, tilt: 0.2 },
    { name: 'ignivarWaterSteamHaloHigh', radius: 1.1, y: 3.38, tilt: -0.12 },
  ];
  for (const [index, haloSpec] of halos.entries()) {
    const halo = horizontalMesh(
      new THREE.TorusGeometry(haloSpec.radius, 0.075, 6, 28),
      material,
      haloSpec.y,
    );
    halo.name = haloSpec.name;
    halo.rotation.y = haloSpec.tilt;
    halo.rotation.z = index * 0.42;
    halo.renderOrder = 5;
    steam.add(halo);
  }
  return steam;
}

function buildActiveBeacon(): THREE.Group {
  const beacon = new THREE.Group();
  beacon.name = IGNIVAR_CONDUIT_ACTIVE_BEACON_NAME;
  beacon.userData.ignivarConduitLayer = 'activeBeacon';
  const outerMaterial = waterGlowMaterial(0x3fdcff, 0.34);
  const coreMaterial = waterGlowMaterial(0xd9fcff, 0.92);
  const crownMaterial = waterGlowMaterial(0x8ff4ff, 0.9);

  const outer = mesh(new THREE.CylinderGeometry(0.72, 0.5, 6.2, 16, 1, true), outerMaterial, 3.55);
  outer.name = 'ignivarWaterActiveBeaconOuter';
  outer.castShadow = false;
  outer.receiveShadow = false;
  outer.renderOrder = 6;

  const core = mesh(new THREE.CylinderGeometry(0.16, 0.25, 6.5, 12, 1, true), coreMaterial, 3.65);
  core.name = 'ignivarWaterActiveBeaconCore';
  core.castShadow = false;
  core.receiveShadow = false;
  core.renderOrder = 7;

  const crown = horizontalMesh(new THREE.TorusGeometry(1.18, 0.1, 8, 32), crownMaterial, 6.65);
  crown.name = 'ignivarWaterActiveBeaconCrown';
  crown.renderOrder = 7;
  beacon.add(outer, core, crown);
  return beacon;
}

function addActiveVisual(group: THREE.Group): void {
  const footprintMaterial = waterGlowMaterial(0x269dcc, 0.14, THREE.NormalBlending);
  const boundaryMaterial = waterGlowMaterial(0x55e6ff, 0.82);
  const columnMaterial = waterGlowMaterial(0x4bdcf6, 0.48, THREE.NormalBlending);
  const coreMaterial = waterGlowMaterial(0xb8f8ff, 0.78);
  const steamMaterial = waterGlowMaterial(0xa8f5ff, 0.25, THREE.NormalBlending);

  const cleanseZone = new THREE.Group();
  cleanseZone.name = 'ignivarWaterCleanseZone';
  cleanseZone.userData.ignivarConduitLayer = 'cleanseFootprint';
  const footprint = horizontalMesh(
    new THREE.CircleGeometry(IGNIVAR_WATER_CLEANSE_RADIUS, 48),
    footprintMaterial,
    0.025,
  );
  footprint.name = IGNIVAR_CONDUIT_CLEANSE_FOOTPRINT_NAME;
  footprint.renderOrder = 1;
  cleanseZone.add(footprint);

  const boundary = horizontalMesh(
    new THREE.RingGeometry(
      IGNIVAR_WATER_CLEANSE_RADIUS - CLEANSE_EDGE_WIDTH,
      IGNIVAR_WATER_CLEANSE_RADIUS,
      48,
    ),
    boundaryMaterial,
    0.04,
  );
  boundary.name = IGNIVAR_CONDUIT_CLEANSE_BOUNDARY_NAME;
  boundary.renderOrder = 3;
  cleanseZone.add(boundary, buildActivationRune());
  group.add(cleanseZone);

  const jet = new THREE.Group();
  jet.name = 'ignivarWaterJet';
  jet.userData.ignivarConduitLayer = 'waterColumn';
  const outer = mesh(
    new THREE.CylinderGeometry(0.9, 0.58, 2.75, 16, 1, true),
    columnMaterial,
    2.15,
  );
  outer.name = 'ignivarWaterColumnOuter';
  outer.castShadow = false;
  outer.receiveShadow = false;
  outer.renderOrder = 4;
  jet.add(outer);

  const core = mesh(new THREE.CylinderGeometry(0.34, 0.46, 2.95, 14, 1, true), coreMaterial, 2.15);
  core.name = 'ignivarWaterColumnCore';
  core.castShadow = false;
  core.receiveShadow = false;
  core.renderOrder = 5;
  jet.add(core, buildSteamEnergy(steamMaterial));
  group.add(jet, buildActiveBeacon());
}

function buildTemplate(state: IgnivarConduitState): THREE.Group {
  const group = new THREE.Group();
  group.name = `ignivarWaterConduit:${state}`;
  group.userData.ignivarConduitState = state;

  // The physical conduit body is the placed water_pump dressing prop. This
  // view draws only the readable water-state layers (the cleanse pool, the
  // ready aim marker, the active jet, the cooldown seal), so they render on
  // the pump the player already sees rather than a second stone plinth.
  const rim = sharedMaterial({
    color: 0x62564e,
    roughness: 0.82,
    metalness: 0.08,
    flatShading: !GFX.standardMaterials,
  });

  if (state === 'ready') addReadyVisual(group);
  if (state === 'cooldown') addCooldownVisual(group, rim);
  if (state === 'active') addActiveVisual(group);

  return group;
}

export function isIgnivarWaterConduitTemplate(templateId: string): boolean {
  return ignivarConduitStateForTemplate(templateId) !== null;
}

export function isStableIgnivarWaterConduitTransition(
  previousTemplateId: string,
  nextTemplateId: string,
): boolean {
  return (
    isIgnivarWaterConduitTemplate(previousTemplateId) &&
    isIgnivarWaterConduitTemplate(nextTemplateId)
  );
}

/** Keep encounter scenery visible even though it deliberately has no loot interaction. */
export function syncIgnivarWaterConduitVisibility(
  group: THREE.Object3D,
  templateId: string,
  compilePending: boolean,
  withinRange = true,
): boolean {
  const state = ignivarConduitStateForTemplate(templateId);
  for (const candidate of ['ready', 'active', 'cooldown'] as const) {
    const child = group.getObjectByName(`ignivarWaterConduit:${candidate}`);
    if (child) child.visible = candidate === state;
  }
  const visible = isIgnivarWaterConduitTemplate(templateId) && !compilePending && withinRange;
  group.visible = visible;
  return visible;
}

export function buildIgnivarWaterConduit(templateId: string): {
  group: THREE.Group;
  height: number;
} {
  if (!stableTemplate) {
    stableTemplate = new THREE.Group();
    stableTemplate.name = 'ignivarWaterConduit';
    for (const state of ['ready', 'active', 'cooldown'] as const) {
      let template = templates.get(state);
      if (!template) {
        template = buildTemplate(state);
        templates.set(state, template);
      }
      stableTemplate.add(template);
    }
  }
  const group = stableTemplate.clone(true);
  syncIgnivarWaterConduitVisibility(group, templateId, false);
  return { group, height: HEIGHT };
}
