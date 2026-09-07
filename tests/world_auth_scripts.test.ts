import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chatCommandMessage,
  createMovementInputStream,
  MOVEMENT_FRAME_INTERVAL_MS,
  type MovementInputFrame,
  MOVEMENT_WIRE_VERSION as SCRIPT_MOVEMENT_WIRE_VERSION,
  ONLINE_WORLD_AUTH_TYPE as SCRIPT_WORLD_AUTH_TYPE,
  ONLINE_WORLD_INCOMPATIBLE_MESSAGE as SCRIPT_WORLD_INCOMPATIBLE_MESSAGE,
  worldAuthMessage,
} from '../scripts/lib/world_auth.mjs';
import {
  MOVEMENT_WIRE_VERSION,
  ONLINE_WORLD_AUTH_TYPE,
  ONLINE_WORLD_INCOMPATIBLE_MESSAGE,
  ONLINE_WORLD_LAYOUT_VERSION,
} from '../src/world_api';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

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
    inputSend: 'this.movement.set(mi, facing);',
    authSend: 'this.ws.send(JSON.stringify(worldAuthMessage(reg.body.token, ch.body.id)))',
  },
  {
    path: 'scripts/crowd_fps_bench.mjs',
    inputSend: 'this.movement.set(mi, facing);',
    authSend: 'this.ws.send(JSON.stringify(worldAuthMessage(this.token, this.charId)))',
  },
  {
    path: 'scripts/crypt_raid.mjs',
    inputSend: 'this.movement.set(mi, facing);',
    authSend: 'this.ws.send(JSON.stringify(worldAuthMessage(this.token, this.charId)));',
  },
  {
    path: 'scripts/geared_arrival_bench.mjs',
    authSend: 'this.ws.send(JSON.stringify(worldAuthMessage(this.token, this.charId)))',
  },
  {
    path: 'scripts/profiler/geared_arrival_roster.mjs',
    authSend: 'socket.send(JSON.stringify(worldAuthMessage(this.token, this.characterId)))',
  },
  {
    // The Nythraxis prewarm A/B. Its own short session parks the browser
    // observer in an Aldric-free start zone between legs, so it joins the
    // world as the observer character itself, not as a bot.
    path: 'scripts/nythraxis_hitch_bench.mjs',
    authSend: 'socket.send(JSON.stringify(worldAuthMessage(fixture.token, fixture.characterId)))',
  },
  {
    // The kick-then-clear-then-retry operator E2E (Masterwrought phase 18): the
    // character has to be genuinely ONLINE for arm 1's refusal and arm 4's
    // session lease to be real, so it joins the world as the remediation target.
    path: 'scripts/kick_clear_retry_e2e.mjs',
    authSend: 'ws.send(JSON.stringify(worldAuthMessage(reg.body.token, characterId)))',
  },
  {
    path: 'scripts/lib/perf_hitch_scenarios.mjs',
    inputSend: 'this.movement.set(mi, facing);',
    authSend: 'ws.send(JSON.stringify(worldAuthMessage(this.token, this.characterId)))',
  },
  {
    path: 'scripts/load_players.mjs',
    inputSend: 'this.movement.set(mi, facing);',
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
    inputSend: 'this.movement.set(mi, facing);',
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
    inputSend: 'this.movement.set(mi, facing);',
    authSend: 'ws.send(JSON.stringify(worldAuthMessage(this.token, this.characterId)));',
  },
  {
    path: 'scripts/mp_integration.mjs',
    inputSend: 'this.movement.set(mi, facing);',
    authSend: 'this.send(worldAuthMessage(token, characterId));',
  },
  {
    path: 'scripts/profiler/harness.mjs',
    authSend: 'this.ws.send(JSON.stringify(worldAuthMessage(this.token, this.charId)))',
  },
  {
    path: 'scripts/server_load_jitter.mjs',
    inputSend: 'this.movement.set(mi, facing);',
    authSend: 'this.ws.send(JSON.stringify(worldAuthMessage(this.token, this.charId)))',
  },
  {
    path: 'scripts/social_e2e.mjs',
    inputSend: 'this.movement.set(mi, facing);',
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
    path: 'scripts/woc_market_shot.mjs',
    authSend: 'ws.send(JSON.stringify(worldAuthMessage(token, characterId)));',
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
// A frame BUILT as { t: 'chat' }, never a received-message test (=== 'chat').
const TOP_LEVEL_CHAT_FRAME = /\bt\s*:\s*['"]chat['"]/;

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
    expect(ONLINE_WORLD_LAYOUT_VERSION).toBe(29);
    expect(ONLINE_WORLD_AUTH_TYPE).toBe(`auth-world-${ONLINE_WORLD_LAYOUT_VERSION}`);
    expect(SCRIPT_WORLD_AUTH_TYPE).toBe('auth-world-29');
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
    // The movement wire travels with the discriminator: the server refuses a
    // handshake that does not offer this exact number BEFORE it reads the
    // token, so a Node client missing it is rejected outright and the OTA
    // layout preflight reads a healthy server as an epoch mismatch.
    expect(SCRIPT_MOVEMENT_WIRE_VERSION).toBe(MOVEMENT_WIRE_VERSION);
    expect(readFileSync(join(ROOT, 'scripts/lib/world_auth.d.mts'), 'utf8')).toContain(
      `export const MOVEMENT_WIRE_VERSION: ${MOVEMENT_WIRE_VERSION};`,
    );
    expect(worldAuthMessage('token-1', 42)).toEqual({
      t: ONLINE_WORLD_AUTH_TYPE,
      token: 'token-1',
      character: 42,
      movementWire: MOVEMENT_WIRE_VERSION,
    });
  });

  it('pins every Node WebSocket client and the explicit non-auth security probe', () => {
    const nodeWsScripts = nodeWebSocketSources()
      .map(([path]) => path.replaceAll('\\', '/'))
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
      const inputSend = 'inputSend' in row ? row.inputSend : undefined;
      const source = readFileSync(join(ROOT, path), 'utf8');
      const helperPath = path.startsWith('scripts/profiler/')
        ? '../lib/world_auth.mjs'
        : path.startsWith('scripts/lib/')
          ? './world_auth.mjs'
          : './lib/world_auth.mjs';
      const normalizedSource = source.replace(/\s+/g, ' ');

      // worldAuthMessage comes from the shared helper, whether or not the
      // script also co-imports chatCommandMessage from the same module.
      expect(source).toMatch(
        new RegExp(
          `import \\{[^}]*\\bworldAuthMessage\\b[^}]*\\} from '${helperPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}';`,
        ),
      );
      expect(normalizedSource).toContain(authSend);
      // Rows sitting at the wrap width carry a second, fully-despaced pin
      // that survives any re-wrap while still proving the SEND itself.
      if (tightSend) expect(source.replace(/\s+/g, '')).toContain(tightSend);
      // Movement senders drive the SHARED per-tick stream. A bare
      // { t: 'input', mi } has no client tick, and the server's timeline
      // (server/movement_input_timeline_v2.ts) parses such a frame and then
      // never enqueues it: the bot joins, is counted against the rate limits,
      // and never moves. Pin the whole lifecycle, not just the send.
      if (inputSend) {
        expect(source).toMatch(
          new RegExp(
            `import \\{[^}]*\\bcreateMovementInputStream\\b[^}]*\\} from '${helperPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}';`,
          ),
        );
        expect(normalizedSource).toContain(inputSend);
        expect(normalizedSource).toContain('this.movement.start();');
        expect(normalizedSource).toMatch(/\bmovement\.stop\(\);/);
      }
      expect(source).not.toMatch(LEGACY_AUTH_LITERAL);
    },
  );

  it('leaves no bare client-tick-less input frame in any Node WebSocket client', () => {
    // The exact shape the ten movement scripts used to send. Without `ct` the
    // server parses the frame and drops it, so the bot never moves and its
    // lastInputAt never advances: a silent, load-bearing no-op.
    const bare = /\bt\s*:\s*['"]input['"]/;
    const offenders = nodeWebSocketSources()
      .filter(([, source]) => bare.test(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
    // The scan is worthless if it cannot see a violation.
    expect(bare.test("send(JSON.stringify({ t: 'input', mi, facing }))")).toBe(true);
  });

  it('never sends chat (and the /dev cheats behind it) as a top-level frame type', () => {
    // The server's `case 'chat'` lives in the COMMAND switch, so a top-level
    // { t: 'chat' } frame matches nothing and is dropped without an error: the
    // script keeps running and reports numbers for bots that were never
    // levelled, geared, god-moded or teleported. Several perf scripts shipped that
    // shape, which is why this is a scan and not a review note.
    //
    // Read over CODE, not prose: a script that documents the trap right above
    // its chatCommandMessage call spells the forbidden frame out in a comment
    // too, and a raw-text scan reads that sentence as an offense. Stripping
    // full-line comments is the same discipline the loopback-guard call-site
    // pins already run on, and it
    // narrows the scan to what can actually be SENT: a comment sends nothing.
    // Both directions are proven below, so the strip cannot blind the scan.
    const offenders = nodeWebSocketSources()
      .filter(([, source]) => TOP_LEVEL_CHAT_FRAME.test(codeWithoutLineComments(source)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
    expect(chatCommandMessage('/dev god')).toEqual({ t: 'cmd', cmd: 'chat', text: '/dev god' });
    // Pinned to the live client's own send, the only authority on the shape.
    expect(readFileSync(join(ROOT, 'src/net/online.ts'), 'utf8')).toContain(
      "this.cmd({ cmd: 'chat', text });",
    );
    expect(readFileSync(join(ROOT, 'scripts/lib/world_auth.d.mts'), 'utf8')).toContain(
      'export function chatCommandMessage(text: string): ChatCommandMessage;',
    );
    // The scan is worthless if it cannot see a violation: prove the pattern
    // catches the exact literal the five scripts carried.
    expect(TOP_LEVEL_CHAT_FRAME.test("send(JSON.stringify({ t: 'chat', text }))")).toBe(true);
    expect(TOP_LEVEL_CHAT_FRAME.test("if (message.t === 'chat') return;")).toBe(false);
    // And the comment strip in front of it: prose describing the trap is not an
    // offense, while the same literal on a real statement still is, INCLUDING
    // one carrying a trailing comment (only whole comment lines are dropped).
    expect(
      TOP_LEVEL_CHAT_FRAME.test(
        codeWithoutLineComments("  // a bare { t: 'chat' } frame matches nothing"),
      ),
    ).toBe(false);
    expect(
      TOP_LEVEL_CHAT_FRAME.test(
        codeWithoutLineComments("send(JSON.stringify({ t: 'chat', text })); // the offense"),
      ),
    ).toBe(true);
  });

  describe('createMovementInputStream', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('streams one frame per client tick with a monotone tick from zero', () => {
      const sent: MovementInputFrame[] = [];
      const stream = createMovementInputStream((frame) => sent.push(frame));
      stream.start();

      vi.advanceTimersByTime(MOVEMENT_FRAME_INTERVAL_MS * 3);

      expect(sent.map((frame) => frame.ct)).toEqual([0, 1, 2]);
      expect(sent.every((frame) => frame.t === 'input')).toBe(true);
      stream.stop();
    });

    it('holds the intent and heading until the next set', () => {
      const sent: MovementInputFrame[] = [];
      const stream = createMovementInputStream((frame) => sent.push(frame));
      stream.start();
      stream.set({ f: 1 }, 0.5);
      vi.advanceTimersByTime(MOVEMENT_FRAME_INTERVAL_MS * 2);

      // A held intent keeps the bot moving, exactly like the client's
      // unconditional per-tick frames; nothing re-sends it per beat.
      expect(sent).toHaveLength(3);
      expect(sent.every((frame) => (frame.mi as Record<string, number>).f === 1)).toBe(true);
      expect(sent.every((frame) => frame.facing === 0.5)).toBe(true);
      stream.stop();
    });

    it('emits immediately on set so a latency-sensitive script keeps its timing', () => {
      const sent: MovementInputFrame[] = [];
      const stream = createMovementInputStream((frame) => sent.push(frame));
      stream.start();
      stream.set({ f: 1 });

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ t: 'input', ct: 0, mi: { f: 1 } });
      // ...and the tick phase restarts from that instant, so the steady rate
      // stays one frame per tick rather than doubling on every change.
      vi.advanceTimersByTime(MOVEMENT_FRAME_INTERVAL_MS - 1);
      expect(sent).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(sent).toHaveLength(2);
      stream.stop();
    });

    it('omits facing entirely when it is undefined', () => {
      const sent: MovementInputFrame[] = [];
      const stream = createMovementInputStream((frame) => sent.push(frame));
      stream.set({ f: 1 });
      expect(sent[0]).not.toHaveProperty('facing');
      stream.set({ f: 1 }, 1.25);
      expect(sent[1]).toHaveProperty('facing', 1.25);
      // An explicit undefined clears it again: the server reads a missing
      // facing as UNCHANGED, never as zero.
      stream.set({ f: 1 });
      expect(sent[2]).not.toHaveProperty('facing');
    });

    it('stops the timer on stop and can be started again', () => {
      const sent: MovementInputFrame[] = [];
      const stream = createMovementInputStream((frame) => sent.push(frame));
      stream.start();
      vi.advanceTimersByTime(MOVEMENT_FRAME_INTERVAL_MS);
      expect(sent).toHaveLength(1);

      stream.stop();
      vi.advanceTimersByTime(MOVEMENT_FRAME_INTERVAL_MS * 5);
      expect(sent).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);

      stream.start();
      vi.advanceTimersByTime(MOVEMENT_FRAME_INTERVAL_MS);
      // The tick counter never rewinds: the server timeline discards a frame
      // whose ct it has already consumed.
      expect(sent.map((frame) => frame.ct)).toEqual([0, 1]);
      stream.stop();
    });

    it('is idempotent on a double start, so one bot never runs two timers', () => {
      const sent: MovementInputFrame[] = [];
      const stream = createMovementInputStream((frame) => sent.push(frame));
      stream.start();
      stream.start();
      vi.advanceTimersByTime(MOVEMENT_FRAME_INTERVAL_MS);
      expect(sent).toHaveLength(1);
      stream.stop();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('leaves no legacy auth discriminator in any standalone Node script', () => {
    const legacyClients = nodeWebSocketSources()
      .filter(([, source]) => LEGACY_AUTH_LITERAL.test(source))
      .map(([path]) => path);

    expect(legacyClients).toEqual([]);
  });
});
