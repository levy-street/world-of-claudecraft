// The Last Keep garrison (src/sim/last_keep_garrison.ts): four `dynamic: true`
// NPC records (content/drakelands.ts) stood up AFTER the rng-driven roster on
// reserved singleton ids, so the rebuilt castle's bailey has a warden at the
// Wyrmgate arch, a sutler at the market row, a sergeant by the well, and a
// chaplain at the chapel, and no camp mob's id moved to make room for them.
import { describe, expect, it } from 'vitest';
import { resolvePosition } from '../src/sim/colliders';
import { DRAKELANDS_NPCS, DRAKELANDS_PORTALS } from '../src/sim/content/drakelands';
import { FURY_ENTITY_ID } from '../src/sim/content/pvp_honor';
import { NPCS } from '../src/sim/data';
import {
  LAST_KEEP_GARRISON_ENTITY_ID_BASE,
  LAST_KEEP_GARRISON_NPC_IDS,
  lastKeepGarrisonEntityId,
  spawnLastKeepGarrison,
} from '../src/sim/last_keep_garrison';
import { Sim } from '../src/sim/sim';
import { type Entity, STATIC_WORLD_SERVICE_ENTITY_ID_MIN } from '../src/sim/types';
import { groundHeight, waterLevel } from '../src/sim/world';

// Bailey inner faces (src/sim/castle_layout.ts CASTLE curtain walls).
const BAILEY = { xMin: 361.5, xMax: 435.3, zMin: 1989.5, zMax: 2070.3 };

function makeWorld(noPlayer = true) {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer });
}

describe('the garrison records', () => {
  it('are dynamic Drakelands NPCs in the merged table, standing inside the curtain walls', () => {
    for (const id of LAST_KEEP_GARRISON_NPC_IDS) {
      const def = NPCS[id];
      expect(def, id).toBeDefined();
      expect(def).toBe(DRAKELANDS_NPCS[id]);
      expect(def.dynamic, id).toBe(true);
      expect(def.questIds).toEqual([]);
      expect(def.pos.x).toBeGreaterThan(BAILEY.xMin + 4);
      expect(def.pos.x).toBeLessThan(BAILEY.xMax - 4);
      expect(def.pos.z).toBeGreaterThan(BAILEY.zMin + 4);
      expect(def.pos.z).toBeLessThan(BAILEY.zMax - 4);
    }
  });

  it('keep four yards from each other and off the arch and its landing', () => {
    const defs = LAST_KEEP_GARRISON_NPC_IDS.map((id) => NPCS[id]);
    for (let i = 0; i < defs.length; i++) {
      for (let j = i + 1; j < defs.length; j++) {
        const d = Math.hypot(defs[i].pos.x - defs[j].pos.x, defs[i].pos.z - defs[j].pos.z);
        expect(d, `${defs[i].id} vs ${defs[j].id}`).toBeGreaterThanOrEqual(4);
      }
      const side = DRAKELANDS_PORTALS.find((p) => p.id === 'wyrmgate_waystone')!.b;
      for (const pt of [side, side.landing]) {
        expect(Math.hypot(defs[i].pos.x - pt.x, defs[i].pos.z - pt.z), defs[i].id).toBeGreaterThan(
          DRAKELANDS_PORTALS[0].radius + 2,
        );
      }
    }
  });

  it('stands on clear, dry, walkable ground (no building, stall, well, or wall pushes them)', () => {
    for (const id of LAST_KEEP_GARRISON_NPC_IDS) {
      const { x, z } = NPCS[id].pos;
      expect(groundHeight(x, z, 42), id).toBeGreaterThan(waterLevel() + 0.6);
      for (const [dx, dz] of [
        [0, 0],
        [0.6, 0],
        [-0.6, 0],
        [0, 0.6],
        [0, -0.6],
      ]) {
        const r = resolvePosition(42, x + dx, z + dz);
        expect(Math.hypot(r.x - (x + dx), r.z - (z + dz)), `${id} at +${dx},${dz}`).toBeLessThan(
          1e-6,
        );
      }
    }
  });

  it('the sutler stocks the Highwatch larder rows', () => {
    expect(NPCS.provisioner_dunmore.vendorItems).toEqual([
      'trail_hardtack',
      'meltwater_flask',
      'roast_mountain_goat',
      'glacier_melt',
      'healing_potion',
      'mana_potion',
    ]);
  });
});

