import { describe, expect, it } from 'vitest';
import { riftAmbientSources } from '../src/render/rift_ambience';
import { BUILTIN_WORLD } from '../src/sim/data';
import { spawnNaturalRiftPortal } from '../src/sim/rift/portals';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const TEST_WORLD = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function makeSim(): Sim {
  return new Sim({
    seed: 44219,
    playerClass: 'warrior',
    autoEquip: true,
    devCommands: true,
    riftPortals: true,
    world: TEST_WORLD,
  });
}

describe('rift SFX wiring: portal spawn + entry (src/sim/rift/fx.ts riftFx)', () => {
  it('a natural portal spawning plays the custom spawn cue', () => {
    const sim = makeSim();
    expect(spawnNaturalRiftPortal(sim.ctx, 0)).toBe(true);
    const events = sim.drainEvents();
    expect(
      events.some((e) => e.type === 'spellfxAt' && e.sfxKey === 'rift_portal_spawn' && !e.pid),
    ).toBe(true);
  });

  it('stepping through a portal plays the custom entry cue, personal to that player only', () => {
    const sim = makeSim();
    spawnNaturalRiftPortal(sim.ctx, 0);
    sim.drainEvents();
    const portal = sim.entities.get(sim.naturalRiftPortals[0].id)!;
    const pid = sim.player.id;
    sim.setPlayerLevel(20); // RIFT_MIN_LEVEL; below it entry is denied and no fx fires
    sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, pid, undefined, portal);
    const events = sim.drainEvents();
    const enter = events.find((e) => e.type === 'spellfxAt' && e.sfxKey === 'rift_portal_enter');
    expect(enter).toBeTruthy();
    expect(enter?.pid).toBe(pid);
  });
});

describe('rift SFX wiring: dynamic point ambience (src/render/rift_ambience.ts)', () => {
  it('picks up a live rift_portal entity as an ambient point source', () => {
    const sim = makeSim();
    spawnNaturalRiftPortal(sim.ctx, 0);
    const portal = sim.entities.get(sim.naturalRiftPortals[0].id)!;
    const sources = riftAmbientSources(sim.entities);
    const match = sources.find((s) => s.id === `rift_portal:${portal.id}`);
    expect(match).toBeTruthy();
    expect(match?.kind).toBe('rift_portal');
    expect(match?.x).toBe(portal.pos.x);
    expect(match?.z).toBe(portal.pos.z);
  });

  it('ignores entities that are not a rift portal, roller, or gliding player', () => {
    const entities = new Map<number, Entity>();
    const sim = makeSim();
    entities.set(sim.player.id, sim.player);
    const sources = riftAmbientSources(entities);
    expect(sources).toHaveLength(0);
  });

  it('picks up a gliding player as an ambient point source, using the same riftSliding flag the visual frozen pose reads', () => {
    const sim = makeSim();
    sim.player.riftSliding = true;
    const sources = riftAmbientSources(sim.entities);
    const match = sources.find((s) => s.id === `rift_ice_glide:${sim.player.id}`);
    expect(match).toBeTruthy();
    expect(match?.kind).toBe('rift_ice_glide');
    expect(match?.x).toBe(sim.player.pos.x);
    sim.player.riftSliding = false;
    expect(riftAmbientSources(sim.entities).some((s) => s.kind === 'rift_ice_glide')).toBe(false);
  });

  it('picks up a DIFFERENT player gliding, not just self, matching the wire-synced riftSliding flag any party member can carry', () => {
    const sim = makeSim();
    const otherPid = sim.addPlayer('rogue', 'Glidebuddy');
    const other = sim.entities.get(otherPid)!;
    other.riftSliding = true;
    other.pos = { x: 12, y: 0, z: 34 };
    const sources = riftAmbientSources(sim.entities);
    const match = sources.find((s) => s.id === `rift_ice_glide:${otherPid}`);
    expect(match).toBeTruthy();
    expect(match?.kind).toBe('rift_ice_glide');
    expect(match?.x).toBe(12);
    expect(match?.z).toBe(34);
    // Self is not sliding, so only the other player's source shows up.
    expect(sources.filter((s) => s.kind === 'rift_ice_glide')).toHaveLength(1);
  });
});
