// The Drowned Temple's sixth-pass bodies (src/render/characters/manifest.ts):
// Ysolei is the Codex-built serpent, every one of her clips riding a real
// mechanic; the Ice Wraith ships five clips, each mapped; the
// Colossus walks on its own gait. Each row names its clips so a new body is a
// manifest swap.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import {
  isTemplePilgrimFrenzyCue,
  stepTempleShellStance,
  TEMPLE_MOONSPAWN_RISE,
  TEMPLE_MOONSPAWN_RISE_WINDOW,
  TEMPLE_PILGRIM_FRENZY_GESTURE,
  TEMPLE_SENTINEL_SHELL_CLOSED,
  TEMPLE_SENTINEL_SHELL_OPEN,
  TEMPLE_SENTINEL_STANCE_RESEND,
  templeMoonspawnRises,
  templeSentinelShellGesture,
} from '../src/render/drowned_temple/temple_fx_core';
import { MOBS } from '../src/sim/data';
import {
  COLOSSUS_MOONLIGHT_LANCE,
  COLOSSUS_PRISM_FLARE,
  COLOSSUS_RESONANT_SLAM,
  COLOSSUS_TUNING,
  SELTHE_CHORUS_MARK,
  SELTHE_DROWNING_ARIA,
  SELTHE_MERE_SURGE,
  SELTHE_MOONWATER_BOLT,
  SELTHE_SEA_SONG,
  SELTHE_SOLO_MARK,
  SELTHE_TUNING,
  YSOLEI_CALL,
  YSOLEI_LUNAR_TIDE,
  YSOLEI_UNDERTOW,
  YSOLEI_WRATH,
} from '../src/sim/encounters/drowned_temple';
import { updateBossMechanics } from '../src/sim/mob/boss_mechanics';
import { BASTION_LOOSE_ON_MY_MARK } from '../src/sim/mob/trash_kit/bastion_cast_ids';
import { CRYPT_GRAVESPARK_VOLLEY } from '../src/sim/mob/trash_kit/cast_ids';
import {
  TEMPLE_CALL_OF_THE_SHALLOWS,
  TEMPLE_CALL_THE_TIDE,
  TEMPLE_GLIMMER_VENOM,
  TEMPLE_LIGHTNING_SPIT,
  TEMPLE_LULLABY,
  TEMPLE_PALE_MENDING,
  TEMPLE_PEARL_SLAM,
  TEMPLE_SKEWERING_TRIDENT,
  TEMPLE_SNAP,
  TEMPLE_STATIC_COIL,
  TEMPLE_TRIDENT_SWEEP,
} from '../src/sim/mob/trash_kit/temple_cast_ids';
import { TEMPLE_CARAPACE_AURA } from '../src/sim/mob/trash_kit/temple_kit';

function clipsOf(path: string): string[] {
  const buf = readFileSync(path);
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as {
    animations?: { name: string }[];
  };
  return (json.animations ?? []).map((a) => a.name);
}

interface GlbJson {
  extensionsUsed?: string[];
  images?: { mimeType?: string }[];
  skins?: { joints: number[] }[];
  materials?: { name?: string; emissiveTexture?: unknown }[];
  meshes?: { primitives: { indices?: number }[] }[];
  accessors?: { count: number }[];
}

function glbJson(path: string): GlbJson {
  const buf = readFileSync(path);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as GlbJson;
}

/** Triangles the GLB draws (every indexed primitive of every mesh). */
function trianglesOf(path: string): number {
  const j = glbJson(path);
  let n = 0;
  for (const m of j.meshes ?? [])
    for (const p of m.primitives)
      if (p.indices !== undefined) n += (j.accessors?.[p.indices]?.count ?? 0) / 3;
  return n;
}

function visualOf(templateId: string) {
  return VISUALS[visualKeyFor({ kind: 'mob', templateId } as never)];
}

describe('Ysolei: the Codex serpent on every mechanic', () => {
  it('ships its ten original clips', () => {
    expect(clipsOf('public/models/creatures/temple_ysolei.glb').sort()).toEqual(
      [
        'Bite',
        'Death',
        'Enrage',
        'Hit',
        'Idle',
        'Lunar_Tide',
        'Rise',
        'Summon',
        'Tail_Sweep',
        'Undertow',
      ].sort(),
    );
  });

  it('maps each cast bar to its clip at its authored pace, and keeps her materials', () => {
    const v = visualOf('ysolei');
    const c = v.clips;
    expect(c.castByAbility?.[YSOLEI_LUNAR_TIDE]).toBe('Lunar_Tide');
    expect(c.castByAbility?.[YSOLEI_UNDERTOW]).toBe('Undertow');
    expect(c.castByAbility?.[YSOLEI_CALL]).toBe('Summon');
    expect(c.castByAbility?.[YSOLEI_WRATH]).toBe('Enrage');
    // The Undertow's 3 s channel must never be shortened by a time scale.
    expect(c.castTimeScaleByAbility?.[YSOLEI_UNDERTOW]).toBe(1);
    expect(c.attack).toEqual(['Bite', 'Tail_Sweep']);
    expect(c.flourish).toBe('Rise');
    expect(c.death).toBe('Death');
    expect(v.authoredAtlas).toBe(true);
    expect(v.tint).toBeUndefined();
    // Drawn at native scale: about 24 world units, seven players to her head.
    expect(v.height * (MOBS.ysolei.scale ?? 1)).toBeCloseTo(23.97, 1);
  });
});

