import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readBoundedJsonResponse,
  SEEKER_RPC_MAX_RESPONSE_BYTES,
  seekerRpcResult,
  validatedSeekerRpcUrl,
} from '../server/seeker_rpc_transport';

describe('Seeker RPC transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts only credential-free HTTPS endpoints', () => {
    expect(validatedSeekerRpcUrl('https://rpc.example/path').href).toBe('https://rpc.example/path');
    expect(() => validatedSeekerRpcUrl('http://rpc.example')).toThrow('must use HTTPS');
    expect(() => validatedSeekerRpcUrl('not a URL')).toThrow();
    expect(() => validatedSeekerRpcUrl('https://user:secret@rpc.example')).toThrow(
      'must not contain credentials',
    );
  });

  it('rejects a declared response length before reading the body', async () => {
    const getReader = vi.fn();
    const response = {
      headers: new Headers({
        'content-length': String(SEEKER_RPC_MAX_RESPONSE_BYTES + 1),
      }),
      body: { getReader },
    } as unknown as Response;

    await expect(readBoundedJsonResponse(response)).rejects.toThrow('exceeded the byte limit');
    expect(getReader).not.toHaveBeenCalled();
  });

  it('rejects malformed Content-Length values', async () => {
    const response = new Response('{}', { headers: { 'content-length': '12x' } });
    await expect(readBoundedJsonResponse(response)).rejects.toThrow('invalid Content-Length');
  });

  it('cancels a chunked response that crosses the actual byte limit', async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"result":'));
          controller.enqueue(new TextEncoder().encode('12345}'));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    await expect(readBoundedJsonResponse(response, 12)).rejects.toThrow('exceeded the byte limit');
    expect(cancelled).toBe(true);
  });

  it('accepts valid JSON exactly at the byte limit', async () => {
    const encoded = new TextEncoder().encode('{"result":1}');
    await expect(
      readBoundedJsonResponse(new Response(encoded), encoded.byteLength),
    ).resolves.toEqual({ result: 1 });
  });

  it('rejects empty, malformed UTF-8, malformed JSON, and failed streams', async () => {
    await expect(readBoundedJsonResponse(new Response(null))).rejects.toThrow('empty response');
    await expect(readBoundedJsonResponse(new Response(new Uint8Array([0xff])))).rejects.toThrow();
    await expect(readBoundedJsonResponse(new Response('{'))).rejects.toThrow();

    const failed = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error('stream failed'));
        },
      }),
    );
    await expect(readBoundedJsonResponse(failed)).rejects.toThrow('stream failed');
  });

  it('uses the caller deadline, refuses redirects, and returns a valid RPC result', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: [] } })),
      );
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;

    await expect(
      seekerRpcResult('https://rpc.example', 'getMultipleAccounts', [[], {}], signal),
    ).resolves.toEqual({ value: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://rpc.example'),
      expect.objectContaining({ method: 'POST', redirect: 'error', signal }),
    );
  });

  it('fails closed for an invalid JSON-RPC envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{}}')));
    await expect(seekerRpcResult('https://rpc.example', 'getMultipleAccounts', [])).rejects.toThrow(
      'invalid response',
    );
  });
});
