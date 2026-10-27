// The Guardian of the Quench's provisional body and its fight's look (the pure
// plans src/render/smith_heart_fx/quench_body_core.ts and
// quench_fight_fx_core.ts): the body stands imposing (matching the manifest
// and the template), every piece is a real node of its kit, the bars and
// one-shots map to their motions, every pose and the fall are finite; the
// fight's objects decode to their kinds, the frost on a body follows the cold
// bar, the cracks fill to their hole, the blades tear free and float, the
// echoes wear the attack's exact shape, the warmth's threads stay within the
// sim's reach, and the shore ice rises once.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { SMITH_HEART_PLACEHOLDER_LOOKS } from '../src/render/characters/smith_heart_placeholder_looks';
import {
  bladesAwakeOn,
  QJ,
  QUENCH_BODY_HEIGHT,
  QUENCH_BODY_KITS,
  QUENCH_BODY_PIECES,
  QUENCH_FALL,
  QUENCH_RAISED_SECONDS,
  QUENCH_RIG_JOINTS,
  QUENCH_THREAD_PAIRS,
  type QuenchBodyAction,
  type QuenchBodyInput,
  quenchArm,
  quenchBodyAction,
  quenchBodyLook,
  quenchBodyTop,
  quenchFallProgress,
  quenchFallRest,
  quenchWristTarget,
  restJoint,
} from '../src/render/smith_heart_fx/quench_body_core';
import {
  BLADE_FLOAT_LIFT,
  BLADE_TIP,
  bladeLook,
  crackLook,
  echoShape,
  frostLook,
  frozenLook,
  LEE_SHAPE,
  QUENCH_FIGHT_POOLS,
  quenchFightClaims,
  quenchObjectKind,
  RIM_SHARDS,
  rimRise,
  rimShard,
  warmthLinks,
} from '../src/render/smith_heart_fx/quench_fight_fx_core';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { QUENCH_RIMEWALL } from '../src/sim/content/smith_heart_layout';
import {
  bladeTemplate,
  crackTemplate,
  echoTemplate,
  laneTemplate,
  QUENCH_AURAS,
  QUENCH_CASTS,
  QUENCH_CUES,
  QUENCH_GUARDIAN,
  QUENCH_OBJECTS,
  QUENCH_TUNING as T,
} from '../src/sim/encounters/smith_heart/quench_ids';

const PLAYER = 1.9;
const finite = (p: { x: number; y: number; z: number }) =>
  Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