describe('the Ice Wraith and the Colossus', () => {
  it('the Ice Wraith runs on the five clips it ships', () => {
    const path = 'public/models/creatures/temple_ice_wraith.glb';
    expect(clipsOf(path).sort()).toEqual(['Attack', 'Death', 'HitReact', 'Idle', 'Walk']);
    const v = visualOf('ice_wraith');
    expect(v.url).toBe('models/creatures/temple_ice_wraith.glb');
    // It glides: Walk carries Run, and every mapped clip is one the file has.
    expect(v.clips).toEqual({
      idle: 'Idle',
      walk: 'Walk',
      run: 'Walk',
      attack: ['Attack'],
      hit: ['HitReact'],
      death: 'Death',
    });
    // No cast clip: Static Coil and Lightning Spit run their bars over its hover.
    expect(v.clips.castByAbility?.[TEMPLE_LIGHTNING_SPIT]).toBeUndefined();
    expect(v.clips.castByAbility?.[TEMPLE_STATIC_COIL]).toBeUndefined();
    expect(v.authoredAtlas).toBe(true);
    expect(v.tint).toBeUndefined();
    // Drawn 4.8 to its crest at its 1.2: nearly two of the 2.6 player.
    expect(v.height * (MOBS.ice_wraith.scale ?? 1)).toBeCloseTo(4.8, 5);
    // It hovers its talons off the floor, and its heap of shards settles back.
    expect(v.hover).toBe(0.3);
    expect(v.deathGroundOffset).toBe(v.hover);
  });

  it('the ice wraith ships compressed: meshopt geometry and a KTX2 atlas on one rig', () => {
    const j = glbJson('public/models/creatures/temple_ice_wraith.glb');
    expect([...(j.extensionsUsed ?? [])].sort()).toEqual([
      'EXT_meshopt_compression',
      'KHR_mesh_quantization',
      'KHR_texture_basisu',
    ]);
    expect((j.images ?? []).map((i) => i.mimeType)).toEqual(['image/ktx2']);
    expect(j.skins?.map((s) => s.joints.length)).toEqual([54]);
    expect(trianglesOf('public/models/creatures/temple_ice_wraith.glb')).toBe(6316);
    // The whole body, five clips and the atlas, under the megabyte the eel took.
    expect(readFileSync('public/models/creatures/temple_ice_wraith.glb').length).toBeLessThan(
      800_000,
    );
  });

  it('the walking Colossus keeps its body at the old size under its larger reach', () => {
    const v = visualOf('tideglass_colossus');
    expect(clipsOf('public/models/creatures/temple_colossus.glb')).toEqual(
      expect.arrayContaining(['Walk', 'Run']),
    );
    expect(v.clips.walk).toBe('Walk');
    // the body is still the 15-unit giant; the pointed spires of the recut
    // rise past it, so the drawn bounds (spire tips included) are 16.7
    expect(v.height * (MOBS.tideglass_colossus.scale ?? 1)).toBeCloseTo(16.7, 3);
  });

  it('the recut sea-glass Colossus ships its glowing seams and glossy facets in budget', () => {
    const path = 'public/models/creatures/temple_colossus.glb';
    const body = glbJson(path).materials?.find((m) => m.name === 'TideglassColossusBody');
    // the seams, cracks, slits and prism glow through the baked emissive map
    expect(body?.emissiveTexture).toBeDefined();
    // the env boost the Reflections' glass uses runs the light across its facets
    expect(visualOf('tideglass_colossus').envMapIntensity).toBe(2.2);
    expect(trianglesOf(path)).toBeGreaterThan(30000);
    expect(trianglesOf(path)).toBeLessThan(42000);
  });

  it('the rebuilt sea-glass Colossus answers each of its bars with its own clip', () => {
    const v = visualOf('tideglass_colossus');
    expect(clipsOf('public/models/creatures/temple_colossus.glb').sort()).toEqual(
      [
        'Attack',
        'Attack2',
        'Cast',
        'Death',
        'Flare',
        'Hit',
        'Idle',
        'Lance',
        'PrismPulse',
        'Run',
        'Slam',
        'Walk',
      ].sort(),
    );
    const c = v.clips;
    expect(c.castByAbility?.[COLOSSUS_PRISM_FLARE]).toBe('Flare');
    expect(c.castByAbility?.[COLOSSUS_MOONLIGHT_LANCE]).toBe('Lance');
    expect(c.castByAbility?.[COLOSSUS_RESONANT_SLAM]).toBe('Slam');
    for (const id of [COLOSSUS_PRISM_FLARE, COLOSSUS_MOONLIGHT_LANCE, COLOSSUS_RESONANT_SLAM])
      expect(c.castTimeScaleByAbility?.[id]).toBe(1);
    // heroic's Reflection swap is a windup cue on the same ability id
    expect(c.attackByAbility?.[COLOSSUS_PRISM_FLARE]).toBe('PrismPulse');
    expect(v.authoredAtlas).toBe(true);
    expect(COLOSSUS_TUNING.flareCast).toBe(2);
    expect(COLOSSUS_TUNING.lanceCast).toBe(2);
    expect(COLOSSUS_TUNING.slamCast).toBe(1.5);
  });
});

