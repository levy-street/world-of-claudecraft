import { existsSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ASSETS as ROOM_ASSETS,
  sourceFingerprint as roomFingerprint,
} from '../scripts/assets/boss_rooms/build.mjs';
import {
  ASSETS as FORGE_ASSETS,
  sourceFingerprint as forgeFingerprint,
} from '../scripts/assets/forge_room/build.mjs';
import { buildHoardRoomKit, hoardRoomKitInternalsForTest } from '../src/render/hoard_room_kit';
import {
  type BossRoomTheme,
  buildBossRoomPlan,
  ROOM_KIT_DAIS_CLEAR,
  ROOM_KIT_WALL_BAND,
  type RoomKitPlacement,
  themedRoomProfile,
} from '../src/render/hoard_room_kit_core';
import { BOSS_ROOM_THEMES, bossRoomThemeFor } from '../src/render/hoard_room_themes_core';
import {
  type HoardValleyLayoutInput,
  hoardValleyProfile,
  hoardValleySpanAtZ,
} from '../src/render/hoard_valley_core';
import { DEV_HOARD_DESTINATIONS, devHoardDestination } from '../src/sim/dev/hoard_travel';
import { RIFT_RANK_BASE_LEVEL } from '../src/sim/rift/ranks';
import { generateRiftFloor, generateRiftPlan } from '../src/sim/rift/rift_gen';

interface Room {
  theme: BossRoomTheme;
  layout: HoardValleyLayoutInput;
  seed: number;
  zone: string;
}

/** The real room of every hoard boss the dev travel reaches, with the theme the
 *  renderer would pick for it: the boss spawn's template decides, as in the game. */
function realRooms(): Room[] {
  const rooms: Room[] = [];
  for (const { boss, zone } of DEV_HOARD_DESTINATIONS) {
    const destination = devHoardDestination(boss);
    if (!destination) throw new Error(`no ${boss} hoard seed`);
    const plan = generateRiftPlan(destination.seed, RIFT_RANK_BASE_LEVEL.S);
    const floor = generateRiftFloor(destination.seed, RIFT_RANK_BASE_LEVEL.S, plan.floorCount - 1);
    const theme = bossRoomThemeFor(floor.spawns.find((spawn) => spawn.boss)?.templateId);
    if (theme) rooms.push({ theme, layout: floor.layout, seed: floor.seed, zone });
  }
  return rooms;
}

/** A plain box room of another size: a theme must not depend on one layout. */
function boxRoom(halfX: number, depth: number): HoardValleyLayoutInput {
  return {
    zMin: 0,
    zMax: depth,
    floorHalfX: halfX,
    dais: { x: 0, z: depth - 18, r: 12 },
    shellPolygon: [
      { x: halfX, z: 0 },
      { x: halfX, z: depth },
      { x: -halfX, z: depth },
      { x: -halfX, z: 0 },
    ],
  };
}

const key = (p: RoomKitPlacement) =>
  `${p.piece}@${p.x.toFixed(3)},${p.z.toFixed(3)},${p.yaw.toFixed(3)}`;

const ROOMS = realRooms();

