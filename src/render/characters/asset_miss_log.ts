// Dev-channel dedupe for character-asset failures that surface in per-frame
// render paths (a missed preload, a rejected lazy fetch). The first failure
// for a key logs; repeats are dropped, so a permanent miss costs one log line
// instead of one per frame (issue #2079; the per-frame variant was the log
// spam half of the v0.27.0 training dummy freeze,
// docs/training-dummy-preload-freeze-postmortem.md).
const loggedKeys = new Set<string>();

/** Log a per-frame asset failure once per key. Returns whether it logged. */
export function logAssetMissOnce(key: string, message: string, detail?: unknown): boolean {
  if (loggedKeys.has(key)) return false;
  loggedKeys.add(key);
  if (detail === undefined) console.error(message);
  else console.error(message, detail);
  return true;
}
