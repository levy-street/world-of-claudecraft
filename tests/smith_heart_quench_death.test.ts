// The Guardian of the Quench's death, "Frozen from within"
// (src/render/smith_heart_fx/quench_death_core.ts, painted by
// quench_death_fx.ts, ridden by quench_body.ts through quench_death_state.ts):
//   - the timeline in order, inside the 6 to 10 seconds asked for;
//   - she freezes from the heart out and her light goes at the shatter; her
//     blades fall, strike the ice point first and sink away; the seams run
//     out from her heart, hold a beat, and go with the shatter; the shards
//     land, skitter and melt; the lake's web heals tips first and the calm
//     sheet and the snow come in and fade;
//   - every sound a shipped sample; the clock: a death, a replay, neither;
//   - the rig: a replay's fall plays her Death clip and holds her knelt;
//   - QuenchDeathFx over a fake world: a death seen live holds the look her
//     body rides; one first seen long dead is the husk in the calm; out of
//     view and back it resumes; a replay cue is claimed, falls her living
//     body and stands her back up; the particles are world points; the low
//     tier sheds only its named double; reduced motion takes the thuds;
//   - `/dev heart quench death` over a real Sim emits the cue and kills
//     nothing; the cue makes no sound of its own.

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { SFX_FIXED_CATALOG_KEYS } from '../src/game/sfx_manifest.generated';
import { quenchSoundClaims } from '../src/game/smith_heart_quench_audio_core';
import { SMITH_HEART_BOSS_LOOKS } from '../src/render/characters/smith_heart_boss_looks';
import { gfxInternalsForTest, sharedUniforms } from '../src/render/gfx';
import { QuenchDeathFx } from '../src/render/smith_heart_fx';
import { QUENCH_DEATH_SECONDARY_LAYERS } from '../src/render/smith_heart_fx/entrance_budget_core';
import { QUENCH_BODY_GESTURES } from '../src/render/smith_heart_fx/quench_body_core';
import {
  newQuenchDeathBodyLook,
  QUENCH_DEATH,
  QUENCH_DEATH_BLADES,
  QUENCH_DEATH_GESTURES,
  QUENCH_DEATH_SOUNDS,
  QUENCH_REPLAY_SECONDS,
  QUENCH_SEAMS,
  QUENCH_SHARDS,
  quenchBladeAt,
  quenchDeathBodyLook,
  quenchDeathCrossed,
  quenchDeathKept,
  quenchDeathLake,
  quenchDeathLight,
  quenchDeathShake,
  quenchDeathTime,
  quenchFrostReach,
  quenchSeamAt,
  quenchSeamLevel,
  quenchShardAt,
} from '../src/render/smith_heart_fx/quench_death_core';
import { quenchDeathFor } from '../src/render/smith_heart_fx/quench_death_state';
import { QUENCH_ENTRANCE_BLADES } from '../src/render/smith_heart_fx/quench_entrance_core';
import { SMITH_HEART_DUNGEON } from '../src/sim/content/smith_heart';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { handleSmithHeartDevChat } from '../src/sim/dev/smith_heart_dev';
import { quenchGuardian } from '../src/sim/encounters/smith_heart';
import { QUENCH_DEV_CUES, QUENCH_GUARDIAN } from '../src/sim/encounters/smith_heart/quench_ids';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const D = QUENCH_DEATH;

