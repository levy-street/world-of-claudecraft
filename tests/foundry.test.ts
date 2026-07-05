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
    expect(f.index).toBe(10);
    expect(f.interior).toBe('foundry');
    expect(f.suggestedPlayers).toBe(5);
    expect(DUNGEON_LIST.some((d) => d.id === 'emberdeep_foundry')).toBe(true);
    // index-10 origin: x = 900 + 10*600 (bands 6-9 are the reserved arena/delve window)
    expect(instanceOrigin(10, 0).x).toBe(6900);
    // the door sits past Drogmar's War-Camp in the zone southwest
    expect(f.doorPos.x).toBeLessThan(-140);
    expect(f.doorPos.z).toBeGreaterThan(760);
  });

  it('is enterable through the forge door with its full spawn set, and exits home', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const door = DUNGEONS.emberdeep_foundry.doorPos;
    teleport(sim, a, door.x, door.z);
    sim.enterDungeon('emberdeep_foundry', a);
    const ea = sim.entities.get(a)!;
    expect(ea.pos.x).toBeGreaterThan(6800); // index-10 band (~6900)
    const slot = sim.instanceSlotAt(ea.pos)!;
    const origin = instanceOrigin(10, slot);

    const colossus = nearestMob(sim, 'slagheart_colossus', origin);
    expect(colossus).toBeTruthy();
    expect(colossus.level).toBe(20);
    expect(nearestMob(sim, 'kilnmaster_vorr', origin)).toBeTruthy();
    expect(nearestMob(sim, 'forgeguard_sentinel', origin)).toBeTruthy();

    sim.leaveDungeon(a);
    expect(dist2d(ea.pos, { x: door.x, y: 0, z: door.z })).toBeLessThan(10);
  });

  it('Kilnmaster Vorr summons Cinder Wisps at hp thresholds and enrages below 30%', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const door = DUNGEONS.emberdeep_foundry.doorPos;
    teleport(sim, a, door.x, door.z);
    sim.enterDungeon('emberdeep_foundry', a);
    const ea = sim.entities.get(a)!;
    const origin = instanceOrigin(10, sim.instanceSlotAt(ea.pos)!);

    const vorr = nearestMob(sim, 'kilnmaster_vorr', origin);
    expect(vorr).toBeTruthy();
    expect(vorr.enraged).toBe(false);
    const wispsNear = () =>
      [...sim.entities.values()].filter(
        (e) =>
          e.kind === 'mob' &&
          !e.dead &&
          e.templateId === 'cinder_wisp' &&
          Math.abs(e.pos.x - origin.x) < 120,
      ).length;
    expect(wispsNear()).toBe(0);

    vorr.inCombat = true;
    vorr.hp = Math.floor(vorr.maxHp * 0.65);
    sim.tick();
    expect(wispsNear()).toBe(2); // first wave of 2

    vorr.hp = Math.floor(vorr.maxHp * 0.29);
    sim.tick();
    expect(wispsNear()).toBe(4); // second wave -> 4 total
    expect(vorr.enraged).toBe(true);
  });

  it('the Slagheart Colossus enrages below 25% and carries the Slag Eruption pulse', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const door = DUNGEONS.emberdeep_foundry.doorPos;
    teleport(sim, a, door.x, door.z);
    sim.enterDungeon('emberdeep_foundry', a);
    const ea = sim.entities.get(a)!;
    const origin = instanceOrigin(10, sim.instanceSlotAt(ea.pos)!);

    const colossus = nearestMob(sim, 'slagheart_colossus', origin);
    expect(colossus).toBeTruthy();
    expect(MOBS.slagheart_colossus.aoePulse?.name).toBe('Slag Eruption');
    expect(colossus.enraged).toBe(false);
    colossus.inCombat = true;
    colossus.hp = Math.floor(colossus.maxHp * 0.2);
    sim.tick();
    expect(colossus.enraged).toBe(true);
  });

  it('the new foundry interior has solid walls, stubs and pillars but a walkable dais', () => {
    const sim = makeWorld();
    const o = instanceOrigin(10, 0);
    const seed = sim.cfg.seed;
    expect(isBlocked(seed, o.x + 0, o.z + 8)).toBe(false); // open entry aisle
    expect(isBlocked(seed, o.x + 23, o.z + 8)).toBe(true); // side wall at |x|=23
    expect(isBlocked(seed, o.x + 14, o.z + 10)).toBe(true); // colonnade pillar
    expect(isBlocked(seed, o.x + 14, o.z + 48)).toBe(true); // first chamber waist
    expect(isBlocked(seed, o.x + 0, o.z + 48)).toBe(false); // 10u centre passage
    expect(isBlocked(seed, o.x + 14, o.z + 96)).toBe(true); // second chamber waist
    expect(isBlocked(seed, o.x + 0, o.z + 116)).toBe(false); // anvil dais walkable
  });

  it('the Colossus epic drop table is an exclusive one-of-three and resolves to real items', () => {
    const colossus = MOBS.slagheart_colossus;
    const group = colossus.loot.filter((l) => l.rollGroup === 'slagheart_epic');
    expect(group.length).toBe(3);
    const sum = group.reduce((s, l) => s + l.chance, 0);
    expect(sum).toBeCloseTo(1.0, 5);
    for (const l of colossus.loot) {
      if (l.itemId) expect(ITEMS[l.itemId], `loot item ${l.itemId}`).toBeTruthy();
    }
    // pre-raid best: each rollGroup drop is an epic helmet, one per archetype
    for (const l of group) {
      const item = ITEMS[l.itemId!];
      expect(item.quality).toBe('epic');
      expect(item.slot).toBe('helmet');
    }
  });

  it('the Forgewright offers a self-contained chain ending at the 5-player finale', () => {
    const brenna = NPCS.forgewright_brenna;
    expect(brenna).toBeTruthy();
    const chain = [
      'q_foundry_smoke',
      'q_foundry_pickets',
      'q_foundry_hounds',
      'q_foundry_sigils',
      'q_foundry_ashmaw',
      'q_foundry_kilnmaster',
      'q_foundry_slagheart',
    ];
    for (const q of chain) {
      expect(QUESTS[q], `quest ${q}`).toBeTruthy();
      expect(brenna.questIds).toContain(q);
    }
    expect(QUESTS.q_foundry_pickets.requiresQuest).toBe('q_foundry_smoke');
    expect(QUESTS.q_foundry_hounds.requiresQuest).toBe('q_foundry_pickets');
    expect(QUESTS.q_foundry_sigils.requiresQuest).toBe('q_foundry_pickets');
    expect(QUESTS.q_foundry_ashmaw.requiresQuest).toBe('q_foundry_hounds');
    expect(QUESTS.q_foundry_kilnmaster.requiresQuest).toBe('q_foundry_sigils');
    expect(QUESTS.q_foundry_slagheart.requiresQuest).toBe('q_foundry_kilnmaster');
    expect(QUESTS.q_foundry_slagheart.suggestedPlayers).toBe(5);
    expect(QUESTS.q_foundry_slagheart.objectives[0].targetMobId).toBe('slagheart_colossus');
  });

  it('is deterministic: the same seed spawns the same instance', () => {
    const run = () => {
      const sim = makeWorld();
      const a = sim.addPlayer('warrior', 'Aleph');
      const door = DUNGEONS.emberdeep_foundry.doorPos;
      teleport(sim, a, door.x, door.z);
      sim.enterDungeon('emberdeep_foundry', a);
      for (let i = 0; i < 20 * 5; i++) sim.tick();
      return [...sim.entities.values()]
        .filter((e) => e.kind === 'mob' && e.pos.x > 6800)
        .map((e) => [e.templateId, Math.round(e.pos.x * 100), Math.round(e.pos.z * 100), e.hp]);
    };
    expect(run()).toEqual(run());
  });
});
