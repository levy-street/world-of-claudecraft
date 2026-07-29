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

  // The custom v02 class bodies bake fewer clips than the 22-clip KayKit set,
  // so their defs are pinned tighter: every non-emote clip the ClipMap can
  // resolve (including the per-hand and per-ability overrides) must be baked
  // in, and every emote spec needs at least one of its alternatives (the
  // runtime plays the first LOADED clip per spec, so alternatives may be
  // absent but a fully-unloadable emote is a silent no-op).
  for (const [label, key, url] of [
    ['warrior', 'player_warrior', 'models/chars/players/warrior_v02.glb'],
    ['paladin', 'player_paladin', 'models/chars/players/paladin_v02.glb'],
    ['mage', 'player_mage', 'models/chars/players/mage_male_v02.glb'],
    ['druid', 'player_druid', 'models/chars/players/druid_male_v02.glb'],
    ['priest', 'player_priest', 'models/chars/players/priest_male_v02.glb'],
    ['rogue', 'player_rogue', 'models/chars/players/rogue_male_v02.glb'],
    ['warlock', 'player_warlock', 'models/chars/players/warlock_male_v02.glb'],
    ['shaman', 'player_shaman', 'models/chars/players/shaman_male_v02.glb'],
    ['hunter', 'player_hunter', 'models/chars/players/hunter_male_v02.glb'],
  ] as const) {
    it(`points the ${label} manifest at clips baked into ${url.split('/').pop()}`, async () => {
      const visual = VISUALS[key];
      expect(visual.url).toBe(url);
      const animationNames = await glbAnimationNames(`public/${visual.url}`);
      expect(animationNames.size).toBeGreaterThan(0);

      const c = visual.clips;
      // All nine v02 player bodies share ONE canonical clip vocabulary (the
      // kaykit() base map). Pin it so a future re-bake or manifest edit can't
      // silently re-cook a base state: jump was briefly stripped (airborne fell
      // back to idle), which is the class of regression this pin guards. Each
      // class's own attack/attackByHand/attackByAbility clips are checked for
      // existence in the GLB below, not pinned here (they legitimately differ).
      expect({
        idle: c.idle,
        walk: c.walk,
        run: c.run,
        walkBack: c.walkBack,
        jump: c.jump,
        swim: c.swim,
        sitDown: c.sitDown,
        sitIdle: c.sitIdle,
        death: c.death,
        cast: c.cast,
        hit: c.hit,
        stow: c.stow,
      }).toEqual({
        idle: 'Idle',
        walk: 'Walking_A',
        run: 'Running_A',
        walkBack: 'Walking_Backwards',
        jump: 'Jump_Idle',
        swim: 'Lie_Idle',
        sitDown: 'Sit_Floor_Down',
        sitIdle: 'Sit_Floor_Idle',
        death: 'Death_A',
        cast: 'Spellcasting',
        hit: ['Hit_A'],
        stow: '1H_Melee_Attack_Chop',
      });
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
        c.stow,
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

  it('keeps deepfen_spearjaw on its raptor model despite its reptile family retag', () => {
    // Prose-only claim otherwise (FAMILY_KEYS.reptile comment): the explicit MOB_KEYS
    // override this pins is what actually keeps the model, and nothing else does.
    expect(visualKeyFor({ kind: 'mob', templateId: 'deepfen_spearjaw' } as never)).toBe(
      'mob_spearjaw',
    );
  });
});