/** The node names of a committed GLB (its JSON chunk). */
function glbNodeNames(url: string): string[] {
  const buf = readFileSync(`public${url}`);
  expect(buf.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as {
    nodes?: { name?: string }[];
  };
  return (json.nodes ?? []).map((n) => n.name ?? '');
}

const IDLE_INPUT: QuenchBodyInput = {
  castId: null,
  castFill: 0,
  sinceBreath: Number.POSITIVE_INFINITY,
  sinceStrike: Number.POSITIVE_INFINITY,
  sinceSwing: Number.POSITIVE_INFINITY,
  sinceWake: Number.POSITIVE_INFINITY,
  awake: false,
};

const ACTIONS: QuenchBodyAction[] = [
  'idle',
  'swing',
  'strike',
  'breath',
  'exhale',
  'wake',
  'raised',
];

describe('quench_body_core: the provisional body', () => {
  it('stands imposing, matching the manifest and the template', () => {
    const look = SMITH_HEART_PLACEHOLDER_LOOKS[QUENCH_GUARDIAN];
    expect(look).toBe('smith_heart_quench_guardian');
    const visual = VISUALS[look];
    expect(visual?.bodyless).toBe(true);
    expect(QUENCH_BODY_HEIGHT).toBeCloseTo(
      (visual?.height ?? 0) * (SMITH_HEART_MOBS[QUENCH_GUARDIAN]?.scale ?? 0),
    );
    expect(QUENCH_BODY_HEIGHT / PLAYER).toBeGreaterThanOrEqual(2.5);
    // Its crown and crest tips about its height (the nameplate rides over it).
    expect(Math.abs(quenchBodyTop() - QUENCH_BODY_HEIGHT)).toBeLessThan(1);
  });

  it('is built of real kit nodes, each piece unique and on a real joint', () => {
    const nodes = {
      quench: new Set(glbNodeNames(QUENCH_BODY_KITS.quench)),
      heart: new Set(glbNodeNames(QUENCH_BODY_KITS.heart)),
    };
    const ids = new Set<string>();
    expect(QUENCH_BODY_PIECES.length).toBeGreaterThan(10);
    for (const p of QUENCH_BODY_PIECES) {
      expect(nodes[p.kit].has(p.node), `${p.id}: ${p.kit} ${p.node}`).toBe(true);
      expect(ids.has(p.id), p.id).toBe(false);
      ids.add(p.id);
      expect(p.joint).toBeGreaterThanOrEqual(0);
      expect(p.joint).toBeLessThan(QUENCH_RIG_JOINTS);
      if (p.to !== undefined) expect(p.to).toBeLessThan(QUENCH_RIG_JOINTS);
      expect(p.size.x * p.size.y * p.size.z).toBeGreaterThan(0);
    }
    // Both kits contribute: the Heart kit's colossus rock and the lake's ice.
    expect(QUENCH_BODY_PIECES.some((p) => p.kit === 'heart')).toBe(true);
    expect(QUENCH_BODY_PIECES.some((p) => p.kit === 'quench')).toBe(true);
    for (const [a, b] of QUENCH_THREAD_PAIRS) {
      expect(a).toBeLessThan(QUENCH_RIG_JOINTS);
      expect(b).toBeLessThan(QUENCH_RIG_JOINTS);
    }
  });

  it('rests symmetric, feet on the ice and head over the chest', () => {
    for (let i = 0; i < QUENCH_RIG_JOINTS; i++) expect(finite(restJoint(i)), `${i}`).toBe(true);
    const l = restJoint(QJ.shoulderL);
    const r = restJoint(QJ.shoulderR);
    expect(l.x).toBeCloseTo(-r.x);
    expect(restJoint(QJ.footL).y).toBeLessThan(0.5);
    expect(restJoint(QJ.head).y).toBeGreaterThan(restJoint(QJ.chest).y);
  });

  it('maps the bars first, then the one-shots, then idle', () => {
    expect(quenchBodyAction(IDLE_INPUT).action).toBe('idle');
    const wake = quenchBodyAction({
      ...IDLE_INPUT,
      castId: QUENCH_CASTS.wake,
      castFill: 0.4,
      sinceSwing: 0,
    });
    expect(wake).toEqual({ action: 'wake', k: 0.4 });
    expect(
      quenchBodyAction({ ...IDLE_INPUT, castId: QUENCH_CASTS.breath, castFill: 2, sinceStrike: 0 }),
    ).toEqual({ action: 'breath', k: 1 });
    expect(quenchBodyAction({ ...IDLE_INPUT, sinceWake: 0.6, sinceBreath: 0.1 }).action).toBe(
      'raised',
    );
    expect(quenchBodyAction({ ...IDLE_INPUT, sinceBreath: 0.1, sinceStrike: 0.1 }).action).toBe(
      'exhale',
    );
    expect(quenchBodyAction({ ...IDLE_INPUT, sinceStrike: 0.1, sinceSwing: 0.1 }).action).toBe(
      'strike',
    );
    expect(quenchBodyAction({ ...IDLE_INPUT, sinceSwing: 0.1 }).action).toBe('swing');
    expect(
      quenchBodyAction({ ...IDLE_INPUT, sinceWake: QUENCH_RAISED_SECONDS + 0.01 }).action,
    ).toBe('idle');
  });

  it('keeps every pose finite, its arms within reach', () => {
    for (const a of ACTIONS)
      for (const k of [0, 0.25, 0.5, 0.75, 1]) {
        const look = quenchBodyLook(a, k, 3.7, k > 0.5);
        for (const v of Object.values(look)) expect(Number.isFinite(v), `${a} ${k}`).toBe(true);
        for (const side of [1, -1] as const) {
          const w = quenchWristTarget(a, side, k);
          expect(finite(w), `${a} ${k} ${side}`).toBe(true);
          const arm = quenchArm(side, w);
          expect(finite(arm.elbow) && finite(arm.wrist), `${a} ${k}`).toBe(true);
        }
      }
    // The wake lifts the arms over the head; the crest burns once awake.
    const up = quenchWristTarget('wake', 1, 1);
    expect(up.y).toBeGreaterThan(restJoint(QJ.head).y);
    expect(quenchBodyLook('idle', 0, 1, true).crest).toBeGreaterThan(
      quenchBodyLook('idle', 0, 1, false).crest,
    );
  });

  it('falls to the ice and reads the awake marker', () => {
    for (let i = 0; i < QUENCH_BODY_PIECES.length; i++) {
      const rest = quenchFallRest(i, restJoint(QUENCH_BODY_PIECES[i].joint));
      expect(finite(rest.at) && finite(rest.tilt)).toBe(true);
      expect(rest.delay + 0.75).toBeLessThanOrEqual(QUENCH_FALL.end);
      expect(quenchFallProgress(QUENCH_FALL.end, rest.delay).landed).toBe(true);
    }
    expect(quenchFallProgress(0, 0.2)).toEqual({ k: 0, landed: false });
    expect(bladesAwakeOn([{ id: 'x' }, { id: QUENCH_AURAS.awake }])).toBe(true);
    expect(bladesAwakeOn([{ id: QUENCH_AURAS.cold }])).toBe(false);
  });
});

describe('quench_fight_fx_core: the fight on the ice', () => {
  it("decodes every one of the fight's objects to its kind, and nothing else", () => {
    expect(quenchObjectKind(crackTemplate(2.5))).toBe('crack');
    expect(quenchObjectKind(QUENCH_OBJECTS.hole)).toBe('hole');
    expect(quenchObjectKind(echoTemplate('breath', 3))).toBe('echo');
    expect(quenchObjectKind(echoTemplate('strike', 'hit'))).toBe('echo');
    expect(quenchObjectKind(laneTemplate('warn', 3))).toBe('lane');
    expect(quenchObjectKind(QUENCH_OBJECTS.rim)).toBe('rim');
    expect(quenchObjectKind(QUENCH_OBJECTS.rimRise)).toBe('rimRise');
    expect(quenchObjectKind(bladeTemplate('float'))).toBe('blade');
    expect(quenchObjectKind('sh_quench_blade_nonsense')).toBeNull();
    expect(quenchObjectKind('sh_breath_wind')).toBeNull();
  });

  it('claims its own cues and leaves the rest to the generic bursts', () => {
    for (const cue of [QUENCH_CUES.freeze, QUENCH_CUES.shatter, QUENCH_CUES.echo, QUENCH_CUES.rim])
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

  it("draws each echo at the attack's exact arc and reach, the lee at the sim's", () => {
    expect(echoShape('breath')).toEqual({ arcDeg: T.breathArcDeg, range: T.breathRange });
    expect(echoShape('strike')).toEqual({ arcDeg: T.strikeArcDeg, range: T.strikeRange });
    expect(LEE_SHAPE.range).toBe(T.leeR);
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
