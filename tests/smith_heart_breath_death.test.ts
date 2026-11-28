// The Guardian of the Breath's death, "The storm loses its anchor"
// (src/render/smith_heart_fx/breath_death_core.ts, painted by
// breath_death_fx.ts, ridden by breath_body.ts through breath_death_state.ts):
//   - the timeline in order, inside the 6 to 10 seconds asked for;
//   - the streams wind in to its heart; the arcs run wild, then sputter
//     (dimmer, further apart) and stop; the body is drawn tight, then flung
//     out and gone; the cloud parts, the shaft of light falls and fades; the
//     wind over the isle dies to stillness;
//   - every sound a shipped sample; the clock: a death, a replay, neither;
//   - the rig: a replay's fall plays the Death clip and holds it down;
//   - BreathDeathFx over a fake world: a death seen live holds the look the
//     body rides; one first seen long dead is the calm after, none of the
//     scene; out of view and back it resumes; a replay cue is claimed, falls
//     the living body and gives the wind back; the particles are world
//     points; the low tier sheds only its named double; reduced motion takes
//     the thuds;
//   - `/dev heart breath death` over a real Sim emits the cue and kills
//     nothing; the cue makes no sound of its own.

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { SFX_FIXED_CATALOG_KEYS } from '../src/game/sfx_manifest.generated';
import { breathSoundClaims } from '../src/game/smith_heart_breath_audio_core';
import { SMITH_HEART_BOSS_LOOKS } from '../src/render/characters/smith_heart_boss_looks';
import { gfxInternalsForTest, sharedUniforms } from '../src/render/gfx';
import { BreathDeathFx } from '../src/render/smith_heart_fx';
import {
  BREATH_DEATH,
  BREATH_DEATH_ARCS,
  BREATH_DEATH_GESTURES,
  BREATH_DEATH_SHAPE,
  BREATH_DEATH_SOUNDS,
  BREATH_DEATH_STREAMS,
  BREATH_REPLAY_SECONDS,
  breathArenaWind,
  breathDeathArcLight,
  breathDeathArcRate,
  breathDeathBodyLook,
  breathDeathCrossed,
  breathDeathKept,
  breathDeathLight,
  breathDeathShake,
  breathDeathSky,
  breathDeathTime,
  breathStreamHead,
  newBreathDeathBodyLook,
} from '../src/render/smith_heart_fx/breath_death_core';
import { breathDeathFor } from '../src/render/smith_heart_fx/breath_death_state';
import { BREATH_DEATH_SECONDARY_LAYERS } from '../src/render/smith_heart_fx/entrance_budget_core';
import { SMITH_HEART_DUNGEON } from '../src/sim/content/smith_heart';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { handleSmithHeartDevChat } from '../src/sim/dev/smith_heart_dev';
import { breathGuardian } from '../src/sim/encounters/smith_heart';
import { BREATH_DEV_CUES, BREATH_GUARDIAN } from '../src/sim/encounters/smith_heart/breath_ids';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const D = BREATH_DEATH;

