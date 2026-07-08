// Self-tests for the golden-master generator. Fixtures are written into a fresh
// OS temp directory per test and removed in afterEach, so NO fixture file is ever
// committed into the repo.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import type * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeReq } from './fake_http';
import { captureResponse, type Dispatch, goldenMaster } from './golden';

const jsonDispatch =
  (status: number, body: unknown): Dispatch =>
  (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

let dir: string;
let fixturePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'woc-golden-'));
  fixturePath = join(dir, 'fixture.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('captureResponse', () => {
  it('captures the status, headers, and body off a FakeRes', async () => {
    const captured = await captureResponse(jsonDispatch(201, { ok: true }), makeReq());
    expect(captured.status).toBe(201);
    expect(captured.headers['content-type']).toBe('application/json');
    expect(captured.body).toBe(JSON.stringify({ ok: true }));
  });

  it('awaits an async dispatcher', async () => {
    const asyncDispatch: Dispatch = async (_req, res) => {
      await Promise.resolve();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ async: true }));
    };
    const captured = await captureResponse(asyncDispatch, makeReq());
    expect(captured.status).toBe(200);
    expect(captured.body).toBe(JSON.stringify({ async: true }));
  });
});

describe('goldenMaster', () => {
  const req = (): http.IncomingMessage => makeReq({ url: '/api/x' });

  it('writes the fixture on first run, then matches on an identical second run', async () => {
    const dispatch = jsonDispatch(200, { ok: true });

    const first = await goldenMaster({ dispatch, req: req(), fixturePath });
    expect(first.status).toBe('written');
    expect(existsSync(fixturePath)).toBe(true);

    const second = await goldenMaster({ dispatch, req: req(), fixturePath });
    expect(second.status).toBe('match');
  });

  it('reports a mismatch when the dispatcher response changes', async () => {
    const first = await goldenMaster({
      dispatch: jsonDispatch(200, { ok: true }),
      req: req(),
      fixturePath,
    });
    expect(first.status).toBe('written');

    const changed = await goldenMaster({
      dispatch: jsonDispatch(200, { ok: false }),
      req: req(),
      fixturePath,
    });
    expect(changed.status).toBe('mismatch');
    expect(changed.expected).not.toBe(changed.actual);
  });

  it('still matches when only dynamic fields (ids/timestamps) differ between runs', async () => {
    let n = 0;
    // Each call yields a different id and timestamp; normalization masks both, so
    // the serialized fixture is identical across runs.
    const dynamicDispatch: Dispatch = (_req, res) => {
      n += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: n, createdAt: `2026-01-0${n}T00:00:00Z`, score: 100 }));
    };

    const first = await goldenMaster({ dispatch: dynamicDispatch, req: req(), fixturePath });
    expect(first.status).toBe('written');

    const second = await goldenMaster({ dispatch: dynamicDispatch, req: req(), fixturePath });
    expect(second.status).toBe('match');
  });
});