describe('spawnLastKeepGarrison', () => {
  it('takes reserved singleton ids clear of FURY and below the static-service band', () => {
    const ids = LAST_KEEP_GARRISON_NPC_IDS.map(lastKeepGarrisonEntityId);
    expect(ids).toEqual([0, 1, 2, 3].map((i) => LAST_KEEP_GARRISON_ENTITY_ID_BASE + i));
    for (const id of ids) {
      expect(id).toBeGreaterThan(FURY_ENTITY_ID);
      expect(id).toBeLessThan(STATIC_WORLD_SERVICE_ENTITY_ID_MIN);
    }
  });

  it('stands all four up in a live world without touching the sequential allocator', () => {
    for (const noPlayer of [true, false]) {
      const sim = makeWorld(noPlayer);
      for (const npcId of LAST_KEEP_GARRISON_NPC_IDS) {
        const e = sim.entities.get(lastKeepGarrisonEntityId(npcId));
        expect(e, npcId).toBeDefined();
        expect(e!.kind).toBe('npc');
        expect(e!.templateId).toBe(npcId);
        expect(Math.hypot(e!.pos.x - NPCS[npcId].pos.x, e!.pos.z - NPCS[npcId].pos.z)).toBeLessThan(
          0.01,
        );
      }
      // The generic loop skipped them (dynamic): no other entity wears the template.
      const surface = [...sim.entities.values()].filter(
        (e) =>
          e.kind === 'npc' &&
          (LAST_KEEP_GARRISON_NPC_IDS as readonly string[]).includes(e.templateId) &&
          e.id < LAST_KEEP_GARRISON_ENTITY_ID_BASE,
      );
      expect(surface).toEqual([]);
    }
  });

  it('consumes no sequential id and draws no rng', () => {
    const added: Entity[] = [];
    const ctx = {
      entities: new Map<number, Entity>(),
      addEntity: (e: Entity) => {
        added.push(e);
        ctx.entities.set(e.id, e);
      },
      groundPos: (x: number, z: number) => ({ x, y: 0, z }),
    };
    spawnLastKeepGarrison(ctx, NPCS);
    expect(added.map((e) => e.id)).toEqual(
      LAST_KEEP_GARRISON_NPC_IDS.map(lastKeepGarrisonEntityId),
    );
    // Twice: the reserved slot is taken, which is a content bug, not a retry.
    expect(() => spawnLastKeepGarrison(ctx, NPCS)).toThrow(/Duplicate static service/);
  });

  it('stands nobody up on a map without the records', () => {
    const added: Entity[] = [];
    spawnLastKeepGarrison(
      {
        entities: new Map<number, Entity>(),
        addEntity: (e: Entity) => added.push(e),
        groundPos: (x: number, z: number) => ({ x, y: 0, z }),
      },
      {},
    );
    expect(added).toEqual([]);
  });

  it('keeps two same-seed worlds identical with the garrison standing', () => {
    const run = () => {
      const sim = makeWorld();
      const a = sim.addPlayer('warrior', 'Aleph');
      for (let i = 0; i < 30; i++) sim.tick();
      const p = sim.entities.get(a)!;
      return [a, p.pos.x, p.pos.z, sim.nextId, sim.rng.next()];
    };
    expect(run()).toEqual(run());
  });

  it("sells the sutler's rations to a player standing at the stall", () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const meta = sim.players.get(a)!;
    const dunmore = sim.entities.get(lastKeepGarrisonEntityId('provisioner_dunmore'))!;
    const p = sim.entities.get(a)!;
    p.pos = sim.groundPos(dunmore.pos.x + 1.5, dunmore.pos.z);
    p.prevPos = { ...p.pos };
    meta.copper = 100_000;
    sim.buyItem(dunmore.id, 'roast_mountain_goat', undefined, a);
    const events = sim.tick();
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(meta.copper).toBeLessThan(100_000);
    expect(sim.countItem('roast_mountain_goat', a)).toBeGreaterThan(0);
  });
});
