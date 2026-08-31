import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  buildVarkhulForgeBeamPrewarmVisual,
  VarkhulForgeBeamVisuals,
  varkhulForgeHeatPercentLabel,
  varkhulForgeWaveStatusLabel,
} from '../src/render/varkhul_forge_beam_visual';
import type { ActiveVarkhulAssembly } from '../src/sim/varkhul_assembly';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';

const ACTIVE: ActiveVarkhulAssembly = {
  bossId: 42,
  difficulty: 'heroic',
  phase: 'links',
  forgeX: 0,
  forgeZ: 22,
  forgeHp: 0,
  forgeMaxHp: 100,
  forgeOverheat: 0.46,
  forgeBeamActiveMask: 3,
  forgeBeamWarmupRemaining: 0,
  forgeMeltdownRemaining: 0,
  addWave: 0,
  addWaves: 0,
  addsRemaining: 0,
  forgeBeams: [
    {
      index: 0,
      columnX: -28,
      columnZ: 22,
      impactX: -12,
      impactZ: 22,
      active: true,
      warning: false,
      blocked: true,
      blockerId: 100,
    },
    {
      index: 1,
      columnX: 28,
      columnZ: 22,
      impactX: 0,
      impactZ: 22,
      active: true,
      warning: false,
      blocked: false,
      blockerId: null,
    },
  ],
  interceptBeam: null,
  cores: [],
  deliveryWindowRemaining: 0,
  assignments: [],
  runes: [],
  round: 0,
  rounds: 2,
  remaining: 20,
};

function meshCount(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) count++;
  });
  return count;
}

