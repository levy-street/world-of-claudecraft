import { describe, expect, it, vi } from 'vitest';
import { createCinematicCameraCapture } from '../src/editor/cinematic_capture_core';
import {
  type CinematicCaptureDevRequest,
  cinematicCaptureRequestError,
  handleCinematicCaptureDevRequest,
} from '../src/editor/cinematic_capture_dev_server_core';
import { WORLD_SEED } from '../src/world_seed.mjs';

describe('editor cinematic capture dev server policy', () => {
  it('accepts same-origin browser JSON requests', () => {
    expect(
      cinematicCaptureRequestError({
        contentType: 'application/json; charset=utf-8',
        fetchSite: 'same-origin',
        host: 'localhost:5173',
        origin: 'http://localhost:5173',
      }),
    ).toBeNull();
  });

  it('accepts originless local command-line JSON requests', () => {
    expect(
      cinematicCaptureRequestError({
        contentType: 'application/json',
        fetchSite: undefined,
        host: 'localhost:5173',
        origin: undefined,
      }),
    ).toBeNull();
  });

  it('rejects cross-origin and non-JSON browser writes', () => {
    expect(
      cinematicCaptureRequestError({
        contentType: 'text/plain',
        fetchSite: 'cross-site',
        host: 'localhost:5173',
        origin: 'https://example.com',
      }),
    ).toBe('unsupported_media_type');
    expect(
      cinematicCaptureRequestError({
        contentType: 'application/json',
        fetchSite: 'cross-site',
        host: 'localhost:5173',
        origin: 'https://example.com',
      }),
    ).toBe('cross_origin');
  });

  it('rejects malformed and host-mismatched origins', () => {
    expect(
      cinematicCaptureRequestError({
        contentType: 'application/json',
        fetchSite: 'same-site',
        host: 'localhost:5173',
        origin: 'null',
      }),
    ).toBe('cross_origin');
    expect(
      cinematicCaptureRequestError({
        contentType: 'application/json',
        fetchSite: 'same-site',
        host: 'localhost:5173',
        origin: 'http://localhost:4173',
      }),
    ).toBe('cross_origin');
  });
});

describe('editor cinematic capture dev server handler', () => {
  it('validates and formats a same-origin capture before calling the fixed writer', () => {
    const capture = captureFixture();
    const request = browserRequest();
    const response = responseHarness();
    const writeSource = vi.fn();

    handleCinematicCaptureDevRequest(request, response, { writeSource });
    request.emit('data', JSON.stringify(capture));
    request.emit('end');

    expect(response.statusCode).toBe(200);
    expect(response.end).toHaveBeenCalledWith('{"ok":true}');
    expect(writeSource).toHaveBeenCalledOnce();
    expect(writeSource.mock.calls[0]?.[0]).toContain('// BEGIN GENERATED CINEMATIC CAMERA CAPTURE');
    expect(writeSource.mock.calls[0]?.[0]).toContain(`seed: ${WORLD_SEED}`);
  });

  it('enforces request policy in the handler before registering body writes', () => {
    const writeSource = vi.fn();
    const crossSite = browserRequest({
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'cross-site',
        host: 'localhost:5173',
        origin: 'https://example.com',
      },
    });
    const crossSiteResponse = responseHarness();
    handleCinematicCaptureDevRequest(crossSite, crossSiteResponse, { writeSource });
    crossSite.emit('data', JSON.stringify(captureFixture()));
    crossSite.emit('end');
    expect(crossSiteResponse.statusCode).toBe(403);

    const wrongMedia = browserRequest({
      headers: {
        'content-type': 'text/plain',
        'sec-fetch-site': 'same-origin',
        host: 'localhost:5173',
        origin: 'http://localhost:5173',
      },
    });
    const wrongMediaResponse = responseHarness();
    handleCinematicCaptureDevRequest(wrongMedia, wrongMediaResponse, { writeSource });
    wrongMedia.emit('data', JSON.stringify(captureFixture()));
    wrongMedia.emit('end');
    expect(wrongMediaResponse.statusCode).toBe(415);
    expect(writeSource).not.toHaveBeenCalled();
  });

  it('reports a fixed-writer failure without claiming success', () => {
    const request = browserRequest();
    const response = responseHarness();
    handleCinematicCaptureDevRequest(request, response, {
      writeSource: () => {
        throw new Error('read-only checkout');
      },
    });
    request.emit('data', JSON.stringify(captureFixture()));
    request.emit('end');

    expect(response.statusCode).toBe(500);
    expect(response.end).toHaveBeenCalledWith('{"error":"write_failed"}');
  });

  it('rejects the wrong method, malformed payloads, and oversized bodies without writing', () => {
    const writeSource = vi.fn();
    const getRequest = browserRequest({ method: 'GET' });
    const getResponse = responseHarness();
    handleCinematicCaptureDevRequest(getRequest, getResponse, { writeSource });
    expect(getResponse.statusCode).toBe(405);

    const invalidRequest = browserRequest();
    const invalidResponse = responseHarness();
    handleCinematicCaptureDevRequest(invalidRequest, invalidResponse, { writeSource });
    invalidRequest.emit('data', '{"sceneId":');
    invalidRequest.emit('end');
    expect(invalidResponse.statusCode).toBe(400);

    const largeRequest = browserRequest();
    const largeResponse = responseHarness();
    handleCinematicCaptureDevRequest(largeRequest, largeResponse, { writeSource });
    largeRequest.emit('data', 'x'.repeat(32_001));
    largeRequest.emit('end');
    expect(largeResponse.statusCode).toBe(413);
    expect(writeSource).not.toHaveBeenCalled();
  });
});

class RequestHarness implements CinematicCaptureDevRequest {
  readonly headers;
  readonly method;
  private readonly callbacks = new Map<string, (chunk?: unknown) => void>();

  constructor(overrides: Partial<CinematicCaptureDevRequest> = {}) {
    this.method = overrides.method ?? 'POST';
    this.headers = overrides.headers ?? {
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
      host: 'localhost:5173',
      origin: 'http://localhost:5173',
    };
  }

  on(event: string, callback: (chunk?: unknown) => void): void {
    this.callbacks.set(event, callback);
  }

  emit(event: string, chunk?: unknown): void {
    this.callbacks.get(event)?.(chunk);
  }
}

function browserRequest(overrides: Partial<CinematicCaptureDevRequest> = {}): RequestHarness {
  return new RequestHarness(overrides);
}

function responseHarness() {
  return {
    statusCode: 0,
    end: vi.fn<(body?: string) => void>(),
  };
}

function captureFixture() {
  const capture = createCinematicCameraCapture({
    sceneId: 'scn_test',
    timeSec: 1.25,
    seed: WORLD_SEED,
    capturedAt: '2026-07-30T01:02:03.000Z',
    pose: {
      position: { x: 1, y: 3, z: 2 },
      target: { x: 4, y: 6, z: 5 },
    },
    groundY: () => 0,
  });
  if (!capture) throw new Error('expected capture');
  return capture;
}
