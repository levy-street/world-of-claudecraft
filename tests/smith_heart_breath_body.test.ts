// The Guardian of the Breath's provisional body (src/render/smith_heart_fx/
// breath_body_core.ts and breath_body.ts): it stands imposing (at least 2.5
// times a player, matching the manifest and the template), its pieces are
// real nodes of their kits (no metal, no machinery: storm granite, rock and
// crystal), sided pieces in pairs; the fight's bars and the wind's phases map
// to their motions; every pose, the storm's shard orbit and the fall are
// finite; the storm body tears out to its orbit; and BreathBody over a fake
// world dresses the guardian only inside the raid, turns to the wind's
// bearing as a blow gathers, wears the storm body while the aura holds,
// never claims an event, falls with a dead body, and disposes.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { SMITH_HEART_PLACEHOLDER_LOOKS } from '../src/render/characters/smith_heart_placeholder_looks';
import { BreathBody } from '../src/render/smith_heart_fx/breath_body';
import {
  BREAK_FREEZE_AT,
  BREAK_TEAR_AT,
  BREATH_ARM,
  BREATH_BODY_HEIGHT,
  BREATH_BODY_PIECES,
  BREATH_FALL,
  BREATH_THREAD_PAIRS,
  type BreathBodyAction,
  breathArm,
  breathBodyAction,
  breathBodyLook,
  breathBodyTop,
  breathElbowPole,
  breathFacesWind,
  breathFallProgress,
  breathFallRest,
  breathWristTarget,
  stormFormOn,
  stormShardSlot,
  stormTearProgress,
} from '../src/render/smith_heart_fx/breath_body_core';
import { colossusArmIk } from '../src/render/smith_heart_fx/final_fx_core';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  BREATH_AURAS,
  BREATH_CASTS,
  BREATH_CUES,
  BREATH_GUARDIAN,
  breathWindTemplate,
} from '../src/sim/encounters/smith_heart/breath_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const PLAYER = 1.9;
const ACTIONS: BreathBodyAction[] = [
  'idle',
  'swing',
  'gather',
  'blow',
  'calm',
  'inhale',
  'gust',
  'cast',
  'break',
  'storm',
];
const finite = (p: { x: number; y: number; z: number }) =>
  Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

const KIT_NODES = {
  breath: [
    'Kit_StormRod',
    'Kit_WindHorn',
    'Kit_ChannelJamb',
    'Kit_WindShelter',
    'Kit_StormStone',
    'Kit_BreathWallA',
    'Kit_BreathWallB',
  ],
  heart: [
    'Kit_ColHip',
    'Kit_ColTorso',
    'Kit_ColHead',
    'Kit_ColShoulder',
    'Kit_ColUpperArm',
    'Kit_ColForearm',
    'Kit_ColFist',
    'Kit_ColShardA',
    'Kit_ColShardB',
    'Kit_ColShardC',
    'Kit_HeartCrystal',
  ],
} as const;

describe('breath_body_core: the plan', () => {
  it('stands imposing, matching the manifest and the template', () => {
    const look = SMITH_HEART_PLACEHOLDER_LOOKS[BREATH_GUARDIAN];
    expect(look).toBe('smith_heart_breath_guardian');
    const visual = VISUALS[look];
    expect(visual?.bodyless).toBe(true);
    expect(BREATH_BODY_HEIGHT).toBeCloseTo(
      (visual?.height ?? 0) * (SMITH_HEART_MOBS[BREATH_GUARDIAN]?.scale ?? 0),
    );
    expect(BREATH_BODY_HEIGHT / PLAYER).toBeGreaterThanOrEqual(2.5);
    // Its crown is about its height (the nameplate rides over it).
    expect(Math.abs(breathBodyTop() - BREATH_BODY_HEIGHT)).toBeLessThan(0.6);
  });

  it('is storm granite, rock and crystal: every piece a real kit node, sided in pairs', () => {
    const ids = new Set<string>();
    for (const p of BREATH_BODY_PIECES) {
      expect(KIT_NODES[p.kit] as readonly string[], p.id).toContain(p.node);
      expect(ids.has(p.id), p.id).toBe(false);
      ids.add(p.id);
      expect(p.size.x * p.size.y * p.size.z).toBeGreaterThan(0);
    }
    for (const j of ['lung', 'shoulder', 'upper', 'fore', 'hand', 'horn'] as const) {
      const sided = BREATH_BODY_PIECES.filter((p) => p.joint === j);
      expect(sided.map((p) => p.side).sort(), j).toEqual([-1, 1]);
    }
    // The bellows are two plates, the mouth a wind-horn, the wings fluted blades.
    expect(BREATH_BODY_PIECES.filter((p) => p.joint === 'lung').map((p) => p.node)).toEqual([
      'Kit_WindShelter',
      'Kit_WindShelter',
    ]);
    expect(BREATH_BODY_PIECES.find((p) => p.joint === 'mouth')?.node).toBe('Kit_WindHorn');
    expect(BREATH_BODY_PIECES.filter((p) => p.joint === 'wing')).toHaveLength(4);
    for (const [a, b] of BREATH_THREAD_PAIRS) expect(a).not.toBe(b);
  });
});