describe('the Tide Pilgrim: the sacred sea snail', () => {
  it('ships its own body with a clip for every job', () => {
    expect(clipsOf('public/models/creatures/temple_pilgrim.glb').sort()).toEqual(
      ['Attack', 'Attack2', 'Cast', 'Death', 'Frenzy', 'Hit', 'Idle', 'Run', 'Walk'].sort(),
    );
    const v = visualOf('drowned_pilgrim');
    expect(v.url).toMatch(/temple_pilgrim\.glb$/);
    expect(v.clips.attack).toEqual(['Attack', 'Attack2']);
    expect(v.clips.death).toBe('Death');
    expect(v.authoredAtlas).toBe(true);
    // Drawn about 4.65 tall to the shrine at its 0.95: well over the 2.6 player.
    expect(v.height * (MOBS.drowned_pilgrim.scale ?? 1)).toBeCloseTo(4.66, 1);
  });

  it('plays its Frenzy off the enrage cue, and no swing cuts it short', () => {
    const v = visualOf('drowned_pilgrim');
    expect(v.clips.attackByAbility?.[TEMPLE_PILGRIM_FRENZY_GESTURE]).toBe('Frenzy');
    expect(v.oneShotsHoldAttacks).toContain('Frenzy');
    expect(MOBS.drowned_pilgrim.enrage).toBeDefined();
    const nova = { type: 'spellfx', sourceId: 7, targetId: 7, school: 'fire', fx: 'nova' };
    expect(isTemplePilgrimFrenzyCue(nova, 'drowned_pilgrim')).toBe(true);
    expect(isTemplePilgrimFrenzyCue({ ...nova, school: 'nature' }, 'drowned_pilgrim')).toBe(false);
    expect(isTemplePilgrimFrenzyCue(nova, 'drowned_templeguard')).toBe(false);
    expect(isTemplePilgrimFrenzyCue(nova, undefined)).toBe(false);
    expect(isTemplePilgrimFrenzyCue({ ...nova, targetId: 8 }, 'drowned_pilgrim')).toBe(false);
    expect(isTemplePilgrimFrenzyCue({ ...nova, fx: 'projectile' }, 'drowned_pilgrim')).toBe(false);
    expect(isTemplePilgrimFrenzyCue({ ...nova, ability: 'x' }, 'drowned_pilgrim')).toBe(false);
    expect(isTemplePilgrimFrenzyCue({ ...nova, type: 'aura' }, 'drowned_pilgrim')).toBe(false);
  });
});

