import { searchNativeUpdates } from './net/native_update_search';
import { DESKTOP_APP, NATIVE_APP } from './net/online';
import { type DesktopBridge, desktopBridge } from './runtime';

export type ClientUpdateResult = 'ready' | 'updating' | 'none' | 'unavailable' | 'failed';
export const UPDATE_SEARCH_TIMEOUT_MS = 120_000;

// The mismatch screen is terminal, so fetching a fresh entry document is safe.
// Keep realm, login and other query parameters intact.
export function freshClientUrl(href: string, stamp: number): string {
  const url = new URL(href);
  url.searchParams.set('woc-update', String(stamp));
  return url.toString();
}

export function searchDesktopUpdates(bridge: DesktopBridge | null): Promise<ClientUpdateResult> {
  const check = bridge?.checkForUpdates?.bind(bridge);
  const listen = bridge?.onUpdateEvent?.bind(bridge);
  if (!check || !listen) return Promise.resolve('unavailable');
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    const finish = (result: ClientUpdateResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        unsubscribe?.();
      } catch {
        /* A stale bridge must not strand the result. */
      }
      resolve(result);
    };
    const timer = setTimeout(() => finish('failed'), UPDATE_SEARCH_TIMEOUT_MS);
    try {
      unsubscribe = listen((event) => {
        if (event.type === 'downloaded') finish('ready');
        else if (event.type === 'not-available') finish('none');
        else if (event.type === 'error') finish('failed');
      });
      if (settled) unsubscribe();
      else {
        void check()
          .then((result) => {
            if (result === 'ready') finish('ready');
            else if (result === 'unavailable') finish('unavailable');
          })
          .catch(() => finish('failed'));
      }
    } catch {
      finish('failed');
    }
  });
}

export async function searchClientUpdates(currentVersion: string): Promise<ClientUpdateResult> {
  if (NATIVE_APP) return searchNativeUpdates(currentVersion);
  if (DESKTOP_APP) return searchDesktopUpdates(desktopBridge());
  location.replace(freshClientUrl(location.href, Date.now()));
  return 'updating';
}

export async function installClientUpdate(): Promise<void> {
  const bridge = desktopBridge();
  if (!bridge?.installUpdate) throw new Error('Desktop update install unavailable');
  await bridge.installUpdate();
}
