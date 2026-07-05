import { describe, expect, it, vi } from 'vitest';
import { LinkMemory } from '../src/editor/server_link_core';

interface Link {
  serverId: number;
  version: number;
}

describe('LinkMemory (per-tab optimistic version)', () => {
  it('seeds from the fallback exactly once', () => {
    const mem = new LinkMemory<Link>();
    const fallback = vi.fn(() => ({ serverId: 1, version: 1 }));
    expect(mem.resolve('m', fallback)).toEqual({ serverId: 1, version: 1 });
    expect(mem.resolve('m', fallback)).toEqual({ serverId: 1, version: 1 });
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('REGRESSION: another tab bumping shared storage cannot move this tab forward', () => {
    // Audit K: linkFor re-read the shared localStorage links key on every
    // save, so a stale tab silently took the other tab's version and never
    // hit the server 409 that triggers the save-as-copy flow.
    let stored: Link = { serverId: 1, version: 1 };
    const mem = new LinkMemory<Link>();
    expect(mem.resolve('m', () => stored)?.version).toBe(1); // opened at v1
    stored = { serverId: 1, version: 2 }; // tab A saved: storage now says v2
    expect(mem.resolve('m', () => stored)?.version).toBe(1); // this tab stays at v1
  });

  it('set() records the version captured at load/save time', () => {
    const mem = new LinkMemory<Link>();
    mem.set('m', { serverId: 1, version: 3 });
    const fallback = vi.fn(() => ({ serverId: 1, version: 99 }));
    expect(mem.resolve('m', fallback)?.version).toBe(3);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('set(null) pins an explicit unlink (fallback is not consulted)', () => {
    const mem = new LinkMemory<Link>();
    mem.set('m', null);
    const fallback = vi.fn(() => ({ serverId: 1, version: 1 }));
    expect(mem.resolve('m', fallback)).toBeNull();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('a null fallback result is cached too', () => {
    const mem = new LinkMemory<Link>();
    const fallback = vi.fn(() => null);
    expect(mem.resolve('m', fallback)).toBeNull();
    expect(mem.resolve('m', fallback)).toBeNull();
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
