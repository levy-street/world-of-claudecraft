// Relay MAIN-WORLD uncaught errors and unhandled promise rejections to the
// Electron shell's log file via the wocDesktop bridge. This module exists
// because the preload's own window listeners cannot see them: under
// contextIsolation the preload runs in an isolated world, and error /
// unhandledrejection events do not cross JS worlds (verified against
// Electron 43). The shell clamps, caps, validates, and secret-redacts on its
// side (electron/preload.cjs + electron/diagnostics.cjs); the mapper here is
// pure and Node-tested (tests/desktop_error_relay.test.ts).

import type { DesktopBridge, DesktopRendererErrorReport } from '../runtime';

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

export function rendererErrorReportFromEvent(
  kind: 'error' | 'unhandledrejection',
  event: unknown,
): DesktopRendererErrorReport {
  if (kind === 'error') {
    const e = event as Partial<ErrorEvent> | null | undefined;
    const error = e?.error as { stack?: unknown } | null | undefined;
    return {
      kind,
      message: text(e?.message),
      stack: text(error?.stack),
      source: text(e?.filename),
      line: typeof e?.lineno === 'number' ? e.lineno : undefined,
      col: typeof e?.colno === 'number' ? e.colno : undefined,
    };
  }
  const reason = (event as Partial<PromiseRejectionEvent> | null | undefined)?.reason as
    | { message?: unknown; stack?: unknown }
    | string
    | null
    | undefined;
  return {
    kind,
    message: typeof reason === 'string' ? reason : text(reason?.message),
    stack: typeof reason === 'string' ? undefined : text(reason?.stack),
  };
}

export function initDesktopErrorRelay(bridge: DesktopBridge): void {
  const report = bridge.reportRendererError;
  if (typeof report !== 'function') return;
  window.addEventListener('error', (event) => {
    report(rendererErrorReportFromEvent('error', event));
  });
  window.addEventListener('unhandledrejection', (event) => {
    report(rendererErrorReportFromEvent('unhandledrejection', event));
  });
}
