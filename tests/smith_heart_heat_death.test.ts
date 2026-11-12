// The Guardian of the Heat's death, "The fire goes home"
// (src/render/smith_heart_fx/heat_death_core.ts, painted by heat_death_fx.ts,
// riding the entrance's seam heat_entrance_state.ts and the skin of
// heat_coal_skin.ts):
//   - the timeline in order, inside the 6 to 10 seconds asked for;
//   - the flames go out crown first (the entrance lit them foot to crown);
//     the skin blazes white-hot, then cools to black coal; the cracks die one
//     by one, the heart's last; the chunks land and lie; the wellspring
//     crusts over;
//   - every sound a shipped sample; the clock: a death, a replay, neither;
//   - the rig: no fade of its own, a replay's fall plays the Death clip;
//   - HeatDeathFx over a fake world: a death seen live holds the look the
//     body and the wellspring ride; a body first seen long dead is a cold
//     husk with none of the scene; out of view mid-scene and back, it
//     resumes; a replay cue is claimed, falls the living body and gives the
//     fire back; the low tier sheds only its named double; reduced motion
//     takes the thuds;
//   - `/dev heart heat death` over a real Sim emits the cue and kills
//     nothing; the cue makes no sound of its own.

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { SFX_FIXED_CATALOG_KEYS } from '../src/game/sfx_manifest.generated';
import { heatSoundClaims } from '../src/game/smith_heart_heat_audio_core';
import { SMITH_HEART_BOSS_LOOKS } from '../src/render/characters/smith_heart_boss_looks';
import { gfxInternalsForTest, sharedUniforms } from '../src/render/gfx';
import { HeatDeathFx } from '../src/render/smith_heart_fx';
import { HEAT_DEATH_SECONDARY_LAYERS } from '../src/render/smith_heart_fx/entrance_budget_core';
import { HEAT_SOCKETS, heatSocketIndex } from '../src/render/smith_heart_fx/heat_body_core';
import {
  HEAT_CHUNKS,
  HEAT_CRACKS,
  HEAT_DEATH,
  HEAT_DEATH_GESTURES,
  HEAT_DEATH_SOUNDS,
  HEAT_REPLAY_SECONDS,
  heatChokeRing,
  heatChunkAt,
  heatCrackLevel,
  heatDeathBodyLook,
  heatDeathCrossed,
  heatDeathKept,
  heatDeathLight,
  heatDeathShake,
  heatDeathSkin,
  heatDeathTime,
  socketOutAt,
} from '../src/render/smith_heart_fx/heat_death_core';
import { newHeatEntranceLook } from '../src/render/smith_heart_fx/heat_entrance_core';
import { heatEntranceFor } from '../src/render/smith_heart_fx/heat_entrance_state';
import { SMITH_HEART_DUNGEON } from '../src/sim/content/smith_heart';
import { HEARTH_WELL } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { handleSmithHeartDevChat } from '../src/sim/dev/smith_heart_dev';
import { heatGuardian } from '../src/sim/encounters/smith_heart';
import { HEAT_DEV_CUES, HEAT_GUARDIAN } from '../src/sim/encounters/smith_heart/heat_ids';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe('the timeline', () => {
  it('runs its beats in order, inside the 6 to 10 seconds asked for', () => {
    const D = HEAT_DEATH;
    expect(D.chokeTo).toBeLessThan(D.gutterTo);
    expect(D.gutterFrom).toBeLessThan(D.gutterTo);
    expect(D.hotAt).toBeLessThan(D.redAt);
    expect(D.redAt).toBeLessThan(D.coldAt);
    expect(D.gutterTo).toBeLessThan(D.exhaleAt);
    expect(D.coldAt).toBeLessThanOrEqual(D.cracksFrom);
    expect(D.cracksTo).toBeLessThan(D.end);
    expect(D.crumbleAt).toBeLessThan(D.end);
    expect(D.end).toBeGreaterThanOrEqual(6);
    expect(D.end).toBeLessThanOrEqual(10);
  });

  it('puts its flames out from the crown down, every one by the gutter end', () => {
    const crown = heatSocketIndex('crown');
    const fist = heatSocketIndex('fistL');
    const vortex = heatSocketIndex('vortexMid');
    expect(socketOutAt(crown)).toBeLessThan(socketOutAt(fist));
    expect(socketOutAt(fist)).toBeLessThan(socketOutAt(vortex));
    const look = heatDeathBodyLook(HEAT_DEATH.gutterTo + 0.05, newHeatEntranceLook());
    expect(look.active).toBe(true);
    for (let i = 0; i < HEAT_SOCKETS.length; i++) expect(look.socket[i]).toBe(0);
    expect(look.fire).toBe(0);
    // The flames roar a breath as the fire is drawn in.
    const early = heatDeathBodyLook(0.3, newHeatEntranceLook());
    expect(Math.max(...early.socket)).toBeGreaterThan(1);
  });

  it('blazes white-hot, cools through red to black coal, and crusts the wellspring', () => {
    const s = { glow: 0, coal: 0 };
    heatDeathSkin(HEAT_DEATH.hotAt, s);
    expect(s.glow).toBeGreaterThan(3);
    expect(s.coal).toBeGreaterThan(1.4);
    heatDeathSkin(HEAT_DEATH.redAt, s);
    expect(s.glow).toBeGreaterThan(0.6);
    expect(s.glow).toBeLessThan(1.2);
    heatDeathSkin(500, s);
    expect(s.glow).toBeLessThan(0.05);
    expect(s.coal).toBeCloseTo(0.24, 5);
    const late = heatDeathBodyLook(500, newHeatEntranceLook());
    expect(late.well).toBeCloseTo(0.14, 5);
    expect(late.eyes).toBe(0);
    expect(late.vortex).toBe(0);
  });

  it('closes its ring of fire in onto the body through the choke', () => {
    const r = { r: 0, k: 0 };
    const a = heatChokeRing(0.2, r).r;
    const b = heatChokeRing(1.0, r).r;
    expect(b).toBeLessThan(a);
    expect(heatChokeRing(HEAT_DEATH.chokeTo, r).k).toBe(0);
  });

  it('lets each crack die once, the heart last, all dark by the end', () => {
    const heart = HEAT_CRACKS.find((c) => c.socket === heatSocketIndex('heart'));
    for (const c of HEAT_CRACKS) {
      expect(c.outAt).toBeGreaterThanOrEqual(HEAT_DEATH.cracksFrom);
      expect(c.outAt).toBeLessThanOrEqual(heart?.outAt ?? 0);
      expect(heatCrackLevel(c, HEAT_DEATH.coldAt)).toBeGreaterThan(0.5);
      expect(heatCrackLevel(c, c.outAt + 0.3)).toBe(0);
    }
    const outs = new Set(HEAT_CRACKS.map((c) => c.outAt.toFixed(3)));
    expect(outs.size).toBeGreaterThan(HEAT_CRACKS.length / 2);
  });

  it('drops every chunk of the husk to the floor, where it lies', () => {
    const f = { out: 0, y: 0, turn: 0, landed: false, shown: false };
    for (const c of HEAT_CHUNKS) {
      heatChunkAt(c, 30, 5, f);
      expect(f.landed).toBe(true);
      expect(f.y).toBeCloseTo(-5, 5);
      expect(heatChunkAt(c, -1, 5, f).shown).toBe(false);
    }
    expect(HEAT_CHUNKS.filter((_, i) => heatDeathKept(i, 0.4)).length).toBeLessThan(
      HEAT_CHUNKS.length,
    );
  });
});

