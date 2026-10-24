// The ClaudeCraft Studio dev routes write source and assets into the checkout, so
// a cross-origin POST from a page the developer happens to visit must be refused
// (scripts/lib/studio_dev_guard.mjs, mounted by vite.config.ts).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isStudioDevRoute,
  STUDIO_DEV_ROUTE_PREFIXES,
  studioDevGuardMiddleware,
  studioDevRequestAllowed,
} from '../scripts/lib/studio_dev_guard.mjs';

const LOCAL = { remoteAddress: '127.0.0.1', host: 'localhost:5173' };

describe('studio dev route guard', () => {
  it('lets a same-origin loopback write through', () => {
    expect(
      studioDevRequestAllowed({
        ...LOCAL,
        method: 'POST',
        url: '/__studio_map/publish',
        origin: 'http://localhost:5173',
      }),
    ).toBe(true);
  });

  it('refuses a cross-origin write, a write with no Origin, and a remote socket', () => {
    const base = { ...LOCAL, method: 'POST', url: '/__studio_map/publish' };
    expect(studioDevRequestAllowed({ ...base, origin: 'https://evil.example' })).toBe(false);
    expect(studioDevRequestAllowed({ ...base, origin: undefined })).toBe(false);
    expect(
      studioDevRequestAllowed({
        ...base,
        origin: 'http://localhost:5173',
        remoteAddress: '192.168.1.20',
      }),
    ).toBe(false);
  });

  it('allows loopback reads and refuses remote reads', () => {
    const read = { method: 'GET', url: '/__studio_map/published' };
    expect(studioDevRequestAllowed({ ...read, ...LOCAL })).toBe(true);
    expect(studioDevRequestAllowed({ ...read, ...LOCAL, remoteAddress: '10.0.0.5' })).toBe(false);
  });

  it('covers every Studio writer and leaves other routes alone', () => {
    for (const url of [
      '/__dungeon_editor/save',
      '/__bg_editor/save',
      '/__collision_master/save',
      '/__region_map/save',
      '/__studio_map/publish',
      '/__studio_map/unpublish?slug=x',
      '/__studio_asset/save',
    ]) {
      expect(isStudioDevRoute(url), url).toBe(true);
    }
    expect(isStudioDevRoute('/__music_editor/save')).toBe(false);
    expect(isStudioDevRoute('/index.html')).toBe(false);
    expect(
      studioDevRequestAllowed({ method: 'POST', url: '/api/x', origin: 'https://evil.example' }),
    ).toBe(true);
  });

  it('answers 403 from the middleware and never calls next on a refused write', () => {
    let nextCalled = false;
    const res = {
      statusCode: 200,
      body: '',
      end(b?: string) {
        this.body = b ?? '';
      },
    };
    studioDevGuardMiddleware(
      {
        method: 'POST',
        url: '/__studio_asset/save',
        socket: { remoteAddress: '127.0.0.1' },
        headers: { origin: 'https://evil.example', host: 'localhost:5173' },
      },
      res,
      () => {
        nextCalled = true;
      },
    );
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('every guarded prefix matches a route vite.config.ts mounts, and the guard is mounted first', () => {
    const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
    for (const prefix of STUDIO_DEV_ROUTE_PREFIXES) {
      expect(config.includes(`server.middlewares.use('${prefix}`), prefix).toBe(true);
    }
    const guard = config.indexOf('studioDevGuardPlugin(),');
    const firstWriter = config.indexOf('dungeonEditorSavePlugin(),');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstWriter);
    // Every Studio route vite.config.ts mounts is covered by a guarded prefix.
    const mounted = [...config.matchAll(/server\.middlewares\.use\('(\/__[a-z_]+\/)/g)].map(
      (m) => m[1],
    );
    for (const route of mounted) {
      if (route === '/__music_editor/') continue;
      expect(STUDIO_DEV_ROUTE_PREFIXES, route).toContain(route);
    }
  });
});