describe('breath_body_core: the motion', () => {
  it('maps the bars and the wind to their motions', () => {
    const at = (
      castId: string | null,
      windPhase: Parameters<typeof breathBodyAction>[0]['windPhase'],
      storm = false,
    ) =>
      breathBodyAction({ castId, castFill: 0.5, windPhase, windFill: 0.5, stormForm: storm })
        .action;
    expect(at(BREATH_CASTS.inhale, null)).toBe('inhale');
    expect(at(BREATH_CASTS.gust, null)).toBe('gust');
    expect(at(BREATH_CASTS.storm, null)).toBe('break');
    expect(at(BREATH_CASTS.fork, null, true)).toBe('cast');
    expect(at(BREATH_CASTS.lance, 'blow')).toBe('cast');
    expect(at(null, 'gather')).toBe('gather');
    expect(at(null, 'blow')).toBe('blow');
    expect(at(null, 'calm')).toBe('calm');
    expect(at(null, null)).toBe('idle');
    expect(at(null, 'storm', true)).toBe('storm');
    expect(at(null, 'gust', true)).toBe('blow');
    expect(breathFacesWind('gather')).toBe(true);
    expect(breathFacesWind('blow')).toBe(true);
    expect(breathFacesWind('inhale')).toBe(false);
  });

  it('breathes: the bellows fill as a blow gathers and empty through it', () => {
    const g0 = breathBodyLook('gather', 0, 0).swell;
    const g1 = breathBodyLook('gather', 1, 0).swell;
    expect(g1).toBeGreaterThan(g0);
    const b0 = breathBodyLook('blow', 0, 0);
    const b1 = breathBodyLook('blow', 1, 0);
    expect(b0.swell).toBeGreaterThan(b1.swell);
    expect(b0.mouth).toBeGreaterThan(0.5);
    // The indrawn breath swells past full; the storm bar freezes, then tears.
    expect(breathBodyLook('inhale', 1, 0).swell).toBeGreaterThan(1.2);
    expect(
      breathBodyLook('break', (BREAK_FREEZE_AT + BREAK_TEAR_AT) / 2, 0).jitter,
    ).toBeGreaterThan(0);
    expect(breathBodyLook('break', BREAK_FREEZE_AT * 0.5, 0).tear).toBe(0);
    expect(breathBodyLook('break', 1, 0).tear).toBeGreaterThan(0);
    expect(breathBodyLook('storm', 0, 0).tear).toBe(1);
  });

  it('keeps every pose finite and the wrists in the arm reach', () => {
    for (const action of ACTIONS)
      for (const k of [0, 0.3, 0.6, 0.88, 0.95, 1])
        for (const side of [1, -1] as const) {
          const w = breathWristTarget(action, side, k, 1);
          expect(finite(w), `${action} ${k}`).toBe(true);
          const arm = breathArm(side, w);
          expect(finite(arm.elbow) && finite(arm.wrist)).toBe(true);
          const look = breathBodyLook(action, k, 1.3);
          for (const v of Object.values(look)) expect(Number.isFinite(v)).toBe(true);
        }
  });

  it("solves the arm as the colossus does, into the caller's scratch (no allocation)", () => {
    const wrist = { x: 0, y: 0, z: 0 };
    const arm = { elbow: { x: 0, y: 0, z: 0 }, wrist: { x: 0, y: 0, z: 0 } };
    const act = { action: 'idle' as BreathBodyAction, k: 0 };
    for (const action of ACTIONS)
      for (const k of [0, 0.5, 1])
        for (const side of [1, -1] as const) {
          // The out-params come back as the very objects passed in.
          expect(breathWristTarget(action, side, k, 1, wrist)).toBe(wrist);
          expect(breathArm(side, wrist, arm)).toBe(arm);
          const ref = colossusArmIk(
            { x: side * BREATH_ARM.root.x, y: BREATH_ARM.root.y, z: BREATH_ARM.root.z },
            wrist,
            BREATH_ARM.upper,
            BREATH_ARM.fore,
            breathElbowPole(side),
          );
          for (const axis of ['x', 'y', 'z'] as const) {
            expect(arm.elbow[axis]).toBeCloseTo(ref.elbow[axis], 9);
            expect(arm.wrist[axis]).toBeCloseTo(ref.wrist[axis], 9);
          }
        }
    const input = {
      castId: BREATH_CASTS.inhale,
      castFill: 0.4,
      windPhase: null,
      windFill: 0,
      stormForm: false,
    };
    expect(breathBodyAction(input, act)).toBe(act);
    expect(act).toEqual({ action: 'inhale', k: 0.4 });
    const fall = { k: 0, landed: false };
    expect(breathFallProgress(9, 0, fall)).toBe(fall);
    expect(fall.landed).toBe(true);
  });

  it('tears the shell out to rings of shards round the storm core', () => {
    expect(stormTearProgress(0, 0.25)).toBeCloseTo(0.25);
    expect(stormTearProgress(10, 0.25)).toBeCloseTo(1);
    const radii = new Set<number>();
    for (let i = 0; i < BREATH_BODY_PIECES.length; i++) {
      const s = stormShardSlot(i, 2.4);
      expect(finite(s)).toBe(true);
      const r = Math.hypot(s.x, s.z);
      expect(r).toBeGreaterThan(2.5);
      expect(r).toBeLessThan(4.5);
      radii.add(Math.round(r * 10));
    }
    expect(radii.size).toBe(3);
    expect(stormFormOn([{ id: BREATH_AURAS.stormForm }])).toBe(true);
    expect(stormFormOn([{ id: 'other' }])).toBe(false);
  });

  it("falls round where it stood, every piece landing by the fall's end", () => {
    BREATH_BODY_PIECES.forEach((p, i) => {
      const rest = breathFallRest(i, { x: 1, y: 5, z: 0.5 });
      expect(finite(rest.at) && finite(rest.tilt)).toBe(true);
      expect(Math.hypot(rest.at.x, rest.at.z)).toBeLessThan(5.5);
      expect(breathFallProgress(BREATH_FALL.end, rest.delay).landed).toBe(true);
      expect(p.id.length).toBeGreaterThan(0);
    });
  });
});

