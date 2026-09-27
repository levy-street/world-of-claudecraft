// The class VFX pools that live outside AbilityVfxFx still need a prewarm
// home. The vfx.ability-primitives entry walks the scene through
// collectAbilityVfxCompileTargets, which selects on each object's OWN
// renderCategory tag. A module that tags
// only its (material-less, hidden) root group is invisible to that walk, so
// its programs link live on the first cast. Each module below must hand the
// walk every drawable it built.

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import {
  abilityVfxGateMaterials,
  collectAbilityVfxCompileTargets,
} from '../src/render/ability_vfx/prewarm';
import { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';
import { DrainLifeVfx } from '../src/render/drain_life_vfx';
import { drawProgramSignature } from '../src/render/draw_program_signature_core';
import { NeedleOfFateVfx } from '../src/render/needle_of_fate_vfx';
import { SentenceVfx } from '../src/render/sentence_vfx';
import { UmbralAnchorMarker } from '../src/render/umbral_anchor_marker';
import { UMBRAL_ANCHOR_ID } from '../src/sim/combat/warlock_utility';
import type { Entity } from '../src/sim/types';
import { drawsUnder, threeProgramKeys } from './helpers/three_program_keys';

const TEST_TEXTURES = {
  noise: new THREE.Texture(),
  ribbon: new THREE.Texture(),
  rune: new THREE.Texture(),
  ember: new THREE.Texture(),
  rime: new THREE.Texture(),
  crack: new THREE.Texture(),
  char: new THREE.Texture(),
  overlay: new THREE.Texture(),
} as unknown as AbilityVfxTextures;

const noAnchor = () => false;

type Drawable = THREE.Object3D & { material: THREE.Material | THREE.Material[] };

function drawablesUnder(root: THREE.Object3D): Drawable[] {
  const found: Drawable[] = [];
  root.traverse((object) => {
    const candidate = object as Partial<Drawable> & THREE.Object3D;
    if (candidate.material) found.push(candidate as Drawable);
  });
  return found;
}

function materialsOf(object: Drawable): THREE.Material[] {
  return Array.isArray(object.material) ? object.material : [object.material];
}

/** The engine ribbon's programs: a class pool that embeds an
 *  AbilityVfxRibbons (Sentence's lash) draws the engine's own program, which
 *  the fx's ribbons already hold in the gate, so it adds no gate entry. */
function engineRibbonSignatures(): Set<string> {
  const scene = new THREE.Scene();
  new AbilityVfxRibbons(scene, () => null, TEST_TEXTURES);
  return new Set(drawsUnder(scene).map((draw) => drawProgramSignature(draw.object, draw.material)));
}

/** Every draw under `root`, as three would key its program set, is linked by
 *  a compile unit: one representative per program, since a clone sharing a
 *  linked program reuses it on its first draw. None of its own programs holds
 *  the cast gate: the painter never draws these pools, so the gate waits on
 *  the engine and kit families (tests/cast_vfx_engine_family.test.ts). */
function expectEveryDrawableCollected(scene: THREE.Scene, root: THREE.Object3D): void {
  const drawables = drawablesUnder(root);
  expect(drawables.length).toBeGreaterThan(0);
  const engine = engineRibbonSignatures();
  for (const material of abilityVfxGateMaterials(scene)) {
    const draw = drawsUnder(scene).find((candidate) => candidate.material === material);
    const signature = draw ? drawProgramSignature(draw.object, draw.material) : material.uuid;
    expect(engine.has(signature), `${draw?.object.name ?? material.type} gated`).toBe(true);
  }
  const linked = new Set<string>();
  for (const target of collectAbilityVfxCompileTargets(scene)) {
    for (const draw of drawsUnder(target.object)) {
      linked.add(threeProgramKeys(draw.material, draw.object));
    }
  }
  for (const drawable of drawables) {
    for (const material of materialsOf(drawable)) {
      const key = threeProgramKeys(material, drawable);
      expect(linked.has(key), `${drawable.name || drawable.type} linked`).toBe(true);
    }
  }
}

/** Compile units per pool (the whole scene the pool's constructor built),
 *  keyed by program. Keyed by material instance, the same pools were 1
 *  (Drain Life's 36 ShaderMaterial clones already shared a source), 7,
 *  217 / 105 and 184 / 104 units. A count may sit a little above three's own
 *  distinct program count, never below it: the signature keeps the object
 *  kind and the material type apart where three can share one program (a
 *  LineBasicMaterial lash and a MeshBasicMaterial disc), one idle-slot cache
 *  hit each. A pool that grows past its pin carries a new program: re-pin it
 *  on purpose. */
const POOL_UNITS = {
  drainLife: 1,
  umbral: 4,
  sentenceFull: 8,
  sentenceLow: 4,
  needleFull: 5,
  needleLow: 3,
} as const;

/** Gate entries per pool: none of their own, and Sentence's lash, an embedded
 *  engine AbilityVfxRibbons, the one engine program they draw (on both detail
 *  levels, since the lash is not a detail cut). */
const POOL_GATED = {
  drainLife: 0,
  umbral: 0,
  sentenceFull: 1,
  sentenceLow: 1,
  needleFull: 0,
  needleLow: 0,
} as const;

/** One compile unit per distinct program signature, and no signature ever
 *  covering two of three's programs (that would leave a program no unit
 *  linked). */
function expectOneUnitPerProgram(pool: keyof typeof POOL_UNITS, scene: THREE.Scene): void {
  const keyOfSignature = new Map<string, string>();
  const programs = new Set<string>();
  for (const draw of drawsUnder(scene)) {
    if (draw.object.userData.renderCategory !== 'vfx') continue;
    const key = threeProgramKeys(draw.material, draw.object);
    programs.add(key);
    const signature = drawProgramSignature(draw.object, draw.material);
    const known = keyOfSignature.get(signature);
    if (known === undefined) keyOfSignature.set(signature, key);
    else expect(key, `${pool}: ${draw.object.name} shares a signature, not a program`).toBe(known);
  }
  const units = collectAbilityVfxCompileTargets(scene).length;
  expect(units, `${pool} units`).toBe(keyOfSignature.size);
  expect(units, `${pool} units`).toBe(POOL_UNITS[pool]);
  expect(abilityVfxGateMaterials(scene), `${pool} gated`).toHaveLength(POOL_GATED[pool]);
  expect(programs.size, `${pool} programs`).toBeLessThanOrEqual(units);
}

describe('class VFX pools are reachable by the ability-VFX prewarm walk', () => {
  it('Drain Life: every channel slot program, while every slot stays hidden', () => {
    const scene = new THREE.Scene();
    new DrainLifeVfx(scene, () => null, vi.fn());
    const slots = scene.children.filter((child) => child.name === 'drain-life-vfx-slot');
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.visible).toBe(false);
      expectEveryDrawableCollected(scene, slot);
    }
    expectOneUnitPerProgram('drainLife', scene);
  });

  it('Umbral Anchor: the sigil shader, the halo and shard meshes, and the wisp points', () => {
    const scene = new THREE.Scene();
    const marker = new UmbralAnchorMarker();
    scene.add(marker.group);
    expect(marker.group.visible).toBe(false);
    const kinds = new Set(drawablesUnder(marker.group).map((object) => object.type));
    expect(kinds).toEqual(new Set(['Mesh', 'LineSegments', 'Points']));
    expectEveryDrawableCollected(scene, marker.group);
    expectOneUnitPerProgram('umbral', scene);
  });

  for (const lowDetail of [false, true]) {
    it(`Sentence (${lowDetail ? 'low' : 'full'} detail): every slot family, starburst included`, () => {
      const scene = new THREE.Scene();
      const vfx = new SentenceVfx(
        scene,
        new THREE.PerspectiveCamera(),
        noAnchor,
        lowDetail,
        vi.fn(),
        TEST_TEXTURES,
      );
      if (!lowDetail) {
        const starburst = drawablesUnder(vfx.group).find((object) => /starburst/.test(object.name));
        expect(starburst, 'the full-detail starburst exists').toBeDefined();
      }
      expectEveryDrawableCollected(scene, vfx.group);
      expectOneUnitPerProgram(lowDetail ? 'sentenceLow' : 'sentenceFull', scene);
    });

    it(`Needle of Fate (${lowDetail ? 'low' : 'full'} detail): every windup, release, needle and impact`, () => {
      const scene = new THREE.Scene();
      const vfx = new NeedleOfFateVfx(scene, new THREE.PerspectiveCamera(), noAnchor, lowDetail);
      expectEveryDrawableCollected(scene, vfx.group);
      expectOneUnitPerProgram(lowDetail ? 'needleLow' : 'needleFull', scene);
    });
  }
});

