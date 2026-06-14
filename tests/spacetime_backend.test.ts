import { describe, expect, it } from 'vitest';
import { selectedWorldBackend, spacetimeConnectionConfig } from '../src/net/backend';
import { reducers, tables } from '../src/net/module_bindings';
import bridgeAttachSessionReducer from '../src/net/module_bindings/bridge_attach_session_reducer';
import bridgePingReducer from '../src/net/module_bindings/bridge_ping_reducer';
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
      'bridgeSaveCharacter',
      'bridgeSaveWorldState',
      'bridgeOpenPlaySession',
      'bridgeClosePlaySession',
      'bridgeInsertChatLog',
      'bridgeAddFriend',
      'bridgeRemoveFriend',
      'bridgeAddBlock',
      'bridgeRemoveBlock',
      'bridgeCreateGuild',
      'bridgeDeleteGuild',
      'bridgeAddGuildMember',
      'bridgeRemoveGuildMember',
      'bridgeSetGuildRank',
    ]));
  });

  it('exposes STDB game-state tables while keeping private internals out of generated bindings', () => {
    expect(Object.keys(tables)).toEqual(expect.arrayContaining([
      'character',
      'world_session',
      'world_snapshot',
      'world_state',
      'play_session',
      'friend_link',
      'block_link',
      'guild',
      'guild_member',
    ]));
    expect(Object.keys(tables)).not.toEqual(expect.arrayContaining([
      'account',
      'bridge_auth',
      'chat_log',
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

  it('does not require a separate bridge secret in generated reducer args', () => {
    expect(Object.keys(bridgePingReducer)).toEqual(['sessions', 'tick']);
    expect(Object.keys(bridgeAttachSessionReducer)).toEqual(['sessionId', 'playerId']);
  });
});