describe('the beats, the sounds and the clock', () => {
  it('fires a beat once, only for a scene seen crossing it', () => {
    expect(heatDeathCrossed(2.9, 3.0, 2.95)).toBe(true);
    expect(heatDeathCrossed(-1, 30, 2.95)).toBe(false);
    expect(heatDeathCrossed(20, 30, 2.95)).toBe(false);
  });

  it('every sound is a shipped sample on a beat inside the scene', () => {
    for (const s of HEAT_DEATH_SOUNDS) {
      expect(SFX_FIXED_CATALOG_KEYS, s.key).toContain(s.key);
      expect(s.at).toBeGreaterThanOrEqual(0);
      expect(s.at).toBeLessThan(HEAT_DEATH.end);
    }
  });

  it('runs off a death, off a replay on a living body, or not at all', () => {
    expect(heatDeathTime(10, 7, -1, true)).toBe(3);
    expect(heatDeathTime(10, 0, 8, false)).toBe(2);
    expect(heatDeathTime(30, 0, 8, false)).toBe(-1);
    expect(heatDeathTime(10, 0, -1, false)).toBe(-1);
  });

  it('calms the light and takes the thuds under reduced motion', () => {
    expect(heatDeathLight(3, true)).toBeLessThan(1);
    expect(heatDeathLight(3, false)).toBe(3);
    expect(heatDeathShake(0.5, 100, 10, true)).toBe(0);
    expect(heatDeathShake(0.5, 100, 10, false)).toBeGreaterThan(0);
  });
});

