// server/session_hello.ts: the one hello frame both join arms send, and the
// resume-token rotation that rides it.
import { describe, expect, it } from 'vitest';
import { type HelloSession, issueHelloFrame } from '../server/session_hello';

function session(over: Partial<HelloSession> = {}): HelloSession {
  return {
    pid: 9,
    name: 'Aldric',
    isAdmin: false,
    chatMutedUntil: null,
    movementWireVersion: 2,
    resumeToken: '',
    ...over,
  };
}

const world = { seed: 1234, realm: 'Eastbrook', softWords: ['darn'] };

describe('issueHelloFrame', () => {
  it('builds the exact hello key set from the session and realm', () => {
    const s = session({ isAdmin: true, chatMutedUntil: 5_000 });
    const frame = issueHelloFrame(s, 'mage', world);
    expect(frame).toEqual({
      t: 'hello',
      pid: 9,
      seed: 1234,
      name: 'Aldric',
      cls: 'mage',
      realm: 'Eastbrook',
      admin: true,
      softWords: ['darn'],
      chatMutedUntil: 5_000,
      movementWire: 2,
      resumeToken: s.resumeToken,
    });
  });

  it('stamps a fresh token on the session and sends that same token', () => {
    const s = session();
    const frame = issueHelloFrame(s, 'warrior', world);
    expect(s.resumeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(frame.resumeToken).toBe(s.resumeToken);
  });

  it('rotates the token on every hello, so an older socket token is spent', () => {
    const s = session();
    const first = issueHelloFrame(s, 'warrior', world).resumeToken;
    const second = issueHelloFrame(s, 'warrior', world).resumeToken;
    expect(second).not.toBe(first);
    expect(s.resumeToken).toBe(second);
  });
});
