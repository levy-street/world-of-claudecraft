// The dev-only chat interceptors, composed in one hook so main.ts stays a
// firewall: the day/night scrub and the Ignivar/Drakelands placer rig both
// ride the chat input's send path, fire only in dev builds, and consume the
// line when they recognize it (the caller clears the input and closes chat
// on true). A future dev chat command joins this chain, never main.ts.
import type * as THREE from 'three';
import {
  currentQuestPlacements,
  type QuestPlacerWorld,
} from '../render/world_quest_placer_sources';
import type { Entity } from '../sim/types';
import { type DayNightDevHud, tryDayNightDevCommand } from './daynight_dev_command';
import { tryIgnivarPlacerCommand } from './ignivar_placer';

export interface DevChatHookDeps {
  hud: DayNightDevHud & {
    log(text: string, color?: string): void;
    devCommandsAvailable?: boolean;
  };
  renderer: {
    scene: THREE.Scene;
    worldCompileGate(): ((target: THREE.Object3D) => Promise<unknown>) | undefined;
  };
  world: QuestPlacerWorld & { player: Entity | undefined; chat(text: string): void };
  /** The offline world: its sim and its sky share ONE clock, so `/dev servertime` is
   *  answered here like /daynight (daynight_dev_command.ts). Online it goes to the server. */
  offline?: boolean;
}

export function tryDevChatHooks(raw: string, deps: DevChatHookDeps): boolean {
  const devAllowed = import.meta.env.DEV || deps.hud.devCommandsAvailable === true;
  if (!devAllowed) return false;
  if (tryDayNightDevCommand(raw, deps.hud, devAllowed, deps.offline === true)) return true;
  return tryIgnivarPlacerCommand(raw, {
    scene: deps.renderer.scene,
    compilePreview: deps.renderer.worldCompileGate(),
    getPlayer: () => deps.world.player,
    getCurrentQuestPlacements: () => currentQuestPlacements(deps.world),
    log: (text, color) => deps.hud.log(text, color),
    chat: (text) => deps.world.chat(text),
  });
}
