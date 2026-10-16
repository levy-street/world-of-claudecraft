// The Gravewyrm Sanctum trash's own Blender bodies
// (src/render/characters/sanctum_trash_looks.ts): each replaces its re-tinted
// placeholder under the same visual key, ships a clip for every job its
// template now has, and is drawn at its SANCTUM_DRAWN_HEIGHTS row.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import {
  BONEGUARD_BODY,
  BONEWALKER_BODY,
  barRate,
  GLACIER_SPLINTER_BODY,
  GLACIER_SPLINTER_CLIP,
  GOADSMITH_BODY,
  GOADSMITH_CLIP,
  PYRE_TENDER_BODY,
  PYRE_TENDER_CLIP,
  RIME_WHELP_BODY,
  RIME_WHELP_CLIP,
  SCALEGUARD_BODY,
  SCALEGUARD_CLIP,
  SLEDGE_HAULER_BODY,
  SLEDGE_HAULER_CLIP,
  THAWCALLER_BODY,
  THAWCALLER_CLIP,
  trashModelScale,
} from '../src/render/characters/sanctum_trash_looks';
import {
  anchorPoint,
  BLOCK_RELEASE,
  BONEWALKER_RISE_GESTURE,
  BONEWALKER_RISE_WINDOW,
  bonewalkerRisesOnSight,
  brandIronAnchor,
  breathReachShare,
  HAULER_ENRAGE_GESTURE,
  isHaulerEnrageCue,
  SANCTUM_DRAWN_HEIGHTS,
  SPLINTER_COPY_GESTURE,
  SPLINTER_FRACTURE_GESTURE,
  SPLINTER_SHATTERED_GESTURE,
  sanctumAnchor,
} from '../src/render/gravewyrm_sanctum_fx/sanctum_fx_core';
import { SanctumKitFx } from '../src/render/gravewyrm_sanctum_fx/sanctum_kit_fx';
import { MOBS } from '../src/sim/data';
import {
  GOADSMITH_RERIVET,
  KORGATH_TUNING,
} from '../src/sim/encounters/gravewyrm_sanctum/boss_ids';
import {
  SANCTUM_BRANDING_IRON,
  SANCTUM_CINDER_BREATH,
  SANCTUM_COUNTERWEIGHT_LASH,
  SANCTUM_FRACTURE,
  SANCTUM_GOAD,
  SANCTUM_ICE_BLOCK_TOSS,
  SANCTUM_PLANT_BRAZIER,
  SANCTUM_RIME_BREATH,
  SANCTUM_THAW_THE_HELD,
  SANCTUM_WARMING_RITE,
} from '../src/sim/mob/trash_kit/sanctum_cast_ids';

type GlbJson = {
  animations?: { name: string }[];
  images?: { mimeType?: string }[];
  extensionsRequired?: string[];
};

function glbJson(path: string): GlbJson {
  const buf = readFileSync(path);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as GlbJson;
}

function clipsOf(path: string): string[] {
  return (glbJson(path).animations ?? []).map((a) => a.name).sort();
}

function visualOf(templateId: string) {
  return VISUALS[visualKeyFor({ kind: 'mob', templateId } as never)];
}

/** A shipped body: KTX2 textures only, the basisu extension required. */
function expectShipped(url: string): void {
  const json = glbJson(`public/${url}`);
  expect((json.images ?? []).length).toBeGreaterThan(0);
  expect((json.images ?? []).every((i) => i.mimeType === 'image/ktx2')).toBe(true);
  expect(json.extensionsRequired ?? []).toContain('KHR_texture_basisu');
}

/** Drawn at its row: the look's height at the template's sim scale. */
function expectDrawnAtRow(templateId: string, tinted = false): void {
  const v = visualOf(templateId);
  const scale = MOBS[templateId]?.scale ?? 1;
  expect(v.height * scale).toBeCloseTo(SANCTUM_DRAWN_HEIGHTS[templateId], 6);
  expect(v.authoredAtlas).toBe(true);
  // No re-tint left over from the placeholder rig (a deliberate grade aside).
  if (!tinted) expect(v.tint).toBeUndefined();
  expect(v.animUrls).toBeUndefined();
}

