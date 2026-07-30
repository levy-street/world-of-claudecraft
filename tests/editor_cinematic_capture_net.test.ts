import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CinematicCameraCapture } from '../src/editor/cinematic_capture_core';
import {
  CINEMATIC_CAPTURE_TOOL,
  createCinematicCameraCapture,
} from '../src/editor/cinematic_capture_core';
import { EditorApiError, saveCinematicCameraCapture } from '../src/editor/net';
import { WORLD_SEED } from '../src/world_seed.mjs';

const CAPTURE = createCinematicCameraCapture({
  sceneId: 'scn_test',
  timeSec: 1,
  seed: WORLD_SEED,
  capturedAt: '2026-07-30T01:02:03.000Z',
  pose: {
    position: { x: 1, y: 3, z: 2 },
    target: { x: 4, y: 6, z: 5 },
  },
  groundY: () => 0,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('editor cinematic capture network adapter', () => {
  it('requires the dev writer acknowledgement and omits the account bearer', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response('{"ok":true}', { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ token: 'private-token', username: 'editor' }),
    });

    await saveCinematicCameraCapture(requiredCapture());

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('expected fetch call');
    const [path, init] = call;
    if (!init) throw new Error('expected request init');
    expect(path).toBe('/__editor/cinematic-capture');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      provenance: { seed: WORLD_SEED, tool: CINEMATIC_CAPTURE_TOOL },
    });
  });

  it('rejects a production SPA fallback instead of reporting a saved capture', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('<!doctype html><title>World of ClaudeCraft</title>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
        ),
      ),
    );

    const error = await saveCinematicCameraCapture(requiredCapture()).catch((reason) => reason);
    expect(error).toBeInstanceOf(EditorApiError);
    expect((error as EditorApiError).code).toBe('invalid_response');
  });
});

function requiredCapture(): CinematicCameraCapture {
  if (!CAPTURE) throw new Error('expected capture fixture');
  return CAPTURE;
}
