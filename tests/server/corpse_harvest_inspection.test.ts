import { describe, expect, it, vi } from 'vitest';
import {
  corpseHarvestInspectionReply,
  dispatchCorpseHarvestInspection,
  validInspectCorpseHarvestCommand,
} from '../../server/corpse_harvest_inspection';
import type { CorpseHarvestInfo } from '../../src/world_api';

// A full, real CorpseHarvestInfo shape (every field), never a partial cast or
// `any`: corpseHarvestInspectionReply/dispatchCorpseHarvestInspection are
// typed against the actual production interface, so the fixture must satisfy
// it exactly the way the real Sim.corpseHarvestInfo would.
const SAMPLE_INFO: CorpseHarvestInfo = {
  corpseId: 7,
  componentTags: ['hide', 'fang'],
  preference: null,
  denial: null,
  reservation: null,
  tierBonus: 0,
};

describe('validInspectCorpseHarvestCommand', () => {
  it('accepts positive safe integer id and rid', () => {
    expect(validInspectCorpseHarvestCommand({ id: 7, rid: 3 })).toBe(true);
  });

  it.each([
    ['id missing', { rid: 3 }],
    ['rid missing', { id: 7 }],
    ['id zero', { id: 0, rid: 3 }],
    ['rid zero', { id: 7, rid: 0 }],
    ['id negative', { id: -1, rid: 3 }],
    ['id non-integer', { id: 1.5, rid: 3 }],
    ['rid not a safe integer', { id: 7, rid: Number.MAX_SAFE_INTEGER + 1 }],
    ['id a string', { id: '7', rid: 3 }],
  ])('refuses %s', (_label, msg) => {
    expect(validInspectCorpseHarvestCommand(msg)).toBe(false);
  });
});

function fakeSim(info: CorpseHarvestInfo | null, time = 10) {
  return { time, corpseHarvestInfo: vi.fn(() => info) };
}

describe('corpseHarvestInspectionReply', () => {
  it('returns null (no reply) on a malformed frame, never touching the sim', () => {
    const sim = fakeSim(null);
    expect(corpseHarvestInspectionReply(sim, {}, { id: 7 }, 9)).toBeNull();
    expect(sim.corpseHarvestInfo).not.toHaveBeenCalled();
  });

  it('calls sim.corpseHarvestInfo with the session pid, never a payload one, on a valid frame', () => {
    const sim = fakeSim(SAMPLE_INFO);
    const session = {};
    const reply = corpseHarvestInspectionReply(sim, session, { id: 7, rid: 3 }, 9);
    expect(reply).toEqual({ id: 7, rid: 3, info: SAMPLE_INFO });
    expect(sim.corpseHarvestInfo).toHaveBeenCalledTimes(1);
    expect(sim.corpseHarvestInfo).toHaveBeenCalledWith(7, 9);
  });

  it('arms the session throttle so a next request lands 0.5 sim seconds later', () => {
    const sim = fakeSim(null, 10);
    const session: { nextCorpseHarvestInspectAt?: number } = {};
    corpseHarvestInspectionReply(sim, session, { id: 7, rid: 3 }, 9);
    expect(session.nextCorpseHarvestInspectAt).toBe(10.5);
  });

  it('a throttled request answers null on its own valid id/rid without touching the sim', () => {
    const sim = fakeSim(SAMPLE_INFO, 10);
    const session = { nextCorpseHarvestInspectAt: 10.4 };
    const reply = corpseHarvestInspectionReply(sim, session, { id: 7, rid: 3 }, 9);
    expect(reply).toEqual({ id: 7, rid: 3, info: null });
    expect(sim.corpseHarvestInfo).not.toHaveBeenCalled();
  });

  it('allows a request exactly at the throttle deadline', () => {
    const sim = fakeSim(SAMPLE_INFO, 10.4);
    const session = { nextCorpseHarvestInspectAt: 10.4 };
    const reply = corpseHarvestInspectionReply(sim, session, { id: 7, rid: 3 }, 9);
    expect(reply).toEqual({ id: 7, rid: 3, info: SAMPLE_INFO });
    expect(sim.corpseHarvestInfo).toHaveBeenCalledTimes(1);
  });

  it('the sim itself may still answer null (a real "no usable current answer")', () => {
    const sim = fakeSim(null);
    const reply = corpseHarvestInspectionReply(sim, {}, { id: 7, rid: 3 }, 9);
    expect(reply).toEqual({ id: 7, rid: 3, info: null });
  });
});

describe('dispatchCorpseHarvestInspection', () => {
  it('sends the full corpseHarvestInfo frame on a valid, correlatable frame', () => {
    const sim = fakeSim(SAMPLE_INFO);
    const send = vi.fn();
    dispatchCorpseHarvestInspection(sim, {}, { id: 7, rid: 3 }, 9, send);
    expect(send).toHaveBeenCalledWith({
      t: 'corpseHarvestInfo',
      id: 7,
      rid: 3,
      info: SAMPLE_INFO,
    });
  });

  it('sends nothing on a malformed, uncorrelatable frame', () => {
    const sim = fakeSim(null);
    const send = vi.fn();
    dispatchCorpseHarvestInspection(sim, {}, { id: 7 }, 9, send);
    expect(send).not.toHaveBeenCalled();
  });
});
