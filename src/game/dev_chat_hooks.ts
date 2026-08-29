// The dev-only chat interceptors, composed in one hook so main.ts stays a
// firewall: the day/night scrub and the Ignivar/Drakelands placer rig both
// ride the chat input's send path, fire only in dev builds, and consume the
// line when they recognize it (the caller clears the input and closes chat
// on true). A future dev chat command joins this chain, never main.ts.
import type * as THREE from 'three';
import type { Entity } from '../sim/types';
import { type DayNightDevHud, tryDayNightDevCommand } from './daynight_dev_command';
import { tryIgnivarPlacerCommand } from './ignivar_placer';

export interface DevChatHookDeps {
  hud: DayNightDevHud & { log(text: string, color?: string): void };
  scene: THREE.Scene;
  world: { player: Entity | undefined; chat(text: string): void };
}

export function tryDevChatHooks(raw: string, deps: DevChatHookDeps): boolean {
  if (!import.meta.env.DEV) return false;
  if (tryDayNightDevCommand(raw, deps.hud)) return true;
  return tryIgnivarPlacerCommand(raw, {
    scene: deps.scene,
    getPlayer: () => deps.world.player,
    log: (text, color) => deps.hud.log(text, color),
    chat: (text) => deps.world.chat(text),
  });
}
