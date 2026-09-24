import { describe, expect, it, vi } from 'vitest';
import { HOARD_REWARD_LETTER } from '../../src/sim/content/letters';
import { Sim } from '../../src/sim/sim';

const { saveMailPartitions } = vi.hoisted(() => ({
  saveMailPartitions: vi.fn(async (_partitions: unknown[]) => {}),
}));
vi.mock('../../server/db', () => ({ saveMailPartitions }));

import {
  takeMailPartitionsForCharacterSave,
  writeDirtyMailPartitions,
} from '../../server/mail_partition_rearm';

describe('vault mail take partition lock', () => {
  it('keeps the recipient partition dirty for the character+mail transaction', async () => {
    const dirty = new Map<string, { recipientKey: string; letters: [] }>([
      ['7', { recipientKey: '7', letters: [] }],
      ['8', { recipientKey: '8', letters: [] }],
    ]);
    const sim = {
      takeDirtyMailPartitions: () => {
        const taken = [...dirty.values()];
        dirty.clear();
        return taken;
      },
      markMailPartitionsDirty: (keys: readonly string[]) => {
        for (const key of keys) dirty.set(key, { recipientKey: key, letters: [] });
      },
    };
    await writeDirtyMailPartitions(sim, async (write) => write(), false, undefined, new Set(['7']));
    expect(saveMailPartitions).toHaveBeenCalledWith([{ recipientKey: '8', letters: [] }]);
    expect([...dirty.keys()]).toEqual(['7']);
  });

  it('defers a protected recipient in every other character save', () => {
    const dirty = new Map<string, { recipientKey: string; letters: [] }>([
      ['7', { recipientKey: '7', letters: [] }],
      ['8', { recipientKey: '8', letters: [] }],
    ]);
    const sim = {
      takeDirtyMailPartitions: () => {
        const taken = [...dirty.values()];
        dirty.clear();
        return taken;
      },
      markMailPartitionsDirty: (keys: readonly string[]) => {
        for (const key of keys) dirty.set(key, { recipientKey: key, letters: [] });
      },
    };
    expect(
      takeMailPartitionsForCharacterSave(sim, 8, new Set(['7'])).map((p) => p.recipientKey),
    ).toEqual(['8']);
    expect([...dirty.keys()]).toEqual(['7']);
    expect(
      takeMailPartitionsForCharacterSave(sim, 7, new Set(['7'])).map((p) => p.recipientKey),
    ).toEqual(['7']);
  });

  it('drains only the claimant mailbox for a vault take, leaving realm mail dirty', () => {
    const dirty = new Map<string, { recipientKey: string; letters: [] }>([
      ['7', { recipientKey: '7', letters: [] }],
      ['8', { recipientKey: '8', letters: [] }],
    ]);
    const sim = {
      takeDirtyMailPartitions: () => {
        const taken = [...dirty.values()];
        dirty.clear();
        return taken;
      },
      postOffice: {
        takeDirtyMailPartition: (key: string) => {
          const taken = dirty.get(key);
          dirty.delete(key);
          return taken ? [taken] : [];
        },
      },
      markMailPartitionsDirty: (keys: readonly string[]) => {
        for (const key of keys) dirty.set(key, { recipientKey: key, letters: [] });
      },
    };
    expect(
      takeMailPartitionsForCharacterSave(sim, 7, new Set(['7']), true).map(
        (partition) => partition.recipientKey,
      ),
    ).toEqual(['7']);
    expect([...dirty.keys()]).toEqual(['8']);
  });

  it('keeps another real post-office recipient dirty after a targeted drain', () => {
    const sim = new Sim({ seed: 29, playerClass: 'warrior', noPlayer: true });
    for (const key of ['7', '8']) {
      expect(
        sim.mailSystemParcel(
          { key, name: `Character${key}` },
          HOARD_REWARD_LETTER,
          [{ itemId: 'thorium_ore', count: 1 }],
          `vault:test:${key}`,
        ),
      ).toBe(true);
    }
    expect(sim.postOffice.takeDirtyMailPartition('7').map((p) => p.recipientKey)).toEqual(['7']);
    expect(sim.takeDirtyMailPartitions().map((p) => p.recipientKey)).toEqual(['8']);
  });
});
