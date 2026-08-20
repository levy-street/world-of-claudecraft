import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AbilityVfx, type AbilityVfxFx } from '../src/render/ability_vfx';
import {
  abilityVfxFullSpecFor,
  abilityVfxSpecFor,
} from '../src/render/ability_vfx/encounter_specs';
import { IGNIVAR_BRAND_FILL_NAME } from '../src/render/ignivar_brand_telegraph';
import {
  buildIgnivarBrandCircle,
  buildIgnivarFrontalTelegraph,
  buildIgnivarRotatingRaysTelegraph,
  buildIgnivarSkyfireTelegraph,
  buildIgnivarSoakCircle,
  disposeIgnivarEncounterVisuals,
  hasVisibleIgnivarEncounterTelegraph,
  IGNIVAR_BRAND_VISUAL_NAME,
  IGNIVAR_FRONTAL_VISUAL_NAME,
  IGNIVAR_ROTATING_RAYS_VISUAL_NAME,
  IGNIVAR_SKYFIRE_VISUAL_NAME,
  IGNIVAR_SOAK_VISUAL_NAME,
  syncIgnivarEncounterVisuals,
} from '../src/render/ignivar_encounter';
import {
  ignivarEncounterBypassesCharacterCulling,
  ignivarEncounterViewVisibleDuringCompile,
  ignivarEncounterVisualPlan,
} from '../src/render/ignivar_encounter_core';
import {
  IGNIVAR_FIRE_BEAM_CORE_NAME,
  IGNIVAR_FIRE_BEAM_EMBERS_NAME,
  IGNIVAR_FIRE_BEAM_FLAMES_NAME,
  IGNIVAR_FIRE_BEAM_FLOOR_GLOW_NAME,
  IGNIVAR_FIRE_BEAM_OUTER_NAME,
  IGNIVAR_FIRE_BEAM_VEIL_NAME,
} from '../src/render/ignivar_fire_beams';
import {
  IGNIVAR_JUDGMENT_SHELTERS_NAME,
  IGNIVAR_JUDGMENT_VISUAL_NAME,
} from '../src/render/ignivar_forge_judgment';
import {
  buildIgnivarForgeWaveVisual,
  IGNIVAR_FORGE_WAVE_PREVIEW_NAME,
  IGNIVAR_FORGE_WAVE_SAFE_LANES_NAME,
  IGNIVAR_FORGE_WAVE_VISUAL_NAME,
  IGNIVAR_FORGE_WAVE_WALL_NAME,
} from '../src/render/ignivar_forge_wave';
import { IGNIVAR_FRONTAL_FILL_NAME } from '../src/render/ignivar_frontal_telegraph';
import {
  attachIgnivarModelVfx,
  IGNIVAR_CHEST_FIRE_NAME,
  IGNIVAR_SHOULDER_FIRE_LEFT_NAME,
  IGNIVAR_SHOULDER_FIRE_RIGHT_NAME,
} from '../src/render/ignivar_model_vfx';
import {
  IGNIVAR_ROTATING_RAY_BORDER_NAME,
  IGNIVAR_ROTATING_RAY_FILL_NAME,
  IGNIVAR_ROTATING_RAY_TICKS_NAME,
} from '../src/render/ignivar_rotating_rays';
import {
  IGNIVAR_SOAK_FLAME_NAME,
  IGNIVAR_SOAK_READY_NAME,
} from '../src/render/ignivar_soak_telegraph';
import type { Vfx } from '../src/render/vfx';
import {
  IGNIVAR_BRAND_AURA_ID,
  IGNIVAR_BRAND_RADIUS,
  IGNIVAR_FORGE_WAVE_CAST_ID,
  IGNIVAR_FRONTAL_CAST_ID,
  IGNIVAR_JUDGMENT_CAST_ID,
  IGNIVAR_LAST_INFERNO_AURA_ID,
  IGNIVAR_ROTATING_RAYS_ACTIVE_SECONDS,
  IGNIVAR_ROTATING_RAYS_CAST_ID,
  IGNIVAR_SKYFIRE_CAST_ID,
  IGNIVAR_SOAK_AURA_ID,
  IGNIVAR_SOAK_RADIUS,
} from '../src/sim/encounters/ignivar';
import {
  IGNIVAR_ROTATING_RAYS_HALF_WIDTH,
  IGNIVAR_ROTATING_RAYS_INNER_RANGE,
  IGNIVAR_ROTATING_RAYS_RANGE,
} from '../src/sim/ignivar_arena';
import { IGNIVAR_FORGE_CHAINS_AURA_ID } from '../src/sim/ignivar_forge_chains';
import {
  ignivarForgeLayoutFacing,
  ignivarForgeShelterOffsets,
} from '../src/sim/ignivar_forge_judgment';
import { IGNIVAR_BOSS_ID } from '../src/sim/types';
import { DICT, localizeSimAuraName, localizeSimText } from '../src/ui/sim_i18n';

function expectAuthoredFireBeamInside(
  beam: THREE.Object3D,
  options: { innerRange: number; range: number; startHalfWidth: number; endHalfWidth: number },
): void {
  const expectPointInside = (x: number, z: number) => {
    expect(z).toBeGreaterThanOrEqual(options.innerRange - 1e-6);
    expect(z).toBeLessThanOrEqual(options.range + 1e-6);
    const progress = (z - options.innerRange) / (options.range - options.innerRange);
    const allowed = THREE.MathUtils.lerp(options.startHalfWidth, options.endHalfWidth, progress);
    expect(Math.abs(x)).toBeLessThanOrEqual(allowed + 1e-6);
  };
  for (const name of [
    IGNIVAR_FIRE_BEAM_OUTER_NAME,
    IGNIVAR_FIRE_BEAM_CORE_NAME,
    IGNIVAR_FIRE_BEAM_FLOOR_GLOW_NAME,
    IGNIVAR_FIRE_BEAM_VEIL_NAME,
  ]) {
    const mesh = beam.getObjectByName(name) as THREE.Mesh;
    const positions = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < positions.count; index++) {
      expectPointInside(positions.getX(index), positions.getZ(index));
    }
  }
  const flames = beam.getObjectByName(IGNIVAR_FIRE_BEAM_FLAMES_NAME) as THREE.InstancedMesh;
  const flamePositions = flames.geometry.getAttribute('position') as THREE.BufferAttribute;
  const matrix = new THREE.Matrix4();
  const point = new THREE.Vector3();
  for (let instance = 0; instance < flames.count; instance++) {
    flames.getMatrixAt(instance, matrix);
    for (let vertex = 0; vertex < flamePositions.count; vertex++) {
      point.fromBufferAttribute(flamePositions, vertex).applyMatrix4(matrix);
      expectPointInside(point.x, point.z);
    }
  }
  const embers = beam.getObjectByName(IGNIVAR_FIRE_BEAM_EMBERS_NAME) as THREE.Points;
  const emberPositions = embers.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < emberPositions.count; index++) {
    expectPointInside(emberPositions.getX(index), emberPositions.getZ(index));
  }
}

function expectFloorLayerInsideRotatingRay(layer: THREE.Object3D): void {
  layer.traverse((child) => {
    const geometry = (child as THREE.Mesh).geometry;
    if (!geometry) return;
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < positions.count; index++) {
      expect(positions.getZ(index)).toBeGreaterThanOrEqual(
        IGNIVAR_ROTATING_RAYS_INNER_RANGE - 1e-6,
      );
      expect(positions.getZ(index)).toBeLessThanOrEqual(IGNIVAR_ROTATING_RAYS_RANGE + 1e-6);
      expect(Math.abs(positions.getX(index))).toBeLessThanOrEqual(
        IGNIVAR_ROTATING_RAYS_HALF_WIDTH + 1e-6,
      );
    }
  });
}

