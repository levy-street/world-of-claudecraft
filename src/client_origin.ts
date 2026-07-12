// Shared browser/native URL policy for public assets and REST calls. This stays
// independent of the online world client so presentation modules can use the
// configured Capacitor production origin without importing net/.

import { isDesktopAppRuntime, normalizeOrigin, runtimeApiOrigin } from './runtime';

export const NATIVE_APP = String(import.meta.env.VITE_NATIVE_APP ?? '') === '1';
export const NATIVE_API_ORIGIN = normalizeOrigin(String(import.meta.env.VITE_API_ORIGIN ?? ''));
export const DESKTOP_APP = isDesktopAppRuntime();
export const DESKTOP_API_ORIGIN = DESKTOP_APP ? runtimeApiOrigin() : '';

export function apiUrl(path: string, base = ''): string {
  if (/^https?:\/\//.test(path)) return path;
  const origin = normalizeOrigin(base) || NATIVE_API_ORIGIN || DESKTOP_API_ORIGIN;
  return origin ? `${origin}${path}` : path;
}