describe('the Nacre Templeguard: the seahorse temple knight', () => {
  it('ships its own body with a clip for every job', () => {
    expect(clipsOf('public/models/creatures/temple_templeguard.glb').sort()).toEqual(
      [
        'Attack',
        'Attack2',
        'Cast',
        'CombatIdle',
        'Death',
        'Hit',
        'Hurl',
        'Idle',
        'Run',
        'TridentSweep',
        'Walk',
      ].sort(),
    );
    const v = visualOf('drowned_templeguard');
    expect(v.url).toMatch(/temple_templeguard\.glb$/);
    expect(v.clips.attack).toEqual(['Attack', 'Attack2']);
    expect(v.clips.combatIdle).toBe('CombatIdle');
    expect(v.clips.death).toBe('Death');
    expect(v.authoredAtlas).toBe(true);
    // Drawn 5.5 to the crest at its 1.1: a little over twice the 2.6 player.
    expect(v.height * (MOBS.drowned_templeguard.scale ?? 1)).toBeCloseTo(5.5, 2);
  });

  it('strikes each cast on its bar end: the sweep and the hurled trident', () => {
    const c = visualOf('drowned_templeguard').clips;
    expect(c.castByAbility?.[TEMPLE_TRIDENT_SWEEP]).toBe('TridentSweep');
    expect(c.castByAbility?.[TEMPLE_SKEWERING_TRIDENT]).toBe('Hurl');
    // Authored to the sim's bars (1.5 s and 1.8 s): played at their own pace,
    // held to the bar and finished as one-shots after it.
    expect(c.castTimeScaleByAbility?.[TEMPLE_TRIDENT_SWEEP]).toBe(1);
    expect(c.castTimeScaleByAbility?.[TEMPLE_SKEWERING_TRIDENT]).toBe(1);
    expect(c.castPlayOut).toEqual(expect.arrayContaining(['TridentSweep', 'Hurl']));
    expect(MOBS.drowned_templeguard.breathCone?.castTime).toBe(1.5);
    expect(MOBS.drowned_templeguard.trashKit?.line?.castTime).toBe(1.8);
    const v = visualOf('drowned_templeguard');
    expect(v.castClipSync).toBe(true);
    // A mob's Onrush is plain fast movement (no cast event), so it runs on Run:
    // the warrior-only rush slots must stay unmapped or they would swallow it.
    expect(c.rush).toBeUndefined();
    expect(c.rushArrival).toBeUndefined();
  });
});

describe('the Pale Choir Acolyte: the moon-jelly priestess', () => {
  it('ships its own body with a clip for every job', () => {
    expect(clipsOf('public/models/creatures/temple_acolyte.glb').sort()).toEqual(
      [
        'Attack',
        'Attack2',
        'Cast',
        'Death',
        'Hit',
        'Idle',
        'Lullaby',
        'Mend',
        'Run',
        'Walk',
      ].sort(),
    );
    const v = visualOf('pale_choir_acolyte');
    expect(v.url).toMatch(/temple_acolyte\.glb$/);
    expect(v.clips.attack).toEqual(['Attack', 'Attack2']);
    expect(v.clips.death).toBe('Death');
    expect(v.authoredAtlas).toBe(true);
    // Drawn 5.2 to the bell's crown at her 1.0: twice the 2.6 player.
    expect(v.height * (MOBS.pale_choir_acolyte.scale ?? 1)).toBeCloseTo(5.2, 2);
  });

  it('throws the Pale Hymn on the windup and sings each cast on its bar', () => {
    const v = visualOf('pale_choir_acolyte');
    const c = v.clips;
    // The Pale Hymn's windup cue plays the attack clips; authored to release
    // at the windup's end, so they play at their own pace.
    expect(MOBS.pale_choir_acolyte.petSpell?.windup).toBe(0.6);
    expect(v.attackTimeScale).toBe(1);
    expect(c.castByAbility?.[TEMPLE_LULLABY]).toBe('Lullaby');
    expect(c.castByAbility?.[TEMPLE_PALE_MENDING]).toBe('Mend');
    expect(c.castTimeScaleByAbility?.[TEMPLE_LULLABY]).toBe(1);
    expect(c.castTimeScaleByAbility?.[TEMPLE_PALE_MENDING]).toBe(1);
    expect(MOBS.pale_choir_acolyte.trashKit?.lullaby?.castTime).toBe(2);
    expect(MOBS.pale_choir_acolyte.trashKit?.mend?.castTime).toBe(2.5);
    expect(v.castClipSync).toBe(true);
    // Kickable hymns: no play-out, so an interrupted song never plays to its end.
    expect(c.castPlayOut ?? []).not.toContain('Lullaby');
    expect(c.castPlayOut ?? []).not.toContain('Mend');
  });
});

describe('the Moonlit Siren: the priestess on her waterspout', () => {
  it('ships its own body with a clip for every job', () => {
    expect(clipsOf('public/models/creatures/temple_siren.glb').sort()).toEqual(
      ['Attack', 'Attack2', 'Cast', 'Death', 'Hit', 'Idle', 'Run', 'Sing', 'Walk'].sort(),
    );
    const v = visualOf('moonlit_siren');
    expect(v.url).toMatch(/temple_siren\.glb$/);
    expect(v.clips.attack).toEqual(['Attack', 'Attack2']);
    expect(v.clips.death).toBe('Death');
    expect(v.authoredAtlas).toBe(true);
    // Drawn 6.0 at her 1.0: 2.3 times the 2.6 player.
    expect(v.height * (MOBS.moonlit_siren.scale ?? 1)).toBeCloseTo(6.0, 2);
  });

  it('lashes on the windup and sings Call the Tide on its bar', () => {
    const v = visualOf('moonlit_siren');
    const c = v.clips;
    // Brine Lash's windup cue plays the attack clips, authored to release at
    // the windup's end, so they play at their own pace.
    expect(MOBS.moonlit_siren.petSpell?.windup).toBe(0.6);
    expect(v.attackTimeScale).toBe(1);
    expect(c.castByAbility?.[TEMPLE_CALL_THE_TIDE]).toBe('Sing');
    expect(c.castTimeScaleByAbility?.[TEMPLE_CALL_THE_TIDE]).toBe(1);
    expect(MOBS.moonlit_siren.trashKit?.call?.castTime).toBe(2.5);
    expect(v.castClipSync).toBe(true);
    // A kicked song never plays to its end.
    expect(c.castPlayOut ?? []).not.toContain('Sing');
  });
});