const DEAD_CLIPS = [
  'Attack',
  'Attack2',
  'Attack3',
  'CombatIdle',
  'Death',
  'Hit',
  'Idle',
  'Run',
  'Thaw',
  'Walk',
].sort();

describe('the Sanctum Boneguard and the Raised Bonewalker', () => {
  it('ship their own bodies with every clip', () => {
    expect(BONEGUARD_BODY.url).toBe('models/creatures/sanctum_boneguard.glb');
    expect(BONEWALKER_BODY.url).toBe('models/creatures/sanctum_raised_bonewalker.glb');
    for (const body of [BONEGUARD_BODY, BONEWALKER_BODY]) {
      expect(clipsOf(`public/${body.url}`)).toEqual(DEAD_CLIPS);
      expectShipped(body.url);
    }
    expect(visualOf('sanctum_boneguard').url).toBe(BONEGUARD_BODY.url);
    expect(visualOf('raised_bonewalker').url).toBe(BONEWALKER_BODY.url);
    expectDrawnAtRow('sanctum_boneguard');
    expectDrawnAtRow('raised_bonewalker');
  });

  it('walk at their authored stride scaled to the drawn size', () => {
    const k = trashModelScale(BONEGUARD_BODY, 'sanctum_boneguard');
    expect(k).toBeCloseTo(4.6 / 4.56, 9);
    expect(visualOf('sanctum_boneguard').walkRef).toBeCloseTo(1.51 * k, 9);
    expect(visualOf('sanctum_boneguard').runRef).toBeCloseTo(5.81 * k, 9);
    const w = trashModelScale(BONEWALKER_BODY, 'raised_bonewalker');
    expect(w).toBeCloseTo(3.7 / 4.4, 9);
    expect(visualOf('raised_bonewalker').runRef).toBeCloseTo(5.81 * w, 9);
  });

  it('a Bonewalker climbs out of the ice once, as it arrives', () => {
    const c = visualOf('raised_bonewalker');
    expect(c.clips.entrance).toBe('Thaw');
    expect(c.entranceGesture).toBe(BONEWALKER_RISE_GESTURE);
    expect(c.oneShotsHoldAttacks).toContain('Thaw');
    expect(c.clips.combatIdle).toBe('CombatIdle');
    expect(c.clips.attack).toEqual(['Attack', 'Attack2', 'Attack3']);
    // On first sight only Velkhar's adds rise (while he fights); a walker
    // merely walked into range, or a dead one, just stands there.
    expect(bonewalkerRisesOnSight('raised_bonewalker', false, true)).toBe(true);
    expect(bonewalkerRisesOnSight('raised_bonewalker', false, false)).toBe(false);
    expect(bonewalkerRisesOnSight('raised_bonewalker', true, true)).toBe(false);
    expect(bonewalkerRisesOnSight('sanctum_boneguard', false, true)).toBe(false);
    expect(BONEWALKER_RISE_WINDOW).toBeGreaterThan(0);
    // The Boneguard itself tears free of the ice when it respawns.
    expect(visualOf('sanctum_boneguard').clips.flourish).toBe('Thaw');
    expect(visualOf('sanctum_boneguard').entranceGesture).toBeUndefined();
  });

  it('Thaw the Held raises the corpse the Boneguard leaves as a Bonewalker', () => {
    const rite = MOBS.broodsworn_thawcaller?.trashKit?.reanimate;
    expect(rite?.corpses).toEqual(['sanctum_boneguard']);
    expect(rite?.summon).toBe('raised_bonewalker');
  });
});

describe('the body anchors map onto the world', () => {
  it('puts forward along the facing and left a quarter turn anticlockwise', () => {
    const out = { x: 0, y: 0, z: 0 };
    // Facing 0 looks down +z: forward is +z, the body's left is +x.
    anchorPoint([1, 0, 0], 0, 0, 0, 0, 1, out);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.z).toBeCloseTo(1, 9);
    anchorPoint([0, 1, 0], 0, 0, 0, 0, 1, out);
    expect(out.x).toBeCloseTo(1, 9);
    expect(out.z).toBeCloseTo(0, 9);
    // Facing a quarter turn (+x forward): the left swings to -z.
    anchorPoint([0, 1, 0], 0, 0, 0, Math.PI / 2, 1, out);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.z).toBeCloseTo(-1, 9);
    // Height, scale by the drawn height, the ground and the mirror.
    anchorPoint([0.5, 0.25, 0.8], 10, 20, 3, 0, 4, out, -1);
    expect(out.x).toBeCloseTo(10 - 1, 9);
    expect(out.z).toBeCloseTo(20 + 2, 9);
    expect(out.y).toBeCloseTo(3 + 3.2, 9);
  });
});

