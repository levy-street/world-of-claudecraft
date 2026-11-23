// The Gravewyrm Sanctum's encounter alert (src/ui/hud/dungeon/
// sanctum_alert_view.ts) and its scene scan (sanctum_alert_scene_core.ts), plus
// the boss aura tooltips (src/ui/sanctum_aura_effect.ts). The view reads only
// what the sim mirrors (casts with their target and locked facing, auras,
// encounter objects whose template id carries their state), so these drive it
// with plain literals keyed on the id contract (boss_ids.ts).

import { describe, expect, it } from 'vitest';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { SEAL_PILLARS } from '../src/sim/content/gravewyrm_sanctum_layout';
import {
  BONEWALKER_ID,
  KORGATH_BELLOW,
  KORGATH_CHAIN_FLAIL,
  KORGATH_ENRAGE,
  KORGATH_ID,
  KORGATH_LOCKBOUND,
  KORGATH_MAUL_ARC,
  KORGATH_STOMP,
  KORGATH_STRAIN,
  KORGATH_THRESHOLD_CHARGE,
  KORGATH_TUNING,
  KORZUL_AIRBORNE,
  KORZUL_CRASHING_DESCENT,
  KORZUL_DOUSED,
  KORZUL_GRAVE_BREATH,
  KORZUL_GRAVE_INFERNO,
  KORZUL_ID,
  KORZUL_PLUNGING_FIRE,
  KORZUL_SHARD_FLARE,
  KORZUL_TAIL_SWEEP,
  KORZUL_TUNING,
  KORZUL_WYRMS_EYE,
  plateTemplate,
  SANCTUM_LANDING_SHADOW,
  SANCTUM_PLUNGING_FIRE,
  SANCTUM_QUENCH_WATER,
  SANCTUM_TRENCH_LANE,
  SEAL_TOOLS,
  sealChainTemplate,
  VELKHAR_GRASP,
  VELKHAR_ID,
  VELKHAR_SOULFIRE_TRENCH,
  VELKHAR_TUNING,
  VELKHAR_TWICE_WOKEN,
} from '../src/sim/encounters/gravewyrm_sanctum/ids';
import { SANCTUM_BRANDED, SANCTUM_ICE_SLAB } from '../src/sim/mob/trash_kit/sanctum_cast_ids';
import type { AuraKind } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import {
  SanctumAlertSceneScan,
  type SanctumSceneEntity,
} from '../src/ui/hud/dungeon/sanctum_alert_scene_core';
import {
  buildSanctumAlertView,
  EMPTY_SANCTUM_SCENE,
  SANCTUM_ALERT_KINDS,
  type SanctumAlertEntity,
  type SanctumAlertInput,
  type SanctumAlertScene,
  SLAB_HINT_RANGE,
  SLAB_HINT_SECONDS,
} from '../src/ui/hud/dungeon/sanctum_alert_view';
import { setLanguage, t } from '../src/ui/i18n';

setLanguage('en');

const ME = 1;
const OTHER = 2;
/** An instance origin far from zero, so the pillar maths is exercised. */
const O = { x: 1000, z: 3000 };

function input(over: Partial<SanctumAlertInput> = {}, scene: Partial<SanctumAlertScene> = {}) {
  const ents = new Map<number, SanctumAlertEntity>();
  const all = { ...EMPTY_SANCTUM_SCENE, ...scene };
  for (const e of [all.korgath, all.velkhar, all.korzul, ...all.bonewalkers])
    if (e?.id !== undefined) ents.set(e.id, e);
  return {
    selfId: ME,
    selfPos: { x: 0, z: 0 },
    auras: [],
    targetId: null,
    entity: (id: number) => ents.get(id) ?? null,
    scene: all,
    ...over,
  } satisfies SanctumAlertInput;
}

function kind(over: Partial<SanctumAlertInput> = {}, scene: Partial<SanctumAlertScene> = {}) {
  const v = buildSanctumAlertView(input(over, scene));
  return v.visible ? v.kind : 'hidden';
}

