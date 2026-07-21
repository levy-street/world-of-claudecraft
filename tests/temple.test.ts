// The Drowned Temple — the portal-reached side-wing on the Glimmermere.
// Verifies the moongate dungeon is registered, enterable with its full spawn
// set, that Ysolei's boss mechanics fire, the new 'temple' interior collides,
// and the lead-up quest chain + boss loot table hang together.
import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { DUNGEON_LIST, DUNGEONS, ITEMS, instanceOrigin, MOBS, NPCS, QUESTS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { dist2d } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

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

describe('The Drowned Temple', () => {
  it('is registered as a portal dungeon at its own instance band', () => {
    const t = DUNGEONS.drowned_temple;
    expect(t).toBeTruthy();
    expect(t.index).toBe(3);
    expect(t.interior).toBe('temple');
    expect(t.suggestedPlayers).toBe(5);
    // it joins the map-derived dungeon list (the moongate draws itself there)
    expect(DUNGEON_LIST.some((d) => d.id === 'drowned_temple')).toBe(true);
    // index-3 origin sits clear of the arena band (x >= 2800)
    expect(instanceOrigin(3, 0).x).toBe(2700);
  });

  it('is enterable through the moongate with its full spawn set, and exits home', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const door = DUNGEONS.drowned_temple.doorPos;
    teleport(sim, a, door.x, door.z);
    sim.enterDungeon('drowned_temple', a);
    const ea = sim.entities.get(a)!;
    expect(ea.pos.x).toBeGreaterThan(2600); // index-3 band (~2700)
    const slot = sim.instanceSlotAt(ea.pos)!;
    const origin = instanceOrigin(3, slot);

    const ysolei = nearestMob(sim, 'ysolei', origin);
    expect(ysolei).toBeTruthy();
    expect(ysolei.level).toBe(18);
    expect(nearestMob(sim, 'choirmother_selthe', origin)).toBeTruthy();
    expect(nearestMob(sim, 'pearlguard_sentinel', origin)).toBeTruthy();

    sim.leaveDungeon(a);
    expect(dist2d(ea.pos, { x: door.x, y: 0, z: door.z })).toBeLessThan(10);
  });

  it('Ysolei summons Moonspawn at hp thresholds and enrages below 30%', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const door = DUNGEONS.drowned_temple.doorPos;
    teleport(sim, a, door.x, door.z);
    sim.enterDungeon('drowned_temple', a);
    const ea = sim.entities.get(a)!;
    const origin = instanceOrigin(3, sim.instanceSlotAt(ea.pos)!);

    const ysolei = nearestMob(sim, 'ysolei', origin);
    expect(ysolei).toBeTruthy();
    expect(ysolei.enraged).toBe(false);
    const moonspawnNear = () =>
      [...sim.entities.values()].filter(
        (e) =>
          e.kind === 'mob' &&
          !e.dead &&
          e.templateId === 'moonspawn' &&
          Math.abs(e.pos.x - origin.x) < 120,
      ).length;
    expect(moonspawnNear()).toBe(0);

    ysolei.inCombat = true;
    ysolei.hp = Math.floor(ysolei.maxHp * 0.6);
    sim.tick();
    expect(moonspawnNear()).toBe(2); // first wave of 2

    ysolei.hp = Math.floor(ysolei.maxHp * 0.3);
    sim.tick();
    expect(moonspawnNear()).toBe(4); // second wave -> 4 total
    expect(ysolei.enraged).toBe(true); // and the enrage flips below 30%
  });

  it('the new temple interior has solid walls and pillars but a walkable altar', () => {
    const sim = makeWorld();
    const o = instanceOrigin(3, 0);
    const seed = sim.cfg.seed;
    // open entry aisle is clear; the side wall and a colonnade pillar block
    expect(isBlocked(seed, o.x + 0, o.z + 8)).toBe(false);
    expect(isBlocked(seed, o.x + 23, o.z + 8)).toBe(true); // side wall at |x|=23
    expect(isBlocked(seed, o.x + 14, o.z + 10)).toBe(true); // colonnade pillar
    // Ysolei's altar dais (z 116) is deliberately walkable — no collider
    expect(isBlocked(seed, o.x + 0, o.z + 116)).toBe(false);
  });

  it("Ysolei's blue drop table is an exclusive one-of-three and resolves to real items", () => {
    const ysolei = MOBS.ysolei;
    const group = ysolei.loot.filter((l) => l.rollGroup === 'ysolei_blue');
    expect(group.length).toBe(3);
    const sum = group.reduce((s, l) => s + l.chance, 0);
    expect(sum).toBeCloseTo(1.0, 5);
    for (const l of ysolei.loot) {
      if (l.itemId) expect(ITEMS[l.itemId], `loot item ${l.itemId}`).toBeTruthy();
    }
    // each rollGroup blue is a rare chest, one per archetype
    for (const l of group) {
      const item = ITEMS[l.itemId!];
      expect(item.quality).toBe('rare');
      expect(item.slot).toBe('chest');
    }
  });

  it('the Tidewatcher offers a self-contained chain ending at the 5-player finale', () => {
    const ondrel = NPCS.tidewatcher_ondrel;
    expect(ondrel).toBeTruthy();
    const chain = [
      'q_glimmermere_light',
      'q_tarn_waders',
      'q_drowned_choir',
      'q_palecoil',
      'q_silence_the_choir',
      'q_drowned_moon',
    ];
    for (const q of chain) {
      expect(QUESTS[q], `quest ${q}`).toBeTruthy();
      expect(ondrel.questIds).toContain(q);
    }
    // the chain links end-to-end and the finale is a group kill on Ysolei
    expect(QUESTS.q_tarn_waders.requiresQuest).toBe('q_glimmermere_light');
    expect(QUESTS.q_drowned_choir.requiresQuest).toBe('q_tarn_waders');
    expect(QUESTS.q_silence_the_choir.requiresQuest).toBe('q_drowned_choir');
    expect(QUESTS.q_drowned_moon.requiresQuest).toBe('q_silence_the_choir');
    expect(QUESTS.q_drowned_moon.suggestedPlayers).toBe(5);
    const objective = QUESTS.q_drowned_moon.objectives[0];
    expect(objective.type).toBe('kill');
    if (objective.type !== 'kill') throw new Error('q_drowned_moon must be a kill quest');
    expect(objective.targetMobId).toBe('ysolei');
  });
});