describe('boss room themes', () => {
  it('give every themed boss one room, found by the boss who lives in it', () => {
    expect(bossRoomThemeFor(undefined)).toBeNull();
    expect(bossRoomThemeFor('rift_boss_nobody')).toBeNull();
    expect(bossRoomThemeFor('rift_boss_ember')?.id).toBe('forge');
    const bosses = BOSS_ROOM_THEMES.map((theme) => theme.boss);
    expect(new Set(bosses).size).toBe(bosses.length);
    expect(new Set(BOSS_ROOM_THEMES.map((theme) => theme.id)).size).toBe(bosses.length);
    // Every theme is reachable in the real game, not just declared.
    expect(ROOMS.map((room) => room.theme.id).sort()).toEqual(
      BOSS_ROOM_THEMES.map((theme) => theme.id).sort(),
    );
  });

  it('only name pieces, tones and emitters that exist', () => {
    for (const theme of BOSS_ROOM_THEMES) {
      const pieces = new Set(theme.pieces);
      const tones = new Set(Object.keys(theme.tones));
      const used = [
        theme.hero.piece,
        ...theme.hero.flank.map((flank) => flank.piece),
        ...theme.clusters.flatMap((cluster) => cluster.puts.map((put) => put.piece)),
        ...(theme.ambient.sway ?? []),
        ...(theme.ambient.hover ?? []),
        ...Object.keys(theme.ambient.particles?.emitters ?? {}),
      ];
      for (const piece of used) expect(pieces.has(piece), `${theme.id}: ${piece}`).toBe(true);
      // Nothing modelled and then forgotten.
      for (const piece of pieces) expect(used.includes(piece), `${theme.id}: ${piece}`).toBe(true);
      const toned = [
        ...(theme.hero.floor ?? []).map((mark) => mark.tone),
        ...theme.clusters.flatMap((cluster) => (cluster.floor ?? []).map((mark) => mark.tone)),
        ...(theme.floor.rings ?? []).map((ring) => ring[2]),
        ...(theme.floor.wallRuns ?? []).map((run) => run[2]),
        ...(theme.floor.scatter ?? []).map((scatter) => scatter.tone),
      ];
      for (const tone of toned) expect(tones.has(tone), `${theme.id}: tone ${tone}`).toBe(true);
      expect(theme.clusters.length, `${theme.id} clusters`).toBeGreaterThanOrEqual(3);
    }
  });

  it('bring their own palette: the dig site never paints over who lives here', () => {
    for (const { theme, zone } of ROOMS) {
      const biome = hoardValleyProfile(zone as Parameters<typeof hoardValleyProfile>[0]);
      const room = themedRoomProfile(biome, theme);
      for (const name of ['fogColor', 'ground', 'groundLight', 'cliff', 'cliffLight'] as const) {
        expect(room[name], `${theme.id} ${name}`).toBe(theme.palette[name]);
      }
      expect(themedRoomProfile(biome, null)).toBe(biome);
    }
  });

  it('keep the floor of the fight quiet: only wall-side marks may glow', () => {
    for (const { theme, layout, seed } of ROOMS) {
      const plan = buildBossRoomPlan(theme, layout, seed, 'high');
      for (const mark of plan.floor) {
        if (!theme.tones[mark.tone].lit || mark.shape === 'fan') continue;
        const span = hoardValleySpanAtZ(layout, Math.min(layout.zMax - 0.01, mark.z));
        const toSide = Math.min(mark.x - span.minX, span.maxX - mark.x);
        expect(
          Math.min(toSide, layout.zMax - mark.z),
          `${theme.id} lit ${mark.tone} at ${mark.x.toFixed(1)},${mark.z.toFixed(1)}`,
        ).toBeLessThanOrEqual(ROOM_KIT_WALL_BAND);
      }
    }
  });
});

