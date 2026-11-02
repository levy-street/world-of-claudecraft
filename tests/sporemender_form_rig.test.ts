// Sporemender Form's rig contract: the shoulder shelves ride their own level bones in every
// clip, and the clips are timed to the form's slower move speed.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { SPOREMENDER_MOVE_SPEED_MULT } from '../src/sim/combat/druid_sporemender';
import { RUN_SPEED } from '../src/sim/types';

interface GltfJson {
  nodes: { name?: string }[];
  skins: { joints: number[] }[];
  animations: { name: string; channels: { target: { node: number; path: string } }[] }[];
}

/** The JSON chunk of a binary glTF, all this contract reads. */
function glbJson(path: string): GltfJson {
  const bytes = readFileSync(path);
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.toString('utf8', 20, 20 + length)) as GltfJson;
}

describe('Sporemender Form rig', () => {
  const gltf = glbJson('public/models/creatures/sporemender_form.glb');
  const shelves = ['L_ShoulderShelf', 'R_ShoulderShelf'].map((name) =>
    gltf.nodes.findIndex((node) => node.name === name),
  );

  it('skins a shelf bone on each shoulder', () => {
    for (const node of shelves) {
      expect(node).toBeGreaterThanOrEqual(0);
      expect(gltf.skins[0].joints).toContain(node);
    }
  });

  it('keys both shelf bones in every clip, or they would tip with the arm', () => {
    expect(gltf.animations.map((clip) => clip.name).sort()).toEqual(
      ['Cast', 'Death', 'Hit', 'Idle', 'Run', 'Walk'].sort(),
    );
    for (const clip of gltf.animations) {
      for (const node of shelves) {
        expect(
          clip.channels.some((c) => c.target.node === node && c.target.path === 'rotation'),
          `${clip.name} keys ${gltf.nodes[node].name}`,
        ).toBe(true);
      }
    }
  });

  it('plays Run slower than authored at the form speed, inside the cadence floor', () => {
    const { runRef, walkRef } = VISUALS.form_sporemender;
    expect(runRef).toBeDefined();
    expect(walkRef).toBeDefined();
    const rate = (RUN_SPEED * SPOREMENDER_MOVE_SPEED_MULT) / (runRef ?? 1);
    expect(rate).toBeCloseTo(0.84, 2);
  });
});
