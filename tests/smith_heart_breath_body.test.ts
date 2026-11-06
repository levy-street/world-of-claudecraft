// The Guardian of the Breath's own model (characters/smith_heart_boss_looks.ts,
// the pure plan src/render/smith_heart_fx/breath_body_core.ts and its wind
// breath_body.ts): the rigged GLB of floating armor pieces replaces the
// bodyless provisional body, ships every clip it binds with KTX2 textures,
// stands six players and more tall, plays its own clips for the Indrawn
// Breath (the whole bar), the Summit Roar and the bolt casts (landing on the
// bar's end), the channels, and Storm Breaks into the storm stance's clip set;
// the wind's sockets sit on real bones at the offsets the GLB's rest pose
// gives; the currents wind through those sockets; the painter draws the wind
// over the model, sends its stance, claims no event, and disposes.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { SMITH_HEART_BOSS_LOOKS } from '../src/render/characters/smith_heart_boss_looks';
import { SMITH_HEART_PLACEHOLDER_LOOKS } from '../src/render/characters/smith_heart_placeholder_looks';
import { gateObjectPlan } from '../src/render/gate_objects';
import { BreathBody } from '../src/render/smith_heart_fx/breath_body';
import {
  arcPath,
  BREAK_TEAR_AT,
  BREATH_ARC_PAIRS,
  BREATH_BODY_CLIP,
  BREATH_BODY_CLIPS,
  BREATH_BODY_GESTURES,
  BREATH_BODY_HEIGHT,
  BREATH_BODY_SCALE,
  BREATH_BODY_URL,
  BREATH_CURRENTS,
  BREATH_MODEL_CROWN,
  BREATH_MODEL_UNITS,
  BREATH_ORBIT_LOW,
  BREATH_RIBBON_COUNT,
  BREATH_SHARDS,
  BREATH_SOCKETS,
  BREATH_STONES,
  BREATH_YD_PER_UNIT,
  breathBodyAction,
  breathDeathLook,
  breathOrbit,
  breathRibbonKept,
  breathStanceGesture,
  breathWindLook,
  profileAt,
  ribbonFade,
  splineAt,
  stormFormOn,
} from '../src/render/smith_heart_fx/breath_body_core';
import {
  breathSocketPoint,
  clearBreathBodySockets,
} from '../src/render/smith_heart_fx/breath_body_sockets';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  BREATH_AURAS,
  BREATH_CASTS,
  BREATH_CUES,
  BREATH_GUARDIAN,
  BREATH_OBJECTS,
  BREATH_TUNING,
  breathWindTemplate,
} from '../src/sim/encounters/smith_heart/breath_ids';
import { ISLE_CASTS } from '../src/sim/encounters/smith_heart/breath_isle_ids';
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

const glb = glbJson(BREATH_BODY_URL);
const key = SMITH_HEART_PLACEHOLDER_LOOKS[BREATH_GUARDIAN];
const def = VISUALS[key];

