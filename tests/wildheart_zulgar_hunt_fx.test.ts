// The painters of Zulgar's hunt rework (src/render/wildheart_basin/
// zulgar_hunt_fx.ts over zulgar_glyph_fx.ts, zulgar_spear_fx.ts and
// idol_breath_fx.ts) on a fake BasinFxHost and a stub world. They mint every
// mesh and material once in their constructors and nothing after; every
// ACTIONABLE read draws on every density and motion setting (a dark glyph's
// veil, a lit one's shaft, the ring that fills as one is lit, the Sunstruck
// ring, the spear and the ring under its victim, the warned half and the
// breath over it); and dispose releases what they own, never the kit's or the
// cached surface.

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { TelegraphKit } from '../src/render/floor_telegraph';
import { isSharedMaterial } from '../src/render/shared_resource';
import type { BasinFxHost } from '../src/render/wildheart_basin/basin_fx_host';
import { ZulgarHuntFx } from '../src/render/wildheart_basin/zulgar_hunt_fx';
import { GLYPH_SHAFT_HEIGHT } from '../src/render/wildheart_basin/zulgar_hunt_fx_core';
import { SUN_GLYPHS } from '../src/sim/content/wildheart_basin_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  HUNTING_SPEAR_ID,
  IDOL_BREATH_FIELD,
  idolBreathFacing,
  ZULGAR_TUNING as T,
  WILDHEART_GLYPH_COLD,
  WILDHEART_GLYPH_KINDLE,
  WILDHEART_GLYPH_LIT_FX,
  WILDHEART_IDOL_BREATH,
  WILDHEART_IDOL_BREATH_WARNING,
  WILDHEART_SUN_GLYPH_DARK,
  WILDHEART_SUN_GLYPH_LIT,
  ZULGAR_HUNTING_SPEAR,
  ZULGAR_ID,
  ZULGAR_IDOL_AWAKE,
  ZULGAR_IDOL_WAKES,
  ZULGAR_IDOLS_BREATH,
  ZULGAR_PINNED,
  ZULGAR_SPEAR_FREED,
  ZULGAR_SUNSTRUCK_EXPOSED,
} from '../src/sim/encounters/wildheart_basin';
import type { Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

// The canvases need a DOM the node run has none of.
vi.mock('../src/render/textures', async (importOriginal) => {
  const THREE = await import('three');
  return {
    ...(await importOriginal<typeof import('../src/render/textures')>()),
    radialGlowTexture: () => new THREE.Texture(),
  };
});

const ORIGIN = instanceOrigin(DUNGEONS.wildheart_basin.index, 0);

interface StubEntity {
  id: number;
  kind: 'mob' | 'player' | 'object';
  templateId: string;
  pos: { x: number; y: number; z: number };
  facing: number;
  scale: number;
  dead: boolean;
  auras: { id: string; sourceId: number; remaining: number; duration: number; value2?: number }[];
  castingAbility: string | null;
  castRemaining: number;
  castTotal: number;
  castTargetId: number | null;
}

function stubWorld() {
  const entities = new Map<number, StubEntity>();
  const add = (e: Partial<StubEntity> & { id: number; templateId: string }) => {
    const full: StubEntity = {
      kind: 'object',
      pos: { x: ORIGIN.x, y: 45, z: ORIGIN.z + 216 },
      facing: 0,
      scale: 1,
      dead: false,
      auras: [],
      castingAbility: null,
      castRemaining: 0,
      castTotal: 0,
      castTargetId: null,
      ...e,
    };
    entities.set(full.id, full);
    return full;
  };
  return { world: { entities, playerId: 1 } as unknown as IWorld, add, entities };
}

function fakeHost(density: number, reduced: boolean) {
  const root = new THREE.Group();
  // The kit's fans live on their own root here so ownership reads apart.
  const kitRoot = new THREE.Group();
  const kit = new TelegraphKit(kitRoot, density >= 1);
  let seed = 7;
  const puffs = { n: 0 };
  const host: BasinFxHost = {
    root,
    kit,
    density,
    uTime: { value: 0 },
    groundY: () => 45,
    puff: () => {
      puffs.n++;
    },
    shockRing: () => {},
    rand: () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    },
    reducedMotion: () => reduced,
    shake: () => {},
    splash: { crown: () => {}, ripple: () => {} } as never,
    thorns: {} as never,
  };
  return { host, root, kitRoot, kit, puffs };
}

