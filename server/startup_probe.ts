import * as http from 'node:http';
import { applyServerTimeouts, MAX_HEADER_SIZE_BYTES } from './http/server_timeouts';

export type StartupProbeServer = http.Server;

const STARTUP_RETRY_SECONDS = 5;

/**
 * Bind the service port while database and world boot preconditions run, but do
 * not expose any gameplay or account route. Render's port scanner can therefore
 * distinguish a booting web service from a process that forgot to listen. The
 * /livez response reports only process liveness so a bounded deploy-health window
 * cannot kill a legitimate long first-boot schema pass; all game routes stay 503.
 */
export function listenStartupProbe(port: number, host?: string): Promise<StartupProbeServer> {
  const server = http.createServer({ maxHeaderSize: MAX_HEADER_SIZE_BYTES }, (req, res) => {
    const isLivenessProbe = (req.url?.split('?', 1)[0] ?? '/') === '/livez';
    res.writeHead(isLivenessProbe ? 200 : 503, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(isLivenessProbe ? {} : { 'Retry-After': String(STARTUP_RETRY_SECONDS) }),
      Connection: 'close',
    });
    res.end('starting');
  });
  applyServerTimeouts(server);

  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve(server);
    });
  });
}

/** Release the startup-only listener before the real HTTP + WebSocket server binds. */
export function closeStartupProbe(server: StartupProbeServer): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    // Health probes send Connection: close, but force-close any connection that
    // arrived during the handoff so a keep-alive cannot hold the port forever.
    server.closeAllConnections();
  });
}
