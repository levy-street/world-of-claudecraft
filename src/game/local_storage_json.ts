/**
 * Parses the JSON stored at `key` in `localStorage` and returns it as `unknown`,
 * or null when the key is missing, storage is unavailable, or the stored value is
 * not valid JSON. Never throws. Any persisted-settings module can share this core
 * for the parse step and keep its own post-parse shape narrowing.
 */
export function parseStoredJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}
