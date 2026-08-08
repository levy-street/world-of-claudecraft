import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ONLINE_WORLD_AUTH_TYPE as SCRIPT_WORLD_AUTH_TYPE,
  ONLINE_WORLD_INCOMPATIBLE_MESSAGE as SCRIPT_WORLD_INCOMPATIBLE_MESSAGE,
  worldAuthMessage,
} from '../scripts/lib/world_auth.mjs';
import {
  ONLINE_WORLD_AUTH_TYPE,
  ONLINE_WORLD_INCOMPATIBLE_MESSAGE,
  ONLINE_WORLD_LAYOUT_VERSION,
} from '../src/world_api';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPTS_ROOT = join(ROOT, 'scripts');
const AUTHENTICATED_NODE_CLIENTS = [
  {
    // The R35 admin capture tool: joins one throwaway character over the
    // wire so the professions inspector reads a LIVE session.
    path: 'scripts/admin_professions_shot.mjs',
    authSend: 'ws.send(JSON.stringify(worldAuthMessage(reg.body.token, char.body.id)))',
  },
  {
    path: 'scripts/armory_skins_e2e.mjs',
    authSend: 'this.send(worldAuthMessage(token, characterId));',
  },
  {
    path: 'scripts/catalog_program_census.mjs',
    authSend: 'this.ws.send(JSON.stringify(worldAuthMessage(this.token, this.charId)))',
  },
  {
    path: 'scripts/chat_e2e.mjs',
    authSend: 'this.ws.send(JSON.stringify(worldAuthMessage(token, characterId)))',
  },
  {
    path: 'scripts/chat_log_persistence.mjs',
    authSend: 'this.ws.send(JSON.stringify(worldAuthMessage(token, characterId)))',
  },
  {
    path: 'scripts/client_perf_under_load.mjs',
    authSend: 'this.ws.send(JSON.stringify(worldAuthMessage(reg.body.token, ch.body.id)))',
  },
  {
    path: 'scripts/crowd_fps_bench.mjs',
    authSend: 'this.ws.send(JSON.stringify(worldAuthMessage(this.token, this.charId)))',
  },
  {
    path: 'scripts/crypt_raid.mjs',
    authSend: 'this.ws.send(JSON.stringify(worldAuthMessage(this.token, this.charId)));',
  },
  {
    path: 'scripts/geared_arrival_bench.mjs',
    authSend: 'this.ws.send(JSON.stringify(worldAuthMessage(this.token, this.charId)))',
  },
  {
    path: 'scripts/load_players.mjs',
    authSend: 'ws.send(JSON.stringify(worldAuthMessage(this.token, this.characterId)));',
  },
  {
    // The phase 16 professions load rig; the spread carries the optional
    // stable timer-wire capability (STABLE=1) next to the shared auth shape.
    // Pinned to the payload CORE rather than the whole call: this line sits
    // right at the wrap width, so the send() prefix moved on and off its own
    // line with every nearby edit and reddened the pin for no behavioral
    // reason. The core still proves what the row is for, that this script
    // passes ITS OWN token and character id (never another bot's) through the
    // shared helper, with the capability spread beside them.
    path: 'scripts/load_professions.mjs',
    authSend: '...worldAuthMessage(this.token, this.characterId), ...authExtra',
    // The payload core above cannot prove the frame is ever SENT (the
    // fix-round audit: a built-but-never-sent payload stayed green once the
    // send prefix left the pin). This tight form is matched against the
    // fully despaced source, so neither the biome wrap nor the trailing
    // comma can redden it, and it ends inside the call on purpose: the
    // closing token after authExtra varies with the wrap.
    tightSend:
      'ws.send(JSON.stringify({...worldAuthMessage(this.token,this.characterId),...authExtra})',
  },
  {
    path: 'scripts/mob_stall_repro.mjs',
    authSend: 'ws.send(JSON.stringify(worldAuthMessage(this.token, this.characterId)));',
  },
  {
    path: 'scripts/mp_integration.mjs',
    authSend: 'this.send(worldAuthMessage(token, characterId));',
  },
  {
    path: 'scripts/profiler/harness.mjs',
    authSend: 'this.ws.send(JSON.stringify(worldAuthMessage(this.token, this.charId)))',
  },
  {
    path: 'scripts/server_load_jitter.mjs',
    authSend: 'this.ws.send(JSON.stringify(worldAuthMessage(this.token, this.charId)))',
  },
  {
    path: 'scripts/social_e2e.mjs',
    authSend: 'this.ws.send(JSON.stringify(worldAuthMessage(reg.body.token, char.body.id)));',
  },
  {
    path: 'scripts/social_landscape_online_shot.mjs',
    authSend: 'this.ws.send(JSON.stringify(worldAuthMessage(reg.body.token, char.body.id)));',
  },
  {
    path: 'scripts/takeover_shot.mjs',
    authSend: 'ws.send(JSON.stringify(worldAuthMessage(token, characterId)));',
  },
  {
    path: 'scripts/vale_cup_online_probe.mjs',
    authSend: 'this.ws.send(JSON.stringify(worldAuthMessage(token, characterId)))',
  },
] as const;
// Scripts that open a world socket WITHOUT authenticating, on purpose. The OTA
// layout preflight sends an empty token deliberately: it only wants to learn
// whether the server accepts this checkout's layout discriminator, and reaching
// the token rejection is the proof that it did.
const NON_AUTHENTICATING_NODE_WS_SCRIPTS = [
  'scripts/ota/check_server_layout.mjs',
  'scripts/ws_security_e2e.mjs',
] as const;
const LEGACY_AUTH_LITERAL = /\bt\s*:\s*['"]auth['"]/;

function nodeWebSocketSources(dir = SCRIPTS_ROOT): Array<[string, string]> {
  const sources: Array<[string, string]> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      sources.push(...nodeWebSocketSources(path));
    } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
      const source = readFileSync(path, 'utf8');
      if (
        /(?:from\s+['"]ws['"]|import\s*\(\s*['"]ws['"]\s*\)|require\s*\(\s*['"]ws['"]\s*\))/.test(
          source,
        )
      ) {
        sources.push([relative(ROOT, path), source]);
      }
    }
  }
  return sources;
}

