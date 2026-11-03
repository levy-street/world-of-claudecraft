// The dungeon door level floor: content/dungeon_entry_levels.ts authors one
// minimum per gated dungeon, instances/dungeon_level_gate.ts judges it, and
// enterDungeon refuses an under-level entrant with one throttled error line.
// Every entry path (walk-in trigger, door click, server command, finder
// travel) funnels through enterDungeon; the walk-in trigger, the direct call
// and the finder preflight are exercised here.

import { describe, expect, it } from 'vitest';
import { DUNGEON_ENTRY_MIN_LEVEL } from '../src/sim/content/dungeon_entry_levels';
import { FINDER_ACTIVITIES } from '../src/sim/content/dungeon_finder';
import { DUNGEONS } from '../src/sim/data';
import { IGNIVAR_RAID_ROOM_IDS } from '../src/sim/ignivar_raid_ids';
import {
  DUNGEON_LEVEL_DENIED_NOTICE_SECONDS,
  dungeonEntryMinLevel,
  dungeonLevelDeniedText,
  dungeonLevelRequirement,
  sameLevelFloorFamily,
} from '../src/sim/instances/dungeon_level_gate';
import { enterDungeon, updateDoorTriggers } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

const makeSim = (): Sim => new Sim({ seed: 42, playerClass: 'warrior' });

function errorTexts(events: SimEvent[]): string[] {
  return events.flatMap((ev) => (ev.type === 'error' ? [ev.text] : []));
}

describe('dungeon door level floors (content)', () => {
  it('names only real dungeons', () => {
    for (const id of Object.keys(DUNGEON_ENTRY_MIN_LEVEL)) expect(DUNGEONS[id]).toBeDefined();
  });

  it('matches the finder normal band floor for every gated dungeon the finder lists', () => {
    const normals = FINDER_ACTIVITIES.filter(
      (a) => a.difficulty === 'normal' && a.dungeonId in DUNGEON_ENTRY_MIN_LEVEL,
    );
    expect(normals.map((a) => a.dungeonId).sort()).toEqual(
      [
        'gravewyrm_sanctum',
        'hollow_crypt',
        'drowned_temple',
        'ignivar_raid_arena',
        'nythraxis_boss_arena',
        'sunken_bastion',
        'wildheart_basin',
      ].sort(),
    );
    for (const a of normals) expect(dungeonEntryMinLevel(a.dungeonId)).toBe(a.minLevel);
  });

  it('pins the authored floors', () => {
    expect(DUNGEON_ENTRY_MIN_LEVEL).toEqual({
      hollow_crypt: 7,
      sunken_bastion: 12,
      drowned_temple: 16,
      gravewyrm_sanctum: 19,
      wildheart_basin: 20,
      nythraxis_boss_arena: 20,
      ignivar_forge_lift: 20,
      ignivar_forge_approach: 20,
      ignivar_raid_arena: 20,
      ignivar_molten_assembly: 20,
      ignivar_inner_crucible: 20,
    });
    for (const room of IGNIVAR_RAID_ROOM_IDS) expect(dungeonEntryMinLevel(room)).toBe(20);
  });

  it('leaves exactly the zero-combat rooms and the solo attunement crypt ungated', () => {
    const ungated = Object.keys(DUNGEONS)
      .filter((id) => dungeonEntryMinLevel(id) === 0)
      .sort();
    expect(ungated).toEqual(['dawnhold_castle', 'nythraxis_crypt', 'the_last_keep']);
  });

  it('treats only the same room or the Ignivar chain as moving between rooms', () => {
    expect(sameLevelFloorFamily('hollow_crypt', 'hollow_crypt')).toBe(true);
    expect(sameLevelFloorFamily('ignivar_forge_lift', 'ignivar_raid_arena')).toBe(true);
    expect(sameLevelFloorFamily('nythraxis_crypt', 'nythraxis_boss_arena')).toBe(false);
    expect(sameLevelFloorFamily('hollow_crypt', 'sunken_bastion')).toBe(false);
  });

  it('judges the floor inclusively', () => {
    expect(dungeonLevelRequirement('hollow_crypt', 6)).toBe(7);
    expect(dungeonLevelRequirement('hollow_crypt', 7)).toBeNull();
    expect(dungeonLevelRequirement('the_last_keep', 1)).toBeNull();
    expect(dungeonLevelDeniedText('Hollow Crypt', 7)).toBe(
      'You must be level 7 to enter Hollow Crypt.',
    );
  });
});

