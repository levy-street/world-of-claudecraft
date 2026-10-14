// src/sim/deepglass/venue_hooks.ts: the Deepglass venue's construction spawns,
// the overworld fixtures the arena keeps out, and the authored-only Deepball
// tick phase, moved out of the Sim coordinator. These pin the gates the
// coordinator used to hold inline: the arena gets its marshal and loses the
// overworld fixtures, the built-in world gets neither venue NPC and keeps every
// fixture, and the tick phase never runs (or laps) off an authored map.

import { afterEach, describe, expect, it } from 'vitest';
import { DG_SPECTATOR_IDS } from '../src/sim/content/deepglass_event';
import { HARBOR_HOUSE_KEEPER_ENTITY_ID } from '../src/sim/content/wyrmwatch_harbor_house';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { DEEPGLASS_MARSHAL_ID, DEEPGLASS_STEWARD_ID } from '../src/sim/deepglass/steward';
import {
  isDeepglassArena,
  updateDeepglassPhase,
  venueSpawns,
} from '../src/sim/deepglass/venue_hooks';
import { buildDeepglassWorld, DEEPGLASS_MARSHAL } from '../src/sim/deepglass/world';
import { Sim } from '../src/sim/sim';
import { WORLD_SEED } from '../src/sim/world_seed';

afterEach(() => {
  setActiveWorldContent(null);
});

function arenaSim(): Sim {
  setActiveWorldContent(buildDeepglassWorld());
  return new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: buildDeepglassWorld(),
  });
}

describe('deepglass venue hooks: the pure gates', () => {
  it('reads the arena off the presentation mode only', () => {
    expect(isDeepglassArena(buildDeepglassWorld())).toBe(true);
    expect(isDeepglassArena(BUILTIN_WORLD)).toBe(false);
  });

  it('spawns a venue NPC only when the arena leaves it dynamic', () => {
    const arena = buildDeepglassWorld();
    const id = DEEPGLASS_MARSHAL.id;
    expect(arena.npcs[id]?.dynamic).toBe(true);
    expect(venueSpawns(arena, id)).toBe(true);
    // A Studio document of the venue drops `dynamic`: the surface loop places
    // the def itself, so the venue spawner must stand down.
    const authored = {
      ...arena,
      npcs: { ...arena.npcs, [id]: { ...arena.npcs[id], dynamic: false } },
    };
    expect(venueSpawns(authored, id)).toBe(false);
    // The built-in world never runs a venue spawner, whatever it lists.
    expect(venueSpawns(BUILTIN_WORLD, id)).toBe(false);
    expect(venueSpawns(arena, 'no_such_npc')).toBe(false);
  });
});

describe('deepglass venue hooks: construction', () => {
  it('stands the marshal and the crowd in the arena and keeps the overworld fixtures out', () => {
    const sim = arenaSim();
    expect(sim.entities.get(DEEPGLASS_MARSHAL_ID)?.kind).toBe('npc');
    const crowdTemplates = new Set(DG_SPECTATOR_IDS);
    const crowd = [...sim.entities.values()].filter(
      (e) => e.kind === 'npc' && crowdTemplates.has(e.templateId),
    );
    expect(crowd.length).toBeGreaterThan(0);
    expect(sim.entities.has(HARBOR_HOUSE_KEEPER_ENTITY_ID)).toBe(false);
  });

  it('spawns no venue NPC on the built-in world and keeps its fixtures', () => {
    setActiveWorldContent(null);
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
    expect(sim.entities.has(DEEPGLASS_MARSHAL_ID)).toBe(false);
    expect(sim.entities.has(DEEPGLASS_STEWARD_ID)).toBe(false);
    expect(sim.entities.has(HARBOR_HOUSE_KEEPER_ENTITY_ID)).toBe(true);
  });
});

describe('deepglass venue hooks: the tick phase', () => {
  it('does nothing and never laps off an authored map', () => {
    setActiveWorldContent(null);
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
    const laps: string[] = [];
    updateDeepglassPhase(sim.ctx, (phase) => laps.push(phase));
    expect(laps).toEqual([]);
  });

  it('runs and laps once on an authored map', () => {
    const sim = arenaSim();
    const laps: string[] = [];
    updateDeepglassPhase(sim.ctx, (phase) => laps.push(phase));
    expect(laps).toEqual(['deepglass']);
  });
});
