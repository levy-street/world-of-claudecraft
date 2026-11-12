// The Masterless Strength's death, "The essence escapes" (Jose's lore idea,
// 2026-11-12; src/render/smith_heart_fx/final_death_core.ts, painted by
// final_death_fx.ts, hosted by final_fx.ts):
//   - the timeline's beats in order and inside the 6 to 10 seconds asked for;
//   - the crystal torn out at the tear and gone at the split; each comet
//     arcing to its own groove's head, racing down its spiral (never back),
//     winding up over the well into one core that dives under the floor;
//   - the grooves burning behind their comets, cooling to embers, dying out;
//     the room going dark from the impact (heart_final_core.ts);
//   - the broken stone: a fixed plan that lands on the floor and thins on
//     the low tier;
//   - every sound a shipped sample on a beat inside the scene;
//   - the clock: a death, a dev replay, neither;
//   - the rig: the corpse kneels (its Kneel clip is its death clip), the
//     cracks blaze and the husk darkens through glow pulses;
//   - FinalFx over a fake world: a death seen live plays the whole scene
//     (the gestures, the trails, the crystal, the room's light memory) and
//     leaves a husk; a body first seen long dead shows none of it; a dev
//     replay cue is claimed, kneels the living body and stands it back up;
//     the low tier plays every beat and sheds only its named doubles;
//   - `/dev heart final death` over a real Sim emits the cue and kills
//     nothing; the cue makes no sound of its own.

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { SFX_FIXED_CATALOG_KEYS } from '../src/game/sfx_manifest.generated';
import { finalSoundClaims } from '../src/game/smith_heart_final_audio_core';
import { GlowPulse } from '../src/render/characters/glow_pulse';
import {
  MASTERLESS_STRENGTH_CLIPS,
  SMITH_HEART_BOSS_LOOKS,
} from '../src/render/characters/smith_heart_boss_looks';
import { gfxInternalsForTest, sharedUniforms } from '../src/render/gfx';
import {
  clearHeartArrivalLightForTest,
  heartArrivalFlare,
  heartArrivalVein,
} from '../src/render/smith_heart/heart_arrival_light_core';
import {
  clearHeartFinalMemoryForTest,
  HEART_FINAL_DARK,
  heartFinalDarkness,
} from '../src/render/smith_heart/heart_final_core';
import { heartSealSlotKey, observeHeartSealMask } from '../src/render/smith_heart/heart_seal_core';
import { FinalFx } from '../src/render/smith_heart_fx';
import { DEATH_SECONDARY_LAYERS } from '../src/render/smith_heart_fx/entrance_budget_core';
import { FINAL_BODY_GESTURES } from '../src/render/smith_heart_fx/final_body_core';
import {
  DEATH_DEBRIS,
  DEATH_END,
  DEATH_GATHER,
  DEATH_GESTURES,
  DEATH_HOVER_AT,
  DEATH_HUSK_SHADE,
  DEATH_IMPACT,
  DEATH_MERGE,
  DEATH_PLUNGE_DEPTH,
  DEATH_REPLAY_SECONDS,
  DEATH_SOUNDS,
  DEATH_SPLIT,
  DEATH_TEAR,
  DEATH_THROB,
  DEATH_VEINS,
  deathAltarLevel,
  deathComet,
  deathCore,
  deathCrystal,
  deathDebrisAt,
  deathDebrisKept,
  deathFlyStart,
  deathGroovePath,
  deathHusk,
  deathLandAt,
  deathRaceEnd,
  deathRaceFront,
  deathRaceStart,
  deathSceneTime,
  deathTrail,
  deathWell,
} from '../src/render/smith_heart_fx/final_death_core';
import { FINAL_BOSS } from '../src/render/smith_heart_fx/final_fx_core';
import { SMITH_HEART_DUNGEON } from '../src/sim/content/smith_heart';
import { HEART_ROOM } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { handleSmithHeartDevChat } from '../src/sim/dev/smith_heart_dev';
import { smithHeartFinalBoss } from '../src/sim/dev/smith_heart_final_dev';
import {
  SMITH_HEART_AWAKE_BIT,
  SMITH_HEART_PORTAL_BIT,
  SMITH_HEART_SEAL_FULL,
} from '../src/sim/encounters/smith_heart';
import { FINAL_DEV_CUES } from '../src/sim/encounters/smith_heart/final_ids';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const ground = () => 0;
const HOVER = { x: HEART_ROOM.x + 3, y: 22, z: HEART_ROOM.z - 2 };

