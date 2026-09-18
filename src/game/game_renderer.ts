// Client composition owns stored quest preferences; render receives only a reader.
import { Renderer, type RendererCreateOptions } from '../render/renderer';
import { sharedQuestTracking } from '../ui/quest_tracking_core';
import type { IWorld } from '../world_api';
import type { Settings } from './settings';

export function createGameRenderer(
  world: IWorld,
  canvas: HTMLCanvasElement,
  nameplates: HTMLDivElement,
  settings: Pick<Settings, 'get'>,
  options: RendererCreateOptions = {},
): Renderer {
  return new Renderer(world, canvas, nameplates, {
    ...options,
    isEastbrookGuidanceEnabled: () => settings.get('eastbrookGuidance'),
    isQuestTracked: (questId) => {
      const tracking = sharedQuestTracking();
      tracking.useCharacter(world.cfg.playerClass, world.player.name);
      return tracking.isTracked(questId);
    },
  });
}

export function validateGameRenderer(renderer: Renderer): void {
  renderer.sync(1, 0, null, 0, null);
  if (renderer.webgl.getContext().isContextLost()) {
    throw new Error('WebGL2 context was lost while validating the rebuilt renderer');
  }
}
