import { describe, expect, it, vi } from 'vitest';
import { dispatchInspectionCommand } from '../../server/inspection_commands';
import {
  dispatchMobInspection,
  mobInspectionReply,
  validInspectMobCommand,
} from '../../server/mob_inspection';
import type { MobInspectInfo } from '../../src/world_api';

// A full MobInspectInfo (every field), the exact shape Sim.mobInspectInfo returns.
const SAMPLE: MobInspectInfo = {
  mobId: 7,
  templateId: 'forest_wolf',
  level: 6,
  maxHp: 120,
  weaponMin: 8,
  weaponMax: 13,
  attackSpeed: 2,
  armor: 75,
  ccImmune: false,
  slowImmune: false,
};

function fakeSim(info: MobInspectInfo | null, time = 10) {
  return {
    time,
    mobInspectInfo: vi.fn((_id: number, _pid?: number) => info),
    corpseHarvestInfo: vi.fn(() => null),
  };
}

describe('validInspectMobCommand', () => {
  it('accepts positive safe integer id and rid', () => {
    expect(validInspectMobCommand({ id: 7, rid: 3 })).toBe(true);
  });

  it.each([
    ['id missing', { rid: 3 }],
    ['rid missing', { id: 7 }],
    ['id zero', { id: 0, rid: 3 }],
    ['id negative', { id: -1, rid: 3 }],
    ['id non-integer', { id: 1.5, rid: 3 }],
    ['rid not a safe integer', { id: 7, rid: Number.MAX_SAFE_INTEGER + 1 }],
    ['id a string', { id: '7', rid: 3 }],
  ])('refuses %s', (_label, msg) => {
    expect(validInspectMobCommand(msg)).toBe(false);
  });
});

describe('mobInspectionReply', () => {
  it('returns null (no reply) on a malformed frame, never touching the sim', () => {
    const sim = fakeSim(SAMPLE);
    expect(mobInspectionReply(sim, {}, { id: 7 }, 9)).toBeNull();
    expect(sim.mobInspectInfo).not.toHaveBeenCalled();
  });

  it('asks the sim with the SESSION pid, never a payload pid, and echoes id/rid', () => {
    const sim = fakeSim(SAMPLE);
    const reply = mobInspectionReply(sim, {}, { id: 7, rid: 4, pid: 1 } as never, 9);
    expect(reply).toEqual({ id: 7, rid: 4, info: SAMPLE });
    expect(sim.mobInspectInfo).toHaveBeenCalledWith(7, 9);
  });

  it('answers a quick re-point to another mob (a burst of four real reads)', () => {
    const sim = fakeSim(SAMPLE, 10);
    const session = {};
    for (let id = 1; id <= 4; id++) mobInspectionReply(sim, session, { id, rid: id }, 9);
    expect(sim.mobInspectInfo).toHaveBeenCalledTimes(4);
    expect(sim.mobInspectInfo).toHaveBeenLastCalledWith(4, 9);
  });

  it('an empty bucket reuses the same-subject answer without a sim read, else null', () => {
    const sim = fakeSim(SAMPLE, 10);
    const session = {};
    for (let rid = 1; rid <= 4; rid++) mobInspectionReply(sim, session, { id: 7, rid }, 9);
    expect(sim.mobInspectInfo).toHaveBeenCalledTimes(4);
    expect(mobInspectionReply(sim, session, { id: 7, rid: 5 }, 9)).toEqual({
      id: 7,
      rid: 5,
      info: SAMPLE,
    });
    expect(mobInspectionReply(sim, session, { id: 8, rid: 6 }, 9)).toEqual({
      id: 8,
      rid: 6,
      info: null,
    });
    expect(sim.mobInspectInfo).toHaveBeenCalledTimes(4);
  });

  it('refills in sim time: a quarter second buys one more read', () => {
    const sim = fakeSim(SAMPLE, 10);
    const session = {};
    for (let rid = 1; rid <= 4; rid++) mobInspectionReply(sim, session, { id: rid, rid }, 9);
    sim.time = 10.25;
    mobInspectionReply(sim, session, { id: 8, rid: 5 }, 9);
    expect(sim.mobInspectInfo).toHaveBeenCalledTimes(5);
    expect(sim.mobInspectInfo).toHaveBeenLastCalledWith(8, 9);
    expect(mobInspectionReply(sim, session, { id: 9, rid: 6 }, 9)?.info).toBeNull();
    expect(sim.mobInspectInfo).toHaveBeenCalledTimes(5);
  });

  it('keeps each session independent', () => {
    const sim = fakeSim(SAMPLE, 10);
    mobInspectionReply(sim, {}, { id: 7, rid: 1 }, 9);
    mobInspectionReply(sim, {}, { id: 7, rid: 1 }, 10);
    expect(sim.mobInspectInfo).toHaveBeenCalledTimes(2);
  });
});

describe('dispatch', () => {
  it('sends the full mobInspectInfo frame, and nothing for a malformed one', () => {
    const sim = fakeSim(SAMPLE);
    const send = vi.fn();
    dispatchMobInspection(sim, {}, { id: 7, rid: 5 }, 9, send);
    expect(send).toHaveBeenCalledWith({ t: 'mobInspectInfo', id: 7, rid: 5, info: SAMPLE });
    send.mockClear();
    dispatchMobInspection(sim, {}, { id: 'x' }, 9, send);
    expect(send).not.toHaveBeenCalled();
  });

  it('the shared case group routes inspectMob and inspectCorpseHarvest to their own handlers', () => {
    const sim = fakeSim(SAMPLE);
    const send = vi.fn();
    dispatchInspectionCommand('inspectMob', sim, {}, { id: 7, rid: 1 }, 9, send);
    expect(sim.mobInspectInfo).toHaveBeenCalledTimes(1);
    expect(sim.corpseHarvestInfo).not.toHaveBeenCalled();
    expect(send.mock.calls[0][0].t).toBe('mobInspectInfo');
    dispatchInspectionCommand('inspectCorpseHarvest', sim, {}, { id: 7, rid: 2 }, 9, send);
    expect(sim.corpseHarvestInfo).toHaveBeenCalledTimes(1);
    expect(sim.mobInspectInfo).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[1][0].t).toBe('corpseHarvestInfo');
  });
});
