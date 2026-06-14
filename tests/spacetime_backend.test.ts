import { describe, expect, it } from 'vitest';
import { selectedWorldBackend, spacetimeConnectionConfig } from '../src/net/backend';
import { SpacetimeWorld } from '../src/net/spacetime';

describe('SpacetimeDB backend flag', () => {
  it('defaults to the Node backend', () => {
    expect(selectedWorldBackend({})).toBe('node');
    expect(selectedWorldBackend({ VITE_WORLD_BACKEND: 'other' })).toBe('node');
  });

  it('selects SpacetimeDB only when explicitly requested', () => {
    expect(selectedWorldBackend({ VITE_WORLD_BACKEND: 'spacetimedb' })).toBe('spacetimedb');
    expect(selectedWorldBackend({ VITE_WORLD_BACKEND: ' SpacetimeDB ' })).toBe('spacetimedb');
  });

  it('provides stable local SpacetimeDB defaults', () => {
    expect(spacetimeConnectionConfig({})).toEqual({
      uri: 'http://127.0.0.1:3000',
      moduleName: 'worldofclaudecraft',
    });
    expect(spacetimeConnectionConfig({ VITE_STDB_URI: ' http://localhost:3000 ', VITE_STDB_MODULE: ' woc ' })).toEqual({
      uri: 'http://localhost:3000',
      moduleName: 'woc',
    });
  });
});

describe('SpacetimeWorld Phase 0 stub', () => {
  it('implements the online world surface without opening a Node websocket', async () => {
    const world = new SpacetimeWorld({ uri: 'http://127.0.0.1:3000', moduleName: 'worldofclaudecraft' }, 'token', 7, 'mage');
    let reason = '';
    world.onDisconnect = (message) => { reason = message; };
    await Promise.resolve();

    expect(world.characterId).toBe(7);
    expect(world.connected).toBe(false);
    expect(world.cfg.playerClass).toBe('mage');
    expect(world.uri).toBe('http://127.0.0.1:3000');
    expect(world.moduleName).toBe('worldofclaudecraft');
    expect(reason).toContain('Phase 0 client seam');
    expect(() => world.chat('hello')).toThrow(/SpacetimeDB backend is selected/);
  });
});
