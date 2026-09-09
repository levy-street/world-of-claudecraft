import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { abilityVfxFullSpecFor } from '../src/render/ability_vfx/encounter_specs';
import { INTERIOR_ENCOUNTER_PREWARM } from '../src/render/interior_encounter_prewarm';
import {
  capRingLightness,
  handleMageGroundSpellfxEvent,
  MageGroundFx,
} from '../src/render/mage_ground_fx';
import {
  buildNythraxisGravePrewarmVisual,
  NYTHRAXIS_GRAVE_PREWARM_NAME,
} from '../src/render/nythraxis_grave_flame_visual';
import {
  NYTHRAXIS_SIGIL_GROUND_LIFT,
  NYTHRAXIS_SIGIL_PALETTE,
  NYTHRAXIS_SIGIL_SPOKE_COUNT,
  NYTHRAXIS_SIGIL_SWEEP_SEGMENTS,
  nythraxisSigilRimOpacity,
  nythraxisSigilSpokePoseInto,
  nythraxisSigilSweepAngle,
} from '../src/render/nythraxis_sigil_core';
import {
  buildNythraxisBindingSigil,
  NYTHRAXIS_SIGIL_FILL_NAME,
  NYTHRAXIS_SIGIL_RIM_NAME,
  NYTHRAXIS_SIGIL_SPOKES_NAME,
  NYTHRAXIS_SIGIL_SWEEP_NAME,
  NYTHRAXIS_SIGIL_VISUAL_NAME,
  NythraxisBindingSigilVisuals,
} from '../src/render/nythraxis_sigil_visual';
import {
  type ActiveNythraxisBindingSigil,
  NYTHRAXIS_SIGIL_CAST_ID,
  NYTHRAXIS_UNBOUND_CAST_ID,
} from '../src/sim/nythraxis_binding_sigil';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

const SIGIL: ActiveNythraxisBindingSigil = {
  id: '42:sig:3',
  sourceId: 42,
  x: 7,
  z: -5,
  radius: 4,
  duration: 15,
  remaining: 15,
};

const readSource = (path: string): string =>
  codeWithoutLineComments(readFileSync(new URL(path, import.meta.url), 'utf8'));

function maxRadiusOf(mesh: THREE.Mesh): number {
  const positions = mesh.geometry.getAttribute('position');
  let maxRadius = 0;
  for (let index = 0; index < positions.count; index++) {
    maxRadius = Math.max(maxRadius, Math.hypot(positions.getX(index), positions.getZ(index)));
  }
  return maxRadius;
}