describe('the Sanctum Scaleguard', () => {
  it('ships its own body with a clip for the breath and the lash', () => {
    expect(clipsOf(`public/${SCALEGUARD_BODY.url}`)).toEqual(
      [
        'Attack',
        'Attack2',
        'CinderBreath',
        'CombatIdle',
        'CounterweightLash',
        'Death',
        'Hit',
        'Idle',
        'Run',
        'Walk',
      ].sort(),
    );
    expectShipped(SCALEGUARD_BODY.url);
    expect(visualOf('sanctum_drakonid').url).toBe(SCALEGUARD_BODY.url);
    expectDrawnAtRow('sanctum_drakonid');
    // Drawn to the halberd's spike at its authored size.
    expect(SANCTUM_DRAWN_HEIGHTS.sanctum_drakonid).toBe(SCALEGUARD_BODY.idleHeight);
  });

  it("lands both bars on their clips' contact frames and plays them out", () => {
    const v = visualOf('sanctum_drakonid');
    const t = MOBS.sanctum_drakonid;
    expect(v.castClipSync).toBe(true);
    expect(v.clips.castByAbility?.[SANCTUM_CINDER_BREATH]).toBe('CinderBreath');
    expect(v.clips.castByAbility?.[SANCTUM_COUNTERWEIGHT_LASH]).toBe('CounterweightLash');
    expect(t?.breathCone?.castTime).toBe(2);
    expect(t?.trashKit?.tailLash?.castTime).toBe(1);
    expect(v.clips.castTimeScaleByAbility?.[SANCTUM_CINDER_BREATH]).toBeCloseTo(
      SCALEGUARD_CLIP.cinderBreath / 2,
      9,
    );
    expect(v.clips.castTimeScaleByAbility?.[SANCTUM_COUNTERWEIGHT_LASH]).toBeCloseTo(
      SCALEGUARD_CLIP.counterweightLash / 1,
      9,
    );
    expect(v.clips.castPlayOut).toEqual(['CinderBreath', 'CounterweightLash']);
    expect(barRate(1, 0)).toBe(1);
  });

  it('pours the Cinder Breath from its jaws, not its chest', () => {
    // Measured on the .blend: the jaws at the bar's end, reared over the bar.
    expect(sanctumAnchor('breath', 'sanctum_drakonid')).toEqual([0.24, 0, 0.64]);
    expect(sanctumAnchor('breathDraw', 'sanctum_drakonid')[2]).toBeGreaterThan(0.8);
    // A body without its own row keeps the generic placement.
    expect(sanctumAnchor('breath', 'no_such_mob')).toEqual([0.3, 0, 0.5]);
  });
});

describe('the Broodsworn Thawcaller', () => {
  it('ships its own body with a clip for both rites', () => {
    expect(clipsOf(`public/${THAWCALLER_BODY.url}`)).toEqual(
      [
        'Attack',
        'Attack2',
        'Cast',
        'Death',
        'Hit',
        'Idle',
        'Run',
        'ThawTheHeld',
        'Walk',
        'WarmingRite',
      ].sort(),
    );
    expectShipped(THAWCALLER_BODY.url);
    expect(visualOf('broodsworn_thawcaller').url).toBe(THAWCALLER_BODY.url);
    expectDrawnAtRow('broodsworn_thawcaller');
  });

  it('lands both rites on their bars: the heal and the raising', () => {
    const v = visualOf('broodsworn_thawcaller');
    const kit = MOBS.broodsworn_thawcaller?.trashKit;
    expect(v.castClipSync).toBe(true);
    expect(v.clips.castByAbility?.[SANCTUM_WARMING_RITE]).toBe('WarmingRite');
    expect(v.clips.castByAbility?.[SANCTUM_THAW_THE_HELD]).toBe('ThawTheHeld');
    expect(kit?.mend?.castTime).toBe(2.5);
    expect(kit?.reanimate?.castTime).toBe(3);
    expect(v.clips.castTimeScaleByAbility?.[SANCTUM_WARMING_RITE]).toBeCloseTo(
      THAWCALLER_CLIP.warmingRite / 2.5,
      9,
    );
    expect(v.clips.castTimeScaleByAbility?.[SANCTUM_THAW_THE_HELD]).toBeCloseTo(
      THAWCALLER_CLIP.thawTheHeld / 3,
      9,
    );
    expect(v.clips.castPlayOut).toEqual(['WarmingRite', 'ThawTheHeld']);
  });

  it('draws its soul smoke and tethers from the lantern at its right hand', () => {
    const censer = sanctumAnchor('censer', 'broodsworn_thawcaller');
    // Out past its right hand (negative = its right), at the lantern's height.
    expect(censer[1]).toBeLessThan(-0.25);
    expect(sanctumAnchor('riteCenser', 'broodsworn_thawcaller')[2]).toBeLessThan(censer[2]);
  });
});

