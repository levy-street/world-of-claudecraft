import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function asset(name: string, folder = 'creatures') {
  const bytes = readFileSync(`public/models/${folder}/bastion_ghost_${name}.glb`);
  expect(bytes.toString('ascii', 0, 4)).toBe('glTF');
  expect(bytes.readUInt32LE(8)).toBe(bytes.length);
  return JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
}

describe('Bastion authored spectral assets', () => {
  it.each(['captain', 'sailor'])(
    '%s has a skinned body, distinct action clips and compressed atlas',
    (name) => {
      const glb = asset(name);
      expect(glb.skins.length).toBeGreaterThan(0);
      expect(glb.skins[0].joints.length).toBeGreaterThan(30);
      const clips = glb.animations.map((a: { name: string }) => a.name);
      for (const clip of [
        'Idle',
        'Walk',
        'Run',
        'Attack',
        'Cast',
        'Hit',
        'Death',
        'Broadside',
        'Anchor',
        'Boarding',
      ]) {
        expect(clips).toContain(clip);
      }
      expect(glb.images.length).toBeGreaterThanOrEqual(3);
      expect(glb.images.every((i: { mimeType: string }) => i.mimeType === 'image/ktx2')).toBe(true);
      expect(glb.extensionsUsed).toContain('EXT_meshopt_compression');
      expect(
        glb.materials.some(
          (m: { name: string; alphaMode?: string }) =>
            m.name === 'GhostWisps' && m.alphaMode === 'BLEND',
        ),
      ).toBe(true);
      const death = glb.animations.find((a: { name: string }) => a.name === 'Death');
      const idle = glb.animations.find((a: { name: string }) => a.name === 'Idle');
      expect(death.samplers).not.toEqual(idle.samplers);
      for (const animation of glb.animations) {
        expect(animation.channels.length).toBeGreaterThan(10);
        const duration = Math.max(
          ...animation.samplers.map(
            (sampler: { input: number }) => glb.accessors[sampler.input].max[0],
          ),
        );
        expect(duration).toBeGreaterThan(0.25);
        expect(duration).toBeLessThan(5);
        if (animation.name === 'Anchor' || animation.name === 'Boarding')
          expect(duration).toBeCloseTo(2, 3);
      }
    },
  );

  it('ship ships as a bounded compressed mesh without texture allocations', () => {
    const glb = asset('ship', 'props');
    expect(glb.meshes.length).toBe(1);
    expect(glb.images ?? []).toHaveLength(0);
    expect(glb.extensionsUsed).toContain('EXT_meshopt_compression');
    expect(glb.materials.some((m: { name: string }) => m.name === 'glow')).toBe(true);
  });
});
