import { describe, expect, it } from 'vitest';
import { applyFactionSelfWire } from '../src/net/faction_snapshot_wire';
import { WORLD_QUESTS } from '../src/sim/content/world_quests';
import { MAX_STANDING } from '../src/sim/factions';
import { Sim } from '../src/sim/sim';
import { worldQuestCycleForResetDay } from '../src/sim/world_quest_rotation';
import { bareClient } from './helpers/bare_client';

const cycle = worldQuestCycleForResetDay('2026-08-31');

describe('faction standing and reroll owner wire', () => {
  it('applies a well-formed standing record and freezes the mirror', () => {
    const target = { factions: undefined, worldQuestRerollCycle: '', worldQuestReplacements: {} };
    applyFactionSelfWire(target, { fac: { rift_watch: 30, church_order: 1_200, automatons: 0 } });
    expect(target.factions).toEqual({ rift_watch: 30, church_order: 1_200, automatons: 0 });
    expect(Object.isFrozen(target.factions)).toBe(true);
  });

  it('omission retains the previous mirror; a malformed record is clamped, never trusted', () => {
    const target = {
      factions: Object.freeze({ rift_watch: 30, church_order: 0, automatons: 0 }),
      worldQuestRerollCycle: cycle,
      worldQuestReplacements: Object.freeze({}),
    };
    applyFactionSelfWire(target, {});
    expect(target.factions).toEqual({ rift_watch: 30, church_order: 0, automatons: 0 });
    expect(target.worldQuestRerollCycle).toBe(cycle);
    applyFactionSelfWire(target, {
      fac: { rift_watch: -5, church_order: MAX_STANDING * 10, automatons: 'x', bogus: 9 },
    });
    expect(target.factions.rift_watch).toBe(0);
    expect(target.factions.church_order).toBe(MAX_STANDING);
    expect(target.factions.automatons).toBe(0);
    expect('bogus' in target.factions).toBe(false);
  });

  it('keeps a replacement only for a quest active on the mirrored day', () => {
    const active = WORLD_QUESTS.filter((quest) => quest.zoneId === 'eastbrook_vale').slice(0, 2);
    const target = {
      factions: undefined,
      worldQuestCycle: cycle,
      worldQuestRerollCycle: '',
      worldQuestReplacements: Object.freeze({}),
    };
    applyFactionSelfWire(target, {
      wqrr: cycle,
      wqrep: { [active[0].id]: active[1].id, wq_not_real: active[1].id },
    });
    expect(target.worldQuestRerollCycle).toBe(cycle);
    expect(Object.keys(target.worldQuestReplacements)).not.toContain('wq_not_real');
    applyFactionSelfWire(target, { wqrr: 'not-a-cycle' });
    expect(target.worldQuestRerollCycle).toBe('');
  });

  it('a ClientWorld self snapshot lands on the same IWorld members the offline Sim exposes', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    const client = bareClient(1);
    client.applyQuestSelfSnapshot({
      fac: { rift_watch: 60, church_order: 0, automatons: 0 },
      wqrr: cycle,
      wqrep: {},
    });
    expect(Object.keys(client.factions).sort()).toEqual(Object.keys(sim.factions).sort());
    expect(client.factions.rift_watch).toBe(60);
    expect(client.worldQuestRerollCycle).toBe(cycle);
    expect(typeof sim.worldQuestRerollCycle).toBe(typeof client.worldQuestRerollCycle);
  });
});