describe('the Tidewisp: a drop of moon-water of its own', () => {
  it('ships its own body, no longer the overworld glimmerwisp', () => {
    expect(clipsOf('public/models/creatures/temple_tidewisp.glb').sort()).toEqual(
      ['Attack', 'Attack2', 'Cast', 'Death', 'Hit', 'Idle', 'Run', 'Walk'].sort(),
    );
    const v = visualOf('tidewisp');
    expect(v.url).toMatch(/temple_tidewisp\.glb$/);
    expect(v.url).not.toMatch(/glimmerwisp/);
    expect(v.clips.death).toBe('Death');
    expect(v.authoredAtlas).toBe(true);
    // Drawn 2.2 with its trail at its 0.8.
    expect(v.height * (MOBS.tidewisp.scale ?? 1)).toBeCloseTo(2.2, 2);
  });
});

describe('the Glimmerscale Lurker: the sacred mantis shrimp', () => {
  it('ships its own body with a clip for every job', () => {
    expect(clipsOf('public/models/creatures/temple_lurker.glb').sort()).toEqual(
      [
        'Attack',
        'Attack2',
        'Cast',
        'Death',
        'Hit',
        'Idle',
        'Land',
        'Leap',
        'Run',
        'Spit',
        'Walk',
      ].sort(),
    );
    const v = visualOf('glimmerscale_lurker');
    expect(v.url).toMatch(/temple_lurker\.glb$/);
    expect(v.clips.attack).toEqual(['Attack', 'Attack2']);
    expect(v.authoredAtlas).toBe(true);
    // Drawn 4.38 to the reared front at its 1.2: 1.7 times the 2.6 player.
    expect(v.height * (MOBS.glimmerscale_lurker.scale ?? 1)).toBeCloseTo(4.38, 2);
  });

  it('wears the sculpted armour of round two, baked, in budget', () => {
    const path = 'public/models/creatures/temple_lurker.glb';
    const body = glbJson(path).materials?.find((m) => m.name === 'GlimmerscaleLurkerBody');
    expect(body?.emissiveTexture).toBeDefined();
    // the keels, pleura, ringed legs and combed claws need a denser body than
    // the smooth first shell (about 17.8k triangles)
    expect(trianglesOf(path)).toBeGreaterThan(20000);
    expect(trianglesOf(path)).toBeLessThan(30000);
  });

  it('pounces in the jump slots and spits Glimmer Venom on its bar', () => {
    const v = visualOf('glimmerscale_lurker');
    const c = v.clips;
    expect(MOBS.glimmerscale_lurker.trashKit?.leap?.seconds).toBe(0.6);
    expect(c.jump).toBe('Leap');
    expect(c.land).toBe('Land');
    expect(c.castByAbility?.[TEMPLE_GLIMMER_VENOM]).toBe('Spit');
    expect(c.castTimeScaleByAbility?.[TEMPLE_GLIMMER_VENOM]).toBe(1);
    expect(MOBS.glimmerscale_lurker.trashKit?.bolt?.castTime).toBe(2);
    expect(v.castClipSync).toBe(true);
    expect(c.castPlayOut ?? []).not.toContain('Spit');
  });
});