describe('the Broodsworn Goadsmith', () => {
  it('ships its own body with a clip for the goad, the brand and the re-rivet', () => {
    expect(clipsOf(`public/${GOADSMITH_BODY.url}`)).toEqual(
      [
        'Attack',
        'BrandingIron',
        'Cast',
        'Death',
        'Goad',
        'Hit',
        'Idle',
        'ReRivet',
        'Run',
        'Walk',
      ].sort(),
    );
    expectShipped(GOADSMITH_BODY.url);
    expect(visualOf('broodsworn_goadsmith').url).toBe(GOADSMITH_BODY.url);
    expect(visualOf('broodsworn_goadsmith').attach).toBeUndefined();
    expectDrawnAtRow('broodsworn_goadsmith');
  });

  it('lands every bar on its clip contact', () => {
    const v = visualOf('broodsworn_goadsmith');
    const kit = MOBS.broodsworn_goadsmith?.trashKit;
    expect(v.castClipSync).toBe(true);
    expect(v.clips.castByAbility?.[SANCTUM_GOAD]).toBe('Goad');
    expect(v.clips.castByAbility?.[SANCTUM_BRANDING_IRON]).toBe('BrandingIron');
    expect(v.clips.castByAbility?.[GOADSMITH_RERIVET]).toBe('ReRivet');
    expect(kit?.goad?.castTime).toBe(2);
    expect(kit?.brand?.castTime).toBe(2);
    expect(v.clips.castTimeScaleByAbility?.[SANCTUM_BRANDING_IRON]).toBeCloseTo(
      GOADSMITH_CLIP.brandingIron / 2,
      9,
    );
    expect(v.clips.castTimeScaleByAbility?.[GOADSMITH_RERIVET]).toBeCloseTo(
      GOADSMITH_CLIP.reRivet / KORGATH_TUNING.rerivetChannel,
      9,
    );
  });

  it('streams the brand from the iron: held up over the bar, lunged out at its end', () => {
    const out: [number, number, number] = [0, 0, 0];
    const held = [...brandIronAnchor('broodsworn_goadsmith', 0.5, out)];
    const lunged = [...brandIronAnchor('broodsworn_goadsmith', 1, out)];
    expect(held[2]).toBeGreaterThan(0.9);
    expect(lunged[0]).toBeGreaterThan(held[0] + 0.3);
    expect(brandIronAnchor('broodsworn_goadsmith', 0.86, out)[2]).toBeCloseTo(held[2], 9);
    // Its iron rides its right hand.
    expect(sanctumAnchor('ironTip', 'broodsworn_goadsmith')[1]).toBeLessThan(0);
  });
});

