// The Sledge Tusker's part of the Gravewyrm Sanctum alert (src/ui/hud/dungeon/
// sanctum_tusker_alert_view.ts, called by sanctum_alert_view.ts) and its aura
// tooltips (src/ui/sanctum_aura_effect.ts): the bait rework taught on the
// shared encounter alert family. The view reads only what the sim mirrors (the
// Tusker's Trample bar and locked facing, its Stuck in the Ice aura, the ice
// outcrop, soulfire trail and patch objects), so these drive it with plain
// literals on the real road.

import { describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  SANCTUM_ICE_OUTCROP,
  SANCTUM_ICE_OUTCROP_BROKEN,
  SANCTUM_SOULFIRE_PATCH,
  SANCTUM_SOULFIRE_TRAIL,
  SLEDGE_TUSKER_ID,
  TUSKER_TUNING as T,
  TUSKER_OUTCROPS,
  TUSKER_STUCK,
  TUSKER_STUCK_EXPOSED,
  TUSKER_TRAMPLE,
} from '../src/sim/encounters/gravewyrm_sanctum/ids';
import { planTrampleLane } from '../src/sim/encounters/gravewyrm_sanctum/tusker_road';
import {
  planTrampleLaneWorld,
  sanctumOriginAt,
} from '../src/sim/encounters/gravewyrm_sanctum/tusker_road_world';
import { SANCTUM_BRANDED } from '../src/sim/mob/trash_kit/sanctum_cast_ids';
import type { AuraKind } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { castDisplayName } from '../src/ui/cast_display_name';
import {
  DUNGEON_PROMPT_ADVISORY,
  dungeonPromptEnabled,
} from '../src/ui/hud/dungeon/dungeon_prompt_policy_core';
import {
  SanctumAlertSceneScan,
  type SanctumSceneEntity,
} from '../src/ui/hud/dungeon/sanctum_alert_scene_core';
import {
  buildSanctumAlertView,
  SANCTUM_ALERT_KINDS,
  type SanctumAlertInput,
  type SanctumAlertScene,
} from '../src/ui/hud/dungeon/sanctum_alert_view';
import {
  buildTuskerAlert,
  inRoadFire,
  TUSKER_ALERT_KINDS,
  TUSKER_HINT_SECONDS,
} from '../src/ui/hud/dungeon/sanctum_tusker_alert_view';
import { setLanguage, t } from '../src/ui/i18n';

setLanguage('en');

/** The first Sanctum instance's origin: the alert plans the lane in the
 *  world, from the slot the Tusker's z names. */
const O = instanceOrigin(DUNGEONS.gravewyrm_sanctum.index, 0);
const W = (p: { x: number; z: number }) => ({ x: O.x + p.x, z: O.z + p.z });

/** A spot on the Sledge Road's middle leg (`s` yards down its centre line,
 *  `side` yards toward the rim the fourth outcrop stands on). */
function leg(s: number, side = 0): { x: number; z: number } {
  const d = Math.hypot(42, 21.8);
  const ux = 42 / d;
  const uz = 21.8 / d;
  return { x: -26 + ux * s + uz * side, z: -137.9 + uz * s - ux * side };
}

const MID = leg(8);
const BEHIND = leg(27.5, 4.5);
const YAW = Math.atan2(BEHIND.x - MID.x, BEHIND.z - MID.z);

const tusker = (over: Partial<SanctumSceneEntity> = {}): SanctumSceneEntity => ({
  id: 20,
  kind: 'mob',
  templateId: SLEDGE_TUSKER_ID,
  pos: W(MID),
  facing: YAW,
  auras: [],
  castingAbility: null,
  castRemaining: 0,
  castTotal: 0,
  inCombat: true,
  ...over,
});

const outcrops = (broken: readonly number[] = []): SanctumSceneEntity[] =>
  TUSKER_OUTCROPS.map((spot, i) => ({
    id: 30 + i,
    kind: 'object',
    templateId: broken.includes(i) ? SANCTUM_ICE_OUTCROP_BROKEN : SANCTUM_ICE_OUTCROP,
    pos: W(spot),
    scale: T.outcropRadius,
  }));

