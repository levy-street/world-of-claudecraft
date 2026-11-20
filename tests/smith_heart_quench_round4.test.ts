// The Guardian of the Quench, round 4 of her look: Tempering Strike's fists
// meet the ice on the frame the cleave lands. The sim cues her wind-up a fixed
// `strikeWindup` seconds before the swing (pinned here over a real Sim), so the
// body starts the downswing (StrikeFall) a breath ahead of it; the cleave's cue
// lands the fists on StrikeSlam's FIRST frame (contact 0, a short fade), an
// avoided swing sweeps them aside (StrikeSpent, no cracks), and a swing that
// never comes lets the blow go the same plain way. The sim's damage is never
// delayed: only the presentation's downswing starts earlier.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SMITH_HEART_BOSS_LOOKS } from '../src/render/characters/smith_heart_boss_looks';
import { ARC_CLEAVE_ABILITY } from '../src/render/smith_heart_fx/hammer_fx_core';
import { QuenchBody } from '../src/render/smith_heart_fx/quench_body';
import {
  QUENCH_BODY_CLIP,
  QUENCH_BODY_CLIPS,
  QUENCH_BODY_GESTURES,
  QUENCH_BODY_SCALE,
  QUENCH_SOCKETS,
  quenchEyeGlintSize,
  quenchHeartHaloSize,
} from '../src/render/smith_heart_fx/quench_body_core';
import {
  QUENCH_STRIKE_FALL,
  QUENCH_STRIKE_WIND,
  QUENCH_STRIKE_WIND_OWNS,
  quenchStrikeFallen,
  quenchStrikeFallStep,
} from '../src/render/smith_heart_fx/quench_strike_core';
import {
  QUENCH_WINDUP,
  quenchWindupLook,
} from '../src/render/smith_heart_fx/quench_strike_windup_core';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  QUENCH_CASTS,
  QUENCH_CUES,
  QUENCH_GUARDIAN,
  QUENCH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { laneTemplate } from '../src/sim/encounters/smith_heart/quench_ids';
