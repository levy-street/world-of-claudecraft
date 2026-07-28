import { describe, expect, it, vi } from 'vitest';
import { CompileBatch } from '../src/render/compile_batch';

describe('CompileBatch', () => {
  it('coalesces many view requests into one scene compile', async () => {
    const batch = new CompileBatch<object>();
    const compile = vi.fn().mockResolvedValue(undefined);
    const targets = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const waits = targets.map((target) => batch.request(target));
    const promise = batch.flush(compile);
    await Promise.all([promise, ...waits]);
    expect(compile).toHaveBeenCalledOnce();
    expect(compile).toHaveBeenCalledWith(targets);
  });

  it('keeps requests made during a compile for the next batch', async () => {
    let finishFirst!: () => void;
    const compile = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishFirst = resolve)))
      .mockResolvedValueOnce(undefined);
    const batch = new CompileBatch<object>();
    const firstWait = batch.request({ id: 1 });
    const firstCompile = batch.flush(compile);
    if (!firstCompile) throw new Error('requested compile did not start');
    const secondWait = batch.request({ id: 2 });
    expect(batch.flush(compile)).toBe(firstCompile);
    await Promise.resolve();
    finishFirst();
    await firstWait;
    await firstCompile;
    await batch.flush(compile);
    await secondWait;
    expect(compile).toHaveBeenCalledTimes(2);
  });

  it('contains runner rejection, settles waiters, and remains reusable', async () => {
    const error = new Error('compile failed');
    const onError = vi.fn();
    const compile = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);
    const batch = new CompileBatch<object>();
    const firstWait = batch.request({ id: 1 });

    await expect(batch.flush(compile, onError)).resolves.toBeUndefined();
    await expect(firstWait).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(error);
    expect(batch.isPending).toBe(false);

    const secondWait = batch.request({ id: 2 });
    await expect(batch.flush(compile, onError)).resolves.toBeUndefined();
    await expect(secondWait).resolves.toBeUndefined();
    expect(compile).toHaveBeenCalledTimes(2);
  });
});
