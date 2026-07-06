import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  type ClipMap,
  manifestUrls,
  manifestUrlsForGraphics,
  VISUALS,
  visibleAttachmentsForGraphics,
} from '../src/render/characters/manifest';

function expectedClipNames(clips: ClipMap): string[] {
  return [
    clips.idle,
    clips.walk,
    clips.run,
    clips.death,
    clips.cast,
    clips.sitDown,
    clips.sitIdle,
    clips.swim,
    clips.jump,
    clips.walkBack,
    clips.flourish,
    ...clips.attack,
    ...(clips.hit ?? []),
    ...Object.values(clips.emote ?? {}).flatMap((spec) => spec.clips),
  ].filter((name): name is string => !!name);
}

async function glbAnimationNames(path: string): Promise<Set<string>> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(path);
  return new Set(
    doc
      .getRoot()
      .listAnimations()
      .map((animation) => animation.getName()),
  );
}

async function glbNodeNames(path: string): Promise<Set<string>> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(path);
  return new Set(
    doc
      .getRoot()
      .listNodes()
      .map((node) => node.getName()),
  );
}

describe('character visual manifest', () => {
  it('uses the custom boar death clip without relying on a speed override', () => {
    expect(VISUALS.mob_boar.clips.death).toBe('Dying');
    expect(VISUALS.mob_boar.deathTimeScale).toBeUndefined();
  });

  it('points the Combat Mech manifest at animation clips baked into the GLB', async () => {
    const visual = VISUALS.player_mech;
    const animationNames = await glbAnimationNames(`public/${visual.url}`);

    expect(animationNames.size).toBeGreaterThan(0);
    expect(
      [...new Set(expectedClipNames(visual.clips))].filter((name) => !animationNames.has(name)),
    ).toEqual([]);
  });

  it('points the Stone Cantor manifest at clips present in the GLB (including the synthesized Hit)', async () => {
    const visual = VISUALS.mob_reedbound_acolyte;
    const animationNames = await glbAnimationNames(`public/${visual.url}`);

    expect(animationNames.size).toBeGreaterThan(0);
    expect(
      [...new Set(expectedClipNames(visual.clips))].filter((name) => !animationNames.has(name)),
    ).toEqual([]);
  });

  it('keeps held weapons and props available on low graphics', () => {
    const allWeaponUrls = manifestUrls().filter((url) => url.startsWith('models/weapons/'));
    expect(allWeaponUrls.length).toBeGreaterThan(0);
    expect(manifestUrlsForGraphics(false)).toEqual(expect.arrayContaining(allWeaponUrls));
    expect(visibleAttachmentsForGraphics(VISUALS.player_warrior).map((a) => a.url)).toContain(
      'models/weapons/sword_1handed.glb',
    );
    expect(visibleAttachmentsForGraphics(VISUALS.player_rogue).map((a) => a.url)).toEqual([
      'models/weapons/dagger.glb',
      'models/weapons/dagger.glb',
    ]);
  });

  // The Mirror World's Tripo quadrupeds ship only a 'Walk' clip, so their swing is
  // a procedural bone overlay (visual.ts) instead of a baked Attack clip. Lock in
  // the wiring: the tag, the walk-only clip set, and — the load-bearing bit — that
  // the head/spine bone chain the overlay curls actually exists in each GLB.
  describe('procedural attack (walk-only quadrupeds)', () => {
    const QUADS = [
      { key: 'mob_maw', kind: 'chomp' },
      { key: 'mob_voidfang', kind: 'lungeBite' },
      { key: 'mob_unicorn', kind: 'gore' },
    ] as const;

    it('tags each walk-only quad with a procedural attack kind and no real Attack clip', () => {
      for (const { key, kind } of QUADS) {
        const visual = VISUALS[key];
        expect(visual.proceduralAttack, key).toBe(kind);
        // WALK_ONLY_QUAD_CLIPS points every slot (incl. attack) at the walk cycle.
        expect(visual.clips.attack, key).toEqual([visual.clips.walk]);
      }
    });

    it('each quad GLB ships Walk only and carries the driven tripoHead/tripoSpine chain', async () => {
      for (const { key } of QUADS) {
        const url = `public/${VISUALS[key].url}`;
        const anims = await glbAnimationNames(url);
        expect([...anims], `${key} clips`).toContain('Walk');
        expect(anims.has('Attack'), `${key} must have no baked Attack`).toBe(false);
        // resolveProcAttack() curls the tripoHead_* chain (+ tripoSpine_*); if a
        // re-export renamed/dropped these, the swing would silently no-op.
        const nodes = await glbNodeNames(url);
        expect(nodes.has('tripoHead_0'), `${key} tripoHead_0`).toBe(true);
        expect(nodes.has('tripoHead_1'), `${key} tripoHead_1`).toBe(true);
        expect(nodes.has('tripoSpine_0'), `${key} tripoSpine_0`).toBe(true);
      }
    });
  });
});
