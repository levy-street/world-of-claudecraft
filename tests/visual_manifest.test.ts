import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  type ClipMap,
  manifestUrls,
  manifestUrlsForGraphics,
  SKINS,
  VISUALS,
  visibleAttachmentsForGraphics,
  visualKeyFor,
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

describe('character visual manifest', () => {
  it('keeps Bursar Fernando in his likeness atlas (the Eastbrook banker easter egg)', () => {
    // The maintainer-approved easter egg: black shoulder-length hair and light
    // brown skin ride a repainted rogue palette resolved at skin index 0 (NPCs
    // always resolve skin 0; the mech precedent for a real index-0 texture).
    // The def must stay TINT-FREE: an entity tint would wash the repaint back
    // toward the gold villager look. Do not "clean up" any of the three.
    const key = visualKeyFor({ kind: 'npc', templateId: 'bursar_fernando' } as never);
    expect(key).toBe('npc_fernando');
    expect(VISUALS.npc_fernando.tint).toBeUndefined();
    const atlas = SKINS.npc_fernando?.[0];
    expect(atlas).toBe('textures/skins/rogue/fernando.png');
    expect(existsSync(fileURLToPath(new URL(`../public/${atlas}`, import.meta.url)))).toBe(true);
  });

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

  // The custom v02 class bodies bake fewer clips than the 22-clip KayKit set,
  // so their defs are pinned tighter: every non-emote clip the ClipMap can
  // resolve (including the per-hand and per-ability overrides) must be baked
  // in, and every emote spec needs at least one of its alternatives (the
  // runtime plays the first LOADED clip per spec, so alternatives may be
  // absent but a fully-unloadable emote is a silent no-op).
  for (const [label, key, url] of [
    ['warrior', 'player_warrior', 'models/chars/players/warrior_v02.glb'],
    ['paladin', 'player_paladin', 'models/chars/players/paladin_v02.glb'],
  ] as const) {
    it(`points the ${label} manifest at clips baked into ${url.split('/').pop()}`, async () => {
      const visual = VISUALS[key];
      expect(visual.url).toBe(url);
      const animationNames = await glbAnimationNames(`public/${visual.url}`);
      expect(animationNames.size).toBeGreaterThan(0);

      const c = visual.clips;
      const required = [
        c.idle,
        c.walk,
        c.run,
        c.death,
        c.cast,
        c.sitDown,
        c.sitIdle,
        c.swim,
        c.jump,
        c.walkBack,
        c.flourish,
        ...c.attack,
        ...(c.hit ?? []),
        ...Object.values(c.attackByHand ?? {}),
        ...Object.values(c.attackByAbility ?? {}),
      ].filter((name): name is string => !!name);
      expect([...new Set(required)].filter((name) => !animationNames.has(name))).toEqual([]);

      for (const [emote, spec] of Object.entries(c.emote ?? {})) {
        expect(
          spec.clips.some((name) => animationNames.has(name)),
          `emote ${emote} has no loadable clip`,
        ).toBe(true);
      }
    });
  }

  it('points the baked wolf visuals (form_cat, mob_wolf, greyjaw) at clips in their GLBs', async () => {
    const byUrl = new Map<string, Set<string>>();
    for (const key of ['form_cat', 'mob_wolf', 'greyjaw'] as const) {
      const visual = VISUALS[key];
      const animationNames =
        byUrl.get(visual.url) ?? (await glbAnimationNames(`public/${visual.url}`));
      byUrl.set(visual.url, animationNames);

      expect(animationNames.size).toBeGreaterThan(0);
      expect(
        [...new Set(expectedClipNames(visual.clips))].filter((name) => !animationNames.has(name)),
      ).toEqual([]);
    }
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
});
