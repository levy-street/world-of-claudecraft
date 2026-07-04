import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { COMMAND_NAMES, type CommandName, DISPATCH_ONLY_COMMANDS } from '../src/world_api';

// W0b boundary gate: the command-schema lockstep invariant (00-SHARED-CONVENTIONS
// #2). Every command ClientWorld sends (`cmd:'X'` through the private cmd()
// helper in src/net/online.ts) MUST have a matching `case 'X':` in the
// server/game.ts dispatchMessage switch. This test pins the CURRENT contract by
// re-deriving both sets directly from source (not from the brief's numbers) and
// proving:
//   - the send-set is a SUBSET of the dispatch-set: zero send-only,
//   - dispatch-set \ send-set is exactly the verified dispatch-only
//     allowlist (DISPATCH_ONLY_COMMANDS),
//   - the send-set is disjoint from that allowlist,
//   - the shared COMMAND_NAMES table equals the scanned dispatch universe.
// A renamed or dropped wire token, an un-allowlisted server-only case, or a new
// client send with no server handler reddens this gate immediately. The shared
// table is append-only; never loosen this test to make it pass.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// Verified counts on the current tree (re-derived below; never trust stale prose).
const EXPECTED_SEND_COUNT = 121;
const EXPECTED_DISPATCH_COUNT = 130;
const EXPECTED_DISPATCH_ONLY_COUNT = 9;

// The chat sub-channel routing switch (server/game.ts `switch
// (session.rememberedChat.channel)`) is NOT a msg.cmd dispatch; its labels must
// never enter the command universe. Used to prove the dispatch scan is bounded.
const CHAT_CHANNEL_LABELS = [
  'guild',
  'officer',
  'whisper',
  'party',
  'general',
  'world',
  'lfg',
  'yell',
  'say',
] as const;

// Blank out comments while preserving the rest of the text, so a wire token named
// in a comment (or a `// case 'x'` example) can never be scanned as a real
// command. Mirrors the stripComments precedent in tests/architecture.test.ts.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readSource(relPath: string): string {
  return stripComments(readFileSync(join(repoRoot, relPath), 'utf8'));
}

// Distinct `cmd:'X'` literals ClientWorld sends. Every send funnels through the
// single private cmd() helper as an object literal, including the handshake send
// (`challengeResponse`) outside the IWorld-commands block, so a whole-file scan
// captures the complete send-set. There is no dynamic/computed cmd value.
function scanSendSet(src: string): Set<string> {
  const tokens = new Set<string>();
  for (const m of src.matchAll(/cmd:\s*'([^']+)'/g)) tokens.add(m[1]);
  return tokens;
}

// Distinct `case 'X':` labels in the dispatchMessage `switch (msg.cmd)` block.
// Bound the scan between the `private dispatchMessage(` method (its body opens
// with the msg.cmd switch and carries no other case labels) and the later
// `switch (session.rememberedChat.channel)` anchor, so the chat sub-channel
// switch's labels are excluded. Handles `case 'x':` and `case 'x': {` alike,
// plus the crypt/dungeon fall-through pairs (each label is matched independently).
function scanDispatchSet(src: string): Set<string> {
  const start = src.indexOf('private dispatchMessage(');
  const end = src.indexOf('switch (session.rememberedChat.channel)');
  if (start === -1) throw new Error('dispatchMessage method not found');
  if (end === -1) throw new Error('chat-channel switch boundary not found');
  if (end <= start) throw new Error('chat-channel switch precedes the dispatch method');
  const region = src.slice(start, end);
  const labels = new Set<string>();
  for (const m of region.matchAll(/\bcase\s+'([^']+)'\s*:/g)) labels.add(m[1]);
  return labels;
}

function difference<T>(a: Set<T>, b: Set<T>): Set<T> {
  const out = new Set<T>();
  for (const v of a) if (!b.has(v)) out.add(v);
  return out;
}

