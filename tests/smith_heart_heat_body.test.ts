// The Guardian of the Heat's own model (characters/smith_heart_boss_looks.ts,
// the pure plan src/render/smith_heart_fx/heat_body_core.ts and its fire
// heat_body.ts): the rigged GLB replaces the bodyless provisional body, ships
// every clip it binds with KTX2 textures, stands in its wellspring at the
// giant's scale, plays its own clip for Basalt Fist's bar (landing on the
// bar's end), the cast, the plunge and the breach; the fire's sockets sit on
// real bones at the offsets the GLB's rest pose gives; the stance gestures
// follow the guardian's stage; the painter draws the fire over the model,
// sends the stance and cast gestures, claims no event, and disposes.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { SMITH_HEART_BOSS_LOOKS } from '../src/render/characters/smith_heart_boss_looks';
import { SMITH_HEART_PLACEHOLDER_LOOKS } from '../src/render/characters/smith_heart_placeholder_looks';
import { HeatBody } from '../src/render/smith_heart_fx';
import {
  HEAT_BODY_CLIP,
  HEAT_BODY_CLIPS,
  HEAT_BODY_GESTURES,
  HEAT_BODY_HEIGHT,
  HEAT_BODY_HOVER,
  HEAT_BODY_SCALE,
  HEAT_BODY_URL,
  HEAT_FLAMES,
  HEAT_FX_GROW,
  HEAT_MODEL_LAVA,
  HEAT_MODEL_UNITS,
  HEAT_ROCKS,
  HEAT_ROCKS_LOW,
  HEAT_SOCKETS,
  heatBodyState,
  heatCastLook,
  heatDeathLook,
  heatFlameFor,
  heatFlameRate,
  heatRockOrbit,
  heatStanceGesture,
  heatWhiteness,
} from '../src/render/smith_heart_fx/heat_body_core';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { HEARTH_WELL } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  HEAT_AURAS,
  HEAT_CASTS,
  HEAT_CUES,
  HEAT_GUARDIAN,
  HEAT_STAGES,
  HEAT_TUNING,
} from '../src/sim/encounters/smith_heart/heat_ids';
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
  extensionsUsed?: string[];
} {
  const buf = readFileSync(`public/${rel}`);
  expect(buf.readUInt32LE(0)).toBe(0x46546c67);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

const glb = glbJson(HEAT_BODY_URL);
const key = SMITH_HEART_PLACEHOLDER_LOOKS[HEAT_GUARDIAN];
const def = VISUALS[key];

describe('the Guardian of the Heat model', () => {
  it('replaces the bodyless provisional body with its own rigged one', () => {
    expect(key).toBe('smith_heart_heat_guardian');
    expect(def).toBe(SMITH_HEART_BOSS_LOOKS.smith_heart_heat_guardian);
    expect(def.url).toBe(HEAT_BODY_URL);
    expect(def.bodyless).toBeFalsy();
    const g = { kind: 'mob', templateId: HEAT_GUARDIAN } as Parameters<typeof visualKeyFor>[0];
    expect(visualKeyFor(g)).toBe(key);
  });

  it('stands in its wellspring a giant: some nine players over the shore', () => {
    expect(SMITH_HEART_MOBS[HEAT_GUARDIAN].scale).toBe(HEAT_BODY_SCALE);
    expect(def.height).toBe(HEAT_BODY_HEIGHT);
    expect(def.hover).toBe(HEAT_BODY_HOVER);
    // The hover sinks the model so the guardian's own position (the lava's
    // surface) crosses it at its lava line.
    expect(HEAT_BODY_HOVER).toBeCloseTo(
      -(HEAT_MODEL_LAVA / HEAT_MODEL_UNITS) * HEAT_BODY_HEIGHT,
      9,
    );
    const crown = HEAT_BODY_HEIGHT * HEAT_BODY_SCALE * (1 - HEAT_MODEL_LAVA / HEAT_MODEL_UNITS);
    // Pass 4 grew it a third (scale 3 to 4) with its wellspring.
    expect(crown / PLAYER).toBeGreaterThan(8);
    expect(crown / PLAYER).toBeLessThan(11);
    expect(HEAT_FX_GROW).toBeCloseTo(4 / 3, 9);
    // Melee still reaches it from the shore (the sim's body is the pool's),
    // and the pool grew with the body.
    expect(HEARTH_WELL.r).toBeLessThan(12);
    expect(HEARTH_WELL.r).toBeGreaterThan(10);
  });

  it('ships every clip it binds and KTX2 textures', () => {
    const names = glb.animations.map((a) => a.name);
    for (const c of HEAT_BODY_CLIPS) expect(names, c).toContain(c);
    expect(glb.extensionsUsed).toContain('KHR_texture_basisu');
    expect(glb.images?.length).toBeGreaterThan(0);
    for (const im of glb.images ?? []) expect(im.mimeType).toBe('image/ktx2');
    // Every clip the ClipMaps name is in the file.
    const c = def.clips;
    const named = [
      c.idle,
      c.walk,
      c.run,
      c.death,
      c.cast,
      ...c.attack,
      ...Object.values(c.attackByAbility ?? {}),
      ...Object.values(c.castByAbility ?? {}),
      ...Object.values(def.phaseClips ?? {}).flatMap((p) => [
        p.clips.idle,
        p.enter ?? p.clips.idle,
      ]),
    ];
    for (const n of named) expect(names, n).toContain(n);
  });

  it('plays its own clips: both fists, the slam on the bar end, the cast, the plunge, the breach', () => {
    const c = def.clips;
    expect(c.attack).toEqual(['Attack', 'Attack2']);
    expect(c.castByAbility?.[HEAT_CASTS.fist]).toBe('Slam');
    expect(c.castTimeScaleByAbility?.[HEAT_CASTS.fist]).toBeCloseTo(
      HEAT_BODY_CLIP.slam / HEAT_TUNING.fistCast,
      9,
    );
    expect(def.castClipSync).toEqual([HEAT_CASTS.fist]);
    expect(c.attackByAbility?.[HEAT_BODY_GESTURES.cast]).toBe('Cast');
    const P = def.phaseClips ?? {};
    expect(P[HEAT_BODY_GESTURES.sink]?.enter).toBe('Sink');
    expect(P[HEAT_BODY_GESTURES.rise]?.enter).toBe('Rise');
    // The steady stances are the same vocabularies (so a re-send never replays
    // the plunge or the breach).
    expect(P[HEAT_BODY_GESTURES.under]?.clips).toBe(P[HEAT_BODY_GESTURES.sink]?.clips);
    expect(P[HEAT_BODY_GESTURES.stand]?.clips).toBe(P[HEAT_BODY_GESTURES.rise]?.clips);
    expect(P[HEAT_BODY_GESTURES.stand]?.clips).toBe(c);
    expect(P[HEAT_BODY_GESTURES.under]?.clips.idle).toBe('Under');
    for (const one of ['Sink', 'Rise', 'Slam', 'Cast'])
      expect(def.oneShotsHoldAttacks, one).toContain(one);
    expect(def.castPlayOutHoldsAttacks).toBe(true);
    // Dead, the lava in it cools through its death scene (heat_death_fx.ts
    // writes its skin), never a fade of the rig's own that would hide it.
    expect(def.glowPulses?.deathFade).toBeUndefined();
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
    for (const s of HEAT_SOCKETS) {
      const i = glb.nodes.findIndex((n) => n.name === s.bone);
      expect(i, s.bone).toBeGreaterThanOrEqual(0);
      const p = new THREE.Vector3(...s.at).applyMatrix4(world(i).invert());
      expect(p.x, s.id).toBeCloseTo(s.local[0], 2);
      expect(p.y, s.id).toBeCloseTo(s.local[1], 2);
      expect(p.z, s.id).toBeCloseTo(s.local[2], 2);
    }
    // Every flame rides a socket.
    for (const f of HEAT_FLAMES) expect(HEAT_SOCKETS.some((s) => s.id === f.socket)).toBe(true);
  });
});

describe('heat_body_core: the fire plan', () => {
  it('plunges on a transition and only holds a stance otherwise', () => {
    const S = HEAT_STAGES;
    const G = HEAT_BODY_GESTURES;
    expect(heatStanceGesture(S.sinking, S.fight)).toBe(G.sink);
    expect(heatStanceGesture(S.sinking, -1)).toBe(G.under);
    expect(heatStanceGesture(S.sinking, S.sinking)).toBe(G.under);
    expect(heatStanceGesture(S.under, S.sinking)).toBe(G.under);
    expect(heatStanceGesture(S.rising, S.under)).toBe(G.rise);
    expect(heatStanceGesture(S.rising, -1)).toBe(G.stand);
    expect(heatStanceGesture(S.rising, S.rising)).toBe(G.stand);
    expect(heatStanceGesture(S.fight, S.rising)).toBe(G.stand);
    // Presentation gesture ids, never a sim id.
    for (const g of Object.values(G)) expect(g.startsWith('smith_heart_heat_body_')).toBe(true);
  });

  it('burns hotter with the phase and never under the lava', () => {
    expect(heatFlameRate(2, false)).toBeGreaterThan(heatFlameRate(1, false));
    expect(heatFlameRate(3, false)).toBeGreaterThan(heatFlameRate(2, false));
    expect(heatFlameRate(3, true)).toBe(0);
    expect(heatWhiteness(3)).toBeGreaterThan(heatWhiteness(1));
    // The shoulders roar more than the horns, and every flame is reachable.
    const seen = new Map<string, number>();
    for (let i = 0; i < 1000; i++) {
      const f = heatFlameFor(i / 1000);
      seen.set(f.socket, (seen.get(f.socket) ?? 0) + 1);
    }
    for (const f of HEAT_FLAMES) expect(seen.get(f.socket), f.socket).toBeGreaterThan(0);
    expect(seen.get('shoulderL') ?? 0).toBeGreaterThan(seen.get('hornL') ?? 0);
  });

  it('gathers the cast to its release, then flashes and ends', () => {
    expect(heatCastLook(0).gather).toBe(0);
    const mid = heatCastLook(HEAT_BODY_CLIP.castRelease * 0.5);
    const late = heatCastLook(HEAT_BODY_CLIP.castRelease * 0.95);
    expect(late.gather).toBeGreaterThan(mid.gather);
    expect(heatCastLook(HEAT_BODY_CLIP.castRelease + 0.01).release).toBeGreaterThan(0.9);
    expect(heatCastLook(HEAT_BODY_CLIP.castRelease + 1).done).toBe(true);
  });

  it('cools in death: the flames out first, the smoke after, the glow last', () => {
    expect(heatDeathLook(0).flame).toBe(1);
    expect(heatDeathLook(3).flame).toBe(0);
    expect(heatDeathLook(1.5).smoke).toBeGreaterThan(0.9);
    expect(heatDeathLook(10).smoke).toBe(0);
    expect(heatDeathLook(1).glow).toBeGreaterThan(heatDeathLook(2).glow);
  });

  it('circles its rocks round the chest, finite and clear of the body', () => {
    expect(HEAT_ROCKS_LOW).toBeLessThan(HEAT_ROCKS);
    const o = { x: 0, y: 0, z: 0, size: 0, spin: 0 };
    for (let i = 0; i < HEAT_ROCKS; i++)
      for (const t of [0, 3.3, 47]) {
        heatRockOrbit(i, t, o);
        expect(Number.isFinite(o.x + o.y + o.z + o.size + o.spin)).toBe(true);
        expect(Math.hypot(o.x, o.z)).toBeGreaterThan(7);
        expect(o.y).toBeGreaterThan(0);
      }
  });

  it('reads its phase and stage off its state aura', () => {
    const st = heatBodyState([
      { id: HEAT_AURAS.state, value: 2, value2: HEAT_STAGES.sinking, remaining: 1, duration: 4 },
    ]);
    expect(st).toEqual({ phase: 2, stage: HEAT_STAGES.sinking, fill: 0.75 });
    expect(heatBodyState([])).toEqual({ phase: 0, stage: 0, fill: 0 });
  });
});

describe('HeatBody over a fake world', () => {
  it('burns over the guardian, sends its stance and cast gestures, claims nothing, disposes', () => {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    const entity = (id: number, kind: string, templateId: string, x: number, z: number) =>
      ({
        id,
        kind,
        templateId,
        name: templateId,
        pos: { x: o.x + x, y: 0, z: o.z + z },
        prevPos: { x: o.x + x, y: 0, z: o.z + z },
        facing: 0,
        scale: HEAT_BODY_SCALE,
        hp: 100,
        maxHp: 100,
        dead: false,
        auras: [] as Entity['auras'],
        castingAbility: null as string | null,
        castTargetId: null,
        castRemaining: 0,
        castTotal: 0,
        resource: 0,
        maxResource: 100,
        inCombat: true,
      }) as unknown as Entity;
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', -206, 0);
    const boss = entity(2, 'mob', HEAT_GUARDIAN, HEARTH_WELL.x, HEARTH_WELL.z);
    entities.set(me.id, me);
    entities.set(boss.id, boss);
    const world = {
      entities,
      player: me,
      playerId: me.id,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const scene = new THREE.Scene();
    let shaken = 0;
    const sent: string[] = [];
    const body = new HeatBody(
      scene,
      () => 0,
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
    const state = (stage: number, remaining = 1e9, duration = 1e9) => {
      boss.auras.length = 0;
      boss.auras.push({
        id: HEAT_AURAS.state,
        value: 1,
        value2: stage,
        remaining,
        duration,
      } as unknown as Entity['auras'][number]);
    };
    state(HEAT_STAGES.fight);
    for (let i = 0; i < 6; i++) body.update(1 / 20);
    const root = scene.getObjectByName('smith-heart-heat-body');
    expect(root?.visible).toBe(true);
    // The painter shows its own group under the gated root (the gate owns the
    // root's reveal).
    const fxGroup = root?.getObjectByName('smithHeartHeatBodyFx');
    expect(fxGroup?.parent).toBe(root);
    expect(fxGroup?.visible).toBe(true);
    expect(sent).toContain(HEAT_BODY_GESTURES.stand);
    // The vortex of fire stands at the wellspring, round the guardian.
    const vortex = scene.getObjectByName('smithHeartHeatVortex');
    expect(vortex?.visible).toBe(true);
    expect(
      Math.hypot(
        (vortex?.position.x ?? 1e9) - boss.pos.x,
        (vortex?.position.z ?? 1e9) - boss.pos.z,
      ),
    ).toBeLessThan(3);
    // Hearth Flare strikes: it gathers and throws its fire (once in a volley).
    const flare = {
      type: 'spellfx',
      sourceId: boss.id,
      targetId: me.id,
      school: 'fire',
      fx: 'beam',
      ability: HEAT_CUES.flare,
    } as unknown as SimEvent;
    expect(body.handleEvent(flare)).toBe(false);
    expect(body.handleEvent(flare)).toBe(false);
    expect(sent.filter((g) => g === HEAT_BODY_GESTURES.cast).length).toBe(1);
    // Its fist lands: no claim, a burst and a shake.
    const land = {
      type: 'spellfxAt',
      x: boss.pos.x + 12,
      z: boss.pos.z,
      radius: 6,
      school: 'fire',
      fx: 'burst',
      ability: HEAT_CUES.fist,
    } as unknown as SimEvent;
    expect(body.handleEvent(land)).toBe(false);
    expect(shaken).toBeGreaterThan(0);
    // The overflow: it plunges under (the Sink), then holds there.
    state(HEAT_STAGES.sinking, 2, 2.5);
    body.update(1 / 20);
    expect(sent).toContain(HEAT_BODY_GESTURES.sink);
    state(HEAT_STAGES.under);
    for (let i = 0; i < 30; i++) body.update(1 / 20);
    expect(sent).toContain(HEAT_BODY_GESTURES.under);
    // It climbs back out (the Rise).
    state(HEAT_STAGES.rising, 2.5, 3);
    body.update(1 / 20);
    expect(sent[sent.length - 1]).toBe(HEAT_BODY_GESTURES.rise);
    state(HEAT_STAGES.fight);
    // The living fire, the rocks and the debris pool all hang off the gated root.
    for (const name of [
      'smithHeartHeatTongues',
      'smithHeartHeatTongueSmoke',
      'smithHeartHeatRocks',
      'smithHeartHeatDebris',
    ])
      expect(root?.getObjectByName(name), name).toBeTruthy();
    expect(
      ((root as THREE.Object3D).getObjectByName('smithHeartHeatRocks') as THREE.InstancedMesh)
        .isInstancedMesh,
    ).toBe(true);
    (boss as { dead: boolean }).dead = true;
    for (let i = 0; i < 120; i++) body.update(1 / 20);
    // Cooled in death, its rocks burn again when it comes back.
    const rockMat = ((root as THREE.Object3D).getObjectByName('smithHeartHeatRocks') as THREE.Mesh)
      .material as THREE.ShaderMaterial;
    expect(rockMat.uniforms.uGlow.value).toBeLessThan(0.05);
    (boss as { dead: boolean }).dead = false;
    body.update(1 / 20);
    expect(rockMat.uniforms.uGlow.value).toBe(1);
    body.dispose();
    body.dispose();
    expect(scene.getObjectByName('smith-heart-heat-body')).toBeUndefined();
  });
});