describe('the timeline', () => {
  it('runs its beats in order, inside the 6 to 10 seconds asked for', () => {
    expect(D.streamFrom).toBeLessThan(D.pullTo);
    expect(D.wildFrom).toBeLessThan(D.sputterFrom);
    expect(D.sputterFrom).toBeLessThan(D.arcsTo);
    expect(D.unravelFrom).toBeLessThan(D.clapAt);
    expect(D.clapAt).toBeLessThan(D.partFrom);
    expect(D.partFrom).toBeLessThan(D.partTo);
    expect(D.shaftFrom).toBeLessThan(D.shaftFull);
    expect(D.stillTo).toBeLessThan(D.end);
    expect(D.end).toBeGreaterThanOrEqual(6);
    expect(D.end).toBeLessThanOrEqual(10);
    // Every stream is home before the body comes apart.
    for (const s of BREATH_DEATH_STREAMS) expect(s.at + D.streamTravel).toBeLessThan(D.unravelFrom);
  });

  it('winds every stream in, tightening, into its heart', () => {
    const h = { x: 0, y: 0, z: 0, k: 0 };
    for (const s of BREATH_DEATH_STREAMS) {
      breathStreamHead(s, s.at - 0.01, h);
      expect(h.k).toBe(-1);
      let lastR = Number.POSITIVE_INFINITY;
      for (let k = 0.05; k <= 1; k += 0.1) {
        breathStreamHead(s, s.at + k * D.streamTravel, h);
        const r = Math.hypot(h.x, h.z);
        expect(r).toBeLessThan(lastR + 1e-6);
        lastR = r;
      }
      breathStreamHead(s, s.at + D.streamTravel - 1e-4, h);
      expect(Math.hypot(h.x, h.z)).toBeLessThan(1);
      expect(h.y).toBeCloseTo(BREATH_DEATH_SHAPE.heartY, 2);
    }
  });

  it('runs its arcs wild, then sputters them dimmer and further apart, then stops', () => {
    const wild = BREATH_DEATH_ARCS.filter((a) => a.at < D.sputterFrom);
    const sput = BREATH_DEATH_ARCS.filter((a) => a.at >= D.sputterFrom);
    expect(wild.length).toBeGreaterThan(sput.length);
    expect(sput.length).toBeGreaterThan(2);
    for (let i = 1; i < sput.length; i++) {
      expect(sput[i].light).toBeLessThanOrEqual(sput[i - 1].light + 1e-9);
      expect(sput[i].life).toBeLessThan(0.3);
    }
    const gapWild = (wild[wild.length - 1].at - wild[0].at) / (wild.length - 1);
    const gapSput = (sput[sput.length - 1].at - sput[0].at) / Math.max(1, sput.length - 1);
    expect(gapSput).toBeGreaterThan(gapWild * 2);
    for (const a of BREATH_DEATH_ARCS) expect(a.at + a.life).toBeLessThanOrEqual(D.arcsTo + 0.35);
    expect(breathDeathArcRate(1.2)).toBeGreaterThan(breathDeathArcRate(D.sputterFrom + 1));
    expect(breathDeathArcRate(D.arcsTo + 0.1)).toBe(0);
    // Reduced motion: one fading stroke, never re-struck brighter.
    const a = BREATH_DEATH_ARCS[0];
    expect(breathDeathArcLight(a, a.at + a.life * 0.5, true)).toBeLessThan(
      breathDeathArcLight(a, a.at + a.life * 0.1, true),
    );
  });

  it('draws the body in tight, then flings it out and lets its light go at the clap', () => {
    const L = newBreathDeathBodyLook();
    breathDeathBodyLook(D.pullTo, L);
    expect(L.radius).toBeLessThan(0.7);
    expect(L.spin).toBeGreaterThan(2);
    expect(L.wind).toBe(1);
    expect(L.glow).toBe(1);
    breathDeathBodyLook(D.clapAt, L);
    expect(L.fling).toBeGreaterThan(1.5);
    breathDeathBodyLook(D.end, L);
    expect(L.wind).toBe(0);
    expect(L.glow).toBe(0);
    expect(L.drop).toBe(1);
    expect(L.arcs).toBe(0);
  });

  it('parts the cloud, lets the light fall and fade, and stills the wind', () => {
    const s = { deck: 0, open: 0, rim: 0, shaft: 0, clap: 0 };
    breathDeathSky(D.deckIn, s);
    expect(s.deck).toBe(1);
    expect(s.open).toBe(0);
    expect(s.shaft).toBe(0);
    breathDeathSky(D.clapAt + 0.05, s);
    expect(s.clap).toBeGreaterThan(0.5);
    breathDeathSky((D.partFrom + D.partTo) / 2, s);
    expect(s.open).toBeGreaterThan(0.3);
    expect(s.rim).toBeGreaterThan(0.5);
    breathDeathSky(D.shaftFull + 0.2, s);
    expect(s.shaft).toBe(1);
    breathDeathSky(D.end, s);
    expect(s.shaft).toBe(0);
    expect(s.deck).toBe(0);
    expect(breathArenaWind(0)).toBe(1);
    expect(breathArenaWind(D.stillFrom + 2)).toBeLessThan(breathArenaWind(D.stillFrom + 1));
    expect(breathArenaWind(D.stillTo)).toBe(0);
  });
});

