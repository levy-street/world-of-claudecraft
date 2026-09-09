// Fetch the realm's Realm Builder of the Month roll and hand it to the sim.
//
// The monument in Eastbrook Vale projects the newest name and its inspect card
// lists the rest. Offline that comes from the shipped placeholder in
// src/sim/content/realm_builders.ts; online it comes from the realm's own
// records, through the public read this module calls.
//
// FAIL QUIET, ALWAYS. A realm that has never named anybody, a realm running an
// older server without the endpoint, a request that simply fails: all three
// leave the placeholder showing, which is a plaque waiting for its first name
// rather than a broken one. Nothing here is allowed to keep a player out of the
// world, so the caller does not await it on the critical path.

import { setRealmBuilderRoll } from '../sim/content/realm_builders';

interface RealmBuilderWireEntry {
  year: unknown;
  month: unknown;
  name: unknown;
}

/** Keep only rows shaped the way the sim expects; drop anything else. */
function decode(entries: unknown): { year: number; month: number; name: string }[] {
  if (!Array.isArray(entries)) return [];
  const out: { year: number; month: number; name: string }[] = [];
  for (const raw of entries as RealmBuilderWireEntry[]) {
    const year = Number(raw?.year);
    const month = Number(raw?.month);
    const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
    if (!Number.isFinite(year) || !Number.isFinite(month) || name.length === 0) continue;
    if (month < 1 || month > 12) continue;
    out.push({ year, month, name });
  }
  return out;
}

/**
 * Load the roll into the sim, and answer the current honouree's name so the
 * caller can re-bake the plaque's projection if the town is already built.
 * Null means nothing changed and the placeholder still stands.
 */
export async function loadRealmBuilderRoll(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { entries?: unknown };
    const entries = decode(body?.entries);
    if (entries.length === 0) return null;
    setRealmBuilderRoll(entries);
    return entries[0].name;
  } catch {
    // A realm without the endpoint, or without a network: keep the placeholder.
    return null;
  }
}