describe('the Broodsworn Pyre-Tender', () => {
  it('ships its own body and sets the brazier down on the bar', () => {
    expect(clipsOf(`public/${PYRE_TENDER_BODY.url}`)).toEqual(
      ['Attack', 'Cast', 'Death', 'Hit', 'Idle', 'PlantBrazier', 'Run', 'Walk'].sort(),
    );
    expectShipped(PYRE_TENDER_BODY.url);
    expectDrawnAtRow('broodsworn_pyre_tender');
    const v = visualOf('broodsworn_pyre_tender');
    expect(v.url).toBe(PYRE_TENDER_BODY.url);
    expect(v.castClipSync).toBe(true);
    expect(v.clips.castByAbility?.[SANCTUM_PLANT_BRAZIER]).toBe('PlantBrazier');
    expect(MOBS.broodsworn_pyre_tender?.trashKit?.call?.castTime).toBe(1.5);
    expect(v.clips.castTimeScaleByAbility?.[SANCTUM_PLANT_BRAZIER]).toBeCloseTo(
      PYRE_TENDER_CLIP.plantBrazier / 1.5,
      9,
    );
    // The yoke fires burn on the braziers out past her shoulders.
    const yoke = sanctumAnchor('yoke', 'broodsworn_pyre_tender');
    expect(yoke[1]).toBeCloseTo(0.24, 9);
    expect(yoke[2]).toBeGreaterThan(0.7);
  });
});

describe('the Rime Whelp', () => {
  it('ships its own body with a Rime Breath clip', () => {
    expect(clipsOf(`public/${RIME_WHELP_BODY.url}`)).toEqual(
      ['Attack', 'Attack2', 'Death', 'Hit', 'Idle', 'RimeBreath', 'Roar', 'Run', 'Walk'].sort(),
    );
    expectShipped(RIME_WHELP_BODY.url);
    expect(visualOf('rime_whelp').url).toBe(RIME_WHELP_BODY.url);
    expectDrawnAtRow('rime_whelp');
    // A head and more past the player: never a toy.
    expect(SANCTUM_DRAWN_HEIGHTS.rime_whelp).toBeGreaterThanOrEqual(2.6 * 1.35);
  });

  it('puffs the frost on the bar end, from its jaws far out on its neck', () => {
    const v = visualOf('rime_whelp');
    const cone = MOBS.rime_whelp?.trashKit?.cone;
    expect(cone?.castTime).toBe(0.6);
    expect(v.castClipSync).toBe(true);
    expect(v.clips.castByAbility?.[SANCTUM_RIME_BREATH]).toBe('RimeBreath');
    expect(v.clips.castTimeScaleByAbility?.[SANCTUM_RIME_BREATH]).toBeCloseTo(
      RIME_WHELP_CLIP.rimeBreath / 0.6,
      9,
    );
    expect(v.clips.castPlayOut).toEqual(['RimeBreath']);
    const mouth = sanctumAnchor('breath', 'rime_whelp');
    expect(mouth[0]).toBeGreaterThan(1);
    expect(mouth[2]).toBeLessThan(0.5);
    // Its long neck carries the jaws 4 yd ahead: the puff is cut to the rest
    // of the sim's 6 yd cone, never painted past its end.
    const ahead = mouth[0] * SANCTUM_DRAWN_HEIGHTS.rime_whelp;
    expect(ahead).toBeGreaterThan(3.5);
    expect(6 * breathReachShare(6, ahead)).toBeCloseTo(Math.max(1.5, 6 - ahead), 9);
    expect(breathReachShare(6, 0)).toBe(1);
    expect(breathReachShare(6, 9)).toBe(0.25);
  });
});