describe('boss room plan', () => {
  it('is decided by the seed: one hoard, one room, for every player', () => {
    for (const { theme, layout, seed } of ROOMS) {
      const a = buildBossRoomPlan(theme, layout, seed, 'high');
      expect(buildBossRoomPlan(theme, layout, seed, 'high')).toEqual(a);
      const other = buildBossRoomPlan(theme, layout, seed + 1, 'high');
      expect(other.placements.map(key), theme.id).not.toEqual(a.placements.map(key));
    }
  });

  it('sets ONE hero piece into the end wall, behind the boss, facing the room', () => {
    for (const { theme, layout, seed } of ROOMS) {
      for (const tier of ['high', 'medium', 'low'] as const) {
        const heroes = buildBossRoomPlan(theme, layout, seed, tier).placements.filter(
          (p) => p.category === 'hero',
        );
        expect(heroes, theme.id).toHaveLength(1);
        expect(heroes[0].piece).toBe(theme.hero.piece);
        expect(heroes[0].z).toBeGreaterThan(layout.dais.z + layout.dais.r * 0.5);
        expect(heroes[0].z).toBeLessThanOrEqual(layout.zMax);
        expect(heroes[0].yaw).toBeCloseTo(Math.PI, 6);
      }
    }
  });

  it('keeps every prop against a wall and off the ground of the boss: the fight stays clear', () => {
    for (const room of ROOMS) {
      for (const { layout, seed } of [
        room,
        { layout: boxRoom(30, 90), seed: 7 },
        { layout: boxRoom(46, 170), seed: 99 },
      ]) {
        const plan = buildBossRoomPlan(room.theme, layout, seed, 'high');
        expect(plan.placements.length, room.theme.id).toBeGreaterThan(10);
        for (const p of plan.placements) {
          if (p.category === 'hero') continue;
          const span = hoardValleySpanAtZ(layout, Math.min(layout.zMax - 0.01, p.z));
          const toSide = Math.min(p.x - span.minX, span.maxX - p.x);
          const toBack = layout.zMax - p.z;
          expect(
            Math.min(toSide, toBack),
            `${room.theme.id} ${p.piece} at ${p.x},${p.z}`,
          ).toBeLessThanOrEqual(ROOM_KIT_WALL_BAND);
          // Inside the room, never out in the rock.
          expect(toSide, `${room.theme.id} ${p.piece} inside`).toBeGreaterThan(0);
          expect(
            Math.hypot(p.x - layout.dais.x, p.z - layout.dais.z),
            `${room.theme.id} ${p.piece} off the dais`,
          ).toBeGreaterThanOrEqual(layout.dais.r + ROOM_KIT_DAIS_CLEAR);
        }
        // Both walls are dressed, and not as mirror images.
        const left = plan.placements.filter((p) => p.x < -5 && p.category !== 'hero');
        const right = plan.placements.filter((p) => p.x > 5 && p.category !== 'hero');
        expect(left.length).toBeGreaterThan(3);
        expect(right.length).toBeGreaterThan(3);
        expect(left.map((p) => `${p.piece}@${p.z.toFixed(1)}`)).not.toEqual(
          right.map((p) => `${p.piece}@${p.z.toFixed(1)}`),
        );
      }
    }
  });

  it('sheds by tier without moving anything: low is a subset of medium of high', () => {
    for (const { theme, layout, seed } of ROOMS) {
      const high = buildBossRoomPlan(theme, layout, seed, 'high');
      const medium = buildBossRoomPlan(theme, layout, seed, 'medium');
      const low = buildBossRoomPlan(theme, layout, seed, 'low');
      const inHigh = new Set(high.placements.map(key));
      const inMedium = new Set(medium.placements.map(key));
      for (const p of medium.placements) expect(inHigh.has(key(p))).toBe(true);
      for (const p of low.placements) expect(inMedium.has(key(p))).toBe(true);
      expect(low.placements.length, theme.id).toBeLessThan(medium.placements.length);
      expect(medium.placements.length, theme.id).toBeLessThan(high.placements.length);
      // Low keeps the room's identity: the hero, big silhouettes, the floor's lines.
      expect(low.placements.every((p) => p.category === 'hero' || p.category === 'large')).toBe(
        true,
      );
      expect(low.placements.some((p) => p.piece === theme.hero.piece)).toBe(true);
      expect(low.placements.filter((p) => p.category === 'large').length).toBeLessThanOrEqual(6);
      expect(medium.placements.some((p) => p.category === 'filler')).toBe(false);
      expect(low.floor.length, theme.id).toBeGreaterThan(0);
      expect(low.floor.length).toBeLessThanOrEqual(high.floor.length);
    }
  });

  it('keeps the forge molten channels at the foot of the walls, never across the fight', () => {
    const room = ROOMS.find((candidate) => candidate.theme.id === 'forge');
    if (!room) throw new Error('no forge room');
    const plan = buildBossRoomPlan(room.theme, room.layout, room.seed, 'high');
    const channels = plan.floor.filter((m) => m.tone === 'channel' || m.tone === 'channelEdge');
    expect(channels.length).toBeGreaterThan(10);
    for (const mark of channels) {
      const span = hoardValleySpanAtZ(room.layout, Math.min(room.layout.zMax - 0.01, mark.z));
      const toSide = Math.min(mark.x - span.minX, span.maxX - mark.x);
      expect(Math.min(toSide, room.layout.zMax - mark.z)).toBeLessThanOrEqual(4);
    }
    expect(plan.floor.some((m) => m.tone === 'channel' && room.theme.tones[m.tone].lit)).toBe(true);
  });
});

