import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';

// Structural contract for Wobbles the Slime (docs/design/slime-mount). The render
// side looks the saddle bone up by name (the rider's seat, MountSeatSpec) and
// plays the clips by name (MOUNT_SLIME in characters/manifest.ts), so a
// re-export that renames either breaks the mount with nothing else failing. The byte pin makes any
// re-export a deliberate, reviewed change.
const ASSET_PATH = path.join(__dirname, '..', 'public/models/mounts/wobbles_slime.glb');
const EXPECTED_ASSET_SHA256 = 'e008f921a297238f6596579dc3a889edde267a31de6c5fc3b48a8e7ea90bcc21';
const CLIP_SECONDS = { Idle: 6, Walk: 1, Run: 0.9, Jump: 0.6, Land: 0.6, Bubbles: 6 };

async function readAsset() {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).read(ASSET_PATH);
}

describe('Wobbles the Slime mount asset', () => {
  it('ships the exact bytes this test pins, changed only by a deliberate re-export', () => {
    const hash = createHash('sha256').update(readFileSync(ASSET_PATH)).digest('hex');
    expect(hash).toBe(EXPECTED_ASSET_SHA256);
  });

  it('carries the gait, jump and touchdown clips at their authored lengths', async () => {
    const root = (await readAsset()).getRoot();
    const lengths = Object.fromEntries(
      root
        .listAnimations()
        .map((a) => [
          a.getName(),
          Math.max(...a.listSamplers().map((s) => s.getInput()?.getMax([])[0] ?? 0)),
        ]),
    );
    expect(Object.keys(lengths).sort()).toEqual(Object.keys(CLIP_SECONDS).sort());
    for (const [clip, seconds] of Object.entries(CLIP_SECONDS)) {
      expect(lengths[clip]).toBeCloseTo(seconds, 3);
    }
  });

  it('rigs the saddle on its own bone, moved by every body clip, so a rider can sit on it', async () => {
    const root = (await readAsset()).getRoot();
    const joints = [
      ...new Set(root.listSkins().flatMap((s) => s.listJoints().map((j) => j.getName()))),
    ].sort();
    const bubbles = Array.from({ length: 7 }, (_, i) => `bubble_${String(i).padStart(2, '0')}`);
    expect(joints).toEqual(
      ['base', ...bubbles, 'mid', 'move', 'root', 'saddle', 'squash', 'top'].sort(),
    );
    const saddle = root.listNodes().find((n) => n.getName() === 'saddle');
    expect(saddle?.getParentNode()?.getName()).toBe('move');
    for (const anim of root.listAnimations()) {
      if (anim.getName() === 'Bubbles') continue;
      const targets = anim.listChannels().map((c) => c.getTargetNode()?.getName());
      expect(targets).toContain('saddle');
    }
  });

  it('closes every looping clip on its first pose and lands from the held jump pose', async () => {
    // A baked clip once keyed the previous clip's pose onto its first frame, a
    // pop at every loop seam and at the start of Land.
    const anims = new Map(
      (await readAsset())
        .getRoot()
        .listAnimations()
        .map((a) => [a.getName(), a]),
    );
    const ends = (clip: string, bone: string, path: string) => {
      const ch = anims
        .get(clip)
        ?.listChannels()
        .find((c) => c.getTargetNode()?.getName() === bone && c.getTargetPath() === path);
      const out = ch?.getSampler()?.getOutput();
      if (!out) throw new Error(`${clip} has no ${bone} ${path}`);
      const v = Array.from(out.getArray() ?? []);
      const n = out.getElementSize();
      return { first: v.slice(0, n), last: v.slice(-n) };
    };
    for (const clip of ['Idle', 'Walk', 'Run', 'Bubbles']) {
      for (const ch of anims.get(clip)?.listChannels() ?? []) {
        const { first, last } = ends(
          clip,
          ch.getTargetNode()?.getName() ?? '',
          ch.getTargetPath() ?? '',
        );
        for (const [i, x] of first.entries()) expect(x, `${clip} seam`).toBeCloseTo(last[i], 3);
      }
    }
    for (const [bone, path] of [
      ['squash', 'scale'],
      ['saddle', 'translation'],
    ]) {
      const held = ends('Jump', bone, path).last;
      for (const [i, x] of ends('Land', bone, path).first.entries()) {
        expect(x).toBeCloseTo(held[i], 3);
      }
    }
  });

  it('keeps the bubbles on their own ambient loop, apart from every body clip', async () => {
    // The game loops Bubbles beside the body clips (VisualDef.ambientClips) so a
    // gait change never restarts the bubbles. A bone keyed by both would blend.
    expect(VISUALS.mount_wobbles_slime?.ambientClips).toEqual(['Bubbles']);
    const root = (await readAsset()).getRoot();
    for (const anim of root.listAnimations()) {
      const bubbleKeys = anim
        .listChannels()
        .map((c) => c.getTargetNode()?.getName() ?? '')
        .map((n) => n.startsWith('bubble_'));
      expect(bubbleKeys.length).toBeGreaterThan(0);
      expect(new Set(bubbleKeys), anim.getName()).toEqual(new Set([anim.getName() === 'Bubbles']));
    }
  });

  it('draws the jelly translucent, single-sided, with the tack double-sided under it', () =>
    readAsset().then((doc) => {
      const mats = Object.fromEntries(
        doc
          .getRoot()
          .listMaterials()
          .map((m) => [m.getName(), m]),
      );
      expect(mats.slime?.getAlphaMode()).toBe('BLEND');
      expect(mats.slime?.getAlpha()).toBeCloseTo(0.7, 2);
      expect(mats.slime?.getDoubleSided()).toBe(false);
      expect(mats.tack?.getAlphaMode()).toBe('OPAQUE');
      expect(mats.tack?.getDoubleSided()).toBe(true);
      expect(mats.bubble?.getAlphaMode()).toBe('OPAQUE');
    }));

  it('keeps every texture KTX2 and stands 6.61 units tall at rest, on the ground', async () => {
    const doc = await readAsset();
    const root = doc.getRoot();
    expect(root.listTextures().map((t) => t.getMimeType())).toEqual(
      root.listTextures().map(() => 'image/ktx2'),
    );
    const { min, max } = getBounds(root.listScenes()[0]);
    expect(min[1]).toBeCloseTo(0, 2);
    expect(max[1] - min[1]).toBeCloseTo(6.607, 2);
  });
});