describe('the Ogre Sledge-Hauler', () => {
  it('ships its own body with the toss and the enrage', () => {
    expect(clipsOf(`public/${SLEDGE_HAULER_BODY.url}`)).toEqual(
      [
        'Attack',
        'Attack2',
        'CombatIdle',
        'Death',
        'Enrage',
        'Hit',
        'IceBlockToss',
        'Idle',
        'Run',
        'Walk',
      ].sort(),
    );
    expectShipped(SLEDGE_HAULER_BODY.url);
    expect(visualOf('ogre_sledge_hauler').url).toBe(SLEDGE_HAULER_BODY.url);
    expectDrawnAtRow('ogre_sledge_hauler');
  });

  it('lets go of its block on the frame the fx block takes off', () => {
    const v = visualOf('ogre_sledge_hauler');
    const bar = MOBS.ogre_sledge_hauler?.trashKit?.toss?.castTime ?? 0;
    expect(bar).toBe(2);
    expect(v.castClipSync).toBe(true);
    expect(v.clips.castByAbility?.[SANCTUM_ICE_BLOCK_TOSS]).toBe('IceBlockToss');
    const rate = v.clips.castTimeScaleByAbility?.[SANCTUM_ICE_BLOCK_TOSS] ?? 0;
    // The clip's release lands at BLOCK_RELEASE of the bar.
    expect(SLEDGE_HAULER_CLIP.tossRelease / rate).toBeCloseTo(BLOCK_RELEASE * bar, 9);
  });

  it('beats its chest on the sim enrage cue, and only its own', () => {
    const v = visualOf('ogre_sledge_hauler');
    expect(v.clips.attackByAbility?.[HAULER_ENRAGE_GESTURE]).toBe('Enrage');
    expect(v.oneShotsHoldAttacks).toContain('Enrage');
    const cue = { type: 'spellfx', fx: 'nova', school: 'fire', sourceId: 7, targetId: 7 };
    expect(isHaulerEnrageCue(cue, 'ogre_sledge_hauler')).toBe(true);
    expect(isHaulerEnrageCue(cue, 'drowned_pilgrim')).toBe(false);
    expect(isHaulerEnrageCue({ ...cue, targetId: 8 }, 'ogre_sledge_hauler')).toBe(false);
    expect(isHaulerEnrageCue({ ...cue, ability: 'x' }, 'ogre_sledge_hauler')).toBe(false);
    expect(isHaulerEnrageCue({ ...cue, school: 'frost' }, 'ogre_sledge_hauler')).toBe(false);
    expect(MOBS.ogre_sledge_hauler?.enrage?.belowHpPct).toBe(0.3);
    // The cue is only unambiguous while the enrage is the template's one
    // self-targeted fire nova with no ability (mob/boss_mechanics.ts).
    const t = MOBS.ogre_sledge_hauler as unknown as Record<string, unknown>;
    for (const other of ['mendAlly', 'wardAllies', 'rally', 'warcry', 'desperateHeal'])
      expect(t[other], other).toBeUndefined();
  });
});

describe('the Glacier Splinter', () => {
  it('ships its own body with Fracture and Shatter clips', () => {
    expect(clipsOf(`public/${GLACIER_SPLINTER_BODY.url}`)).toEqual(
      [
        'Attack',
        'Attack2',
        'CombatIdle',
        'Death',
        'Fracture',
        'Hit',
        'Idle',
        'Run',
        'Shatter',
        'Walk',
      ].sort(),
    );
    expectShipped(GLACIER_SPLINTER_BODY.url);
    expect(visualOf('glacier_splinter').url).toBe(GLACIER_SPLINTER_BODY.url);
    // Its pale baked ice is graded to glacier blue on purpose.
    expectDrawnAtRow('glacier_splinter', true);
    expect(visualOf('glacier_splinter').tintStrength).toBeLessThan(0.5);
  });

  it('both halves of a Fracture stagger, and each half is drawn at the split scale', () => {
    const v = visualOf('glacier_splinter');
    const split = MOBS.glacier_splinter?.trashKit?.split;
    expect(split?.scale).toBe(0.72);
    // The original plays Fracture on the split; the copy plays it as its entrance.
    expect(v.clips.attackByAbility?.[SPLINTER_FRACTURE_GESTURE]).toBe('Fracture');
    expect(v.clips.entrance).toBe('Fracture');
    expect(v.entranceGesture).toBe(SPLINTER_COPY_GESTURE);
    expect(v.oneShotsHoldAttacks).toContain('Fracture');
    // A half is the same body at the entity scale the sim gives it (the view
    // group carries e.scale): 72 percent of the template's drawn row.
    const scale = MOBS.glacier_splinter?.scale ?? 1;
    expect(v.height * scale * (split?.scale ?? 1)).toBeCloseTo(
      SANCTUM_DRAWN_HEIGHTS.glacier_splinter * 0.72,
      6,
    );
    expect(v.height * scale * 0.72).toBeGreaterThan(2.6 * 1.4);
  });

  it('kneels to the Shatter fuse and hides whole when it bursts', () => {
    const v = visualOf('glacier_splinter');
    const delay = MOBS.glacier_splinter?.trashKit?.deathBurst?.delay ?? 0;
    expect(delay).toBe(2);
    expect(v.deathTimeScale).toBeCloseTo(GLACIER_SPLINTER_CLIP.deathFlare / delay, 9);
    expect(v.meshToggles).toEqual([{ nodes: ['*'], hideNow: SPLINTER_SHATTERED_GESTURE }]);
  });
});

