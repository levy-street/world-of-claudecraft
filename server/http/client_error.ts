// The http.Server 'clientError' handler for the API request pipeline,
// extracted to a top-level module so it is unit-testable
// without booting a real server.
//
// Raw node:http leaves a malformed-request socket (a bad request line, an
// oversized header, a parse error before any 'request' event fires) hanging
// with no response and no close, which a client can use to hold a connection
// open indefinitely. Destroying the socket on 'clientError' closes it instead.

import type * as net from 'node:net';

/**
 * The http.Server 'clientError' listener: destroy the socket unless it is
 * already destroyed. Takes no req/res (the malformed request never produced
 * either); registered once at server creation, never per-request.
 */
export function handleClientError(_err: Error, socket: net.Socket): void {
  if (!socket.destroyed) socket.destroy();
}