/** Drawn objects by name: visible with every ancestor visible. */
function drawn(roots: THREE.Object3D[], name: string): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const r of roots) {
    r.traverseVisible((o) => {
      if (o.name === name) out.push(o);
    });
  }
  return out;
}

function scan(fx: ZulgarHuntFx, world: IWorld): void {
  fx.beginScan();
  for (const e of world.entities.values()) {
    if (e.kind === 'player') fx.scanPlayer(e);
    else if (e.kind === 'object') fx.scanObject(e);
    else if (e.templateId === ZULGAR_ID) fx.scanZulgar(e);
  }
}

const spell = (ability: string, sourceId: number, targetId: number, fx = 'nova') =>
  ({ type: 'spellfx', ability, fx, sourceId, targetId, school: 'nature' }) as never;

/** A stub as the source entity an event names. */
const src = (e: StubEntity) => e as unknown as Entity;

/** Next ids of three's global counters: how many were minted in between. */
function counters() {
  const id = (x: object) => (x as { id: number }).id;
  return {
    material: id(new THREE.MeshBasicMaterial()),
    texture: id(new THREE.Texture()),
    geometry: id(new THREE.BufferGeometry()),
  };
}

function uniform(o: THREE.Object3D, name: string): number {
  return ((o as THREE.Mesh).material as THREE.ShaderMaterial).uniforms[name].value as number;
}

/** Zulgar and his six glyphs, all dark. */
function stage() {
  const stub = stubWorld();
  const zulgar = stub.add({
    id: 100,
    kind: 'mob',
    templateId: ZULGAR_ID,
    pos: { x: ORIGIN.x, y: 45, z: ORIGIN.z + 220 },
    scale: 2.8,
  });
  const glyphs = SUN_GLYPHS.map((g, i) =>
    stub.add({
      id: 200 + i,
      templateId: WILDHEART_SUN_GLYPH_DARK,
      pos: { x: ORIGIN.x + g.x, y: 45, z: ORIGIN.z + g.z },
      scale: g.r,
    }),
  );
  const player = stub.add({
    id: 1,
    kind: 'player',
    templateId: 'player',
    pos: { x: ORIGIN.x + 9, y: 45, z: ORIGIN.z + 210 },
  });
  return { ...stub, zulgar, glyphs, player };
}

const SETTINGS: [number, boolean][] = [
  [1, false],
  [1, true],
  [0.4, false],
  [0.4, true],
];

