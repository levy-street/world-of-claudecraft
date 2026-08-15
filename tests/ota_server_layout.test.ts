import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ONLINE_WORLD_AUTH_TYPE,
  ONLINE_WORLD_INCOMPATIBLE_MESSAGE,
} from '../scripts/lib/world_auth.mjs';
import {
  buildProbeFrame,
  classifyHandshakeReply,
  LAYOUT_VERDICT,
  NOT_AUTHENTICATED_ERROR,
} from '../scripts/ota/check_server_layout.mjs';

const wsAuth = readFileSync(new URL('../server/ws_auth.ts', import.meta.url), 'utf8');

// The discriminator and the mismatch literal themselves are held in lockstep with
// src/world_api.ts by tests/world_auth_scripts.test.ts; this file covers the
// preflight's own behavior on top of that seam.
describe('the server literals the probe depends on', () => {
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
  it('sends this checkout discriminator with no usable credentials', () => {
    expect(buildProbeFrame()).toEqual({ t: ONLINE_WORLD_AUTH_TYPE, token: '', character: 0 });
    // Load-bearing: an empty token can never authenticate, which is what makes
    // the probe safe to run against production without credentials.
    expect(buildProbeFrame().token).toBe('');
  });
});

describe('classifyHandshakeReply', () => {
  const frame = (error: string) => JSON.stringify({ t: 'error', error });

  it('reads a token rejection as epoch-compatible', () => {
    expect(classifyHandshakeReply(frame(NOT_AUTHENTICATED_ERROR)).verdict).toBe(
      LAYOUT_VERDICT.compatible,
    );
  });

  it('reads the incompatible-layout literal as epoch-incompatible', () => {
    const result = classifyHandshakeReply(frame(ONLINE_WORLD_INCOMPATIBLE_MESSAGE));
    expect(result.verdict).toBe(LAYOUT_VERDICT.incompatible);
    expect(result.detail).toBe(ONLINE_WORLD_INCOMPATIBLE_MESSAGE);
  });

  // The load-bearing negative case: everything else must be inconclusive, never
  // compatible. Treating a rate limit as permission to publish would defeat the
  // entire check.
  it('refuses to read any other answer as permission to publish', () => {
    for (const other of ['too many connections from your network', 'authentication timed out']) {
      expect(classifyHandshakeReply(frame(other)).verdict).toBe(LAYOUT_VERDICT.inconclusive);
    }
    expect(classifyHandshakeReply('not json at all').verdict).toBe(LAYOUT_VERDICT.inconclusive);
    expect(classifyHandshakeReply(JSON.stringify({ t: 'hello' })).verdict).toBe(
      LAYOUT_VERDICT.inconclusive,
    );
    expect(classifyHandshakeReply(JSON.stringify({ t: 'error' })).verdict).toBe(
      LAYOUT_VERDICT.inconclusive,
    );
  });
});
