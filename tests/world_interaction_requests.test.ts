import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorldInteractionRequests } from '../src/net/world_interaction_requests';

function rig(canSend = true) {
  const commandSends: Record<string, unknown>[] = [];
  const inspectSends: { id: number; rid: number }[] = [];
  const requests = new WorldInteractionRequests({
    canSend: () => canSend,
    sendRawCommand: (payload) => commandSends.push(payload),
    sendInspectCorpseHarvest: (id, rid) => inspectSends.push({ id, rid }),
  });
  return { requests, commandSends, inspectSends };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('WorldInteractionRequests.command', () => {
  it('resolves false locally and sends nothing when canSend() is false', async () => {
    const { requests, commandSends } = rig(false);
    await expect(requests.command({ cmd: 'loot', id: 7 })).resolves.toBe(false);
    expect(commandSends).toEqual([]);
  });

  it('sends the payload with an allocated rid and resolves on the matching commandOutcome', async () => {
    const { requests, commandSends } = rig();
    const outcome = requests.command({ cmd: 'loot', id: 7 });
    expect(commandSends).toHaveLength(1);
    const sent = commandSends[0] as { cmd: string; id: number; rid: number };
    expect(sent).toMatchObject({ cmd: 'loot', id: 7 });
    expect(Number.isSafeInteger(sent.rid)).toBe(true);

    expect(requests.onMessage({ t: 'commandOutcome', rid: sent.rid, ok: true })).toBe(true);
    await expect(outcome).resolves.toBe(true);
  });

  it('a mismatched rid is ignored (onMessage returns false, nothing settles)', async () => {
    const { requests, commandSends } = rig();
    const outcome = requests.command({ cmd: 'loot', id: 7 });
    const sent = commandSends[0] as { rid: number };

    expect(requests.onMessage({ t: 'commandOutcome', rid: sent.rid + 1, ok: true })).toBe(true);

    let settled = false;
    void outcome.then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  it('times out to false after 5s with no reply', async () => {
    const { requests } = rig();
    const outcome = requests.command({ cmd: 'loot', id: 7 });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(outcome).resolves.toBe(false);
  });
});

describe('WorldInteractionRequests.inspectCorpse', () => {
  it('resolves null locally and sends nothing when canSend() is false', async () => {
    const { requests, inspectSends } = rig(false);
    await expect(requests.inspectCorpse(101)).resolves.toBeNull();
    expect(inspectSends).toEqual([]);
  });

  it('sends id+rid and resolves the matching corpseHarvestInfo reply', async () => {
    const { requests, inspectSends } = rig();
    const outcome = requests.inspectCorpse(101);
    expect(inspectSends).toHaveLength(1);
    const { id, rid } = inspectSends[0];
    expect(id).toBe(101);

    expect(requests.onMessage({ t: 'corpseHarvestInfo', id, rid, info: null })).toBe(true);
    await expect(outcome).resolves.toBeNull();
  });

  it('shares the pending promise for a same-subject reentrant issue and supersedes a different one to null', async () => {
    const { requests, inspectSends } = rig();
    const first = requests.inspectCorpse(101);
    const same = requests.inspectCorpse(101);
    expect(same).toBe(first);
    expect(inspectSends).toHaveLength(1);

    const other = requests.inspectCorpse(202);
    await expect(first).resolves.toBeNull();
    expect(inspectSends).toHaveLength(2);

    const { id, rid } = inspectSends[1];
    expect(id).toBe(202);
    requests.onMessage({ t: 'corpseHarvestInfo', id, rid, info: null });
    await expect(other).resolves.toBeNull();
  });

  it('a malformed reply still routes (onMessage returns true, it IS a corpseHarvestInfo frame) but never settles the pending request', async () => {
    const { requests } = rig();
    const outcome = requests.inspectCorpse(101);

    // Routed to its owner (CorpseHarvestInfoRequest), which decodes it and
    // discards it as malformed internally; `onMessage` answers whether the
    // FRAME SHAPE was one of the two reply types, never whether the leaf
    // accepted its payload.
    expect(requests.onMessage({ t: 'corpseHarvestInfo', id: 101 })).toBe(true);

    let settled = false;
    void outcome.then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  it('a frame of neither reply shape is left untouched', () => {
    const { requests } = rig();
    expect(requests.onMessage({ t: 'hello' })).toBe(false);
  });
});

describe('WorldInteractionRequests.reset / resetQuery', () => {
  it('reset() settles a pending command false and a pending inspection null', async () => {
    const { requests } = rig();
    const command = requests.command({ cmd: 'loot', id: 7 });
    const inspection = requests.inspectCorpse(101);

    requests.reset();

    await expect(command).resolves.toBe(false);
    await expect(inspection).resolves.toBeNull();
  });

  it('resetQuery() settles only the pending inspection, never a pending command', async () => {
    const { requests } = rig();
    const command = requests.command({ cmd: 'loot', id: 7 });
    const inspection = requests.inspectCorpse(101);

    requests.resetQuery();

    await expect(inspection).resolves.toBeNull();
    let commandSettled = false;
    void command.then(() => {
      commandSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(commandSettled).toBe(false);
  });
});