const korgath = (over: Partial<SanctumAlertEntity> = {}): SanctumAlertEntity => ({
  id: 10,
  templateId: KORGATH_ID,
  pos: { x: 0, z: 0 },
  facing: 0,
  auras: [],
  castingAbility: null,
  castRemaining: 0,
  castTotal: 0,
  aggroTargetId: OTHER,
  inCombat: true,
  ...over,
});
const velkhar = (over: Partial<SanctumAlertEntity> = {}): SanctumAlertEntity => ({
  ...korgath(),
  id: 11,
  templateId: VELKHAR_ID,
  ...over,
});
const korzul = (over: Partial<SanctumAlertEntity> = {}): SanctumAlertEntity => ({
  ...korgath(),
  id: 12,
  templateId: KORZUL_ID,
  ...over,
});
const casting = (id: string, target: number | null = null) => ({
  castingAbility: id,
  castTargetId: target,
  castRemaining: 1,
  castTotal: 2,
});
const plate = (id: number, x: number, z: number, tpl: string): SanctumAlertEntity => ({
  id,
  kind: 'object',
  templateId: tpl,
  pos: { x, z },
  scale: 8,
});

describe('the Sanctum alert view', () => {
  it('hides outside any Sanctum mechanic (the empty scene, no marks)', () => {
    expect(buildSanctumAlertView(input()).visible).toBe(false);
    // An unrelated aura and a target that is not a Sanctum body stay quiet too.
    expect(kind({ auras: [{ id: 'some_other_aura' }], targetId: 99 })).toBe('hidden');
  });

  it('every kind is listed for the painter', () => {
    expect(new Set(SANCTUM_ALERT_KINDS).size).toBe(SANCTUM_ALERT_KINDS.length);
    expect(SANCTUM_ALERT_KINDS).toContain('lockbound');
  });

  it('the quench-water says swim out', () => {
    const v = buildSanctumAlertView(input({ auras: [{ id: SANCTUM_QUENCH_WATER }] }));
    expect(v.visible && v.kind).toBe('quench');
    expect(v.visible && v.title).toBe(t('hudChrome.sanctumAlert.quenchTitle'));
    expect(v.visible && v.line).toBe(t('hudChrome.sanctumAlert.quenchLine'));
  });

  it("Korgath's lanes warn the player they aim at, or one standing in them, never anyone else", () => {
    for (const [id, k] of [
      [KORGATH_CHAIN_FLAIL, 'flail'],
      [KORGATH_THRESHOLD_CHARGE, 'charge'],
    ] as const) {
      // Aimed at me from far away: still mine.
      expect(kind({ selfPos: { x: 50, z: 50 } }, { korgath: korgath(casting(id, ME)) })).toBe(k);
      // Aimed at the other player down +Z; I stand in the lane.
      expect(kind({ selfPos: { x: 0.5, z: 12 } }, { korgath: korgath(casting(id, OTHER)) })).toBe(
        k,
      );
      // Aimed at the other player; I stand well off to the side.
      expect(kind({ selfPos: { x: 12, z: 12 } }, { korgath: korgath(casting(id, OTHER)) })).toBe(
        'hidden',
      );
    }
    const v = buildSanctumAlertView(
      input({}, { korgath: korgath(casting(KORGATH_CHAIN_FLAIL, ME)) }),
    );
    expect(v.visible && v.progress).toBe(0.5);
  });

  it('Strain warns only near an INTACT pillar, using the layout through the chain object', () => {
    const chains = SEAL_TOOLS.map((tool, i) => ({
      id: 100 + i,
      kind: 'object',
      templateId: sealChainTemplate(tool, tool === 'hammer' ? 'broken' : 'intact'),
      pos: { x: O.x + SEAL_PILLARS[i].shackle.x, z: O.z + SEAL_PILLARS[i].shackle.z },
    }));
    const boss = korgath({ ...casting(KORGATH_STRAIN), pos: { x: O.x, z: O.z - 22 } });
    const at = (i: number) => ({ x: O.x + SEAL_PILLARS[i].x, z: O.z + SEAL_PILLARS[i].z });
    // At the Tongs pillar (intact): warned.
    expect(kind({ selfPos: at(1) }, { korgath: boss, chains })).toBe('strain');
    // At the Hammer pillar (broken): no ring there.
    expect(kind({ selfPos: at(0) }, { korgath: boss, chains })).toBe('hidden');
    // Beyond the ring of an intact pillar: quiet.
    const far = at(2);
    far.x += KORGATH_TUNING.strainRadius + 5;
    expect(kind({ selfPos: far }, { korgath: boss, chains })).toBe('hidden');
  });

  it('Stomp, Maul Arc, Inferno, Breath and Tail each warn only inside their reach', () => {
    expect(kind({ selfPos: { x: 0, z: 5 } }, { korgath: korgath(casting(KORGATH_STOMP)) })).toBe(
      'stomp',
    );
    expect(kind({ selfPos: { x: 0, z: 20 } }, { korgath: korgath(casting(KORGATH_STOMP)) })).toBe(
      'hidden',
    );
    // Maul Arc: in front (+Z) yes, behind no; the tank it faces is not told.
    expect(kind({ selfPos: { x: 2, z: 4 } }, { korgath: korgath(casting(KORGATH_MAUL_ARC)) })).toBe(
      'maul',
    );
    expect(
      kind({ selfPos: { x: 0, z: -4 } }, { korgath: korgath(casting(KORGATH_MAUL_ARC)) }),
    ).toBe('hidden');
    expect(
      kind(
        { selfPos: { x: 0, z: 4 } },
        { korgath: korgath({ ...casting(KORGATH_MAUL_ARC), aggroTargetId: ME }) },
      ),
    ).toBe('hidden');
    expect(
      kind({ selfPos: { x: 0, z: 10 } }, { korzul: korzul(casting(KORZUL_GRAVE_INFERNO)) }),
    ).toBe('inferno');
    expect(
      kind(
        { selfPos: { x: 0, z: KORZUL_TUNING.infernoRadius + 6 } },
        {
          korzul: korzul(casting(KORZUL_GRAVE_INFERNO)),
        },
      ),
    ).toBe('hidden');
    expect(
      kind({ selfPos: { x: 2, z: 20 } }, { korzul: korzul(casting(KORZUL_GRAVE_BREATH)) }),
    ).toBe('breath');
    expect(
      kind(
        { selfPos: { x: 0, z: 5 } },
        { korzul: korzul({ ...casting(KORZUL_GRAVE_BREATH), aggroTargetId: ME }) },
      ),
    ).toBe('hidden');
    expect(kind({ selfPos: { x: 0, z: -8 } }, { korzul: korzul(casting(KORZUL_TAIL_SWEEP)) })).toBe(
      'tail',
    );
    expect(kind({ selfPos: { x: 0, z: 8 } }, { korzul: korzul(casting(KORZUL_TAIL_SWEEP)) })).toBe(
      'hidden',
    );
  });

  it("the Foreman's Bellow (unavoidable) raises no alert", () => {
    expect(kind({ selfPos: { x: 0, z: 2 } }, { korgath: korgath(casting(KORGATH_BELLOW)) })).toBe(
      'hidden',
    );
  });

  it("Velkhar's trench warns its target and anyone in the painted lane", () => {
    const lane: SanctumAlertEntity = {
      id: 300,
      kind: 'object',
      templateId: SANCTUM_TRENCH_LANE,
      pos: { x: 0, z: 0 },
      facing: Math.PI / 2,
      scale: VELKHAR_TUNING.trenchLength,
    };
    const v = velkhar(casting(VELKHAR_SOULFIRE_TRENCH, OTHER));
    expect(kind({ selfPos: { x: 20, z: 0.5 } }, { velkhar: v, trenches: [lane] })).toBe('trench');
    expect(kind({ selfPos: { x: 20, z: 9 } }, { velkhar: v, trenches: [lane] })).toBe('hidden');
    expect(
      kind(
        { selfPos: { x: 99, z: 99 } },
        { velkhar: velkhar(casting(VELKHAR_SOULFIRE_TRENCH, ME)) },
      ),
    ).toBe('trench');
  });

  it('a Bonewalker in meltwater: the tank drags it out, the damage dealer holds', () => {
    const wet: SanctumAlertEntity = {
      id: 400,
      templateId: BONEWALKER_ID,
      aggroTargetId: ME,
      auras: [{ id: VELKHAR_GRASP }],
    };
    expect(kind({}, { bonewalkers: [wet] })).toBe('meltwater');
    const onOther = { ...wet, aggroTargetId: OTHER };
    expect(kind({}, { bonewalkers: [onOther] })).toBe('hidden');
    expect(kind({ targetId: 400 }, { bonewalkers: [onOther] })).toBe('meltwater-target');
    const dry = { ...onOther, auras: [] };
    expect(kind({ targetId: 400 }, { bonewalkers: [dry] })).toBe('hidden');
  });

  it('the lake: the Eye reads the plate under you, the fire and the shadow say leave', () => {
    const sound = plate(500, 0, 0, plateTemplate('sound'));
    const cracked = plate(501, 16, 0, plateTemplate('cracked', 6));
    const plates = [sound, cracked];
    const eye = { id: KORZUL_WYRMS_EYE, remaining: 2, duration: 4 };
    expect(kind({ auras: [eye], selfPos: { x: 1, z: 0 } }, { plates, korzul: korzul() })).toBe(
      'eye',
    );
    expect(kind({ auras: [eye], selfPos: { x: 15, z: 0 } }, { plates, korzul: korzul() })).toBe(
      'eye-cracked',
    );
    // Plunging Fire on the plate I stand on (its fire object covers the plate).
    const fire: SanctumAlertEntity = {
      id: 600,
      kind: 'object',
      templateId: SANCTUM_PLUNGING_FIRE,
      pos: { x: 16, z: 0 },
      scale: 8,
    };
    const pouring = korzul({ ...casting(KORZUL_PLUNGING_FIRE, 600), auras: [] });
    const v = buildSanctumAlertView(
      input({ selfPos: { x: 18, z: 2 } }, { plates, fires: [fire], korzul: pouring }),
    );
    expect(v.visible && v.kind).toBe('plunge');
    expect(v.visible && v.progress).toBe(0.5);
    expect(kind({ selfPos: { x: 1, z: 0 } }, { plates, fires: [fire], korzul: pouring })).toBe(
      'hidden',
    );
    const shadow: SanctumAlertEntity = {
      id: 700,
      kind: 'object',
      templateId: SANCTUM_LANDING_SHADOW,
      pos: { x: 0, z: 0 },
      scale: KORZUL_TUNING.descentRadius,
    };
    const landing = korzul(casting(KORZUL_CRASHING_DESCENT));
    expect(kind({ selfPos: { x: 5, z: 0 } }, { shadows: [shadow], korzul: landing })).toBe(
      'descent',
    );
    // Outside the shadow while he is airborne: the stack readout.
    const flying = korzul({ auras: [{ id: KORZUL_AIRBORNE }] });
    expect(kind({ selfPos: { x: 30, z: 0 } }, { shadows: [shadow], korzul: flying })).toBe(
      'flight',
    );
  });

  it('cracked ice under you reads its refreeze clock, and only in his fight', () => {
    const plates = [plate(500, 0, 0, plateTemplate('cracked', 5))];
    const v = buildSanctumAlertView(input({}, { plates, korzul: korzul() }));
    expect(v.visible && v.kind).toBe('cracked');
    expect(v.visible && v.progress).toBe(0.5);
    expect(kind({}, { plates, korzul: korzul({ inCombat: false }) })).toBe('hidden');
    const deep = [plate(500, 0, 0, plateTemplate('cracked', 'deep'))];
    const d = buildSanctumAlertView(input({}, { plates: deep, korzul: korzul() }));
    expect(d.visible && d.progress).toBe(null);
  });

  it('the Lockbound readout on a targeted Korgath counts the chains', () => {
    const boss = korgath({ auras: [{ id: KORGATH_LOCKBOUND, value: 0.6 }] });
    const v = buildSanctumAlertView(input({ targetId: 10 }, { korgath: boss }));
    expect(v.visible && v.kind).toBe('lockbound');
    expect(v.visible && v.line).toBe(
      t('hudChrome.sanctumAlert.lockboundLine', { chains: '3', pct: '60' }),
    );
    expect(kind({ targetId: null }, { korgath: boss })).toBe('hidden');
  });

  it('priority: quench over plunge over descent over the Eye over a lane over the readouts', () => {
    const eye = { id: KORZUL_WYRMS_EYE, remaining: 2, duration: 4 };
    const quench = { id: SANCTUM_QUENCH_WATER };
    const flailOnMe = korgath(casting(KORGATH_CHAIN_FLAIL, ME));
    expect(kind({ auras: [quench, eye] }, { korgath: flailOnMe })).toBe('quench');
    expect(kind({ auras: [eye] }, { korgath: flailOnMe })).toBe('eye');
    expect(
      kind(
        { targetId: 10 },
        { korgath: { ...flailOnMe, auras: [{ id: KORGATH_LOCKBOUND, value: 0.8 }] } },
      ),
    ).toBe('flail');
  });
});

