import { describe, expect, it } from 'vitest';
import { selectedWorldBackend, spacetimeConnectionConfig } from '../src/net/backend';
import { reducers } from '../src/net/module_bindings';
import { SpacetimeApi } from '../src/net/spacetime_api';
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

describe('SpacetimeDB generated reducer surface', () => {
  it('includes auth, roster, world, bridge, and report reducers', () => {
    expect(Object.keys(reducers)).toEqual(expect.arrayContaining([
      'register',
      'login',
      'listCharacters',
      'createCharacter',
      'enterWorld',
      'leaveWorld',
      'setInput',
      'command',
      'reportPlayer',
      'reportPlayerByName',
      'bridgeAttachSession',
      'bridgePublishSnapshot',
      'bridgePublishEvents',
      'bridgePublishSocial',
      'bridgeConsumeCommand',
      'bridgeCloseSession',
    ]));
  });

  it('keeps the API and world client surfaces wired without Phase 0 stubs', () => {
    expect(typeof SpacetimeApi.prototype.login).toBe('function');
    expect(typeof SpacetimeApi.prototype.reportPlayer).toBe('function');
    expect(typeof SpacetimeWorld.prototype.chat).toBe('function');
    expect(typeof SpacetimeWorld.prototype.buyBackItem).toBe('function');
    expect(typeof SpacetimeWorld.prototype.setMarker).toBe('function');
    expect(String(SpacetimeWorld.prototype.chat)).not.toContain('NOT_IMPLEMENTED');
  });
});
