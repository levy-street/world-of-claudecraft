// The Wildheart Basin trash hunt's painter (src/render/wildheart_basin/
// basin_trash_fx.ts) on a fake BasinFxHost and a stub world: it mints every
// material, texture and geometry once in its constructor and nothing after,
// it draws every ACTIONABLE mark (the cast rings, the kick glyphs, the tongue
// lanes, the quarry rakes and sigil, the dread skulls, a tongue per reeled
// player) on every density and motion setting, the quarry's rakes show the
// moment the mark lands while only the sigil waits for the spear, and its
// dispose releases exactly what it owns, best effort, once.

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { TelegraphKit } from '../src/render/floor_telegraph';
import { isSharedMaterial } from '../src/render/shared_resource';
import type { BasinFxHost } from '../src/render/wildheart_basin/basin_fx_host';
import { BasinTrashFx } from '../src/render/wildheart_basin/basin_trash_fx';
import { TRASH_FX_POOLS } from '../src/render/wildheart_basin/basin_trash_fx_core';
import {
  HEXCALLER_ID,
  RAVAGER_ID,
  SPORE_TOAD_ID,
  STALKER_ID,
  SUNBONE_DREAD_TOTEM_ID,
} from '../src/sim/encounters/wildheart_basin/ids';
import {
  WILDHEART_QUARRY,
  WILDHEART_QUARRY_MARK,
  WILDHEART_RATTLING_DREAD,
  WILDHEART_SNARING_TONGUE,
  WILDHEART_TOAD_HEX,
  WILDHEART_TOADED,
  WILDHEART_WAR_ROAR,
} from '../src/sim/mob/trash_kit/wildheart_cast_ids';
import type { IWorld } from '../src/world_api';

// The canvases need a DOM the node run has none of: count every texture the
// painter asks for instead.
const minted = vi.hoisted(() => ({ textures: 0 }));
vi.mock('../src/render/textures', async (importOriginal) => {
  const THREE = await import('three');
  return {
    ...(await importOriginal<typeof import('../src/render/textures')>()),
    radialGlowTexture: () => {
      minted.textures++;
      return new THREE.Texture();
    },
  };
});
vi.mock('../src/render/wildheart_basin/basin_trash_art', async () => {
  const THREE = await import('three');
  const tex = () => {
    minted.textures++;
    return new THREE.Texture();
  };
  return { quarrySigilTexture: tex, dreadSkullTexture: tex };
});

interface StubEntity {
  id: number;
  kind: 'mob' | 'player';
  templateId: string;
  pos: { x: number; y: number; z: number };
  facing: number;
  scale: number;
  dead: boolean;
  auras: { id: string; value: number; sourceId: number; remaining: number; duration: number }[];
  castingAbility: string | null;
  castRemaining: number;
  castTotal: number;
  castTargetId: number | null;
  forcedTargetId: number | null;
}

function stubWorld() {
  const entities = new Map<number, StubEntity>();
  const world = { entities, playerId: 1, entityRosterVersion: 1 };
  const add = (e: Partial<StubEntity> & { id: number; templateId: string }) => {
    const full: StubEntity = {
      kind: 'mob',
      pos: { x: 0, y: 0, z: 0 },
      facing: 0,
      scale: 1,
      dead: false,
      auras: [],
      castingAbility: null,
      castRemaining: 0,
      castTotal: 0,
      castTargetId: null,
      forcedTargetId: null,
      ...e,
    };
    entities.set(full.id, full);
    return full;
  };
  return { world: world as unknown as IWorld, add, entities };
}

function fakeHost(density: number, reduced: boolean) {
  const root = new THREE.Group();
  // The kit's fans live on their own root here so ownership reads apart.
  const kitRoot = new THREE.Group();
  const kit = new TelegraphKit(kitRoot, density >= 1);
  let seed = 7;
  const host: BasinFxHost = {
    root,
    kit,
    density,
    uTime: { value: 0 },
    groundY: () => 0,
    puff: () => {},
    shockRing: () => {},
    rand: () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    },
    reducedMotion: () => reduced,
    shake: () => {},
    splash: {} as never,
    thorns: {} as never,
  };
  return { host, root, kitRoot, kit };
}

