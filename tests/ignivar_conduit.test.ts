import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildIgnivarWaterConduit,
  IGNIVAR_CONDUIT_ACTIVATION_RUNE_NAME,
  IGNIVAR_CONDUIT_ACTIVE_BEACON_NAME,
  IGNIVAR_CONDUIT_CLEANSE_BOUNDARY_NAME,
  IGNIVAR_CONDUIT_CLEANSE_FOOTPRINT_NAME,
  IGNIVAR_CONDUIT_READY_AIM_RING_NAME,
  isIgnivarWaterConduitTemplate,
  isStableIgnivarWaterConduitTransition,
  syncIgnivarWaterConduitVisibility,
} from '../src/render/ignivar_conduit';
import { buildIgnivarFrontalTelegraph } from '../src/render/ignivar_frontal_telegraph';
import { IGNIVAR_WATER_CLEANSE_RADIUS } from '../src/sim/encounters/ignivar';
import { IGNIVAR_WATER_CONDUIT_TEMPLATES } from '../src/sim/ignivar_arena';

function meshNamed(root: THREE.Object3D, name: string): THREE.Mesh {
  const object = root.getObjectByName(name);
  if (!(object instanceof THREE.Mesh)) throw new Error(`Missing conduit mesh: ${name}`);
  return object;
}

function materialNamed(root: THREE.Object3D, name: string): THREE.MeshBasicMaterial {
  const material = meshNamed(root, name).material;
  if (Array.isArray(material)) throw new Error(`Conduit mesh has material array: ${name}`);
  return material as THREE.MeshBasicMaterial;
}

function maximumPlanarRadius(geometry: THREE.BufferGeometry): number {
  const positions = geometry.getAttribute('position');
  let radius = 0;
  for (let index = 0; index < positions.count; index++) {
    radius = Math.max(radius, Math.hypot(positions.getX(index), positions.getY(index)));
  }
  return radius;
}

function minimumPlanarRadius(geometry: THREE.BufferGeometry): number {
  const positions = geometry.getAttribute('position');
  let radius = Number.POSITIVE_INFINITY;
  for (let index = 0; index < positions.count; index++) {
    radius = Math.min(radius, Math.hypot(positions.getX(index), positions.getY(index)));
  }
  return radius;
}

