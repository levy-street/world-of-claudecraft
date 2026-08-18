// Pure request policy for the Cinematic panel's dev-only generated-file
// writer. Browser writes must be same-origin JSON; originless command-line
// requests remain available to local contributors.

import {
  formatGeneratedCinematicCaptureFile,
  isCinematicCameraCapture,
} from './cinematic_capture_core';

export type CinematicCaptureRequestError = 'cross_origin' | 'unsupported_media_type';

export interface CinematicCaptureRequestMeta {
  readonly contentType: string | undefined;
  readonly fetchSite: string | undefined;
  readonly host: string | undefined;
  readonly origin: string | undefined;
}

export interface CinematicCaptureDevRequest {
  readonly method?: string;
  readonly headers?: Record<string, string | readonly string[] | undefined>;
  on(event: string, callback: (chunk?: unknown) => void): void;
}

export interface CinematicCaptureDevResponse {
  statusCode: number;
  end(body?: string): void;
}

export interface CinematicCaptureDevWriter {
  writeSource(source: string): void;
}

export function cinematicCaptureRequestError(
  request: CinematicCaptureRequestMeta,
): CinematicCaptureRequestError | null {
  if (request.contentType?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    return 'unsupported_media_type';
  }
  if (request.fetchSite?.toLowerCase() === 'cross-site') return 'cross_origin';
  if (!request.origin) return null;
  if (!request.host) return 'cross_origin';
  try {
    const origin = new URL(request.origin);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== request.host) {
      return 'cross_origin';
    }
  } catch {
    return 'cross_origin';
  }
  return null;
}

export function handleCinematicCaptureDevRequest(
  request: CinematicCaptureDevRequest,
  response: CinematicCaptureDevResponse,
  writer: CinematicCaptureDevWriter,
): void {
  if (request.method !== 'POST') {
    respond(response, 405, 'post_only');
    return;
  }
  const requestError = cinematicCaptureRequestError({
    contentType: firstHeader(request.headers?.['content-type']),
    fetchSite: firstHeader(request.headers?.['sec-fetch-site']),
    host: firstHeader(request.headers?.host),
    origin: firstHeader(request.headers?.origin),
  });
  if (requestError) {
    respond(response, requestError === 'unsupported_media_type' ? 415 : 403, requestError);
    return;
  }

  let body = '';
  let tooLarge = false;
  request.on('data', (chunk) => {
    if (tooLarge) return;
    body += String(chunk ?? '');
    if (body.length > 32_000) tooLarge = true;
  });
  request.on('end', () => {
    if (tooLarge) {
      respond(response, 413, 'too_large');
      return;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(body);
    } catch {
      respond(response, 400, 'invalid_capture');
      return;
    }
    if (!isCinematicCameraCapture(decoded)) {
      respond(response, 400, 'invalid_capture');
      return;
    }
    try {
      writer.writeSource(formatGeneratedCinematicCaptureFile(decoded));
      response.statusCode = 200;
      response.end('{"ok":true}');
    } catch {
      respond(response, 500, 'write_failed');
    }
  });
}

function firstHeader(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.[0];
}

function respond(response: CinematicCaptureDevResponse, statusCode: number, error: string): void {
  response.statusCode = statusCode;
  response.end(`{"error":"${error}"}`);
}