describe('the timeline', () => {
  it('runs its beats in order, inside the 6 to 10 seconds asked for', () => {
    expect(D.freezeFrom).toBeLessThan(D.frozenAt);
    expect(D.frozenAt).toBeLessThan(D.crackAt);
    expect(D.crackAt + D.seamsFor).toBeLessThan(D.shatterAt);
    expect(D.shatterAt).toBeLessThan(D.healFrom);
    expect(D.healFrom).toBeLessThan(D.healTo);
    expect(D.calmFrom).toBeLessThan(D.calmFull);
    expect(D.sinkTo).toBeLessThan(D.end);
    expect(D.end).toBeGreaterThanOrEqual(6);
    expect(D.end).toBeLessThanOrEqual(10);
  });

  it('freezes her from the heart out, then her light goes with the shatter', () => {
    expect(quenchFrostReach(D.freezeFrom - 0.01)).toBe(-1);
    expect(quenchFrostReach(D.freezeFrom + 0.5)).toBeGreaterThan(0);
    expect(quenchFrostReach(D.frozenAt)).toBe(1);
    const L = newQuenchDeathBodyLook();
    quenchDeathBodyLook(D.bloomTo, L);
    expect(L.heart).toBeGreaterThan(2);
    expect(L.life).toBe(1);
    quenchDeathBodyLook(D.frozenAt, L);
    expect(L.glazeHeight).toBeGreaterThan(1);
    expect(L.eyes).toBe(0);
    quenchDeathBodyLook(D.end, L);
    expect(L.life).toBe(0);
    // The husk stays: still glazed, never gone.
    expect(L.glazeAlpha).toBeGreaterThan(0.5);
  });

  it('drops every blade point first into the ice in turn, then sinks it away', () => {
    const f = { y: 0, tilt: 0, wobble: 0, struck: false, since: 0, sink: 0 };
    const struckAt: number[] = [];
    for (const b of QUENCH_DEATH_BLADES) {
      quenchBladeAt(b, b.dropAt - 0.01, f);
      expect(f.struck).toBe(false);
      expect(f.y).toBeGreaterThan(5);
      let t = b.dropAt;
      while (!quenchBladeAt(b, t, f).struck) t += 0.01;
      struckAt.push(t);
      expect(t).toBeLessThan(D.crackAt);
      quenchBladeAt(b, t + 0.5, f);
      expect(f.y).toBeLessThan(-QUENCH_ENTRANCE_BLADES.length * 0.25);
      quenchBladeAt(b, D.sinkTo, f);
      expect(f.sink).toBe(1);
    }
    // A ragged fall, not all at once.
    expect(new Set(struckAt.map((t) => Math.round(t * 10))).size).toBeGreaterThan(3);
  });

  it('runs the seams out from her heart, holds them a beat, and lets them go at the shatter', () => {
    for (let i = 1; i < QUENCH_SEAMS.length; i++)
      expect(quenchSeamAt(i)).toBeGreaterThan(quenchSeamAt(i - 1));
    expect(QUENCH_SEAMS[0][0]).toBe('heart');
    expect(quenchSeamLevel(D.crackAt - 0.01)).toBe(0);
    expect(quenchSeamLevel(D.shatterAt - 0.1)).toBeGreaterThan(
      quenchSeamLevel(D.crackAt + D.seamsFor),
    );
    expect(quenchSeamLevel(D.shatterAt + 0.2)).toBe(0);
  });

  it('flings each shard out, lands it, skitters it and melts it away', () => {
    const f = { out: 0, y: 0, turn: 0, landed: false, scale: 0 };
    for (const s of QUENCH_SHARDS) {
      expect(quenchShardAt(s, -0.1, 6, f).scale).toBe(0);
      quenchShardAt(s, 0.2, 6, f);
      expect(f.scale).toBeGreaterThan(0);
      quenchShardAt(s, 1.6, 6, f);
      expect(f.landed).toBe(true);
      expect(f.y).toBe(-6);
      const lying = f.out;
      quenchShardAt(s, 2.4, 6, f);
      expect(f.out).toBeGreaterThanOrEqual(lying);
      expect(quenchShardAt(s, 6, 6, f).scale).toBe(0);
    }
  });

  it('heals the lake tips first, then lays the calm sheet and the snow, and fades them', () => {
    const l = { grow: 0, glow: 0, calm: 0, snow: 0, flash: 0 };
    quenchDeathLake(D.webTo, l);
    expect(l.grow).toBe(1);
    quenchDeathLake(D.shatterAt + 0.05, l);
    expect(l.flash).toBeGreaterThan(0.5);
    quenchDeathLake((D.healFrom + D.healTo) / 2, l);
    expect(l.grow).toBeGreaterThan(0);
    expect(l.grow).toBeLessThan(1);
    quenchDeathLake(D.healTo, l);
    expect(l.grow).toBe(0);
    quenchDeathLake(D.calmFull + 0.5, l);
    expect(l.calm).toBe(1);
    expect(l.snow).toBe(1);
    quenchDeathLake(D.end, l);
    expect(l.calm).toBe(0);
    expect(l.snow).toBe(0);
  });
});