function scan(entities: SanctumSceneEntity[], now = 100): SanctumAlertScene {
  const map = new Map<number, SanctumSceneEntity>();
  for (const e of entities) if (e.id !== undefined) map.set(e.id, e);
  return new SanctumAlertSceneScan().update({ entities: map, entityRosterVersion: 1 }, now);
}

function view(scene: SanctumAlertScene, at: { x: number; z: number }, over = {}) {
  const input: SanctumAlertInput = {
    selfId: 1,
    selfPos: W(at),
    auras: [],
    targetId: null,
    entity: () => null,
    scene,
    now: 100,
    ...over,
  };
  return buildSanctumAlertView(input);
}

function kindAt(scene: SanctumAlertScene, at: { x: number; z: number }, over = {}): string {
  const v = view(scene, at, over);
  return v.visible ? v.kind : 'hidden';
}

const trampling = { castingAbility: TUSKER_TRAMPLE, castRemaining: 1.5, castTotal: 2 };

describe('the lane the alert reads is the lane the sim plans', () => {
  it('plans in the world from mirrored bodies exactly what the encounter plans locally', () => {
    expect(sanctumOriginAt(O.z + MID.z)).toEqual({ x: O.x, z: O.z });
    const local = TUSKER_OUTCROPS.map((s, i) => ({ id: 30 + i, x: s.x, z: s.z }));
    const world = local.map((s) => ({ id: s.id, ...W(s) }));
    const a = planTrampleLane(MID.x, MID.z, YAW, local);
    const b = planTrampleLaneWorld(O.x + MID.x, O.z + MID.z, YAW, world);
    expect(b.outcropId).toBe(33);
    expect(b.outcropId).toBe(a.outcropId);
    expect(b.length).toBeCloseTo(a.length, 6);
    expect(b.reach).toBeCloseTo(a.reach, 6);
    expect(b.x).toBe(O.x + MID.x);
    expect(b.z).toBe(O.z + MID.z);
  });
});

