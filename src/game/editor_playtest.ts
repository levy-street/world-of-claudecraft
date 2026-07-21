// Game-side reader for an editor play-test handoff. The map editor (its own
// entry at /editor) serializes a custom world into sessionStorage and navigates
// to the game page; this reads it back so the OFFLINE boot can run that world.
// Playtest never touches the server or the authoritative world: it only shapes
// the local offline Sim, so it ships enabled (same-origin sessionStorage is the
// player's own data, and offline progress is per-session anyway).
//
// Deliberately depends ONLY on sim types (WorldContent), never on src/editor, so
// the editor's code never enters the shipped game bundle. Defensive: any
// malformed blob yields null and the normal start screen runs instead.

import type { PlayerClass, WorldContent } from '../sim/types';

export const EDITOR_PLAYTEST_KEY = 'woc_editor_playtest';

export interface EditorPlaytestRequest {
  content: WorldContent;
  seed: number;
  playerClass: PlayerClass;
  playerName: string;
}

const VALID_CLASSES: ReadonlySet<string> = new Set([
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'mage',
  'warlock',
  'druid',
  'shaman',
]);

// Shape-check the content enough that the Sim ctor and terrain function won't trip
// on it. Full validation lives in the editor; this is the safety net at the door.
function looksLikeWorldContent(c: unknown): c is WorldContent {
  if (!c || typeof c !== 'object') return false;
  const w = c as Record<string, unknown>;
  const zones = w.zones;
  if (!Array.isArray(zones) || zones.length === 0) return false;
  for (const z of zones) {
    const zone = z as Record<string, unknown>;
    if (typeof zone.zMin !== 'number' || typeof zone.zMax !== 'number') return false;
    if (!zone.hub || typeof (zone.hub as Record<string, unknown>).x !== 'number') return false;
    if (!Array.isArray(zone.lakes) || !Array.isArray(zone.pois)) return false;
  }
  return (
    Array.isArray(w.camps) &&
    Array.isArray(w.groundObjects) &&
    Array.isArray(w.roads) &&
    !!w.props &&
    !!w.playerStart &&
    typeof (w.playerStart as Record<string, unknown>).x === 'number'
  );
}

// Read AND consume a pending play-test request (removed so a later refresh shows
// the normal menu). Returns null with no request or on bad data.
export function takeEditorPlaytestRequest(): EditorPlaytestRequest | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(EDITOR_PLAYTEST_KEY);
    if (raw) sessionStorage.removeItem(EDITOR_PLAYTEST_KEY);
  } catch {
    return null; // storage blocked
  }
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== 'object') return null;
    if (!looksLikeWorldContent(obj.content)) return null;
    const seed = typeof obj.seed === 'number' && Number.isFinite(obj.seed) ? obj.seed : 20061;
    const pc =
      typeof obj.playerClass === 'string' && VALID_CLASSES.has(obj.playerClass)
        ? (obj.playerClass as PlayerClass)
        : 'warrior';
    const name =
      typeof obj.playerName === 'string' && obj.playerName.trim()
        ? obj.playerName.slice(0, 24)
        : 'Mapmaker';
    return { content: obj.content as WorldContent, seed, playerClass: pc, playerName: name };
  } catch {
    return null;
  }
}