describe('the beats, the sounds and the clock', () => {
  it('fires a beat once, only for a scene seen crossing it', () => {
    expect(quenchDeathCrossed(0.9, 1.1, 1)).toBe(true);
    expect(quenchDeathCrossed(1.1, 1.3, 1)).toBe(false);
    expect(quenchDeathCrossed(-1, 40, 1)).toBe(false);
  });

  it('every sound is a shipped sample on a beat inside the scene', () => {
    const keys = new Set<string>(SFX_FIXED_CATALOG_KEYS);
    for (const s of QUENCH_DEATH_SOUNDS) {
      expect(keys.has(s.key), s.key).toBe(true);
      expect(s.at).toBeGreaterThanOrEqual(0);
      expect(s.at).toBeLessThan(D.end);
    }
  });

  it('runs off a death, off a replay on a living body, or not at all', () => {
    expect(quenchDeathTime(10, 4, -1, true)).toBe(6);
    expect(quenchDeathTime(10, 0, 7, false)).toBe(3);
    expect(quenchDeathTime(10 + QUENCH_REPLAY_SECONDS, 0, 10, false)).toBe(-1);
    expect(quenchDeathTime(10, 0, -1, false)).toBe(-1);
  });

  it('calms the light and takes the thuds under reduced motion', () => {
    expect(quenchDeathLight(1.5, true)).toBeLessThan(quenchDeathLight(1.5, false));
    expect(quenchDeathShake(1, 100, 10, true)).toBe(0);
    expect(quenchDeathShake(1, 100, 10, false)).toBeGreaterThan(0);
    expect(quenchDeathKept(0, 0.5)).toBe(true);
    expect(quenchDeathKept(1, 0.5)).toBe(false);
  });
});

describe('the rig', () => {
  it('falls on a replay and holds her knelt', () => {
    const look = SMITH_HEART_BOSS_LOOKS.smith_heart_quench_guardian;
    const fall = look.phaseClips?.[QUENCH_DEATH_GESTURES.fall];
    expect(fall?.enter).toBe('Death');
    expect(fall?.clips).not.toBe(look.clips);
    expect(fall?.clips.idle).toBe('Death');
    expect(fall?.clips.walk).toBe('Death');
  });
});

