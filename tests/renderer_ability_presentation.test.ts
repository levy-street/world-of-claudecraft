// The production wiring of the cast gate (src/render/renderer_ability_presentation.ts):
// the renderer hands ONE readiness object to the ability presentation, whose
// painter asks it for each cast's mask and whose pools ask it for their own
// family at spawn. Driven through the real factory, the real painter and the
// real engine, with a recording gate standing in for the readiness core.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/assets/loader', () => ({
  loadTexture: vi.fn(async () => ({ image: null })),
  releaseTexture: vi.fn(),
  loadGltf: vi.fn(() => new Promise(() => {})),
  releaseGltf: vi.fn(),
}));
vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn(),
}));

import { CAST_VFX_ENGINE, CAST_VFX_KIT } from '../src/render/cast_vfx_family';
import type { EntityView } from '../src/render/renderer';
import { createRendererAbilityPresentation } from '../src/render/renderer_ability_presentation';
import type { Vfx } from '../src/render/vfx';
import { createVfxAnchor } from '../src/render/vfx_anchor';
import type { IWorld } from '../src/world_api';
import { installCastVfxCanvasStub } from './helpers/cast_vfx_headless';

afterEach(() => {
  vi.unstubAllGlobals();
});

function presentation(open: number) {
  installCastVfxCanvasStub();
  const gate = {
    admitted: [] as number[],
    ready: [] as number[],
    spawns: [] as number[],
  };
  const castGate = {
    admit: (mask: number) => {
      gate.admitted.push(mask);
      return (mask & ~open) === 0;
    },
    ready: (mask: number) => {
      gate.ready.push(mask);
      return (mask & ~open) === 0;
    },
    spawnAllowed: (bit: number) => {
      gate.spawns.push(bit);
      return (bit & open) !== 0;
    },
  };
  const entities = new Map([
    [1, { id: 1, kind: 'player', templateId: 'mage', facing: 0 }],
    [2, { id: 2, kind: 'mob', templateId: 'wolf', facing: 0 }],
    [3, { id: 3, kind: 'player', templateId: 'warrior', facing: 0 }],
  ]);
  const world = {
    entities,
    player: { id: 1 },
    playerId: 1,
    talentSpec: null,
  } as unknown as IWorld;
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  camera.position.set(0, 3, 12);
  camera.updateMatrixWorld();
  const anchor = createVfxAnchor((id, pose) => {
    pose.x = id * 2;
    pose.y = 0;
    pose.z = 0;
    pose.height = 2;
    return true;
  });
  const vfx = new Proxy({}, { get: () => () => {} }) as unknown as Vfx;
  const { fx, painter } = createRendererAbilityPresentation({
    scene: new THREE.Scene(),
    camera,
    vfx,
    anchor,
    world: () => world,
    time: () => 0,
    views: new Map<number, EntityView>(),
    visual: () => null,
    textureReady: () => true,
    ground: () => 0,
    height: () => 720,
    pixelRatio: () => 1,
    reducedMotion: () => false,
    audio: () => null,
    spiritBuild: () => {},
    compile: null,
    light: { pulse: () => {} } as never,
    castGate,
    painter: {
      spawnAoeRing: () => {},
      triggerAttack: () => {},
      lightPulse: () => {},
      addShake: () => {},
      screenFlash: () => {},
      screenImpact: () => {},
    },
  });
  return { fx, painter, gate };
}

describe('the ability presentation the renderer builds', () => {
  it("asks the renderer's gate for each cast's mask, and its pools for their family", () => {
    const { fx, painter, gate } = presentation(CAST_VFX_ENGINE | CAST_VFX_KIT);
    expect(
      painter.handleSpellfx({
        sourceId: 1,
        targetId: 2,
        school: 'frost',
        fx: 'heavyBolt',
        ability: 'frostbolt',
      }),
    ).toBe(true);
    expect(gate.admitted).toEqual([CAST_VFX_ENGINE]);
    for (let i = 0; i < 20; i++) fx.update(1 / 30);
    expect(gate.spawns).toContain(CAST_VFX_ENGINE);
    expect(gate.spawns.every((bit) => bit === CAST_VFX_ENGINE || bit === CAST_VFX_KIT)).toBe(true);

    painter.handleSpellfx({
      sourceId: 3,
      targetId: 2,
      school: 'physical',
      fx: 'selfCast',
      ability: 'shield_slam',
    });
    expect(gate.admitted).toEqual([CAST_VFX_ENGINE, CAST_VFX_ENGINE | CAST_VFX_KIT]);
  });

  it("holds the per-frame reads on the renderer's gate", () => {
    const { painter, gate } = presentation(CAST_VFX_ENGINE);
    painter.syncEntity({
      id: 1,
      castingAbility: null,
      castRemaining: 0,
      castTotal: 0,
      auras: [{ id: 'ice_barrier', kind: 'absorb', remaining: 30, duration: 60, value: 300 }],
    });
    expect(gate.ready).toContain(CAST_VFX_ENGINE);
  });

  it('keeps every pool shut when the gate refuses its family', () => {
    const { fx, painter, gate } = presentation(0);
    painter.handleSpellfx({
      sourceId: 1,
      targetId: 2,
      school: 'frost',
      fx: 'heavyBolt',
      ability: 'frostbolt',
    });
    // Refused at the painter: nothing reaches a pool, so nothing asks.
    for (let i = 0; i < 20; i++) fx.update(1 / 30);
    expect(gate.admitted).toEqual([CAST_VFX_ENGINE]);
    expect(gate.spawns).toEqual([]);
    // A pool reached directly still asks the same gate and is refused.
    fx.ringAt(0, 0, 0, 4, 1, 0xffffff, 1, false);
    expect(gate.spawns).toEqual([CAST_VFX_ENGINE]);
  });
});

describe('the renderer', () => {
  it('hands the presentation its own scene readiness as the cast gate', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(source).toContain(
      'this.castVfxReadiness = createSceneCastVfxReadiness(this.scene, this.webgl);',
    );
    const start = source.indexOf('createRendererAbilityPresentation({');
    expect(start).toBeGreaterThan(-1);
    const call = source.slice(start, source.indexOf('\n    });', start));
    expect(call).toContain('castGate: this.castVfxReadiness,');
  });
});