describe("the Tusker's alert", () => {
  it('is part of the Sanctum alert, which is advisory: the hints setting hides it', () => {
    for (const k of TUSKER_ALERT_KINDS) expect(SANCTUM_ALERT_KINDS).toContain(k);
    expect(DUNGEON_PROMPT_ADVISORY.sanctum).toBe(true);
    expect(dungeonPromptEnabled('sanctum', false)).toBe(false);
    expect(dungeonPromptEnabled('sanctum', true)).toBe(true);
  });

  it('standing in the painted lane: Trample, with the bar', () => {
    const scene = scan([tusker(trampling), ...outcrops()]);
    const inLane = { x: MID.x + Math.sin(YAW) * 8, z: MID.z + Math.cos(YAW) * 8 };
    const v = view(scene, inLane);
    if (!v.visible) throw new Error('hidden');
    expect(v.kind).toBe('trample');
    expect(v.title).toBe(t('hudChrome.sanctumAlert.trampleTitle'));
    expect(v.line).toBe(t('hudChrome.sanctumAlert.trampleLine'));
    expect(v.progress).toBeCloseTo(0.75, 6);
    expect(v.pressable).toBe(false);
  });

  it('a lane that ends in an outcrop: the player behind it is told it will stick, not to run', () => {
    const scene = scan([tusker(trampling), ...outcrops()]);
    const v = view(scene, BEHIND);
    if (!v.visible) throw new Error('hidden');
    expect(v.kind).toBe('trample-bait');
    expect(v.title).toBe(t('hudChrome.sanctumAlert.trampleBaitTitle'));
    expect(v.line).toBe(t('hudChrome.sanctumAlert.trampleBaitLine'));
    expect(v.line.toLowerCase()).toContain('ice outcrop');
    // Well off to the side, the same.
    expect(kindAt(scene, leg(14, -5))).toBe('trample-bait');
  });

  it('the same stance behind a BROKEN outcrop is in the lane: the stump is no shelter', () => {
    const scene = scan([tusker(trampling), ...outcrops([3])]);
    expect(kindAt(scene, BEHIND)).toBe('trample');
  });

  it('the Trample target while its lane still follows them: lead it into the ice, then step aside', () => {
    // The wind-up has just opened on me (selfId 1).
    const aiming = {
      castingAbility: TUSKER_TRAMPLE,
      castRemaining: T.trampleCast - 0.05,
      castTotal: T.trampleCast,
      castTargetId: 1,
    };
    const scene = scan([tusker(aiming), ...outcrops()]);
    // Wherever I stand (in the lane, behind the ice, on open road): the lead.
    for (const at of [BEHIND, leg(12, 0), leg(14, -5)]) {
      const v = view(scene, at);
      if (!v.visible) throw new Error('hidden');
      expect(v.kind).toBe('trample-lead');
      expect(v.title).toBe(t('hudChrome.sanctumAlert.trampleTitle'));
      expect(v.line).toBe(t('hudChrome.sanctumAlert.trampleLeadLine'));
      expect(v.line).toBe('Lead the charge into an ice outcrop, then step aside');
      // Its bar counts down to the lock, not the charge.
      expect(v.progress).toBeCloseTo(
        (T.trampleCast - 0.05 - T.trampleLock) / (T.trampleCast - T.trampleLock),
        6,
      );
    }
    // Somebody else is its target: no lead for me (the lane rules as before).
    const theirs = scan([tusker({ ...aiming, castTargetId: 7 }), ...outcrops()]);
    expect(kindAt(theirs, BEHIND)).toBe('trample-bait');
    expect(kindAt(theirs, leg(12, 0))).toBe('trample');
  });

  it('once the lane locks its target is told to step out of it (or that it ends in the ice)', () => {
    const locked = {
      castingAbility: TUSKER_TRAMPLE,
      castRemaining: T.trampleLock - 0.1,
      castTotal: T.trampleCast,
      castTargetId: 1,
    };
    const scene = scan([tusker(locked), ...outcrops()]);
    expect(kindAt(scene, leg(12, 0))).toBe('trample');
    expect(kindAt(scene, BEHIND)).toBe('trample-bait');
  });

  it('the lead alert is part of the advisory Sanctum family (the hints setting hides it)', () => {
    expect(TUSKER_ALERT_KINDS[0]).toBe('trample-lead');
    expect(SANCTUM_ALERT_KINDS).toContain('trample-lead');
    const scene = scan([
      tusker({
        castingAbility: TUSKER_TRAMPLE,
        castRemaining: T.trampleCast,
        castTotal: T.trampleCast,
        castTargetId: 1,
      }),
      ...outcrops(),
    ]);
    expect(buildTuskerAlert(scene, W(BEHIND), 100, 1)?.kind).toBe('trample-lead');
    // Without knowing who I am it never claims I am the target.
    expect(buildTuskerAlert(scene, W(BEHIND), 100)?.kind).toBe('trample-bait');
  });

  it('with every outcrop spent there is nothing to lead it into: the target is told to step out', () => {
    const aiming = {
      castingAbility: TUSKER_TRAMPLE,
      castRemaining: T.trampleCast - 0.05,
      castTotal: T.trampleCast,
      castTargetId: 1,
    };
    const scene = scan([tusker(aiming), ...outcrops([0, 1, 2, 3, 4])]);
    expect(kindAt(scene, leg(12, 0))).toBe('trample');
    expect(kindAt(scene, BEHIND)).toBe('trample');
  });

  it('a plain lane says nothing to a player standing clear of it', () => {
    const down = Math.atan2(42, 21.8);
    const scene = scan([tusker({ ...trampling, pos: W(leg(4)), facing: down }), ...outcrops()]);
    expect(kindAt(scene, leg(12, -5), { now: 200 })).toBe('hidden');
    expect(kindAt(scene, leg(12, 0), { now: 200 })).toBe('trample');
  });

  it('Stuck in the Ice: the damage window, its bar the seconds left', () => {
    const stuck = tusker({
      auras: [
        { id: TUSKER_STUCK, remaining: 3, duration: T.stuckSeconds },
        { id: TUSKER_STUCK_EXPOSED, remaining: 3, duration: T.stuckSeconds },
      ],
    });
    const v = view(scan([stuck, ...outcrops()]), leg(2));
    if (!v.visible) throw new Error('hidden');
    expect(v.kind).toBe('stuck');
    expect(v.title).toBe(t('hudChrome.sanctumAlert.stuckTitle'));
    expect(v.line).toBe(t('hudChrome.sanctumAlert.stuckLine', { pct: '25' }));
    expect(v.line).toContain('25%');
    expect(v.progress).toBeCloseTo(3 / T.stuckSeconds, 6);
  });

  it('soulfire underfoot: a trail strip or a spilled patch, never the ground beside it', () => {
    const start = W(leg(4));
    const yaw = Math.atan2(42, 21.8);
    const trail: SanctumSceneEntity = {
      id: 50,
      kind: 'object',
      templateId: SANCTUM_SOULFIRE_TRAIL,
      pos: start,
      facing: yaw,
      scale: 20,
    };
    const patch: SanctumSceneEntity = {
      id: 51,
      kind: 'object',
      templateId: SANCTUM_SOULFIRE_PATCH,
      pos: W(leg(40, -3)),
      scale: T.patchRadius,
    };
    const scene = scan([tusker({ pos: W(leg(44)) }), trail, patch], 100);
    const v = view(scene, leg(12), { now: 200 });
    if (!v.visible) throw new Error('hidden');
    expect(v.kind).toBe('soulfire');
    expect(v.title).toBe(t('hudChrome.sanctumAlert.soulfireTitle'));
    expect(v.line).toBe(t('hudChrome.sanctumAlert.soulfireLine'));
    expect(kindAt(scene, leg(12, T.trailHalfWidth + 0.6), { now: 200 })).toBe('hidden');
    expect(kindAt(scene, leg(25), { now: 200 })).toBe('hidden');
    expect(kindAt(scene, leg(40, -3), { now: 200 })).toBe('soulfire');
    expect(inRoadFire([trail, patch], W(leg(12)))).toBe(true);
    expect(inRoadFire([trail, patch], W(leg(30)))).toBe(false);
    // The fire burns on after the Tusker falls: the alert still says so.
    const after = scan([tusker({ dead: true, inCombat: false }), trail], 100);
    expect(kindAt(after, leg(12), { now: 200 })).toBe('soulfire');
  });

  it('the lesson of the bait: the first seconds of a pull, while an outcrop stands', () => {
    const entities = new Map<number, SanctumSceneEntity>();
    const beast = tusker({ inCombat: false });
    entities.set(20, beast);
    for (const o of outcrops()) if (o.id !== undefined) entities.set(o.id, o);
    const world = { entities, entityRosterVersion: 1 };
    const s = new SanctumAlertSceneScan();
    // Before the pull: nothing.
    expect(s.update(world, 90).tuskerPulledAt).toBeNull();
    expect(kindAt(s.update(world, 95), leg(2), { now: 95 })).toBe('hidden');
    // The pull is no roster change: it is stamped the frame it is seen.
    beast.inCombat = true;
    const scene = s.update(world, 100);
    expect(scene.tuskerPulledAt).toBe(100);
    const v = view(scene, leg(2), { now: 102 });
    if (!v.visible) throw new Error('hidden');
    expect(v.kind).toBe('bait-hint');
    expect(v.title).toBe(t('hudChrome.sanctumAlert.baitHintTitle'));
    expect(v.line).toBe(t('hudChrome.sanctumAlert.baitHintLine', { pct: '25', seconds: '4' }));
    expect(v.progress).toBeCloseTo(1 - 2 / TUSKER_HINT_SECONDS, 6);
    expect(TUSKER_HINT_SECONDS).toBe(T.trampleFirst);
    // Gone once the first Trample is due, and with no clock.
    expect(kindAt(s.update(world, 110), leg(2), { now: 100 + TUSKER_HINT_SECONDS + 0.1 })).toBe(
      'hidden',
    );
    expect(kindAt(scene, leg(2), { now: undefined })).toBe('hidden');
    // A reset pull stamps afresh.
    beast.inCombat = false;
    expect(s.update(world, 120).tuskerPulledAt).toBeNull();
    beast.inCombat = true;
    expect(s.update(world, 130).tuskerPulledAt).toBe(130);
  });

  it('no lesson once every outcrop is a stump', () => {
    const scene = scan([tusker(), ...outcrops([0, 1, 2, 3, 4])], 100);
    expect(kindAt(scene, leg(2), { now: 101 })).toBe('hidden');
  });

  it('priority: the lane over soulfire over the stuck window over the bait over the lesson', () => {
    const yaw = YAW;
    const trail: SanctumSceneEntity = {
      id: 50,
      kind: 'object',
      templateId: SANCTUM_SOULFIRE_TRAIL,
      pos: W(MID),
      facing: yaw,
      scale: 12,
    };
    const inLane = { x: MID.x + Math.sin(yaw) * 6, z: MID.z + Math.cos(yaw) * 6 };
    const stuckAuras = [{ id: TUSKER_STUCK_EXPOSED, remaining: 2, duration: T.stuckSeconds }];
    // In the lane AND in fire: the lane.
    expect(kindAt(scan([tusker(trampling), trail, ...outcrops()]), inLane)).toBe('trample');
    // In fire while it is stuck: the fire.
    expect(kindAt(scan([tusker({ auras: stuckAuras }), trail, ...outcrops()]), inLane)).toBe(
      'soulfire',
    );
    // Stuck over the lesson.
    expect(kindAt(scan([tusker({ auras: stuckAuras }), ...outcrops()], 100), leg(2))).toBe('stuck');
    // Stuck over the bait: a stuck beast still wearing a Trample bar, the
    // player behind the outcrop its lane runs into.
    expect(kindAt(scan([tusker({ ...trampling, auras: stuckAuras }), ...outcrops()]), BEHIND)).toBe(
      'stuck',
    );
    // The bait over the lesson: a baited lane inside the lesson's window
    // (the same scene with no bar shows the lesson there).
    expect(kindAt(scan([tusker(), ...outcrops()], 100), BEHIND, { now: 102 })).toBe('bait-hint');
    expect(kindAt(scan([tusker(trampling), ...outcrops()], 100), BEHIND, { now: 102 })).toBe(
      'trample-bait',
    );
    // The lead over the fire: the Trample's target standing in a burning trail
    // while the lane still follows them.
    const leading = {
      castingAbility: TUSKER_TRAMPLE,
      castRemaining: T.trampleCast - 0.05,
      castTotal: T.trampleCast,
      castTargetId: 1,
    };
    expect(kindAt(scan([tusker(leading), trail, ...outcrops()]), inLane)).toBe('trample-lead');
    // The Tusker's alerts outrank a trash debuff.
    expect(
      kindAt(scan([tusker(trampling), ...outcrops()]), inLane, {
        auras: [{ id: SANCTUM_BRANDED, remaining: 5, duration: 9 }],
      }),
    ).toBe('trample');
    // Nothing of the Tusker's: the direct builder returns null.
    expect(buildTuskerAlert(scan([]), W(leg(2)), 100)).toBeNull();
  });
});

