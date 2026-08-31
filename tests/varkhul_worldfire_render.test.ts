import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildVarkhulWorldfirePrewarmVisual,
  VarkhulWorldfireVisuals,
  varkhulWorldfireCountdownFontSize,
} from '../src/render/varkhul_worldfire_visual';
import { VARKHUL_MASTERPIECE_UNBOUND_AURA_ID } from '../src/sim/encounters/varkhul';
import type { ActiveVarkhulAssembly } from '../src/sim/varkhul_assembly';
import { setLanguage } from '../src/ui/i18n';

afterEach(() => setLanguage('en'));

const ASSEMBLY: ActiveVarkhulAssembly = {
  bossId: 42,
  difficulty: 'heroic',
  phase: 'done',
  forgeX: 100,
  forgeZ: 222,
  forgeHp: 100,
  forgeMaxHp: 100,
  forgeOverheat: 0.4,
  forgeBeamActiveMask: 0,
  forgeBeamWarmupRemaining: 0,
  forgeMeltdownRemaining: 0,
  addWave: 0,
  addWaves: 0,
  addsRemaining: 0,
  forgeBeams: [],
  interceptBeam: null,
  cores: [],
  deliveryWindowRemaining: 0,
  assignments: [],
  runes: [],
  round: 0,
  rounds: 2,
  remaining: 0,
};

function entities(remaining: number, permanent = false) {
  return new Map([
    [
      42,
      {
        auras: [
          {
            id: VARKHUL_MASTERPIECE_UNBOUND_AURA_ID,
            remaining,
            duration: permanent ? Number.POSITIVE_INFINITY : 45,
            permanent,
          },
        ],
      },
    ],
  ]);
}

function visibleMeshCount(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && child.visible) count++;
  });
  return count;
}

