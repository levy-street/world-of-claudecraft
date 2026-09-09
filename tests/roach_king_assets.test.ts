import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { glbJsonChunk } from '../scripts/assets/lib/glb_texture_compression_core.mjs';

const ROOT = resolve(__dirname, '..');
const records = JSON.parse(
  readFileSync(resolve(ROOT, 'scripts/assets/specs/roach_king.provenance.json'), 'utf8'),
).assets;
const CREATURES = ['asmon_hermit', 'roach_king', 'roachling', 'garbage_beetle'];
const BASE_CLIPS = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death', 'Cast', 'Jump'];
const BOSS_CLIPS = ['Transform', 'Decree', 'Spit', 'Stomp'];

interface RoachGlb {
  animations: { name: string; channels: { target: { node: number } }[] }[];
  skins: { joints: number[] }[];
}

describe('reviewed Roach King shipping assets', () => {
  it('records all four original P2 jobs without an omitted add or boss form', () => {
    expect(records.map((record: { name: string }) => record.name)).toEqual(CREATURES);
  });

  for (const name of CREATURES) {
    it(`${name} keeps its reviewed rig, motion library and shipping fingerprint`, () => {
      const record = records.find((candidate: { name: string }) => candidate.name === name);
      const bytes = readFileSync(resolve(ROOT, `public/models/creatures/${name}.glb`));
      const gltf = glbJsonChunk(bytes) as RoachGlb;
      expect(record.model).toBe('P2-20260801');
      expect(record.tasks.generate).toMatch(/^[0-9a-f-]{36}$/);
      expect(record.tasks.rig).toMatch(/^[0-9a-f-]{36}$/);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(record.sha256);
      expect(bytes.length).toBe(record.bytes);
      expect(record.qa.checks.every((check: { status: string }) => check.status !== 'fail')).toBe(
        true,
      );
      const expected =
        name === 'asmon_hermit' || name === 'roach_king'
          ? [...BASE_CLIPS, ...BOSS_CLIPS]
          : BASE_CLIPS;
      expect(gltf.animations.map((clip: { name: string }) => clip.name).sort()).toEqual(
        [...expected].sort(),
      );
      const joints = new Set<number>(
        gltf.skins.flatMap((skin: { joints: number[] }) => skin.joints),
      );
      expect(joints.size).toBe(record.authoring.bones);
      for (const clip of gltf.animations) {
        expect(
          clip.channels.some((channel: { target: { node: number } }) =>
            joints.has(channel.target.node),
          ),
          clip.name,
        ).toBe(true);
      }
      if (name !== 'asmon_hermit') expect(record.authoring.legChains).toHaveLength(6);
    });
  }
});
