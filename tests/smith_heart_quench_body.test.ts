// The Guardian of the Quench's own model and her fight's look (the pure plans
// src/render/smith_heart_fx/quench_body_core.ts and quench_fight_fx_core.ts,
// the painter quench_body.ts): the rigged GLB of the ice queen replaces the
// bodyless provisional body, ships every clip it binds with KTX2 textures,
// stands near six players tall, plays her own clips for Quenching Breath and
// the Blades Wake (landing on the bar's end), Tempering Strike, the taunt and
// the slash; her cold's sockets sit on real bones at the offsets the GLB's
// rest pose gives; the bars and aftermaths map to her light, the death to a
// statue's frost climbing her; the painter draws the cold over her, sends her
// gestures, claims no event, and disposes. Then the fight's own look: the
// objects decode to their kinds, the frost on a body follows the cold bar, the
// cracks fill to their hole, the blades tear free and float, the warmth's
// threads stay within the sim's reach, and the shore ice rises once.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { SMITH_HEART_BOSS_LOOKS } from '../src/render/characters/smith_heart_boss_looks';
import { SMITH_HEART_PLACEHOLDER_LOOKS } from '../src/render/characters/smith_heart_placeholder_looks';
import { gateObjectPlan } from '../src/render/gate_objects';
import { ARC_CLEAVE_ABILITY } from '../src/render/smith_heart_fx/hammer_fx_core';
import { QuenchBody } from '../src/render/smith_heart_fx/quench_body';
import {
  bladesAwakeOn,
  newGlowLook,
  QUENCH_BODY_CLIP,
  QUENCH_BODY_CLIPS,
  QUENCH_BODY_GESTURES,
  QUENCH_BODY_HEIGHT,
  QUENCH_BODY_SCALE,
  QUENCH_BODY_URL,
  QUENCH_HAIR_TIPS,
  QUENCH_HEM,
  QUENCH_MODEL_UNITS,
  QUENCH_RIME_LIFE,
  QUENCH_SOCKETS,
  QUENCH_SYNCED_CASTS,
  QUENCH_YD_PER_UNIT,
  type QuenchBodyInput,
  quenchBodyAction,
  quenchDeathLook,
  quenchGlowLook,
  quenchRimeLook,
  quenchStatueGlaze,
} from '../src/render/smith_heart_fx/quench_body_core';
import {
  clearQuenchBodySockets,
  quenchSocketPoint,
} from '../src/render/smith_heart_fx/quench_body_sockets';
import {
  BLADE_FLOAT_LIFT,
  BLADE_TIP,
  bladeLook,
  crackLook,
  frostLook,
  frozenLook,
  QUENCH_FIGHT_POOLS,
  quenchFightClaims,
  quenchObjectKind,
  RIM_SHARDS,
  rimRise,
  rimShard,
  warmthLinks,
} from '../src/render/smith_heart_fx/quench_fight_fx_core';
import { quenchStatueGlazeFor } from '../src/render/smith_heart_fx/quench_statue_glaze';
import { quenchWakeLine } from '../src/render/smith_heart_fx/quench_wake_core';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { QUENCH_RIMEWALL } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  bladeTemplate,
  crackTemplate,
  laneTemplate,
  QUENCH_AURAS,
  QUENCH_BODY_RADIUS,
  QUENCH_CASTS,
  QUENCH_CUES,
  QUENCH_GUARDIAN,
  QUENCH_OBJECTS,
  QUENCH_TUNING as T,
} from '../src/sim/encounters/smith_heart/quench_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const PLAYER = 1.9;

