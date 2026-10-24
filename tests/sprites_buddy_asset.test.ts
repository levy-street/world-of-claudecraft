import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { describe, expect, it } from 'vitest';
import { mobVisualKey, VISUALS } from '../src/render/characters/manifest';

const file = 'public/models/buddies/sprites.glb';

const CLIPS = [
  'Idle',
  'Walk',
  'Run',
  'Jump',
  'Search',
  'Idle_Nuzzle',
  'Idle_Peekaboo',
  'Idle_Dance',
  'Idle_Doze',
  'Idle_Leapfrog',
];
const MORPHS = [
  'EyesBlink',
  'EyesHappy',
  'EyesWide',
  'EyesSquint',
  'EyesLookL',
  'EyesLookR',
  'MouthBigSmile',
  'MouthO',
  'MouthFlat',
];

async function readSprites() {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
  return doc.getRoot();
}

describe('Flicker and Glimmer buddy asset', () => {
  it('rides the normal buddy visual with its own clip map', () => {
    expect(mobVisualKey('buddy_sprites')).toBe('buddy_sprites');
    expect(VISUALS.buddy_sprites).toMatchObject({
      url: 'models/buddies/sprites.glb',
      height: 0.4,
      authoredAtlas: true,
      clips: {
        idle: 'Idle',
        walk: 'Walk',
        run: 'Run',
        idleVariants: ['Idle_Nuzzle', 'Idle_Peekaboo', 'Idle_Dance', 'Idle_Doze', 'Idle_Leapfrog'],
      },
    });
  });

  it('ships compressed textures, every clip and both faces with their morph targets', async () => {
    const bytes = readFileSync(file);
    const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
    expect(json.extensionsUsed).toContain('KHR_texture_basisu');
    expect(
      json.images.every((image: { mimeType: string }) => image.mimeType === 'image/ktx2'),
    ).toBe(true);
    const root = await readSprites();
    expect(root.listSkins()).toHaveLength(1);
    expect(root.listAnimations().map((clip) => clip.getName())).toEqual(CLIPS);
    const faces = root.listMeshes().filter((mesh) => mesh.getExtras()?.targetNames);
    expect(faces.map((face) => face.getName()).sort()).toEqual(['gold_face', 'teal_face']);
    for (const face of faces) expect(face.getExtras().targetNames).toEqual(MORPHS);
  });

  it('carries the bones the live flames hang on and read their green from', async () => {
    // src/render/sprites_buddy_flame.ts: a flame on each <c>_squash bone, and
    // gold's turns green with the scale of the gold_merged_12 shell ring. A
    // rename in a re-export would silently drop the flames or their green.
    const root = await readSprites();
    const nodes = new Set(root.listNodes().map((node) => node.getName()));
    for (const bone of ['gold_squash', 'teal_squash', 'gold_merged_12']) {
      expect(nodes.has(bone), bone).toBe(true);
    }
    const idle = root.listAnimations().find((clip) => clip.getName() === 'Idle')!;
    const channels = idle
      .listChannels()
      .map((ch) => `${ch.getTargetNode()?.getName()}.${ch.getTargetPath()}`);
    expect(channels).toContain('gold_merged_12.scale');
    expect(channels).toContain('gold_squash.translation');
    expect(channels).toContain('teal_squash.translation');
  });
});