describe('the Sanctum alert scene scan', () => {
  it('rescans only when the roster changes and reads live templates', () => {
    const entities = new Map<number, SanctumSceneEntity>();
    const p: SanctumSceneEntity = {
      id: 1,
      kind: 'object',
      templateId: plateTemplate('sound'),
      pos: { x: 0, z: 0 },
    };
    entities.set(1, p);
    entities.set(2, { id: 2, kind: 'mob', templateId: KORZUL_ID, pos: { x: 0, z: 0 } });
    entities.set(3, { id: 3, kind: 'object', templateId: sealChainTemplate('anvil', 'intact') });
    entities.set(4, { id: 4, kind: 'mob', templateId: 'some_trash' });
    const scan = new SanctumAlertSceneScan();
    const s1 = scan.update({ entities, entityRosterVersion: 1 });
    expect(s1.plates.length).toBe(1);
    expect(s1.chains.length).toBe(1);
    expect(s1.korzul?.id).toBe(2);
    expect(s1.korgath).toBe(null);
    // A plate cracking changes its template, not the roster: the kept reference reads it.
    p.templateId = plateTemplate('cracked', 10);
    const s2 = scan.update({ entities, entityRosterVersion: 1 });
    expect(s2).toBe(s1);
    expect(s2.plates[0].templateId).toBe(plateTemplate('cracked', 10));
    entities.delete(1);
    expect(scan.update({ entities, entityRosterVersion: 2 }).plates.length).toBe(0);
  });
});

