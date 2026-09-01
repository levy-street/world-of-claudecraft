import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

describe('renderer controller world prompt wiring', () => {
  it('exposes a nullable pull source instead of retaining a prompt frame', () => {
    expect(renderer).toContain(
      'setControllerWorldPromptSource(source: ControllerWorldPromptSource | null): void',
    );
    expect(renderer).toContain('this.nameplateUpdate.setControllerWorldPromptSource(source);');
    expect(renderer).not.toContain('private controllerWorldPrompt: ControllerWorldPromptFrame');
  });

  it('pulls the current prompt for both prewarm and live nameplate paints', () => {
    expect(renderer).toContain(
      'this.nameplatePainter.update(true, this.nameplateUpdate.controllerWorldPrompt());',
    );
    expect(renderer).toContain(
      'this.nameplatePainter.update(fullNameplatePass, this.nameplateUpdate.controllerWorldPrompt());',
    );
    expect(renderer.match(/this\.nameplateUpdate\.controllerWorldPrompt\(\)/g)).toHaveLength(2);
  });

  it('keeps cadence state in the extracted nameplate update core', () => {
    expect(renderer).toContain('this.nameplateUpdate.advance(dt, nameplateInterval)');
    expect(renderer).not.toContain('private nameplateTimer');
  });

  it('forwards the local rendered fishing bobber point without recomputing its anchor', () => {
    expect(renderer).toContain(
      'localFishingBobberWorldPointInto(out: FishingBobberWorldPoint): boolean',
    );
    expect(renderer).toContain(
      'return this.fishingBobbers.worldPointInto(this.sim.player.id, out);',
    );
    expect(renderer).not.toContain('bobberAnchorInto(');
  });
});