describe('dungeon door level floors (enterDungeon)', () => {
  it('turns away an under-level player with one error and admits them at the floor', () => {
    const sim = makeSim();
    const p = sim.player;
    p.level = 6;
    sim.drainEvents();
    expect(sim.enterDungeon('hollow_crypt')).toBe(false);
    expect(sim.instanceInfoAt(p.pos)).toBeNull();
    expect(errorTexts(sim.drainEvents())).toEqual([
      dungeonLevelDeniedText(DUNGEONS.hollow_crypt.name, 7),
    ]);
    p.level = 7;
    expect(sim.enterDungeon('hollow_crypt')).toBe(true);
    expect(sim.instanceInfoAt(p.pos)?.dungeonId).toBe('hollow_crypt');
  });

  it('claims no instance for a refused entrant', () => {
    const sim = makeSim();
    sim.player.level = 1;
    expect(sim.enterDungeon('sunken_bastion')).toBe(false);
    expect(sim.ctx.instances.some((i) => i.partyKey !== null)).toBe(false);
  });

  it('gates the walk-in door trigger and throttles its repeated denial', () => {
    const sim = makeSim();
    const p = sim.player;
    p.level = 11;
    const door = DUNGEONS.sunken_bastion.doorPos;
    p.pos = sim.groundPos(door.x, door.z);
    sim.drainEvents();
    updateDoorTriggers(sim.ctx, p);
    updateDoorTriggers(sim.ctx, p);
    expect(sim.instanceInfoAt(p.pos)).toBeNull();
    expect(errorTexts(sim.drainEvents())).toEqual([
      dungeonLevelDeniedText(DUNGEONS.sunken_bastion.name, 12),
    ]);
    sim.time += DUNGEON_LEVEL_DENIED_NOTICE_SECONDS;
    updateDoorTriggers(sim.ctx, p);
    expect(errorTexts(sim.drainEvents())).toHaveLength(1);
    p.level = 12;
    updateDoorTriggers(sim.ctx, p);
    expect(sim.instanceInfoAt(p.pos)?.dungeonId).toBe('sunken_bastion');
  });

  it('gates the raid rooms at the level cap', () => {
    const sim = makeSim();
    sim.player.level = 19;
    sim.drainEvents();
    expect(sim.enterDungeon('ignivar_forge_lift')).toBe(false);
    expect(errorTexts(sim.drainEvents())).toEqual([
      dungeonLevelDeniedText(DUNGEONS.ignivar_forge_lift.name, 20),
    ]);
  });

  it('leaves ungated rooms open at level 1', () => {
    const sim = makeSim();
    expect(sim.player.level).toBe(1);
    expect(sim.enterDungeon('the_last_keep')).toBe(true);
  });

  it('a finder preflight is refused silently and marks no throttle', () => {
    const sim = makeSim();
    sim.player.level = 1;
    sim.drainEvents();
    expect(
      enterDungeon(sim.ctx, 'hollow_crypt', sim.player.id, false, { preflightOnly: true }),
    ).toBe(false);
    expect(errorTexts(sim.drainEvents())).toEqual([]);
    expect(sim.player.dungeonLevelDeniedAt).toBeUndefined();
  });

  it('never strands a ghost outside the claim that holds its corpse', () => {
    const sim = makeSim();
    const p = sim.player;
    p.level = 7;
    expect(sim.enterDungeon('hollow_crypt')).toBe(true);
    const inst = sim.ctx.instances.find((i) => i.dungeonId === 'hollow_crypt' && i.partyKey)!;
    const corpse = { ...p.pos };
    sim.leaveDungeon();
    // A floor raised after the death (or a character from before the floor
    // shipped) must still reach its own body.
    p.level = 1;
    p.dead = true;
    p.ghost = true;
    p.corpsePos = corpse;
    p.corpseInstanceId = inst.exitId;
    expect(sim.enterDungeon('hollow_crypt')).toBe(true);
    expect(sim.instanceClaimIdAt(p.pos)).toBe(inst.exitId);
  });

  it('still gates a ghost whose corpse is not in a claim of that dungeon', () => {
    const sim = makeSim();
    const p = sim.player;
    p.level = 1;
    p.dead = true;
    p.ghost = true;
    p.corpsePos = { ...p.pos };
    p.corpseInstanceId = null;
    expect(sim.enterDungeon('hollow_crypt')).toBe(false);
  });

  it('never applies the floor to a player already inside a claim', () => {
    // The floor is a rule for entrants from outside: the Ignivar backtrack
    // exit re-enters the previous room through enterDungeon, which must not
    // strand a character a dev teleport put inside below the floor.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', devCommands: true });
    const p = sim.player;
    expect(p.level).toBe(1);
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', p.id, true)).toBe(true);
    expect(sim.instanceInfoAt(p.pos)?.dungeonId).toBe('ignivar_raid_arena');
    // The backtrack exit then answers to the forge gate rules (a solo tester
    // here meets the sealed gate); the level floor itself never speaks.
    sim.drainEvents();
    sim.leaveDungeon();
    const errors = errorTexts(sim.drainEvents());
    expect(errors.some((text) => text.startsWith('You must be level'))).toBe(false);
  });

  it('still applies the arena floor to a player inside the ungated Nythraxis crypt', () => {
    const sim = makeSim();
    const p = sim.player;
    expect(sim.enterDungeon('nythraxis_crypt')).toBe(true);
    expect(sim.instanceInfoAt(p.pos)?.dungeonId).toBe('nythraxis_crypt');
    sim.drainEvents();
    expect(sim.enterDungeon('nythraxis_boss_arena')).toBe(false);
    expect(errorTexts(sim.drainEvents())).toEqual([
      dungeonLevelDeniedText(DUNGEONS.nythraxis_boss_arena.name, 20),
    ]);
  });

  it('the dev teleport bypass skips the floor only on a dev-enabled sim', () => {
    const dev = new Sim({ seed: 42, playerClass: 'warrior', devCommands: true });
    dev.player.level = 1;
    expect(enterDungeon(dev.ctx, 'hollow_crypt', dev.player.id, true)).toBe(true);
    const prod = makeSim();
    prod.player.level = 1;
    expect(enterDungeon(prod.ctx, 'hollow_crypt', prod.player.id, true)).toBe(false);
  });
});