interface GlbNode {
  name?: string;
  children?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
}
function glbJson(rel: string): {
  nodes: GlbNode[];
  animations: { name: string }[];
  images?: { mimeType?: string }[];
  meshes?: unknown[];
  extensionsUsed?: string[];
} {
  const buf = readFileSync(`public/${rel}`);
  expect(buf.readUInt32LE(0)).toBe(0x46546c67);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

const glb = glbJson(QUENCH_BODY_URL);
const key = SMITH_HEART_PLACEHOLDER_LOOKS[QUENCH_GUARDIAN];
const def = VISUALS[key];

describe('the Guardian of the Quench model', () => {
  it('replaces the bodyless provisional body with her own rigged one', () => {
    expect(key).toBe('smith_heart_quench_guardian');
    expect(def).toBe(SMITH_HEART_BOSS_LOOKS.smith_heart_quench_guardian);
    expect(def.url).toBe(QUENCH_BODY_URL);
    expect(def.bodyless).toBeFalsy();
    const g = { kind: 'mob', templateId: QUENCH_GUARDIAN } as Parameters<typeof visualKeyFor>[0];
    expect(visualKeyFor(g)).toBe(key);
  });

  it('towers over the lake: her crown five to six players up, her body radius inside her', () => {
    expect(SMITH_HEART_MOBS[QUENCH_GUARDIAN].scale).toBe(QUENCH_BODY_SCALE);
    expect(SMITH_HEART_MOBS[QUENCH_GUARDIAN].bodyRadius).toBe(QUENCH_BODY_RADIUS);
    expect(def.height).toBe(QUENCH_BODY_HEIGHT);
    expect(QUENCH_YD_PER_UNIT).toBeCloseTo(
      (QUENCH_BODY_HEIGHT * QUENCH_BODY_SCALE) / QUENCH_MODEL_UNITS,
      9,
    );
    const crown = QUENCH_MODEL_UNITS * QUENCH_YD_PER_UNIT;
    expect(crown / PLAYER).toBeGreaterThan(5);
    expect(crown / PLAYER).toBeLessThan(6.2);
    // Clearly bigger than the provisional body (2.3 x 3: three and a half players).
    expect(crown).toBeGreaterThan(2.3 * 3 * 1.4);
    // The radius sits inside the gown's hem all round her.
    for (const id of QUENCH_HEM) {
      const s = QUENCH_SOCKETS.find((x) => x.id === id);
      const r = Math.hypot(s?.at[0] ?? 0, s?.at[2] ?? 0) * QUENCH_YD_PER_UNIT;
      expect(QUENCH_BODY_RADIUS, id).toBeLessThan(r + 0.6);
    }
  });

  it('ships every clip it binds, one mesh, and KTX2 textures', () => {
    const names = glb.animations.map((a) => a.name);
    for (const c of QUENCH_BODY_CLIPS) expect(names, c).toContain(c);
    expect(glb.meshes?.length).toBe(1);
    expect(glb.extensionsUsed).toContain('KHR_texture_basisu');
    expect(glb.images?.length).toBeGreaterThan(0);
    for (const im of glb.images ?? []) expect(im.mimeType).toBe('image/ktx2');
    const c = def.clips;
    const bound = [
      c.idle,
      c.walk,
      c.run,
      c.death,
      c.cast ?? c.idle,
      ...c.attack,
      ...Object.values(c.attackByAbility ?? {}),
      ...Object.values(c.castByAbility ?? {}),
    ];
    for (const n of bound) expect(names, n).toContain(n);
  });

  it('plays her own clips: the breath and the wake on their bar end, the strike, the taunt, the slash', () => {
    const c = def.clips;
    expect(c.walk).toBe('Move');
    expect(c.attack).toEqual(['Attack', 'Attack2']);
    expect(c.castByAbility?.[QUENCH_CASTS.breath]).toBe('Breath');
    expect(c.castByAbility?.[QUENCH_CASTS.wake]).toBe('Wake');
    expect(c.castByAbility?.[QUENCH_CASTS.flurry]).toBe('WakeHold');
    expect(c.attackByAbility?.[ARC_CLEAVE_ABILITY]).toBe('Strike');
    // Round 3: Tempering Strike raised before it lands, then true to its
    // outcome: the slam for a cleave, a plain swing for an avoided one.
    expect(c.attackByAbility?.[QUENCH_BODY_GESTURES.strikeRaise]).toBe('StrikeRaise');
    expect(c.attackByAbility?.[QUENCH_BODY_GESTURES.strikeSlam]).toBe('StrikeSlam');
    expect(c.attackByAbility?.[QUENCH_BODY_GESTURES.strikeSpent]).toBe('StrikeSpent');
    for (const g of ['strikeRaise', 'strikeSlam', 'strikeSpent'] as const)
      expect(c.attackTimeScaleByAbility?.[QUENCH_BODY_GESTURES[g]]).toBe(1);
    expect(c.contacts?.StrikeSlam).toEqual([QUENCH_BODY_CLIP.strikeSlam]);
    expect(c.contacts?.StrikeSpent).toEqual([QUENCH_BODY_CLIP.strikeSpent]);
    // The raise is at its top before the swing comes, and holds past it.
    expect(QUENCH_BODY_CLIP.strikeRaiseTop).toBeLessThan(T.strikeWindup);
    expect(QUENCH_BODY_CLIP.strikeRaiseHold).toBeGreaterThan(T.strikeWindup + 0.3);
    expect(c.attackByAbility?.[QUENCH_BODY_GESTURES.taunt]).toBe('Taunt');
    expect(c.attackByAbility?.[QUENCH_BODY_GESTURES.slash]).toBe('Slash');
    const TS = c.castTimeScaleByAbility ?? {};
    expect(TS[QUENCH_CASTS.breath]).toBeCloseTo(QUENCH_BODY_CLIP.breath / T.breathCast, 9);
    expect(TS[QUENCH_CASTS.wake]).toBeCloseTo(QUENCH_BODY_CLIP.wake / T.wakeCast, 9);
    // Authored so their beat IS the bar's end at a time scale of 1.
    expect(QUENCH_BODY_CLIP.breath).toBeCloseTo(T.breathCast, 9);
    expect(QUENCH_BODY_CLIP.wake).toBeCloseTo(T.wakeCast, 9);
    const sync = def.castClipSync as readonly string[];
    for (const b of Object.keys(QUENCH_SYNCED_CASTS)) expect(sync, b).toContain(b);
    // The hunt's long bar loops its held pose, never synced.
    expect(sync).not.toContain(QUENCH_CASTS.flurry);
    for (const one of [
      'Breath',
      'Wake',
      'Strike',
      'StrikeRaise',
      'StrikeSlam',
      'StrikeSpent',
      'Taunt',
      'Slash',
    ])
      expect(def.oneShotsHoldAttacks, one).toContain(one);
    expect(c.castPlayOut).toEqual(['Breath', 'Wake']);
    expect(def.glowPulses?.deathFade).toBeGreaterThan(0);
    expect(def.glowPulses?.pulses.map((p) => p.gesture)).toEqual([
      QUENCH_BODY_GESTURES.flare,
      QUENCH_BODY_GESTURES.strikeRaise,
    ]);
    for (const g of Object.values(QUENCH_BODY_GESTURES))
      expect(g.startsWith('smith_heart_quench_body_')).toBe(true);
  });

  it('hangs every socket on a real bone, at the offset the rest pose gives', () => {
    const parent = new Map<number, number>();
    glb.nodes.forEach((n, i) => {
      for (const c of n.children ?? []) parent.set(c, i);
    });
    const local = (n: GlbNode) =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(...(n.translation ?? [0, 0, 0])),
        new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
        new THREE.Vector3(...(n.scale ?? [1, 1, 1])),
      );
    const world = (i: number) => {
      const m = local(glb.nodes[i]);
      for (let p = parent.get(i); p !== undefined; p = parent.get(p))
        m.premultiply(local(glb.nodes[p]));
      return m;
    };
    const ids = new Set<string>();
    for (const s of QUENCH_SOCKETS) {
      expect(ids.has(s.id), s.id).toBe(false);
      ids.add(s.id);
      const i = glb.nodes.findIndex((n) => n.name === s.bone);
      expect(i, s.bone).toBeGreaterThanOrEqual(0);
      const p = new THREE.Vector3(...s.at).applyMatrix4(world(i).invert());
      expect(p.x, s.id).toBeCloseTo(s.local[0], 2);
      expect(p.y, s.id).toBeCloseTo(s.local[1], 2);
      expect(p.z, s.id).toBeCloseTo(s.local[2], 2);
    }
    for (const id of [...QUENCH_HEM, ...QUENCH_HAIR_TIPS]) expect(ids.has(id), id).toBe(true);
    // Her heart and eyes face forward (+z), her crown tops her.
    const at = (id: string) => QUENCH_SOCKETS.find((s) => s.id === id)?.at ?? [0, 0, 0];
    expect(at('heart')[2]).toBeGreaterThan(0.5);
    expect(at('eyeL')[2]).toBeGreaterThan(0.3);
    expect(at('crown')[1]).toBeGreaterThan(9.5);
  });
});

