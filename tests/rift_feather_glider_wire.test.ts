import { describe, expect, it } from 'vitest';
import { StableAuraWireCache, wireAura } from '../server/snapshot_timer_wire';
import type { ClientWorld } from '../src/net/online';
import { rewardGliderVisible } from '../src/render/reward_glider_core';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';
import { bareClient } from './helpers/bare_client';

function apply(client: ClientWorld, snapshot: Record<string, unknown>) {
  (client as unknown as { applySnapshot(value: unknown): void }).applySnapshot(snapshot);
}

describe('reputation glider authoritative flight marker', () => {
  it.each([false, true])(
    'round-trips takeoff and landing to self and peers with stable=%s',
    (stable) => {
      const sim = new Sim({
        seed: 104,
        playerClass: 'rogue',
        autoEquip: false,
        world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
      });
      const p = sim.player;
      p.pos = { x: 100, y: groundHeight(100, 100, sim.cfg.seed), z: 100 };
      p.prevPos = { ...p.pos };
      p.onGround = true;
      sim.addItem('rift_feather_glider', 1);
      sim.useItem('rift_feather_glider');
      const client = bareClient(p.id);
      const peerId = 99997;
      const cache = new StableAuraWireCache();
      const wire = (id: number, auras?: unknown) => ({
        id,
        k: 'player',
        tid: 'rogue',
        nm: 'Glider',
        lv: 20,
        x: p.pos.x,
        y: p.pos.y,
        z: p.pos.z,
        f: p.facing,
        hp: p.hp,
        mhp: p.maxHp,
        res: 0,
        mres: 100,
        rtype: 'energy',
        ...(auras === undefined ? {} : { auras }),
      });
      const broadcast = (omitUnchanged = false) => {
        const encoded = stable
          ? JSON.parse(cache.encode(p.auras, sim.time, false).json)
          : p.auras.map(wireAura);
        apply(client, {
          t: 'snap',
          tick: sim.tickCount,
          time: sim.time,
          ...(stable ? { tw: 3 } : {}),
          self: wire(p.id, omitUnchanged ? undefined : encoded),
          ents: [wire(peerId, omitUnchanged ? undefined : encoded)],
        });
      };
      const mirrors = () => [client.player, client.entities.get(peerId)!];
      broadcast();
      for (const entity of mirrors()) {
        expect(entity.auras[0].value).toBe(0);
        expect(rewardGliderVisible(entity)).toBe(false);
      }
      const groundRevision = cache.rebuilds;
      sim.meta(p.id)!.moveInput.jump = true;
      sim.tick();
      sim.meta(p.id)!.moveInput.jump = false;
      expect(p.auras[0].value).toBe(1);
      broadcast();
      if (stable) expect(cache.rebuilds).toBeGreaterThan(groundRevision);
      for (const entity of mirrors()) {
        // The protocol does not carry onGround; flight visibility must use the aura.
        expect(entity.onGround).toBe(true);
        expect(entity.auras[0].value).toBe(1);
        expect(rewardGliderVisible(entity)).toBe(true);
      }
      if (stable) {
        sim.tick();
        broadcast(true);
        for (const entity of mirrors()) expect(rewardGliderVisible(entity)).toBe(true);
      }
      for (let i = 0; i < 200 && !p.onGround; i++) sim.tick();
      expect(p.onGround).toBe(true);
      broadcast();
      for (const entity of mirrors()) {
        expect(entity.auras).toEqual([]);
        expect(rewardGliderVisible(entity)).toBe(false);
      }
    },
  );
});