describe('Nythraxis Binding Sigil rendering', () => {
  it('builds the authored tier-independent gold decal and eight spokes', () => {
    expect(readSource('../src/render/nythraxis_sigil_visual.ts')).not.toMatch(/from '\.\/gfx'/);
    const first = buildNythraxisBindingSigil(SIGIL, 3);
    const second = buildNythraxisBindingSigil(SIGIL, 3);
    for (const root of [first, second]) {
      expect(root.name).toBe(NYTHRAXIS_SIGIL_VISUAL_NAME);
      expect(root.position.toArray()).toEqual([SIGIL.x, 3 + NYTHRAXIS_SIGIL_GROUND_LIFT, SIGIL.z]);
      expect(root.userData).toMatchObject({
        renderCategory: 'ui3d',
        actionable: true,
        sigilId: SIGIL.id,
        sourceId: SIGIL.sourceId,
        radius: SIGIL.radius,
      });
      const fill = root.getObjectByName(NYTHRAXIS_SIGIL_FILL_NAME) as THREE.Mesh;
      const rim = root.getObjectByName(NYTHRAXIS_SIGIL_RIM_NAME) as THREE.Mesh;
      const spokes = root.getObjectByName(NYTHRAXIS_SIGIL_SPOKES_NAME) as THREE.InstancedMesh;
      expect((fill.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
        NYTHRAXIS_SIGIL_PALETTE.fill,
      );
      expect((rim.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
        NYTHRAXIS_SIGIL_PALETTE.rim,
      );
      expect(maxRadiusOf(rim)).toBeCloseTo(SIGIL.radius, 5);
      expect(spokes.count).toBe(NYTHRAXIS_SIGIL_SPOKE_COUNT);
      const matrix = new THREE.Matrix4();
      const scale = new THREE.Vector3();
      spokes.getMatrixAt(0, matrix);
      matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
      expect(scale.z).toBeCloseTo(SIGIL.radius * (0.88 - 0.3), 5);
      expect(root.getObjectByName(NYTHRAXIS_SIGIL_SWEEP_NAME)).toBeDefined();
    }
    const firstSweep = first.getObjectByName(NYTHRAXIS_SIGIL_SWEEP_NAME) as THREE.Mesh;
    const secondSweep = second.getObjectByName(NYTHRAXIS_SIGIL_SWEEP_NAME) as THREE.Mesh;
    expect(firstSweep.geometry.getAttribute('position').count).toBe(
      secondSweep.geometry.getAttribute('position').count,
    );
  });

  it('keeps the row object and sweep buffer while remaining shrinks clockwise', () => {
    const scene = new THREE.Scene();
    const visuals = new NythraxisBindingSigilVisuals(scene, () => 2);
    visuals.sync([SIGIL]);
    const root = scene.children[0];
    const sweep = root.getObjectByName(NYTHRAXIS_SIGIL_SWEEP_NAME) as THREE.Mesh;
    const positions = sweep.geometry.getAttribute('position');
    const geometry = sweep.geometry;
    expect(sweep.userData.visibleAngle).toBeCloseTo(Math.PI * 2, 8);
    // The first clockwise segment leaves north toward positive x.
    expect(positions.getX(2)).toBeGreaterThan(0);

    visuals.sync([{ ...SIGIL, remaining: 7.5 }]);

    expect(scene.children[0]).toBe(root);
    expect(sweep.geometry).toBe(geometry);
    expect(sweep.geometry.getAttribute('position')).toBe(positions);
    expect(sweep.userData.visibleAngle).toBeCloseTo(Math.PI, 8);
    expect(root.userData.remaining).toBe(7.5);
    const lastVisibleEnd = (NYTHRAXIS_SIGIL_SWEEP_SEGMENTS / 2 - 1) * 4 + 2;
    expect(positions.getX(lastVisibleEnd)).toBeCloseTo(0, 5);
    expect(positions.getZ(lastVisibleEnd)).toBeCloseTo(-SIGIL.radius * 0.8, 5);
    const firstCollapsed = (NYTHRAXIS_SIGIL_SWEEP_SEGMENTS / 2) * 4;
    expect(positions.getX(firstCollapsed)).toBeCloseTo(positions.getX(firstCollapsed + 3), 8);
    expect(positions.getZ(firstCollapsed)).toBeCloseTo(positions.getZ(firstCollapsed + 3), 8);
    expect(positions.getX(firstCollapsed + 1)).toBeCloseTo(positions.getX(firstCollapsed + 2), 8);
    expect(positions.getZ(firstCollapsed + 1)).toBeCloseTo(positions.getZ(firstCollapsed + 2), 8);
  });

  it('samples the static floor once per row and syncs rows by id', () => {
    const scene = new THREE.Scene();
    const groundY = vi.fn(() => 2);
    const visuals = new NythraxisBindingSigilVisuals(scene, groundY);
    visuals.syncWorld({
      activeNythraxisBindingSigils: [SIGIL, { ...SIGIL, id: '42:sig:4', x: 12 }],
    });
    expect(scene.children).toHaveLength(2);
    expect(groundY).toHaveBeenCalledTimes(2);
    visuals.syncWorld({
      activeNythraxisBindingSigils: [
        { ...SIGIL, remaining: 8 },
        { ...SIGIL, id: '42:sig:4', x: 12, remaining: 8 },
      ],
    });
    expect(scene.children).toHaveLength(2);
    expect(groundY).toHaveBeenCalledTimes(2);
  });

  it('disposes every row-owned resource when the sigil vanishes', () => {
    const scene = new THREE.Scene();
    const visuals = new NythraxisBindingSigilVisuals(scene, () => 0);
    visuals.sync([SIGIL]);
    const root = scene.children[0];
    const fill = root.getObjectByName(NYTHRAXIS_SIGIL_FILL_NAME) as THREE.Mesh;
    const rim = root.getObjectByName(NYTHRAXIS_SIGIL_RIM_NAME) as THREE.Mesh;
    const spokes = root.getObjectByName(NYTHRAXIS_SIGIL_SPOKES_NAME) as THREE.InstancedMesh;
    const sweep = root.getObjectByName(NYTHRAXIS_SIGIL_SWEEP_NAME) as THREE.Mesh;
    const fillDispose = vi.spyOn(fill.material as THREE.Material, 'dispose');
    const rimDispose = vi.spyOn(rim.material as THREE.Material, 'dispose');
    const sweepDispose = vi.spyOn(sweep.material as THREE.Material, 'dispose');
    const fillGeometryDispose = vi.spyOn(fill.geometry, 'dispose');
    const rimGeometryDispose = vi.spyOn(rim.geometry, 'dispose');
    const sweepGeometryDispose = vi.spyOn(sweep.geometry, 'dispose');
    const spokesDispose = vi.spyOn(spokes, 'dispose');

    visuals.sync([]);

    expect(scene.children).toHaveLength(0);
    expect(fillDispose).toHaveBeenCalledOnce();
    expect(rimDispose).toHaveBeenCalledOnce();
    expect(sweepDispose).toHaveBeenCalledOnce();
    expect(fillGeometryDispose).toHaveBeenCalledOnce();
    expect(rimGeometryDispose).toHaveBeenCalledOnce();
    expect(sweepGeometryDispose).toHaveBeenCalledOnce();
    expect(spokesDispose).toHaveBeenCalledOnce();
  });

  it('settles its slow pulse at the midpoint for reduced motion', () => {
    const scene = new THREE.Scene();
    const visuals = new NythraxisBindingSigilVisuals(scene, () => 0);
    visuals.sync([SIGIL]);
    const rim = scene.children[0].getObjectByName(NYTHRAXIS_SIGIL_RIM_NAME) as THREE.Mesh;
    const material = rim.material as THREE.MeshBasicMaterial;
    visuals.update(0.5, true);
    const settled = material.opacity;
    visuals.update(0.5, true);
    expect(material.opacity).toBe(settled);
    expect(settled).toBeCloseTo(nythraxisSigilRimOpacity(0, true), 8);
  });

  it('uses gold for the Binding Sigil runeCircle cue', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 0, vi.fn());
    expect(
      handleMageGroundSpellfxEvent(fx, {
        fx: 'runeCircle',
        x: SIGIL.x,
        z: SIGIL.z,
        radius: SIGIL.radius,
        duration: SIGIL.duration,
        school: 'arcane',
        ability: NYTHRAXIS_SIGIL_CAST_ID,
      }),
    ).toBe(true);
    const root = scene.getObjectByName('mage-rune-power') as THREE.Group;
    const outer = root.getObjectByName('mage-rune-power-outer-ring') as THREE.Mesh;
    const expected = capRingLightness(new THREE.Color(NYTHRAXIS_SIGIL_PALETTE.rim)).multiplyScalar(
      1.6,
    );
    expect((outer.material as THREE.MeshBasicMaterial).color.getHex()).toBe(expected.getHex());
  });

  it('is driven by the shared facade and staged at crypt attach', () => {
    const facade = readSource('../src/render/nythraxis_mechanic_visuals.ts');
    expect(facade).toContain('this.sigils.syncWorld(world)');
    expect(facade).toContain('this.sigils.dispose()');
    expect(INTERIOR_ENCOUNTER_PREWARM.nythraxis.nythraxisGraveVisuals).toBe(true);
    const pass = readSource('../src/render/interior_encounter_prewarm_pass.ts');
    expect(pass).toContain('buildNythraxisGravePrewarmVisual()');
    const prewarm = buildNythraxisGravePrewarmVisual();
    expect(prewarm.name).toBe(NYTHRAXIS_GRAVE_PREWARM_NAME);
    expect(prewarm.getObjectByName(NYTHRAXIS_SIGIL_VISUAL_NAME)).toBeDefined();
    expect(prewarm.getObjectByName('mage-rune-power')).toBeDefined();
  });
});