describe("the death's timeline", () => {
  it('runs its beats in order, inside the 6 to 10 seconds asked for', () => {
    const beats = [
      0,
      DEATH_TEAR,
      DEATH_HOVER_AT,
      DEATH_SPLIT,
      deathLandAt(0),
      deathRaceStart(0),
      DEATH_GATHER,
      DEATH_MERGE,
      DEATH_IMPACT,
      DEATH_THROB,
      DEATH_END,
    ];
    for (let i = 1; i < beats.length; i++)
      expect(beats[i], `beat ${i}`).toBeGreaterThan(beats[i - 1]);
    expect(DEATH_END).toBeGreaterThanOrEqual(6);
    expect(DEATH_END).toBeLessThanOrEqual(10);
    // The four comets leave one after another and each lands before it runs.
    for (let i = 0; i < DEATH_VEINS.length; i++) {
      expect(deathFlyStart(i)).toBeGreaterThanOrEqual(DEATH_SPLIT);
      expect(deathRaceStart(i)).toBeGreaterThan(deathLandAt(i));
      expect(deathRaceEnd(i)).toBeLessThanOrEqual(DEATH_GATHER);
    }
  });

  it('tears the crystal out at the tear, lifts it, and lets it go at the split', () => {
    expect(deathCrystal(DEATH_TEAR - 0.1).shown).toBe(false);
    expect(deathCrystal(DEATH_TEAR - 0.1).halo).toBeGreaterThan(0);
    const torn = deathCrystal(DEATH_TEAR + 0.05);
    expect(torn.shown).toBe(true);
    const hung = deathCrystal(DEATH_HOVER_AT + 0.1);
    expect(hung.lift).toBeGreaterThan(torn.lift);
    expect(hung.lift).toBeCloseTo(1, 2);
    // Hot, never a white blank.
    for (let t = DEATH_TEAR; t < DEATH_SPLIT; t += 0.05)
      expect(deathCrystal(t).flare).toBeLessThan(0.7);
    expect(deathCrystal(DEATH_SPLIT).shown).toBe(false);
    expect(deathCrystal(DEATH_END + 5).shown).toBe(false);
  });
});