describe("the painters of Zulgar's hunt rework", () => {
  for (const [density, reduced] of SETTINGS) {
    it(`draw every actionable read and mint nothing after the constructor (density ${density}, reduced motion ${reduced})`, () => {
      const { world, add, entities, zulgar, glyphs, player } = stage();
      const { host, root, kitRoot, kit } = fakeHost(density, reduced);
      const fx = new ZulgarHuntFx(host, world);
      const roots = [root, kitRoot];
      const fan = vi.spyOn(kit, 'fan');
      const lane = vi.spyOn(kit, 'lane');
      const children = root.children.length + kitRoot.children.length;
      const before = counters();
      let clock = 0;
      const step = (n = 1) => {
        for (let i = 0; i < n; i++) {
          clock += 1 / 60;
          scan(fx, world);
          fx.update(1 / 60, clock);
        }
      };

      // Six dark glyphs: six veils, no light standing on any of them.
      step();
      expect(drawn(roots, 'wildheart-glyph-veil')).toHaveLength(6);
      expect(drawn(roots, 'wildheart-glyph-shaft')).toHaveLength(0);
      for (const light of drawn(roots, 'wildheart-glyph-light')) {
        expect(uniform(light, 'uLit')).toBe(0);
        expect(uniform(light, 'uArc')).toBe(0);
      }
      expect(drawn(roots, 'wildheart-sunstruck-ring')).toHaveLength(0);

      // One being lit (half way), one cold, one lit.
      Object.assign(glyphs[0], {
        castingAbility: WILDHEART_GLYPH_KINDLE,
        castTotal: T.glyphKindleSeconds,
        castRemaining: T.glyphKindleSeconds / 2,
        castTargetId: player.id,
      });
      Object.assign(glyphs[1], {
        castingAbility: WILDHEART_GLYPH_COLD,
        castTotal: T.glyphColdSeconds,
        castRemaining: T.glyphColdSeconds / 4,
      });
      glyphs[2].templateId = WILDHEART_SUN_GLYPH_LIT;
      step();
      const lights = drawn(roots, 'wildheart-glyph-light');
      const at = (g: StubEntity) =>
        lights.find((o) => o.position.x === g.pos.x && o.position.z === g.pos.z) as THREE.Object3D;
      expect(uniform(at(glyphs[0]), 'uArc')).toBeCloseTo(0.5, 6);
      expect(uniform(at(glyphs[0]), 'uEmber')).toBe(0);
      expect(uniform(at(glyphs[0]), 'uLit')).toBe(0);
      expect(uniform(at(glyphs[1]), 'uArc')).toBeCloseTo(0.25, 6);
      expect(uniform(at(glyphs[1]), 'uEmber')).toBe(1);
      expect(uniform(at(glyphs[2]), 'uLit')).toBe(1);
      // The lit one has shed its veil; its shaft stands full; the one being
      // lit grows a shorter pillar.
      expect(drawn(roots, 'wildheart-glyph-veil')).toHaveLength(5);
      const shafts = drawn(roots, 'wildheart-glyph-shaft');
      expect(shafts).toHaveLength(2);
      const heights = shafts.map((s) => s.scale.y).sort((a, b) => a - b);
      expect(heights[1]).toBe(GLYPH_SHAFT_HEIGHT);
      expect(heights[0]).toBeLessThan(GLYPH_SHAFT_HEIGHT * 0.6);
      expect(heights[0]).toBeGreaterThan(0);
      expect(
        fx.handleEvent(spell(WILDHEART_GLYPH_LIT_FX, player.id, glyphs[2].id), src(player)),
      ).toBe(true);

      // Sunstruck: the gold ring under him, its fill the window left.
      zulgar.auras.push({
        id: ZULGAR_SUNSTRUCK_EXPOSED,
        sourceId: zulgar.id,
        remaining: T.sunstruckSeconds / 2,
        duration: T.sunstruckSeconds,
      });
      step();
      const [ring] = drawn(roots, 'wildheart-sunstruck-ring');
      expect(ring).toBeDefined();
      expect(ring.position.x).toBe(zulgar.pos.x);
      expect(uniform(ring.children[0], 'uFill')).toBeCloseTo(0.5, 6);
      zulgar.auras.length = 0;
      step();
      expect(drawn(roots, 'wildheart-sunstruck-ring')).toHaveLength(0);

      // The Hunting Spear: thrown, standing, tied to its victim, ringed.
      const body = add({
        id: 300,
        kind: 'mob',
        templateId: HUNTING_SPEAR_ID,
        pos: { x: player.pos.x - 1.1, y: 45, z: player.pos.z },
        facing: -Math.PI / 2,
      });
      expect(
        fx.handleEvent(spell(ZULGAR_HUNTING_SPEAR, zulgar.id, player.id, 'detonate'), src(zulgar)),
      ).toBe(true);
      player.auras.push({
        id: ZULGAR_PINNED,
        sourceId: body.id,
        remaining: T.pinSeconds,
        duration: T.pinSeconds,
        value2: 0,
      });
      step();
      expect(drawn(roots, 'wildheart-hunting-spear')).toHaveLength(1);
      expect(drawn(roots, 'wildheart-pinned-ring')).toHaveLength(1);
      expect(drawn(roots, 'wildheart-spear-streak')).toHaveLength(1);
      // The cord waits for the spear to be in.
      expect(drawn(roots, 'wildheart-spirit-cord')).toHaveLength(0);
      step(30);
      expect(drawn(roots, 'wildheart-spirit-cord')).toHaveLength(1);
      expect(drawn(roots, 'wildheart-spear-streak')).toHaveLength(0);
      const [pinRing] = drawn(roots, 'wildheart-pinned-ring');
      expect(pinRing.position.x).toBe(player.pos.x);
      // Pulled: everything of the spear goes with the aura.
      player.auras.length = 0;
      entities.delete(body.id);
      expect(fx.handleEvent(spell(ZULGAR_SPEAR_FREED, 2, player.id), src(player))).toBe(true);
      step();
      expect(drawn(roots, 'wildheart-hunting-spear')).toHaveLength(0);
      expect(drawn(roots, 'wildheart-pinned-ring')).toHaveLength(0);
      expect(drawn(roots, 'wildheart-spirit-cord')).toHaveLength(0);

      // The idol: asleep, then awake, then drawing breath over the east half.
      expect(fx.idolEyes()).toBe(0);
      expect(fx.idolThroat()).toBe(0);
      zulgar.auras.push({ id: ZULGAR_IDOL_AWAKE, sourceId: zulgar.id, remaining: 9, duration: 9 });
      expect(fx.handleEvent(spell(ZULGAR_IDOL_WAKES, zulgar.id, zulgar.id), src(zulgar))).toBe(
        true,
      );
      step();
      expect(fx.idolEyes()).toBeGreaterThan(0.8);
      expect(fx.idolThroat()).toBeGreaterThan(0);
      expect(drawn(roots, 'wildheart-idol-warning')).toHaveLength(0);
      const breath = add({
        id: 400,
        templateId: WILDHEART_IDOL_BREATH_WARNING,
        pos: { x: ORIGIN.x + IDOL_BREATH_FIELD.x, y: 45, z: ORIGIN.z + IDOL_BREATH_FIELD.z },
        facing: idolBreathFacing(1),
        scale: IDOL_BREATH_FIELD.reach,
        castingAbility: ZULGAR_IDOLS_BREATH,
        castTotal: T.breathWarning,
        castRemaining: T.breathWarning * 0.25,
      });
      const awake = fx.idolThroat();
      step();
      const [warning] = drawn(roots, 'wildheart-idol-warning');
      expect(warning).toBeDefined();
      // The east half: its lane starts east of the centre line, at the maw's end.
      expect(warning.position.x).toBe(ORIGIN.x + IDOL_BREATH_FIELD.reach / 2);
      expect(warning.position.z).toBe(ORIGIN.z + IDOL_BREATH_FIELD.maxZ);
      expect(uniform(warning.children[0], 'uFill')).toBeCloseTo(0.75, 6);
      expect(drawn(roots, 'wildheart-idol-breath')).toHaveLength(0);
      expect(fx.idolThroat()).toBeGreaterThan(awake);
      // The curtain on the centre line is cosmetic: the detailed tiers only.
      expect(drawn(roots, 'wildheart-idol-curtain')).toHaveLength(density >= 1 ? 1 : 0);
      // It lands: the same object is the breath, the warning is gone.
      Object.assign(breath, {
        templateId: WILDHEART_IDOL_BREATH,
        castTotal: T.breathLinger,
        castRemaining: T.breathLinger * 0.7,
      });
      expect(
        fx.handleEvent(spell(ZULGAR_IDOLS_BREATH, zulgar.id, breath.id, 'windup'), src(zulgar)),
      ).toBe(true);
      expect(fx.handleEvent(spell(ZULGAR_IDOLS_BREATH, zulgar.id, breath.id), src(zulgar))).toBe(
        true,
      );
      step();
      expect(drawn(roots, 'wildheart-idol-warning')).toHaveLength(0);
      expect(drawn(roots, 'wildheart-idol-curtain')).toHaveLength(0);
      const [sheet] = drawn(roots, 'wildheart-idol-breath');
      expect(sheet).toBeDefined();
      expect(uniform(sheet, 'uAlpha')).toBeGreaterThan(0);
      expect(fx.idolEyes()).toBe(1);
      expect(fx.idolThroat()).toBe(1);
      // The west half next: the other mesh, the other side of the line.
      entities.delete(breath.id);
      step();
      expect(drawn(roots, 'wildheart-idol-breath')).toHaveLength(0);
      add({
        id: 401,
        templateId: WILDHEART_IDOL_BREATH_WARNING,
        pos: { x: ORIGIN.x + IDOL_BREATH_FIELD.x, y: 45, z: ORIGIN.z + IDOL_BREATH_FIELD.z },
        facing: idolBreathFacing(-1),
        castingAbility: ZULGAR_IDOLS_BREATH,
        castTotal: T.breathWarning,
        castRemaining: T.breathWarning,
      });
      step();
      const [west] = drawn(roots, 'wildheart-idol-warning');
      expect(west.position.x).toBe(ORIGIN.x - IDOL_BREATH_FIELD.reach / 2);

      // Nothing minted along the way, nothing new hung under the roots.
      const after = counters();
      expect(after.material - before.material).toBe(1);
      expect(after.texture - before.texture).toBe(1);
      expect(after.geometry - before.geometry).toBe(1);
      expect(fan).not.toHaveBeenCalled();
      expect(lane).not.toHaveBeenCalled();
      expect(root.children.length + kitRoot.children.length).toBe(children);

      // Out of the basin: everything is put away.
      fx.hideAll();
      for (const name of [
        'wildheart-glyph-veil',
        'wildheart-glyph-light',
        'wildheart-glyph-shaft',
        'wildheart-idol-warning',
        'wildheart-idol-breath',
        'wildheart-hunting-spear',
      ])
        expect(drawn(roots, name), name).toHaveLength(0);
      expect(fx.idolEyes()).toBe(0);
      fx.dispose();
    });
  }

  it('claims nothing that is not its own', () => {
    const { world, zulgar } = stage();
    const { host } = fakeHost(1, false);
    const fx = new ZulgarHuntFx(host, world);
    expect(fx.handleEvent(spell('wildheart_zulgar_pulse', zulgar.id, zulgar.id), src(zulgar))).toBe(
      false,
    );
    expect(fx.handleEvent(spell('wildheart_sunstruck', zulgar.id, zulgar.id), src(zulgar))).toBe(
      false,
    );
    fx.dispose();
  });

  it('disposes what it owns, never the kit or the cached spear surface', () => {
    const { world } = stage();
    const { host, root, kitRoot } = fakeHost(1, false);
    const fx = new ZulgarHuntFx(host, world);
    const materials = new Set<THREE.Material>();
    const geometries = new Set<THREE.BufferGeometry>();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.material) materials.add(m.material as THREE.Material);
      if (m.geometry && !(o as THREE.Sprite).isSprite) geometries.add(m.geometry);
    });
    const kitMaterials = new Set<THREE.Material>();
    kitRoot.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.material) kitMaterials.add(m.material as THREE.Material);
    });
    const shared = [...materials].filter((m) => isSharedMaterial(m));
    const mine = [...materials].filter((m) => !isSharedMaterial(m));
    // The spear wears the surfaceMat cache's surface.
    expect(shared).toHaveLength(1);
    expect(mine.length).toBeGreaterThan(10);
    const spy = (xs: Iterable<{ dispose(): void }>) =>
      [...xs].map((x) => vi.spyOn(x as { dispose: () => void }, 'dispose'));
    const mineSpies = spy(mine);
    const sharedSpies = spy(shared);
    const geoSpies = spy(geometries);
    const kitSpies = spy(kitMaterials);
    fx.dispose();
    for (const s of mineSpies) expect(s).toHaveBeenCalledTimes(1);
    for (const s of geoSpies) expect(s).toHaveBeenCalledTimes(1);
    for (const s of sharedSpies) expect(s).not.toHaveBeenCalled();
    for (const s of kitSpies) expect(s).not.toHaveBeenCalled();
  });
});