describe('BreathBody', () => {
  const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
  function entity(
    id: number,
    kind: Entity['kind'],
    templateId: string,
    x: number,
    z: number,
  ): Entity {
    return {
      id,
      kind,
      templateId,
      name: templateId,
      pos: { x: o.x + x, y: 60, z: o.z + z },
      prevPos: { x: o.x + x, y: 60, z: o.z + z },
      facing: 0,
      scale: 1,
      hp: 100,
      maxHp: 100,
      dead: false,
      inCombat: true,
      auras: [] as Entity['auras'],
      castingAbility: null as string | null,
      castTargetId: null,
      castRemaining: 0,
      castTotal: 0,
    } as unknown as Entity;
  }

  it('dresses the guardian, turns to the wind, wears the storm, never claims, falls, disposes', () => {
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', -10, 190);
    const boss = entity(2, 'mob', BREATH_GUARDIAN, 0, 198);
    const wind = entity(3, 'object', breathWindTemplate('gather', 90, 2.5), 0, 196);
    for (const e of [me, boss, wind]) entities.set(e.id, e);
    const world = {
      entities,
      entityRosterVersion: 1,
      player: me,
      playerId: me.id,
    } as unknown as IWorld & { entityRosterVersion: number };
    const scene = new THREE.Scene();
    let shaken = 0;
    const fx = new BreathBody(
      scene,
      () => 60,
      world,
      undefined,
      () => false,
      (a) => {
        shaken += a;
      },
    );
    const root = scene.getObjectByName('smith-heart-breath-body');
    expect(root).toBeDefined();
    const body = root?.getObjectByName('smithHeartBreathBody');
    // No kit here: every piece wears its stand-in stone (a kit that never
    // lands still leaves a body), the crystals casting no shadow.
    const standIns: THREE.Mesh[] = [];
    body?.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name === 'smithHeartBreathStandIn') standIns.push(o);
    });
    expect(standIns).toHaveLength(BREATH_BODY_PIECES.length);
    BREATH_BODY_PIECES.forEach((def) => {
      const holder = body?.getObjectByName(`breathBody:${def.id}`);
      const s = holder?.children.find((c) => c.name === 'smithHeartBreathStandIn') as
        | THREE.Mesh
        | undefined;
      expect(s, def.id).toBeDefined();
      if (def.light === 'crystal') expect(s?.castShadow, def.id).toBe(false);
    });
    fx.update(0.2);
    expect(body?.visible).toBe(true);
    // As the blow gathers it turns its mouth to the bearing (90: east, +x).
    for (let i = 0; i < 60; i++) fx.update(1 / 30);
    expect(Math.abs((body?.rotation.y ?? 0) - Math.PI / 2)).toBeLessThan(0.2);
    // A swing never claims.
    const swing = {
      type: 'damage',
      sourceId: boss.id,
      targetId: me.id,
      amount: 10,
      crit: false,
      school: 'physical',
      ability: null,
    } as SimEvent;
    expect(fx.handleEvent(swing)).toBe(false);
    // The storm bar, its tear, then the storm body.
    boss.castingAbility = BREATH_CASTS.storm;
    boss.castTotal = 4;
    boss.castRemaining = 4;
    for (let i = 0; i < 120; i++) {
      boss.castRemaining = Math.max(0, boss.castRemaining - 1 / 30);
      fx.update(1 / 30);
    }
    boss.castingAbility = null;
    boss.auras.push({ id: BREATH_AURAS.stormForm } as Entity['auras'][number]);
    const tear = {
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'nature',
      fx: 'nova',
      ability: BREATH_CUES.tear,
    } as SimEvent;
    expect(fx.handleEvent(tear)).toBe(false);
    for (let i = 0; i < 60; i++) fx.update(1 / 30);
    expect(root?.getObjectByName('smithHeartBreathStormCore')?.visible).toBe(true);
    expect(shaken).toBeGreaterThan(0);
    // Death: it stays drawn (fallen) while its corpse lies.
    boss.dead = true;
    for (let i = 0; i < 90; i++) fx.update(1 / 30);
    expect(body?.visible).toBe(true);
    // Leaving the world frees it.
    entities.delete(boss.id);
    world.entityRosterVersion++;
    fx.update(0.2);
    expect(body?.visible).toBe(false);
    // Discovery walks the roster on a membership change only: a guardian
    // the walk has not been told of stays undrawn until the version moves.
    boss.dead = false;
    entities.set(boss.id, boss);
    fx.update(0.2);
    expect(body?.visible).toBe(false);
    world.entityRosterVersion++;
    fx.update(0.2);
    expect(body?.visible).toBe(true);
    fx.dispose();
    expect(scene.getObjectByName('smith-heart-breath-body')).toBeUndefined();
  });

  it('first seen already in the storm, it wears the torn body whole', () => {
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', -10, 190);
    const boss = entity(2, 'mob', BREATH_GUARDIAN, 0, 198);
    boss.auras.push({ id: BREATH_AURAS.stormForm } as Entity['auras'][number]);
    for (const e of [me, boss]) entities.set(e.id, e);
    const world = {
      entities,
      entityRosterVersion: 1,
      player: me,
      playerId: me.id,
    } as unknown as IWorld;
    const scene = new THREE.Scene();
    const fx = new BreathBody(scene, () => 60, world);
    fx.update(0.2);
    fx.update(1 / 30);
    expect(scene.getObjectByName('smithHeartBreathStormCore')?.visible).toBe(true);
    fx.dispose();
  });
});
