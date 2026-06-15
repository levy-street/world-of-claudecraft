import { describe, expect, it } from 'vitest';
import { selectedWorldBackend, spacetimeConnectionConfig } from '../src/net/backend';
import { reducers, tables } from '../src/net/module_bindings';
import authorizeBridgeReducer from '../src/net/module_bindings/authorize_bridge_reducer';
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
      'authorizeBridge',
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
      'bridgeCreateGuildWithLeader',
      'bridgeDeleteGuild',
      'bridgeAddGuildMember',
      'bridgeAddGuildMemberAtomic',
      'bridgeRemoveGuildMember',
      'bridgeSetGuildRank',
    ]));
  });

  it('exposes only owner-filtered/public-safe STDB tables in generated bindings', () => {
    expect(Object.keys(tables)).toEqual(expect.arrayContaining([
      'auth_state',
      'character_roster',
      'character_directory',
      'world_session',
      'world_snapshot',
      'world_event',
      'social_snapshot',
      'project_stats',
      'bridge_heartbeat',
      'bridge_session',
      'bridge_input_state',
      'bridge_client_command',
      'bridge_character_state',
      'bridge_world_state',
      'bridge_friend_link',
      'bridge_block_link',
      'bridge_guild',
      'bridge_guild_member',
    ]));
    expect(Object.keys(tables)).not.toEqual(expect.arrayContaining([
      'account',
      'bridge_auth',
      'character',
      'client_command',
      'input_state',
      'player_report',
      'world_state',
      'play_session',
      'chat_log',
      'friend_link',
      'block_link',
      'guild',
      'guild_member',
    ]));
  });

  it('keeps the API and world client surfaces wired without Phase 0 stubs', () => {
    expect(typeof SpacetimeApi.prototype.login).toBe('function');
    expect(typeof SpacetimeApi.prototype.leaderboard).toBe('function');
    expect(typeof SpacetimeApi.prototype.reportPlayer).toBe('function');
    expect(typeof SpacetimeWorld.prototype.chat).toBe('function');
    expect(typeof SpacetimeWorld.prototype.discardItem).toBe('function');
    expect(typeof SpacetimeWorld.prototype.buyBackItem).toBe('function');
    expect(typeof SpacetimeWorld.prototype.setMarker).toBe('function');
    expect(typeof SpacetimeWorld.prototype.applyTalents).toBe('function');
    expect(typeof SpacetimeWorld.prototype.saveLoadout).toBe('function');
    expect(String(SpacetimeWorld.prototype.chat)).not.toContain('NOT_IMPLEMENTED');
  });

  it('gates bridge setup while keeping routine bridge calls identity-based', () => {
    expect(Object.keys(authorizeBridgeReducer)).toEqual(['setupToken']);
    expect(Object.keys(bridgePingReducer)).toEqual(['sessions', 'tick']);
    expect(Object.keys(bridgeAttachSessionReducer)).toEqual(['sessionId', 'playerId']);
  });
});
