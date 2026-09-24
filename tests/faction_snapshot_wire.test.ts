import { describe, expect, it } from 'vitest';
import { applyFactionSelfWire } from '../src/net/faction_snapshot_wire';
import { CLUE_HUNTS } from '../src/sim/content/clue_hunts';
import { WORLD_QUESTS } from '../src/sim/content/world_quests';
import { MAX_STANDING } from '../src/sim/factions';
import { Sim } from '../src/sim/sim';
import { worldQuestCycleForResetDay } from '../src/sim/world_quest_rotation';
import { bareClient } from './helpers/bare_client';

const cycle = worldQuestCycleForResetDay('2026-08-31');

describe('faction standing and reroll owner wire', () => {
  it('applies a well-formed standing and currency record and freezes the mirror', () => {
    const target = {
      factions: undefined,
      factionCurrencies: undefined,
      worldQuestRerollCycle: '',
      worldQuestReplacements: {},
    };
    applyFactionSelfWire(target, {
      fac: { rift_watch: 30, church_order: 1_200, automatons: 0 },
      facCur: { rift_watch: 25, church_order: 10, automatons: 0 },
    });
    expect(target.factions).toEqual({ rift_watch: 30, church_order: 1_200, automatons: 0 });
    expect(target.factionCurrencies).toEqual({ rift_watch: 25, church_order: 10, automatons: 0 });
    expect(Object.isFrozen(target.factions)).toBe(true);
    expect(Object.isFrozen(target.factionCurrencies)).toBe(true);
  });

  it('omission retains the previous mirror; a malformed record is clamped, never trusted', () => {
    const target = {
      factions: Object.freeze({ rift_watch: 30, church_order: 0, automatons: 0 }),
      factionCurrencies: Object.freeze({ rift_watch: 15, church_order: 0, automatons: 0 }),
      worldQuestRerollCycle: cycle,
      worldQuestReplacements: Object.freeze({}),
    };
    applyFactionSelfWire(target, {});
    expect(target.factions).toEqual({ rift_watch: 30, church_order: 0, automatons: 0 });
    expect(target.factionCurrencies).toEqual({ rift_watch: 15, church_order: 0, automatons: 0 });
    expect(target.worldQuestRerollCycle).toBe(cycle);
    applyFactionSelfWire(target, {
      fac: { rift_watch: -5, church_order: MAX_STANDING * 10, automatons: 'x', bogus: 9 },
      facCur: { rift_watch: -10, church_order: 50.8, automatons: 'invalid', bogus: 99 },
    });
    expect(target.factions.rift_watch).toBe(0);
    expect(target.factions.church_order).toBe(MAX_STANDING);
    expect(target.factions.automatons).toBe(0);
    expect('bogus' in target.factions).toBe(false);
    expect(target.factionCurrencies.rift_watch).toBe(0);
    expect(target.factionCurrencies.church_order).toBe(50);
    expect(target.factionCurrencies.automatons).toBe(0);
    expect('bogus' in target.factionCurrencies).toBe(false);
  });

  it('keeps a replacement only for a quest active on the mirrored day', () => {
    const active = WORLD_QUESTS.filter((quest) => quest.zoneId === 'eastbrook_vale').slice(0, 2);
    const target = {
      factions: undefined,
      factionCurrencies: undefined,
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
      facCur: { rift_watch: 30, church_order: 10, automatons: 5 },
      wqrr: cycle,
      wqrep: {},
    });
    expect(Object.keys(client.factions).sort()).toEqual(Object.keys(sim.factions).sort());
    expect(client.factions.rift_watch).toBe(60);
    expect(Object.keys(client.factionCurrencies).sort()).toEqual(
      Object.keys(sim.factionCurrencies).sort(),
    );
    expect(client.factionCurrencies.rift_watch).toBe(30);
    expect(client.worldQuestRerollCycle).toBe(cycle);
    expect(typeof sim.worldQuestRerollCycle).toBe(typeof client.worldQuestRerollCycle);
    // Clue Scrolls: both worlds expose the same cursor shape; a fresh
    // character has no hunt on either side.
    expect(client.clueHunt).toBeNull();
    expect(sim.clueHunt).toBeNull();
  });
});

describe('clue hunt owner wire (cluh)', () => {
  const hunt = CLUE_HUNTS[0];

  it('applies a well-formed cursor on a shipped hunt and freezes the mirror', () => {
    const target = { clueHunt: null as { huntId: string; step: number } | null };
    applyFactionSelfWire(target, { cluh: { huntId: hunt.id, step: 1 } });
    expect(target.clueHunt).toEqual({ huntId: hunt.id, step: 1 });
    expect(Object.isFrozen(target.clueHunt)).toBe(true);
  });

  it('omission retains the previous cursor; an explicit null clears it', () => {
    const target = {
      clueHunt: Object.freeze({ huntId: hunt.id, step: 1 }) as {
        huntId: string;
        step: number;
      } | null,
    };
    applyFactionSelfWire(target, { fac: { rift_watch: 1, church_order: 0, automatons: 0 } });
    expect(target.clueHunt).toEqual({ huntId: hunt.id, step: 1 });
    applyFactionSelfWire(target, { cluh: null });
    expect(target.clueHunt).toBeNull();
  });

  it('junk decodes to null and an out-of-range step is clamped, never trusted', () => {
    const target = {
      clueHunt: Object.freeze({ huntId: hunt.id, step: 0 }) as {
        huntId: string;
        step: number;
      } | null,
    };
    applyFactionSelfWire(target, { cluh: 'junk' });
    expect(target.clueHunt).toBeNull();
    applyFactionSelfWire(target, { cluh: { huntId: 'hunt_not_real', step: 0 } });
    expect(target.clueHunt).toBeNull();
    applyFactionSelfWire(target, { cluh: { huntId: hunt.id, step: 99 } });
    expect(target.clueHunt).toEqual({ huntId: hunt.id, step: hunt.steps.length - 1 });
    applyFactionSelfWire(target, { cluh: { huntId: hunt.id, step: -3 } });
    expect(target.clueHunt).toEqual({ huntId: hunt.id, step: 0 });
    applyFactionSelfWire(target, { cluh: { huntId: hunt.id } });
    expect(target.clueHunt).toEqual({ huntId: hunt.id, step: 0 });
  });

  it('a ClientWorld self snapshot mirrors the cursor onto IWorld.clueHunt', () => {
    const client = bareClient(1);
    client.applyQuestSelfSnapshot({ cluh: { huntId: hunt.id, step: 2 } });
    expect(client.clueHunt).toEqual({ huntId: hunt.id, step: 2 });
    client.applyQuestSelfSnapshot({});
    expect(client.clueHunt).toEqual({ huntId: hunt.id, step: 2 });
    client.applyQuestSelfSnapshot({ cluh: null });
    expect(client.clueHunt).toBeNull();
  });
});