describe('boss room kit view', () => {
  afterEach(() => hoardRoomKitInternalsForTest.clear());

  function fakeKit(theme: BossRoomTheme): THREE.Group {
    const scene = new THREE.Group();
    for (const piece of theme.pieces) {
      const node = new THREE.Group();
      node.name = `Kit_${piece}`;
      for (const name of ['KitSolid', 'KitGlow']) {
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        geometry.setAttribute(
          'color',
          new THREE.BufferAttribute(
            new Float32Array(geometry.getAttribute('position').count * 4).fill(0.5),
            4,
          ),
        );
        const material = new THREE.MeshStandardMaterial();
        material.name = name;
        node.add(new THREE.Mesh(geometry, material));
      }
      scene.add(node);
    }
    return scene;
  }

  it('draws the whole room in instances: two draws a piece, never one per prop', () => {
    for (const { theme, layout, seed } of ROOMS) {
      hoardRoomKitInternalsForTest.seedScene(theme.kitUrl, fakeKit(theme));
      expect(hoardRoomKitInternalsForTest.pieces(theme.kitUrl).sort()).toEqual(
        [...theme.pieces].sort(),
      );
      const plan = buildBossRoomPlan(theme, layout, seed, 'high');
      const view = buildHoardRoomKit(plan, 'high', false);
      const instanced = view.group.children.filter(
        (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
      );
      expect(instanced.length).toBeLessThanOrEqual(theme.pieces.length * 2);
      for (const piece of theme.pieces) {
        const wanted = plan.placements.filter((p) => p.piece === piece).length;
        for (const mesh of instanced.filter((m) => m.name === `HoardRoomKit:${piece}`)) {
          expect(mesh.count).toBe(wanted);
        }
      }
      // Floor marks, lit marks, wall light, particles: a handful of draws, whatever the room.
      expect(view.group.children.length, theme.id).toBeLessThanOrEqual(theme.pieces.length * 2 + 4);
      if (theme.ambient.particles) {
        expect(view.group.getObjectByName('HoardRoomKitParticles'), theme.id).toBeDefined();
      }
      expect(() => {
        view.update(1.25);
        view.update(2.5);
      }).not.toThrow();
      view.dispose();
      view.dispose();
    }
  });

  it('sheds the particles and the motion on the low tier, and survives a kit that never loaded', () => {
    for (const { theme, layout, seed } of ROOMS) {
      const bare = buildHoardRoomKit(buildBossRoomPlan(theme, layout, seed, 'high'), 'high', false);
      // No kit yet: only the floor is drawn, nothing throws, and the room is not held up.
      expect(bare.ready).toBeNull();
      expect(bare.group.children.some((child) => child instanceof THREE.InstancedMesh)).toBe(false);
      bare.dispose();
      hoardRoomKitInternalsForTest.seedScene(theme.kitUrl, fakeKit(theme));
      const low = buildHoardRoomKit(buildBossRoomPlan(theme, layout, seed, 'low'), 'low', false);
      expect(low.group.getObjectByName('HoardRoomKitParticles'), theme.id).toBeUndefined();
      expect(low.group.getObjectByName(`HoardRoomKit:${theme.hero.piece}`)).toBeDefined();
      low.dispose();
      hoardRoomKitInternalsForTest.clear();
    }
  });
});

describe('the shipped boss room kits', () => {
  const assets = [...FORGE_ASSETS, ...ROOM_ASSETS];

  it('never load at boot: a kit is fetched with its own room', async () => {
    const { readFileSync } = await import('node:fs');
    const painter = readFileSync('src/render/hoard_room_kit.ts', 'utf8');
    expect(painter).not.toMatch(/registerDeferredPreload|registerPreload/);
    expect(painter).toMatch(/releaseGltf\(url\)/);
  });

  it('are one built, committed kit per theme', () => {
    expect(assets.map((asset) => asset.target).sort()).toEqual(
      BOSS_ROOM_THEMES.map((theme) => `public${theme.kitUrl}`).sort(),
    );
  });

  it('exist, keep their named parts and two materials, carry painted colours, and are small', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    for (const theme of BOSS_ROOM_THEMES) {
      const asset = assets.find((candidate) => candidate.target === `public${theme.kitUrl}`);
      if (!asset) throw new Error(`no built kit for ${theme.id}`);
      expect(existsSync(asset.source), asset.source).toBe(true);
      expect(existsSync(asset.target), asset.target).toBe(true);
      const shipped = (await io.read(asset.target)).getRoot();
      expect(
        shipped
          .listNodes()
          .map((node) => node.getName())
          .sort(),
      ).toEqual(asset.nodes);
      expect(asset.nodes.filter((name) => name.startsWith('Kit_')).sort()).toEqual(
        theme.pieces.map((piece) => `Kit_${piece}`).sort(),
      );
      const materials = shipped
        .listMaterials()
        .map((material) => material.getName())
        .sort();
      expect(materials).toEqual(asset.materials);
      // One painted material, one that glows: the painter tells them apart by name.
      expect(materials).toHaveLength(2);
      expect(materials.filter((name) => /molten|glow/i.test(name))).toHaveLength(1);
      const extras = shipped.getExtras() as { authoring?: string; sourceFingerprint?: string };
      expect(extras.authoring).toBe('Blender');
      // A Blender source edited without re-running the builder is caught here.
      const fingerprint = FORGE_ASSETS.includes(asset) ? forgeFingerprint : roomFingerprint;
      expect(extras.sourceFingerprint, asset.target).toBe(fingerprint(asset));
      expect(shipped.listTextures()).toHaveLength(0);
      let triangles = 0;
      for (const mesh of shipped.listMeshes()) {
        for (const primitive of mesh.listPrimitives()) {
          triangles += (primitive.getIndices()?.getCount() ?? 0) / 3;
          // The room is unlit: a part without its painted colours would be a white block.
          expect(primitive.getAttribute('COLOR_0'), theme.id).not.toBeNull();
        }
      }
      expect(triangles, theme.id).toBeGreaterThan(2000);
      expect(triangles, theme.id).toBeLessThan(12000);
    }
  });
});
