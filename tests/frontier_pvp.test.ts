import { beforeEach, describe, expect, it } from 'vitest';
import {
  DELVE_BAND_X_MIN,
  isArenaPos,
  isDelvePos,
  isYumiMazePos,
  MOBS,
  YUMI_BAND_X_MAX,
} from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  FRONTIER_HUB,
  FRONTIER_RARE_HERO_POINTS,
  FRONTIER_RARE_HONOR,
  FRONTIER_X_MAX,
  FRONTIER_X_MIN,
  grantHeroPoints,
  inFrontierHub,
  isFrontierPos,
  normalizeHeroPoints,
  spendHeroPoints,
} from '../src/sim/pvp';
import { Sim } from '../src/sim/sim';

const makeSim = (seed = 7) => new Sim({ seed, playerClass: 'warrior', autoEquip: true });

describe('Frontier band geometry', () => {
  it('sits past every other far-off band and never overlaps one', () => {
    // Sampled across the whole far-east x-range: no x is BOTH frontier and
    // (arena | delve | yumi), so hostility/instance routing never collide.
    for (let x = 0; x <= 32000; x += 100) {
      const inFrontier = isFrontierPos(x);
      if (inFrontier) {
        expect(isArenaPos(x)).toBe(false);
        expect(isDelvePos(x)).toBe(false);
        expect(isYumiMazePos(x)).toBe(false);
      }
    }
    // The band opens past the yumi maze band and the delve band.
    expect(FRONTIER_X_MIN).toBeGreaterThan(YUMI_BAND_X_MAX);
    expect(FRONTIER_X_MIN).toBeGreaterThan(DELVE_BAND_X_MIN);
    expect(isFrontierPos(FRONTIER_X_MIN)).toBe(true);
    expect(isFrontierPos(FRONTIER_X_MAX)).toBe(false);
    expect(isFrontierPos(FRONTIER_X_MIN - 1)).toBe(false);
  });

  it('marks the safe hub perimeter', () => {
    expect(inFrontierHub(FRONTIER_HUB.x, FRONTIER_HUB.z)).toBe(true);
    expect(inFrontierHub(FRONTIER_HUB.x + 200, FRONTIER_HUB.z)).toBe(false);
  });
});

describe('Hero points currency', () => {
  it('normalizes junk to a non-negative integer', () => {
    expect(normalizeHeroPoints(undefined)).toBe(0);
    expect(normalizeHeroPoints(-5)).toBe(0);
    expect(normalizeHeroPoints(3.9)).toBe(3);
    expect(normalizeHeroPoints(Number.NaN)).toBe(0);
  });

  it('grants and spends, moving spendable and lifetime together', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.player.id)!;
    grantHeroPoints(sim.ctx, meta, 10, 'frontier_rare');
    expect(meta.heroPoints).toBe(10);
    expect(meta.lifetimeHeroPoints).toBe(10);
    expect(spendHeroPoints(meta, 4)).toBe(true);
    expect(meta.heroPoints).toBe(6);
    expect(meta.lifetimeHeroPoints).toBe(10); // lifetime never drops
    expect(spendHeroPoints(meta, 999)).toBe(false); // insufficient, no mutation
    expect(meta.heroPoints).toBe(6);
  });

  it('round-trips through serializeCharacter / addPlayer', () => {
    const sim = makeSim();
    grantHeroPoints(sim.ctx, sim.meta(sim.player.id)!, 42, 'frontier_rare');
    const state = sim.serializeCharacter(sim.player.id)!;
    expect(state.heroPoints).toBe(42);
    const sim2 = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Alt', { state });
    expect(sim2.meta(pid)!.heroPoints).toBe(42);
    expect(sim2.meta(pid)!.lifetimeHeroPoints).toBe(42);
  });
});

describe('Open-world PvP flagging in the Frontier', () => {
  let sim: Sim;
  beforeEach(() => {
    sim = new Sim({ seed: 3, playerClass: 'warrior', noPlayer: true });
  });

  function placePlayer(name: string, x: number, z: number) {
    const pid = sim.addPlayer('warrior', name);
    const e = sim.entities.get(pid)!;
    e.pos = { x, y: 1, z };
    e.prevPos = { ...e.pos };
    return e;
  }

  it('makes two players hostile inside the band, friendly outside', () => {
    const a = placePlayer('Aaa', FRONTIER_X_MIN + 200, 20);
    const b = placePlayer('Bbb', FRONTIER_X_MIN + 210, 25);
    expect(sim.isHostileTo(a, b)).toBe(true);
    expect(sim.isHostileTo(b, a)).toBe(true);
    // Move B out of the band: no longer hostile.
    b.pos = { x: 0, y: 1, z: 0 };
    expect(sim.isHostileTo(a, b)).toBe(false);
  });

  it('never flags players inside the safe hub', () => {
    const a = placePlayer('Ccc', FRONTIER_HUB.x, FRONTIER_HUB.z);
    const b = placePlayer('Ddd', FRONTIER_HUB.x + 2, FRONTIER_HUB.z + 2);
    expect(sim.isHostileTo(a, b)).toBe(false);
  });

  it('does not flag two overworld players', () => {
    const a = placePlayer('Eee', 0, 0);
    const b = placePlayer('Fff', 5, 5);
    expect(sim.isHostileTo(a, b)).toBe(false);
  });
});

describe('Frost rare kill reward', () => {
  it('drops honor and hero points to a contributor when a frost rare dies in the band', () => {
    const sim = new Sim({ seed: 5, playerClass: 'warrior', autoEquip: true });
    const player = sim.player;
    const meta = sim.meta(player.id)!;
    const x = FRONTIER_X_MIN + 300;
    player.pos = { x, y: 1, z: 40 };
    player.prevPos = { ...player.pos };
    sim.rebucket(player);
    const rare = createMob(90101, MOBS.rimefang_stalker, 20, sim.groundPos(x, 44));
    sim.addEntity(rare);
    const honorBefore = meta.honor;
    const heroBefore = meta.heroPoints;
    // Land a hit (registers the contributor), then the lethal blow.
    sim.dealDamage(player, rare, 50, false, 'physical', null, 'hit');
    sim.dealDamage(player, rare, rare.hp, false, 'physical', null, 'hit');
    sim.tick();
    expect(rare.dead).toBe(true);
    expect(meta.honor).toBe(honorBefore + FRONTIER_RARE_HONOR);
    expect(meta.heroPoints).toBe(heroBefore + FRONTIER_RARE_HERO_POINTS);
  });

  it('does not reward a rare killed OUTSIDE the band', () => {
    const sim = new Sim({ seed: 6, playerClass: 'warrior', autoEquip: true });
    const player = sim.player;
    const meta = sim.meta(player.id)!;
    player.pos = { x: 0, y: 1, z: 0 };
    player.prevPos = { ...player.pos };
    sim.rebucket(player);
    const rare = createMob(90102, MOBS.rimefang_stalker, 20, sim.groundPos(2, 2));
    sim.addEntity(rare);
    sim.dealDamage(player, rare, 50, false, 'physical', null, 'hit');
    sim.dealDamage(player, rare, rare.hp, false, 'physical', null, 'hit');
    sim.tick();
    expect(meta.honor).toBe(0);
    expect(meta.heroPoints).toBe(0);
  });
});
