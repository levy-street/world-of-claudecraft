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

import {
  abilityVfxFamilyMaterials,
  collectAbilityVfxCompileTargets,
} from '../src/render/ability_vfx/prewarm';
import {
  CAST_VFX_ENGINE,
  CAST_VFX_FAMILIES,
  CAST_VFX_KIT,
  CAST_VFX_RELIC,
  castVfxFamilyBitOf,
} from '../src/render/cast_vfx_family';
import { drawProgramSignature } from '../src/render/draw_program_signature_core';
import type { EntityView } from '../src/render/renderer';
import { createRendererAbilityPresentation } from '../src/render/renderer_ability_presentation';
import type { Vfx } from '../src/render/vfx';
import { createVfxAnchor } from '../src/render/vfx_anchor';
import { buildCastVfxBasicStandIns } from '../src/render/vfx_basic_materials';
import { TRINKET_AURA } from '../src/sim/content/trinkets';
import type { IWorld } from '../src/world_api';
import { installCastVfxCanvasStub } from './helpers/cast_vfx_headless';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A player wearing the Kindling Orb and standing in their Last Flame Lantern. */
const WEARER = {
  id: 4,
  kind: 'player',
  templateId: 'priest',
  facing: 0,
  dead: false,
  auras: [
    {
      id: TRINKET_AURA.kindlingOrb,
      kind: 'internal_cd',
      remaining: 15,
      duration: 20,
      value: 0,
    },
    {
      id: TRINKET_AURA.lantern,
      kind: 'internal_cd',
      remaining: 10,
      duration: 12,
      value: 0.3,
      value2: 8,
      value3: 0,
    },
  ],
};

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
  const entities = new Map<number, object>([
    [1, { id: 1, kind: 'player', templateId: 'mage', facing: 0 }],
    [2, { id: 2, kind: 'mob', templateId: 'wolf', facing: 0 }],
    [3, { id: 3, kind: 'player', templateId: 'warrior', facing: 0 }],
    [WEARER.id, WEARER],
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
  const scene = new THREE.Scene();
  // Added before the presentation, as the renderer does: untagged pools the
  // warm-up links after the gated families.
  scene.add(buildCastVfxBasicStandIns());
  const views = new Map<number, EntityView>([
    [WEARER.id, { group: new THREE.Group() } as unknown as EntityView],
  ]);
  const { fx, painter } = createRendererAbilityPresentation({
    scene,
    camera,
    vfx,
    anchor,
    world: () => world,
    time: () => 0,
    views,
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
  return { fx, painter, gate, scene };
}

/** Every drawable the trinket relics built, and which of them show now. */
function relics(scene: THREE.Scene) {
  const root = scene.getObjectByName('trinket-relics') as THREE.Object3D;
  const drawables: THREE.Mesh[] = [];
  root.traverse((object) => {
    if ((object as THREE.Mesh).material) drawables.push(object as THREE.Mesh);
  });
  const shown = (name?: string) =>
    root.children.filter((child) => child.visible && (name ? child.name === name : !child.name))
      .length;
  return { drawables, cosmetic: () => shown(), lights: () => shown('lantern-light') };
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

describe('the Crucible trinket relics the presentation builds', () => {
  const ALL = CAST_VFX_FAMILIES.reduce((mask, family) => mask | family.bit, 0);

  it('shows the relics on the ready bit of the family their programs are linked in', () => {
    const closed = presentation(0);
    const bits = new Set(relics(closed.scene).drawables.map(castVfxFamilyBitOf));
    expect(bits.size).toBe(1);
    const [bit] = bits;
    expect(bit).not.toBe(0);
    const held = presentation(ALL & ~bit);
    held.painter.update(0.2);
    expect(relics(held.scene).cosmetic()).toBe(0);
    const open = presentation(bit);
    open.painter.update(0.2);
    expect(relics(open.scene).cosmetic()).toBe(2);
    // Their own family: no cast waits on the relics, and they wait on no cast family.
    expect(CAST_VFX_FAMILIES.map((family) => [family.id, family.bit])).toEqual([
      ['engine', 1],
      ['kit', 2],
      ['relic', 4],
    ]);
    expect(bit).toBe(CAST_VFX_RELIC);
    expect(open.gate.ready).toContain(CAST_VFX_RELIC);
  });

  it('gates every relic program on that family, one program per material', () => {
    const { scene } = presentation(0);
    const listed = abilityVfxFamilyMaterials(scene).get('relic') ?? [];
    const bySignature = new Map<string, Set<THREE.Material>>();
    const byMaterial = new Map<THREE.Material, Set<string>>();
    for (const drawable of relics(scene).drawables) {
      const material = drawable.material as THREE.Material;
      const signature = drawProgramSignature(drawable, material);
      bySignature.set(signature, (bySignature.get(signature) ?? new Set()).add(material));
      byMaterial.set(material, (byMaterial.get(material) ?? new Set()).add(signature));
    }
    expect(bySignature.size).toBeGreaterThan(0);
    for (const materials of bySignature.values()) {
      expect([...materials].some((material) => listed.includes(material))).toBe(true);
    }
    for (const signatures of byMaterial.values()) expect(signatures.size).toBe(1);
    // Linked with the gated families, ahead of every untagged pool, never in their tail.
    const drawn = new Set<THREE.Object3D>(relics(scene).drawables);
    const targets = collectAbilityVfxCompileTargets(scene);
    const relicAt = targets.flatMap((target, i) => (drawn.has(target.object) ? [i] : []));
    const untaggedAt = targets.flatMap((target, i) =>
      castVfxFamilyBitOf(target.object) === 0 ? [i] : [],
    );
    expect(relicAt.length).toBe(bySignature.size);
    expect(untaggedAt.length).toBeGreaterThan(0);
    expect(Math.max(...relicAt)).toBeLessThan(Math.min(...untaggedAt));
  });

  it('never holds the lantern light, and hands it to the first reads with the CC band', () => {
    const { fx, painter, scene } = presentation(0);
    painter.update(0.2);
    expect(relics(scene).lights()).toBe(1);
    expect(relics(scene).cosmetic()).toBe(0);
    const [band, lantern, ...rest] = painter.firstReadDrawables();
    expect(band).toBe(fx.ccBandDrawable());
    expect(rest).toEqual([]);
    expect(lantern.name).toBe('lantern-light');
    expect(relics(scene).drawables).toContain(lantern);
    expect(lantern.visible).toBe(true);
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