describe('the Pearlguard Sentinel: the Moonmantle Ray', () => {
  it('ships its own body with both stances and a clip for every job', () => {
    expect(clipsOf('public/models/creatures/temple_sentinel.glb').sort()).toEqual(
      [
        'Attack',
        'Attack2',
        'Cast',
        'Death',
        'Hit',
        'Idle',
        'Run',
        'ShellAttack',
        'ShellClose',
        'ShellHit',
        'ShellIdle',
        'ShellOpen',
        'ShellWalk',
        'Slam',
        'Walk',
      ].sort(),
    );
    const v = visualOf('pearlguard_sentinel');
    expect(v.url).toMatch(/temple_sentinel\.glb$/);
    expect(v.clips.attack).toEqual(['Attack', 'Attack2']);
    expect(v.authoredAtlas).toBe(true);
    // A floating manta: its Idle bounds (belly and tail tip a yard up) sit
    // `hover` over the floor, so the model's floor stays the world's; drawn
    // 1.52 high at rest at its 1.15, its wings still spanning 6.8 (2.6
    // players): the round-two body is thicker for the same span.
    expect(v.height * (MOBS.pearlguard_sentinel.scale ?? 1)).toBeCloseTo(1.522, 2);
    expect(v.hover).toBeCloseTo(0.673, 3);
    // no feet to match: the glide speeds its beats are authored for, its
    // wander (about 0.35 of its moveSpeed) and its chase (its moveSpeed)
    expect(v.walkRef).toBe(2.4);
    expect(v.runRef).toBe(MOBS.pearlguard_sentinel.moveSpeed);
    expect(v.clips.castByAbility?.[TEMPLE_PEARL_SLAM]).toBe('Slam');
    expect(MOBS.pearlguard_sentinel.trashKit?.wingGust?.castTime).toBe(1.5);
    expect(v.castClipSync).toBe(true);
  });

  it('wears its heart pearl baked into the body, the dark pearl flat, in budget', () => {
    const path = 'public/models/creatures/temple_sentinel.glb';
    const names = (glbJson(path).materials ?? []).map((m) => m.name);
    // the sculpted heart pearl rides the baked atlas (its inner glow is in the
    // emissive map); only the rim filament and the dying pearl stay flat
    expect(names).not.toContain('MantaHeartPearl');
    expect(names).toEqual(
      expect.arrayContaining(['MoonmantleRayBody', 'MantaWingLight', 'MantaDarkPearl']),
    );
    const body = glbJson(path).materials?.find((m) => m.name === 'MoonmantleRayBody');
    expect(body?.emissiveTexture).toBeDefined();
    expect(trianglesOf(path)).toBeGreaterThan(18000);
    expect(trianglesOf(path)).toBeLessThan(32000);
  });

  it('shuts its shell while Pearl Carapace holds and opens when it goes', () => {
    const v = visualOf('pearlguard_sentinel');
    const closed = v.phaseClips?.[TEMPLE_SENTINEL_SHELL_CLOSED];
    const open = v.phaseClips?.[TEMPLE_SENTINEL_SHELL_OPEN];
    expect(closed?.enter).toBe('ShellClose');
    expect(closed?.clips.idle).toBe('ShellIdle');
    expect(closed?.clips.walk).toBe('ShellWalk');
    expect(closed?.clips.attack).toEqual(['ShellAttack']);
    expect(open?.enter).toBe('ShellOpen');
    // the open stance IS the row's own vocabulary, so the rig starts in it
    expect(open?.clips).toBe(v.clips);
    const ward = [{ id: TEMPLE_CARAPACE_AURA }];
    expect(templeSentinelShellGesture('pearlguard_sentinel', ward, false)).toBe(
      TEMPLE_SENTINEL_SHELL_CLOSED,
    );
    expect(templeSentinelShellGesture('pearlguard_sentinel', [], false)).toBe(
      TEMPLE_SENTINEL_SHELL_OPEN,
    );
    expect(templeSentinelShellGesture('pearlguard_sentinel', [{ id: 'other' }], false)).toBe(
      TEMPLE_SENTINEL_SHELL_OPEN,
    );
    expect(templeSentinelShellGesture('pearlguard_sentinel', ward, true)).toBeNull();
    expect(templeSentinelShellGesture('drowned_templeguard', ward, false)).toBeNull();
    // temple_fx reads the stance off every mob it scans and sends it as a gesture
  });

  it('steps the shell stance: shut is re-sent, open reaches a rig left shut, death forgets', () => {
    const SHUT = TEMPLE_SENTINEL_SHELL_CLOSED;
    const OPEN = TEMPLE_SENTINEL_SHELL_OPEN;
    // first sight: told its stance at once, even when it is open (a pooled
    // rig may still hold another Sentinel's shut shell)
    let s = stepTempleShellStance(undefined, OPEN, 10);
    expect(s.send).toBe(OPEN);
    expect(s.next).toEqual({ stance: OPEN, since: 10 });
    // open is re-offered only for the resend window, then left alone
    expect(stepTempleShellStance(s.next, OPEN, 10 + TEMPLE_SENTINEL_STANCE_RESEND).send).toBe(OPEN);
    s = stepTempleShellStance(s.next, OPEN, 10 + TEMPLE_SENTINEL_STANCE_RESEND + 0.1);
    expect(s.send).toBeNull();
    // the ward goes up: shut at once, and every scan after (a late viewer)
    s = stepTempleShellStance(s.next, SHUT, 20);
    expect(s.send).toBe(SHUT);
    expect(stepTempleShellStance(s.next, SHUT, 40).send).toBe(SHUT);
    // it dies shut: the track is forgotten, nothing is sent while dead
    const dead = stepTempleShellStance(s.next, null, 41);
    expect(dead).toEqual({ next: undefined, send: null });
    // revived (the same id): told open afresh, so its rig does not stay shut
    expect(stepTempleShellStance(dead.next, OPEN, 50).send).toBe(OPEN);
  });

  it('the ward the shell keys on is the one the sim lays under 30 percent', () => {
    const kit = MOBS.pearlguard_sentinel.trashKit?.carapace;
    expect(kit?.belowHpPct).toBe(0.3);
    expect(kit?.seconds).toBe(8);
    expect(TEMPLE_CARAPACE_AURA).toBe('temple_pearl_carapace_ward');
  });
});

