// The session's clarity (clarity_core.ts), read once at module load: the grade pass compiles
// the arm in when it is built, so changing it needs a reload. Headless hosts without a
// location run without it.
import { type ClaritySettings, clarityFromQuery } from './clarity_core';

const settings: ClaritySettings | null =
  typeof location === 'undefined' ? null : clarityFromQuery(location.search);

/** The session's clarity settings, or null for none. */
export function claritySettings(): ClaritySettings | null {
  return settings;
}