describe('Nythraxis Binding Sigil core', () => {
  it('maps remaining over duration to a clamped countdown sweep', () => {
    expect(nythraxisSigilSweepAngle(15, 15)).toBeCloseTo(Math.PI * 2, 8);
    expect(nythraxisSigilSweepAngle(7.5, 15)).toBeCloseTo(Math.PI, 8);
    expect(nythraxisSigilSweepAngle(0, 15)).toBe(0);
    expect(nythraxisSigilSweepAngle(-1, 15)).toBe(0);
    expect(nythraxisSigilSweepAngle(20, 15)).toBeCloseTo(Math.PI * 2, 8);
    expect(nythraxisSigilSweepAngle(1, 0)).toBe(0);
  });

  it('places exactly eight equal spokes from the inner ring to the rim', () => {
    const pose = { x: 0, z: 0, yaw: 0, length: 0, width: 0 };
    const first = { ...nythraxisSigilSpokePoseInto(pose, 0, SIGIL.radius) };
    const opposite = {
      ...nythraxisSigilSpokePoseInto(pose, NYTHRAXIS_SIGIL_SPOKE_COUNT / 2, SIGIL.radius),
    };
    expect(NYTHRAXIS_SIGIL_SPOKE_COUNT).toBe(8);
    expect(opposite.x).toBeCloseTo(-first.x, 8);
    expect(opposite.z).toBeCloseTo(-first.z, 8);
    expect(opposite.length).toBeCloseTo(first.length, 8);
  });

  it('registers the blue sigil cue and the shadow Unbound burst', () => {
    expect(abilityVfxFullSpecFor(NYTHRAXIS_SIGIL_CAST_ID)).toMatchObject({
      archetype: 'nova',
      palette: 'arcane',
      decal: 'rune',
      tint: '#7fc0ff',
    });
    expect(abilityVfxFullSpecFor(NYTHRAXIS_UNBOUND_CAST_ID)).toMatchObject({
      archetype: 'nova',
      palette: 'shadow',
      motifAt: 'caster',
    });
  });
});