describe('QuenchDeathFx plays the death', () => {
  afterEach(() => {
    sharedUniforms.uTime.value = 0;
  });

  function setup(reduced = false) {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    const entities = new Map<number, Entity>();
    const mk = (id: number, kind: Entity['kind'], templateId: string, x: number, z: number) =>
      ({
        id,
        kind,
        templateId,
        name: templateId,
        pos: { x, y: 0, z },
        prevPos: { x, y: 0, z },
        facing: 0.2,
        scale: 1,
        hp: 100,
        maxHp: 100,
        dead: false,
        inCombat: false,
        auras: [],
        castingAbility: null,
        castRemaining: 0,
        castTotal: 0,
      }) as unknown as Entity;
    const me = mk(1, 'player', 'warrior', o.x + 194, o.z - 22);
    const boss = mk(2, 'mob', QUENCH_GUARDIAN, o.x + 198, o.z - 2);
    entities.set(me.id, me);
    entities.set(boss.id, boss);
    const world = {
      entities,
      player: me,
      playerId: me.id,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const scene = new THREE.Scene();
    const sent: string[] = [];
    let shakes = 0;
    const fx = new QuenchDeathFx(
      scene,
      () => 0,
      world,
      undefined,
      () => reduced,
      () => {
        shakes++;
      },
      (_id, g) => sent.push(g),
    );
    const step = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 20); i++) {
        sharedUniforms.uTime.value += 0.05;
        fx.update(0.05);
      }
    };
    return { scene, fx, boss, sent, step, entities, shakes: () => shakes };
  }

  const shown = (scene: THREE.Scene, name: string) => {
    const o = scene.getObjectByName(name);
    let v = !!o;
    for (let p: THREE.Object3D | null | undefined = o; p; p = p.parent) v = v && p.visible;
    return v;
  };

  it('a death seen live holds the look her body rides, shatters, and comes to rest', () => {
    const t = setup();
    t.step(1);
    expect(quenchDeathFor(t.boss.id)).toBeNull();
    t.boss.dead = true;
    t.step(D.crackAt + 0.4);
    expect(quenchDeathFor(t.boss.id)?.glazeHeight).toBeGreaterThan(1);
    expect(shown(t.scene, 'smithHeartQuenchDeathBlades')).toBe(true);
    expect(shown(t.scene, 'smithHeartQuenchDeathBladeCracks')).toBe(true);
    expect(shown(t.scene, 'smithHeartQuenchDeathWeb')).toBe(true);
    expect(t.shakes()).toBeGreaterThan(0);
    t.step(D.shatterAt + 0.3 - D.crackAt - 0.4);
    expect(shown(t.scene, 'smithHeartQuenchDeathShards')).toBe(true);
    t.step(D.calmFull + 0.3 - D.shatterAt - 0.3);
    expect(shown(t.scene, 'smithHeartQuenchDeathMirror')).toBe(true);
    // The web healed, the blades sunk away.
    t.step(D.sinkTo + 0.1 - D.calmFull - 0.3);
    expect(shown(t.scene, 'smithHeartQuenchDeathWeb')).toBe(false);
    expect(shown(t.scene, 'smithHeartQuenchDeathBlades')).toBe(false);
    t.step(D.end + 2);
    // At rest: the husk in the calm, nothing of the scene drawn.
    expect(shown(t.scene, 'smithHeartQuenchDeathMirror')).toBe(false);
    expect(shown(t.scene, 'smithHeartQuenchDeathWeb')).toBe(false);
    expect(quenchDeathFor(t.boss.id)?.life).toBe(0);
    expect(quenchDeathFor(t.boss.id)?.glazeAlpha).toBeGreaterThan(0.5);
    t.fx.dispose();
    expect(quenchDeathFor(t.boss.id)).toBeNull();
  });

  it('a body first seen long dead is the husk in the calm, none of the scene', () => {
    const t = setup();
    t.boss.dead = true;
    t.step(1);
    expect(t.fx.sceneTime).toBeGreaterThan(D.end);
    expect(shown(t.scene, 'smithHeartQuenchDeathBlades')).toBe(false);
    expect(shown(t.scene, 'smithHeartQuenchDeathMirror')).toBe(false);
    expect(quenchDeathFor(t.boss.id)?.life).toBe(0);
    expect(t.shakes()).toBe(0);
    t.fx.dispose();
  });

  it('seen alive, gone from view and back dead is the calm, never a late scene', () => {
    const t = setup();
    t.step(1);
    t.entities.delete(t.boss.id);
    t.step(1);
    t.boss.dead = true;
    t.entities.set(t.boss.id, t.boss);
    t.step(0.5);
    expect(t.fx.sceneTime).toBeGreaterThan(D.end);
    expect(t.shakes()).toBe(0);
    t.fx.dispose();
  });

  it('out of view mid-scene and back still dead resumes, never restarts', () => {
    const t = setup();
    t.step(0.5);
    t.boss.dead = true;
    t.step(1);
    const at = t.fx.sceneTime;
    t.entities.delete(t.boss.id);
    t.step(1);
    t.entities.set(t.boss.id, t.boss);
    t.step(0.5);
    expect(t.fx.sceneTime).toBeCloseTo(at + 1.5, 1);
    t.fx.dispose();
  });

  it('emits its particles at world points round the body (the pools ignore a parent)', () => {
    const t = setup();
    t.step(1);
    t.boss.dead = true;
    t.step(1.5);
    const pools: THREE.Mesh[] = [];
    t.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && /^trashEngine(Glow|Smoke)$/.test(m.name)) pools.push(o as THREE.Mesh);
    });
    expect(pools.length).toBeGreaterThanOrEqual(2);
    let near = 0;
    for (const mesh of pools) {
      expect(mesh.parent?.name).toBe('smith-heart-quench-death');
      const born = mesh.geometry.getAttribute('aLife');
      const pos = mesh.geometry.getAttribute('aPos0');
      for (let i = 0; i < born.count; i++) {
        if (born.getX(i) < 0) continue;
        const d = Math.hypot(pos.getX(i) - t.boss.pos.x, pos.getZ(i) - t.boss.pos.z);
        expect(d).toBeLessThan(60);
        near++;
      }
    }
    expect(near).toBeGreaterThan(50);
    t.fx.dispose();
  });

  it('a replay cue is claimed, kneels her living body and stands her back up', () => {
    const t = setup();
    t.step(1);
    const cue = (id: number): SimEvent => ({
      type: 'spellfx',
      sourceId: id,
      targetId: id,
      school: 'arcane',
      fx: 'nova',
      ability: QUENCH_DEV_CUES.deathReplay,
    });
    expect(t.fx.handleEvent(cue(999))).toBe(true);
    expect(t.fx.handleEvent(cue(t.boss.id))).toBe(true);
    t.step(D.shatterAt + 1);
    expect(t.sent).toEqual([QUENCH_DEATH_GESTURES.fall]);
    expect(quenchDeathFor(t.boss.id)?.life).toBe(0);
    t.step(QUENCH_REPLAY_SECONDS);
    expect(quenchDeathFor(t.boss.id)).toBeNull();
    expect(t.sent[t.sent.length - 1]).toBe(QUENCH_BODY_GESTURES.stand);
    expect(t.boss.dead).toBe(false);
    t.fx.dispose();
  });

  it('lets its hold go when her body leaves view, so a replay never strands it', () => {
    const t = setup();
    t.step(1);
    t.fx.handleEvent({
      type: 'spellfx',
      sourceId: t.boss.id,
      targetId: t.boss.id,
      school: 'arcane',
      fx: 'nova',
      ability: QUENCH_DEV_CUES.deathReplay,
    });
    t.step(1);
    expect(quenchDeathFor(t.boss.id)).not.toBeNull();
    t.entities.delete(t.boss.id);
    t.step(0.2);
    expect(quenchDeathFor(t.boss.id)).toBeNull();
    t.fx.dispose();
  });

  it('plays every beat on the low tier and sheds only its named double', () => {
    const restore = gfxInternalsForTest.overrideSettings({ tier: 'low' });
    try {
      const t = setup();
      t.step(0.5);
      t.boss.dead = true;
      t.step(D.shatterAt + 0.3);
      expect(shown(t.scene, 'smithHeartQuenchDeathShards')).toBe(true);
      expect(shown(t.scene, 'smithHeartQuenchDeathBlades')).toBe(true);
      t.step(D.calmFull - D.shatterAt);
      expect(shown(t.scene, 'smithHeartQuenchDeathMirror')).toBe(true);
      for (const layer of QUENCH_DEATH_SECONDARY_LAYERS)
        expect(shown(t.scene, layer), layer).toBe(false);
      t.fx.dispose();
    } finally {
      restore();
    }
  });

  it('the full tier draws its double over the calm sheet', () => {
    const t = setup();
    t.step(0.5);
    t.boss.dead = true;
    t.step(D.calmFull + 0.3);
    expect(shown(t.scene, QUENCH_DEATH_SECONDARY_LAYERS[0])).toBe(true);
    t.fx.dispose();
  });

  it('takes every thud under reduced motion, the scene itself whole', () => {
    const t = setup(true);
    t.step(0.5);
    t.boss.dead = true;
    t.step(D.shatterAt + 0.3);
    expect(t.shakes()).toBe(0);
    expect(shown(t.scene, 'smithHeartQuenchDeathShards')).toBe(true);
    t.fx.dispose();
  });
});

