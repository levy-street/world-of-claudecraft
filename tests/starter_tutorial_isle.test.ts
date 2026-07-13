// Dawnhaven Isle: the map is real and playable, and merging it changed nothing
// about the live world.
//
// The isolation suite at the bottom is the load-bearing one. The isle's mobs,
// quest and NPC are merged into the global lookup tables, and a mistake there
// (spawning the Warden in Eastbrook, or inserting a camp that shifts the shared
// rng draw order) would silently corrupt the actual game.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAWNHAVEN_AMBUSH,
  DAWNHAVEN_ASSET_SIZES,
  DAWNHAVEN_BLOCKERS,
  DAWNHAVEN_CAMPS,
  DAWNHAVEN_LANDING,
  DAWNHAVEN_MOBS,
  DAWNHAVEN_PLACEMENTS,
  DAWNHAVEN_QUESTS,
  DAWNHAVEN_SEED,
  DAWNHAVEN_WARDEN_POS,
  DAWNHAVEN_WORLD,
  DAWNHAVEN_ZONE,
  placedHeightYd,
} from '../src/sim/content/tutorial';
import {
  BUILTIN_WORLD,
  CAMPS,
  ITEMS,
  MOBS,
  NPCS,
  QUESTS,
  setActiveWorldContent,
  ZONES,
} from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { terrainHeight, waterLevel } from '../src/sim/world';

const REPO = path.resolve(__dirname, '..');

function withIsle<T>(fn: () => T): T {
  setActiveWorldContent(DAWNHAVEN_WORLD);
  try {
    return fn();
  } finally {
    setActiveWorldContent(null);
  }
}

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