const IDLE: QuenchBodyInput = {
  castId: null,
  castFill: 0,
  sinceBreath: Number.POSITIVE_INFINITY,
  sinceStrike: Number.POSITIVE_INFINITY,
  sinceWake: Number.POSITIVE_INFINITY,
};

describe('quench_body_core: her light and her cold', () => {
  it('maps the bars first, then the aftermaths, then idle', () => {
    expect(quenchBodyAction(IDLE).action).toBe('idle');
    expect(quenchBodyAction({ ...IDLE, castId: QUENCH_CASTS.breath, castFill: 0.5 })).toEqual({
      action: 'breath',
      k: 0.5,
    });
    expect(quenchBodyAction({ ...IDLE, castId: QUENCH_CASTS.wake, castFill: 0.25 }).action).toBe(
      'wake',
    );
    expect(quenchBodyAction({ ...IDLE, castId: QUENCH_CASTS.flurry }).action).toBe('hunt');
    // A bar wins over an aftermath still running.
    expect(quenchBodyAction({ ...IDLE, castId: QUENCH_CASTS.breath, sinceWake: 0.1 }).action).toBe(
      'breath',
    );
    expect(quenchBodyAction({ ...IDLE, sinceWake: 0.2 }).action).toBe('thrown');
    expect(quenchBodyAction({ ...IDLE, sinceBreath: 0.2 }).action).toBe('exhale');
    expect(quenchBodyAction({ ...IDLE, sinceStrike: 0.2 }).action).toBe('strike');
    expect(quenchBodyAction({ ...IDLE, sinceStrike: 5 }).action).toBe('idle');
    // The wind-up reads through its second, then the slam's aftermath.
    expect(quenchBodyAction({ ...IDLE, sinceWind: 0.5 })).toEqual({ action: 'windup', k: 0.5 });
    // Round 3: still waiting on the swing's outcome past the lead, held at
    // full; resolved (the body stops reporting it) or past the hold, the
    // strike's own look follows.
    expect(quenchBodyAction({ ...IDLE, sinceWind: 1.2 })).toEqual({ action: 'windup', k: 1 });
    expect(quenchBodyAction({ ...IDLE, sinceWind: 1.7, sinceStrike: 0.2 }).action).toBe('strike');
    expect(quenchBodyAction({ ...IDLE, castId: QUENCH_CASTS.breath, sinceWind: 0.5 }).action).toBe(
      'breath',
    );
  });

  it('blazes her heart through the breath and her crown through the wake', () => {
    const rest = quenchGlowLook('idle', 0, 0, false, newGlowLook());
    const full = quenchGlowLook('breath', 1, 0, false, newGlowLook());
    expect(full.heart).toBeGreaterThan(rest.heart * 2);
    expect(full.gather).toBeCloseTo(1, 5);
    expect(rest.gather).toBe(0);
    const up = quenchGlowLook('wake', 1, 0, false, newGlowLook());
    expect(up.crown).toBeGreaterThan(rest.crown * 3);
    expect(up.column).toBeCloseTo(1, 5);
    expect(rest.column).toBe(0);
    // Awake, her crown burns brighter at rest.
    expect(quenchGlowLook('idle', 0, 0, true, newGlowLook()).crown).toBeGreaterThan(rest.crown);
    // The wind-up blazes her bracers to the slam.
    const wind = quenchGlowLook('windup', 1, 0, false, newGlowLook());
    expect(wind.bracers).toBeGreaterThan(rest.bracers * 4);
    for (const a of [
      'idle',
      'windup',
      'strike',
      'breath',
      'exhale',
      'wake',
      'thrown',
      'hunt',
    ] as const)
      for (const k of [0, 0.5, 1]) {
        const l = quenchGlowLook(a, k, 1.3, false, newGlowLook());
        for (const v of Object.values(l)) expect(Number.isFinite(v), a).toBe(true);
      }
  });

  it('freezes her into a statue from the feet up after she kneels, her light going out', () => {
    expect(quenchDeathLook(0).frost).toBe(0);
    expect(quenchDeathLook(QUENCH_BODY_CLIP.deathKneel - 0.5).frost).toBe(0);
    const mid = quenchDeathLook(QUENCH_BODY_CLIP.deathKneel + 0.8);
    expect(mid.frost).toBeGreaterThan(0.2);
    expect(mid.frost).toBeLessThan(1);
    const late = quenchDeathLook(10);
    expect(late.frost).toBeGreaterThan(1);
    expect(late.glow).toBe(0);
    const g = quenchStatueGlaze(10, { height: 0, glow: 0, bite: 0, alpha: 0 });
    expect(g.height).toBeGreaterThan(1);
    expect(g.alpha).toBe(1);
    expect(quenchStatueGlaze(0, { height: 0, glow: 0, bite: 0, alpha: 0 }).alpha).toBe(0);
  });

  it('freezes rime under her steps that spreads, sets and thaws away', () => {
    const a = quenchRimeLook(0.05);
    const b = quenchRimeLook(1);
    expect(b.radius).toBeGreaterThan(a.radius);
    expect(b.alpha).toBeGreaterThan(0.9);
    expect(quenchRimeLook(QUENCH_RIME_LIFE + 0.1).alpha).toBe(0);
  });

  it("races the wake's lines out to the blades, then lets them go", () => {
    expect(quenchWakeLine(0).head).toBe(0);
    expect(quenchWakeLine(0.6).head).toBeCloseTo(1, 5);
    expect(quenchWakeLine(1.5).alpha).toBe(1);
    expect(quenchWakeLine(3).alpha).toBe(0);
  });

  it('never hangs the loot sparkle over her fight objects', () => {
    for (const templateId of [
      crackTemplate(2.5),
      QUENCH_OBJECTS.hole,
      laneTemplate('warn', 3, 12),
      QUENCH_OBJECTS.rim,
      QUENCH_OBJECTS.rimRise,
      bladeTemplate('float'),
    ]) {
      const plan = gateObjectPlan({ templateId, dungeonId: 'smith_heart', pos: { x: 0, z: 0 } });
      expect(plan && 'encounterAnchor' in plan, templateId).toBe(true);
    }
  });

  it('reads the awake marker', () => {
    expect(bladesAwakeOn([{ id: QUENCH_AURAS.awake }])).toBe(true);
    expect(bladesAwakeOn([])).toBe(false);
  });
});