describe('the Guardian of the Breath model', () => {
  it('replaces the bodyless provisional body with its own rigged one', () => {
    expect(key).toBe('smith_heart_breath_guardian');
    expect(def).toBe(SMITH_HEART_BOSS_LOOKS.smith_heart_breath_guardian);
    expect(def.url).toBe(BREATH_BODY_URL);
    expect(def.bodyless).toBeFalsy();
    const g = { kind: 'mob', templateId: BREATH_GUARDIAN } as Parameters<typeof visualKeyFor>[0];
    expect(visualKeyFor(g)).toBe(key);
  });

  it('towers over the Cornice: its crown five to seven players up', () => {
    expect(SMITH_HEART_MOBS[BREATH_GUARDIAN].scale).toBe(BREATH_BODY_SCALE);
    expect(def.height).toBe(BREATH_BODY_HEIGHT);
    expect(BREATH_YD_PER_UNIT).toBeCloseTo(
      (BREATH_BODY_HEIGHT * BREATH_BODY_SCALE) / BREATH_MODEL_UNITS,
      9,
    );
    const crown = BREATH_MODEL_CROWN * BREATH_YD_PER_UNIT;
    expect(crown / PLAYER).toBeGreaterThan(5);
    expect(crown / PLAYER).toBeLessThan(7);
    // Clearly bigger than the provisional body (2.0 x 3.4: three and a half players).
    expect(crown).toBeGreaterThan(2.0 * 3.4 * 1.5);
  });

  it('ships every clip it binds, one mesh, and KTX2 textures', () => {
    const names = glb.animations.map((a) => a.name);
    for (const c of BREATH_BODY_CLIPS) expect(names, c).toContain(c);
    expect(glb.meshes?.length).toBe(1);
    expect(glb.extensionsUsed).toContain('KHR_texture_basisu');
    expect(glb.images?.length).toBeGreaterThan(0);
    for (const im of glb.images ?? []) expect(im.mimeType).toBe('image/ktx2');
    const named = (c: typeof def.clips) => [
      c.idle,
      c.walk,
      c.run,
      c.death,
      c.cast ?? c.idle,
      ...c.attack,
      ...Object.values(c.attackByAbility ?? {}),
      ...Object.values(c.castByAbility ?? {}),
    ];
    const stances = Object.values(def.phaseClips ?? {}).map((p) => p.clips);
    for (const c of [def.clips, ...stances])
      for (const n of named(c)) expect(names, n).toContain(n);
  });

  it('plays its own clips: the breath, the roar, the bolts on the bar end, the channels', () => {
    const c = def.clips;
    expect(c.attack).toEqual(['Attack', 'Attack2']);
    expect(c.castByAbility?.[BREATH_CASTS.inhale]).toBe('Inhale');
    expect(c.castByAbility?.[BREATH_CASTS.gust]).toBe('Roar');
    expect(c.castByAbility?.[BREATH_CASTS.storm]).toBe('StormBreaks');
    expect(c.castByAbility?.[BREATH_CASTS.fork]).toBe('Cast');
    expect(c.castByAbility?.[BREATH_CASTS.cradleHold]).toBe('Channel');
    expect(c.castByAbility?.[ISLE_CASTS.bulwark]).toBe('Channel');
    const T = c.castTimeScaleByAbility ?? {};
    expect(T[BREATH_CASTS.inhale]).toBeCloseTo(
      BREATH_BODY_CLIP.inhale / BREATH_TUNING.inhaleCast,
      9,
    );
    expect(T[BREATH_CASTS.gust]).toBeCloseTo(BREATH_BODY_CLIP.roar / BREATH_TUNING.gustCast, 9);
    expect(T[BREATH_CASTS.storm]).toBeCloseTo(
      BREATH_BODY_CLIP.breakEnd / BREATH_TUNING.stormCast,
      9,
    );
    expect(T[BREATH_CASTS.fork]).toBeCloseTo(
      BREATH_BODY_CLIP.castRelease / BREATH_TUNING.forkCast,
      9,
    );
    // The channels loop; every timed bar is locked to its bar.
    const sync = def.castClipSync as readonly string[];
    for (const b of [BREATH_CASTS.inhale, BREATH_CASTS.gust, BREATH_CASTS.storm, BREATH_CASTS.fork])
      expect(sync, b).toContain(b);
    expect(sync).not.toContain(BREATH_CASTS.cradleHold);
    for (const one of ['Roar', 'StormBreaks', 'Cast'])
      expect(def.oneShotsHoldAttacks, one).toContain(one);
    expect(def.glowPulses?.deathFade).toBeGreaterThan(0);
  });

  it('wears the storm as a stance: the same motions on the exploded spacing', () => {
    const P = def.phaseClips ?? {};
    const calm = P[BREATH_BODY_GESTURES.calm]?.clips;
    const storm = P[BREATH_BODY_GESTURES.storm]?.clips;
    expect(calm).toBe(def.clips);
    expect(storm?.idle).toBe('StormIdle');
    expect(storm?.attack).toEqual(['StormAttack', 'StormAttack2']);
    expect(storm?.death).toBe('StormDeath');
    expect(storm?.castByAbility?.[BREATH_CASTS.fork]).toBe('StormCast');
    expect(storm?.castByAbility?.[BREATH_CASTS.cradleHold]).toBe('StormChannel');
    // No stance plays a one-shot on the swap: Storm Breaks itself is the bar's clip.
    expect(P[BREATH_BODY_GESTURES.storm]?.enter).toBeUndefined();
    expect(breathStanceGesture(true)).toBe(BREATH_BODY_GESTURES.storm);
    expect(breathStanceGesture(false)).toBe(BREATH_BODY_GESTURES.calm);
    for (const g of Object.values(BREATH_BODY_GESTURES))
      expect(g.startsWith('smith_heart_breath_body_')).toBe(true);
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
    for (const s of BREATH_SOCKETS) {
      const i = glb.nodes.findIndex((n) => n.name === s.bone);
      expect(i, s.bone).toBeGreaterThanOrEqual(0);
      const p = new THREE.Vector3(...s.at).applyMatrix4(world(i).invert());
      expect(p.x, s.id).toBeCloseTo(s.local[0], 2);
      expect(p.y, s.id).toBeCloseTo(s.local[1], 2);
      expect(p.z, s.id).toBeCloseTo(s.local[2], 2);
    }
  });
});

