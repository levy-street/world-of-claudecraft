// Unit tests for the access-log MetricSink (server/http/access_log.ts), driven
// through the REAL withMetrics middleware. They pin: exactly one 'access' line per
// request; the line carries the :param ROUTE TEMPLATE and never the concrete id;
// the Authorization secret never appears anywhere in the line; and status,
// durationMs, and ip are present and correct (via the injected two-tick clock).

import { describe, expect, it } from 'vitest';
import { createAccessLogSink, truncateIpForLog } from '../../../server/http/access_log';
import { compose } from '../../../server/http/compose';
import { createLogger } from '../../../server/http/logger';
import { withMetrics } from '../../../server/http/middleware/metric_sink';
import type { Middleware } from '../../../server/http/types';
import { fakeCtx } from '../helpers/fake_ctx';

const HEX64 = 'b'.repeat(64);

/** A logger capturing every emitted line (info and warn/error) into one array. */
function capturingLogger(): { lines: string[]; log: ReturnType<typeof createLogger> } {
  const lines: string[] = [];
  const log = createLogger({ out: (l) => lines.push(l), err: (l) => lines.push(l) });
  return { lines, log };
}

describe('createAccessLogSink over withMetrics', () => {
  it('emits exactly one access line with the template route, correct fields, and no secret', async () => {
    const { lines, log } = capturingLogger();
    const sink = createAccessLogSink(log);
    const ticks = [1000, 1050];
    const clock = () => ticks.shift() as number;
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/things/42',
      ip: '203.0.113.9',
      headers: { authorization: `Bearer ${HEX64}` },
    });
    const handler: Middleware = async () => {
      ctx.res.writeHead(200);
      ctx.res.end('ok');
    };

    await compose([withMetrics(sink, '/api/things/:id', clock), handler])(ctx);

    // Exactly one access line.
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.msg).toBe('access');

    // The :param TEMPLATE, never the concrete id path.
    expect(rec.route).toBe('/api/things/:id');
    expect(lines[0]).not.toContain('/api/things/42');

    // The Authorization secret never reaches the line.
    expect(lines[0]).not.toContain(HEX64);

    // Status, duration (two-tick clock), and the TRUNCATED ip are present and
    // correct: the full client IP never reaches the line (privacy review).
    expect(rec.method).toBe('GET');
    expect(rec.status).toBe(200);
    expect(rec.durationMs).toBe(50);
    expect(rec.ip).toBe('203.0.113.x');
    expect(lines[0]).not.toContain('203.0.113.9');
  });
});

describe('truncateIpForLog', () => {
  it('masks the last IPv4 octet', () => {
    expect(truncateIpForLog('203.0.113.9')).toBe('203.0.113.x');
    expect(truncateIpForLog('127.0.0.1')).toBe('127.0.0.x');
  });
  it('keeps the first three IPv6 hextets and collapses the rest', () => {
    expect(truncateIpForLog('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3::');
    expect(truncateIpForLog('2001:db8::1')).toBe('2001:db8::');
    expect(truncateIpForLog('::1')).toBe('::');
  });
  it('masks the dotted tail of an IPv4-mapped IPv6 address', () => {
    expect(truncateIpForLog('::ffff:203.0.113.9')).toBe('::ffff:203.0.113.x');
  });
  it('passes a non-IP value through untouched', () => {
    expect(truncateIpForLog('')).toBe('');
    expect(truncateIpForLog('unknown')).toBe('unknown');
  });
});
