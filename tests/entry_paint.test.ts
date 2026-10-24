import { describe, expect, it } from 'vitest';
import { type EntryPaintScheduler, waitForEntryPaint } from '../src/game/entry_paint';

function scheduler() {
  let hidden = false;
  const frames = new Map<number, () => void>();
  const listeners = new Set<() => void>();
  let nextId = 0;
  const host: EntryPaintScheduler = {
    get hidden() {
      return hidden;
    },
    addVisibilityListener: (listener) => listeners.add(listener),
    removeVisibilityListener: (listener) => listeners.delete(listener),
    requestFrame: (callback) => {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    },
    cancelFrame: (id) => {
      frames.delete(id);
    },
  };
  return {
    host,
    frames,
    listeners,
    hide: () => {
      hidden = true;
      for (const listener of listeners) listener();
    },
    runFrame: () => {
      const entry = frames.entries().next().value;
      if (!entry) throw new Error('No frame scheduled');
      const [id, callback] = entry;
      frames.delete(id);
      callback();
    },
  };
}

describe('waitForEntryPaint', () => {
  it('waits for two visible frames so the loading screen can paint', async () => {
    const s = scheduler();
    let done = false;
    void waitForEntryPaint(s.host).then(() => {
      done = true;
    });
    s.runFrame();
    await Promise.resolve();
    expect(done).toBe(false);
    s.runFrame();
    await Promise.resolve();
    expect(done).toBe(true);
    expect(s.listeners.size).toBe(0);
  });

  it('continues entry if the tab was already hidden', async () => {
    const s = scheduler();
    s.hide();
    await waitForEntryPaint(s.host);
    expect(s.frames.size).toBe(0);
  });

  it('continues entry if the tab becomes hidden while a frame is pending', async () => {
    const s = scheduler();
    const pending = waitForEntryPaint(s.host);
    s.runFrame();
    s.hide();
    await pending;
    expect(s.frames.size).toBe(0);
    expect(s.listeners.size).toBe(0);
  });
});