describe('QuenchBody over a fake world', () => {
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
      pos: { x: o.x + x, y: 40, z: o.z + z },
      prevPos: { x: o.x + x, y: 40, z: o.z + z },
      facing: 0,
      scale: QUENCH_BODY_SCALE,
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

  it('finds her mouth high over the lake before the model loads', () => {
    clearQuenchBodySockets();
    const g = entity(2, 'mob', QUENCH_GUARDIAN, 198, -2);
    const m = quenchSocketPoint(g, 'mouth', new THREE.Vector3());
    expect(m.y - g.pos.y).toBeGreaterThan(8);
    // Facing 0 is +z: her mouth is before her body.
    expect(m.z - g.pos.z).toBeGreaterThan(0.3);
  });

  it('draws her cold, sends her gestures, freezes her into a statue, disposes', () => {
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', 190, -12);
    const boss = entity(2, 'mob', QUENCH_GUARDIAN, 198, -2);
    const blade = entity(3, 'object', bladeTemplate('sunk'), 214, 10);
    for (const e of [me, boss, blade]) entities.set(e.id, e);
    const world = {
      entities,
      entityRosterVersion: 1,
      player: me,
      playerId: me.id,
    } as unknown as IWorld & { entityRosterVersion: number };
    const scene = new THREE.Scene();
    let shaken = 0;
    const sent: string[] = [];
    const fx = new QuenchBody(
      scene,
      () => 40,
      world,
      undefined,
      () => false,
      (a) => {
        shaken += a;
      },
      (id, g) => {
        expect(id).toBe(boss.id);
        sent.push(g);
      },
    );
    const root = scene.getObjectByName('smith-heart-quench-body');
    expect(root).toBeDefined();
    const body = root?.getObjectByName('smithHeartQuenchBodyFx');
    expect(body?.parent).toBe(root);
    expect(body?.visible).toBe(false);
    for (let i = 0; i < 6; i++) fx.update(1 / 20);
    expect(body?.visible).toBe(true);
    // Her heart alight, the rime frozen under her first step.
    expect(root?.getObjectByName('smithHeartQuenchHeart')?.visible).toBe(true);
    const rime = root?.getObjectByName('smithHeartQuenchRime') as THREE.InstancedMesh;
    expect(rime.count).toBeGreaterThan(0);
    // She walks: a new ring behind her.
    const before = rime.count;
    for (let i = 0; i < 20; i++) {
      boss.pos.z += 0.5;
      fx.update(1 / 20);
    }
    expect(rime.count).toBeGreaterThan(before);
    // The pull's cue sends the taunt; no cue is ever claimed.
    const cue = (ability: string, fxKind = 'nova') =>
      ({
        type: 'spellfx',
        sourceId: boss.id,
        targetId: boss.id,
        school: 'frost',
        fx: fxKind,
        ability,
      }) as SimEvent;
    expect(fx.handleEvent(cue(QUENCH_CUES.rim))).toBe(false);
    expect(sent).toContain(QUENCH_BODY_GESTURES.taunt);
    // A slash's line shows: she points it on.
    const lane = entity(4, 'object', laneTemplate('warn', 3, 12), 205, 0);
    entities.set(lane.id, lane);
    world.entityRosterVersion++;
    fx.update(0.2);
    expect(sent).toContain(QUENCH_BODY_GESTURES.slash);
    // The wake's bar raises the column; its cue throws the lines and flares her.
    boss.castingAbility = QUENCH_CASTS.wake;
    boss.castTotal = T.wakeCast;
    boss.castRemaining = 1;
    fx.update(1 / 20);
    expect(root?.getObjectByName('smithHeartQuenchWakeShell')?.visible).toBe(true);
    expect(root?.getObjectByName('smithHeartQuenchWakeCore')?.visible).toBe(true);
    expect(root?.getObjectByName('smithHeartQuenchWakeFoot')?.visible).toBe(true);
    boss.castingAbility = null;
    expect(fx.handleEvent(cue(QUENCH_CUES.wake))).toBe(false);
    fx.update(0.2);
    expect(sent).toContain(QUENCH_BODY_GESTURES.flare);
    expect(root?.getObjectByName('smithHeartQuenchWakeLine')?.visible).toBe(true);
    expect(root?.getObjectByName('smithHeartQuenchWakeSpikes')?.visible).toBe(true);
    expect(root?.getObjectByName('smithHeartQuenchWakeWave')?.visible).toBe(true);
    expect(shaken).toBeGreaterThan(0);
    // Tempering Strike with no wind-up seen: the short slam, never claimed.
    expect(fx.handleEvent(cue(ARC_CLEAVE_ABILITY, 'windup'))).toBe(false);
    for (let i = 0; i < 20; i++) fx.update(1 / 20);
    const cracks = root?.getObjectsByProperty('name', 'smithHeartQuenchStrikeCracks') ?? [];
    expect(cracks.some((c) => c.visible)).toBe(true);
    for (let i = 0; i < 80; i++) fx.update(1 / 20);
    // The wind-up cue raises her fists a second ahead and lays the tell
    // (every tier); the cleave's own cue on the swing is then claimed and
    // slams from the raised fists.
    const windRing = root?.getObjectByName('smithHeartQuenchWindupRing');
    const fistFlare = root?.getObjectByName('smithHeartQuenchWindupFist');
    const spiral = root?.getObjectByName('smithHeartQuenchWindupSpiral');
    for (let i = 0; i < 60; i++) fx.update(1 / 20);
    expect(cracks.some((c) => c.visible)).toBe(false);
    expect(fx.handleEvent(cue(QUENCH_CUES.strikeReady, 'windup'))).toBe(false);
    expect(sent.at(-1)).toBe(QUENCH_BODY_GESTURES.strikeRaise);
    for (let i = 0; i < 20; i++) fx.update(1 / 20);
    expect(windRing?.visible).toBe(true);
    expect(fistFlare?.visible).toBe(true);
    expect(spiral?.visible).toBe(true);
    // No slam while she only holds her fists up.
    expect(cracks.some((c) => c.visible)).toBe(false);
    expect(fx.handleEvent(cue(ARC_CLEAVE_ABILITY, 'windup'))).toBe(true);
    expect(sent.at(-1)).toBe(QUENCH_BODY_GESTURES.strikeSlam);
    // Her fists reach the ice on the slam's contact: the lake cracks open.
    for (let i = 0; i < 4; i++) fx.update(1 / 20);
    expect(cracks.some((c) => c.visible)).toBe(true);
    for (let i = 0; i < 60; i++) fx.update(1 / 20);
    expect(windRing?.visible).toBe(false);
    expect(fx.handleEvent(cue(ARC_CLEAVE_ABILITY, 'windup'))).toBe(false);
    for (let i = 0; i < 80; i++) fx.update(1 / 20);
    // An avoided cued swing: a plain swing from the raised fists, the tell
    // falls away, and the lake never cracks.
    expect(fx.handleEvent(cue(QUENCH_CUES.strikeReady, 'windup'))).toBe(false);
    for (let i = 0; i < 20; i++) fx.update(1 / 20);
    expect(fx.handleEvent(cue(QUENCH_CUES.strikeSpent, 'windup'))).toBe(false);
    expect(sent.at(-1)).toBe(QUENCH_BODY_GESTURES.strikeSpent);
    for (let i = 0; i < 30; i++) fx.update(1 / 20);
    expect(cracks.some((c) => c.visible)).toBe(false);
    expect(windRing?.visible).toBe(false);
    // A cleave long after (no wind-up waiting) is the short Strike, unclaimed.
    expect(fx.handleEvent(cue(ARC_CLEAVE_ABILITY, 'windup'))).toBe(false);
    // The breath's streaks of wind leave her mouth's way down the cone.
    expect(fx.handleEvent(cue(QUENCH_CASTS.breath))).toBe(false);
    fx.update(1 / 20);
    fx.update(1 / 20);
    expect(root?.getObjectByName('smithHeartQuenchBreathStreaks')?.visible).toBe(true);
    for (let i = 0; i < 20; i++) fx.update(1 / 20);
    // Death: the statue's frost held on her own body, climbing.
    boss.dead = true;
    for (let i = 0; i < 70; i++) fx.update(1 / 20);
    const glaze = quenchStatueGlazeFor(boss.id);
    expect(glaze).not.toBeNull();
    expect(glaze?.height).toBeGreaterThan(0.5);
    // Up again (a wipe): the frost lets go.
    boss.dead = false;
    fx.update(1 / 20);
    expect(quenchStatueGlazeFor(boss.id)).toBeNull();
    // Leaving the world frees her.
    entities.delete(boss.id);
    world.entityRosterVersion++;
    fx.update(0.2);
    expect(body?.visible).toBe(false);
    fx.dispose();
    fx.dispose();
    expect(scene.getObjectByName('smith-heart-quench-body')).toBeUndefined();
  });
});