describe('standalone world WebSocket auth', () => {
  it('keeps the Node discriminator fresh with the authoritative world layout epoch', () => {
    expect(ONLINE_WORLD_LAYOUT_VERSION).toBe(5);
    expect(ONLINE_WORLD_AUTH_TYPE).toBe(`auth-world-${ONLINE_WORLD_LAYOUT_VERSION}`);
    expect(SCRIPT_WORLD_AUTH_TYPE).toBe('auth-world-5');
    expect(SCRIPT_WORLD_AUTH_TYPE).toBe(ONLINE_WORLD_AUTH_TYPE);
    expect(readFileSync(join(ROOT, 'scripts/lib/world_auth.d.mts'), 'utf8')).toContain(
      `export const ONLINE_WORLD_AUTH_TYPE: '${ONLINE_WORLD_AUTH_TYPE}';`,
    );
    // The mismatch literal travels with the discriminator: the OTA layout
    // preflight tells an epoch refusal apart from an ordinary auth refusal by
    // comparing against it, so a reworded message on one side only would make
    // every preflight read inconclusive and silently block publishing.
    expect(SCRIPT_WORLD_INCOMPATIBLE_MESSAGE).toBe(ONLINE_WORLD_INCOMPATIBLE_MESSAGE);
    expect(readFileSync(join(ROOT, 'scripts/lib/world_auth.d.mts'), 'utf8')).toContain(
      `export const ONLINE_WORLD_INCOMPATIBLE_MESSAGE: '${ONLINE_WORLD_INCOMPATIBLE_MESSAGE}';`,
    );
    expect(worldAuthMessage('token-1', 42)).toEqual({
      t: ONLINE_WORLD_AUTH_TYPE,
      token: 'token-1',
      character: 42,
    });
  });

  it('pins every Node WebSocket client and the explicit non-auth security probe', () => {
    const nodeWsScripts = nodeWebSocketSources()
      .map(([path]) => path)
      .sort();

    expect(nodeWsScripts).toEqual(
      [
        ...AUTHENTICATED_NODE_CLIENTS.map(({ path }) => path),
        ...NON_AUTHENTICATING_NODE_WS_SCRIPTS,
      ].sort(),
    );
  });

  it.each(AUTHENTICATED_NODE_CLIENTS)(
    '$path sends its exact token and character through the shared helper',
    (row) => {
      const { path, authSend } = row;
      const tightSend = 'tightSend' in row ? row.tightSend : undefined;
      const source = readFileSync(join(ROOT, path), 'utf8');
      const helperPath = path.startsWith('scripts/profiler/')
        ? '../lib/world_auth.mjs'
        : './lib/world_auth.mjs';
      const normalizedSource = source.replace(/\s+/g, ' ');

      expect(source).toContain(`import { worldAuthMessage } from '${helperPath}';`);
      expect(normalizedSource).toContain(authSend);
      // Rows sitting at the wrap width carry a second, fully-despaced pin
      // that survives any re-wrap while still proving the SEND itself.
      if (tightSend) expect(source.replace(/\s+/g, '')).toContain(tightSend);
      expect(source).not.toMatch(LEGACY_AUTH_LITERAL);
    },
  );

  it('leaves no legacy auth discriminator in any standalone Node script', () => {
    const legacyClients = nodeWebSocketSources()
      .filter(([, source]) => LEGACY_AUTH_LITERAL.test(source))
      .map(([path]) => path);

    expect(legacyClients).toEqual([]);
  });
});
