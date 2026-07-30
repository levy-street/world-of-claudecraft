import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildProbeFrame,
  classifyHandshakeReply,
  LAYOUT_VERDICT,
  NOT_AUTHENTICATED_ERROR,
  parseWorldApiContract,
} from '../scripts/ota/check_server_layout.mjs';

const worldApi = readFileSync(new URL('../src/world_api.ts', import.meta.url), 'utf8');
const wsAuth = readFileSync(new URL('../server/ws_auth.ts', import.meta.url), 'utf8');

describe('parseWorldApiContract', () => {
  it('reads the live wire contract out of src/world_api.ts', () => {
    const contract = parseWorldApiContract(worldApi);
    // Pinned to literals, not re-derived from the same file: if the epoch is
    // bumped, this test is the reminder that an OTA bundle from the old epoch
    // can no longer reach a server on the new one.
    expect(contract.layoutVersion).toBe(3);
    expect(contract.authType).toBe('auth-world-3');
    expect(contract.timerWire).toBe(2);
    expect(contract.incompatibleMessage).toBe(
      'Game and server versions are incompatible. Reload or update, then try again.',
    );
  });

  it('throws rather than guessing when a constant is renamed away', () => {
    expect(() => parseWorldApiContract('export const SOMETHING_ELSE = 1 as const;')).toThrow(
      /ONLINE_WORLD_LAYOUT_VERSION not found/,
    );
    expect(() =>
      parseWorldApiContract('export const ONLINE_WORLD_LAYOUT_VERSION = 3 as const;'),
    ).toThrow(/STABLE_TIMER_WIRE_VERSION not found/);
  });
});

describe('the literals the probe depends on', () => {
  // The probe reads "not authenticated" as proof the handshake got PAST the
  // discriminator check. If the server ever reworded it, every probe would go
  // inconclusive and silently block publishing, so pin it to the server source.
  it('still matches the server rejection literal', () => {
    expect(wsAuth).toContain(`notAuthenticated: '${NOT_AUTHENTICATED_ERROR}'`);
  });

  it('still routes a discriminator mismatch to the incompatible-layout error', () => {
    expect(wsAuth).toContain('incompatibleWorldLayout: ONLINE_WORLD_INCOMPATIBLE_MESSAGE');
    expect(wsAuth).toContain('WS_AUTH_ERROR.incompatibleWorldLayout');
  });
});

describe('buildProbeFrame', () => {
  it('sends this checkout discriminator with no credentials', () => {
    const contract = parseWorldApiContract(worldApi);
    expect(buildProbeFrame(contract)).toEqual({
      t: 'auth-world-3',
      token: '',
      character: 0,
      clientSeed: '',
      timerWire: 2,
    });
  });
});

describe('classifyHandshakeReply', () => {
  const contract = parseWorldApiContract(worldApi);
  const frame = (error: string) => JSON.stringify({ t: 'error', error });

  it('reads a token rejection as epoch-compatible', () => {
    expect(classifyHandshakeReply(frame(NOT_AUTHENTICATED_ERROR), contract).verdict).toBe(
      LAYOUT_VERDICT.compatible,
    );
  });

  it('reads the incompatible-layout literal as epoch-incompatible', () => {
    const result = classifyHandshakeReply(frame(contract.incompatibleMessage), contract);
    expect(result.verdict).toBe(LAYOUT_VERDICT.incompatible);
    expect(result.detail).toBe(contract.incompatibleMessage);
  });

  // The load-bearing negative case: everything else must be inconclusive, never
  // compatible. Treating a rate limit as permission to publish would defeat the
  // entire check.
  it('refuses to read any other answer as permission to publish', () => {
    for (const other of ['too many connections from your network', 'authentication timed out']) {
      expect(classifyHandshakeReply(frame(other), contract).verdict).toBe(
        LAYOUT_VERDICT.inconclusive,
      );
    }
    expect(classifyHandshakeReply('not json at all', contract).verdict).toBe(
      LAYOUT_VERDICT.inconclusive,
    );
    expect(classifyHandshakeReply(JSON.stringify({ t: 'hello' }), contract).verdict).toBe(
      LAYOUT_VERDICT.inconclusive,
    );
    expect(classifyHandshakeReply(JSON.stringify({ t: 'error' }), contract).verdict).toBe(
      LAYOUT_VERDICT.inconclusive,
    );
  });
});