describe('/dev heart quench death', () => {
  it('emits the replay cue on the living guardian and kills nothing', () => {
    const sim = new Sim({ seed: 23, playerClass: 'warrior', autoEquip: false, devCommands: true });
    const dev = (line: string) => handleSmithHeartDevChat(sim.ctx, line, sim.player.id);
    sim.setPlayerLevel(20);
    expect(dev('/dev heart tp ice')).toBe(true);
    sim.tick();
    const DUNGEON = DUNGEONS[SMITH_HEART_DUNGEON];
    const inst: InstanceSlot | undefined = sim.ctx.instances.find((i) => {
      if (i.dungeonId !== SMITH_HEART_DUNGEON || i.partyKey === null || i.exitId === null)
        return false;
      const o = instanceOrigin(DUNGEON.index, i.slot);
      return Math.abs(sim.player.pos.x - o.x) < 300 && Math.abs(sim.player.pos.z - o.z) < 250;
    });
    if (!inst) throw new Error('no claim');
    const boss = quenchGuardian(sim.ctx, inst);
    if (!boss) throw new Error('no guardian');
    const hp = boss.hp;
    expect(dev('/dev heart quench death')).toBe(true);
    const events = sim.tick();
    expect(
      events.some(
        (e) =>
          e.type === 'spellfx' &&
          e.ability === QUENCH_DEV_CUES.deathReplay &&
          e.sourceId === boss.id,
      ),
    ).toBe(true);
    expect(boss.dead).toBe(false);
    expect(boss.hp).toBe(hp);
    expect(boss.inCombat).toBe(false);
  });

  it('the cue makes no sound of its own (the scene plays its own)', () => {
    expect(quenchSoundClaims(QUENCH_DEV_CUES.deathReplay)).toBe(true);
  });
});
