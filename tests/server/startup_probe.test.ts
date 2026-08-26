import * as http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeStartupProbe,
  listenStartupProbe,
  type StartupProbeServer,
} from '../../server/startup_probe';

let probe: StartupProbeServer | null = null;

afterEach(async () => {
  if (probe !== null) await closeStartupProbe(probe);
  probe = null;
});

function request(
  port: number,
  path: string,
): Promise<{
  status: number | undefined;
  body: string;
  headers: http.IncomingHttpHeaders;
}> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.once('error', reject);
  });
}

describe('startup probe server', () => {
  it('opens a port immediately but keeps every route unavailable until game boot completes', async () => {
    probe = await listenStartupProbe(0, '127.0.0.1');
    const address = probe.address();
    if (address === null || typeof address === 'string') throw new Error('missing probe port');

    for (const path of ['/livez', '/api/status']) {
      const res = await request(address.port, path);
      expect(res.status).toBe(503);
      expect(res.body).toBe('starting');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['retry-after']).toBe('5');
    }
  });

  it('releases the port before the real server takes ownership', async () => {
    probe = await listenStartupProbe(0, '127.0.0.1');
    const running = probe;
    await closeStartupProbe(running);
    probe = null;
    expect(running.address()).toBeNull();
  });
});