import { DT, type Entity, type SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';
import { quenchFight } from './helpers/quench_fight';

const ticks = (s: number) => Math.round(s / DT);

describe('Tempering Strike: the swing comes a fixed lead after its wind-up cue', () => {
  it('lands every cleave exactly strikeWindup seconds after its cue (the body times its downswing on it)', () => {
    const f = quenchFight(5);
    expect(f.dev('/dev heart quench pull')).toBe(true);
    f.tick(ticks(T.rimRise) + 2);
    const st = f.state();
    if (!st) throw new Error('no fight');
    const boss = f.boss();
    const b = f.local(boss);
    f.put(f.players[0], b.x, b.z + 3);
    f.put(f.players[1], b.x + 14, b.z - 10);
    f.put(f.players[2], b.x - 14, b.z - 10);
    let cue = -1;
    const gaps: number[] = [];
    for (let i = 0; i < ticks(40); i++) {
      st.breathTimer = 999;
      for (const ev of f.tick(1)) {
        if (ev.type !== 'spellfx' || ev.fx !== 'windup' || ev.sourceId !== boss.id) continue;
        if (ev.ability === QUENCH_CUES.strikeReady) cue = i;
        if (ev.ability === 'brood_cleave' && cue >= 0) gaps.push(i - cue);
      }
    }
    expect(gaps.length).toBeGreaterThanOrEqual(2);
    for (const g of gaps) expect(g).toBe(ticks(T.strikeWindup));
    expect(QUENCH_STRIKE_WIND).toBe(T.strikeWindup);
  });
});

describe('Tempering Strike: the downswing as numbers', () => {
  it('falls a breath before the swing, never during a bar, and lets go once overdue', () => {
    const at = QUENCH_STRIKE_WIND - QUENCH_STRIKE_FALL.lead;
    expect(QUENCH_STRIKE_FALL.lead).toBeGreaterThan(0);
    expect(QUENCH_STRIKE_FALL.lead).toBeLessThan(0.3);
    expect(quenchStrikeFallStep(at - 0.02, false, false)).toBeNull();
    expect(quenchStrikeFallStep(at, false, false)).toBe('fall');
    expect(quenchStrikeFallStep(at + 0.1, false, true)).toBeNull();
    expect(quenchStrikeFallStep(QUENCH_STRIKE_WIND + 0.1, true, false)).toBeNull();
    expect(quenchStrikeFallStep(QUENCH_STRIKE_WIND + QUENCH_STRIKE_FALL.grace, true, false)).toBe(
      'release',
    );
    // Released before the wind-up's own ownership runs out.
    expect(QUENCH_STRIKE_WIND + QUENCH_STRIKE_FALL.grace).toBeLessThan(QUENCH_STRIKE_WIND_OWNS);
  });

  it('lands the slam on its first frame, faded in short, and binds the fall', () => {
    expect(QUENCH_BODY_CLIP.strikeSlam).toBe(0);
    expect(QUENCH_BODY_CLIP.strikeFall).toBe(QUENCH_STRIKE_FALL.lead);
    expect(QUENCH_BODY_CLIPS).toContain('StrikeFall');
    const def = SMITH_HEART_BOSS_LOOKS.smith_heart_quench_guardian;
    const c = def.clips;
    expect(c.attackByAbility?.[QUENCH_BODY_GESTURES.strikeFall]).toBe('StrikeFall');
    expect(c.attackTimeScaleByAbility?.[QUENCH_BODY_GESTURES.strikeFall]).toBe(1);
    expect(c.contacts?.StrikeSlam).toEqual([0]);
    expect(c.oneShotFade?.StrikeSlam).toBe(QUENCH_STRIKE_FALL.slamFade);
    expect(QUENCH_STRIKE_FALL.slamFade).toBeLessThanOrEqual(0.05);
    expect(c.oneShotFade?.StrikeSpent).toBe(QUENCH_STRIKE_FALL.spentFade);
    // A swing's own damage event never cuts the downswing.
    expect(def.oneShotsHoldAttacks).toContain('StrikeFall');
    // The early-outcome variants from her raised fists.
    expect(c.attackByAbility?.[QUENCH_BODY_GESTURES.strikeSlamHigh]).toBe('StrikeSlamHigh');
    expect(c.attackByAbility?.[QUENCH_BODY_GESTURES.strikeSpentHigh]).toBe('StrikeSpentHigh');
    expect(c.contacts?.StrikeSlamHigh).toEqual([QUENCH_BODY_CLIP.strikeSlamHigh]);
    expect(QUENCH_BODY_CLIP.strikeSlamHigh).toBeGreaterThan(0);
    expect(QUENCH_BODY_CLIP.strikeSlamHigh).toBeLessThan(0.2);
    for (const k of ['StrikeSlamHigh', 'StrikeSpentHigh']) {
      expect(QUENCH_BODY_CLIPS).toContain(k);
      expect(def.oneShotsHoldAttacks).toContain(k);
    }
    expect(quenchStrikeFallen(QUENCH_STRIKE_WIND - QUENCH_STRIKE_FALL.lead)).toBe(true);
    expect(quenchStrikeFallen(QUENCH_STRIKE_WIND - QUENCH_STRIKE_FALL.lead - 0.01)).toBe(false);
  });
});

describe('Tempering Strike: the body times the fists to the cleave', () => {
  const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
  const entity = (id: number, kind: Entity['kind'], templateId: string, x: number, z: number) =>
    ({
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
    }) as unknown as Entity;

  function rig() {
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', 190, -12);
    const boss = entity(2, 'mob', QUENCH_GUARDIAN, 198, -2);
    for (const e of [me, boss]) entities.set(e.id, e);
    const world = {
      entities,
      entityRosterVersion: 1,
      player: me,
      playerId: me.id,
    } as unknown as IWorld;
    const scene = new THREE.Scene();
    const sent: string[] = [];
    const fx = new QuenchBody(
      scene,
      () => 40,
      world,
      undefined,
      () => false,
      () => {},
      (_id, g) => sent.push(g),
    );
    for (let i = 0; i < 6; i++) fx.update(1 / 20);
    const cue = (ability: string) =>
      ({
        type: 'spellfx',
        sourceId: boss.id,
        targetId: boss.id,
        school: 'frost',
        fx: 'windup',
        ability,
      }) as SimEvent;
    const cracks = () =>
      (scene.getObjectsByProperty('name', 'smithHeartQuenchStrikeCracks') ?? []).some(
        (c) => c.visible,
      );
    return { fx, sent, cue, cracks, boss, entities, world };
  }

  it('starts the downswing a breath ahead and cracks the lake on the cleave frame itself', () => {
    const { fx, sent, cue, cracks } = rig();
    fx.handleEvent(cue(QUENCH_CUES.strikeReady));
    const step = 1 / 60;
    const fallAt = QUENCH_STRIKE_WIND - QUENCH_STRIKE_FALL.lead;
    let t = 0;
    while (t + step < fallAt - 1e-6) {
      fx.update(step);
      t += step;
    }
    expect(sent).not.toContain(QUENCH_BODY_GESTURES.strikeFall);
    while (t < QUENCH_STRIKE_WIND - 1e-6) {
      fx.update(step);
      t += step;
    }
    expect(sent.filter((g) => g === QUENCH_BODY_GESTURES.strikeFall)).toHaveLength(1);
    expect(cracks()).toBe(false);
    // The cleave lands: the fists hit the ice on this very frame.
    expect(fx.handleEvent(cue(ARC_CLEAVE_ABILITY))).toBe(true);
    expect(sent.at(-1)).toBe(QUENCH_BODY_GESTURES.strikeSlam);
    fx.update(step);
    expect(cracks()).toBe(true);
    fx.dispose();
  });

  it('sweeps an avoided blow aside: no slam, no cracks', () => {
    const { fx, sent, cue, cracks } = rig();
    fx.handleEvent(cue(QUENCH_CUES.strikeReady));
    for (let i = 0; i < 20; i++) fx.update(1 / 20);
    expect(sent).toContain(QUENCH_BODY_GESTURES.strikeFall);
    fx.handleEvent(cue(QUENCH_CUES.strikeSpent));
    expect(sent.at(-1)).toBe(QUENCH_BODY_GESTURES.strikeSpent);
    for (let i = 0; i < 30; i++) fx.update(1 / 20);
    expect(sent).not.toContain(QUENCH_BODY_GESTURES.strikeSlam);
    expect(cracks()).toBe(false);
    fx.dispose();
  });

  it('lets an overdue blow go the plain way, once', () => {
    const { fx, sent, cue, cracks } = rig();
    fx.handleEvent(cue(QUENCH_CUES.strikeReady));
    for (let i = 0; i < ticks(QUENCH_STRIKE_WIND + QUENCH_STRIKE_FALL.grace) + 1; i++)
      fx.update(1 / 20);
    expect(sent.at(-1)).toBe(QUENCH_BODY_GESTURES.strikeSpent);
    for (let i = 0; i < 40; i++) fx.update(1 / 20);
    expect(sent.filter((g) => g === QUENCH_BODY_GESTURES.strikeSpent)).toHaveLength(1);
    expect(cracks()).toBe(false);
    fx.dispose();
  });

  it('plays an outcome that arrives before the downswing from her raised fists', () => {
    // A lagging client: the cleave lands half a second after the cue arrived.
    const { fx, sent, cue, cracks } = rig();
    fx.handleEvent(cue(QUENCH_CUES.strikeReady));
    for (let i = 0; i < 10; i++) fx.update(1 / 20);
    expect(sent).not.toContain(QUENCH_BODY_GESTURES.strikeFall);
    expect(fx.handleEvent(cue(ARC_CLEAVE_ABILITY))).toBe(true);
    expect(sent.at(-1)).toBe(QUENCH_BODY_GESTURES.strikeSlamHigh);
    fx.update(1 / 60);
    expect(cracks()).toBe(false);
    for (let i = 0; i < 4; i++) fx.update(1 / 20);
    expect(cracks()).toBe(true);
    // And an early avoided swing sweeps from the raised fists, no cracks.
    for (let i = 0; i < 80; i++) fx.update(1 / 20);
    fx.handleEvent(cue(QUENCH_CUES.strikeReady));
    for (let i = 0; i < 10; i++) fx.update(1 / 20);
    fx.handleEvent(cue(QUENCH_CUES.strikeSpent));
    expect(sent.at(-1)).toBe(QUENCH_BODY_GESTURES.strikeSpentHigh);
    for (let i = 0; i < 20; i++) fx.update(1 / 20);
    expect(cracks()).toBe(false);
    fx.dispose();
  });

  it('reports the contact it chose, so the spikes land with the fists', () => {
    const { fx, cue } = rig();
    // From the downswing: contact on the cleave's own frame.
    fx.handleEvent(cue(QUENCH_CUES.strikeReady));
    for (let i = 0; i < 20; i++) fx.update(1 / 20);
    fx.handleEvent(cue(ARC_CLEAVE_ABILITY));
    expect(fx.strikeContactNow()).toBe(QUENCH_BODY_CLIP.strikeSlam);
    for (let i = 0; i < 80; i++) fx.update(1 / 20);
    // Early (before the downswing): from her raised fists.
    fx.handleEvent(cue(QUENCH_CUES.strikeReady));
    for (let i = 0; i < 8; i++) fx.update(1 / 20);
    fx.handleEvent(cue(ARC_CLEAVE_ABILITY));
    expect(fx.strikeContactNow()).toBe(QUENCH_BODY_CLIP.strikeSlamHigh);
    for (let i = 0; i < 80; i++) fx.update(1 / 20);
    // Late (the blow already let go): the short Strike.
    fx.handleEvent(cue(QUENCH_CUES.strikeReady));
    for (let i = 0; i < 28; i++) fx.update(1 / 20);
    fx.handleEvent(cue(ARC_CLEAVE_ABILITY));
    expect(fx.strikeContactNow()).toBe(QUENCH_BODY_CLIP.strike);
    fx.dispose();
  });

  it('never points a blade on while her fists are held up for the strike', () => {
    const { fx, sent, cue, entities, world } = rig();
    fx.handleEvent(cue(QUENCH_CUES.strikeReady));
    for (let i = 0; i < 4; i++) fx.update(1 / 20);
    const lane = entity(9, 'object', laneTemplate('warn', 3, 12), 205, 0);
    entities.set(lane.id, lane);
    (world as unknown as { entityRosterVersion: number }).entityRosterVersion++;
    for (let i = 0; i < 4; i++) fx.update(1 / 20);
    expect(sent).not.toContain(QUENCH_BODY_GESTURES.slash);
    expect(sent.at(-1)).toBe(QUENCH_BODY_GESTURES.strikeRaise);
    fx.dispose();
  });

  it('never starts the downswing under a bar', () => {
    const { fx, sent, cue, boss } = rig();
    fx.handleEvent(cue(QUENCH_CUES.strikeReady));
    for (let i = 0; i < 10; i++) fx.update(1 / 20);
    boss.castingAbility = QUENCH_CASTS.breath;
    boss.castTotal = 2.5;
    boss.castRemaining = 2;
    for (let i = 0; i < 20; i++) fx.update(1 / 20);
    expect(sent).not.toContain(QUENCH_BODY_GESTURES.strikeFall);
    fx.dispose();
  });
});

describe('Her face reads at gameplay distance (round 4)', () => {
  const at = (id: string) => {
    const s = QUENCH_SOCKETS.find((k) => k.id === id);
    if (!s) throw new Error(id);
    return s.at;
  };

  it('keeps each eye glint well under half her face, even flaring', () => {
    expect(quenchEyeGlintSize(1)).toBeLessThan(0.3);
    expect(quenchEyeGlintSize(2)).toBeLessThan(0.4);
    expect(quenchEyeGlintSize(9)).toBe(quenchEyeGlintSize(2));
    expect(quenchEyeGlintSize(-1)).toBeGreaterThan(0);
  });

  it("keeps the heart's halo under her chin at rest", () => {
    const below = at('eyeL')[1] - at('heart')[1];
    expect(below).toBeGreaterThan(1.5);
    // Its rim (half its width) stops short of her eyes at the resting light.
    expect(quenchHeartHaloSize(1) / 2).toBeLessThan(below - 0.4);
    // It still swells when she flares.
    expect(quenchHeartHaloSize(2.4)).toBeGreaterThan(quenchHeartHaloSize(1));
  });

  it("dims the fists' flare and lets the spirals go on the downswing", () => {
    const held = quenchWindupLook(0.9, 'pending', 0);
    const fell = quenchWindupLook(0.95, 'pending', 0, undefined, QUENCH_WINDUP.fallDim);
    expect(fell.spiral).toBe(0);
    expect(fell.fist).toBeLessThan(held.fist * 0.5);
    // Not yet falling: unchanged.
    const still = quenchWindupLook(0.9, 'pending', 0, undefined, -1);
    expect(still.fist).toBe(held.fist);
    expect(still.spiral).toBe(held.spiral);
    // The tell itself (ring and arc) stays whole: it is the telegraph.
    expect(fell.alpha).toBe(1);
    expect(fell.arc).toBeGreaterThan(0.9);
  });
});
