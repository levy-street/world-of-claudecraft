// The Deepglass city event: the crowd exists on the idle arena, clears for
// every bout, and comes back at the whistle (src/sim/deepglass/crowd.ts).

import { beforeEach, describe, expect, it } from 'vitest';
import {
  DG_CROWD_BASE_ENTITY_ID,
  DG_MARKET_STALLS,
  DG_SEAT_TIER_DECK_Y,
  DG_SPECTATOR_IDS,
  DG_SPECTATORS,
  DG_STALLKEEPER_BASE_ENTITY_ID,
  DG_STALLKEEPER_IDS,
} from '../src/sim/content/deepglass_event';
import { setActiveWorldContent } from '../src/sim/data';
import { endDeepglassMatch, startDeepglassMatch } from '../src/sim/deepglass/match';
import { buildDeepglassWorld } from '../src/sim/deepglass/world';
import {
  DEEPGLASS_PORTAL_WIZARD_ENTITY_ID,
  PORTAL_WIZARD_BASE_ENTITY_ID,
  PORTAL_WIZARD_STOPS,
} from '../src/sim/portal_wizard';
import { Sim } from '../src/sim/sim';

const crowdIds = (): number[] => [
  ...DG_SPECTATOR_IDS.map((_, i) => DG_CROWD_BASE_ENTITY_ID + i),
  ...DG_STALLKEEPER_IDS.map((_, i) => DG_STALLKEEPER_BASE_ENTITY_ID + i),
];

describe('deepglass city event', () => {
  let sim: Sim;
  beforeEach(() => {
    setActiveWorldContent(buildDeepglassWorld());
    sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      devCommands: true,
      world: buildDeepglassWorld(),
    });
  });

  it('spawns the whole event roster at its reserved ids on the idle arena', () => {
    for (const id of crowdIds()) {
      const e = sim.entities.get(id);
      expect(e, `crowd entity ${id}`).toBeTruthy();
      expect(e?.kind).toBe('npc');
    }
    // The bell self of the portal wizard stands at the arrival too.
    expect(sim.entities.get(DEEPGLASS_PORTAL_WIZARD_ENTITY_ID)?.kind).toBe('npc');
    // The arena also authors the market.
    expect(DG_MARKET_STALLS.length).toBeGreaterThan(0);
  });

  it('is mostly still: only one in five paces, the rest hold their posts', () => {
    const pacers = DG_SPECTATORS.filter((s) => s.role === 'pace');
    const tiers = DG_SPECTATORS.filter((s) => s.role === 'tier');
    // One in five walking, and the bowl carries most of the crowd.
    expect(pacers.length * 5).toBe(DG_SPECTATORS.length);
    expect(tiers.length).toBeGreaterThan(DG_SPECTATORS.length / 2);

    DG_SPECTATORS.forEach((spot, i) => {
      const e = sim.entities.get(DG_CROWD_BASE_ENTITY_ID + i);
      if (!e) throw new Error(`missing spectator ${spot.npcId}`);
      if (spot.role === 'pace') {
        expect(e.route?.points.length, spot.npcId).toBe(2);
      } else {
        expect(e.route, spot.npcId).toBeUndefined();
      }
      if (spot.role === 'tier' && spot.tier !== undefined) {
        expect(e.pos.y, spot.npcId).toBe(DG_SEAT_TIER_DECK_Y[spot.tier]);
      }
    });

    // Run a few seconds: the pacers move, and nobody else does.
    const before = DG_SPECTATORS.map((_, i) => {
      const e = sim.entities.get(DG_CROWD_BASE_ENTITY_ID + i);
      if (!e) throw new Error('missing spectator');
      return { x: e.pos.x, y: e.pos.y, z: e.pos.z };
    });
    for (let t = 0; t < 100; t++) sim.tick();
    let paced = 0;
    DG_SPECTATORS.forEach((spot, i) => {
      const e = sim.entities.get(DG_CROWD_BASE_ENTITY_ID + i);
      if (!e) return;
      const moved = Math.hypot(e.pos.x - before[i].x, e.pos.z - before[i].z);
      if (spot.role === 'pace') {
        if (moved > 0.5) paced++;
      } else {
        expect(moved, `${spot.npcId} should hold its post`).toBeLessThan(0.01);
        expect(e.pos.y, `${spot.npcId} height`).toBe(before[i].y);
      }
    });
    expect(paced).toBeGreaterThan(0);
  });

  it('keeps the pacers clear of the market stalls they used to walk into', () => {
    // The old full-ring patrol crossed the stall colliders at |x| 13 to 16.
    for (const spot of DG_SPECTATORS.filter((s) => s.role === 'pace')) {
      for (const stall of DG_MARKET_STALLS) {
        expect(
          Math.hypot(spot.x - stall.x, spot.z - stall.z),
          `${spot.npcId} vs stall ${stall.x},${stall.z}`,
        ).toBeGreaterThan(4);
      }
    }
  });

  it('clears for the bout and returns at the whistle', () => {
    startDeepglassMatch(sim.ctx, sim.primaryId, 1);
    for (const id of crowdIds()) {
      expect(sim.entities.has(id), `crowd entity ${id} during bout`).toBe(false);
    }
    endDeepglassMatch(sim.ctx);
    for (const id of crowdIds()) {
      expect(sim.entities.has(id), `crowd entity ${id} after whistle`).toBe(true);
    }
  });

  it('never spawns the event or the town wizards outside their worlds', () => {
    // Built-in overworld: town selves yes, bell self no, crowd no.
    setActiveWorldContent(null);
    const overworld = new Sim({ seed: 42, playerClass: 'warrior' });
    for (let i = 0; i < PORTAL_WIZARD_STOPS.length; i++) {
      expect(
        overworld.entities.get(PORTAL_WIZARD_BASE_ENTITY_ID + i)?.kind,
        PORTAL_WIZARD_STOPS[i].npcId,
      ).toBe('npc');
    }
    expect(overworld.entities.has(DEEPGLASS_PORTAL_WIZARD_ENTITY_ID)).toBe(false);
    for (const id of crowdIds()) expect(overworld.entities.has(id)).toBe(false);
  });
});
