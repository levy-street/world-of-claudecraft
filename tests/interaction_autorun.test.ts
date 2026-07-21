import { describe, expect, it, vi } from 'vitest';
import { stopAutorunForInteraction } from '../src/game/interaction_autorun';

describe('stopAutorunForInteraction', () => {
  it('clears the autorun latch and its mobile lock indicator after an interaction', () => {
    const setAutorun = vi.fn();
    const clearClickMove = vi.fn();
    const syncAutorun = vi.fn();
    const movementIntentVersion = vi.fn(() => 0);

    expect(
      stopAutorunForInteraction(
        true,
        { setAutorun, clearClickMove, movementIntentVersion },
        { syncAutorun },
      ),
    ).toBe(true);
    expect(setAutorun).toHaveBeenCalledWith(false);
    expect(clearClickMove).toHaveBeenCalledOnce();
    expect(syncAutorun).toHaveBeenCalledWith(false);
  });

  it('preserves autorun when no world interaction happened', () => {
    const setAutorun = vi.fn();
    const clearClickMove = vi.fn();
    const syncAutorun = vi.fn();
    const movementIntentVersion = vi.fn(() => 0);

    expect(
      stopAutorunForInteraction(
        false,
        { setAutorun, clearClickMove, movementIntentVersion },
        { syncAutorun },
      ),
    ).toBe(false);
    expect(setAutorun).not.toHaveBeenCalled();
    expect(clearClickMove).not.toHaveBeenCalled();
    expect(syncAutorun).not.toHaveBeenCalled();
  });

  it('preserves autorun when the authoritative interaction is rejected', async () => {
    const setAutorun = vi.fn();
    const clearClickMove = vi.fn();
    const syncAutorun = vi.fn();
    const movementIntentVersion = vi.fn(() => 0);

    await expect(
      stopAutorunForInteraction(
        Promise.resolve(false),
        { setAutorun, clearClickMove, movementIntentVersion },
        { syncAutorun },
      ),
    ).resolves.toBe(false);
    expect(setAutorun).not.toHaveBeenCalled();
    expect(clearClickMove).not.toHaveBeenCalled();
    expect(syncAutorun).not.toHaveBeenCalled();
  });

  it('stops autorun only after the authoritative interaction succeeds', async () => {
    let resolveOutcome!: (value: boolean) => void;
    const outcome = new Promise<boolean>((resolve) => {
      resolveOutcome = resolve;
    });
    const setAutorun = vi.fn();
    const clearClickMove = vi.fn();
    const syncAutorun = vi.fn();
    const movementIntentVersion = vi.fn(() => 0);

    const stopped = stopAutorunForInteraction(
      outcome,
      { setAutorun, clearClickMove, movementIntentVersion },
      { syncAutorun },
    );
    expect(setAutorun).not.toHaveBeenCalled();

    resolveOutcome(true);
    await expect(stopped).resolves.toBe(true);
    expect(setAutorun).toHaveBeenCalledWith(false);
    expect(clearClickMove).toHaveBeenCalledOnce();
    expect(syncAutorun).toHaveBeenCalledWith(false);
  });

  it('does not cancel movement started after an interaction was sent', async () => {
    let resolveOutcome!: (value: boolean) => void;
    const outcome = new Promise<boolean>((resolve) => {
      resolveOutcome = resolve;
    });
    let movementVersion = 3;
    const setAutorun = vi.fn();
    const clearClickMove = vi.fn();
    const syncAutorun = vi.fn();
    const movementIntentVersion = vi.fn(() => movementVersion);

    const stopped = stopAutorunForInteraction(
      outcome,
      { setAutorun, clearClickMove, movementIntentVersion },
      { syncAutorun },
    );
    movementVersion++;
    resolveOutcome(true);

    await expect(stopped).resolves.toBe(false);
    expect(setAutorun).not.toHaveBeenCalled();
    expect(clearClickMove).not.toHaveBeenCalled();
    expect(syncAutorun).not.toHaveBeenCalled();
  });
});
