// Last Bell story instances (src/sim/instances/story_instances.ts +
// src/sim/last_bell_field.ts): area/def integrity, the terrain-mirror
// contract (a private story copy stands on ground identical to the island
// slice it mirrors), claim rules (party-shared vs solo-always), leave via
// the shared dungeon exit path, idle recycling, and the /dev story command.
import { describe, expect, it } from 'vitest';
import { DUNGEON_LIST, DUNGEONS, instanceOrigin } from '../src/sim/data';
import { instanceKeyFor } from '../src/sim/instances/dungeons';
import { LAST_BELL_AREAS } from '../src/sim/last_bell_field';
import { Sim } from '../src/sim/sim';
import { INSTANCE_EMPTY_TIMEOUT } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const SEED = 424242;

function devSim(): Sim {
  return new Sim({ seed: SEED, playerClass: 'warrior', playerName: 'Bell', devCommands: true });
}

function claimedSlots(sim: Sim, dungeonId: string) {
  return sim.ctx.instances.filter((i) => i.dungeonId === dungeonId && i.partyKey !== null);
}

describe('last bell area/def integrity', () => {
  it('every area has a story def and every story def has an area', () => {
    for (const area of Object.values(LAST_BELL_AREAS)) {
      const def = DUNGEONS[area.dungeonId];
      expect(def, `${area.dungeonId} def`).toBeTruthy();
      expect(def.interior).toBe('farshore_story');
      // Story spaces are scenario-populated and door-less by contract.
      expect(def.spawns).toHaveLength(0);
      expect(def.overworldDoor).toBe(false);
      // The arrival point stands inside the area's walls.
      expect(def.entry.x).toBeGreaterThan(area.bounds.minX);
      expect(def.entry.x).toBeLessThan(area.bounds.maxX);
      expect(def.entry.z).toBeGreaterThan(area.bounds.minZ);
      expect(def.entry.z).toBeLessThan(area.bounds.maxZ);
      // Exactly one terrain source: a mirror anchor or an authored field.
      expect(area.mirror !== undefined || area.height !== undefined).toBe(true);
      expect(area.mirror !== undefined && area.height !== undefined).toBe(false);
    }
    for (const def of Object.values(DUNGEONS)) {
      if (def.interior !== 'farshore_story') continue;
      expect(LAST_BELL_AREAS[def.id], `${def.id} area`).toBeTruthy();
    }
  });

  it('story defs take unique indices and collide with no existing dungeon', () => {
    const seen = new Map<number, string>();
    for (const def of DUNGEON_LIST) {
      expect(seen.has(def.index), `index ${def.index}: ${seen.get(def.index)} vs ${def.id}`).toBe(
        false,
      );
      seen.set(def.index, def.id);
    }
  });
});

describe('story terrain', () => {
  it('a mirror area stands on ground identical to its island source', () => {
    const def = DUNGEONS.lb_riftline;
    const area = LAST_BELL_AREAS.lb_riftline;
    const mirror = area.mirror;
    expect(mirror).toBeTruthy();
    if (!mirror) return;
    const origin = instanceOrigin(def.index, 0);
    const sim = devSim(); // groundHeight consults the active world content
    for (const [lx, lz] of [
      [0, 0],
      [-40, 25],
      [33, -18],
      [80, 100],
      [-90, -60],
    ]) {
      const inside = sim.groundPos(origin.x + lx, origin.z + lz).y;
      const source = terrainHeight(mirror.srcX + lx, mirror.srcZ + lz, SEED);
      expect(inside, `local (${lx},${lz})`).toBeCloseTo(source, 6);
    }
  });

  it('the vault descends from the rope entry to the founding chamber', () => {
    const area = LAST_BELL_AREAS.lb_vault;
    const height = area.height;
    expect(height).toBeTruthy();
    if (!height) return;
    expect(height(0, -6)).toBeCloseTo(0, 9);
    expect(height(0, 168)).toBeLessThan(-11);
  });
});

describe('story claims', () => {
  it('enters a private claim, and leaving returns to the overworld anchor', () => {
    const sim = devSim();
    expect(sim.enterStoryInstance('lb_riftline')).toBe(true);
    const claims = claimedSlots(sim, 'lb_riftline');
    expect(claims).toHaveLength(1);
    const origin = instanceOrigin(DUNGEONS.lb_riftline.index, claims[0].slot);
    expect(sim.player.pos.x).toBeCloseTo(origin.x + DUNGEONS.lb_riftline.entry.x, 3);
    expect(sim.player.pos.z).toBeCloseTo(origin.z + DUNGEONS.lb_riftline.entry.z, 3);
    expect(sim.leaveDungeon()).toBe(true);
    expect(sim.player.pos.x).toBeCloseTo(DUNGEONS.lb_riftline.doorPos.x, 3);
    expect(sim.player.pos.z).toBeCloseTo(DUNGEONS.lb_riftline.doorPos.z - 4, 3);
  });

  it('re-entry rejoins the same live claim instead of minting a fresh one', () => {
    const sim = devSim();
    sim.enterStoryInstance('lb_riftline');
    const first = claimedSlots(sim, 'lb_riftline')[0];
    sim.leaveDungeon();
    sim.enterStoryInstance('lb_riftline');
    const again = claimedSlots(sim, 'lb_riftline');
    expect(again).toHaveLength(1);
    expect(again[0]).toBe(first);
  });

  it('a party shares one group-area claim but splits solo-always areas', () => {
    const sim = devSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Tam');
    sim.partyInvite(b, a);
    sim.partyAccept(b);

    // Group area: one claim under the party key.
    sim.enterStoryInstance('lb_riftline', a);
    sim.enterStoryInstance('lb_riftline', b);
    const group = claimedSlots(sim, 'lb_riftline');
    expect(group).toHaveLength(1);
    expect(group[0].partyKey).toBe(instanceKeyFor(sim.ctx, a));

    // Solo-always area: each member claims their own copy even in the party.
    sim.enterStoryInstance('lb_tidemill', a);
    sim.enterStoryInstance('lb_tidemill', b);
    const solo = claimedSlots(sim, 'lb_tidemill');
    expect(solo).toHaveLength(2);
    expect(new Set(solo.map((i) => i.partyKey)).size).toBe(2);
    for (const inst of solo) expect(inst.partyKey).not.toBe(instanceKeyFor(sim.ctx, a));
  });

  it('an abandoned claim recycles through the shared idle sweep', () => {
    const sim = devSim();
    sim.enterStoryInstance('lb_riftline');
    sim.leaveDungeon();
    // The sweep runs once a second and frees after INSTANCE_EMPTY_TIMEOUT
    // consecutive empty checks; pre-wind the idle counter so the test
    // exercises the real sweep without ticking five simulated minutes.
    const inst = claimedSlots(sim, 'lb_riftline')[0];
    inst.emptyFor = INSTANCE_EMPTY_TIMEOUT - 1;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(claimedSlots(sim, 'lb_riftline')).toHaveLength(0);
  });

  it('claiming a story space draws no rng (scenario populates later)', () => {
    const sim = devSim();
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    sim.enterStoryInstance('lb_breach');
    expect(draws).toBe(0);
  });

  it('/dev story enters by id and rejects unknown ids', () => {
    const sim = devSim();
    sim.chat('/dev story lb_vault');
    expect(claimedSlots(sim, 'lb_vault')).toHaveLength(1);
    sim.chat('/dev story lb_nowhere');
    expect(claimedSlots(sim, 'lb_vault')).toHaveLength(1);
    expect(sim.ctx.instances.filter((i) => i.partyKey !== null)).toHaveLength(1);
  });
});