describe('the rig', () => {
  const look = SMITH_HEART_BOSS_LOOKS.smith_heart_heat_guardian;
  it('keeps no fade of its own (the scene writes its skin) and falls on a replay', () => {
    expect(look.glowPulses?.deathFade).toBeUndefined();
    const fall = look.phaseClips?.[HEAT_DEATH_GESTURES.fall];
    expect(fall?.enter).toBe('Death');
    // Its own vocabulary object, so the swap is never a no-op over the stand.
    expect(fall?.clips).not.toBe(look.clips);
  });
});

describe('HeatDeathFx plays the death', () => {
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
    const me = mk(1, 'player', 'warrior', o.x + HEARTH_WELL.x, o.z + HEARTH_WELL.z - 20);
    const boss = mk(2, 'mob', HEAT_GUARDIAN, o.x + HEARTH_WELL.x, o.z + HEARTH_WELL.z);
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
    const fx = new HeatDeathFx(
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

  it('a death seen live holds the look the body and the wellspring ride', () => {
    const t = setup();
    t.step(1);
    expect(heatEntranceFor(t.boss.id)).toBeNull();
    t.boss.dead = true;
    t.step(0.5);
    const held = heatEntranceFor(t.boss.id);
    expect(held?.active).toBe(true);
    expect(held?.fire).toBe(1);
    expect(t.shakes()).toBeGreaterThan(0);
    t.step(HEAT_DEATH.crumbleAt + 0.5 - 0.5);
    expect(heatEntranceFor(t.boss.id)?.fire).toBe(0);
    expect(shown(t.scene, 'smithHeartHeatDeathChunks')).toBe(true);
    t.step(HEAT_DEATH.end);
    // Long after: still a cold husk, the wellspring crusted.
    expect(heatEntranceFor(t.boss.id)?.coal).toBeCloseTo(0.24, 3);
    expect(heatEntranceFor(t.boss.id)?.well).toBeCloseTo(0.14, 3);
    t.fx.dispose();
    expect(heatEntranceFor(t.boss.id)).toBeNull();
  });

  it('a body first seen long dead is a cold husk with none of the scene', () => {
    const t = setup();
    t.boss.dead = true;
    t.step(2);
    expect(heatEntranceFor(t.boss.id)?.coal).toBeCloseTo(0.24, 3);
    expect(shown(t.scene, 'smithHeartHeatDeathLight')).toBe(false);
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

  it('a replay cue is claimed, falls the living body and gives the fire back', () => {
    const t = setup();
    t.step(1);
    const cue = (id: number): SimEvent => ({
      type: 'spellfx',
      sourceId: id,
      targetId: id,
      school: 'arcane',
      fx: 'nova',
      ability: HEAT_DEV_CUES.deathReplay,
    });
    expect(t.fx.handleEvent(cue(999))).toBe(true);
    expect(t.fx.handleEvent(cue(t.boss.id))).toBe(true);
    t.step(HEAT_DEATH.gutterTo + 0.2);
    expect(t.sent).toContain(HEAT_DEATH_GESTURES.fall);
    expect(heatEntranceFor(t.boss.id)?.fire).toBe(0);
    t.step(HEAT_REPLAY_SECONDS);
    expect(heatEntranceFor(t.boss.id)).toBeNull();
    expect(t.boss.dead).toBe(false);
    t.fx.dispose();
  });

  it('plays every beat on the low tier and sheds only its named double', () => {
    const restore = gfxInternalsForTest.overrideSettings({ tier: 'low' });
    try {
      const t = setup();
      t.step(0.5);
      t.boss.dead = true;
      t.step(HEAT_DEATH.hotAt);
      expect(shown(t.scene, 'smithHeartHeatDeathLight')).toBe(true);
      for (const layer of HEAT_DEATH_SECONDARY_LAYERS)
        expect(shown(t.scene, layer), layer).toBe(false);
      t.fx.dispose();
    } finally {
      restore();
    }
  });

  it('the full tier draws its double while it blazes white-hot', () => {
    const t = setup();
    t.step(0.5);
    t.boss.dead = true;
    t.step(HEAT_DEATH.hotAt);
    expect(shown(t.scene, HEAT_DEATH_SECONDARY_LAYERS[0])).toBe(true);
    t.fx.dispose();
  });

  it('takes every thud under reduced motion, the scene itself whole', () => {
    const t = setup(true);
    t.step(0.5);
    t.boss.dead = true;
    t.step(HEAT_DEATH.crumbleAt + 0.5);
    expect(t.shakes()).toBe(0);
    expect(shown(t.scene, 'smithHeartHeatDeathChunks')).toBe(true);
    t.fx.dispose();
  });
});

describe('/dev heart heat death', () => {
  it('emits the replay cue on the living guardian and kills nothing', () => {
    const sim = new Sim({ seed: 23, playerClass: 'warrior', autoEquip: false, devCommands: true });
    const dev = (line: string) => handleSmithHeartDevChat(sim.ctx, line, sim.player.id);
    sim.setPlayerLevel(20);
    expect(dev('/dev heart tp heat')).toBe(true);
    sim.tick();
    const DUNGEON = DUNGEONS[SMITH_HEART_DUNGEON];
    const inst: InstanceSlot | undefined = sim.ctx.instances.find((i) => {
      if (i.dungeonId !== SMITH_HEART_DUNGEON || i.partyKey === null || i.exitId === null)
        return false;
      const o = instanceOrigin(DUNGEON.index, i.slot);
      return Math.abs(sim.player.pos.x - o.x) < 300 && Math.abs(sim.player.pos.z - o.z) < 250;
    });
    if (!inst) throw new Error('no claim');
    const boss = heatGuardian(sim.ctx, inst);
    if (!boss) throw new Error('no guardian');
    const hp = boss.hp;
    expect(dev('/dev heart heat death')).toBe(true);
    const events = sim.tick();
    expect(
      events.some(
        (e) =>
          e.type === 'spellfx' && e.ability === HEAT_DEV_CUES.deathReplay && e.sourceId === boss.id,
      ),
    ).toBe(true);
    expect(boss.dead).toBe(false);
    expect(boss.hp).toBe(hp);
    expect(boss.inCombat).toBe(false);
  });

  it('the cue makes no sound of its own (the scene plays its own)', () => {
    expect(heatSoundClaims(HEAT_DEV_CUES.deathReplay)).toBe(true);
  });
});
