import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveCharacterSnapshot, saveDepartingCharacter } from '../server/character_final_save';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const session = (name: string) => ({
  name,
  dirtyGuildBanks: new Map<number, number>(),
  escrowQuarantined: false,
});

describe('final character saves', () => {
  it('keeps the existing five-attempt backoff and surfaces exhaustion', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = vi.fn().mockRejectedValue(new Error('offline'));
    const exhausted = vi.fn((error: unknown) => {
      throw error;
    });
    const result = expect(
      saveDepartingCharacter('Player', save, () => false, exhausted),
    ).rejects.toThrow('offline');
    await vi.advanceTimersByTimeAsync(3749);
    expect(save).toHaveBeenCalledTimes(4);
    expect(exhausted).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(save).toHaveBeenCalledTimes(5);
    expect(exhausted).toHaveBeenCalledTimes(1);
  });

  it('does not retry quarantined state that must reload from durable truth', async () => {
    const save = vi.fn().mockResolvedValue(false);
    const exhausted = vi.fn();
    await saveDepartingCharacter('Displaced', save, () => true, exhausted);
    expect(save).toHaveBeenCalledTimes(1);
    expect(exhausted).not.toHaveBeenCalled();
  });

  it('refuses a clean shutdown for a false non-quarantined save', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      saveCharacterSnapshot([session('Refused')], 'shutdown', 4, async () => false),
    ).rejects.toThrow('1 shutdown character saves failed');
  });

  it('keeps autosave failure handling unchanged', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      saveCharacterSnapshot([session('Offline')], 'autosave', 4, async () => {
        throw new Error('offline');
      }),
    ).resolves.toBeUndefined();
  });

  it('allows the existing final guild-book pass to resolve an initial refusal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const player = session('Guild');
    player.dirtyGuildBanks.set(1, 1);
    const save = vi.fn(async (_player, final) => final === true);
    await saveCharacterSnapshot([player], 'shutdown', 4, save);
    expect(save.mock.calls.map((call) => call[1])).toEqual([false, true]);
  });

  it('awaits every worker on failure and never exceeds four active saves', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const players = Array.from({ length: 9 }, (_, i) => session(String(i)));
    let active = 0;
    let maximum = 0;
    let completed = 0;
    const releases: (() => void)[] = [];
    const save = async (player: ReturnType<typeof session>) => {
      maximum = Math.max(maximum, ++active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
      completed++;
      if (player.name === '0') throw new Error('offline');
      return true;
    };
    const outcome = expect(saveCharacterSnapshot(players, 'shutdown', 4, save)).rejects.toThrow();
    while (completed < players.length) {
      for (const release of releases.splice(0)) release();
      await new Promise((resolve) => setImmediate(resolve));
    }
    await outcome;
    expect(maximum).toBe(4);
    expect(completed).toBe(9);
  });
});