describe('the comets', () => {
  it('arc from the burst to their own groove head, then race down it to the well', () => {
    for (let i = 0; i < DEATH_VEINS.length; i++) {
      const path = deathGroovePath(i);
      expect(deathComet(deathFlyStart(i) - 0.01, i, HOVER, ground).phase).toBe('off');
      const mid = deathComet((deathFlyStart(i) + deathLandAt(i)) / 2, i, HOVER, ground);
      expect(mid.phase).toBe('fly');
      // Raised over the straight line between its ends.
      expect(mid.y).toBeGreaterThan(Math.max(HOVER.y, 2.4));
      const landed = deathComet(deathLandAt(i) + 0.01, i, HOVER, ground);
      expect(landed.phase).toBe('altar');
      expect(Math.hypot(landed.x - path.from.x, landed.z - path.from.z)).toBeLessThan(0.01);
      const run = deathComet((deathRaceStart(i) + deathRaceEnd(i)) / 2, i, HOVER, ground);
      expect(run.phase).toBe('race');
      // On its own groove: one of the polyline's points lies within a yard.
      let near = Infinity;
      for (let k = 0; k < path.x.length; k++)
        near = Math.min(near, Math.hypot(path.x[k] - run.x, path.z[k] - run.z));
      expect(near).toBeLessThan(1);
    }
  });

  it('runs each front from its altar to the well, never back, gathering pace', () => {
    for (let i = 0; i < DEATH_VEINS.length; i++) {
      expect(deathRaceFront(deathRaceStart(i) - 0.01, i)).toBe(-1);
      let last = -1;
      let lastStep = 0;
      for (let t = deathRaceStart(i); t <= deathRaceEnd(i) + 0.001; t += 0.05) {
        const f = deathRaceFront(t, i);
        expect(f).toBeGreaterThanOrEqual(last);
        if (last >= 0 && t > deathRaceStart(i) + 0.5)
          expect(f - last).toBeGreaterThanOrEqual(lastStep - 1e-9);
        if (last >= 0) lastStep = f - last;
        last = f;
      }
      expect(deathRaceFront(deathRaceEnd(i), i)).toBeCloseTo(1, 6);
    }
  });

  it('winds the four up over the well into one core that dives under the floor', () => {
    for (let i = 0; i < DEATH_VEINS.length; i++) {
      const g = deathComet(DEATH_MERGE - 0.02, i, HOVER, ground);
      expect(g.phase).toBe('gather');
      expect(Math.hypot(g.x - HEART_ROOM.x, g.z - HEART_ROOM.z)).toBeLessThan(1);
      expect(deathComet(DEATH_MERGE + 0.01, i, HOVER, ground).phase).toBe('gone');
    }
    const born = deathCore(DEATH_MERGE);
    expect(born.shown).toBe(true);
    expect(born.y).toBeGreaterThan(15);
    const diving = deathCore(DEATH_IMPACT - 0.01);
    expect(diving.y).toBeLessThan(0);
    expect(diving.y).toBeGreaterThan(-DEATH_PLUNGE_DEPTH - 0.01);
    expect(deathCore(DEATH_IMPACT).shown).toBe(false);
  });
});

describe('the grooves, the well and the room', () => {
  afterEach(() => clearHeartFinalMemoryForTest());

  it('burns each groove behind its comet, cools it to embers after the impact, puts it out', () => {
    for (let i = 0; i < DEATH_VEINS.length; i++) {
      expect(deathTrail(deathRaceStart(i) - 0.01, i).level).toBe(0);
      const hot = deathTrail(deathRaceStart(i) + 0.6, i);
      expect(hot.level).toBeGreaterThan(0.9);
      expect(hot.head).toBe(1);
      expect(hot.ember).toBe(0);
      const cooling = deathTrail(DEATH_IMPACT + 1.2, i);
      expect(cooling.ember).toBeCloseTo(1, 3);
      expect(cooling.head).toBe(0);
      expect(cooling.level).toBeGreaterThan(0);
      expect(deathTrail(DEATH_END, i).level).toBeCloseTo(0, 3);
    }
  });

  it('throws the column up out of the pit at the impact, never before', () => {
    expect(deathWell(DEATH_IMPACT - 0.01).geyserTop).toBe(0);
    expect(deathWell(DEATH_IMPACT + 0.2).geyserTop).toBeGreaterThan(0.8);
    expect(deathWell(DEATH_IMPACT + 1.5).geyserTop).toBe(0);
    expect(deathWell(DEATH_GATHER + 0.9).funnel).toBeGreaterThan(0);
    expect(deathWell(DEATH_THROB).pool).toBeGreaterThan(0.3);
  });

  it('darkens the room from the impact on, and hands the altars back whole by the end', () => {
    expect(HEART_FINAL_DARK.at).toBe(DEATH_IMPACT);
    expect(HEART_FINAL_DARK.at + HEART_FINAL_DARK.seconds).toBeLessThanOrEqual(DEATH_END);
    for (let i = 0; i < DEATH_VEINS.length; i++) {
      expect(deathAltarLevel(deathLandAt(i) - 0.01, i)).toBe(1);
      expect(deathAltarLevel(DEATH_IMPACT + 0.6, i)).toBeLessThan(0.9);
    }
  });
});

