// Per-character JSON save/load for the Idle Classic engine.
//
// REUSES the canonical sim `serializeCharacter`/`addPlayer` path, never
// hand-rolls a subset of CharacterState. The save file bundles seed +
// playerClass + the full CharacterState + a counters snapshot so the next
// session can compute step deltas without replaying history.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CharacterState } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

export interface IdleSaveData {
  seed: number;
  playerClass: PlayerClass;
  playerName?: string;
  characterState: CharacterState;
  counters: {
    kills: number;
    deaths: number;
    xpGained: number;
    questsCompleted: number;
    lootCopper: number;
    levelUps: number;
  };
}

const SAVE_EXT = '.idle.json';

/** Derive the save filename from seed + playerClass. */
function saveFilename(opts: { seed: number; playerClass: string }): string {
  return `${opts.playerClass}_${opts.seed}${SAVE_EXT}`;
}

/** Write a save file to `<saveDir>/<class_seed>.idle.json`. */
export function writeSave(data: IdleSaveData, saveDir: string): string {
  const dir = saveDir;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, saveFilename(data));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

/** Read a save file. Returns null if the file is missing or corrupt. */
export function readSave(filePath: string): IdleSaveData | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data: IdleSaveData = JSON.parse(raw);
    if (!data.seed || !data.playerClass || !data.characterState) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/** Build the save file path from a directory + seed + class. */
export function savePathFor(saveDir: string, seed: number, playerClass: string): string {
  return path.join(saveDir, saveFilename({ seed, playerClass }));
}