describe('Choirmother Selthe: the siren matriarch and her fan', () => {
  it('ships her own body with a clip for every mechanic', () => {
    expect(clipsOf('public/models/creatures/temple_selthe.glb').sort()).toEqual(
      [
        'Attack',
        'Attack2',
        'Beam',
        'Bolt',
        'Cast',
        'Chorus',
        'Death',
        'Hit',
        'Idle',
        'Run',
        'SeaSong',
        'Slap',
        'Solo',
        'Surge',
        'Walk',
      ].sort(),
    );
    const v = visualOf('choirmother_selthe');
    expect(v.url).toMatch(/temple_selthe\.glb$/);
    expect(v.authoredAtlas).toBe(true);
    // Drawn 9.0 at her 1.15: about 3.5 players.
    expect(v.height * (MOBS.choirmother_selthe.scale ?? 1)).toBeCloseTo(9.0, 1);
  });

  it('wears her round-two body baked, her bars and eyes in the emissive map, in budget', () => {
    const path = 'public/models/creatures/temple_selthe.glb';
    const body = glbJson(path).materials?.find((m) => m.name === 'ChoirmotherSeltheBody');
    expect(body?.emissiveTexture).toBeDefined();
    expect(trianglesOf(path)).toBeGreaterThan(45000);
    expect(trianglesOf(path)).toBeLessThan(60000);
  });

  it('casts water on her bars (no hand swings) and answers each mark with its gesture', () => {
    const v = visualOf('choirmother_selthe');
    const c = v.clips;
    expect(c.castByAbility?.[SELTHE_SEA_SONG]).toBe('SeaSong');
    expect(c.castByAbility?.[SELTHE_MOONWATER_BOLT]).toBe('Bolt');
    expect(c.castByAbility?.[SELTHE_DROWNING_ARIA]).toBe('Beam');
    expect(c.castByAbility?.[SELTHE_MERE_SURGE]).toBe('Surge');
    // The bolt and the surge land on their bar's end (bar-locked); the aria loops.
    expect(v.castClipSync).toEqual(
      expect.arrayContaining([SELTHE_SEA_SONG, SELTHE_MOONWATER_BOLT, SELTHE_MERE_SURGE]),
    );
    expect(v.castClipSync).not.toContain(SELTHE_DROWNING_ARIA);
    expect(c.attackByAbility?.[SELTHE_CHORUS_MARK]).toBe('Chorus');
    expect(c.attackByAbility?.[SELTHE_SOLO_MARK]).toBe('Solo');
    expect(SELTHE_TUNING.songCast).toBe(1.5);
    expect(SELTHE_TUNING.boltCast).toBe(2);
    expect(SELTHE_TUNING.surgeCast).toBe(3);
  });
});

describe('the Lagoon Snapper: the sacred nautilus', () => {
  it('ships its own body with a clip for every job', () => {
    expect(clipsOf('public/models/creatures/temple_snapper.glb').sort()).toEqual(
      [
        'Attack',
        'Attack2',
        'Cast',
        'Death',
        'Hit',
        'Idle',
        'Run',
        'ShellUp',
        'Snap',
        'Walk',
      ].sort(),
    );
    const v = visualOf('lagoon_snapper');
    expect(v.url).toMatch(/temple_snapper\.glb$/);
    expect(v.authoredAtlas).toBe(true);
    // Drawn 4.6 at its 1.2: 1.8 times the 2.6 player.
    expect(v.height * (MOBS.lagoon_snapper.scale ?? 1)).toBeCloseTo(4.6, 1);
  });

  it('snaps on its bar and holds its shell shut while Shell Up stuns it', () => {
    const c = visualOf('lagoon_snapper').clips;
    expect(c.castByAbility?.[TEMPLE_SNAP]).toBe('Snap');
    expect(c.castTimeScaleByAbility?.[TEMPLE_SNAP]).toBe(1);
    expect(MOBS.lagoon_snapper.breathCone?.castTime).toBe(1.5);
    // Shell Up is a self-stun: the rig's stunned loop is the closed shell
    expect(c.stunned).toBe('ShellUp');
    expect(MOBS.lagoon_snapper.trashKit?.withdraw?.seconds).toBe(5);
  });
});

