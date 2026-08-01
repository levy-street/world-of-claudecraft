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
import { NPCS } from '../src/sim/data';

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

  it('resolves all three Chroniclers to the shared scholarly-mage visual', () => {
    // One def, three tints: the per-NPC NpcDef color carries each identity,
    // so the def must keep tint 'entity', and the three colors must stay
    // pairwise distinct and off the bursar gold and auctioneer amethyst.
    for (const templateId of [
      'chronicler_saul',
      'chronicler_osric_fenn',
      'chronicler_edda_hartwell',
    ]) {
      expect(visualKeyFor({ kind: 'npc', templateId } as never)).toBe('npc_chronicler');
    }
    const visual = VISUALS.npc_chronicler;
    expect(visual.url).toBe('models/chars/players/mage.glb');
    expect(visual.show).toEqual(['Mage_Hat']);
    expect(visual.tint).toBe('entity');
    expect(visual.attach?.map((a) => a.url)).toEqual([
      'models/weapons/staff.glb',
      'models/weapons/spellbook_open.glb',
    ]);
    expect(visual.attach?.[1]?.gripRef).toBe('Spellbook_open');

    expect(NPCS.chronicler_saul.color).toBe(0xd08a2e);
    expect(NPCS.chronicler_osric_fenn.color).toBe(0x3fa66b);
    expect(NPCS.chronicler_edda_hartwell.color).toBe(0x5a6fd6);
    const reserved = [NPCS.bursar_petra_vell.color, 0xc9a227, 0x8e5ad6];
    for (const id of [
      'chronicler_saul',
      'chronicler_osric_fenn',
      'chronicler_edda_hartwell',
    ] as const) {
      expect(reserved).not.toContain(NPCS[id].color);
    }
    // The Thornpeak chronicler's display name is renamed to Zenzie while the
    // template id stays (save compatibility); pin the English so a revert
    // cannot land silently.
    expect(NPCS.chronicler_edda_hartwell.name).toBe('Chronicler Zenzie');
  });

  it('uses the custom boar death clip without relying on a speed override', () => {
    expect(VISUALS.mob_boar.clips.death).toBe('Dying');
    expect(VISUALS.mob_boar.deathTimeScale).toBeUndefined();
  });

  it('renders the Nythraxis phase-2 court as Aldren / Malric / Voss, not generic skeletons', () => {
    // The heroic "Spirit of X" adds are the same characters risen again, so they
    // must reuse each named crypt boss's visual. Without the MOB_KEYS entries they
    // fall through to FAMILY_KEYS.undead (skel_minion) and the court renders as
    // three identical grunts. Each add is pinned to its counterpart's key.
    const court: Array<[string, string]> = [
      ['nythraxis_heroic_warrior_add', 'fallen_captain_aldren'],
      ['nythraxis_heroic_priest_add', 'corrupted_priest_malric'],
      ['nythraxis_heroic_rogue_add', 'deathstalker_voss'],
    ];
    for (const [addId, namedId] of court) {
      const addKey = visualKeyFor({ kind: 'mob', templateId: addId } as never);
      const namedKey = visualKeyFor({ kind: 'mob', templateId: namedId } as never);
      expect(addKey, addId).toBe(namedKey);
      expect(addKey, addId).not.toBe('skel_minion');
    }
  });

  it('gives the summoned Water Elemental its own untinted animated water body', async () => {
    const key = visualKeyFor({ kind: 'mob', templateId: 'water_elemental' } as never);
    expect(key).toBe('mob_water_elemental');

    const visual = VISUALS[key];
    expect(visual.url).toBe('models/creatures/water_elemental.glb');
    expect(visual.tint).toBeUndefined();
    expect(visual.clips.cast).toBe('Channel');
    expect(visual.clips.attack).toEqual(['Cast']);

    const animationNames = await glbAnimationNames(`public/${visual.url}`);
    expect(animationNames.size).toBeGreaterThan(0);
    expect(
      [...new Set(expectedClipNames(visual.clips))].filter((name) => !animationNames.has(name)),
    ).toEqual([]);
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

  it('points the training dummy manifest at clips present in the GLB, with cast/jump deliberately absent', async () => {
    const visual = VISUALS.mob_training_dummy;
    const animationNames = await glbAnimationNames(`public/${visual.url}`);

    expect(animationNames.size).toBeGreaterThan(0);
    expect(
      [...new Set(expectedClipNames(visual.clips))].filter((name) => !animationNames.has(name)),
    ).toEqual([]);
    expect(visual.clips.cast).toBeUndefined();
    expect(visual.clips.jump).toBeUndefined();
    expect(animationNames.has('Cast')).toBe(false);
    expect(animationNames.has('Jump')).toBe(false);
  });

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

  it('keeps the five Wildheart GLBs on short, non-loop-closed re-cut takes', async () => {
    // The original defect: the retarget batch baked an 8.46s 'Death' whose
    // final keyframe equalled its first (deviation 0.0000 on every channel).
    // visual.ts clamps death on its LAST frame and snap-seeds corpses to it,
    // so the corpse froze standing; the 6.6s 'Attack' peaked ~2s in, after the
    // ravager's 2.25s swing cadence had already reset the one-shot. The clips
    // are re-cut at build time by scripts/_add_wildheart_death_anim.mjs; this
    // pins the surgery so a fresh export cannot silently regress it.
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    for (const key of [
      'mob_wildheart_stalker',
      'mob_wildheart_ravager',
      'mob_wildheart_hexcaller',
      'mob_wildheart_beastmaster',
      'mob_wildheart_high_priest',
    ] as const) {
      const visual = VISUALS[key];
      const doc = await io.read(`public/${visual.url}`);
      const animations = doc.getRoot().listAnimations();
      const names = new Set(animations.map((animation) => animation.getName()));
      expect(names.size).toBeGreaterThan(0);
      expect(
        [...new Set(expectedClipNames(visual.clips))].filter((name) => !names.has(name)),
        key,
      ).toEqual([]);

      const durationOf = (clipName: string): number => {
        const animation = animations.find((candidate) => candidate.getName() === clipName);
        if (!animation) throw new Error(`${key} lost its ${clipName} clip`);
        let duration = 0;
        for (const sampler of animation.listSamplers()) {
          const times = sampler.getInput()?.getArray();
          if (times && times.length > 0) duration = Math.max(duration, times[times.length - 1]);
        }
        return duration;
      };
      // Two-sided bounds: the upper edge pins the re-cut (Attack must land
      // inside the ravager's 2.25s swing cadence, the original defect), the
      // lower edge rejects a destroyed or stub clip that would also "pass".
      expect(
        durationOf('Death'),
        `${key} Death should stay a game-length take`,
      ).toBeLessThanOrEqual(2.5);
      expect(
        durationOf('Death'),
        `${key} Death must remain a real topple, not a stub`,
      ).toBeGreaterThanOrEqual(1.0);
      expect(
        durationOf('Attack'),
        `${key} Attack should stay cut inside the 2.25s swing cadence`,
      ).toBeLessThanOrEqual(2.25);
      expect(
        durationOf('Attack'),
        `${key} Attack must remain a real strike, not a stub`,
      ).toBeGreaterThanOrEqual(0.5);
      // The re-cut Hit is the 0.7s house flinch; a regressed 1.3s take or a
      // near-zero stub both fail.
      expect(durationOf('Hit'), `${key} Hit should stay the house flinch`).toBeLessThanOrEqual(
        0.75,
      );
      expect(durationOf('Hit'), `${key} Hit must remain a real flinch`).toBeGreaterThanOrEqual(0.5);

      // A loop-closed death would make the clamped corpse pose the standing
      // start pose again: the final keyframe must differ from the first.
      const death = animations.find((candidate) => candidate.getName() === 'Death');
      if (!death) throw new Error(`${key} lost its Death clip`);
      let endVsStart = 0;
      for (const sampler of death.listSamplers()) {
        const times = sampler.getInput()?.getArray();
        const values = sampler.getOutput()?.getArray();
        if (!times || !values) throw new Error(`${key} Death sampler lost its accessors`);
        const stride = values.length / times.length;
        for (let component = 0; component < stride; component++) {
          endVsStart = Math.max(
            endVsStart,
            Math.abs(values[values.length - stride + component] - values[component]),
          );
        }
      }
      expect(endVsStart, `${key} Death must end away from its starting pose`).toBeGreaterThan(0.25);
    }
  });

  it('keeps deepfen_spearjaw on its raptor model despite its reptile family retag', () => {
    // Prose-only claim otherwise (FAMILY_KEYS.reptile comment): the explicit MOB_KEYS
    // override this pins is what actually keeps the model, and nothing else does.
    expect(visualKeyFor({ kind: 'mob', templateId: 'deepfen_spearjaw' } as never)).toBe(
      'mob_spearjaw',
    );
  });
});