describe('the beats, the sounds and the clock', () => {
  it('fires a beat once, only for a scene seen crossing it', () => {
    expect(breathDeathCrossed(0.9, 1.1, 1)).toBe(true);
    expect(breathDeathCrossed(1.1, 1.3, 1)).toBe(false);
    expect(breathDeathCrossed(-1, 40, 1)).toBe(false);
  });

  it('every sound is a shipped sample on a beat inside the scene', () => {
    const keys = new Set<string>(SFX_FIXED_CATALOG_KEYS);
    for (const s of BREATH_DEATH_SOUNDS) {
      expect(keys.has(s.key), s.key).toBe(true);
      expect(s.at).toBeGreaterThanOrEqual(0);
      expect(s.at).toBeLessThan(D.end);
    }
  });

  it('runs off a death, off a replay on a living body, or not at all', () => {
    expect(breathDeathTime(10, 4, -1, true)).toBe(6);
    expect(breathDeathTime(10, 0, 7, false)).toBe(3);
    expect(breathDeathTime(10 + BREATH_REPLAY_SECONDS, 0, 10, false)).toBe(-1);
    expect(breathDeathTime(10, 0, -1, false)).toBe(-1);
  });

  it('calms the light and takes the thuds under reduced motion', () => {
    expect(breathDeathLight(1.5, true)).toBeLessThan(breathDeathLight(1.5, false));
    expect(breathDeathShake(1, 100, 10, true)).toBe(0);
    expect(breathDeathShake(1, 100, 10, false)).toBeGreaterThan(0);
    expect(breathDeathShake(1, 100, 120, false)).toBe(0);
    expect(breathDeathKept(0, 0.5)).toBe(true);
    expect(breathDeathKept(1, 0.5)).toBe(false);
  });
});

describe('the rig', () => {
  it('falls on a replay and holds the fall down', () => {
    const look = SMITH_HEART_BOSS_LOOKS.smith_heart_breath_guardian;
    const fall = look.phaseClips?.[BREATH_DEATH_GESTURES.fall];
    expect(fall?.enter).toBe('Death');
    expect(fall?.clips).not.toBe(look.clips);
    expect(fall?.clips.idle).toBe('Death');
    expect(fall?.clips.walk).toBe('Death');
  });
});