describe('Ignivar encounter renderer', () => {
  it('attaches animated forge fire and budgeted light to the HIFI model sockets', () => {
    const model = new THREE.Group();
    for (const [name, position] of [
      ['Socket_ChestCore', [0.19, 0.66, 0]],
      ['Socket_ShoulderLeft', [0.05, 0.82, -0.26]],
      ['Socket_ShoulderRight', [0.05, 0.82, 0.26]],
    ] as const) {
      const socket = new THREE.Group();
      socket.name = name;
      socket.position.set(position[0], position[1], position[2]);
      model.add(socket);
    }

    expect(attachIgnivarModelVfx(model)).toBe(true);
    expect(attachIgnivarModelVfx(model)).toBe(false);
    for (const name of [
      IGNIVAR_CHEST_FIRE_NAME,
      IGNIVAR_SHOULDER_FIRE_LEFT_NAME,
      IGNIVAR_SHOULDER_FIRE_RIGHT_NAME,
    ]) {
      expect(model.getObjectByName(name)).toBeDefined();
    }
    const lights: THREE.PointLight[] = [];
    const flameMaterials: THREE.ShaderMaterial[] = [];
    model.traverse((object) => {
      if ((object as THREE.PointLight).isPointLight) lights.push(object as THREE.PointLight);
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && (mesh.material as THREE.ShaderMaterial).isShaderMaterial) {
        flameMaterials.push(mesh.material as THREE.ShaderMaterial);
      }
    });
    expect(lights).toHaveLength(3);
    expect(flameMaterials.length).toBeGreaterThanOrEqual(4);
    expect(flameMaterials.every((material) => material.blending === THREE.AdditiveBlending)).toBe(
      true,
    );

    model.updateMatrixWorld(true);
    const campfireEmber = vi.fn();
    syncIgnivarEncounterVisuals(
      model,
      {
        kind: 'mob',
        templateId: IGNIVAR_BOSS_ID,
        castingAbility: null,
        castRemaining: 0,
        castTotal: 0,
        channeling: false,
        auras: [],
        scale: 3.4,
      },
      0.2,
      { campfireEmber, syncIgnivarJudgmentGroundFire: vi.fn() } as unknown as Vfx,
    );
    expect(campfireEmber).toHaveBeenCalledTimes(2);
    expect(model.userData.ignivarModelVfxTime).toBeCloseTo(0.2);
    expect(flameMaterials.some((material) => material.uniforms.uTime.value > 0)).toBe(true);

    syncIgnivarEncounterVisuals(
      model,
      {
        kind: 'mob',
        templateId: IGNIVAR_BOSS_ID,
        castingAbility: IGNIVAR_FRONTAL_CAST_ID,
        auras: [],
        scale: 3.4,
      },
      0.2,
      { campfireEmber, syncIgnivarJudgmentGroundFire: vi.fn() } as unknown as Vfx,
      undefined,
      false,
    );
    expect(campfireEmber).toHaveBeenCalledTimes(2);
    expect(model.userData.ignivarModelVfxTime).toBeCloseTo(0.2);
    expect(model.getObjectByName(IGNIVAR_FRONTAL_VISUAL_NAME)?.visible).toBe(true);
    expect(hasVisibleIgnivarEncounterTelegraph(model)).toBe(true);

    disposeIgnivarEncounterVisuals(model);
    expect(model.getObjectByName(IGNIVAR_CHEST_FIRE_NAME)).toBeUndefined();
    expect(model.getObjectByName(IGNIVAR_SHOULDER_FIRE_LEFT_NAME)).toBeUndefined();
    expect(model.getObjectByName(IGNIVAR_SHOULDER_FIRE_RIGHT_NAME)).toBeUndefined();
  });

  it('authors Searing Torrent as a heavy fire vortex and directional ground rupture', () => {
    expect(abilityVfxSpecFor(IGNIVAR_FRONTAL_CAST_ID)).toMatchObject({
      p: 'fire',
      pw: 1.6,
      sp: 60,
      a: 'burst',
    });
    expect(abilityVfxFullSpecFor(IGNIVAR_FRONTAL_CAST_ID)).toMatchObject({
      archetype: 'burst',
      palette: 'fire',
      power: 1.6,
      windupStyle: 'vortex',
      motifs: ['fissure', 'pillars'],
      motifAt: 'target',
      burst: { style: 'ground' },
      impact: {
        flipbook: true,
        ring: false,
        vRing: true,
        sparks: 60,
        smoke: true,
        light: 3.2,
      },
      screenFx: true,
    });
    expect(abilityVfxSpecFor(IGNIVAR_FRONTAL_CAST_ID)?.rg).toBe(0);
    expect(abilityVfxFullSpecFor(IGNIVAR_FRONTAL_CAST_ID)?.decal).toBeUndefined();
    expect(abilityVfxFullSpecFor(IGNIVAR_FRONTAL_CAST_ID)?.linger).toBeUndefined();
    expect(abilityVfxSpecFor('heroic_strike')).toBeDefined();
  });

  it('authors Rain of Cinders as three powerful fire eruptions without damage rings', () => {
    expect(abilityVfxSpecFor(IGNIVAR_SKYFIRE_CAST_ID)).toMatchObject({
      p: 'fire',
      pw: 1.75,
      sp: 54,
      rg: 0,
      a: 'burst',
    });
    expect(abilityVfxFullSpecFor(IGNIVAR_SKYFIRE_CAST_ID)).toMatchObject({
      archetype: 'burst',
      palette: 'fire',
      power: 1.75,
      windupStyle: 'vortex',
      motifs: ['fissure', 'pillars'],
      motifAt: 'target',
      impact: {
        flipbook: true,
        ring: false,
        vRing: true,
        sparks: 54,
        smoke: true,
        light: 3.4,
      },
      screenFx: true,
    });
    expect(abilityVfxFullSpecFor(IGNIVAR_SKYFIRE_CAST_ID)?.decal).toBeUndefined();
    expect(abilityVfxFullSpecFor(IGNIVAR_SKYFIRE_CAST_ID)?.linger).toBeUndefined();
  });

  it('keeps every cast windup without tinting Ignivar or changing other casters', () => {
    const windup = vi.fn().mockReturnValue(true);
    const bodyGlow = vi.fn();
    const fx = {
      setDelegates: vi.fn(),
      windup,
      bodyGlow,
      orbit: vi.fn().mockReturnValue(false),
    } as unknown as AbilityVfxFx;
    const painter = new AbilityVfx(
      {
        fx,
        vfx: {
          projectile: vi.fn(),
          lightningProjectile: vi.fn(),
          burst: vi.fn(),
          nova: vi.fn(),
          tick: vi.fn(),
          shoutwave: vi.fn(),
          buffSwirl: vi.fn(),
          beam: vi.fn(),
        },
        anchor: vi.fn(),
        spawnAoeRing: vi.fn(),
        triggerAttack: vi.fn(),
      },
      () => 1,
    );

    for (const [index, castingAbility] of [
      IGNIVAR_FRONTAL_CAST_ID,
      IGNIVAR_SKYFIRE_CAST_ID,
      IGNIVAR_FORGE_WAVE_CAST_ID,
      IGNIVAR_JUDGMENT_CAST_ID,
    ].entries()) {
      painter.syncEntity({
        id: 77 + index,
        templateId: IGNIVAR_BOSS_ID,
        castingAbility,
        castRemaining: 1.5,
        castTotal: 3,
        auras: index === 0 ? [{ id: IGNIVAR_LAST_INFERNO_AURA_ID }] : [],
        kind: 'mob',
      });
    }

    expect(windup).toHaveBeenNthCalledWith(
      1,
      77,
      0xff4a12,
      0.5,
      'vortex',
      false,
      expect.any(Number),
      expect.any(Number),
    );
    expect(windup).toHaveBeenCalledTimes(4);
    expect(bodyGlow).not.toHaveBeenCalled();

    painter.syncEntity({
      id: 81,
      templateId: 'other_boss',
      castingAbility: 'fireball',
      castRemaining: 1.5,
      castTotal: 3,
      auras: [],
      kind: 'mob',
    });

    expect(bodyGlow).toHaveBeenCalledTimes(1);

    painter.syncEntity({
      id: 82,
      templateId: IGNIVAR_BOSS_ID,
      castingAbility: null,
      castRemaining: 0,
      castTotal: 0,
      auras: [{ id: IGNIVAR_LAST_INFERNO_AURA_ID }],
      kind: 'mob',
    });

    expect(bodyGlow).toHaveBeenCalledTimes(2);
    expect(bodyGlow).toHaveBeenLastCalledWith(82, expect.any(Number), expect.any(Number), false);
  });

  it('authors Forge Wave as a powerful fire release without closing its safe gaps', () => {
    expect(abilityVfxSpecFor(IGNIVAR_FORGE_WAVE_CAST_ID)).toMatchObject({
      c: '#ff6a14',
      p: 'fire',
      pw: 1.8,
      sp: 60,
      rg: 0,
      sm: 1,
      li: 3.8,
      a: 'burst',
    });
    expect(abilityVfxFullSpecFor(IGNIVAR_FORGE_WAVE_CAST_ID)).toMatchObject({
      archetype: 'burst',
      palette: 'fire',
      power: 1.8,
      windupStyle: 'vortex',
      motifs: ['pillars'],
      motifAt: 'caster',
      impact: {
        flipbook: true,
        ring: false,
        vRing: true,
        sparks: 60,
        smoke: true,
        light: 3.8,
      },
      screenFx: true,
    });
    expect(abilityVfxFullSpecFor(IGNIVAR_FORGE_WAVE_CAST_ID)?.decal).toBeUndefined();
    expect(abilityVfxFullSpecFor(IGNIVAR_FORGE_WAVE_CAST_ID)?.linger).toBeUndefined();
  });

  it('routes the Forge Wave release through the heavy point VFX sequencer', () => {
    const sequenceInstantAt = vi.fn();
    const fx = {
      setDelegates: vi.fn(),
      groundYAt: vi.fn().mockReturnValue(0),
      sequenceInstantAt,
    } as unknown as AbilityVfxFx;
    const painter = new AbilityVfx(
      {
        fx,
        vfx: {
          projectile: vi.fn(),
          lightningProjectile: vi.fn(),
          burst: vi.fn(),
          nova: vi.fn(),
          tick: vi.fn(),
          shoutwave: vi.fn(),
          buffSwirl: vi.fn(),
          beam: vi.fn(),
        },
        anchor: vi.fn().mockReturnValue({ x: 4, y: 1, z: 8 }),
        spawnAoeRing: vi.fn(),
        triggerAttack: vi.fn(),
      },
      () => 1,
    );

    expect(
      painter.handleSpellfxAt({
        x: 4,
        z: 8,
        school: 'fire',
        fx: 'burst',
        ability: IGNIVAR_FORGE_WAVE_CAST_ID,
        sourceId: 77,
      }),
    ).toBe(true);
    expect(sequenceInstantAt).toHaveBeenCalledWith(
      IGNIVAR_FORGE_WAVE_CAST_ID,
      abilityVfxFullSpecFor(IGNIVAR_FORGE_WAVE_CAST_ID),
      77,
      4,
      8,
      0xff6a14,
      0,
      0,
    );
  });

  it('routes the frontal release through the heavy point-anchored VFX sequencer', () => {
    const sequenceInstantAt = vi.fn();
    const fx = {
      setDelegates: vi.fn(),
      groundYAt: vi.fn().mockReturnValue(0),
      sequenceInstantAt,
    } as unknown as AbilityVfxFx;
    const painter = new AbilityVfx(
      {
        fx,
        vfx: {
          projectile: vi.fn(),
          lightningProjectile: vi.fn(),
          burst: vi.fn(),
          nova: vi.fn(),
          tick: vi.fn(),
          shoutwave: vi.fn(),
          buffSwirl: vi.fn(),
          beam: vi.fn(),
        },
        anchor: vi.fn().mockReturnValue({ x: 0, y: 1, z: 0 }),
        spawnAoeRing: vi.fn(),
        triggerAttack: vi.fn(),
      },
      () => 1,
    );

    expect(
      painter.handleSpellfxAt({
        x: 12,
        z: 24,
        school: 'fire',
        fx: 'burst',
        ability: IGNIVAR_FRONTAL_CAST_ID,
        sourceId: 77,
      }),
    ).toBe(true);
    expect(sequenceInstantAt).toHaveBeenCalledWith(
      IGNIVAR_FRONTAL_CAST_ID,
      abilityVfxFullSpecFor(IGNIVAR_FRONTAL_CAST_ID),
      77,
      12,
      24,
      0xff4a12,
      0,
      0,
    );
  });

  it('runs all three spatially distinct skyfire eruptions through the heavy VFX sequencer', () => {
    const sequenceInstantAt = vi.fn();
    const fx = {
      setDelegates: vi.fn(),
      groundYAt: vi.fn().mockReturnValue(0),
      sequenceInstantAt,
      ringAt: vi.fn(),
      burstAt: vi.fn(),
    } as unknown as AbilityVfxFx;
    const painter = new AbilityVfx(
      {
        fx,
        vfx: {
          projectile: vi.fn(),
          lightningProjectile: vi.fn(),
          burst: vi.fn(),
          nova: vi.fn(),
          tick: vi.fn(),
          shoutwave: vi.fn(),
          buffSwirl: vi.fn(),
          beam: vi.fn(),
        },
        anchor: vi.fn().mockReturnValue({ x: 0, y: 1, z: 0 }),
        spawnAoeRing: vi.fn(),
        triggerAttack: vi.fn(),
      },
      () => 1,
    );
    const eruptionPoints = [
      { x: 0, z: 24 },
      { x: 20.784, z: -12 },
      { x: -20.784, z: -12 },
    ];

    for (const point of eruptionPoints) {
      expect(
        painter.handleSpellfxAt({
          ...point,
          school: 'fire',
          fx: 'burst',
          ability: IGNIVAR_SKYFIRE_CAST_ID,
          sourceId: 77,
        }),
      ).toBe(true);
    }

    expect(sequenceInstantAt).toHaveBeenCalledTimes(3);
    expect(sequenceInstantAt.mock.calls.map((call) => [call[3], call[4]])).toEqual(
      eruptionPoints.map(({ x, z }) => [x, z]),
    );

    painter.handleSpellfxAt({
      ...eruptionPoints[0],
      school: 'fire',
      fx: 'burst',
      ability: IGNIVAR_SKYFIRE_CAST_ID,
      sourceId: 77,
    });
    expect(sequenceInstantAt).toHaveBeenCalledTimes(3);
  });

  it('builds explicit cone and personal-space telegraphs', () => {
    expect(buildIgnivarFrontalTelegraph().name).toBe(IGNIVAR_FRONTAL_VISUAL_NAME);
    expect(buildIgnivarFrontalTelegraph().children).toHaveLength(4);
    expect(buildIgnivarBrandCircle().name).toBe(IGNIVAR_BRAND_VISUAL_NAME);
    expect(buildIgnivarBrandCircle().children).toHaveLength(5);
    const skyfire = buildIgnivarSkyfireTelegraph();
    expect(skyfire.name).toBe(IGNIVAR_SKYFIRE_VISUAL_NAME);
    expect(skyfire.children).toHaveLength(6);
    expect(skyfire.getObjectByName(IGNIVAR_FIRE_BEAM_OUTER_NAME)).toBeUndefined();
    const rays = buildIgnivarRotatingRaysTelegraph();
    expect(rays.name).toBe(IGNIVAR_ROTATING_RAYS_VISUAL_NAME);
    expect(rays.children).toHaveLength(12);
    for (let ray = 0; ray < 3; ray++) {
      const expectedRotation = (ray * Math.PI * 2) / 3;
      const rayVisuals = rays.children.filter((visual) => visual.userData.rayIndex === ray);
      expect(rayVisuals).toHaveLength(4);
      for (const visual of rayVisuals) {
        expect(visual.rotation.y).toBeCloseTo(expectedRotation, 8);
        expect(visual.userData.rayIndex).toBe(ray);
      }
      const fill = rayVisuals.find(
        (visual) => visual.name === IGNIVAR_ROTATING_RAY_FILL_NAME,
      ) as THREE.Mesh;
      const border = rayVisuals.find(
        (visual) => visual.name === IGNIVAR_ROTATING_RAY_BORDER_NAME,
      ) as THREE.Mesh;
      const heatTicks = rayVisuals.find(
        (visual) => visual.name === IGNIVAR_ROTATING_RAY_TICKS_NAME,
      ) as THREE.Group;
      const fireBeam = rayVisuals.find(
        (visual) => visual.userData.vfxLayer === 'fireBeam',
      ) as THREE.Group;
      expect(fill).toBeDefined();
      expect(border).toBeDefined();
      expect(heatTicks).toBeDefined();
      expect(fireBeam).toBeDefined();
      expectFloorLayerInsideRotatingRay(fill);
      expectFloorLayerInsideRotatingRay(border);
      expectFloorLayerInsideRotatingRay(heatTicks);
      expect(heatTicks.userData.telegraphLayer).toBe('heatTicks');
      expect(heatTicks.userData.visibleTickCount).toBe(10);
      expect(heatTicks.children).toHaveLength(1);
      const batchedTicks = heatTicks.children[0] as THREE.Mesh<THREE.BufferGeometry>;
      expect(batchedTicks.userData.visibleTickCount).toBe(10);
      expect(batchedTicks.geometry.getAttribute('position').count).toBe(40);
      expect(batchedTicks.geometry.getAttribute('color').count).toBe(40);
      expect((batchedTicks.material as THREE.MeshBasicMaterial).vertexColors).toBe(true);
      expect(fireBeam?.getObjectByName(IGNIVAR_FIRE_BEAM_OUTER_NAME)).toBeDefined();
      expectAuthoredFireBeamInside(fireBeam, {
        innerRange: IGNIVAR_ROTATING_RAYS_INNER_RANGE,
        range: IGNIVAR_ROTATING_RAYS_RANGE,
        startHalfWidth: IGNIVAR_ROTATING_RAYS_HALF_WIDTH,
        endHalfWidth: IGNIVAR_ROTATING_RAYS_HALF_WIDTH,
      });
    }
    expect(buildIgnivarSoakCircle().name).toBe(IGNIVAR_SOAK_VISUAL_NAME);
    expect(buildIgnivarSoakCircle().children).toHaveLength(9);
  });

  it('derives the rotating-ray warning and active wall from the authoritative cast clock', () => {
    expect(
      ignivarEncounterVisualPlan({
        kind: 'mob',
        templateId: IGNIVAR_BOSS_ID,
        castingAbility: IGNIVAR_ROTATING_RAYS_CAST_ID,
        castRemaining: 10,
        castTotal: 10,
        channeling: true,
        auras: [],
      }),
    ).toMatchObject({ rotatingRaysPhase: 'windup', rotatingRaysWindupProgress: 0 });

    expect(
      ignivarEncounterVisualPlan({
        kind: 'mob',
        templateId: IGNIVAR_BOSS_ID,
        castingAbility: IGNIVAR_ROTATING_RAYS_CAST_ID,
        castRemaining: 9,
        castTotal: 10,
        channeling: true,
        auras: [],
      }),
    ).toMatchObject({
      rotatingRaysVisible: true,
      rotatingRaysPhase: 'windup',
      rotatingRaysWindupProgress: 0.5,
    });

    expect(
      ignivarEncounterVisualPlan({
        kind: 'mob',
        templateId: IGNIVAR_BOSS_ID,
        castingAbility: IGNIVAR_ROTATING_RAYS_CAST_ID,
        castRemaining: 6,
        castTotal: 10,
        channeling: true,
        auras: [],
      }),
    ).toMatchObject({
      rotatingRaysVisible: true,
      rotatingRaysPhase: 'active',
      rotatingRaysWindupProgress: 1,
    });

    const almostActive = ignivarEncounterVisualPlan({
      kind: 'mob',
      templateId: IGNIVAR_BOSS_ID,
      castingAbility: IGNIVAR_ROTATING_RAYS_CAST_ID,
      castRemaining: IGNIVAR_ROTATING_RAYS_ACTIVE_SECONDS + 0.0001,
      castTotal: 10,
      channeling: true,
      auras: [],
    });
    expect(almostActive.rotatingRaysPhase).toBe('windup');
    expect(almostActive.rotatingRaysWindupProgress).toBeGreaterThan(0.999);
    expect(almostActive.rotatingRaysWindupProgress).toBeLessThan(1);
    expect(
      ignivarEncounterVisualPlan({
        kind: 'mob',
        templateId: IGNIVAR_BOSS_ID,
        castingAbility: IGNIVAR_ROTATING_RAYS_CAST_ID,
        castRemaining: IGNIVAR_ROTATING_RAYS_ACTIVE_SECONDS,
        castTotal: 10,
        channeling: true,
        auras: [],
      }).rotatingRaysPhase,
    ).toBe('active');

    expect(
      ignivarEncounterVisualPlan({
        kind: 'mob',
        templateId: 'fire_elemental',
        castingAbility: IGNIVAR_ROTATING_RAYS_CAST_ID,
        castRemaining: 6,
        castTotal: 10,
        channeling: true,
        auras: [],
      }),
    ).toMatchObject({ rotatingRaysVisible: false, rotatingRaysPhase: 'hidden' });
  });

  it('builds a powerful expanding wall with exactly two readable safe gaps', () => {
    const wave = buildIgnivarForgeWaveVisual();
    expect(wave.name).toBe(IGNIVAR_FORGE_WAVE_VISUAL_NAME);
    expect(wave.userData.safeGapCount).toBe(2);
    const preview = wave.getObjectByName(IGNIVAR_FORGE_WAVE_PREVIEW_NAME);
    const safeLanes = wave.getObjectByName(IGNIVAR_FORGE_WAVE_SAFE_LANES_NAME);
    const wall = wave.getObjectByName(IGNIVAR_FORGE_WAVE_WALL_NAME);
    expect(preview).toBeDefined();
    expect(safeLanes?.children).toHaveLength(2);
    expect(safeLanes?.children[0]?.rotation.y).toBe(0);
    expect(safeLanes?.children[1]?.rotation.y).toBe(Math.PI);
    const flame = wall?.children[0] as THREE.Mesh;
    const positions = flame.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(positions.count / 6).toBe(80);
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const angle = Math.atan2(positions.getX(vertex), positions.getZ(vertex));
      const fromForward = Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle)));
      const fromBackward = Math.abs(
        Math.atan2(Math.sin(angle - Math.PI), Math.cos(angle - Math.PI)),
      );
      expect(Math.min(fromForward, fromBackward)).toBeGreaterThanOrEqual(Math.PI / 12 - 1e-6);
    }
    expect(wall?.children.length).toBeGreaterThanOrEqual(4);
  });

  it('derives Forge Wave windup and expansion from the authoritative cast state', () => {
    expect(
      ignivarEncounterVisualPlan({
        kind: 'mob',
        templateId: IGNIVAR_BOSS_ID,
        castingAbility: IGNIVAR_FORGE_WAVE_CAST_ID,
        castRemaining: 1.25,
        castTotal: 2.5,
        channeling: false,
        auras: [],
      }),
    ).toMatchObject({
      forgeWavePhase: 'windup',
      forgeWaveProgress: 0.5,
      forgeWaveRadius: 0,
    });
    expect(
      ignivarEncounterVisualPlan({
        kind: 'mob',
        templateId: IGNIVAR_BOSS_ID,
        castingAbility: IGNIVAR_FORGE_WAVE_CAST_ID,
        castRemaining: 1.5,
        castTotal: 3,
        channeling: true,
        auras: [],
      }),
    ).toMatchObject({
      forgeWavePhase: 'active',
      forgeWaveProgress: 0.5,
      forgeWaveRadius: 36,
    });
  });

  it('switches Forge Wave from its safe-lane preview to the expanding fire wall', () => {
    const group = new THREE.Group();
    const boss = {
      kind: 'mob',
      templateId: IGNIVAR_BOSS_ID,
      castingAbility: IGNIVAR_FORGE_WAVE_CAST_ID as string | null,
      castRemaining: 1.25,
      castTotal: 2.5,
      channeling: false,
      auras: [],
      scale: 3.4,
    };

    syncIgnivarEncounterVisuals(group, boss);
    const wave = group.getObjectByName(IGNIVAR_FORGE_WAVE_VISUAL_NAME);
    const preview = wave?.getObjectByName(IGNIVAR_FORGE_WAVE_PREVIEW_NAME);
    const safeLanes = wave?.getObjectByName(IGNIVAR_FORGE_WAVE_SAFE_LANES_NAME);
    const wall = wave?.getObjectByName(IGNIVAR_FORGE_WAVE_WALL_NAME);
    expect(wave?.visible).toBe(true);
    expect(wave?.scale.x).toBeCloseTo(1 / 3.4);
    expect(preview?.visible).toBe(true);
    expect(safeLanes?.visible).toBe(true);
    expect(wall?.visible).toBe(false);

    boss.channeling = true;
    boss.castTotal = 3;
    boss.castRemaining = 1.5;
    syncIgnivarEncounterVisuals(group, boss);
    expect(preview?.visible).toBe(false);
    expect(safeLanes?.visible).toBe(true);
    expect(wall?.visible).toBe(true);
    expect(wall?.scale.x).toBeCloseTo(36);
    expect(wall?.scale.z).toBeCloseTo(36);

    boss.castingAbility = null;
    syncIgnivarEncounterVisuals(group, boss);
    expect(wave?.visible).toBe(false);
  });

  it('bypasses character culling while any boss-anchored raid telegraph is actionable', () => {
    for (const castingAbility of [
      IGNIVAR_FRONTAL_CAST_ID,
      IGNIVAR_SKYFIRE_CAST_ID,
      IGNIVAR_ROTATING_RAYS_CAST_ID,
      IGNIVAR_FORGE_WAVE_CAST_ID,
      IGNIVAR_JUDGMENT_CAST_ID,
    ]) {
      expect(
        ignivarEncounterBypassesCharacterCulling({
          kind: 'mob',
          templateId: IGNIVAR_BOSS_ID,
          castingAbility,
          auras: [],
        }),
      ).toBe(true);
    }
    expect(
      ignivarEncounterBypassesCharacterCulling({
        kind: 'mob',
        templateId: 'another_boss',
        castingAbility: IGNIVAR_FRONTAL_CAST_ID,
        auras: [],
      }),
    ).toBe(false);
    for (const auraId of [IGNIVAR_BRAND_AURA_ID, IGNIVAR_SOAK_AURA_ID]) {
      expect(
        ignivarEncounterBypassesCharacterCulling({
          kind: 'player',
          templateId: 'player_priest',
          castingAbility: null,
          auras: [{ id: auraId }],
        }),
      ).toBe(true);
    }
    expect(
      ignivarEncounterBypassesCharacterCulling({
        kind: 'mob',
        templateId: IGNIVAR_BOSS_ID,
        castingAbility: null,
        auras: [],
      }),
    ).toBe(false);
    expect(
      ignivarEncounterBypassesCharacterCulling({
        kind: 'player',
        templateId: 'player_priest',
        castingAbility: null,
        auras: [{ id: IGNIVAR_FORGE_CHAINS_AURA_ID }],
      }),
    ).toBe(true);
    expect(
      ignivarEncounterBypassesCharacterCulling({
        kind: 'player',
        templateId: 'player_priest',
        castingAbility: null,
        auras: [],
      }),
    ).toBe(false);
  });

  it('registers localized player-facing names for both mechanics', () => {
    expect(localizeSimAuraName('Brand of the Pyre')).not.toBeNull();
    expect(localizeSimAuraName('Searing Torrent')).not.toBeNull();
    expect(localizeSimAuraName('Judgment of the Forge')).not.toBeNull();
    expect(DICT.es_ES['aura.ignivarBrandOfThePyre']).toBe('Marca de la Pira');
    expect(DICT.es_ES['mechanic.ignivarSearingTorrent']).toBe('Torrente abrasador');
    expect(DICT.es_ES['mechanic.ignivarApocalypse']).toBe('Apocalipsis');
    expect(DICT.es_ES['mechanic.ignivarForgeStrike']).toBe('Golpe de Fundición');
    expect(DICT.es_ES['aura.ignivarMoltenArmor']).toBe('Armadura Fundida');
    expect(DICT.es_ES['aura.ignivarLastInferno']).toBe('Último Infierno');
    expect(localizeSimAuraName('Molten Armor')).not.toBeNull();
    expect(localizeSimAuraName('Last Inferno')).not.toBeNull();
    expect(localizeSimAuraName('Shared Pyre')).not.toBeNull();
    expect(localizeSimAuraName('Chains of the Forge')).not.toBeNull();
    expect(localizeSimAuraName('Rain of Cinders')).not.toBeNull();
    expect(localizeSimAuraName('Revolving Inferno')).not.toBeNull();
    expect(DICT.es_ES['mechanic.ignivarRevolvingInferno']).toBe('Infierno giratorio');
    expect(localizeSimAuraName('Forge Wave')).not.toBeNull();
    expect(DICT.es_ES['mechanic.ignivarForgeWave']).toBe('Onda de la Forja');
    expect(DICT.es_ES['mechanic.ignivarJudgmentOfTheForge']).toBe('Juicio de la Forja');
    expect(localizeSimText('The Heart of the End awakens. Let the world burn!')).not.toBeNull();
    expect(localizeSimText('The last flame consumes all!')).not.toBeNull();
    expect(localizeSimText('The sky itself will burn!')).not.toBeNull();
    expect(localizeSimText('Four must share the pyre, or all will burn!')).not.toBeNull();
  });

  it('shows all three rotating rays only for the Revolving Inferno channel', () => {
    const group = new THREE.Group();
    const boss: {
      kind: string;
      templateId: string;
      castingAbility: string | null;
      castRemaining: number;
      castTotal: number;
      auras: { id: string }[];
      scale: number;
    } = {
      kind: 'mob',
      templateId: IGNIVAR_BOSS_ID,
      castingAbility: IGNIVAR_ROTATING_RAYS_CAST_ID,
      castRemaining: 9,
      castTotal: 10,
      auras: [],
      scale: 3.4,
    };

    syncIgnivarEncounterVisuals(group, boss);
    const rays = group.getObjectByName(IGNIVAR_ROTATING_RAYS_VISUAL_NAME);
    expect(rays?.visible).toBe(true);
    expect(rays?.scale.x).toBeCloseTo(1 / 3.4);
    const fireBeams =
      rays?.children.filter((child) => child.userData.vfxLayer === 'fireBeam') ?? [];
    expect(fireBeams).toHaveLength(3);
    expect(fireBeams.every((beam) => beam.userData.phase === 'windup')).toBe(true);
    expect(
      fireBeams.every((beam) => !beam.getObjectByName(IGNIVAR_FIRE_BEAM_CORE_NAME)?.visible),
    ).toBe(true);
    const rayFloorLayers = Array.from({ length: 3 }, (_, rayIndex) => {
      const layers = rays?.children.filter((child) => child.userData.rayIndex === rayIndex) ?? [];
      return {
        fill: layers.find((layer) => layer.name === IGNIVAR_ROTATING_RAY_FILL_NAME) as THREE.Mesh,
        border: layers.find(
          (layer) => layer.name === IGNIVAR_ROTATING_RAY_BORDER_NAME,
        ) as THREE.Mesh,
        ticks: layers.find(
          (layer) => layer.name === IGNIVAR_ROTATING_RAY_TICKS_NAME,
        ) as THREE.Group,
      };
    });
    const floorOpacities = () =>
      rayFloorLayers.map(({ fill, border, ticks }) => ({
        fill: (fill.material as THREE.Material).opacity,
        border: (border.material as THREE.Material).opacity,
        ticks: ((ticks.children[0] as THREE.Mesh).material as THREE.Material).opacity,
      }));
    const windupOpacities = floorOpacities();
    for (const opacities of windupOpacities) {
      // The warning stays readable through an exact warm border and heat ticks,
      // while the broad lane uses normal blending so three overlapping rays do
      // not wash the arena white under bloom.
      expect(opacities.fill).toBeGreaterThan(0.09);
      expect(opacities.fill).toBeLessThanOrEqual(0.13);
      expect(opacities.border).toBeGreaterThanOrEqual(0.62);
      expect(opacities.border).toBeLessThanOrEqual(0.7);
      expect(opacities.ticks).toBeGreaterThanOrEqual(0.2);
      expect(opacities.ticks).toBeLessThanOrEqual(0.26);
    }
    syncIgnivarEncounterVisuals(group, boss);
    expect(floorOpacities()).toEqual(windupOpacities);

    boss.castRemaining = 6;
    syncIgnivarEncounterVisuals(group, boss);
    expect(fireBeams.every((beam) => beam.userData.phase === 'active')).toBe(true);
    expect(
      fireBeams.every((beam) => beam.getObjectByName(IGNIVAR_FIRE_BEAM_CORE_NAME)?.visible),
    ).toBe(true);
    const activeOpacities = floorOpacities();
    for (let rayIndex = 0; rayIndex < activeOpacities.length; rayIndex++) {
      expect(activeOpacities[rayIndex].fill).toBeGreaterThan(0);
      expect(activeOpacities[rayIndex].border).toBeGreaterThan(0);
      expect(activeOpacities[rayIndex].ticks).toBeGreaterThan(0);
      expect(activeOpacities[rayIndex].fill).toBeLessThan(windupOpacities[rayIndex].fill);
      expect(activeOpacities[rayIndex].border).toBeLessThan(windupOpacities[rayIndex].border);
      expect(activeOpacities[rayIndex].ticks).toBeLessThan(windupOpacities[rayIndex].ticks);
    }
    syncIgnivarEncounterVisuals(group, boss);
    expect(floorOpacities()).toEqual(activeOpacities);

    boss.castingAbility = IGNIVAR_SKYFIRE_CAST_ID;
    syncIgnivarEncounterVisuals(group, boss);
    expect(rays?.visible).toBe(false);
    expect(group.getObjectByName(IGNIVAR_SKYFIRE_VISUAL_NAME)?.visible).toBe(true);
  });

  it('rotates the rays while keeping the boss body facing locked', () => {
    const group = new THREE.Group();
    const bodyRoot = new THREE.Group();
    group.add(bodyRoot);
    const boss: {
      kind: string;
      templateId: string;
      castingAbility: string | null;
      auras: { id: string }[];
      scale: number;
    } = {
      kind: 'mob',
      templateId: IGNIVAR_BOSS_ID,
      castingAbility: IGNIVAR_ROTATING_RAYS_CAST_ID,
      auras: [],
      scale: 3.4,
    };

    bodyRoot.rotation.y = 0.25;
    group.rotation.y = 0.7;
    syncIgnivarEncounterVisuals(group, boss, 0, undefined, bodyRoot);
    expect(bodyRoot.rotation.y).toBeCloseTo(0.25);

    group.rotation.y = 1.2;
    syncIgnivarEncounterVisuals(group, boss, 0, undefined, bodyRoot);
    expect(bodyRoot.rotation.y).toBeCloseTo(-0.25);
    expect(group.rotation.y + bodyRoot.rotation.y).toBeCloseTo(0.95);
    expect(group.getObjectByName(IGNIVAR_ROTATING_RAYS_VISUAL_NAME)?.rotation.y).toBeCloseTo(0);

    boss.castingAbility = null;
    group.rotation.y = 1.1;
    syncIgnivarEncounterVisuals(group, boss, 0, undefined, bodyRoot);
    expect(bodyRoot.rotation.y).toBeCloseTo(0.25);
    expect(group.userData.ignivarRotatingRaysBodyLock).toBeUndefined();
    expect(group.rotation.y + bodyRoot.rotation.y).toBeCloseTo(1.35);
  });

  it('shows the three skyfire cones only while Rain of Cinders is casting', () => {
    const group = new THREE.Group();
    const boss: {
      kind: string;
      templateId: string;
      castingAbility: string | null;
      auras: { id: string }[];
      scale: number;
    } = {
      kind: 'mob',
      templateId: IGNIVAR_BOSS_ID,
      castingAbility: IGNIVAR_SKYFIRE_CAST_ID,
      auras: [],
      scale: 3.4,
    };

    syncIgnivarEncounterVisuals(group, boss);
    expect(group.getObjectByName(IGNIVAR_SKYFIRE_VISUAL_NAME)?.visible).toBe(true);
    boss.castingAbility = null;
    syncIgnivarEncounterVisuals(group, boss);
    expect(group.getObjectByName(IGNIVAR_SKYFIRE_VISUAL_NAME)?.visible).toBe(false);
  });

  it('shows and clears the shared soak circle around the marked player', () => {
    const group = new THREE.Group();
    const player = {
      kind: 'player',
      templateId: 'priest',
      castingAbility: null,
      auras: [{ id: IGNIVAR_SOAK_AURA_ID }],
    };

    syncIgnivarEncounterVisuals(group, player);
    expect(group.getObjectByName(IGNIVAR_SOAK_VISUAL_NAME)?.visible).toBe(true);
    player.auras = [];
    syncIgnivarEncounterVisuals(group, player);
    expect(group.getObjectByName(IGNIVAR_SOAK_VISUAL_NAME)?.visible).toBe(false);
  });

  it('counts all living players in the Shared Pyre radius and shows readiness at four', () => {
    const group = new THREE.Group();
    const player = {
      id: 1,
      kind: 'player',
      templateId: 'priest',
      castingAbility: null,
      pos: { x: 10, z: 20 },
      auras: [{ id: IGNIVAR_SOAK_AURA_ID, remaining: 3, duration: 6 }],
    };
    const entities = new Map([
      [1, player],
      [
        2,
        {
          id: 2,
          kind: 'player',
          templateId: 'mage',
          castingAbility: null,
          pos: { x: 11, z: 20 },
          auras: [],
        },
      ],
      [
        3,
        {
          id: 3,
          kind: 'player',
          templateId: 'rogue',
          castingAbility: null,
          pos: { x: 9, z: 20 },
          auras: [],
        },
      ],
      [
        4,
        {
          id: 4,
          kind: 'player',
          templateId: 'druid',
          castingAbility: null,
          pos: { x: 10, z: 23 },
          auras: [],
        },
      ],
      [
        5,
        {
          id: 5,
          kind: 'player',
          templateId: 'warlock',
          castingAbility: null,
          pos: { x: 30, z: 30 },
          auras: [],
        },
      ],
    ]);

    syncIgnivarEncounterVisuals(group, player, 0, undefined, undefined, true, undefined, entities);
    const soak = group.getObjectByName(IGNIVAR_SOAK_VISUAL_NAME) as THREE.Group;
    expect(soak.userData.playersInside).toBe(4);
    expect(soak.userData.ready).toBe(true);
    expect(soak.userData.progress).toBe(0.5);
    expect(soak.getObjectByName(IGNIVAR_SOAK_FLAME_NAME)?.visible).toBe(false);
    expect(soak.getObjectByName(IGNIVAR_SOAK_READY_NAME)?.visible).toBe(true);

    const fourthSoaker = entities.get(4);
    if (!fourthSoaker) throw new Error('fourth soaker fixture missing');
    fourthSoaker.pos = { x: 20, z: 30 };
    syncIgnivarEncounterVisuals(group, player, 0, undefined, undefined, true, undefined, entities);
    expect(soak.userData.playersInside).toBe(3);
    expect(soak.userData.ready).toBe(false);
    expect(soak.getObjectByName(IGNIVAR_SOAK_FLAME_NAME)?.visible).toBe(true);
    expect(soak.getObjectByName(IGNIVAR_SOAK_READY_NAME)?.visible).toBe(false);
  });

  it('counts only living players through the inclusive Shared Pyre radius boundary', () => {
    const group = new THREE.Group();
    const player = {
      id: 1,
      kind: 'player',
      templateId: 'priest',
      castingAbility: null,
      pos: { x: 0, z: 0 },
      auras: [{ id: IGNIVAR_SOAK_AURA_ID }],
    };
    const entities = new Map<number, typeof player & { dead?: boolean }>([
      [1, player],
      [2, { ...player, id: 2, pos: { x: IGNIVAR_SOAK_RADIUS, z: 0 }, auras: [] }],
      [3, { ...player, id: 3, pos: { x: IGNIVAR_SOAK_RADIUS + 0.001, z: 0 }, auras: [] }],
      [4, { ...player, id: 4, pos: { x: 1, z: 0 }, auras: [], dead: true }],
    ]);
    entities.set(5, {
      ...player,
      id: 5,
      kind: 'mob',
      pos: { x: 1, z: 0 },
      auras: [],
    });

    syncIgnivarEncounterVisuals(group, player, 0, undefined, undefined, true, undefined, entities);
    const soak = group.getObjectByName(IGNIVAR_SOAK_VISUAL_NAME) as THREE.Group;
    expect(soak.userData.playersInside).toBe(2);
    expect(soak.userData.ready).toBe(false);
  });

  it('shows the frontal only for Ignivar while his cast is in flight', () => {
    const group = new THREE.Group();
    const boss: {
      kind: string;
      templateId: string;
      castingAbility: string | null;
      castRemaining?: number;
      castTotal?: number;
      auras: { id: string }[];
      scale: number;
    } = {
      kind: 'mob',
      templateId: IGNIVAR_BOSS_ID,
      castingAbility: null,
      auras: [],
      scale: 3.4,
    };
    syncIgnivarEncounterVisuals(group, boss);
    expect(group.getObjectByName(IGNIVAR_FRONTAL_VISUAL_NAME)?.visible).toBe(false);
    syncIgnivarEncounterVisuals(group, {
      ...boss,
      templateId: 'fire_elemental',
    });
    expect(group.children).toHaveLength(5);
    boss.castingAbility = IGNIVAR_FRONTAL_CAST_ID;
    boss.castRemaining = 1.5;
    boss.castTotal = 3;
    syncIgnivarEncounterVisuals(group, boss);
    const frontal = group.getObjectByName(IGNIVAR_FRONTAL_VISUAL_NAME) as THREE.Group;
    expect(frontal.visible).toBe(true);
    expect(frontal.scale.x).toBeCloseTo(1 / 3.4);
    expect(frontal.userData.progress).toBe(0.5);
    expect(
      (
        (frontal.getObjectByName(IGNIVAR_FRONTAL_FILL_NAME) as THREE.Mesh)
          .material as THREE.Material
      ).opacity,
    ).toBeGreaterThan(0.2);
  });

  it('shows and clears a red radius around every branded player', () => {
    const group = new THREE.Group();
    const player = {
      kind: 'player',
      templateId: 'warrior',
      castingAbility: null,
      auras: [{ id: IGNIVAR_BRAND_AURA_ID }],
    };
    syncIgnivarEncounterVisuals(group, player);
    expect(group.getObjectByName(IGNIVAR_BRAND_VISUAL_NAME)?.visible).toBe(true);
    player.auras = [];
    syncIgnivarEncounterVisuals(group, player);
    expect(group.getObjectByName(IGNIVAR_BRAND_VISUAL_NAME)?.visible).toBe(false);
  });

  it('intensifies the red radius as Brand of the Pyre gains stacks', () => {
    const group = new THREE.Group();
    const player = {
      kind: 'player',
      templateId: 'warrior',
      castingAbility: null,
      auras: [{ id: IGNIVAR_BRAND_AURA_ID, stacks: 1 }],
    };
    syncIgnivarEncounterVisuals(group, player);
    const circle = group.getObjectByName(IGNIVAR_BRAND_VISUAL_NAME) as THREE.Group;
    const fill = circle.getObjectByName(IGNIVAR_BRAND_FILL_NAME) as THREE.Mesh;
    const firstOpacity = (fill.material as THREE.MeshBasicMaterial).opacity;

    player.auras = [{ id: IGNIVAR_BRAND_AURA_ID, stacks: 3 }];
    syncIgnivarEncounterVisuals(group, player);

    expect(circle.userData.brandStacks).toBe(3);
    expect((fill.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(firstOpacity);
  });

  it('turns a branded radius into an urgent pulse when another player overlaps it', () => {
    const group = new THREE.Group();
    const player = {
      id: 1,
      kind: 'player',
      templateId: 'warrior',
      castingAbility: null,
      pos: { x: 0, z: 0 },
      auras: [{ id: IGNIVAR_BRAND_AURA_ID, stacks: 1 }],
    };
    const ally = {
      id: 2,
      kind: 'player',
      templateId: 'priest',
      castingAbility: null,
      pos: { x: 8, z: 0 },
      auras: [],
    };
    const entities = new Map([
      [1, player],
      [2, ally],
    ]);
    syncIgnivarEncounterVisuals(group, player, 0, undefined, undefined, true, undefined, entities);
    const brand = group.getObjectByName(IGNIVAR_BRAND_VISUAL_NAME) as THREE.Group;
    const fill = brand.getObjectByName(IGNIVAR_BRAND_FILL_NAME) as THREE.Mesh;
    const safeOpacity = (fill.material as THREE.Material).opacity;
    expect(brand.userData.overlapDanger).toBe(false);

    ally.pos = { x: 4, z: 0 };
    syncIgnivarEncounterVisuals(group, player, 0, undefined, undefined, true, undefined, entities);
    expect(brand.userData.overlapDanger).toBe(true);
    expect(brand.userData.nearbyPlayers).toBe(1);
    expect((fill.material as THREE.Material).opacity).toBeGreaterThan(safeOpacity);
  });

  it('counts only living players through the inclusive Brand radius boundary', () => {
    const group = new THREE.Group();
    const player = {
      id: 1,
      kind: 'player',
      templateId: 'warrior',
      castingAbility: null,
      pos: { x: 0, z: 0 },
      auras: [{ id: IGNIVAR_BRAND_AURA_ID }],
    };
    const entities = new Map<number, typeof player & { dead?: boolean }>([
      [1, player],
      [2, { ...player, id: 2, pos: { x: IGNIVAR_BRAND_RADIUS, z: 0 }, auras: [] }],
      [3, { ...player, id: 3, pos: { x: IGNIVAR_BRAND_RADIUS + 0.001, z: 0 }, auras: [] }],
      [4, { ...player, id: 4, pos: { x: 1, z: 0 }, auras: [], dead: true }],
    ]);
    entities.set(5, {
      ...player,
      id: 5,
      kind: 'mob',
      pos: { x: 1, z: 0 },
      auras: [],
    });

    syncIgnivarEncounterVisuals(group, player, 0, undefined, undefined, true, undefined, entities);
    const brand = group.getObjectByName(IGNIVAR_BRAND_VISUAL_NAME) as THREE.Group;
    expect(brand.userData.nearbyPlayers).toBe(1);
    expect(brand.userData.overlapDanger).toBe(true);
  });

  it('derives complete frontal and soak clocks including hidden and clamped endpoints', () => {
    const boss = {
      kind: 'mob',
      templateId: IGNIVAR_BOSS_ID,
      castingAbility: IGNIVAR_FRONTAL_CAST_ID,
      castRemaining: 3,
      castTotal: 3,
      auras: [],
    };
    expect(ignivarEncounterVisualPlan(boss).frontalProgress).toBe(0);
    expect(ignivarEncounterVisualPlan({ ...boss, castRemaining: 0 }).frontalProgress).toBe(1);
    expect(ignivarEncounterVisualPlan({ ...boss, castRemaining: -5 }).frontalProgress).toBe(1);
    expect(ignivarEncounterVisualPlan({ ...boss, castingAbility: null }).frontalProgress).toBe(0);

    const player = {
      kind: 'player',
      templateId: 'priest',
      castingAbility: null,
      auras: [{ id: IGNIVAR_SOAK_AURA_ID, remaining: 6, duration: 6 }],
    };
    expect(ignivarEncounterVisualPlan(player).soakProgress).toBe(0);
    expect(
      ignivarEncounterVisualPlan({
        ...player,
        auras: [{ id: IGNIVAR_SOAK_AURA_ID, remaining: 0, duration: 6 }],
      }).soakProgress,
    ).toBe(1);
    expect(
      ignivarEncounterVisualPlan({
        ...player,
        auras: [{ id: IGNIVAR_SOAK_AURA_ID, remaining: -2, duration: 0 }],
      }).soakProgress,
    ).toBe(1);
    expect(ignivarEncounterVisualPlan({ ...player, auras: [] }).soakProgress).toBe(0);
  });

  it('clamps Brand presentation to three stacks in the pure visual plan', () => {
    const plan = ignivarEncounterVisualPlan({
      kind: 'player',
      templateId: 'warrior',
      castingAbility: null,
      auras: [{ id: IGNIVAR_BRAND_AURA_ID, stacks: 99 }],
      scale: 0,
    });

    expect(plan).toMatchObject({
      branded: true,
      brandStacks: 3,
      inverseEntityScale: 100,
    });
  });

  it('feeds the pooled ground-fire emitter the authoritative safe refuge in world space', () => {
    const group = new THREE.Group();
    group.position.set(100, 3, -50);
    group.scale.setScalar(3.4);
    const slot = 5;
    const safeIndex = 1;
    const rotation = (slot * Math.PI * 2) / 24;
    const safe = ignivarForgeShelterOffsets(rotation)[safeIndex];
    const syncGroundFire = vi.fn();
    const vfx = {
      syncIgnivarJudgmentGroundFire: syncGroundFire,
    } as unknown as Vfx;

    const facing = ignivarForgeLayoutFacing(slot, safeIndex);
    group.rotation.y = facing;
    syncIgnivarEncounterVisuals(
      group,
      {
        id: 77,
        kind: 'mob',
        templateId: IGNIVAR_BOSS_ID,
        castingAbility: IGNIVAR_JUDGMENT_CAST_ID,
        castRemaining: 4,
        castTotal: 12,
        channeling: true,
        facing,
        scale: 3.4,
        auras: [],
      },
      1 / 60,
      vfx,
    );

    expect(syncGroundFire).toHaveBeenCalledWith(
      77,
      true,
      100,
      3,
      -50,
      100 + safe.x,
      -50 + safe.z,
      1 / 60,
    );

    group.updateWorldMatrix(true, true);
    const judgment = group.getObjectByName(IGNIVAR_JUDGMENT_VISUAL_NAME) as THREE.Group;
    const shelter = judgment.getObjectByName(IGNIVAR_JUDGMENT_SHELTERS_NAME)?.children[safeIndex];
    const worldSafe = shelter?.getWorldPosition(new THREE.Vector3());
    expect(worldSafe?.x).toBeCloseTo(100 + safe.x, 6);
    expect(worldSafe?.z).toBeCloseTo(-50 + safe.z, 6);
    const foundation = shelter?.getObjectByName(
      'ignivarForgeJudgmentShelterFoundation',
    ) as THREE.Mesh;
    expect(foundation.getWorldScale(new THREE.Vector3()).x).toBeCloseTo(1, 6);
  });

  it('disposes per-entity encounter overlays when a character view leaves', () => {
    const group = new THREE.Group();
    const frontal = buildIgnivarFrontalTelegraph();
    const brand = buildIgnivarBrandCircle();
    const rays = buildIgnivarRotatingRaysTelegraph();
    const soak = buildIgnivarSoakCircle();
    group.add(frontal, brand, rays, soak);
    const frontalMesh = frontal.children[0] as THREE.Mesh;
    const brandMesh = brand.children[0] as THREE.Mesh;
    const frontalGeometryDispose = vi.spyOn(frontalMesh.geometry, 'dispose');
    const brandMaterialDispose = vi.spyOn(brandMesh.material as THREE.Material, 'dispose');
    const nestedTick = rays.getObjectByName(IGNIVAR_ROTATING_RAY_TICKS_NAME)?.children[0] as
      | THREE.Mesh
      | undefined;
    const nestedOuter = rays.getObjectByName(IGNIVAR_FIRE_BEAM_OUTER_NAME) as THREE.Mesh;
    const nestedTickGeometryDispose = vi.spyOn(
      nestedTick?.geometry as THREE.BufferGeometry,
      'dispose',
    );
    const nestedOuterMaterialDispose = vi.spyOn(nestedOuter.material as THREE.Material, 'dispose');
    const soakBeacon = soak.getObjectByName('ignivarSoakCallInBeacon') as THREE.Group;
    const soakBeaconGeometryDispose = vi.spyOn(
      (soakBeacon.children[0] as THREE.Mesh).geometry,
      'dispose',
    );
    const soakEmberMaterialDispose = vi.spyOn(
      (soakBeacon.children[2] as THREE.Points).material as THREE.Material,
      'dispose',
    );

    disposeIgnivarEncounterVisuals(group);

    expect(group.getObjectByName(IGNIVAR_FRONTAL_VISUAL_NAME)).toBeUndefined();
    expect(group.getObjectByName(IGNIVAR_BRAND_VISUAL_NAME)).toBeUndefined();
    expect(group.getObjectByName(IGNIVAR_ROTATING_RAYS_VISUAL_NAME)).toBeUndefined();
    expect(group.getObjectByName(IGNIVAR_SOAK_VISUAL_NAME)).toBeUndefined();
    expect(frontalGeometryDispose).toHaveBeenCalledOnce();
    expect(brandMaterialDispose).toHaveBeenCalledOnce();
    expect(nestedTickGeometryDispose).toHaveBeenCalledOnce();
    expect(nestedOuterMaterialDispose).toHaveBeenCalledOnce();
    expect(soakBeaconGeometryDispose).toHaveBeenCalledOnce();
    expect(soakEmberMaterialDispose).toHaveBeenCalledOnce();
  });

  it('pins the production renderer integration for cleanup, stable conduits, and facing', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    expect(renderer).toContain('disposeRaidEncounterVisuals(v.group);');
    expect(renderer).toContain(
      'isStableIgnivarWaterConduitTransition(v.builtTemplateId, e.templateId)',
    );
    expect(renderer).toContain('e.castingAbility === IGNIVAR_FRONTAL_CAST_ID');
    expect(renderer).toContain('e.castingAbility === IGNIVAR_SKYFIRE_CAST_ID');
    expect(renderer).toContain('e.castingAbility === IGNIVAR_ROTATING_RAYS_CAST_ID');
    expect(renderer).toContain('e.castingAbility === IGNIVAR_FORGE_WAVE_CAST_ID');
    expect(renderer).toContain('e.castingAbility === IGNIVAR_JUDGMENT_CAST_ID');
    expect(renderer).toContain('characterBodyOnScreen || raidEncounterBypassesCharacterCulling(e)');
    expect(renderer).toContain('hasVisibleRaidEncounterTelegraph(v.group)');
    expect(renderer).toMatch(
      /this\.gateViewOnCompile\(\s*view,\s*group,\s*e\.templateId === IGNIVAR_BOSS_ID && view\.visual \? view\.visual\.root : group,\s*\)/,
    );
    expect(renderer).toContain('v.group.visible = raidEncounterViewVisibleDuringCompile(');
    expect(renderer).toMatch(
      /v\.visual\.root,\s*characterBodyOnScreen,\s*undefined,\s*this\.sim\.entities/,
    );
    const chainSync = renderer.indexOf('syncIgnivarPlayerChainVisual(');
    expect(chainSync).toBeGreaterThan(-1);
    expect(renderer.slice(chainSync, chainSync + 180)).toContain('this.reducedMotion(),');
    const unloadedRigBlockStart = renderer.indexOf('if (!v.visual) {', chainSync);
    const unloadedRigBlockEnd = renderer.indexOf(
      '// Decide visibility from the real world position before presentation work.',
      unloadedRigBlockStart,
    );
    expect(unloadedRigBlockStart).toBeGreaterThan(chainSync);
    expect(unloadedRigBlockEnd).toBeGreaterThan(unloadedRigBlockStart);
    const unloadedRigBlock = renderer.slice(unloadedRigBlockStart, unloadedRigBlockEnd);
    const playerEncounterSync = renderer.indexOf(
      'if (raidEncounterBypassesCharacterCulling(e))',
      chainSync,
    );
    expect(playerEncounterSync).toBeGreaterThan(chainSync);
    expect(playerEncounterSync).toBeLessThan(unloadedRigBlockEnd);
    expect(unloadedRigBlock).toMatch(
      /syncRaidEncounterVisuals\([\s\S]*?this\.sim\.entities,[\s\S]*?\);[\s\S]*?continue;/,
    );
    expect(
      renderer.match(/this\.mageGroundFx\.syncMeteorWarnings\(this\.sim\.activeIgnivarMeteors\)/g),
    ).toHaveLength(2);
    expect(renderer).toContain('this.mageGroundFx.impactMeteor(ev.persistentId, ev.x, ev.z)');
    expect(renderer).toContain('warningLead: ev.warningLead');
    expect(hud).toContain('resolveCastLabel: (s) => abilityDisplayNameFromSource(s.label)');
  });

  it('keeps the Ignivar telegraph anchor visible while the cosmetic rig compiles', () => {
    expect(ignivarEncounterViewVisibleDuringCompile(IGNIVAR_BOSS_ID, true)).toBe(true);
    expect(ignivarEncounterViewVisibleDuringCompile('fire_elemental', true)).toBe(false);
    expect(ignivarEncounterViewVisibleDuringCompile('fire_elemental', false)).toBe(true);
  });
});