describe('Varkhul Worldfire visuals', () => {
  it('centers one continuous fire field on the room and advances one literal safe edge', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulWorldfireVisuals(scene, () => 2);
    visuals.sync([ASSEMBLY], entities(38));

    const root = scene.getObjectByName('varkhul-worldfire-42') as THREE.Group;
    expect(root.position.toArray()).toEqual([100, 2.08, 200]);
    expect(root.userData).toMatchObject({
      actionable: true,
      stage: 1,
      safeRadius: 30,
      full: false,
    });
    const field = root.getObjectByName('varkhul-worldfire-field') as THREE.Group;
    expect(field.visible).toBe(true);
    expect(field.position.y).toBe(0.12);
    expect(field.userData).toMatchObject({
      visualLanguage: 'ignivar-ground-fire',
      innerRadius: 30,
      outerRadius: 40,
    });
    const fieldDisc = field.getObjectByName('ground_fire_aoe__disc') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >;
    expect(fieldDisc).toBeInstanceOf(THREE.Mesh);
    expect(fieldDisc.material.polygonOffset).toBe(true);
    expect(fieldDisc.material.polygonOffsetFactor).toBe(-4);
    expect(fieldDisc.material.polygonOffsetUnits).toBe(-4);
    expect(fieldDisc.material.uniforms.uInnerRadiusRatio.value).toBeCloseTo(30 / 40, 6);
    const fieldPositions = fieldDisc.geometry.getAttribute('position');
    let minimumLocalRadius = Number.POSITIVE_INFINITY;
    for (let index = 0; index < fieldPositions.count; index++) {
      minimumLocalRadius = Math.min(
        minimumLocalRadius,
        Math.hypot(fieldPositions.getX(index), fieldPositions.getZ(index)),
      );
    }
    expect(minimumLocalRadius).toBe(0);
    const flames = field.getObjectByName('ground_fire_aoe__flames') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >;
    expect(flames).toBeInstanceOf(THREE.Mesh);
    expect(flames.material.uniforms.uOuterRadiusRatio.value).toBe(0.97);
    for (let index = 0; index < 7; index++) {
      expect(root.getObjectByName(`varkhul-worldfire-band-${index}`)).toBeUndefined();
    }
    const edge = root.getObjectByName('varkhul-worldfire-safe-edge') as THREE.Mesh;
    expect(edge.scale.x).toBe(30);
    expect(edge.scale.z).toBe(30);
    expect(root.getObjectByName('varkhul-worldfire-boundary-wall')).toBeUndefined();
    expect(root.getObjectByName('varkhul-worldfire-flames')).toBeUndefined();
    expect(root.getObjectByName('varkhul-worldfire-countdown')?.userData.seconds).toBe(35);
    expect(root.getObjectByName('varkhul-worldfire-countdown')?.position.toArray()).toEqual([
      0, 8, 0,
    ]);

    visuals.sync([ASSEMBLY], entities(31));
    expect(scene.getObjectByName('varkhul-worldfire-42')).toBe(root);
    expect(root.getObjectByName('varkhul-worldfire-field')).toBe(field);
    expect(root.getObjectByName('varkhul-worldfire-safe-edge')).toBe(edge);
    expect(root.userData).toMatchObject({ stage: 2, safeRadius: 24, full: false });
    expect(fieldDisc.material.uniforms.uInnerRadiusRatio.value).toBeCloseTo(24 / 40, 6);
    expect(flames.material.uniforms.uInnerRadiusRatio.value).toBeCloseTo(24 / 40, 6);
    expect(edge.scale.x).toBe(24);
    expect(edge.scale.z).toBe(24);
    expect(edge.visible).toBe(true);

    visuals.sync([ASSEMBLY], entities(3));
    expect(root.userData).toMatchObject({ stage: 6, safeRadius: 0, full: true });
    expect(fieldDisc.material.uniforms.uInnerRadiusRatio.value).toBe(0);
    expect(flames.material.uniforms.uInnerRadiusRatio.value).toBe(0);
    expect(edge.visible).toBe(false);
    expect(visibleMeshCount(root)).toBeLessThanOrEqual(4);
    visuals.dispose();
  });

  it('repaints a localized countdown and fits long unit labels inside the panel', () => {
    const spanishWidthAtMax = 366.22;
    const fontSize = varkhulWorldfireCountdownFontSize(spanishWidthAtMax);
    expect(fontSize).toBeGreaterThanOrEqual(24);
    expect(fontSize).toBeLessThan(62);
    expect((spanishWidthAtMax * fontSize) / 62).toBeLessThanOrEqual(252);

    const fillText = vi.fn();
    const context = {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      measureText: vi.fn((label: string) => ({
        width: label.includes('segundos') ? spanishWidthAtMax : 320.08,
      })),
      fillText,
    };
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => context }),
    });
    try {
      const scene = new THREE.Scene();
      const visuals = new VarkhulWorldfireVisuals(scene, () => 0);
      setLanguage('en');
      visuals.sync([ASSEMBLY], entities(38));
      const countdown = scene.getObjectByName('varkhul-worldfire-countdown') as THREE.Sprite;
      expect(countdown.userData.label).toBe('35 seconds');
      setLanguage('es_ES');
      visuals.sync([ASSEMBLY], entities(38));
      expect(countdown.userData.label).toBe('35 segundos');
      expect(countdown.userData.fontSize).toBe(fontSize);
      expect(countdown.userData.maxLabelWidth).toBe(252);
      expect(fillText).toHaveBeenLastCalledWith('35 segundos', 160, 57, 252);
      visuals.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fills the room through the same field, removes the only edge, and stays under four draws', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulWorldfireVisuals(scene, () => 0);
    visuals.sync([ASSEMBLY], entities(3));
    const root = scene.getObjectByName('varkhul-worldfire-42') as THREE.Group;
    expect(root.userData).toMatchObject({ stage: 6, safeRadius: 0, full: true });
    expect(root.getObjectByName('varkhul-worldfire-safe-edge')?.visible).toBe(false);
    expect(root.getObjectByName('varkhul-worldfire-boundary-wall')).toBeUndefined();
    const field = root.getObjectByName('varkhul-worldfire-field') as THREE.Group;
    const disc = field.getObjectByName('ground_fire_aoe__disc') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >;
    expect(disc.material.uniforms.uInnerRadiusRatio.value).toBe(0);
    expect(field.userData.innerRadius).toBe(0);
    const flames = field.getObjectByName('ground_fire_aoe__flames') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >;
    expect(flames).toBeInstanceOf(THREE.Mesh);
    expect(flames.material.uniforms.uOuterRadiusRatio.value).toBe(0.97);
    expect(root.getObjectByName('varkhul-worldfire-countdown')?.userData.seconds).toBe(0);
    expect(visibleMeshCount(root)).toBeLessThanOrEqual(4);
    expect(root.getObjectByName('smoke')).toBeUndefined();
    visuals.sync([ASSEMBLY], entities(0.05));
    expect(scene.getObjectByName('varkhul-worldfire-42')).toBe(root);
    expect(root.userData).toMatchObject({ stage: 6, safeRadius: 0, full: true });
    visuals.sync([ASSEMBLY], entities(Number.POSITIVE_INFINITY, true));
    expect(scene.getObjectByName('varkhul-worldfire-42')).toBe(root);
    expect(root.userData).toMatchObject({ stage: 6, safeRadius: 0, full: true });
    expect(field.visible).toBe(true);
    expect(root.getObjectByName('varkhul-worldfire-safe-edge')?.visible).toBe(false);
    visuals.dispose();
  });

  it('reconstructs a permanent final field cold and removes it when reset drops only the aura', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulWorldfireVisuals(scene, () => 0);
    visuals.sync([ASSEMBLY], entities(Number.POSITIVE_INFINITY, true));

    const root = scene.getObjectByName('varkhul-worldfire-42') as THREE.Group;
    expect(root.userData).toMatchObject({ stage: 6, safeRadius: 0, full: true });
    const field = root.getObjectByName('varkhul-worldfire-field') as THREE.Group;
    const disc = field.getObjectByName('ground_fire_aoe__disc') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >;
    const flames = field.getObjectByName('ground_fire_aoe__flames') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >;
    expect(disc.material.uniforms.uInnerRadiusRatio.value).toBe(0);
    expect(flames.material.uniforms.uInnerRadiusRatio.value).toBe(0);
    expect(field.visible).toBe(true);
    expect(root.getObjectByName('varkhul-worldfire-safe-edge')?.visible).toBe(false);

    visuals.sync([ASSEMBLY], new Map([[42, { auras: [] }]]));
    expect(scene.getObjectByName('varkhul-worldfire-42')).toBeUndefined();
    visuals.dispose();
  });

  it('keeps every actionable surface under reduced motion and cleans stale state', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulWorldfireVisuals(scene, () => 0);
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose');
    const textureDispose = vi.spyOn(THREE.Texture.prototype, 'dispose');
    visuals.sync([ASSEMBLY], entities(24));
    const root = scene.getObjectByName('varkhul-worldfire-42') as THREE.Group;
    const field = root.getObjectByName('varkhul-worldfire-field') as THREE.Group;
    const disc = field.getObjectByName('ground_fire_aoe__disc') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >;
    const initialTime = disc.material.uniforms.uTime.value;
    visuals.update(0.5, false);
    expect(disc.material.uniforms.uTime.value).toBeGreaterThan(initialTime);
    visuals.update(0.5, true);
    const firstFlame = disc.material.uniforms.uFlame.value;
    const frozenTime = disc.material.uniforms.uTime.value;
    visuals.update(0.5, true);
    expect(disc.material.uniforms.uFlame.value).toBe(firstFlame);
    expect(disc.material.uniforms.uTime.value).toBe(frozenTime);
    expect(field.visible).toBe(true);
    expect(root.getObjectByName('varkhul-worldfire-safe-edge')?.visible).toBe(true);
    expect(root.getObjectByName('varkhul-worldfire-boundary-wall')).toBeUndefined();
    expect(field.getObjectByName('ground_fire_aoe__disc')?.visible).toBe(true);
    expect(field.getObjectByName('ground_fire_aoe__flames')?.visible).toBe(true);
    expect(root.getObjectByName('varkhul-worldfire-countdown')?.visible).toBe(true);

    visuals.sync([], new Map());
    expect(scene.children).toHaveLength(0);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledTimes(4);
    expect(textureDispose).toHaveBeenCalledOnce();
    geometryDispose.mockRestore();
    materialDispose.mockRestore();
    textureDispose.mockRestore();
    visuals.dispose();
  });

  it('stays absent on Normal and whenever the authoritative aura is missing', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulWorldfireVisuals(scene, () => 0);
    visuals.sync([{ ...ASSEMBLY, difficulty: 'normal' }], entities(38));
    expect(scene.children).toHaveLength(0);
    visuals.sync([ASSEMBLY], new Map([[42, { auras: [] }]]));
    expect(scene.children).toHaveLength(0);
    visuals.dispose();
  });

  it('prewarms the complete full-room material family', () => {
    const root = buildVarkhulWorldfirePrewarmVisual();
    expect(root.name).toBe('varkhul-worldfire-prewarm');
    expect(root.getObjectByName('varkhul-worldfire-field')?.visible).toBe(true);
    expect(
      root.getObjectByName('varkhul-worldfire-field')?.getObjectByName('ground_fire_aoe__flames'),
    ).toBeInstanceOf(THREE.Mesh);
    expect(root.getObjectByName('varkhul-worldfire-safe-edge')?.visible).toBe(true);
    expect(root.getObjectByName('varkhul-worldfire-boundary-wall')).toBeUndefined();
  });
});