describe('Varkhul forge beam visuals', () => {
  it('formats the world-space heat percentage through the active locale', () => {
    setLanguage('es_ES');
    try {
      expect(varkhulForgeHeatPercentLabel(46)).toMatch(/^46\s%$/u);
      expect(varkhulForgeHeatPercentLabel(46)).not.toBe('46%');
    } finally {
      setLanguage('en');
    }
  });

  it('shows a localized wave counter and updates the remaining enemy count', async () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulForgeBeamVisuals(scene, () => 0);
    setLanguage('en');
    try {
      expect(varkhulForgeWaveStatusLabel(2, 4, 7)).toBe('Wave 2/4 | Enemies: 7');
      visuals.sync([{ ...ACTIVE, phase: 'adds', addWave: 2, addWaves: 4, addsRemaining: 7 }]);
      const label = scene.getObjectByName('varkhul-forge-wave-status');
      expect(label).toMatchObject({ visible: true });
      expect(label?.userData).toMatchObject({
        label: 'Wave 2/4 | Enemies: 7',
        wave: 2,
        waves: 4,
        remaining: 7,
      });

      visuals.sync([{ ...ACTIVE, phase: 'adds', addWave: 2, addWaves: 4, addsRemaining: 3 }]);
      expect(label?.userData.label).toBe('Wave 2/4 | Enemies: 3');

      await ensureLocaleLoaded('es_ES');
      setLanguage('es_ES');
      visuals.sync([{ ...ACTIVE, phase: 'adds', addWave: 2, addWaves: 4, addsRemaining: 3 }]);
      expect(label?.userData.label).toBe('Oleada 2/4 | Enemigos: 3');
      visuals.sync([ACTIVE]);
      expect(label?.visible).toBe(false);
    } finally {
      setLanguage('en');
      visuals.dispose();
    }
  });

  it('repaints a stable heat percentage when the locale changes', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulForgeBeamVisuals(scene, () => 0);
    setLanguage('en');
    try {
      visuals.sync([ACTIVE]);
      const heatLabel = scene.getObjectByName('varkhul-forge-heat-percent');
      expect(heatLabel?.userData.label).toBe('46%');

      setLanguage('es_ES');
      visuals.sync([ACTIVE]);
      expect(heatLabel?.userData.label).toMatch(/^46\s%$/u);
      expect(heatLabel?.userData.label).not.toBe('46%');
    } finally {
      setLanguage('en');
      visuals.dispose();
    }
  });

  it('renders two separated columns, authoritative beam endpoints, and a ten-step heat meter', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulForgeBeamVisuals(scene, () => 0);

    visuals.sync([ACTIVE]);

    const root = scene.getObjectByName('varkhul-forge-beams-42');
    expect(root).toBeTruthy();
    expect(scene.getObjectByName('varkhul-forge-column-0')?.position.x).toBe(-28);
    expect(scene.getObjectByName('varkhul-forge-column-1')?.position.x).toBe(28);
    const leftBeam = scene.getObjectByName('varkhul-forge-beam-core-0');
    const rightBeam = scene.getObjectByName('varkhul-forge-beam-core-1');
    expect(leftBeam?.userData.length).toBeCloseTo(Math.hypot(16, 4.8 - 1.55), 5);
    expect(rightBeam?.userData.length).toBeCloseTo(Math.hypot(28, 4.8 - 2.15), 5);
    expect(scene.getObjectByName('varkhul-forge-impact-0')?.userData.blocked).toBe(true);
    expect(scene.getObjectByName('varkhul-forge-impact-1')?.userData.blocked).toBe(false);
    expect((leftBeam as THREE.Mesh).position.toArray()).toEqual([-20, 3.175, 22]);
    const leftDirection = new THREE.Vector3(0, 1, 0)
      .applyQuaternion((leftBeam as THREE.Mesh).quaternion)
      .normalize();
    expect(leftDirection.x).toBeCloseTo(16 / Math.hypot(16, 3.25), 5);
    expect(leftDirection.y).toBeCloseTo(-3.25 / Math.hypot(16, 3.25), 5);
    expect(
      (
        scene.getObjectByName('varkhul-forge-impact-0') as THREE.Mesh<
          THREE.SphereGeometry,
          THREE.MeshBasicMaterial
        >
      ).material.color.getHex(),
    ).toBe(0x8ff8ff);
    expect(
      (
        scene.getObjectByName('varkhul-forge-impact-1') as THREE.Mesh<
          THREE.SphereGeometry,
          THREE.MeshBasicMaterial
        >
      ).material.color.getHex(),
    ).toBe(0xff4b0b);
    const filled = scene.getObjectByName('varkhul-forge-heat-segments')?.userData.filled;
    expect(filled).toEqual([true, true, true, true, true, false, false, false, false, false]);
    const heatSegments = scene.getObjectByName(
      'varkhul-forge-heat-segments',
    ) as THREE.InstancedMesh;
    const heatColor = new THREE.Color();
    for (let index = 0; index < 5; index++) {
      heatSegments.getColorAt(index, heatColor);
      expect(heatColor.getHex()).toBe(0xffbd32);
    }
    heatSegments.getColorAt(5, heatColor);
    expect(heatColor.getHex()).toBe(0x3a1712);
    expect(root?.userData.overheat).toBe(0.46);
    expect(scene.getObjectByName('varkhul-forge-heat-percent')?.userData.percent).toBe(46);
    expect(meshCount(root as THREE.Object3D)).toBeLessThanOrEqual(20);

    const instancedDisposals: Array<ReturnType<typeof vi.spyOn>> = [];
    const geometryDisposals: Array<ReturnType<typeof vi.spyOn>> = [];
    const materialDisposals: Array<ReturnType<typeof vi.spyOn>> = [];
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    root?.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
        instancedDisposals.push(vi.spyOn(mesh as THREE.InstancedMesh, 'dispose'));
      }
      if (!geometries.has(mesh.geometry)) {
        geometries.add(mesh.geometry);
        geometryDisposals.push(vi.spyOn(mesh.geometry, 'dispose'));
      }
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (materials.has(material)) continue;
        materials.add(material);
        materialDisposals.push(vi.spyOn(material, 'dispose'));
      }
    });
    visuals.dispose();
    expect(instancedDisposals).toHaveLength(4);
    for (const dispose of instancedDisposals) expect(dispose).toHaveBeenCalledOnce();
    expect(geometryDisposals.length).toBeGreaterThan(0);
    for (const dispose of geometryDisposals) expect(dispose).toHaveBeenCalledOnce();
    expect(materialDisposals.length).toBeGreaterThan(0);
    for (const dispose of materialDisposals) expect(dispose).toHaveBeenCalledOnce();
    expect(scene.getObjectByName('varkhul-forge-beams-42')).toBeUndefined();
  });

  it('keeps both dormant pillars readable while hiding inactive beam lanes', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulForgeBeamVisuals(scene, () => 0);
    const dormant: ActiveVarkhulAssembly = {
      ...ACTIVE,
      phase: 'done',
      forgeOverheat: 0.37,
      forgeBeamActiveMask: 0,
      forgeBeams: ACTIVE.forgeBeams.map((beam) => ({
        ...beam,
        active: false,
        blocked: false,
        blockerId: null,
        impactX: 0,
        impactZ: 22,
      })),
    };

    visuals.sync([dormant]);

    expect(scene.getObjectByName('varkhul-forge-column-0')?.visible).toBe(true);
    expect(scene.getObjectByName('varkhul-forge-column-1')?.visible).toBe(true);
    expect(scene.getObjectByName('varkhul-forge-beam-core-0')?.visible).toBe(false);
    expect(scene.getObjectByName('varkhul-forge-beam-core-1')?.visible).toBe(false);
    expect(scene.getObjectByName('varkhul-forge-impact-0')?.visible).toBe(false);
    expect(scene.getObjectByName('varkhul-forge-heat-meter')?.visible).toBe(true);
    expect(scene.getObjectByName('varkhul-forge-heat-percent')?.userData.percent).toBe(37);
    const dormantRing = scene.getObjectByName('varkhul-forge-column-rings-0') as THREE.Mesh;
    expect((dormantRing.material as THREE.MeshBasicMaterial).opacity).toBe(0.1);
    visuals.dispose();
  });

  it('prelights only the next pillar without igniting its damaging beam', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulForgeBeamVisuals(scene, () => 0);
    visuals.sync([
      {
        ...ACTIVE,
        forgeBeamActiveMask: 1,
        forgeBeams: ACTIVE.forgeBeams.map((beam) => ({
          ...beam,
          active: beam.index === 0,
          warning: beam.index === 1,
          blocked: false,
          blockerId: null,
        })),
      },
    ]);

    expect(scene.getObjectByName('varkhul-forge-beam-core-0')?.visible).toBe(true);
    expect(scene.getObjectByName('varkhul-forge-beam-core-1')?.visible).toBe(false);
    expect(scene.getObjectByName('varkhul-forge-column-0')?.userData.active).toBe(true);
    expect(scene.getObjectByName('varkhul-forge-column-1')?.userData.warning).toBe(true);
    const warningRings = scene.getObjectByName('varkhul-forge-column-rings-1') as THREE.Mesh;
    expect((warningRings.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0.1);
    visuals.dispose();
  });

  it('keeps every actionable beam and meter segment in reduced motion', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulForgeBeamVisuals(scene, () => 0);
    visuals.sync([ACTIVE]);

    visuals.update(0.5, true);

    expect(scene.getObjectByName('varkhul-forge-beam-core-0')?.visible).toBe(true);
    expect(scene.getObjectByName('varkhul-forge-beam-core-1')?.visible).toBe(true);
    expect(scene.getObjectByName('varkhul-forge-column-0')?.visible).toBe(true);
    expect(scene.getObjectByName('varkhul-forge-column-1')?.visible).toBe(true);
    expect(scene.getObjectByName('varkhul-forge-impact-0')?.visible).toBe(true);
    expect(scene.getObjectByName('varkhul-forge-impact-1')?.visible).toBe(true);
    expect(scene.getObjectByName('varkhul-forge-heat-segments')?.visible).toBe(true);
    expect(scene.getObjectByName('varkhul-forge-beam-motes')?.visible).toBe(false);

    const core = scene.getObjectByName('varkhul-forge-beam-core-0') as THREE.Mesh<
      THREE.CylinderGeometry,
      THREE.MeshBasicMaterial
    >;
    const heatMeter = scene.getObjectByName('varkhul-forge-heat-meter') as THREE.Group;
    const plume = scene.getObjectByName('varkhul-forge-meltdown-plume') as THREE.Mesh;
    const frozen = {
      coreOpacity: core.material.opacity,
      heatRotation: heatMeter.rotation.y,
      plumeScaleY: plume.scale.y,
    };
    visuals.update(5, true);
    expect(core.material.opacity).toBe(frozen.coreOpacity);
    expect(heatMeter.rotation.y).toBe(frozen.heatRotation);
    expect(plume.scale.y).toBe(frozen.plumeScaleY);
    visuals.dispose();
  });

  it('charges only the pillar before ignition reveals the beam and impact', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulForgeBeamVisuals(scene, () => 0);
    visuals.sync([{ ...ACTIVE, forgeBeamWarmupRemaining: 2.5 }]);
    visuals.update(0, false);
    const cores = [0, 1].map(
      (index) => scene.getObjectByName(`varkhul-forge-beam-core-${index}`) as THREE.Mesh,
    );
    const sheaths = [0, 1].map(
      (index) => scene.getObjectByName(`varkhul-forge-beam-sheath-${index}`) as THREE.Mesh,
    );
    const impacts = [0, 1].map(
      (index) => scene.getObjectByName(`varkhul-forge-impact-${index}`) as THREE.Mesh,
    );
    const chargingRings = [0, 1].map(
      (index) =>
        scene.getObjectByName(`varkhul-forge-column-rings-${index}`) as THREE.InstancedMesh<
          THREE.TorusGeometry,
          THREE.MeshBasicMaterial
        >,
    );
    expect(
      [0, 1].every((index) => scene.getObjectByName(`varkhul-forge-column-${index}`)?.visible),
    ).toBe(true);
    const earlyGlow = chargingRings.map((rings) => rings.material.opacity);
    expect(earlyGlow.every((opacity) => opacity > 0.1 && opacity < 0.82)).toBe(true);
    expect(cores.every((core) => !core.visible)).toBe(true);
    expect(sheaths.every((sheath) => !sheath.visible)).toBe(true);
    expect(impacts.every((impact) => !impact.visible)).toBe(true);
    expect(scene.getObjectByName('varkhul-forge-beam-motes')?.visible).toBe(false);

    visuals.update(0, true);
    expect(cores.every((core) => !core.visible)).toBe(true);
    expect(sheaths.every((sheath) => !sheath.visible)).toBe(true);
    expect(impacts.every((impact) => !impact.visible)).toBe(true);

    visuals.sync([{ ...ACTIVE, forgeBeamWarmupRemaining: 1.5 }]);
    const middleGlow = chargingRings.map((rings) => rings.material.opacity);
    expect(middleGlow.every((opacity, index) => opacity > earlyGlow[index] && opacity < 0.82)).toBe(
      true,
    );
    expect(cores.every((core) => !core.visible)).toBe(true);
    expect(sheaths.every((sheath) => !sheath.visible)).toBe(true);
    expect(impacts.every((impact) => !impact.visible)).toBe(true);
    expect(scene.getObjectByName('varkhul-forge-beam-motes')?.visible).toBe(false);

    visuals.sync([{ ...ACTIVE, forgeBeamWarmupRemaining: 0.5 }]);
    const lateGlow = chargingRings.map((rings) => rings.material.opacity);
    expect(lateGlow.every((opacity, index) => opacity > middleGlow[index] && opacity < 0.82)).toBe(
      true,
    );
    expect(cores.every((core) => !core.visible)).toBe(true);
    expect(sheaths.every((sheath) => !sheath.visible)).toBe(true);
    expect(impacts.every((impact) => !impact.visible)).toBe(true);
    expect(scene.getObjectByName('varkhul-forge-beam-motes')?.visible).toBe(false);

    visuals.sync([ACTIVE]);
    visuals.update(0, false);
    expect(chargingRings.every((rings) => rings.material.opacity === 0.82)).toBe(true);
    expect(cores.every((core) => core.visible)).toBe(true);
    expect(sheaths.every((sheath) => sheath.visible)).toBe(true);
    expect(impacts.every((impact) => impact.visible)).toBe(true);
    expect(scene.getObjectByName('varkhul-forge-beam-motes')?.visible).toBe(true);
    visuals.dispose();
  });

  it('removes the cached root as soon as the authoritative assembly disappears', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulForgeBeamVisuals(scene, () => 0);
    visuals.sync([ACTIVE]);
    expect(scene.getObjectByName('varkhul-forge-beams-42')).toBeTruthy();

    visuals.sync([]);

    expect(scene.getObjectByName('varkhul-forge-beams-42')).toBeUndefined();
    visuals.dispose();
  });

  it('holds a full red meter and forge plume through the server-owned meltdown window', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulForgeBeamVisuals(scene, () => 0);
    visuals.sync([
      {
        ...ACTIVE,
        phase: 'done',
        forgeOverheat: 1,
        forgeMeltdownRemaining: 4.5,
        forgeBeams: ACTIVE.forgeBeams.map((beam) => ({ ...beam, active: false })),
      },
    ]);

    expect(scene.getObjectByName('varkhul-forge-meltdown-plume')?.visible).toBe(true);
    const heatSegments = scene.getObjectByName(
      'varkhul-forge-heat-segments',
    ) as THREE.InstancedMesh;
    expect(heatSegments.userData.filled).toEqual(Array.from({ length: 10 }, () => true));
    const color = new THREE.Color();
    for (let index = 0; index < 10; index++) {
      heatSegments.getColorAt(index, color);
      expect(color.getHex()).toBe(0xff1808);
    }
    expect(scene.getObjectByName('varkhul-forge-heat-percent')?.userData).toMatchObject({
      percent: 100,
      meltdown: true,
    });
    expect(scene.getObjectByName('varkhul-forge-column-0')?.visible).toBe(true);
    expect(scene.getObjectByName('varkhul-forge-column-1')?.visible).toBe(true);
    visuals.dispose();
  });

  it('uploads heat colors only when the filled or meltdown state changes', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulForgeBeamVisuals(scene, () => 0);
    visuals.sync([ACTIVE]);
    const heatSegments = scene.getObjectByName(
      'varkhul-forge-heat-segments',
    ) as THREE.InstancedMesh;
    const setColorAt = vi.spyOn(heatSegments, 'setColorAt');

    visuals.sync([ACTIVE]);
    expect(setColorAt).not.toHaveBeenCalled();

    visuals.sync([{ ...ACTIVE, forgeOverheat: 0.61 }]);
    expect(setColorAt).toHaveBeenCalledTimes(10);
    setColorAt.mockClear();

    visuals.sync([{ ...ACTIVE, forgeOverheat: 0.61, forgeMeltdownRemaining: 4 }]);
    expect(setColorAt).toHaveBeenCalledTimes(10);
    visuals.dispose();
  });

  it('prewarms the columns, both beam layers, impacts, motes, meter, and meltdown plume', () => {
    const root = buildVarkhulForgeBeamPrewarmVisual();
    expect(root.getObjectByName('varkhul-forge-column-0')).toBeTruthy();
    expect(root.getObjectByName('varkhul-forge-column-1')).toBeTruthy();
    expect(root.getObjectByName('varkhul-forge-beam-core-0')).toBeTruthy();
    expect(root.getObjectByName('varkhul-forge-beam-sheath-1')).toBeTruthy();
    expect(root.getObjectByName('varkhul-forge-impact-0')).toBeTruthy();
    expect(root.getObjectByName('varkhul-forge-beam-motes')).toBeTruthy();
    expect(root.getObjectByName('varkhul-forge-heat-segments')).toBeTruthy();
    expect(root.getObjectByName('varkhul-forge-heat-percent')).toBeTruthy();
    expect(root.getObjectByName('varkhul-forge-meltdown-plume')).toBeTruthy();
  });
});
