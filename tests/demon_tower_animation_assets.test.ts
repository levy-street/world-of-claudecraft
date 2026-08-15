import { fileURLToPath } from 'node:url';
import { type Animation, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { TOWER_MOBS } from '../src/sim/content/rift/tower_mobs';

function clipDuration(animation: Animation): number {
  let duration = 0;
  for (const sampler of animation.listSamplers()) {
    const times = sampler.getInput()?.getArray();
    if (!times) continue;
    for (const time of times) duration = Math.max(duration, Number(time));
  }
  return duration;
}

function clipSignature(animation: Animation): string {
  return animation
    .listChannels()
    .map((channel) => {
      const output = channel.getSampler()?.getOutput()?.getArray();
      return [
        channel.getTargetNode()?.getName() ?? '',
        channel.getTargetPath(),
        output ? Array.from(output, (value) => Number(value).toFixed(5)).join(',') : '',
      ].join('|');
    })
    .sort()
    .join('\n');
}

function clipPoseDelta(animation: Animation, finalFrameOnly = false): number {
  let delta = 0;
  for (const channel of animation.listChannels()) {
    const output = channel.getSampler()?.getOutput();
    if (!output || output.getCount() < 2) continue;
    const size = output.getElementSize();
    const first = new Array<number>(size);
    output.getElement(0, first);
    const start = finalFrameOnly ? output.getCount() - 1 : 1;
    for (let frame = start; frame < output.getCount(); frame++) {
      const value = new Array<number>(size);
      output.getElement(frame, value);
      if (channel.getTargetPath() === 'rotation') {
        const direct = Math.hypot(...first.map((component, index) => value[index] - component));
        const negated = Math.hypot(...first.map((component, index) => value[index] + component));
        delta = Math.max(delta, Math.min(direct, negated));
      } else {
        delta = Math.max(
          delta,
          Math.hypot(...first.map((component, index) => value[index] - component)),
        );
      }
    }
  }
  return delta;
}

describe('Demon Tower shipped animation assets', () => {
  it('ships distinct, prompt attacks and clamped corpse poses for every mob', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

    for (const templateId of Object.keys(TOWER_MOBS).sort()) {
      const visual = VISUALS[`mob_${templateId}`];
      const path = fileURLToPath(new URL(`../public/${visual.url}`, import.meta.url));
      const animations = new Map(
        (await io.read(path))
          .getRoot()
          .listAnimations()
          .map((animation) => [animation.getName(), animation]),
      );
      const idle = animations.get(visual.clips.idle);
      const attack = animations.get(visual.clips.attack[0]);
      const death = visual.clips.death ? animations.get(visual.clips.death) : undefined;
      expect(idle, `${templateId} idle`).toBeDefined();
      expect(attack, `${templateId} attack`).toBeDefined();
      expect(death, `${templateId} death`).toBeDefined();
      if (!idle || !attack || !death) continue;

      expect(clipSignature(attack), `${templateId} attack must not duplicate Idle`).not.toBe(
        clipSignature(idle),
      );
      expect(clipSignature(death), `${templateId} death must not duplicate Idle`).not.toBe(
        clipSignature(idle),
      );
      expect(attack.listChannels().length, `${templateId} Attack channels`).toBeGreaterThan(1);
      expect(clipDuration(attack), `${templateId} Attack source duration`).toBeGreaterThanOrEqual(
        1,
      );
      expect(clipPoseDelta(attack), `${templateId} Attack must visibly move`).toBeGreaterThan(0.05);
      expect(
        clipDuration(attack) / (visual.attackTimeScale ?? 1.3),
        `${templateId} effective attack duration`,
      ).toBeLessThanOrEqual(2);
      expect(
        clipDuration(death) / (visual.deathTimeScale ?? 1.15),
        `${templateId} effective death duration`,
      ).toBeLessThanOrEqual(2.5);
      expect(death.listChannels().length, `${templateId} Death channels`).toBeGreaterThan(1);
      expect(clipDuration(death), `${templateId} Death source duration`).toBeGreaterThanOrEqual(1);
      expect(
        clipPoseDelta(death, true),
        `${templateId} Death must end in a corpse pose`,
      ).toBeGreaterThan(0.1);
      expect(visual.oneShotReturnFade, `${templateId} Attack-to-Idle blend`).toBe(0.32);
    }
  });
});
