import type * as http from 'node:http';
import { describe, expect, it } from 'vitest';
import { publicOriginFromRequest } from '../server/realm';

function fakeReq(headers: Record<string, string>, encrypted = false) {
  return { headers, socket: { encrypted } } as unknown as http.IncomingMessage;
}

describe('publicOriginFromRequest', () => {
  it('does not trust arbitrary Host or X-Forwarded-Proto values in production', () => {
    const old = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const origin = publicOriginFromRequest(
        fakeReq({
          host: 'evil.example',
          'x-forwarded-proto': 'javascript',
        }),
      );
      expect(origin).toBe('https://worldofclaudecraft.com');
    } finally {
      if (old === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = old;
    }
  });

  it('allows localhost-style request origins outside production for dev servers', () => {
    const old = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const origin = publicOriginFromRequest(
        fakeReq({
          host: 'localhost:8787',
          'x-forwarded-proto': 'http',
        }),
      );
      expect(origin).toBe('http://localhost:8787');
    } finally {
      if (old === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = old;
    }
  });
});
