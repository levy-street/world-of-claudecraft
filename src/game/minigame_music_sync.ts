// The HUD's medium-band minigame music drive: resolve the active world-quest
// activity from the world and hand it to the music director's minigame layer.
import type { IWorld } from '../world_api';
import { resolveActiveMinigameLevel, resolveActiveMinigameTrack } from './minigame_music';
import { minigameLayerFor } from './minigame_music_layer';
import { music } from './music';

export function syncMinigameMusic(
  world: Pick<IWorld, 'worldQuestLog' | 'vehicleSession' | 'turretSession' | 'entities'>,
  playerPos: { x: number; z: number },
  activePuzzleQuestId: string | null,
): void {
  const input = {
    worldQuestLog: world.worldQuestLog,
    vehicleSession: world.vehicleSession,
    turretSession: world.turretSession,
    activePuzzleQuestId,
    playerPos,
    entities: world.entities.values(),
  };
  minigameLayerFor(music).set(resolveActiveMinigameTrack(input), resolveActiveMinigameLevel(input));
}
