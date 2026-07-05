// Editor -> game play-test handoff. Stashes a WorldContent (built from the current
// CustomMap via custom_map.customMapToWorldContent) in sessionStorage and navigates
// to the game page, which boots OFFLINE into that world (see game/editor_playtest.ts
// + main.ts). Offline-only: playtest never talks to the server.

import { EDITOR_PLAYTEST_KEY } from '../game/editor_playtest';
import type { WorldContent } from '../sim/types';

// The game's fixed offline world seed: using it makes the play-test heightfield
// match what the editor previews for the built-in terrain.
export const DEFAULT_PLAYTEST_SEED = 20061;

export interface PlaytestOptions {
  seed: number;
  playerClass: string;
  playerName: string;
}

// Stash the world and navigate to the game. Returns false if storage is blocked
// (the caller can surface that); navigation still happens so the user is not stuck.
export function launchPlaytest(world: WorldContent, opts: PlaytestOptions): boolean {
  const payload = JSON.stringify({
    content: world,
    seed: opts.seed,
    playerClass: opts.playerClass,
    playerName: opts.playerName,
  });
  let stored = false;
  try {
    sessionStorage.setItem(EDITOR_PLAYTEST_KEY, payload);
    stored = true;
  } catch {
    stored = false;
  }
  if (stored) window.location.href = '/index.html';
  return stored;
}