describe('quench_fight_fx_core: the fight on the ice', () => {
  it("decodes every one of the fight's objects to its kind, and nothing else", () => {
    expect(quenchObjectKind(crackTemplate(2.5))).toBe('crack');
    expect(quenchObjectKind(QUENCH_OBJECTS.hole)).toBe('hole');
    expect(quenchObjectKind(laneTemplate('warn', 3, 12))).toBe('lane');
    expect(quenchObjectKind(QUENCH_OBJECTS.rim)).toBe('rim');
    expect(quenchObjectKind(QUENCH_OBJECTS.rimRise)).toBe('rimRise');
    expect(quenchObjectKind(bladeTemplate('float'))).toBe('blade');
    expect(quenchObjectKind('sh_quench_blade_nonsense')).toBeNull();
    expect(quenchObjectKind('sh_breath_wind')).toBeNull();
  });

  it('claims its own cues and leaves the rest to the generic bursts', () => {
    for (const cue of [QUENCH_CUES.freeze, QUENCH_CUES.shatter, QUENCH_CUES.cross, QUENCH_CUES.rim])
      expect(quenchFightClaims(cue), cue).toBe(true);
    expect(quenchFightClaims('frostbolt')).toBe(false);
    expect(quenchFightClaims(null)).toBe(false);
  });

  it('dresses a body in frost with its bar, urgent past three quarters', () => {
    const none = frostLook(0, 1, 16);
    expect(none.cover).toBe(0);
    expect(none.crystals).toBe(0);
    expect(none.pulse).toBe(0);
    const half = frostLook(T.coldMax / 2, 1, 16);
    const full = frostLook(T.coldMax, 1, 16);
    expect(half.crystals).toBeGreaterThan(0);
    expect(full.crystals).toBe(16);
    expect(full.height).toBeGreaterThan(half.height);
    expect(frostLook(T.coldMax * 0.74, 0.1, 16).pulse).toBe(0);
    let pulsed = false;
    for (let t = 0; t < 1; t += 0.05)
      if (frostLook(T.coldMax * 0.8, t, 16).pulse > 0) pulsed = true;
    expect(pulsed).toBe(true);
  });

  it('grows the freeze fast and cracks it toward the shatter', () => {
    expect(frozenLook(0).grow).toBe(0);
    expect(frozenLook(0.4).grow).toBe(1);
    expect(frozenLook(0.5).crack).toBe(0);
    expect(frozenLook(T.freezeSeconds).crack).toBe(1);
  });

  it("fills a crack's telegraph to its hole over its warning", () => {
    expect(crackLook(0, T.crackWarn).fill).toBe(0);
    expect(crackLook(T.crackWarn / 2, T.crackWarn).fill).toBeCloseTo(0.5);
    expect(crackLook(T.crackWarn, T.crackWarn).fill).toBe(1);
    expect(crackLook(T.crackWarn, T.crackWarn).spread).toBe(1);
  });

  it('keeps a sunk blade down, tears it free over the bar, then floats it', () => {
    expect(bladeLook('sunk', 0, 0, 0, 0)).toMatchObject({ lift: 0, upright: 0 });
    const early = bladeLook('wake', 0, 0, 0, 0, { lift: 0, upright: 0, light: 0, shake: 0 });
    expect(early.lift).toBe(0);
    const done = bladeLook('wake', 0, 1, 0, 0, { lift: 0, upright: 0, light: 0, shake: 0 });
    expect(done.upright).toBe(1);
    expect(done.lift).toBeCloseTo(BLADE_TIP + BLADE_FLOAT_LIFT);
    for (let t = 0; t < 6; t += 0.5) {
      const f = bladeLook('float', 5, 1, t, 2, { lift: 0, upright: 0, light: 0, shake: 0 });
      expect(f.upright).toBe(1);
      expect(Math.abs(f.lift - (BLADE_TIP + BLADE_FLOAT_LIFT))).toBeLessThanOrEqual(0.25);
    }
  });

  it("threads warmth only between bodies within the sim's reach, capped", () => {
    const out = new Int16Array(QUENCH_FIGHT_POOLS.links * 2);
    const bodies = [
      { id: 1, x: 0, z: 0 },
      { id: 2, x: T.warmR - 0.1, z: 0 },
      { id: 3, x: (T.warmR - 0.1) / 2, z: 1 },
      { id: 4, x: 0, z: T.warmR * 3 },
    ];
    expect(warmthLinks(bodies, out, QUENCH_FIGHT_POOLS.links)).toBe(3);
    expect([...out.subarray(0, 6)]).toEqual([0, 1, 0, 2, 1, 2]);
    expect(warmthLinks(bodies, out, 1)).toBe(1);
  });

  it('raises the shore ice once and keeps its shards inside a slab', () => {
    expect(rimRise(0)).toBe(0);
    expect(rimRise(T.rimRise)).toBe(1);
    expect(rimRise(T.rimRise * 4)).toBe(1);
    for (let s = 0; s < QUENCH_RIMEWALL.segments; s++)
      for (let k = 0; k < RIM_SHARDS; k++) {
        const sh = rimShard(s, k);
        expect(Math.abs(sh.x)).toBeLessThan(QUENCH_RIMEWALL.hw * 1.6);
        expect(sh.h).toBeGreaterThan(0);
        expect(sh.lean).toBeGreaterThan(0);
      }
    expect(QUENCH_FIGHT_POOLS.rimSlabs).toBe(QUENCH_RIMEWALL.segments);
    expect(QUENCH_FIGHT_POOLS.holes).toBe(T.holeMax);
  });
});