describe('the Moonspawn: a spirit of the Drowned Moon, no longer a murloc', () => {
  it('has its own body and climbs out of the shore when it is called', () => {
    expect(clipsOf('public/models/creatures/temple_moonspawn.glb').sort()).toEqual(
      ['Attack', 'Attack2', 'Cast', 'Death', 'Hit', 'Idle', 'Rise', 'Run', 'Walk'].sort(),
    );
    const v = visualOf('moonspawn');
    expect(v.url).toMatch(/temple_moonspawn\.glb$/);
    expect(v.url).not.toMatch(/murloc/);
    expect(v.clips.entrance).toBe('Rise');
    expect(v.entranceGesture).toBe(TEMPLE_MOONSPAWN_RISE);
    expect(v.authoredAtlas).toBe(true);
    // Drawn 3.5 at its 0.9: 1.3 times the 2.6 player.
    expect(v.height * (MOBS.moonspawn.scale ?? 1)).toBeCloseTo(3.5, 1);
  });

  it('offers its Rise only for the first moment of a living spawn', () => {
    expect(templeMoonspawnRises('moonspawn', false, 0)).toBe(true);
    expect(templeMoonspawnRises('moonspawn', false, TEMPLE_MOONSPAWN_RISE_WINDOW)).toBe(true);
    expect(templeMoonspawnRises('moonspawn', false, TEMPLE_MOONSPAWN_RISE_WINDOW + 0.1)).toBe(
      false,
    );
    expect(templeMoonspawnRises('moonspawn', true, 0)).toBe(false);
    expect(templeMoonspawnRises('ice_wraith', false, 0)).toBe(false);
  });
});

describe('the pilgrim frenzy cue rides the real enrage', () => {
  it('the nova the sim emits when a pilgrim drops under 30 percent is the cue', () => {
    const events: Array<Record<string, unknown>> = [];
    const ctx = {
      emit: (ev: Record<string, unknown>) => events.push(ev),
      delveRunForMob: () => null,
    };
    const mob = {
      id: 41,
      templateId: 'drowned_pilgrim',
      name: 'Drowned Pilgrim',
      kind: 'mob',
      dead: false,
      enraged: false,
      hp: 25,
      maxHp: 100,
    };
    updateBossMechanics(ctx as never, mob as never);
    expect(mob.enraged).toBe(true);
    const novas = events.filter((ev) => ev.type === 'spellfx' && ev.fx === 'nova');
    expect(novas).toHaveLength(1);
    expect(isTemplePilgrimFrenzyCue(novas[0] as never, 'drowned_pilgrim')).toBe(true);
  });

  it('the temple claims the cue and the dungeon visuals pass the claim on', () => {
    const fx = readFileSync('src/render/drowned_temple/temple_fx.ts', 'utf8');
    expect(fx).toContain('this.playGesture(ev.sourceId, TEMPLE_PILGRIM_FRENZY_GESTURE)');
    const zone = readFileSync('src/render/rift_death_zone.ts', 'utf8');
    // The host hands the gesture hook on (then the shake and reduced-motion seams).
    expect(zone.replace(/\s+/g, ' ')).toContain(
      'new TempleFx( scene, groundY, world, compileGate, playGesture, shake, reducedMotion, )',
    );
    expect(zone).toMatch(/const temple = this\.templeFx\.handleEvent\(event\)/);
    expect(zone.replace(/\s+/g, ' ')).toMatch(/\|\| temple \|\|/);
  });
});

describe('the trash pass second wave plays on the casters own clips', () => {
  it('the volley, the shout and the song each have their clip', () => {
    const adept = VISUALS.crypt_skel_adept.clips;
    expect(adept.castByAbility?.[CRYPT_GRAVESPARK_VOLLEY]).toBe('Spellcast_Raise');
    expect(adept.castTimeScaleByAbility?.[CRYPT_GRAVESPARK_VOLLEY]).toBe(0.6);
    expect(VISUALS.bastion_skel_sergeant.clips.castByAbility?.[BASTION_LOOSE_ON_MY_MARK]).toBe(
      'Rally',
    );
    const siren = visualOf('moonlit_siren').clips;
    expect(siren.castByAbility?.[TEMPLE_CALL_OF_THE_SHALLOWS]).toBe('Sing');
    expect(siren.castTimeScaleByAbility?.[TEMPLE_CALL_OF_THE_SHALLOWS]).toBe(1);
    // A kicked or broken song never plays to its end.
    expect(siren.castPlayOut ?? []).not.toContain('Sing');
  });
});