describe("the Tusker's aura tooltips and bar names", () => {
  const aura = (id: string, kind: AuraKind, value: number) =>
    auraEffectDescriptor({ id, kind, value });

  it('Stuck in the Ice says the hold and the damage window with the live numbers', () => {
    const hold = aura(TUSKER_STUCK, 'stun', 0);
    expect(hold?.key).toBe('hudChrome.auraEffect.sanctum.tuskerStuck');
    expect(hold?.nums).toEqual({ seconds: T.stuckSeconds });
    const window = aura(TUSKER_STUCK_EXPOSED, 'vulnerability', T.stuckVuln);
    expect(window?.key).toBe('hudChrome.auraEffect.sanctum.tuskerStuckExposed');
    expect(window?.nums).toEqual({ pct: 25 });
    expect(t('hudChrome.auraEffect.sanctum.tuskerStuckExposed', { pct: '25' })).toBe(
      'Stuck in an ice outcrop: takes 25% more damage.',
    );
    expect(t('hudChrome.auraEffect.sanctum.tuskerStuck', { seconds: '4' })).toContain('4 sec');
  });

  it("the objects' clocks have names", () => {
    expect(castDisplayName('sanctum_soulfire_trail_burn')).toBe('Burning');
    expect(castDisplayName('sanctum_ice_outcrop_held')).toBe('Tusks Stuck');
  });
});