describe('Ignivar water conduit renderer', () => {
  it('recognizes only the stable encounter conduit templates', () => {
    expect(IGNIVAR_WATER_CONDUIT_TEMPLATES).toEqual({
      ready: 'ignivar_water_conduit_ready',
      active: 'ignivar_water_conduit_active',
      cooldown: 'ignivar_water_conduit_cooldown',
    });
    expect(isIgnivarWaterConduitTemplate(IGNIVAR_WATER_CONDUIT_TEMPLATES.ready)).toBe(true);
    expect(isIgnivarWaterConduitTemplate(IGNIVAR_WATER_CONDUIT_TEMPLATES.active)).toBe(true);
    expect(isIgnivarWaterConduitTemplate(IGNIVAR_WATER_CONDUIT_TEMPLATES.cooldown)).toBe(true);
    expect(isIgnivarWaterConduitTemplate('dungeon_exit')).toBe(false);
    expect(isIgnivarWaterConduitTemplate('ignivar_water_conduit')).toBe(false);
    expect(isIgnivarWaterConduitTemplate('ignivar_water_conduit_broken')).toBe(false);
    expect(
      isStableIgnivarWaterConduitTransition(
        IGNIVAR_WATER_CONDUIT_TEMPLATES.ready,
        IGNIVAR_WATER_CONDUIT_TEMPLATES.active,
      ),
    ).toBe(true);
    expect(
      isStableIgnivarWaterConduitTransition(
        IGNIVAR_WATER_CONDUIT_TEMPLATES.active,
        IGNIVAR_WATER_CONDUIT_TEMPLATES.cooldown,
      ),
    ).toBe(true);
    expect(
      isStableIgnivarWaterConduitTransition(IGNIVAR_WATER_CONDUIT_TEMPLATES.ready, 'dungeon_exit'),
    ).toBe(false);
  });

  it('keeps every non-lootable encounter state visible through renderer sync', () => {
    for (const templateId of Object.values(IGNIVAR_WATER_CONDUIT_TEMPLATES)) {
      const group = buildIgnivarWaterConduit(templateId).group;
      group.visible = false;
      expect(syncIgnivarWaterConduitVisibility(group, templateId, false)).toBe(true);
      expect(group.visible).toBe(true);
      expect(syncIgnivarWaterConduitVisibility(group, templateId, true)).toBe(false);
      expect(group.visible).toBe(false);
      expect(syncIgnivarWaterConduitVisibility(group, templateId, false, false)).toBe(false);
      expect(group.visible).toBe(false);
    }
  });

  it('gives ready, active, and cooldown states distinct readable semantic layers', () => {
    const ready = buildIgnivarWaterConduit(IGNIVAR_WATER_CONDUIT_TEMPLATES.ready);
    const active = buildIgnivarWaterConduit(IGNIVAR_WATER_CONDUIT_TEMPLATES.active);
    const cooldown = buildIgnivarWaterConduit(IGNIVAR_WATER_CONDUIT_TEMPLATES.cooldown);

    expect(ready.height).toBe(7);
    expect(ready.group.name).toBe('ignivarWaterConduit');
    expect(active.group.name).toBe('ignivarWaterConduit');
    expect(cooldown.group.name).toBe('ignivarWaterConduit');
    expect(ready.group.getObjectByName('ignivarWaterConduit:ready')?.visible).toBe(true);
    expect(ready.group.getObjectByName('ignivarWaterConduit:active')?.visible).toBe(false);
    expect(active.group.getObjectByName('ignivarWaterJet')).toBeDefined();
    expect(active.group.getObjectByName('ignivarWaterSteamEnergy')).toBeDefined();
    expect(active.group.getObjectByName(IGNIVAR_CONDUIT_ACTIVE_BEACON_NAME)).toBeDefined();
    expect(active.group.getObjectByName(IGNIVAR_CONDUIT_CLEANSE_FOOTPRINT_NAME)).toBeDefined();
    expect(active.group.getObjectByName(IGNIVAR_CONDUIT_CLEANSE_BOUNDARY_NAME)).toBeDefined();
    expect(active.group.getObjectByName(IGNIVAR_CONDUIT_ACTIVATION_RUNE_NAME)).toBeDefined();
    expect(active.group.getObjectByName('ignivarWaterConduit:active')?.visible).toBe(true);
    expect(cooldown.group.getObjectByName('ignivarWaterConduit:active')?.visible).toBe(false);
    expect(cooldown.group.getObjectByName('ignivarWaterConduit:cooldown')?.visible).toBe(true);
    const readyState = ready.group.getObjectByName('ignivarWaterConduit:ready');
    const activeState = active.group.getObjectByName('ignivarWaterConduit:active');
    const cooldownState = cooldown.group.getObjectByName('ignivarWaterConduit:cooldown');
    expect(readyState?.getObjectByName('ignivarWaterReadyMarker')).toBeDefined();
    expect(readyState?.getObjectByName('ignivarWaterReadyCore')).toBeDefined();
    expect(readyState?.getObjectByName(IGNIVAR_CONDUIT_READY_AIM_RING_NAME)).toBeDefined();
    const aimRing = meshNamed(readyState as THREE.Object3D, IGNIVAR_CONDUIT_READY_AIM_RING_NAME);
    expect(aimRing.visible).toBe(true);
    expect(aimRing.position.y).toBeGreaterThan(0.9);
    expect(aimRing.rotation.x).toBeCloseTo(-Math.PI / 2, 8);
    expect(minimumPlanarRadius(aimRing.geometry)).toBeCloseTo(1.48, 5);
    expect(maximumPlanarRadius(aimRing.geometry)).toBeCloseTo(1.72, 5);
    expect((aimRing.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThanOrEqual(0.7);
    expect(readyState?.getObjectByName(IGNIVAR_CONDUIT_ACTIVATION_RUNE_NAME)).toBeUndefined();
    expect(activeState?.getObjectByName('ignivarWaterColumnCore')).toBeDefined();
    expect(activeState?.getObjectByName('ignivarWaterReadyMarker')).toBeUndefined();
    expect(activeState?.getObjectByName('ignivarWaterCooldownSeal')).toBeUndefined();
    expect(readyState?.getObjectByName('ignivarWaterCooldownSeal')).toBeUndefined();
    expect(cooldownState?.getObjectByName('ignivarWaterCooldownSeal')).toBeDefined();
    expect(cooldownState?.getObjectByName('ignivarWaterCooldownCap')).toBeDefined();
    expect(cooldownState?.getObjectByName('ignivarWaterReadyMarker')).toBeUndefined();
    expect(cooldownState?.getObjectByName('ignivarWaterJet')).toBeUndefined();
    const cooldownNames: string[] = [];
    cooldownState?.traverse((object) => cooldownNames.push(object.name));
    expect(cooldownNames.some((name) => /countdown|remaining/i.test(name))).toBe(false);
    expect(cooldownState?.userData.remainingSeconds).toBeUndefined();
  });

  it('keeps an activated well readable above frontal effects with a sustained beacon', () => {
    const active = buildIgnivarWaterConduit(IGNIVAR_WATER_CONDUIT_TEMPLATES.active).group;
    const beacon = active.getObjectByName(IGNIVAR_CONDUIT_ACTIVE_BEACON_NAME);
    const outer = meshNamed(active, 'ignivarWaterActiveBeaconOuter');
    const core = meshNamed(active, 'ignivarWaterActiveBeaconCore');
    const crown = meshNamed(active, 'ignivarWaterActiveBeaconCrown');
    const frontal = buildIgnivarFrontalTelegraph();
    let highestFrontalOrder = 0;
    frontal.traverse((object) => {
      highestFrontalOrder = Math.max(highestFrontalOrder, object.renderOrder);
    });

    expect(beacon?.parent?.name).toBe('ignivarWaterConduit:active');
    expect(outer.geometry).toBeInstanceOf(THREE.CylinderGeometry);
    expect(core.geometry).toBeInstanceOf(THREE.CylinderGeometry);
    expect((outer.geometry as THREE.CylinderGeometry).parameters.height).toBe(6.2);
    expect((core.geometry as THREE.CylinderGeometry).parameters.height).toBe(6.5);
    expect((crown.geometry as THREE.TorusGeometry).parameters.radius).toBe(1.18);
    expect(outer.position.y).toBeGreaterThan(3);
    expect(core.position.y).toBeGreaterThan(3);
    expect(crown.position.y).toBeGreaterThan(6);
    expect(outer.renderOrder).toBe(6);
    expect(core.renderOrder).toBe(7);
    expect(crown.renderOrder).toBe(7);
    expect(outer.renderOrder).toBeGreaterThanOrEqual(highestFrontalOrder);
    expect(core.renderOrder).toBeGreaterThan(highestFrontalOrder);
    expect(crown.renderOrder).toBeGreaterThan(highestFrontalOrder);
    expect((outer.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThanOrEqual(0.3);
    expect((core.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThanOrEqual(0.85);
    expect((crown.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThanOrEqual(0.85);
    expect((outer.material as THREE.MeshBasicMaterial).toneMapped).toBe(false);
    expect((core.material as THREE.MeshBasicMaterial).toneMapped).toBe(false);
    expect((crown.material as THREE.MeshBasicMaterial).toneMapped).toBe(false);
  });

  it('draws the exact authoritative cleanse footprint with a high-contrast water edge', () => {
    const active = buildIgnivarWaterConduit(IGNIVAR_WATER_CONDUIT_TEMPLATES.active).group;
    const footprint = meshNamed(active, IGNIVAR_CONDUIT_CLEANSE_FOOTPRINT_NAME);
    const boundary = meshNamed(active, IGNIVAR_CONDUIT_CLEANSE_BOUNDARY_NAME);

    expect(IGNIVAR_WATER_CLEANSE_RADIUS).toBe(3.25);
    expect(maximumPlanarRadius(footprint.geometry)).toBeCloseTo(IGNIVAR_WATER_CLEANSE_RADIUS, 6);
    expect(maximumPlanarRadius(boundary.geometry)).toBeCloseTo(IGNIVAR_WATER_CLEANSE_RADIUS, 6);
    expect(footprint.rotation.x).toBeCloseTo(-Math.PI / 2, 8);
    expect(boundary.rotation.x).toBeCloseTo(-Math.PI / 2, 8);
    expect(materialNamed(active, IGNIVAR_CONDUIT_CLEANSE_FOOTPRINT_NAME).opacity).toBeLessThan(
      materialNamed(active, IGNIVAR_CONDUIT_CLEANSE_BOUNDARY_NAME).opacity,
    );
  });

  it('separates cleanse fill, energy, steam, and rune opacity in a cool-water palette', () => {
    // The conduit view is now overlay-only (the pump body is the placed
    // water_pump dressing prop), so state readability rides these active
    // layers; per-state distinctness is pinned by the semantic-layers test.
    const active = buildIgnivarWaterConduit(IGNIVAR_WATER_CONDUIT_TEMPLATES.active).group;
    const footprint = materialNamed(active, IGNIVAR_CONDUIT_CLEANSE_FOOTPRINT_NAME);
    const outerColumn = materialNamed(active, 'ignivarWaterColumnOuter');
    const columnCore = materialNamed(active, 'ignivarWaterColumnCore');
    const steam = materialNamed(active, 'ignivarWaterSteamHaloHigh');
    const rune = materialNamed(active, 'ignivarWaterActivationRuneGlow');

    expect(footprint.opacity).toBeLessThan(steam.opacity);
    expect(steam.opacity).toBeLessThan(outerColumn.opacity);
    expect(outerColumn.opacity).toBeLessThan(columnCore.opacity);
    expect(rune.opacity).toBeGreaterThan(outerColumn.opacity);
    expect(rune.color.g).toBeGreaterThan(rune.color.r * 2);
    expect(rune.color.b).toBeGreaterThan(rune.color.r * 2);
  });

  it('swaps state templates in place idempotently without rebuilding the stable view', () => {
    const conduit = buildIgnivarWaterConduit(IGNIVAR_WATER_CONDUIT_TEMPLATES.ready).group;
    const states = ['ready', 'active', 'cooldown'] as const;
    const stateRoots = states.map((state) =>
      conduit.getObjectByName(`ignivarWaterConduit:${state}`),
    );
    const children = [...conduit.children];

    for (const templateId of [
      IGNIVAR_WATER_CONDUIT_TEMPLATES.active,
      IGNIVAR_WATER_CONDUIT_TEMPLATES.active,
      IGNIVAR_WATER_CONDUIT_TEMPLATES.cooldown,
      IGNIVAR_WATER_CONDUIT_TEMPLATES.ready,
    ]) {
      syncIgnivarWaterConduitVisibility(conduit, templateId, false);
      expect(conduit.children).toEqual(children);
      expect(stateRoots.map((stateRoot) => stateRoot?.visible)).toEqual(
        states.map((state) => templateId === IGNIVAR_WATER_CONDUIT_TEMPLATES[state]),
      );
    }
  });

  it('clones object nodes while sharing every immutable geometry and material resource', () => {
    const first = buildIgnivarWaterConduit(IGNIVAR_WATER_CONDUIT_TEMPLATES.active).group;
    const second = buildIgnivarWaterConduit(IGNIVAR_WATER_CONDUIT_TEMPLATES.active).group;
    const firstMeshes: THREE.Mesh[] = [];
    const secondMeshes: THREE.Mesh[] = [];
    first.traverse((object) => {
      if (object instanceof THREE.Mesh) firstMeshes.push(object);
    });
    second.traverse((object) => {
      if (object instanceof THREE.Mesh) secondMeshes.push(object);
    });

    expect(first).not.toBe(second);
    expect(firstMeshes).toHaveLength(secondMeshes.length);
    expect(firstMeshes.length).toBeGreaterThan(15);
    for (let index = 0; index < firstMeshes.length; index++) {
      const firstMesh = firstMeshes[index];
      const secondMesh = secondMeshes[index];
      expect(firstMesh).not.toBe(secondMesh);
      expect(firstMesh.geometry).toBe(secondMesh.geometry);
      expect(firstMesh.geometry.userData.sharedRendererResource).toBe(true);
      const firstMaterials = Array.isArray(firstMesh.material)
        ? firstMesh.material
        : [firstMesh.material];
      const secondMaterials = Array.isArray(secondMesh.material)
        ? secondMesh.material
        : [secondMesh.material];
      expect(firstMaterials).toEqual(secondMaterials);
      expect(
        firstMaterials.every((material) => material.userData.sharedRendererResource === true),
      ).toBe(true);
    }
  });
});
