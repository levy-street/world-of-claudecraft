// The Emberdeep Foundry, the relit forge of the mountain clans under the
// southwest crags of Thornpeak Heights. Verifies the dungeon is registered at
// its own instance band, enterable with its full spawn set, that the boss
// mechanics fire, the new 'foundry' interior collides, and the quest chain +
// boss loot table hang together. Mirrors tests/temple.test.ts.
import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { DUNGEON_LIST, DUNGEONS, ITEMS, instanceOrigin, MOBS, NPCS, QUESTS } from '../src/sim/data';
import { FOUNDRY_LAYOUT, layoutColliders } from '../src/sim/dungeon_layout';
import { Sim } from '../src/sim/sim';
import { dist2d } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

describe('Emberdeep Foundry layout', () => {
  it('is a three-chamber gauntlet on the standard shell', () => {
    expect(FOUNDRY_LAYOUT.zMin).toBe(-19);
    expect(FOUNDRY_LAYOUT.zMax).toBe(132);
    // two chamber-waist stubs: assembly hall -> casting halls -> forge heart
    const stubZs = [...new Set(FOUNDRY_LAYOUT.stubs.map((s) => s.z))].sort((a, b) => a - b);
    expect(stubZs).toEqual([48, 96]);
    // every stub leaves the 10u centre passage (|x| <= 5) open
    for (const s of FOUNDRY_LAYOUT.stubs) expect(Math.abs(s.x) - s.hw).toBeGreaterThanOrEqual(5);
    // the boss dais is inside the forge heart and walkable (no collider for it)
    expect(FOUNDRY_LAYOUT.dais.z).toBeGreaterThan(96);
    const colliders = layoutColliders(FOUNDRY_LAYOUT);
    const daisHit = colliders.some(
      (c) => c.type === 'circle' && Math.hypot(c.x - 0, c.z - FOUNDRY_LAYOUT.dais.z) < 2,
    );
    expect(daisHit).toBe(false);
  });
});

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function nearestMob(sim: Sim, templateId: string, from: { x: number; z: number }) {
  let best: any = null,
    bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.templateId !== templateId) continue;
    const d = Math.hypot(e.pos.x - from.x, e.pos.z - from.z);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

describe('Emberdeep Foundry', () => {
  it('is registered as an endgame dungeon at its own instance band', () => {
    const f = DUNGEONS.emberdeep_foundry;
    expect(f).toBeTruthy();
    expect(f.index).toBe(6);
    expect(f.interior).toBe('foundry');
    expect(f.suggestedPlayers).toBe(5);
    expect(DUNGEON_LIST.some((d) => d.id === 'emberdeep_foundry')).toBe(true);
    // index-6 origin: x = 900 + 6*600
    expect(instanceOrigin(6, 0).x).toBe(4500);
    // the door sits past Drogmar's War-Camp in the zone southwest
    expect(f.doorPos.x).toBeLessThan(-140);
    expect(f.doorPos.z).toBeGreaterThan(760);
  });
});