describe('the Sanctum boss aura tooltips say the live rule', () => {
  const describeAura = (id: string, kind: AuraKind, value = 0) =>
    auraEffectDescriptor({ id, kind, value });

  it('every boss aura has its own line', () => {
    for (const id of [
      KORGATH_LOCKBOUND,
      KORGATH_ENRAGE,
      VELKHAR_GRASP,
      VELKHAR_TWICE_WOKEN,
      KORZUL_DOUSED,
      KORZUL_AIRBORNE,
      KORZUL_WYRMS_EYE,
      SANCTUM_QUENCH_WATER,
      KORZUL_SHARD_FLARE,
    ]) {
      const d = describeAura(id, 'buff_dmg_done', 0.3);
      expect(d?.key.startsWith('hudChrome.auraEffect.sanctum.')).toBe(true);
    }
  });

  it('the numbers are the tuning the sim reads, heroic included', () => {
    const lock = describeAura(KORGATH_LOCKBOUND, 'buff_dr', 0.6);
    expect(lock?.nums).toEqual({ pct: 60, per: 20 });
    expect(describeAura(KORGATH_ENRAGE, 'buff_dmg_done', 0.5)?.nums).toEqual({ pct: 50 });
    expect(describeAura(VELKHAR_GRASP, 'buff_dmg_done', 0.3)?.nums).toEqual({
      pct: Math.round(VELKHAR_TUNING.graspDamage * 100),
      seconds: VELKHAR_TUNING.riseDelay,
    });
    const mult =
      HEROIC_DUNGEON_TUNING.gravewyrm_sanctum?.mechanicDamageMultiplierByMob?.[KORZUL_ID] ?? 1;
    expect(describeAura(KORZUL_WYRMS_EYE, 'slow', 0)?.nums).toEqual({
      min: KORZUL_TUNING.plungeMin,
      max: KORZUL_TUNING.plungeMax,
      heroicMin: Math.round(KORZUL_TUNING.plungeMin * mult),
      heroicMax: Math.round(KORZUL_TUNING.plungeMax * mult),
    });
    expect(describeAura(SANCTUM_QUENCH_WATER, 'slow', 0.5)?.nums).toEqual({
      slow: 50,
      damage: KORZUL_TUNING.quenchPerSecond,
      heroic: KORZUL_TUNING.quenchPerSecondHeroic,
    });
    // Every key renders with its numbers spliced in (no raw tokens left).
    for (const id of [
      KORZUL_AIRBORNE,
      KORZUL_WYRMS_EYE,
      SANCTUM_QUENCH_WATER,
      KORZUL_SHARD_FLARE,
    ]) {
      const d = describeAura(id, 'slow', 0.5);
      const text = t(d?.key as Parameters<typeof t>[0], d?.nums as Record<string, number>);
      expect(text).not.toMatch(/\{[a-zA-Z]+\}/);
    }
  });
});

