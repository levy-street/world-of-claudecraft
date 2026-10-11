// Pure mapping of active minigame and world-quest activities to dedicated music cues.
// No DOM or AudioContext deps.

import type { WorldQuestProgress } from '../sim/types';

export type MinigameTrack =
  | 'forge'
  | 'cannon'
  | 'glider'
  | 'pacman'
  | 'shadow'
  | 'match3'
  | 'puzzle'
  | 'investigation'
  | 'calligraphy'
  | 'caravan';

export const MINIGAME_MUSIC_URLS: Readonly<Record<MinigameTrack, string>> = Object.freeze({
  forge: '/audio/music/minigame_forge.mp3',
  cannon: '/audio/music/minigame_cannon.mp3',
  glider: '/audio/music/minigame_glider.mp3',
  pacman: '/audio/music/minigame_pacman.mp3',
  shadow: '/audio/music/minigame_shadow.mp3',
  match3: '/audio/music/minigame_match3.mp3',
  puzzle: '/audio/music/minigame_puzzle.mp3',
  investigation: '/audio/music/minigame_investigation.mp3',
  calligraphy: '/audio/music/minigame_calligraphy.mp3',
  caravan: '/audio/music/minigame_caravan.mp3',
});

export const CARAVAN_MOB_TEMPLATES: ReadonlySet<string> = new Set([
  'eastbrook_freight_caravan',
  'willowfen_remedy_caravan',
  'frostveil_supply_caravan',
]);

export const CARAVAN_QUEST_IDS: ReadonlySet<string> = new Set([
  'wq_eastbrook_caravan',
  'wq_willowfen_caravan',
  'wq_frostveil_caravan',
]);

export const CARAVAN_MUSIC_RADIUS = 50;
export const INVESTIGATION_MUSIC_RADIUS = 40;
export const INVESTIGATION_CENTER = { x: -6, z: 284 };

export interface ActiveMinigameEntity {
  templateId?: string;
  pos?: { x: number; z: number };
}

export interface ActiveMinigameMusicInput {
  worldQuestLog?: ReadonlyMap<string, WorldQuestProgress>;
  vehicleSession?: { stationId?: string } | null;
  activePuzzleQuestId?: string | null;
  playerPos?: { x: number; z: number };
  entities?: Iterable<ActiveMinigameEntity>;
}

/** Resolves which minigame music track (if any) should override the ambient score. */
export function resolveActiveMinigameTrack(input: ActiveMinigameMusicInput): MinigameTrack | null {
  // 1. Interactive puzzle modal (Match-3 or Leyline puzzle)
  if (input.activePuzzleQuestId) {
    if (input.activePuzzleQuestId === 'wq_palmreach_confections') {
      return 'match3';
    }
    return 'puzzle';
  }

  // 2. Cannon vehicle session
  if (input.vehicleSession) {
    return 'cannon';
  }

  const log = input.worldQuestLog;
  if (!log) return null;

  // 3. Glider slalom flight
  const slalom = log.get('wq_galecrest_slalom')?.glider;
  if (slalom && (slalom.phase === 'flying' || slalom.phase === 'countdown')) {
    return 'glider';
  }

  // 4. Workshop forging
  const forging = log.get('wq_evergarden_forging')?.forging;
  if (forging && (forging.phase === 'working' || forging.phase === 'countdown')) {
    return 'forge';
  }

  // 5. Wisp maze (Pacman)
  const wispMaze = log.get('wq_evergarden_wisp_maze')?.wispMaze;
  if (
    wispMaze &&
    !wispMaze.paused &&
    (wispMaze.phase === 'active' || wispMaze.phase === 'countdown')
  ) {
    return 'pacman';
  }

  // 6. Stealth infiltration
  const shadow = log.get('wq_wraithwood_restless')?.shadow;
  if (shadow && shadow.phase === 'cloaked') {
    return 'shadow';
  }

  // 7. Arcane calligraphy / tracing
  const tracing = log.get('wq_eastbrook_calligraphy')?.tracing;
  if (tracing && (tracing.phase === 'preview' || tracing.phase === 'drawing')) {
    return 'calligraphy';
  }

  // 8. Infiltrator investigation
  const investigation = log.get('wq_mirefen_infiltrator');
  if (investigation && investigation.state === 'active') {
    if (investigation.investigation !== undefined) {
      return 'investigation';
    }
    if (input.playerPos) {
      const dist = Math.hypot(
        input.playerPos.x - INVESTIGATION_CENTER.x,
        input.playerPos.z - INVESTIGATION_CENTER.z,
      );
      if (dist <= INVESTIGATION_MUSIC_RADIUS) {
        return 'investigation';
      }
    }
  }

  // 9. Caravan escort
  let hasActiveCaravanQuest = false;
  for (const qid of CARAVAN_QUEST_IDS) {
    if (log.get(qid)?.state === 'active') {
      hasActiveCaravanQuest = true;
      break;
    }
  }
  if (hasActiveCaravanQuest && input.entities && input.playerPos) {
    for (const ent of input.entities) {
      if (ent.templateId && CARAVAN_MOB_TEMPLATES.has(ent.templateId) && ent.pos) {
        const dist = Math.hypot(input.playerPos.x - ent.pos.x, input.playerPos.z - ent.pos.z);
        if (dist <= CARAVAN_MUSIC_RADIUS) {
          return 'caravan';
        }
      }
    }
  }

  return null;
}