const aura = (id: string, sourceId: number, remaining = 6, duration = 6) => ({
  id,
  value: 1,
  sourceId,
  remaining,
  duration,
});

const spell = (ability: string, sourceId: number, targetId = sourceId) =>
  ({ type: 'spellfx', ability, fx: 'heavyBolt', sourceId, targetId, school: 'nature' }) as never;

/** Drawn objects by name: visible with every ancestor visible. */
function drawn(roots: THREE.Object3D[], name: string): number {
  let n = 0;
  for (const r of roots) {
    r.traverseVisible((o) => {
      if (o.name === name) n++;
    });
  }
  return n;
}

/** The worst real pull, staged: g12's ringed casters (two Dread Totems
 *  rattling, two ravagers roaring, a hexcaller hexing) with a patrolling
 *  stalker's mark chained in, and g6's three Spore Toads tonguing a whole
 *  party standing down their lanes. */
function stage() {
  const stub = stubWorld();
  const { add } = stub;
  for (let i = 1; i <= 5; i++)
    add({ id: i, kind: 'player', templateId: 'player', pos: { x: 0, y: 0, z: 2 + i * 2 } });
  const bar = (castingAbility: string, castTargetId: number | null = null) => ({
    castingAbility,
    castRemaining: 1,
    castTotal: 2,
    castTargetId,
  });
  add({ id: 20, templateId: SUNBONE_DREAD_TOTEM_ID, ...bar(WILDHEART_RATTLING_DREAD) });
  add({
    id: 21,
    templateId: SUNBONE_DREAD_TOTEM_ID,
    pos: { x: 6, y: 0, z: 0 },
    ...bar(WILDHEART_RATTLING_DREAD),
  });
  add({ id: 22, templateId: RAVAGER_ID, ...bar(WILDHEART_WAR_ROAR) });
  add({ id: 23, templateId: RAVAGER_ID, ...bar(WILDHEART_WAR_ROAR) });
  add({ id: 24, templateId: HEXCALLER_ID, ...bar(WILDHEART_TOAD_HEX, 2) });
  add({ id: 25, templateId: STALKER_ID, ...bar(WILDHEART_QUARRY_MARK, 3) });
  for (const [i, x] of [-1, 0, 1].entries())
    add({
      id: 30 + i,
      templateId: SPORE_TOAD_ID,
      pos: { x, y: 0, z: 0 },
      facing: 0,
      ...bar(WILDHEART_SNARING_TONGUE),
    });
  return stub;
}

function scan(fx: BasinTrashFx, world: IWorld): void {
  fx.beginScan();
  for (const e of world.entities.values()) fx.scanEntity(e);
  fx.endScan();
}

/** Next ids of three's global counters: how many were minted in between. */
function counters() {
  const id = (x: object) => (x as { id: number }).id;
  return {
    material: id(new THREE.MeshBasicMaterial()),
    texture: id(new THREE.Texture()),
    geometry: id(new THREE.BufferGeometry()),
  };
}

/** What hangs under a root. A sprite's quad is three's own module-wide
 *  geometry: listed apart, never the painter's to release. */
function ownedResources(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const spriteQuads = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if ((o as THREE.Sprite).isSprite) spriteQuads.add(m.geometry);
    else if (m.geometry) geometries.add(m.geometry);
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      materials.add(mat);
      const map = (mat as THREE.SpriteMaterial).map;
      if (map) textures.add(map);
    }
  });
  return { geometries, spriteQuads, materials, textures };
}

const SETTINGS: [number, boolean][] = [
  [1, false],
  [1, true],
  [0.4, false],
  [0.4, true],
];

