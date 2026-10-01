// The online half of the mob inspect stat read: the strict reply decoder
// (src/net/mob_inspect_wire.ts), the single-pending request
// (src/net/mob_inspect_request.ts), and its routing through the shared
// WorldInteractionRequests owner (the `inspectMob` send and the
// `mobInspectInfo` reply).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobInspectRequest } from '../src/net/mob_inspect_request';
import { decodeMobInspectInfoReply } from '../src/net/mob_inspect_wire';
import { WorldInteractionRequests } from '../src/net/world_interaction_requests';
import type { MobInspectInfo } from '../src/world_api';

const INFO: MobInspectInfo = {
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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('decodeMobInspectInfoReply', () => {
  it('decodes a full reply and a null answer', () => {
    expect(decodeMobInspectInfoReply({ t: 'mobInspectInfo', id: 7, rid: 2, info: INFO })).toEqual({
      id: 7,
      rid: 2,
      info: INFO,
    });
    expect(decodeMobInspectInfoReply({ t: 'mobInspectInfo', id: 7, rid: 2, info: null })).toEqual({
      id: 7,
      rid: 2,
      info: null,
    });
  });

  it('never aliases the wire object', () => {
    const raw = { t: 'mobInspectInfo', id: 7, rid: 2, info: { ...INFO } };
    const decoded = decodeMobInspectInfoReply(raw);
    expect(decoded?.info).not.toBe(raw.info);
  });

  it.each([
    ['another frame type', { t: 'corpseHarvestInfo', id: 7, rid: 2, info: null }],
    ['a zero rid', { t: 'mobInspectInfo', id: 7, rid: 0, info: null }],
    ['a body for a different mob', { t: 'mobInspectInfo', id: 8, rid: 2, info: INFO }],
    ['a negative armor', { t: 'mobInspectInfo', id: 7, rid: 2, info: { ...INFO, armor: -1 } }],
    [
      'an inverted weapon range',
      { t: 'mobInspectInfo', id: 7, rid: 2, info: { ...INFO, weaponMin: 20, weaponMax: 10 } },
    ],
    ['a NaN speed', { t: 'mobInspectInfo', id: 7, rid: 2, info: { ...INFO, attackSpeed: NaN } }],
    ['a zero level', { t: 'mobInspectInfo', id: 7, rid: 2, info: { ...INFO, level: 0 } }],
    [
      'a malformed template id',
      { t: 'mobInspectInfo', id: 7, rid: 2, info: { ...INFO, templateId: '<b>x</b>' } },
    ],
    ['an array body', { t: 'mobInspectInfo', id: 7, rid: 2, info: [] }],
    [
      'a non-boolean immunity flag',
      { t: 'mobInspectInfo', id: 7, rid: 2, info: { ...INFO, ccImmune: 1 } },
    ],
    [
      'a missing immunity flag',
      { t: 'mobInspectInfo', id: 7, rid: 2, info: { ...INFO, slowImmune: undefined } },
    ],
  ])('fails the whole frame closed on %s', (_label, raw) => {
    expect(decodeMobInspectInfoReply(raw)).toBeNull();
  });
});

describe('MobInspectRequest', () => {
  it('sends once per subject and resolves on the matching reply', async () => {
    const sends: { id: number; rid: number }[] = [];
    const req = new MobInspectRequest((id, rid) => sends.push({ id, rid }));
    const a = req.issue(7);
    expect(req.issue(7)).toBe(a);
    expect(sends).toHaveLength(1);
    req.onReply({ t: 'mobInspectInfo', id: 7, rid: sends[0].rid + 1, info: INFO }); // wrong rid
    req.onReply({ t: 'mobInspectInfo', id: 7, rid: sends[0].rid, info: INFO });
    await expect(a).resolves.toEqual(INFO);
  });

  it('a new subject settles the old read null', async () => {
    const sends: { id: number; rid: number }[] = [];
    const req = new MobInspectRequest((id, rid) => sends.push({ id, rid }));
    const a = req.issue(7);
    const b = req.issue(8);
    await expect(a).resolves.toBeNull();
    req.onReply({ t: 'mobInspectInfo', id: 8, rid: sends[1].rid, info: { ...INFO, mobId: 8 } });
    await expect(b).resolves.toMatchObject({ mobId: 8 });
  });

  it('settles null on timeout, on reset, and when the send throws', async () => {
    const req = new MobInspectRequest(() => {});
    const timed = req.issue(7);
    vi.advanceTimersByTime(5000);
    await expect(timed).resolves.toBeNull();
    const reset = req.issue(7);
    req.reset();
    await expect(reset).resolves.toBeNull();
    const throwing = new MobInspectRequest(() => {
      throw new Error('socket gone');
    });
    await expect(throwing.issue(7)).resolves.toBeNull();
  });
});

describe('WorldInteractionRequests.inspectMob', () => {
  function rig(canSend = true) {
    const sends: Record<string, unknown>[] = [];
    const requests = new WorldInteractionRequests({
      canSend: () => canSend,
      sendRawCommand: (payload) => sends.push(payload),
    });
    return { requests, sends };
  }

  it('sends the inspectMob command and routes the mobInspectInfo reply', async () => {
    const { requests, sends } = rig();
    const read = requests.inspectMob(7);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ cmd: 'inspectMob', id: 7 });
    const rid = sends[0].rid as number;
    expect(requests.onMessage({ t: 'mobInspectInfo', id: 7, rid, info: INFO })).toBe(true);
    await expect(read).resolves.toEqual(INFO);
  });

  it('refuses locally when it cannot send, and reset settles a pending read null', async () => {
    const off = rig(false);
    await expect(off.requests.inspectMob(7)).resolves.toBeNull();
    expect(off.sends).toEqual([]);
    const on = rig();
    const read = on.requests.inspectMob(7);
    on.requests.reset();
    await expect(read).resolves.toBeNull();
  });

  it('still sends the corpse query through the same raw send', () => {
    const { requests, sends } = rig();
    void requests.inspectCorpse(9);
    expect(sends[0]).toMatchObject({ cmd: 'inspectCorpseHarvest', id: 9 });
  });
});
