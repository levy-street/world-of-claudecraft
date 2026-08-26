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
  it('reports process liveness while keeping game routes unavailable until boot completes', async () => {
    probe = await listenStartupProbe(0, '127.0.0.1');
    const address = probe.address();
    if (address === null || typeof address === 'string') throw new Error('missing probe port');

    const live = await request(address.port, '/livez?source=render');
    expect(live.status).toBe(200);
    expect(live.body).toBe('starting');
    expect(live.headers['cache-control']).toBe('no-store');
    expect(live.headers['retry-after']).toBeUndefined();

    const gameRoute = await request(address.port, '/api/status');
    expect(gameRoute.status).toBe(503);
    expect(gameRoute.body).toBe('starting');
    expect(gameRoute.headers['cache-control']).toBe('no-store');
    expect(gameRoute.headers['retry-after']).toBe('5');
  });

  it('releases the port before the real server takes ownership', async () => {
    probe = await listenStartupProbe(0, '127.0.0.1');
    const running = probe;
    await closeStartupProbe(running);
    probe = null;
    expect(running.address()).toBeNull();
  });
});