describe('BreathDeathFx plays the death', () => {
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
    const me = mk(1, 'player', 'warrior', o.x - 30, o.z + 194);
    const boss = mk(2, 'mob', BREATH_GUARDIAN, o.x, o.z + 198);
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
    const fx = new BreathDeathFx(
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

  it('a death seen live holds the look the body rides, parts the cloud, and comes to rest', () => {
    const t = setup();
    t.step(1);
    expect(breathDeathFor(t.boss.id)).toBeNull();
    t.boss.dead = true;
    t.step(1);
    expect(breathDeathFor(t.boss.id)?.radius).toBeLessThan(1);
    expect(shown(t.scene, 'smithHeartBreathDeathDeck')).toBe(true);
    expect(t.shakes()).toBeGreaterThan(0);
    t.step(D.shaftFull + 0.3 - 1);
    expect(shown(t.scene, 'smithHeartBreathDeathShaft')).toBe(true);
    t.step(D.end + 2);
    // At rest: the calm (no cloud, no shaft), the body's air gone.
    expect(shown(t.scene, 'smithHeartBreathDeathDeck')).toBe(false);
    expect(shown(t.scene, 'smithHeartBreathDeathShaft')).toBe(false);
    expect(breathDeathFor(t.boss.id)?.wind).toBe(0);
    t.fx.dispose();
    expect(breathDeathFor(t.boss.id)).toBeNull();
  });

  it('a body first seen long dead is the calm after, none of the scene', () => {
    const t = setup();
    t.boss.dead = true;
    t.step(1);
    expect(t.fx.sceneTime).toBeGreaterThan(D.end);
    expect(shown(t.scene, 'smithHeartBreathDeathDeck')).toBe(false);
    expect(shown(t.scene, 'smithHeartBreathDeathShaft')).toBe(false);
    expect(breathDeathFor(t.boss.id)?.glow).toBe(0);
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
      expect(mesh.parent?.name).toBe('smith-heart-breath-death');
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

  it('a replay cue is claimed, falls the living body and gives the wind back', () => {
    const t = setup();
    t.step(1);
    const cue = (id: number): SimEvent => ({
      type: 'spellfx',
      sourceId: id,
      targetId: id,
      school: 'arcane',
      fx: 'nova',
      ability: BREATH_DEV_CUES.deathReplay,
    });
    expect(t.fx.handleEvent(cue(999))).toBe(true);
    expect(t.fx.handleEvent(cue(t.boss.id))).toBe(true);
    t.step(D.clapAt + 1);
    expect(t.sent).toEqual([BREATH_DEATH_GESTURES.fall]);
    expect(breathDeathFor(t.boss.id)?.glow).toBe(0);
    t.step(BREATH_REPLAY_SECONDS);
    expect(breathDeathFor(t.boss.id)).toBeNull();
    expect(t.boss.dead).toBe(false);
    t.fx.dispose();
  });

  it('plays every beat on the low tier and sheds only its named double', () => {
    const restore = gfxInternalsForTest.overrideSettings({ tier: 'low' });
    try {
      const t = setup();
      t.step(0.5);
      t.boss.dead = true;
      t.step(D.shaftFull + 0.3);
      expect(shown(t.scene, 'smithHeartBreathDeathShaft')).toBe(true);
      expect(shown(t.scene, 'smithHeartBreathDeathDeck')).toBe(true);
      for (const layer of BREATH_DEATH_SECONDARY_LAYERS)
        expect(shown(t.scene, layer), layer).toBe(false);
      t.fx.dispose();
    } finally {
      restore();
    }
  });

  it('the full tier draws its double while the light falls', () => {
    const t = setup();
    t.step(0.5);
    t.boss.dead = true;
    t.step(D.shaftFull + 0.3);
    expect(shown(t.scene, BREATH_DEATH_SECONDARY_LAYERS[0])).toBe(true);
    t.fx.dispose();
  });

  it('takes every thud under reduced motion, the scene itself whole', () => {
    const t = setup(true);
    t.step(0.5);
    t.boss.dead = true;
    t.step(D.shaftFull + 0.3);
    expect(t.shakes()).toBe(0);
    expect(shown(t.scene, 'smithHeartBreathDeathShaft')).toBe(true);
    t.fx.dispose();
  });
});

describe('/dev heart breath death', () => {
  it('emits the replay cue on the living guardian and kills nothing', () => {
    const sim = new Sim({ seed: 23, playerClass: 'warrior', autoEquip: false, devCommands: true });
    const dev = (line: string) => handleSmithHeartDevChat(sim.ctx, line, sim.player.id);
    sim.setPlayerLevel(20);
    expect(dev('/dev heart tp breath')).toBe(true);
    sim.tick();
    const DUNGEON = DUNGEONS[SMITH_HEART_DUNGEON];
    const inst: InstanceSlot | undefined = sim.ctx.instances.find((i) => {
      if (i.dungeonId !== SMITH_HEART_DUNGEON || i.partyKey === null || i.exitId === null)
        return false;
      const o = instanceOrigin(DUNGEON.index, i.slot);
      return Math.abs(sim.player.pos.x - o.x) < 300 && Math.abs(sim.player.pos.z - o.z) < 250;
    });
    if (!inst) throw new Error('no claim');
    const boss = breathGuardian(sim.ctx, inst);
    if (!boss) throw new Error('no guardian');
    const hp = boss.hp;
    expect(dev('/dev heart breath death')).toBe(true);
    const events = sim.tick();
    expect(
      events.some(
        (e) =>
          e.type === 'spellfx' &&
          e.ability === BREATH_DEV_CUES.deathReplay &&
          e.sourceId === boss.id,
      ),
    ).toBe(true);
    expect(boss.dead).toBe(false);
    expect(boss.hp).toBe(hp);
    expect(boss.inCombat).toBe(false);
  });

  it('the cue makes no sound of its own (the scene plays its own)', () => {
    expect(breathSoundClaims(BREATH_DEV_CUES.deathReplay)).toBe(true);
  });
});