describe('the trash hunt painter', () => {
  for (const [density, reduced] of SETTINGS) {
    it(`mints nothing after its constructor and draws every telegraph (density ${density}, reduced motion ${reduced})`, () => {
      const { world, entities } = stage();
      const { host, root, kitRoot, kit } = fakeHost(density, reduced);
      const texBefore = minted.textures;
      const fx = new BasinTrashFx(host, world);
      expect(minted.textures - texBefore).toBe(3);
      const built = ownedResources(root);
      const kitBuilt = ownedResources(kitRoot);
      const fan = vi.spyOn(kit, 'fan');
      const lane = vi.spyOn(kit, 'lane');
      const texAfterBuild = minted.textures;
      const before = counters();
      const roots = [root, kitRoot];

      // The bars run: every ring, kick glyph, lane and skull draws.
      let clock = 0;
      const step = (n: number) => {
        for (let i = 0; i < n; i++) {
          clock += 1 / 60;
          if (i % 6 === 0) scan(fx, world);
          fx.update(1 / 60, clock);
        }
      };
      step(12);
      expect(drawn(roots, 'wildheart-trash-ring')).toBe(6);
      expect(drawn(roots, 'wildheart-trash-kick')).toBe(3);
      expect(drawn(roots, 'wildheart-trash-lane')).toBe(3);
      expect(drawn(roots, 'wildheart-dread-skull')).toBe(2);

      // The spear and the hex land; the tongues fire.
      const quarry = entities.get(3);
      const hexed = entities.get(2);
      if (!quarry || !hexed) throw new Error('stage');
      expect(fx.handleEvent(spell(WILDHEART_QUARRY_MARK, 25, 3))).toBe(true);
      quarry.auras.push(aura(WILDHEART_QUARRY, 25));
      expect(fx.handleEvent(spell(WILDHEART_TOAD_HEX, 24, 2))).toBe(true);
      hexed.auras.push(aura(WILDHEART_TOADED, 24));
      for (const toad of [30, 31, 32])
        expect(fx.handleEvent(spell(WILDHEART_SNARING_TONGUE, toad))).toBe(true);
      expect(fx.handleEvent(spell(WILDHEART_WAR_ROAR, 22))).toBe(true);
      expect(fx.handleEvent(spell(WILDHEART_RATTLING_DREAD, 20))).toBe(true);
      // The sim applies the mark at the landing: the rakes show at once, the
      // sigil only once the spear strikes home.
      scan(fx, world);
      clock += 1 / 60;
      fx.update(1 / 60, clock);
      expect(drawn(roots, 'wildheart-quarry-ring')).toBe(1);
      expect(drawn(roots, 'wildheart-quarry-sigil')).toBe(0);
      expect(drawn(roots, 'wildheart-trash-spear')).toBe(1);
      // Every player down every toad's lane holds a tongue of their own.
      expect(drawn(roots, 'wildheart-trash-tongue')).toBe(15);
      step(60);
      expect(drawn(roots, 'wildheart-trash-spear')).toBe(0);
      expect(drawn(roots, 'wildheart-quarry-ring')).toBe(1);
      expect(drawn(roots, 'wildheart-quarry-sigil')).toBe(1);
      expect(drawn(roots, 'wildheart-dread-skull')).toBe(2);

      // The hex breaks, the bars end, the tongues let go.
      hexed.auras.length = 0;
      for (const e of entities.values()) e.castingAbility = null;
      step(240);
      expect(drawn(roots, 'wildheart-trash-ring')).toBe(0);
      expect(drawn(roots, 'wildheart-trash-tongue')).toBe(0);

      // Nothing minted along the way, nothing new hung under the roots.
      const after = counters();
      expect(after.material - before.material).toBe(1);
      expect(after.texture - before.texture).toBe(1);
      expect(after.geometry - before.geometry).toBe(1);
      expect(minted.textures).toBe(texAfterBuild);
      expect(fan).not.toHaveBeenCalled();
      expect(lane).not.toHaveBeenCalled();
      const now = ownedResources(root);
      const kitNow = ownedResources(kitRoot);
      expect([...now.materials].every((m) => built.materials.has(m))).toBe(true);
      expect([...now.textures].every((t) => built.textures.has(t))).toBe(true);
      expect([...kitNow.materials].every((m) => kitBuilt.materials.has(m))).toBe(true);
      fx.dispose();
    });
  }

  it('holds a tongue for every caught player when every pool is pressed at once', () => {
    const { world, add } = stubWorld();
    for (let i = 1; i <= 5; i++)
      add({ id: i, kind: 'player', templateId: 'player', pos: { x: 0, y: 0, z: 2 + i * 2 } });
    const toads = TRASH_FX_POOLS.lanes;
    for (let i = 0; i < toads; i++)
      add({ id: 40 + i, templateId: SPORE_TOAD_ID, pos: { x: (i % 3) - 1, y: 0, z: 0 } });
    const { host, root } = fakeHost(0.4, false);
    const fx = new BasinTrashFx(host, world);
    fx.update(1 / 60, 0);
    for (let i = 0; i < toads; i++) fx.handleEvent(spell(WILDHEART_SNARING_TONGUE, 40 + i));
    // A toad firing again before it lets go keeps the tongues it has out.
    fx.handleEvent(spell(WILDHEART_SNARING_TONGUE, 40));
    fx.update(1 / 60, 1 / 60);
    expect(drawn([root], 'wildheart-trash-tongue')).toBe(toads * 5);
    fx.dispose();
  });

  it('thins the bolt trails with the density, at one rate whatever the frame rate', () => {
    const trail = (density: number, fps: number) => {
      const { world, add } = stubWorld();
      add({ id: 2, kind: 'player', templateId: 'player', pos: { x: 0, y: 0, z: 40 } });
      add({ id: 24, templateId: HEXCALLER_ID });
      const { host } = fakeHost(density, false);
      let motes = 0;
      host.puff = (_x, _y, _z, n) => {
        if (n === 1) motes++;
      };
      const fx = new BasinTrashFx(host, world);
      fx.update(1 / fps, 0);
      fx.handleEvent(spell(WILDHEART_TOAD_HEX, 24, 2));
      for (let i = 1; i <= fps; i++) fx.update(1 / fps, i / fps);
      fx.dispose();
      return motes;
    };
    const full30 = trail(1, 30);
    const full144 = trail(1, 144);
    expect(full30).toBeGreaterThan(10);
    expect(Math.abs(full144 - full30)).toBeLessThanOrEqual(2);
    const thin = trail(0.4, 144);
    expect(thin).toBeLessThan(full144 * 0.5);
    expect(thin).toBeGreaterThan(full144 * 0.3);
  });

  it('disposes what it owns, never the cached surfaces or the kit, best effort and once', () => {
    const { world } = stage();
    const { host, root, kitRoot } = fakeHost(1, false);
    const fx = new BasinTrashFx(host, world);
    const own = ownedResources(root);
    const kit = ownedResources(kitRoot);
    const shared = [...own.materials].filter((m) => isSharedMaterial(m));
    const mine = [...own.materials].filter((m) => !isSharedMaterial(m));
    // The spear and the tongue wear the surfaceMat cache's surfaces.
    expect(shared.length).toBeGreaterThanOrEqual(5);
    expect(mine.length).toBeGreaterThan(0);
    const spy = (xs: Iterable<{ dispose(): void }>) =>
      [...xs].map((x) => vi.spyOn(x as { dispose: () => void }, 'dispose'));
    const geo = spy(own.geometries);
    const mat = spy(mine);
    const sharedMat = spy(shared);
    const tex = spy(own.textures);
    const kitMat = spy(kit.materials);
    const kitGeo = spy(kit.geometries);
    expect(own.spriteQuads.size).toBe(1);
    const quad = spy(own.spriteQuads);
    // One release throws: the rest still go, the failure surfaces once.
    geo[0].mockImplementationOnce(() => {
      throw new Error('lost context');
    });
    expect(() => fx.dispose()).toThrow(AggregateError);
    for (const s of geo) expect(s).toHaveBeenCalledTimes(1);
    for (const s of mat) expect(s).toHaveBeenCalledTimes(1);
    for (const s of tex) expect(s).toHaveBeenCalledTimes(1);
    expect(own.textures.size).toBe(3);
    for (const s of sharedMat) expect(s).not.toHaveBeenCalled();
    for (const s of kitMat) expect(s).not.toHaveBeenCalled();
    for (const s of kitGeo) expect(s).not.toHaveBeenCalled();
    for (const s of quad) expect(s).not.toHaveBeenCalled();
    // Disposed once: a second call is a no-op, and a dead fx paints nothing.
    expect(() => fx.dispose()).not.toThrow();
    for (const s of geo) expect(s).toHaveBeenCalledTimes(1);
    expect(fx.handleEvent(spell(WILDHEART_SNARING_TONGUE, 30))).toBe(false);
    fx.update(1 / 60, 1);
    expect(drawn([root, kitRoot], 'wildheart-trash-ring')).toBe(0);
  });
});