describe('the broken stone', () => {
  it('is a fixed plan that lands on the floor and sinks away by the end', () => {
    expect(DEATH_DEBRIS.length).toBeGreaterThan(10);
    for (const p of DEATH_DEBRIS) {
      const drop = 9;
      const late = deathDebrisAt(p, 3, drop);
      expect(late.y).toBeCloseTo(-drop, 6);
      expect(deathDebrisAt(p, 0.05, drop).y).toBeGreaterThan(-drop);
      expect(deathDebrisAt(p, DEATH_END - DEATH_TEAR, drop).scale).toBeCloseTo(0, 6);
    }
  });

  it('keeps every piece on a detail tier and a share of them on the low tier', () => {
    const kept = DEATH_DEBRIS.filter((_, i) => deathDebrisKept(i, 0.4)).length;
    expect(DEATH_DEBRIS.filter((_, i) => deathDebrisKept(i, 1)).length).toBe(DEATH_DEBRIS.length);
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(DEATH_DEBRIS.length);
  });
});

describe("the death's sounds and clock", () => {
  it('every sound is a shipped raid sample on a beat inside the scene', () => {
    const keys = new Set<string>(SFX_FIXED_CATALOG_KEYS);
    for (const s of DEATH_SOUNDS) {
      expect(keys.has(s.key), s.key).toBe(true);
      expect(s.at).toBeGreaterThanOrEqual(0);
      expect(s.at).toBeLessThan(DEATH_END);
    }
  });

  it('runs off a death, off a dev replay on a living body, or not at all', () => {
    expect(deathSceneTime(10, 7, -1, true)).toBe(3);
    // A corpse first seen early in a session is dated before the clock began.
    expect(deathSceneTime(0.05, 0.05 - DEATH_END - 1, -1, true)).toBeGreaterThan(DEATH_END);
    expect(deathSceneTime(10, -1, 8, false)).toBe(2);
    expect(deathSceneTime(10, -1, 10 - DEATH_REPLAY_SECONDS - 0.1, false)).toBe(-1);
    expect(deathSceneTime(10, -1, -1, false)).toBe(-1);
    // A husk holds on a corpse for good; a replay gives the colour back.
    expect(deathHusk(DEATH_TEAR - 0.01, false)).toBe(false);
    expect(deathHusk(DEATH_END + 60, false)).toBe(true);
    expect(deathHusk(DEATH_END + 0.01, true)).toBe(false);
  });
});

describe('the rig', () => {
  const look = SMITH_HEART_BOSS_LOOKS.smith_heart_masterless_strength;

  it('kneels as it dies (its Kneel clip, shipped), in every stance it can die in', () => {
    expect(MASTERLESS_STRENGTH_CLIPS).toContain('Kneel');
    expect(look.clips.death).toBe('Kneel');
    for (const phase of Object.values(look.phaseClips ?? {}))
      expect(phase.clips.death).toBe('Kneel');
  });

  it('blazes its cracks, then darkens to a husk while the shade is re-sent', () => {
    const set = look.glowPulses;
    if (!set) throw new Error('no glow pulses');
    const blaze = set.pulses.find((p) => p.gesture === DEATH_GESTURES.blaze);
    const husk = set.pulses.find((p) => p.gesture === DEATH_GESTURES.husk);
    expect(blaze?.peak).toBeGreaterThan(1);
    expect(husk?.shade).toBe(DEATH_HUSK_SHADE);
    expect(husk?.rise).toBe(0);
    const pulse = new GlowPulse(set);
    pulse.handle(DEATH_GESTURES.husk);
    for (let i = 0; i < 40; i++) {
      pulse.step(0.05, true);
      if (i % 7 === 0) pulse.handle(DEATH_GESTURES.husk);
    }
    // Held dark (the shade never strobes back up while re-sent).
    expect(pulse.active).toBe(true);
  });
});