describe('breath_body_core: the wind plan', () => {
  it('winds every current through real sockets', () => {
    const ids = new Set(BREATH_SOCKETS.map((s) => s.id));
    let ribbons = 0;
    for (const c of BREATH_CURRENTS) {
      expect(c.radius.length, c.id).toBe(c.path.length);
      for (const p of c.path) expect(ids.has(p), `${c.id}:${p}`).toBe(true);
      ribbons += c.ribbons;
      // The low tier keeps at least one strand of every current, never all of a thick one.
      const kept = Array.from({ length: c.ribbons }, (_, k) => breathRibbonKept(c, k, true));
      expect(kept.filter(Boolean).length, c.id).toBeGreaterThan(0);
      if (c.ribbons > 2) expect(kept.filter(Boolean).length, c.id).toBeLessThan(c.ribbons);
    }
    expect(ribbons).toBe(BREATH_RIBBON_COUNT);
    // The trunk runs down every tail plate to the tip and curls on over the floor.
    const trunk = BREATH_CURRENTS.find((c) => c.id === 'trunk');
    expect(trunk?.path.at(-1)).toBe('tip');
    expect(trunk?.tailCurl).toBe(true);
    // The soft strands give it a body under the filaments.
    expect(BREATH_CURRENTS.some((c) => c.soft)).toBe(true);
    for (const [a, b] of BREATH_ARC_PAIRS) expect(ids.has(a) && ids.has(b)).toBe(true);
  });

  it('runs its spline through its points and fades its strands at both ends', () => {
    const pts = new Float32Array([0, 0, 0, 1, 2, 0, 2, 0, 1]);
    const out = new Float32Array(6);
    splineAt(pts, 3, 0, out);
    expect([out[0], out[1], out[2]]).toEqual([0, 0, 0]);
    splineAt(pts, 3, 1, out);
    expect(out[0]).toBeCloseTo(2, 6);
    expect(out[2]).toBeCloseTo(1, 6);
    splineAt(pts, 3, 0.5, out);
    expect(out[1]).toBeCloseTo(2, 6);
    expect(profileAt([1, 3], 0.5)).toBeCloseTo(2, 9);
    expect(ribbonFade(0)).toBe(0);
    expect(ribbonFade(1)).toBe(0);
    expect(ribbonFade(0.5)).toBe(1);
  });

  it('jags its lightning between two points and lands on both', () => {
    const out = new Float32Array(15 * 3);
    arcPath(77, 0, 0, 0, 10, 0, 0, 14, 0.2, out);
    expect([out[0], out[1], out[2]]).toEqual([0, 0, 0]);
    expect(out[14 * 3]).toBeCloseTo(10, 6);
    expect(Math.abs(out[14 * 3 + 1])).toBeLessThan(1e-6);
    let kinked = 0;
    for (let i = 1; i < 14; i++) {
      expect(Math.hypot(out[i * 3 + 1], out[i * 3 + 2])).toBeLessThan(10 * 0.2 * 1.2);
      if (Math.abs(out[i * 3 + 1]) > 0.05) kinked++;
    }
    expect(kinked).toBeGreaterThan(4);
  });

  it('reads the bars and the wind into an action', () => {
    const at = (castId: string | null, stormForm = false) =>
      breathBodyAction({ castId, castFill: 0.5, windPhase: null, windFill: 0.3, stormForm }).action;
    expect(at(BREATH_CASTS.inhale)).toBe('inhale');
    expect(at(BREATH_CASTS.gust)).toBe('roar');
    expect(at(BREATH_CASTS.storm)).toBe('break');
    expect(at(BREATH_CASTS.fork, true)).toBe('cast');
    expect(at(BREATH_CASTS.cradleHold, true)).toBe('channel');
    expect(at(ISLE_CASTS.bulwark)).toBe('channel');
    expect(at(null, true)).toBe('storm');
    expect(at(null)).toBe('idle');
    expect(
      breathBodyAction({
        castId: null,
        castFill: 0,
        windPhase: 'blow',
        windFill: 0.2,
        stormForm: false,
      }).action,
    ).toBe('blow');
  });

  it('draws the wind in for the breath, flings it out with the roar, tears it into the storm', () => {
    expect(breathWindLook('inhale', 1, 0).radius).toBeLessThan(
      breathWindLook('inhale', 0, 0).radius,
    );
    expect(breathWindLook('inhale', 1, 0).drawIn).toBeGreaterThan(0.9);
    expect(breathWindLook('roar', 0.5, 0).radius).toBeLessThan(1);
    expect(breathWindLook('roar', 1, 0).radius).toBeGreaterThan(1.3);
    expect(breathWindLook('roar', 1, 0).drawIn).toBe(0);
    expect(breathWindLook('break', 0.2, 0).storm).toBe(0);
    expect(breathWindLook('break', BREAK_TEAR_AT - 0.01, 0).storm).toBeLessThan(0.4);
    expect(breathWindLook('break', 1, 0).storm).toBe(1);
    expect(breathWindLook('storm', 0, 3).storm).toBe(1);
    expect(breathWindLook('idle', 0, 1).storm).toBe(0);
    // The tear falls where the Storm Breaks clip flings the pieces out.
    expect(BREAK_TEAR_AT).toBeCloseTo(BREATH_BODY_CLIP.breakTear / BREATH_BODY_CLIP.breakEnd, 9);
  });

  it('dies in a gust: the wind out first, the glow after, the orbiters dropping', () => {
    expect(breathDeathLook(0).wind).toBe(1);
    expect(breathDeathLook(2).wind).toBe(0);
    expect(breathDeathLook(1).fling).toBeGreaterThan(breathDeathLook(0).fling);
    expect(breathDeathLook(1).glow).toBeGreaterThan(breathDeathLook(2).glow);
    expect(breathDeathLook(0).drop).toBe(0);
    expect(breathDeathLook(3).drop).toBe(1);
  });

  it('circles its stones and shards round the chest, wider in the storm', () => {
    expect(BREATH_ORBIT_LOW).toBeLessThan(BREATH_STONES);
    expect(BREATH_ORBIT_LOW).toBeLessThan(BREATH_SHARDS);
    const o = { x: 0, y: 0, z: 0, size: 0, spin: 0 };
    for (let i = 0; i < BREATH_STONES + BREATH_SHARDS; i++)
      for (const t of [0, 3.3, 47]) {
        breathOrbit(i, t, 0, o);
        expect(Number.isFinite(o.x + o.y + o.z + o.size + o.spin)).toBe(true);
        const calm = Math.hypot(o.x, o.z);
        expect(calm).toBeGreaterThan(2.5 * BREATH_YD_PER_UNIT);
        expect(o.y).toBeGreaterThan(0);
        breathOrbit(i, t, 1, o);
        expect(Math.hypot(o.x, o.z)).toBeGreaterThan(calm);
      }
  });

  it('never hangs the loot sparkle over its fight objects', () => {
    for (const templateId of [
      breathWindTemplate('blow', 90, 10),
      `${BREATH_OBJECTS.strikePrefix}12`,
      `${BREATH_OBJECTS.calmPrefix}landing_20`,
      BREATH_OBJECTS.vortex,
    ]) {
      const plan = gateObjectPlan({ templateId, dungeonId: 'smith_heart', pos: { x: 0, z: 0 } });
      expect(plan && 'encounterAnchor' in plan, templateId).toBe(true);
    }
  });

  it('knows its storm body by its aura', () => {
    expect(stormFormOn([{ id: BREATH_AURAS.stormForm }])).toBe(true);
    expect(stormFormOn([])).toBe(false);
  });
});

