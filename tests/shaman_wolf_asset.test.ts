import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { measureWolfGait } from '../scripts/anim/shaman_wolf_measure.mjs';
import { VISUALS } from '../src/render/characters/manifest';

const bytes = readFileSync(
  new URL('../public/models/creatures/shaman_spirit_wolf.glb', import.meta.url),
);
const jsonLength = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
const binaryStart = 20 + jsonLength + 8;
function values(index: number): number[] {
  const a = gltf.accessors[index],
    view = gltf.bufferViews[a.bufferView];
  expect(a.componentType).toBe(5126);
  const size = a.type === 'VEC4' ? 4 : a.type === 'VEC3' ? 3 : 1;
  const offset = binaryStart + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return Array.from({ length: a.count * size }, (_, i) => bytes.readFloatLE(offset + i * 4));
}

describe('dedicated Shaman ancestral wolf asset', () => {
  it('has a larger independent textured rig without replacing the Druid or enemy models', () => {
    const wolf = VISUALS.form_ghost_wolf;
    expect(wolf.url).toBe('models/creatures/shaman_spirit_wolf.glb');
    expect(wolf.url).not.toBe(VISUALS.mob_wolf.url);
    expect(wolf.url).not.toBe(VISUALS.form_cat.url);
    expect(wolf.height).toBeGreaterThan(VISUALS.mob_wolf.height);
    expect(wolf.authoredAtlas).toBe(true);
    expect(gltf.skins[0].joints.length).toBeGreaterThan(20);
    const triangles = gltf.meshes
      .flatMap((m: { primitives: { indices: number }[] }) => m.primitives)
      .reduce((n: number, p: { indices: number }) => n + gltf.accessors[p.indices].count / 3, 0);
    expect(triangles).toBeLessThanOrEqual(8000);
  });
  it('ships distinct actions and a stationary idle with four planted limbs', () => {
    expect(gltf.animations.map((a: { name: string }) => a.name).sort()).toEqual([
      'Attack',
      'Death',
      'Idle',
      'Run',
      'Walk',
    ]);
    const idle = gltf.animations.find((a: { name: string }) => a.name === 'Idle');
    let limbs = 0;
    for (const channel of idle.channels) {
      const name = gltf.nodes[channel.target.node].name;
      if (!name.includes('Limb_')) continue;
      limbs++;
      const output = values(idle.samplers[channel.sampler].output);
      const size = channel.target.path === 'rotation' ? 4 : 3;
      for (let i = size; i < output.length; i++) expect(output[i]).toBeCloseTo(output[i % size], 6);
    }
    expect(limbs).toBeGreaterThanOrEqual(12);
    const durations = gltf.animations.map((a: { samplers: { input: number }[] }) =>
      Math.max(...a.samplers.flatMap((s) => values(s.input))),
    );
    expect(new Set(durations).size).toBe(5);
  });
  it('closes the idle and run loops without root translation or rotation jumps', () => {
    for (const a of gltf.animations.filter((a: { name: string }) =>
      ['Idle', 'Walk', 'Run'].includes(a.name),
    )) {
      for (const channel of a.channels) {
        const data = values(a.samplers[channel.sampler].output);
        expect(data.every(Number.isFinite)).toBe(true);
        const size = channel.target.path === 'rotation' ? 4 : 3;
        const first = data.slice(0, size),
          last = data.slice(-size);
        if (size === 4) {
          const dot = first.reduce((n, v, i) => n + v * last[i], 0);
          expect(Math.abs(dot)).toBeCloseTo(1, 3);
        } else for (let i = 0; i < size; i++) expect(last[i]).toBeCloseTo(first[i], 3);
      }
    }
  });
  it('plants every skinned paw near the declared travel speed without abrupt paw jumps', async () => {
    const measured = await measureWolfGait(
      fileURLToPath(new URL('../public/models/creatures/shaman_spirit_wolf.glb', import.meta.url)),
    );
    for (const clip of measured.clips) {
      const reference =
        clip.name === 'Run' ? VISUALS.form_ghost_wolf.runRef : VISUALS.form_ghost_wolf.walkRef;
      if (reference === undefined) throw new Error(`Missing measured reference for ${clip.name}`);
      expect(clip.rows).toHaveLength(4);
      for (const foot of clip.rows) {
        expect(Math.abs(foot.minY)).toBeLessThan(0.05);
        expect(foot.stanceN).toBeGreaterThan(20);
        expect(Math.abs(foot.stanceMedian - reference)).toBeLessThan(reference * 0.12);
        expect(foot.rangeY).toBeLessThan(0.6);
        expect(foot.backwardMax).toBeLessThan(reference * 2);
      }
      if (clip.name === 'Run') {
        expect(clip.airbornePhases).toBe(2);
        expect(clip.airborneFraction).toBeGreaterThan(0.15);
        expect(clip.airborneBodyRise).toBeGreaterThan(0.04);
      }
    }
  });
  it('gallops through the body with spine flexion, suspension and tail follow-through', () => {
    const run = gltf.animations.find((a: { name: string }) => a.name === 'Run');
    for (const name of ['tripo::Root', 'tripo::Spine_0', 'tripo::Head_0', 'tripo::Tail_0']) {
      const channel = run.channels.find(
        (c: { target: { node: number; path: string } }) =>
          gltf.nodes[c.target.node].name === name && c.target.path === 'rotation',
      );
      expect(channel, name).toBeDefined();
      const data = values(run.samplers[channel.sampler].output),
        first = data.slice(0, 4);
      let maxAngle = 0;
      for (let i = 4; i < data.length; i += 4) {
        const dot = Math.abs(first.reduce((sum, v, j) => sum + v * data[i + j], 0));
        maxAngle = Math.max(maxAngle, 2 * Math.acos(Math.min(1, dot)));
      }
      expect(maxAngle, name).toBeGreaterThan(0.06);
    }
    const root = run.channels.find(
      (c: { target: { node: number; path: string } }) =>
        gltf.nodes[c.target.node].name === 'tripo::Root' && c.target.path === 'translation',
    );
    const y = values(run.samplers[root.sampler].output).filter((_, i) => i % 3 === 1);
    expect(Math.max(...y) - Math.min(...y)).toBeGreaterThan(0.06);
  });
});
