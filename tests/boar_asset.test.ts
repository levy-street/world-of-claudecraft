import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';

async function animationRange(path: string, name: string): Promise<{ start: number; end: number }> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(path);
  const anim = doc.getRoot().listAnimations().find((a) => a.getName() === name);
  if (!anim) throw new Error(`${name} animation not found`);
  let start = Infinity;
  let end = 0;
  for (const sampler of anim.listSamplers()) {
    const times = sampler.getInput()?.getArray();
    if (!times || times.length === 0) continue;
    start = Math.min(start, times[0]);
    end = Math.max(end, times[times.length - 1]);
  }
  if (!Number.isFinite(start)) throw new Error(`${name} animation has no keyframes`);
  return { start, end };
}

describe('wild boar asset', () => {
  it('has no dead lead-in on the Dying animation', async () => {
    const range = await animationRange('public/models/creatures/wild_boar.glb', 'Dying');

    expect(range.start).toBeCloseTo(0);
    expect(range.end).toBeGreaterThan(1);
  });
});
