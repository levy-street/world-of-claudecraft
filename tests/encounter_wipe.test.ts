// Paired suite for src/sim/encounters/encounter_wipe.ts: the terminal
// raid-wipe resolution the encounter finales share. A completed terminal cast
// is an encounter failure, not a survivable damage check: ordinary immunity
// (Cold Coffin stasis) and cheat-death wards must not outlive it, while
// explicit dev/GM invulnerability must.
import { describe, expect, it } from 'vitest';
import { resolveEncounterWipe } from '../src/sim/encounters/encounter_wipe';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function wipeRig(seed = 42): { sim: Sim; boss: Entity } {
  const sim = new Sim({ seed, playerClass: 'warrior', devCommands: true });
  const boss = [...sim.entities.values()].find(
    (entity) => entity.kind === 'mob' && entity.ownerId === null && entity.hostile && !entity.dead,
  );
  if (!boss) throw new Error('No hostile mob spawned for the wipe rig');
  return { sim, boss };
}

describe('resolveEncounterWipe', () => {
  it('kills an unprotected player outright', () => {
    const { sim, boss } = wipeRig(42);
    sim.player.hp = sim.player.maxHp;

    resolveEncounterWipe(sim.ctx, boss, [sim.player], 'Terminal Wipe');

    expect(sim.player.dead).toBe(true);
    expect(sim.player.hp).toBe(0);
  });

  it('kills a full-health player through Cold Coffin stasis immunity', () => {
    const { sim, boss } = wipeRig(43);
    sim.player.hp = sim.player.maxHp;
    sim.player.auras.push({
      id: 'ice_block',
      name: 'Cold Coffin',
      kind: 'stasis',
      remaining: 8,
      duration: 8,
      value: 0,
      sourceId: sim.player.id,
      school: 'frost',
    });

    resolveEncounterWipe(sim.ctx, boss, [sim.player], 'Terminal Wipe');

    expect(sim.player.dead).toBe(true);
    expect(sim.player.hp).toBe(0);
  });

  it('kills through a cheat-death guardian ward instead of letting it save the raid', () => {
    const { sim, boss } = wipeRig(44);
    sim.player.hp = sim.player.maxHp;
    sim.player.auras.push({
      id: 'sacred_bulwark',
      name: 'Sacred Bulwark',
      kind: 'guardian_ward',
      remaining: 10,
      duration: 10,
      value: 0.35,
      sourceId: sim.player.id,
      school: 'holy',
    });

    resolveEncounterWipe(sim.ctx, boss, [sim.player], 'Terminal Wipe');

    expect(sim.player.dead).toBe(true);
    expect(sim.player.hp).toBe(0);
    expect(sim.player.auras.some((aura) => aura.kind === 'guardian_ward')).toBe(false);
  });

  it('preserves GM invulnerability', () => {
    const { sim, boss } = wipeRig(45);
    sim.player.gm = true;
    sim.player.hp = sim.player.maxHp;

    resolveEncounterWipe(sim.ctx, boss, [sim.player], 'Terminal Wipe');

    expect(sim.player.dead).toBe(false);
    expect(sim.player.hp).toBe(sim.player.maxHp);
  });

  it('emits the nova spellfx from the boss before the damage lands', () => {
    const { sim, boss } = wipeRig(47);
    sim.player.hp = sim.player.maxHp;

    resolveEncounterWipe(sim.ctx, boss, [sim.player], 'Terminal Wipe');

    const novaIndex = sim.events.findIndex(
      (event) =>
        event.type === 'spellfx' &&
        event.fx === 'nova' &&
        event.school === 'fire' &&
        event.sourceId === boss.id &&
        event.targetId === sim.player.id,
    );
    const damageIndex = sim.events.findIndex(
      (event) =>
        event.type === 'damage' &&
        event.targetId === sim.player.id &&
        event.ability === 'Terminal Wipe',
    );
    expect(novaIndex).toBeGreaterThanOrEqual(0);
    expect(damageIndex).toBeGreaterThanOrEqual(0);
    expect(novaIndex).toBeLessThan(damageIndex);
    expect(
      sim.events.find((event) => event.type === 'damage' && event.targetId === sim.player.id),
    ).toMatchObject({ sourceId: boss.id });
  });

  it('attributes the nova, the damage, and the kill to an explicit source override', () => {
    const { sim, boss } = wipeRig(48);
    const override = [...sim.entities.values()].find(
      (entity) =>
        entity.kind === 'mob' &&
        entity.ownerId === null &&
        entity.hostile &&
        !entity.dead &&
        entity.id !== boss.id,
    );
    if (!override) throw new Error('No second hostile mob spawned for the source override');
    sim.player.hp = sim.player.maxHp;

    resolveEncounterWipe(sim.ctx, boss, [sim.player], 'Terminal Wipe', override);

    expect(sim.player.dead).toBe(true);
    expect(
      sim.events.find((event) => event.type === 'spellfx' && event.fx === 'nova'),
    ).toMatchObject({ sourceId: override.id, targetId: sim.player.id });
    expect(
      sim.events.find((event) => event.type === 'damage' && event.targetId === sim.player.id),
    ).toMatchObject({ sourceId: override.id });
    expect(
      sim.events.find((event) => event.type === 'death' && event.entityId === sim.player.id),
    ).toMatchObject({ killerId: override.id });
  });

  it('gives an entry already dead by its own iteration the shared-loop treatment', () => {
    // Deliberate pin of the CURRENT semantics (Ignivar's long-standing shape):
    // the helper itself never dead-skips, so an entry that died mid-loop still
    // receives the nova emit and the (no-op) damage call, and the forced death
    // never double-fires. Callers that want dead entries excluded filter
    // eagerly at resolution start (Varkhul's wipeEncounter does). A future
    // per-iteration dead-skip must consciously rewrite this test.
    const { sim, boss } = wipeRig(49);
    sim.player.hp = sim.player.maxHp;

    resolveEncounterWipe(sim.ctx, boss, [sim.player, sim.player], 'Terminal Wipe');

    expect(sim.player.dead).toBe(true);
    const novas = sim.events.filter(
      (event) =>
        event.type === 'spellfx' && event.fx === 'nova' && event.targetId === sim.player.id,
    );
    expect(novas).toHaveLength(2);
    const deaths = sim.events.filter(
      (event) => event.type === 'death' && event.entityId === sim.player.id,
    );
    expect(deaths).toHaveLength(1);
  });

  it('preserves /dev god and profiler invulnerability while dev commands are on', () => {
    const { sim, boss } = wipeRig(46);
    const godPid = sim.addPlayer('warrior', 'WipeGod');
    const god = sim.entities.get(sim.players.get(godPid)?.entityId ?? -1);
    if (!god) throw new Error('WipeGod did not spawn');
    god.devGod = true;
    god.hp = god.maxHp;
    sim.player.profilerInvulnerable = true;
    sim.player.hp = sim.player.maxHp;

    resolveEncounterWipe(sim.ctx, boss, [sim.player, god], 'Terminal Wipe');

    expect(sim.player.dead).toBe(false);
    expect(sim.player.hp).toBe(sim.player.maxHp);
    expect(god.dead).toBe(false);
    expect(god.hp).toBe(god.maxHp);
  });
});