/** Each draw under the pool, with its tag and its program signature. */
const drawState = (root: THREE.Object3D): string[] =>
  drawsUnder(root).map(
    ({ object, material }) =>
      `${object.uuid}|${object.userData.renderCategory}|${drawProgramSignature(object, material)}`,
  );

/** Whether some draw under `root` is on screen: the play really spawned. */
const shows = (root: THREE.Object3D): boolean =>
  drawsUnder(root).some(({ object }) => {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
      if (!node.visible) return false;
    }
    return true;
  });

const at = (_id: number, _height: number, out: THREE.Vector3): boolean => {
  out.set(3, 0, 3);
  return true;
};

const anchored = {
  id: 1,
  auras: [
    { id: UMBRAL_ANCHOR_ID, kind: 'warlock_anchor', sourceId: 1, value: 0, value2: 0, value3: 0 },
  ],
} as unknown as Entity;

/** `update` takes the elapsed seconds; each frame is a thirtieth of one. */
type Played = { root: THREE.Object3D; play: () => void; update: (time: number) => void };

// The pools are built once, at construction, and the walk above runs over that
// build: a cast that added a drawable, or left one untagged or on another
// program, would link it live whatever the gate said.
// biome-ignore format: one pool per row
const PLAYS: Array<[string, (scene: THREE.Scene) => Played]> = [
  ['Drain Life', (scene) => {
    const vfx = new DrainLifeVfx(scene, (_id, _h, _x, _z, out) => out?.set(1, 0, 1) ?? null, vi.fn());
    const play = () => [vfx.drain(1, 2, 3), vfx.demonicDrain(3, 2, 3), vfx.evilEyeGaze(4, 2), vfx.tick(1)];
    return { root: scene, play, update: () => vfx.update(1 / 30) };
  }],
  ['Umbral Anchor (draped)', (scene) => {
    const marker = new UmbralAnchorMarker(() => 0.5);
    scene.add(marker.group);
    return { root: marker.group, play: () => marker.update(anchored, 0), update: (time) => marker.update(anchored, time) };
  }],
  ...[false, true].flatMap((low): Array<[string, (scene: THREE.Scene) => Played]> => [
    [`Sentence (${low ? 'low' : 'full'} detail)`, (scene) => {
      const vfx = new SentenceVfx(scene, new THREE.PerspectiveCamera(), at, low, vi.fn(), TEST_TEXTURES);
      return { root: vfx.group, play: () => vfx.trigger(1, 2, 80, 3), update: () => vfx.update(1 / 30) };
    }],
    [`Needle of Fate (${low ? 'low' : 'full'} detail)`, (scene) => {
      const vfx = new NeedleOfFateVfx(scene, new THREE.PerspectiveCamera(), at, low, vi.fn());
      return { root: vfx.group, play: () => [vfx.beginCast(1, 1), vfx.spawn(1, 2)], update: () => vfx.update(1 / 30) };
    }],
  ]),
];

it.each(PLAYS)('%s: a cast adds no drawable and moves none off its tag or program', (_, build) => {
  const pool = build(new THREE.Scene());
  const built = drawState(pool.root);
  expect(built.length).toBeGreaterThan(0);
  expect(built.filter((line) => !line.includes('|vfx|'))).toEqual([]);
  pool.play();
  pool.update(1 / 30);
  expect(shows(pool.root)).toBe(true);
  for (let frame = 2; frame <= 90; frame++) pool.update(frame / 30);
  expect(drawState(pool.root)).toEqual(built);
});