describe('FinalFx plays the death', () => {
  afterEach(() => {
    clearHeartArrivalLightForTest();
    clearHeartFinalMemoryForTest();
    sharedUniforms.uTime.value = 0;
  });

  function setup() {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    const key = heartSealSlotKey(o.x, o.z);
    const entities = new Map<number, Entity>();
    const mk = (id: number, kind: Entity['kind'], templateId: string, x: number, z: number) =>
      ({
        id,
        kind,
        templateId,
        name: templateId,
        pos: { x, y: 0, z },
        prevPos: { x, y: 0, z },
        facing: 0.6,
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
    const me = mk(1, 'player', 'warrior', o.x + HEART_ROOM.x - 30, o.z + HEART_ROOM.z - 30);
    const boss = mk(2, 'mob', FINAL_BOSS, o.x + HEART_ROOM.x, o.z + HEART_ROOM.z);
    entities.set(me.id, me);
    entities.set(boss.id, boss);
    const world = { entities, player: me, playerId: me.id } as unknown as IWorld;
    const scene = new THREE.Scene();
    const sent: string[] = [];
    const fx = new FinalFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      () => {},
      (_id, g) => sent.push(g),
    );
    // The heart long awake (no arrival in the way).
    sharedUniforms.uTime.value = 3000;
    observeHeartSealMask(
      key,
      SMITH_HEART_SEAL_FULL | SMITH_HEART_PORTAL_BIT | SMITH_HEART_AWAKE_BIT,
      3000,
    );
    const step = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 20); i++) {
        sharedUniforms.uTime.value += 0.05;
        fx.update(0.05);
      }
    };
    return { scene, fx, boss, sent, key, step };
  }

  const shown = (scene: THREE.Scene, name: string) => {
    const o = scene.getObjectByName(name);
    let v = !!o;
    for (let p: THREE.Object3D | null | undefined = o; p; p = p.parent) v = v && p.visible;
    return v;
  };

  it('a death seen live plays the whole scene and leaves a husk in a dark room', () => {
    const s = setup();
    s.step(1);
    expect(shown(s.scene, 'smithHeartFinalDeath')).toBe(false);
    s.boss.dead = true;
    s.step(DEATH_TEAR + 0.2);
    expect(s.sent).toContain(DEATH_GESTURES.blaze);
    expect(s.sent).toContain(DEATH_GESTURES.husk);
    s.step(deathRaceStart(3) + 0.4 - (DEATH_TEAR + 0.2));
    expect(shown(s.scene, 'smithHeartDeathTrails')).toBe(true);
    expect(shown(s.scene, 'smithHeartDeathCometHead')).toBe(true);
    expect(heartArrivalVein(s.key, 'hammer')).toBe(1);
    s.step(DEATH_IMPACT + 0.15 - (deathRaceStart(3) + 0.4));
    expect(shown(s.scene, 'smithHeartDeathGeyserCore')).toBe(true);
    expect(heartArrivalFlare(s.key)).toBeGreaterThan(0.5);
    s.step(DEATH_END + 0.5 - (DEATH_IMPACT + 0.15));
    expect(shown(s.scene, 'smithHeartFinalDeath')).toBe(false);
    expect(heartFinalDarkness(s.key, sharedUniforms.uTime.value)).toBe(1);
    // The husk's shade keeps being re-sent on the corpse.
    const before = s.sent.filter((g) => g === DEATH_GESTURES.husk).length;
    s.step(2);
    expect(s.sent.filter((g) => g === DEATH_GESTURES.husk).length).toBeGreaterThan(before);
    s.fx.dispose();
  });

  it('a body first seen long dead shows none of the scene, only the husk', () => {
    const s = setup();
    s.boss.dead = true;
    s.step(DEATH_END);
    expect(s.sent).not.toContain(DEATH_GESTURES.blaze);
    expect(s.sent).toContain(DEATH_GESTURES.husk);
    expect(shown(s.scene, 'smithHeartDeathTrails')).toBe(false);
    expect(shown(s.scene, 'smithHeartDeathCometHead')).toBe(false);
    s.fx.dispose();
  });

  it('a dev replay cue is claimed, kneels the living body and stands it back up', () => {
    const s = setup();
    s.step(1);
    const cue: SimEvent = {
      type: 'spellfx',
      sourceId: s.boss.id,
      targetId: s.boss.id,
      school: 'arcane',
      fx: 'nova',
      ability: FINAL_DEV_CUES.deathReplay,
    };
    expect(s.fx.handleEvent(cue)).toBe(true);
    s.step(deathRaceStart(0) + 0.3);
    expect(s.sent).toContain(FINAL_BODY_GESTURES.kneel);
    expect(shown(s.scene, 'smithHeartDeathTrails')).toBe(true);
    const kneelAt = s.sent.lastIndexOf(FINAL_BODY_GESTURES.kneel);
    s.step(DEATH_REPLAY_SECONDS + 1);
    expect(s.sent.lastIndexOf(FINAL_BODY_GESTURES.stand)).toBeGreaterThan(kneelAt);
    expect(shown(s.scene, 'smithHeartFinalDeath')).toBe(false);
    // The room is lit again once the replay is over.
    expect(heartFinalDarkness(s.key, sharedUniforms.uTime.value)).toBe(0);
    expect(s.boss.dead).toBe(false);
    s.fx.dispose();
  });

  it('plays every beat on the low tier and sheds only its named doubles', () => {
    const restore = gfxInternalsForTest.overrideSettings({ tier: 'low' });
    try {
      const s = setup();
      s.step(0.5);
      s.boss.dead = true;
      s.step(deathLandAt(0) - 0.2);
      expect(shown(s.scene, 'smithHeartDeathCometHead')).toBe(true);
      for (const layer of DEATH_SECONDARY_LAYERS) expect(shown(s.scene, layer), layer).toBe(false);
      s.step(DEATH_IMPACT + 0.15 - deathLandAt(0) + 0.2);
      expect(shown(s.scene, 'smithHeartDeathGeyserCore')).toBe(true);
      expect(shown(s.scene, 'smithHeartDeathGeyserSwirl')).toBe(true);
      s.fx.dispose();
    } finally {
      restore();
    }
  });

  it('the full tier draws its doubles in their windows', () => {
    const s = setup();
    s.step(0.5);
    s.boss.dead = true;
    s.step(deathLandAt(0) - 0.2);
    expect(shown(s.scene, DEATH_SECONDARY_LAYERS[1])).toBe(true);
    s.step(DEATH_IMPACT + 0.15 - deathLandAt(0) + 0.2);
    expect(shown(s.scene, DEATH_SECONDARY_LAYERS[0])).toBe(true);
    s.fx.dispose();
  });
});

