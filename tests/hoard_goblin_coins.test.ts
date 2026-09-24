// The Coinsack Scurrier's coins on screen: the pure look (flight, bounce, rest,
// sink) and the adapter that bursts them only when a LIVING goblin dies.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HoardGoblinCoinsFx } from '../src/render/hoard_goblin_coins';
import {
  COIN_LOOK,
  type CoinBurst,
  coinGlint,
  coinScale,
  goblinDeaths,
  makeCoin,
  spawnCoins,
  stepCoin,
  type WatchedEntity,
} from '../src/render/hoard_goblin_coins_core';
import { HOARD_GOBLIN_TEMPLATE_ID } from '../src/sim/rift/hoard_goblin';
import type { IWorld } from '../src/world_api';

const FLAT = () => 0;
const coins = (n = COIN_LOOK.count) => Array.from({ length: n }, makeCoin);
const settle = (list: ReturnType<typeof coins>, ground: (x: number, z: number) => number) => {
  for (let t = 0; t < 4; t += 1 / 60) for (const c of list) stepCoin(c, 1 / 60, ground);
};

describe('the coin look (pure)', () => {
  it('throws every coin up out of the sack, then lays them all flat on the floor', () => {
    const list = coins();
    spawnCoins(list, 10, -5, 0, FLAT, 42, false);
    for (const c of list) {
      expect(c.y).toBeGreaterThan(1);
      expect(c.vy).toBeGreaterThan(0);
      expect(c.resting).toBe(false);
    }
    settle(list, FLAT);
    for (const c of list) {
      expect(c.resting).toBe(true);
      expect(c.y).toBeCloseTo(COIN_LOOK.thickness / 2, 9);
      expect(c.rx).toBe(0);
      expect(c.rz).toBe(0);
      // Scattered round the body, never flung out of the room.
      expect(Math.hypot(c.x - 10, c.z + 5)).toBeLessThan(6);
    }
    // Spread all the way round: every quarter of the ring has coins in it.
    const quarters = new Set(
      list.map((c) => Math.floor(((Math.atan2(c.x - 10, c.z + 5) + Math.PI) / (Math.PI * 2)) * 4)),
    );
    expect(quarters.size).toBe(4);
  });

  it('lands on the floor where each coin falls (a raised dais included)', () => {
    const dais = (x: number) => (x > 10 ? 3.2 : 0);
    const list = coins();
    spawnCoins(list, 10, 0, 0, dais, 7, false);
    settle(list, dais);
    for (const c of list) expect(c.y).toBeCloseTo(dais(c.x) + COIN_LOOK.thickness / 2, 9);
  });

  it('bursts from the sack on the back, not the chest', () => {
    const list = coins();
    // Facing +z: the sack is behind, toward -z.
    spawnCoins(list, 0, 0, 0, FLAT, 3, false);
    const meanZ = list.reduce((s, c) => s + c.z, 0) / list.length;
    expect(meanZ).toBeLessThan(0);
  });

  it('skips the flight under reduced motion: the coins are already lying there', () => {
    const list = coins();
    spawnCoins(list, 0, 0, 0, FLAT, 9, true);
    for (const c of list) {
      expect(c.resting).toBe(true);
      expect(c.y).toBeCloseTo(COIN_LOOK.thickness / 2, 9);
    }
  });

  it('scatters the same way every time for the same burst', () => {
    const a = coins();
    const b = coins();
    spawnCoins(a, 1, 2, 0.5, FLAT, 11, false);
    spawnCoins(b, 1, 2, 0.5, FLAT, 11, false);
    expect(a).toEqual(b);
  });

  it('lies whole, then sinks away, and flashes as the sack bursts', () => {
    expect(coinScale(0)).toBe(1);
    expect(coinScale(COIN_LOOK.restSec)).toBe(1);
    expect(coinScale(COIN_LOOK.restSec + COIN_LOOK.sinkSec / 2)).toBeGreaterThan(0);
    expect(coinScale(COIN_LOOK.restSec + COIN_LOOK.sinkSec / 2)).toBeLessThan(1);
    expect(coinScale(COIN_LOOK.restSec + COIN_LOOK.sinkSec)).toBe(0);
    expect(COIN_LOOK.lifeSec).toBeGreaterThanOrEqual(COIN_LOOK.restSec + COIN_LOOK.sinkSec);
    expect(coinGlint(0, 0, 0)).toBe(1);
  });
});

const goblin = (id: number, dead: boolean, templateId = HOARD_GOBLIN_TEMPLATE_ID) =>
  ({ id, templateId, dead, pos: { x: 4, z: 6 }, facing: 1 }) as WatchedEntity;