describe('the kit fx offer each entrance off its own cue', () => {
  type Mob = {
    id: number;
    kind: 'mob';
    templateId: string;
    dead: boolean;
    inCombat: boolean;
    pos: { x: number; y: number; z: number };
    facing: number;
    scale: number;
    castingAbility: string | null;
  };
  const mob = (id: number, templateId: string, inCombat = false): Mob => ({
    id,
    kind: 'mob',
    templateId,
    dead: false,
    inCombat,
    pos: { x: 0, y: 0, z: 0 },
    facing: 0,
    scale: 1,
    castingAbility: null,
  });

  function rig(mobs: Mob[]) {
    const gestures: [number, string][] = [];
    const entities = new Map(mobs.map((m) => [m.id, m]));
    const host = {
      root: new THREE.Group(),
      kit: {},
      density: 1,
      uTime: { value: 0 },
      groundY: () => 0,
      puff: () => {},
      shockRing: () => {},
      rand: () => 0.5,
      reducedMotion: () => true,
      shake: () => {},
      gesture: (id: number, g: string) => gestures.push([id, g]),
      shards: { burst: () => {} },
    };
    const fx = new SanctumKitFx(host as never, { entities } as never);
    return { fx, gestures, entities };
  }

  it('raises a Thaw the Held walker off the rite landing, and no walker on mere sight', () => {
    const walker = mob(7, 'raised_bonewalker', true);
    const corpse = mob(3, 'sanctum_boneguard');
    const { fx, gestures } = rig([walker, corpse]);
    fx.update(0.1, 1);
    fx.scanMob(walker as never);
    expect(gestures).toEqual([]);
    fx.handleEvent(
      {
        type: 'spellfx',
        sourceId: 3,
        targetId: 7,
        school: 'shadow',
        fx: 'nova',
        ability: SANCTUM_THAW_THE_HELD,
      } as never,
      corpse as never,
    );
    expect(gestures).toContainEqual([7, BONEWALKER_RISE_GESTURE]);
    // Re-offered until the window closes (a late view still rises once).
    gestures.length = 0;
    fx.update(0.1, 1 + BONEWALKER_RISE_WINDOW * 0.5);
    expect(gestures).toEqual([[7, BONEWALKER_RISE_GESTURE]]);
    gestures.length = 0;
    fx.update(0.1, 1 + BONEWALKER_RISE_WINDOW + 0.2);
    expect(gestures).toEqual([]);
  });

  it("raises Velkhar's adds on first sight only while he fights", () => {
    const velkhar = mob(1, 'grand_necromancer_velkhar', true);
    const walker = mob(9, 'raised_bonewalker', true);
    const { fx, gestures } = rig([velkhar, walker]);
    fx.update(0.1, 5);
    fx.scanMob(walker as never);
    expect(gestures).toEqual([[9, BONEWALKER_RISE_GESTURE]]);
    // Judged once: a later scan of the same walker offers nothing new.
    gestures.length = 0;
    fx.update(0.1, 10);
    fx.scanMob(walker as never);
    expect(gestures).toEqual([]);
  });

  it('staggers both Fracture halves, each copy kept on offer on its own', () => {
    const a = mob(20, 'glacier_splinter', true);
    const copyA = mob(21, 'glacier_splinter', true);
    const b = mob(30, 'glacier_splinter', true);
    const copyB = mob(31, 'glacier_splinter', true);
    const { fx, gestures } = rig([a, copyA, b, copyB]);
    fx.update(0.1, 2);
    const split = (src: Mob, copy: Mob) =>
      fx.handleEvent(
        {
          type: 'spellfx',
          sourceId: src.id,
          targetId: copy.id,
          school: 'frost',
          fx: 'nova',
          ability: SANCTUM_FRACTURE,
        } as never,
        src as never,
      );
    split(a, copyA);
    split(b, copyB);
    expect(gestures).toContainEqual([20, SPLINTER_FRACTURE_GESTURE]);
    expect(gestures).toContainEqual([30, SPLINTER_FRACTURE_GESTURE]);
    gestures.length = 0;
    fx.update(0.1, 2.1);
    expect(gestures).toContainEqual([21, SPLINTER_COPY_GESTURE]);
    expect(gestures).toContainEqual([31, SPLINTER_COPY_GESTURE]);
  });
});