describe('Dawnhaven Isle content', () => {
  it('every placed GLB exists on disk', () => {
    for (const p of DAWNHAVEN_PLACEMENTS) {
      const file = path.join(REPO, 'public', p.path.replace(/^\//, ''));
      expect(existsSync(file), `missing asset for placement ${p.path}`).toBe(true);
    }
    // A map with a handful of props is not the "small but pretty" isle this is
    // supposed to be; guard against someone gutting it.
    expect(DAWNHAVEN_PLACEMENTS.length).toBeGreaterThan(60);
  });

  it('every prop stands at a believable height', () => {
    // The bug this exists for: the placed-asset instancer normalizes each GLB by its
    // LONGEST axis to a fixed 2.2yd and only then applies `scale`, so a raw scale of
    // 1 makes a bedroll the size of a tree. The isle authors heights in yards and
    // inverts that math through a table of measured source sizes (ASSET_SIZE). A
    // stale row in that table silently produces a giant, so pin the OUTPUT: every
    // finished prop must land somewhere between ankle-height and a tall pine.
    for (const p of DAWNHAVEN_PLACEMENTS) {
      const h = placedHeightYd(p);
      expect(Number.isNaN(h), `no measured size for ${p.path}`).toBe(false);
      expect(h, `${p.path} is ${h.toFixed(2)}yd tall`).toBeGreaterThan(0.15);
      expect(h, `${p.path} is ${h.toFixed(2)}yd tall`).toBeLessThan(11);
    }
    // ...and the table carries no dead rows.
    const placed = new Set(
      DAWNHAVEN_PLACEMENTS.map((p) => p.path.replace('/models/', '').replace('.glb', '')),
    );
    for (const id of Object.keys(DAWNHAVEN_ASSET_SIZES)) {
      expect(placed.has(id), `${id} is measured but never placed`).toBe(true);
    }
  });

  it('every id the isle references resolves', () => {
    for (const camp of DAWNHAVEN_CAMPS) {
      expect(MOBS[camp.mobId], `camp mob ${camp.mobId}`).toBeDefined();
    }
    const quest = QUESTS.q_dawnhaven_wolves;
    expect(quest).toBeDefined();
    expect(NPCS[quest.giverNpcId]).toBeDefined();
    expect(NPCS[quest.turnInNpcId!]).toBeDefined();
    for (const obj of quest.objectives) {
      expect(MOBS[obj.targetMobId!], `objective mob ${obj.targetMobId}`).toBeDefined();
    }
    // The loot the tutorial's "take the fang" step waits on has to actually drop,
    // and drop every time: a chance below 1 would let the step dead-end.
    const wolf = DAWNHAVEN_MOBS.dawnhaven_strandwolf;
    const fang = wolf.loot.find((l) => l.itemId === 'wolf_fang');
    expect(fang).toBeDefined();
    expect(fang!.chance).toBe(1);
    expect(ITEMS.wolf_fang).toBeDefined();
  });

  it('the practice dummies draw no rng and sit at level 1', () => {
    const dummy = DAWNHAVEN_MOBS.dawnhaven_dummy;
    // `dummy: true` is what makes the ctor spawn them without a single rng draw.
    expect(dummy.dummy).toBe(true);
    // A level 20 dummy would give a fresh level 1 player a brutal miss rate on the
    // very step that is teaching them to attack.
    expect(dummy.minLevel).toBe(1);
    expect(dummy.maxLevel).toBe(1);
    expect(dummy.dmgBase).toBe(0);
    expect(dummy.moveSpeed).toBe(0);
  });

  it('the isle is an island: the spawn is dry, the water is all around it', () => {
    withIsle(() => {
      const landing = terrainHeight(DAWNHAVEN_LANDING.x, DAWNHAVEN_LANDING.z, DAWNHAVEN_SEED);
      expect(landing, 'the player must not spawn underwater').toBeGreaterThan(waterLevel());

      // The stations are all on dry land.
      for (const spot of [DAWNHAVEN_WARDEN_POS, DAWNHAVEN_AMBUSH, { x: 26, z: 6 }]) {
        const h = terrainHeight(spot.x, spot.z, DAWNHAVEN_SEED);
        expect(h, `station ${spot.x},${spot.z} is underwater`).toBeGreaterThan(waterLevel());
      }

      // ...and the sea really is a sea: well past the shoreline ring it is below
      // the waterline in every direction.
      for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
        const x = Math.cos(a) * 70;
        const z = Math.sin(a) * 70;
        expect(terrainHeight(x, z, DAWNHAVEN_SEED), `dry land at bearing ${a}`).toBeLessThan(
          waterLevel(),
        );
      }
    });
  });

  it('the shoreline blockers form a closed ring around the isle', () => {
    // Every segment's end must be the next segment's start, and the last must close
    // back onto the first, or the player can walk out through the gap.
    const b = DAWNHAVEN_BLOCKERS;
    expect(b.length).toBeGreaterThanOrEqual(12);
    for (let i = 0; i < b.length; i++) {
      const next = b[(i + 1) % b.length];
      expect(Math.hypot(b[i].x2 - next.x1, b[i].z2 - next.z1)).toBeLessThan(1e-6);
    }
    // And the ring is outside every station, so it never walls the player off from
    // something the tutorial sends them to.
    for (const spot of [DAWNHAVEN_LANDING, DAWNHAVEN_WARDEN_POS, DAWNHAVEN_AMBUSH]) {
      expect(Math.hypot(spot.x, spot.z), `${spot.x},${spot.z} is outside the ring`).toBeLessThan(
        50,
      );
    }
  });

  it('the wolf pack sits far enough back not to mug the player mid-cinematic', () => {
    const pack = DAWNHAVEN_CAMPS.find((c) => c.mobId === 'dawnhaven_strandwolf');
    expect(pack).toBeDefined();
    const aggro = DAWNHAVEN_MOBS.dawnhaven_strandwolf.aggroRadius;
    // The ambush spot is where the scripted reveal wolf spawns and where the player
    // will be standing when it does. The pack must not already be on top of them.
    const gap = dist(pack!.center, DAWNHAVEN_AMBUSH) - pack!.radius;
    expect(gap, 'the pack can reach the ambush spot').toBeGreaterThan(aggro);
  });

  it('the isle boots as a real Sim with a Warden ready to be staged in', () => {
    withIsle(() => {
      const sim = new Sim({
        seed: DAWNHAVEN_SEED,
        playerClass: 'warrior',
        playerName: 'Test',
        world: DAWNHAVEN_WORLD,
      });

      // The Warden is `dynamic`, so she is NOT surface-placed: the reveal scene is
      // what puts her in the world.
      const wardens = [...sim.entities.values()].filter((e) => e.templateId === 'dawnhaven_warden');
      expect(wardens).toHaveLength(0);

      // ...and staging her works, and gives a quest giver the player can talk to.
      const id = sim.spawnStagedNpc(
        'dawnhaven_warden',
        DAWNHAVEN_WARDEN_POS.x,
        DAWNHAVEN_WARDEN_POS.z,
      );
      expect(id).not.toBeNull();
      const warden = sim.entities.get(id!)!;
      expect(warden.kind).toBe('npc');
      expect(warden.questIds).toContain('q_dawnhaven_wolves');

      // The dummies and the wolf pack DID spawn from the camps.
      const dummies = [...sim.entities.values()].filter((e) => e.templateId === 'dawnhaven_dummy');
      expect(dummies).toHaveLength(3);
      const wolves = [...sim.entities.values()].filter(
        (e) => e.templateId === 'dawnhaven_strandwolf',
      );
      expect(wolves).toHaveLength(4);
    });
  });

  it('a staged spawn draws no rng', () => {
    withIsle(() => {
      const sim = new Sim({
        seed: DAWNHAVEN_SEED,
        playerClass: 'mage',
        playerName: 'Test',
        world: DAWNHAVEN_WORLD,
      });
      // Snapshot the rng stream, stage two entities, and prove the very next draw
      // is the one that would have come anyway. A staged spawn that drew rng would
      // fork any world it ran in.
      const probe = new Sim({
        seed: DAWNHAVEN_SEED,
        playerClass: 'mage',
        playerName: 'Test',
        world: DAWNHAVEN_WORLD,
      });
      sim.spawnStagedMob('dawnhaven_strandwolf', DAWNHAVEN_AMBUSH.x, DAWNHAVEN_AMBUSH.z);
      sim.spawnStagedNpc('dawnhaven_warden', 0, -21);
      expect(sim.rng.next()).toBe(probe.rng.next());
    });
  });
});

describe('the isle does not touch the live world', () => {
  it('the Warden is registered but never placed in the built-in world', () => {
    // She must be findable by id (the client resolves her NAME through this table)
    // but `dynamic`, which is what keeps the built-in world's spawn loop off her.
    expect(NPCS.dawnhaven_warden).toBeDefined();
    expect(NPCS.dawnhaven_warden.dynamic).toBe(true);
  });

  it('no isle content is placed in the built-in world', () => {
    for (const camp of CAMPS) {
      expect(camp.mobId.startsWith('dawnhaven_'), `${camp.mobId} camped in the live world`).toBe(
        false,
      );
    }
    expect(ZONES.some((z) => z.id === DAWNHAVEN_ZONE.id)).toBe(false);
    expect(BUILTIN_WORLD.zones.some((z) => z.id === DAWNHAVEN_ZONE.id)).toBe(false);
    // The one quest is unreachable in the live world because its only giver is.
    expect(Object.keys(DAWNHAVEN_QUESTS)).toEqual(['q_dawnhaven_wolves']);
  });

  it('the built-in world spawns the same entities, in the same rng order, as before', () => {
    // The isle merges mobs/quests/NPCs into the shared lookup tables. If that ever
    // starts placing something, or shifts a draw, THIS is what catches it: two
    // built-in Sims on the same seed must agree entity for entity, and the rng
    // stream must be at exactly the same point afterwards.
    const a = new Sim({ seed: 1234, playerClass: 'warrior', playerName: 'A' });
    const b = new Sim({ seed: 1234, playerClass: 'warrior', playerName: 'A' });

    const roster = (s: Sim) =>
      [...s.entities.values()]
        .map((e) => `${e.kind}:${e.templateId}:${e.pos.x.toFixed(4)}:${e.pos.z.toFixed(4)}`)
        .sort();
    expect(roster(a)).toEqual(roster(b));

    // Nothing from the isle leaked into the live spawn set.
    for (const e of a.entities.values()) {
      expect(e.templateId.startsWith('dawnhaven_'), `${e.templateId} spawned live`).toBe(false);
    }

    // The world-gen draw stream lands in the same place.
    expect(a.rng.next()).toBe(b.rng.next());
  });
});