describe("the Ice Slab cover hint (the playtest: what is the ogre's block for?)", () => {
  const slab = (id: number, x: number, z: number) => ({
    id,
    kind: 'object',
    templateId: SANCTUM_ICE_SLAB,
    pos: { x, z },
  });

  it('a fresh slab near you says it blocks line of sight, for its first seconds only', () => {
    const entities = new Map<number, SanctumSceneEntity>();
    entities.set(7, slab(7, 6, 0));
    const scan = new SanctumAlertSceneScan();
    const scene = scan.update({ entities, entityRosterVersion: 1 }, 100);
    expect(scene.slabs).toHaveLength(1);
    expect(scene.slabBorn).toEqual([100]);
    const v = buildSanctumAlertView(input({ now: 101 }, scene));
    expect(v.visible && v.kind).toBe('slab');
    if (!v.visible) throw new Error('hidden');
    expect(v.title).toBe(t('hudChrome.sanctumAlert.slabTitle'));
    expect(v.line).toBe(t('hudChrome.sanctumAlert.slabLine'));
    expect(v.line.toLowerCase()).toContain('line of sight');
    expect(v.progress).toBeCloseTo(1 - 1 / SLAB_HINT_SECONDS, 6);
    // Past its moment, out of reach, or with no clock: quiet.
    expect(kind({ now: 100 + SLAB_HINT_SECONDS + 0.1 }, scene)).toBe('hidden');
    expect(kind({ now: 101, selfPos: { x: SLAB_HINT_RANGE + 7, z: 0 } }, scene)).toBe('hidden');
    expect(kind({}, scene)).toBe('hidden');
    // The stamp is the slab's first sight: a later roster change keeps it.
    entities.set(8, slab(8, -4, 2));
    const later = scan.update({ entities, entityRosterVersion: 2 }, 103);
    expect(later.slabBorn).toEqual([100, 103]);
    // A shattered slab is forgotten.
    entities.delete(7);
    expect(scan.update({ entities, entityRosterVersion: 3 }, 104).slabBorn).toEqual([103]);
  });

  it('every danger outranks it (it is a hint, never a warning)', () => {
    const entities = new Map<number, SanctumSceneEntity>();
    entities.set(7, slab(7, 3, 0));
    const scene = new SanctumAlertSceneScan().update({ entities, entityRosterVersion: 1 }, 50);
    expect(kind({ now: 51 }, scene)).toBe('slab');
    expect(
      kind({ now: 51, auras: [{ id: SANCTUM_BRANDED, remaining: 5, duration: 9 }] }, scene),
    ).toBe('branded');
    expect(SANCTUM_ALERT_KINDS).toContain('slab');
  });
});