describe('BreathBody over a fake world', () => {
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
      scale: BREATH_BODY_SCALE,
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

  it('finds the mouth on the mask high over the Cornice before the model loads', () => {
    clearBreathBodySockets();
    const g = entity(2, 'mob', BREATH_GUARDIAN, 0, 198);
    const m = breathSocketPoint(g, 'mouth', new THREE.Vector3());
    expect(m.y - g.pos.y).toBeGreaterThan(8);
    // Facing 0 is +z: the mouth stands before the body.
    expect(m.z - g.pos.z).toBeGreaterThan(0.5);
  });

  it('winds the wind round the guardian, sends its stance, wears the storm, dies, disposes', () => {
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
    const sent: string[] = [];
    const fx = new BreathBody(
      scene,
      () => 60,
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
    const root = scene.getObjectByName('smith-heart-breath-body');
    expect(root).toBeDefined();
    for (let i = 0; i < 6; i++) fx.update(1 / 20);
    expect(root?.visible).toBe(true);
    expect(sent).toContain(BREATH_BODY_GESTURES.calm);
    // The living wind: every ribbon drawn round the body.
    const windMesh = root?.getObjectByName('smithHeartBreathWind') as THREE.Mesh;
    expect(windMesh.visible).toBe(true);
    expect(windMesh.geometry.drawRange.count).toBeGreaterThan(0);
    const spine = windMesh.geometry.getAttribute('aSpine') as THREE.BufferAttribute;
    const p = new THREE.Vector3(spine.getX(0), spine.getY(0), spine.getZ(0));
    expect(Math.hypot(p.x - boss.pos.x, p.z - boss.pos.z)).toBeLessThan(12);
    // The orbiters circle it.
    const stones = root?.getObjectByName('smithHeartBreathStones') as THREE.InstancedMesh;
    expect(stones.isInstancedMesh).toBe(true);
    // A swing and the roar's cue never claim; the roar blasts its cone.
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
    const roar = {
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'nature',
      fx: 'nova',
      ability: BREATH_CUES.gust,
    } as SimEvent;
    expect(fx.handleEvent(roar)).toBe(false);
    fx.update(1 / 20);
    expect(root?.getObjectByName('smithHeartBreathRoarCone')?.visible).toBe(true);
    expect(shaken).toBeGreaterThan(0);
    expect(sent).toContain(BREATH_BODY_GESTURES.flare);
    // The storm bar runs out, its tear, then the storm stance and its lightning.
    boss.castingAbility = BREATH_CASTS.storm;
    boss.castTotal = 4;
    boss.castRemaining = 4;
    for (let i = 0; i < 80; i++) {
      boss.castRemaining = Math.max(0, boss.castRemaining - 1 / 20);
      fx.update(1 / 20);
    }
    boss.castingAbility = null;
    boss.auras.push({ id: BREATH_AURAS.stormForm } as Entity['auras'][number]);
    for (let i = 0; i < 40; i++) fx.update(1 / 20);
    expect(sent[sent.length - 1]).toBe(BREATH_BODY_GESTURES.storm);
    const bolts = root?.getObjectByName('smithHeartBreathBolts') as THREE.Mesh;
    expect(bolts.visible).toBe(true);
    // Death: the wind thrown off and gone.
    boss.dead = true;
    for (let i = 0; i < 60; i++) fx.update(1 / 20);
    expect(windMesh.visible).toBe(false);
    // Leaving the world frees it.
    entities.delete(boss.id);
    world.entityRosterVersion++;
    fx.update(0.2);
    expect(root?.visible).toBe(false);
    fx.dispose();
    fx.dispose();
    expect(scene.getObjectByName('smith-heart-breath-body')).toBeUndefined();
  });
});