describe('when the coins fly (pure)', () => {
  it('bursts only for a goblin seen alive and now dead', () => {
    const seen = new Map<number, boolean>();
    const out: CoinBurst[] = [];
    expect(goblinDeaths([goblin(1, false)], HOARD_GOBLIN_TEMPLATE_ID, seen, out)).toHaveLength(0);
    const died = goblinDeaths([goblin(1, true)], HOARD_GOBLIN_TEMPLATE_ID, seen, out);
    expect(died).toEqual([{ id: 1, x: 4, z: 6, facing: 1 }]);
    // Once only.
    expect(goblinDeaths([goblin(1, true)], HOARD_GOBLIN_TEMPLATE_ID, seen, out)).toHaveLength(0);
  });

  it('stays quiet for a body already dead on arrival, an escape, and other mobs', () => {
    const seen = new Map<number, boolean>();
    const out: CoinBurst[] = [];
    expect(goblinDeaths([goblin(2, true)], HOARD_GOBLIN_TEMPLATE_ID, seen, out)).toHaveLength(0);
    goblinDeaths([goblin(3, false)], HOARD_GOBLIN_TEMPLATE_ID, seen, out);
    // It escaped: gone from the world, never dead.
    expect(goblinDeaths([], HOARD_GOBLIN_TEMPLATE_ID, seen, out)).toHaveLength(0);
    expect(seen.size).toBe(0);
    goblinDeaths([goblin(4, false, 'rift_boss_venom')], HOARD_GOBLIN_TEMPLATE_ID, seen, out);
    expect(
      goblinDeaths([goblin(4, true, 'rift_boss_venom')], HOARD_GOBLIN_TEMPLATE_ID, seen, out),
    ).toHaveLength(0);
  });
});

describe('the adapter', () => {
  const worldWith = (dead: { value: boolean }, inRift = true) => {
    const entity = {
      id: 9,
      kind: 'mob',
      templateId: HOARD_GOBLIN_TEMPLATE_ID,
      pos: { x: 5, y: 0, z: 5 },
      facing: 0,
      get dead() {
        return dead.value;
      },
    };
    return { riftFloor: inRift ? {} : null, entities: new Map([[9, entity]]) } as unknown as IWorld;
  };
  const coinMesh = (scene: THREE.Scene) =>
    scene.getObjectByName('GoblinCoins') as THREE.InstancedMesh;
  // A coin is drawn when its instance matrix has any size (the idle ones are
  // scaled to nothing).
  const drawnCoins = (mesh: THREE.InstancedMesh) => {
    const m = new THREE.Matrix4();
    let n = 0;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      if (Math.hypot(m.elements[0], m.elements[1], m.elements[2]) > 1e-6) n++;
    }
    return n;
  };

  it('bursts when the goblin dies, lays the coins down, then lets them go', async () => {
    const scene = new THREE.Scene();
    const dead = { value: false };
    const fx = new HoardGoblinCoinsFx(
      scene,
      () => 0,
      worldWith(dead),
      undefined,
      () => false,
      'high',
    );
    await fx.readyForEntry;
    fx.update(0.2);
    expect(coinMesh(scene).visible).toBe(false);
    dead.value = true;
    fx.update(0.2);
    expect(coinMesh(scene).visible).toBe(true);
    expect(drawnCoins(coinMesh(scene))).toBe(COIN_LOOK.count);
    for (let t = 0; t < COIN_LOOK.lifeSec + 0.5; t += 0.1) fx.update(0.1);
    expect(coinMesh(scene).visible).toBe(false);
    expect(drawnCoins(coinMesh(scene))).toBe(0);
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('throws fewer coins on the low tier, but still throws them', async () => {
    const scene = new THREE.Scene();
    const dead = { value: false };
    const fx = new HoardGoblinCoinsFx(
      scene,
      () => 0,
      worldWith(dead),
      undefined,
      () => false,
      'low',
    );
    await fx.readyForEntry;
    fx.update(0.2);
    dead.value = true;
    fx.update(0.2);
    expect(drawnCoins(coinMesh(scene))).toBe(COIN_LOOK.lowCount);
    expect(scene.getObjectByName('GoblinCoinGlints')).toBeUndefined();
    fx.dispose();
  });

  it('does nothing outside a rift floor', async () => {
    const scene = new THREE.Scene();
    const dead = { value: false };
    const fx = new HoardGoblinCoinsFx(
      scene,
      () => 0,
      worldWith(dead, false),
      undefined,
      () => false,
      'high',
    );
    await fx.readyForEntry;
    fx.update(0.2);
    dead.value = true;
    fx.update(0.2);
    expect(coinMesh(scene).visible).toBe(false);
    fx.dispose();
  });
});