const sendSet = scanSendSet(readSource('src/net/online.ts'));
const dispatchSet = scanDispatchSet(readSource('server/game.ts'));
const tableSet = new Set<CommandName>(COMMAND_NAMES);
const allowlistSet = new Set<CommandName>(DISPATCH_ONLY_COMMANDS);

describe('command schema parity (W0b)', () => {
  it('re-derives the verified set sizes from source', () => {
    expect(sendSet.size, 'distinct cmd:X sends in online.ts').toBe(EXPECTED_SEND_COUNT);
    expect(dispatchSet.size, 'distinct case labels in dispatchMessage').toBe(
      EXPECTED_DISPATCH_COUNT,
    );
    expect(DISPATCH_ONLY_COMMANDS.length).toBe(EXPECTED_DISPATCH_ONLY_COUNT);
  });

  it('includes the handshake send challengeResponse in the send-set', () => {
    // challengeResponse lives OUTSIDE the IWorld-commands block (the auth
    // handshake) but is dispatched server-side, so it must count.
    expect(sendSet.has('challengeResponse')).toBe(true);
    expect(dispatchSet.has('challengeResponse')).toBe(true);
  });

  it('every ClientWorld send has a matching server dispatch case (send-set is a subset)', () => {
    const sendOnly = [...difference(sendSet, dispatchSet)].sort();
    expect(
      sendOnly,
      `these client sends have no server case 'X': in dispatchMessage:\n${sendOnly.join('\n')}`,
    ).toEqual([]);
  });

  it('dispatch-set minus send-set is exactly the pinned dispatch-only allowlist', () => {
    const dispatchOnly = [...difference(dispatchSet, sendSet)].sort();
    const expected = [...DISPATCH_ONLY_COMMANDS].sort();
    expect(dispatchOnly).toEqual(expected);
  });

  it('the send-set is disjoint from the dispatch-only allowlist', () => {
    const leaked = [...sendSet].filter((cmd) => allowlistSet.has(cmd as CommandName)).sort();
    expect(
      leaked,
      `dispatch-only tokens must never be in the client send-set:\n${leaked.join('\n')}`,
    ).toEqual([]);
  });

  it('COMMAND_NAMES equals the scanned dispatch universe (no missing, no extra)', () => {
    const tableMinusDispatch = [...COMMAND_NAMES].filter((cmd) => !dispatchSet.has(cmd)).sort();
    const dispatchMinusTable = [...dispatchSet]
      .filter((cmd) => !tableSet.has(cmd as CommandName))
      .sort();
    expect(
      tableMinusDispatch,
      `COMMAND_NAMES has tokens the server does not dispatch:\n${tableMinusDispatch.join('\n')}`,
    ).toEqual([]);
    expect(
      dispatchMinusTable,
      `server dispatches tokens missing from COMMAND_NAMES:\n${dispatchMinusTable.join('\n')}`,
    ).toEqual([]);
  });

  it('COMMAND_NAMES has no duplicate tokens', () => {
    expect(tableSet.size).toBe(COMMAND_NAMES.length);
    expect(COMMAND_NAMES.length).toBe(EXPECTED_DISPATCH_COUNT);
  });

  it('every send token is present in the shared COMMAND_NAMES table', () => {
    const notInTable = [...sendSet].filter((cmd) => !tableSet.has(cmd as CommandName)).sort();
    expect(notInTable).toEqual([]);
  });

  it('every dispatch-only command is a member of COMMAND_NAMES', () => {
    const notInTable = [...DISPATCH_ONLY_COMMANDS].filter((cmd) => !tableSet.has(cmd)).sort();
    expect(notInTable).toEqual([]);
  });

  it('excludes the chat sub-channel routing labels from the command universe', () => {
    for (const label of CHAT_CHANNEL_LABELS) {
      expect(dispatchSet.has(label), `chat-channel label leaked into dispatch-set: ${label}`).toBe(
        false,
      );
      expect(
        tableSet.has(label as CommandName),
        `chat-channel label in COMMAND_NAMES: ${label}`,
      ).toBe(false);
    }
  });
});
