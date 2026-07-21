// Tests for the http.Server 'clientError' handler (server/http/client_error.ts).
// handleClientError is called directly with a minimal socket stand-in; no real
// server is booted.

import type * as net from 'node:net';
import { describe, expect, it } from 'vitest';
import { handleClientError } from '../../../server/http/client_error';

describe('handleClientError', () => {
  it('destroys a socket that is not already destroyed', () => {
    let calls = 0;
    const socket = { destroyed: false, destroy: () => calls++ };
    handleClientError(new Error('x'), socket as unknown as net.Socket);
    expect(calls).toBe(1);
  });

  it('does not call destroy on an already-destroyed socket', () => {
    let calls = 0;
    const socket = { destroyed: true, destroy: () => calls++ };
    handleClientError(new Error('x'), socket as unknown as net.Socket);
    expect(calls).toBe(0);
  });
});