describe('/dev heart final death', () => {
  it('emits the replay cue on the living boss and kills nothing', () => {
    const sim = new Sim({ seed: 23, playerClass: 'warrior', autoEquip: false, devCommands: true });
    const dev = (line: string) => handleSmithHeartDevChat(sim.ctx, line, sim.player.id);
    sim.setPlayerLevel(20);
    expect(dev('/dev heart tp heartroom')).toBe(true);
    sim.tick();
    const DUNGEON = DUNGEONS[SMITH_HEART_DUNGEON];
    const inst: InstanceSlot | undefined = sim.ctx.instances.find((i) => {
      if (i.dungeonId !== SMITH_HEART_DUNGEON || i.partyKey === null || i.exitId === null)
        return false;
      const o = instanceOrigin(DUNGEON.index, i.slot);
      return Math.abs(sim.player.pos.x - o.x) < 300 && Math.abs(sim.player.pos.z - o.z) < 250;
    });
    if (!inst) throw new Error('no claim');
    const boss = smithHeartFinalBoss(sim.ctx, inst);
    if (!boss) throw new Error('no boss');
    const hp = boss.hp;
    expect(dev('/dev heart final death')).toBe(true);
    const events = sim.tick();
    expect(
      events.some(
        (e) =>
          e.type === 'spellfx' &&
          e.ability === FINAL_DEV_CUES.deathReplay &&
          e.sourceId === boss.id,
      ),
    ).toBe(true);
    expect(boss.dead).toBe(false);
    expect(boss.hp).toBe(hp);
    expect(boss.inCombat).toBe(false);
  });

  it('the cue makes no sound of its own (the scene plays its own)', () => {
    expect(finalSoundClaims(FINAL_DEV_CUES.deathReplay)).toBe(true);
  });
});
