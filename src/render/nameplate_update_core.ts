import type { ControllerWorldPromptFrame } from './controller_world_prompt_view';

export type ControllerWorldPromptSource = () => ControllerWorldPromptFrame | null;

export class NameplateUpdateCore {
  private elapsed = 0;
  private controllerPromptSource: ControllerWorldPromptSource | null = null;

  setControllerWorldPromptSource(source: ControllerWorldPromptSource | null): void {
    this.controllerPromptSource = source;
  }

  controllerWorldPrompt(): ControllerWorldPromptFrame | null {
    return this.controllerPromptSource?.() ?? null;
  }

  // The renderer supplies the static-preset interval, never an adaptive FPS
  // value, so actionable nameplate information stays graphics-tier neutral.
  advance(dt: number, interval: number): boolean {
    this.elapsed += dt;
    if (this.elapsed < interval) return false;
    this.elapsed = 0;
    return true;
  }
}
