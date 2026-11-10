// The Guardian of the Quench's entrance on the client, "Under the ice"
// (render/smith_heart_fx/quench_entrance_core.ts and quench_entrance_fx.ts):
// the scene's clock read off her aura (a late joiner starts where the scene
// is, one that joins after sees her standing, a scene cut short breaks out at
// once), every beat on its word of the voiced line (frozen, the eyes, the web,
// the gather, the breach and its shockwave, the rise, the blades rising,
// turning on the raid and plunging back), the web, the sheet's chunks and the
// blades' shape, her entrance clips in their GLB, and the painter over a fake
// world (her stances and her dim through the gesture seam, the thud once,
// nothing replayed for a late joiner, every beat on the low tier, no thud and
// no flash under reduced motion).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createGlbIO } from '../scripts/anim/pose_blend.mjs';
import {
  QUENCH_ENTRANCE_ANIMS_URL,
  QUENCH_ENTRANCE_CLIPS,
  SMITH_HEART_BOSS_LOOKS,
} from '../src/render/characters/smith_heart_boss_looks';
import { activateGfxProfile, GFX, getActiveGfxProfile } from '../src/render/gfx';
import { QuenchEntranceFx } from '../src/render/smith_heart_fx';
import {
  QUENCH_BODY_GESTURES,
  QUENCH_BODY_SCALE,
  QUENCH_GUARDIAN,
} from '../src/render/smith_heart_fx/quench_body_core';
import {
  AWAKE,
  CHUNK_LIFE,
  crossedQuenchBeat,
  ENTRANCE_BLADE_PROFILE,
  ENTRANCE_WEB,
  FROZEN,
  heavedSlabAt,
  newChunkState,
  newSlabState,
  QUENCH_EMERGE_CLIP,
  QUENCH_ENTRANCE,
  QUENCH_ENTRANCE_BLADES,
  QUENCH_ENTRANCE_DRIFT,
  QUENCH_ENTRANCE_POOLS,
  QUENCH_ENTRANCE_SOUNDS,
  QUENCH_INTRO_VOICE,
  QUENCH_SHEET,
  quenchEntranceClock,
  quenchEntranceFlash,
  quenchEntranceLook,
  quenchEntranceShake,
  SLAB,
  sheetChunkAt,
  stepQuenchEntranceTime,
  WEB,
  WEB_TIPS,
  WEB_VERTICES,
  webReach,
} from '../src/render/smith_heart_fx/quench_entrance_core';
import { quenchEntranceFor } from '../src/render/smith_heart_fx/quench_entrance_state';
import { QUENCH } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { QUENCH_AURAS } from '../src/sim/encounters/smith_heart/quench_ids';
import {
  QUENCH_INTRO,
  QUENCH_INTRO_STAGES,
} from '../src/sim/encounters/smith_heart/quench_intro_plan';
import type { Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const E = QUENCH_ENTRANCE;
const waking = (t: number) => ({
  id: QUENCH_AURAS.intro,
  value: QUENCH_INTRO_STAGES.waking,
  remaining: QUENCH_INTRO.seconds - t,
  duration: QUENCH_INTRO.seconds,
});
const frozen = {
  id: QUENCH_AURAS.intro,
  value: QUENCH_INTRO_STAGES.dormant,
  remaining: 3600,
  duration: 3600,
};

describe('the clock', () => {
  it('reads frozen, waking with its time, or nothing off her aura', () => {
    expect(quenchEntranceClock([frozen]).stage).toBe('frozen');
    const w = quenchEntranceClock([waking(4.2)]);
    expect(w.stage).toBe('waking');
    expect(w.t).toBeCloseTo(4.2, 9);
    expect(quenchEntranceClock([]).stage).toBe('none');
    // The online mirror's shapes: a permanent marker's endless duration, a
    // waking aura its client has aged between snapshots.
    expect(quenchEntranceClock([{ ...frozen, duration: Number.POSITIVE_INFINITY }]).stage).toBe(
      'frozen',
    );
    const aged = quenchEntranceClock([{ ...waking(3), remaining: QUENCH_INTRO.seconds - 3.12 }]);
    expect(aged.t).toBeCloseTo(3.12, 9);
    const endless = quenchEntranceClock([{ ...waking(3), duration: Number.POSITIVE_INFINITY }]);
    expect(endless.t).toBeCloseTo(3, 9);
  });

  it('runs smooth on the aura, snaps on a drift, plays a seen scene out, and a late joiner past it sees her standing', () => {
    const none = quenchEntranceClock([]);
    // Frozen holds; a joiner mid-scene starts where it is.
    expect(stepQuenchEntranceTime(AWAKE, 0.05, quenchEntranceClock([frozen]))).toBe(FROZEN);
    expect(stepQuenchEntranceTime(FROZEN, 0.05, quenchEntranceClock([waking(7)]))).toBe(7);
    expect(stepQuenchEntranceTime(3, 0.05, quenchEntranceClock([waking(3.04)]))).toBeCloseTo(
      3.05,
      9,
    );
    expect(
      stepQuenchEntranceTime(
        3,
        0.05,
        quenchEntranceClock([waking(3 + QUENCH_ENTRANCE_DRIFT + 0.5)]),
      ),
    ).toBeCloseTo(3 + QUENCH_ENTRANCE_DRIFT + 0.5, 9);
    // Never backward: ahead of the aura it waits (no beat replays).
    expect(
      stepQuenchEntranceTime(
        E.breachAt + 0.2,
        0.05,
        quenchEntranceClock([waking(E.breachAt - 0.5)]),
      ),
    ).toBe(E.breachAt + 0.2);
    // Handed back: the tail plays on, then awake.
    expect(stepQuenchEntranceTime(QUENCH_INTRO.seconds, 0.05, none)).toBeCloseTo(
      QUENCH_INTRO.seconds + 0.05,
      9,
    );
    expect(stepQuenchEntranceTime(E.end - 0.01, 0.05, none)).toBe(AWAKE);
    // Never seen waking: awake (a late joiner sees her standing).
    expect(stepQuenchEntranceTime(AWAKE, 0.05, none)).toBe(AWAKE);
    expect(stepQuenchEntranceTime(FROZEN, 0.05, none)).toBe(AWAKE);
    // Cut short before the breach (a forced pull): she breaks out at once.
    expect(stepQuenchEntranceTime(2, 0.05, none)).toBe(E.breachAt);
    expect(crossedQuenchBeat(2, E.breachAt, E.breachAt)).toBe(true);
  });
});

describe('the beats ride the voiced line', () => {
  it('pins each beat to its word in the shipped clip, counted from the sim speakAt', () => {
    const S = QUENCH_INTRO.speakAt;
    const V = QUENCH_INTRO_VOICE;
    expect(E.webAt).toBeCloseTo(S + V.lake, 9);
    expect(E.gatherAt).toBeCloseTo(S + V.sleepingEnd, 9);
    expect(E.breachAt).toBeCloseTo(S + V.woken, 9);
    expect(E.bladesAt).toBeCloseTo(S + V.andThe, 9);
    expect(E.pointAt).toBeCloseTo(S + V.forgive, 9);
    // The words in the clip's order, all before its end.
    const order = [V.hush, V.lake, V.sleepingEnd, V.you, V.woken, V.cold, V.andThe, V.forgive];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    expect(V.end).toBeGreaterThan(V.forgive);
    // Her eyes open before "Hush...".
    expect(E.eyesAt + E.eyesFor).toBeLessThanOrEqual(S + V.hush + 0.4);
    // The line ends before she is handed back; the scene runs 10 to 14 s.
    expect(QUENCH_INTRO.seconds).toBeGreaterThan(S + V.end);
    expect(QUENCH_INTRO.seconds).toBeGreaterThanOrEqual(10);
    expect(QUENCH_INTRO.seconds).toBeLessThanOrEqual(14);
    // The Emerge clip starts on the breach and throws her arms down on
    // "forgive", as the blades turn on the raid.
    expect(E.breachAt + QUENCH_EMERGE_CLIP.throw).toBeCloseTo(E.pointAt, 2);
    // Her Emerge clip has played out by the hand-back (a swing is never held
    // by it in the fight).
    expect(E.breachAt + QUENCH_EMERGE_CLIP.end).toBeLessThanOrEqual(QUENCH_INTRO.seconds + 1e-9);
    // The last blade is up before they turn; they plunge after the hand-back.
    expect(
      E.bladesAt + (QUENCH_ENTRANCE_BLADES.count - 1) * E.bladeStep + E.bladeRise,
    ).toBeLessThan(E.pointAt + 0.01);
    expect(E.plungeAt).toBeGreaterThan(QUENCH_INTRO.seconds);
    expect(E.end).toBeGreaterThan(E.plungeAt + E.plungeFor);
  });

  it('every sound plays on a beat of the scene, of the Quench own samples', () => {
    for (const s of QUENCH_ENTRANCE_SOUNDS) {
      expect(s.key.startsWith('heart_quench_')).toBe(true);
      expect(s.at).toBeGreaterThan(0);
      expect(s.at).toBeLessThan(E.end);
    }
    expect(QUENCH_ENTRANCE_SOUNDS.some((s) => s.at === E.webAt && /crack/.test(s.key))).toBe(true);
    expect(QUENCH_ENTRANCE_SOUNDS.filter((s) => s.at === E.breachAt).length).toBeGreaterThan(0);
  });
});

describe('the look', () => {
  it('frozen: the sheet whole over her, her eyes shut, her light held dim, her cold still', () => {
    const L = quenchEntranceLook(FROZEN);
    expect(L.active).toBe(true);
    expect(L.frozen).toBe(true);
    expect(L.stance).toBe('frozen');
    expect(L.dim).toBe(true);
    expect(L.eyes).toBe(0);
    expect(L.sheet).toBe(1);
    expect(L.ambient).toBe(0);
    expect(L.web).toBe(0);
    expect(L.breath).toBe(1);
    expect(L.blades.every((b) => !b.shown)).toBe(true);
  });

  it('the wake: her eyes open sharp under the ice before the line, the web runs on "the lake"', () => {
    const shut = quenchEntranceLook(E.eyesAt - 0.05);
    expect(shut.eyes).toBe(0);
    const open = quenchEntranceLook(E.eyesAt + E.eyesFor * 0.5);
    expect(open.eyes).toBeGreaterThan(1.5);
    expect(quenchEntranceLook(E.webAt - 0.01).web).toBe(0);
    const half = quenchEntranceLook(E.webAt + E.webFor * 0.5);
    expect(half.web).toBeGreaterThan(0.4);
    expect(half.web).toBeLessThan(1);
    expect(quenchEntranceLook(E.webAt + E.webFor).web).toBeCloseTo(1, 6);
    // The cold climbs: frost out, snow thickening to a flurry by the breach.
    const early = quenchEntranceLook(E.webAt + 0.3);
    const late = quenchEntranceLook(E.breachAt - 0.05);
    expect(late.frost).toBeGreaterThan(early.frost);
    expect(late.snow).toBeGreaterThan(1.2);
    expect(early.snow).toBeLessThan(late.snow);
    // The gather: the sheet crazes and trembles, the light under her swells.
    expect(late.sheetCrack).toBeGreaterThan(0.9);
    expect(late.tremble).toBeGreaterThan(0.8);
    expect(late.under).toBeGreaterThan(early.under);
    expect(late.sheet).toBe(1);
  });

  it('the breach: the sheet gone, the shockwave racing out past the raid, the burst, her light back', () => {
    const at = quenchEntranceLook(E.breachAt + 0.02);
    expect(at.stance).toBe('emerge');
    expect(at.dim).toBe(false);
    expect(at.sheet).toBe(0);
    expect(at.flash).toBeGreaterThan(0.3);
    expect(at.geyser).toBeGreaterThan(0.5);
    const mid = quenchEntranceLook(E.breachAt + E.ringFor * 0.5);
    expect(mid.ringR).toBeGreaterThan(E.ringFrom);
    // Out past the raid on the lake's edge (some 35 yd from her).
    expect(E.ringTo).toBeGreaterThan(QUENCH.lake.rz + 5);
    expect(quenchEntranceLook(E.breachAt + E.ringFor + 0.01).ring).toBe(0);
    expect(quenchEntranceLook(E.breachAt + E.flashFor + 0.01).flash).toBe(0);
    // Her cold rolls off her again as she stands.
    expect(quenchEntranceLook(E.breachAt + QUENCH_EMERGE_CLIP.stood).ambient).toBeCloseTo(1, 6);
  });

  it('the blades rise one by one, circle her, turn on the raid on "forgive", then plunge', () => {
    const B = QUENCH_ENTRANCE_BLADES;
    const first = quenchEntranceLook(E.bladesAt + 0.01);
    expect(first.blades[0].shown).toBe(true);
    expect(first.blades[1].shown).toBe(false);
    const up = quenchEntranceLook(E.pointAt - 0.05);
    expect(up.blades.every((b) => b.shown && b.lift > 0.99 && b.aim === 0)).toBe(true);
    // They circled her on the way.
    const a0 = quenchEntranceLook(E.bladesAt + 1).blades[0].bearing;
    const a1 = quenchEntranceLook(E.bladesAt + 2).blades[0].bearing;
    expect(a1 - a0).toBeCloseTo(B.orbit, 6);
    const aimed = quenchEntranceLook(E.pointAt + E.pointFor);
    // The snap: just past the mark, then settled on it, its point glinting.
    expect(aimed.blades.every((b) => b.aim >= 1)).toBe(true);
    expect(aimed.blades[0].glint).toBeGreaterThan(0.5);
    const settled = quenchEntranceLook(E.pointAt + 1);
    expect(settled.blades.every((b) => Math.abs(b.aim - 1) < 0.01)).toBe(true);
    // No aim and no glint before the snap.
    const before = quenchEntranceLook(E.pointAt - 0.01);
    expect(before.blades.every((b) => b.aim === 0 && b.glint === 0)).toBe(true);
    // The spin: fast as it rises out of the ice, lazy once it hovers.
    const r0 = quenchEntranceLook(E.bladesAt + 0.05).blades[0].spin;
    const r1 = quenchEntranceLook(E.bladesAt + 0.15).blades[0].spin;
    const h0 = quenchEntranceLook(E.bladesAt + 2).blades[0].spin;
    const h1 = quenchEntranceLook(E.bladesAt + 2.1).blades[0].spin;
    expect(Math.abs(r1 - r0)).toBeGreaterThan(Math.abs(h1 - h0) * 5);
    // They spun up out of the ice and spiralled out to the ring.
    const rising = quenchEntranceLook(E.bladesAt + 0.1).blades[0];
    expect(rising.reach).toBeLessThan(0.6);
    expect(up.blades[0].reach).toBeCloseTo(1, 6);
    expect(aimed.blades[0].glow).toBeGreaterThan(1);
    // Handed back still pointing; then into the lake.
    expect(quenchEntranceLook(QUENCH_INTRO.seconds).blades.every((b) => b.shown)).toBe(true);
    const gone = quenchEntranceLook(E.plungeAt + 2);
    expect(gone.blades.every((b) => !b.shown)).toBe(true);
  });

  it('awake once the scene is over (the fight look)', () => {
    const L = quenchEntranceLook(AWAKE);
    expect(L.active).toBe(false);
    expect(L.stance).toBe('stand');
    expect(L.eyes).toBe(1);
    expect(L.ambient).toBe(1);
    expect(quenchEntranceLook(E.end + 0.1).active).toBe(false);
  });

  it('reduced motion: no thud and no burst of light; the thud falls off with distance', () => {
    const L = quenchEntranceLook(E.breachAt + 0.05);
    expect(quenchEntranceFlash(L, true)).toBe(0);
    expect(quenchEntranceFlash(L, false)).toBeGreaterThan(0);
    expect(quenchEntranceShake(10, true)).toBe(0);
    expect(quenchEntranceShake(10, false)).toBeGreaterThan(quenchEntranceShake(60, false));
    expect(quenchEntranceShake(E.shakeReach + 1, false)).toBe(0);
  });

  it('is deterministic and allocation free in place', () => {
    const out = quenchEntranceLook(5.3);
    const again = quenchEntranceLook(5.3, out);
    expect(again).toBe(out);
    expect(JSON.stringify(quenchEntranceLook(8.1))).toBe(JSON.stringify(quenchEntranceLook(8.1)));
  });
});

describe('the particle budget', () => {
  it('the smoke pool (mist, snow, spray) stays within its room at the peak of the scene', () => {
    const P = QUENCH_ENTRANCE_POOLS;
    let peak = 0;
    for (let t = 0; t < E.end; t += 0.1) {
      const L = quenchEntranceLook(t);
      const live =
        P.snowRate * L.snow * P.snowLife +
        P.mistRate * L.mist * 5 +
        P.sprayRate * L.ring * 1.3 * 0.65;
      peak = Math.max(peak, live);
    }
    // EngineParticles' smoke pool: 1200 at full density (plus a margin).
    expect(peak).toBeLessThanOrEqual(1200);
  });
});

describe('the plans', () => {
  it('the web: spokes and rings, longest toward the raid, revealed out from her', () => {
    expect(ENTRANCE_WEB.length).toBeGreaterThan(WEB.spokes);
    expect(WEB_VERTICES).toBe(ENTRANCE_WEB.reduce((n, l) => n + l.length * 2, 0));
    expect(webReach(0)).toBeCloseTo(WEB.reachAhead, 9);
    expect(webReach(Math.PI)).toBeCloseTo(WEB.reachBack, 9);
    // The spokes' tips ahead of her (toward the raid) reach farther than
    // those behind.
    const ahead = WEB_TIPS.filter((p) => p.z > 0).map((p) => Math.hypot(p.x, p.z));
    const behind = WEB_TIPS.filter((p) => p.z < 0).map((p) => Math.hypot(p.x, p.z));
    expect(Math.max(...ahead)).toBeGreaterThan(Math.max(...behind) + 5);
    for (const line of ENTRANCE_WEB)
      for (const p of line) {
        expect(p.reveal).toBeGreaterThanOrEqual(0);
        expect(p.reveal).toBeLessThanOrEqual(1);
        expect(Math.hypot(p.x, p.z)).toBeLessThan(WEB.reachAhead + 3);
      }
    // Each spoke runs outward.
    for (const line of ENTRANCE_WEB.slice(0, WEB.spokes))
      expect(line[line.length - 1].reveal).toBeGreaterThan(line[0].reveal);
  });

  it('the chunks fly up out of the sheet, land and melt away', () => {
    const c = newChunkState();
    let rose = 0;
    for (let i = 0; i < QUENCH_ENTRANCE_POOLS.chunks; i++) {
      sheetChunkAt(i, 0, c);
      expect(c.size).toBeGreaterThan(0);
      const y0 = c.y;
      sheetChunkAt(i, 0.2, c);
      if (c.y > y0) rose++;
      sheetChunkAt(i, CHUNK_LIFE + 0.01, c);
      expect(c.size).toBe(0);
    }
    expect(rose).toBe(QUENCH_ENTRANCE_POOLS.chunks);
    expect(sheetChunkAt(3, -1, c).size).toBe(0);
  });

  it('the great plates heave up round her, the outer ones flung, all sinking back', () => {
    const st = newSlabState();
    let flung = 0;
    for (let i = 0; i < QUENCH_ENTRANCE_POOLS.slabs; i++) {
      heavedSlabAt(i, -0.1, st);
      expect(st.w).toBe(0);
      heavedSlabAt(i, SLAB.heave + 0.3, st);
      expect(st.w).toBeGreaterThan(1.5);
      expect(st.tilt).toBeGreaterThan(0.3);
      if (st.tumble > 0) flung++;
      heavedSlabAt(i, SLAB.stand + SLAB.sink + 1.1, st);
      expect(st.w).toBe(0);
    }
    expect(flung).toBeGreaterThan(0);
    expect(flung).toBeLessThan(QUENCH_ENTRANCE_POOLS.slabs);
  });

  it('a blade is the Smith blade section, pommel to point', () => {
    const P = ENTRANCE_BLADE_PROFILE;
    expect(P[0].y).toBe(0);
    expect(P[P.length - 1].y).toBeCloseTo(QUENCH_ENTRANCE_BLADES.length, 9);
    for (let i = 1; i < P.length; i++) expect(P[i].y).toBeGreaterThan(P[i - 1].y);
    // The guard is its widest ring; the point closes.
    const widest = P.reduce((a, b) => (b.w > a.w ? b : a));
    expect(widest.y).toBeLessThan(QUENCH_ENTRANCE_BLADES.length * 0.25);
    expect(P[P.length - 1].w).toBeLessThan(0.05);
  });

  it('the sheet covers her lying body', () => {
    // Her lying body runs some ten yards from her feet to her crown and tops
    // out about a yard over the ice.
    expect(QUENCH_SHEET.halfLength * 2).toBeGreaterThan(11);
    expect(QUENCH_SHEET.height).toBeGreaterThan(1.2);
  });
});

describe('her entrance clips', () => {
  it('ship in their own GLB (Frozen, Emerge), bound as her stances', async () => {
    const io = createGlbIO();
    const doc = await io.read(`public/${QUENCH_ENTRANCE_ANIMS_URL}`);
    const anims = doc.getRoot().listAnimations();
    expect(anims.map((a) => a.getName()).sort()).toEqual([...QUENCH_ENTRANCE_CLIPS].sort());
    const emerge = anims.find((a) => a.getName() === 'Emerge');
    let last = 0;
    for (const ch of emerge?.listChannels() ?? []) {
      const t = ch.getSampler()?.getInput()?.getArray();
      if (t) last = Math.max(last, t[t.length - 1]);
    }
    expect(last).toBeCloseTo(QUENCH_EMERGE_CLIP.end, 1);
    expect(doc.getRoot().listMeshes()).toHaveLength(0);
    const look = SMITH_HEART_BOSS_LOOKS.smith_heart_quench_guardian;
    expect(look.animUrls).toContain(QUENCH_ENTRANCE_ANIMS_URL);
    expect(look.phaseClips?.[QUENCH_BODY_GESTURES.frozen]?.clips.idle).toBe('Frozen');
    expect(look.phaseClips?.[QUENCH_BODY_GESTURES.emerge]?.enter).toBe('Emerge');
    expect(look.phaseClips?.[QUENCH_BODY_GESTURES.emerge]?.clips).toBe(look.clips);
    expect(look.oneShotsHoldAttacks).toContain('Emerge');
    // Her dim is a glow pulse on the rig's own clones (never her material).
    const dim = look.glowPulses?.pulses.find((p) => p.gesture === QUENCH_BODY_GESTURES.frozenDim);
    expect(dim?.shade).toBeGreaterThan(0);
    expect(dim?.shade).toBeLessThan(1);
    expect(dim?.peak).toBeLessThan(0.1);
  });
});

describe('QuenchEntranceFx over a fake world', () => {
  function rig(opts: { reduced?: boolean; raid?: number } = {}) {
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
        scale: QUENCH_BODY_SCALE,
        hp: 100,
        maxHp: 100,
        dead: false,
        auras: [] as Entity['auras'],
      }) as unknown as Entity;
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', QUENCH.lake.x, QUENCH.lake.z - 20);
    const boss = entity(2, 'mob', QUENCH_GUARDIAN, QUENCH.lake.x, QUENCH.lake.z);
    entities.set(me.id, me);
    entities.set(boss.id, boss);
    for (let i = 0; i < (opts.raid ?? 2); i++) {
      const p = entity(10 + i, 'player', 'mage', QUENCH.lake.x + i * 4, QUENCH.lake.z - 24);
      entities.set(p.id, p);
    }
    const world = {
      entities,
      player: me,
      playerId: me.id,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const scene = new THREE.Scene();
    const shakes: number[] = [];
    const sent: string[] = [];
    const fx = new QuenchEntranceFx(
      scene,
      () => 0,
      world,
      undefined,
      () => opts.reduced === true,
      (a) => shakes.push(a),
      (id, g) => {
        expect(id).toBe(boss.id);
        sent.push(g);
      },
    );
    const aura = (a: { id: string; value: number; remaining: number; duration: number } | null) => {
      boss.auras.length = 0;
      if (a) boss.auras.push(a as unknown as Entity['auras'][number]);
    };
    return { scene, fx, boss, aura, shakes, sent };
  }
  const visible = (scene: THREE.Scene, name: string) => {
    let v = false;
    scene.traverse((o) => {
      if (o.name !== name) return;
      let p: THREE.Object3D | null = o;
      let all = true;
      while (p && p !== scene) {
        if (!p.visible) all = false;
        p = p.parent;
      }
      v ||= all;
    });
    return v;
  };
  /** Play the whole scene from frozen to awake, noting what showed. */
  function play(r: ReturnType<typeof rig>) {
    const seen = new Set<string>();
    const names = [
      'smithHeartQuenchEntranceSheet',
      'smithHeartQuenchEntranceWeb',
      'smithHeartQuenchEntranceFrost',
      'smithHeartQuenchEntranceChunks',
      'smithHeartQuenchEntranceGeyser',
      'smithHeartQuenchEntranceBlades',
      'smithHeartQuenchEntranceHalos',
      'smithHeartQuenchEntranceBurst',
      'smithHeartQuenchEntranceSlabs',
      'smithHeartQuenchEntranceShockEdge',
      'smithHeartQuenchEntranceGeyserCore',
      'smithHeartQuenchEntranceBladeCracks',
    ];
    r.aura(frozen);
    r.fx.update(0.3);
    r.fx.update(1 / 20);
    const dt = 1 / 20;
    let t = 0;
    while (t < QUENCH_INTRO.seconds - 1e-6) {
      r.aura(waking(t));
      r.fx.update(dt);
      t += dt;
      for (const n of names) if (visible(r.scene, n)) seen.add(n);
    }
    r.aura(null);
    for (let s = 0; s < E.end - QUENCH_INTRO.seconds + 0.5; s += dt) {
      r.fx.update(dt);
      for (const n of names) if (visible(r.scene, n)) seen.add(n);
    }
    return seen;
  }

  it('plays the whole scene: her stances and dim, the thud once, every piece on its beat, then awake', () => {
    const r = rig();
    const seen = play(r);
    const G = QUENCH_BODY_GESTURES;
    // Lying frozen (re-sent while she lies there), the Emerge once on the
    // breach with her light's flare, the dim re-sent until then.
    expect(r.sent[0]).toBe(G.frozen);
    expect(r.sent.filter((g) => g === G.frozen).length).toBeGreaterThan(10);
    expect(r.sent.filter((g) => g === G.emerge)).toHaveLength(1);
    expect(r.sent.filter((g) => g === G.flare)).toHaveLength(1);
    expect(r.sent.filter((g) => g === G.frozenDim).length).toBeGreaterThan(10);
    const emergeAt = r.sent.indexOf(G.emerge);
    expect(r.sent.slice(emergeAt).includes(G.frozenDim)).toBe(false);
    expect(r.sent.slice(emergeAt).includes(G.frozen)).toBe(false);
    expect(r.shakes).toHaveLength(1);
    for (const n of [
      'smithHeartQuenchEntranceSheet',
      'smithHeartQuenchEntranceWeb',
      'smithHeartQuenchEntranceFrost',
      'smithHeartQuenchEntranceChunks',
      'smithHeartQuenchEntranceGeyser',
      'smithHeartQuenchEntranceBlades',
      'smithHeartQuenchEntranceBurst',
      'smithHeartQuenchEntranceSlabs',
      'smithHeartQuenchEntranceShockEdge',
      'smithHeartQuenchEntranceGeyserCore',
      'smithHeartQuenchEntranceBladeCracks',
    ])
      expect(seen.has(n), n).toBe(true);
    expect(quenchEntranceFor(r.boss.id)).toBeNull();
    expect(r.fx.currentLook.active).toBe(false);
    expect(visible(r.scene, 'smithHeartQuenchEntranceSheet')).toBe(false);
    r.fx.dispose();
  });

  it('points each blade at one of the raid near her (by id)', () => {
    const r = rig({ raid: 3 });
    play(r);
    const marks = [...r.fx.bladeMarks];
    expect(marks).toEqual([1, 10, 11, 12, 1, 10]);
    r.fx.dispose();
  });

  it('holds her look for her body while the scene is on, and gives it back after', () => {
    const r = rig();
    r.aura(frozen);
    r.fx.update(0.3);
    r.fx.update(1 / 20);
    expect(quenchEntranceFor(r.boss.id)?.frozen).toBe(true);
    expect(quenchEntranceFor(r.boss.id)?.eyes).toBe(0);
    r.aura(waking(E.breachAt + 1));
    r.fx.update(1 / 20);
    expect(quenchEntranceFor(r.boss.id)?.sheet).toBe(0);
    r.fx.dispose();
    expect(quenchEntranceFor(r.boss.id)).toBeNull();
  });

  it('a joiner after the breach plays no Emerge and no thud; one after the scene sees her standing', () => {
    const r = rig();
    r.aura(waking(E.breachAt + 0.6));
    r.fx.update(0.3);
    r.fx.update(1 / 20);
    expect(r.fx.currentLook.active).toBe(true);
    expect(r.shakes).toHaveLength(0);
    expect(r.sent.includes(QUENCH_BODY_GESTURES.emerge)).toBe(false);
    expect(r.sent.includes(QUENCH_BODY_GESTURES.frozen)).toBe(false);
    r.fx.dispose();
    const late = rig();
    late.aura(null);
    late.fx.update(0.3);
    late.fx.update(1 / 20);
    expect(late.fx.currentLook.active).toBe(false);
    expect(late.sent).toHaveLength(0);
    expect(quenchEntranceFor(late.boss.id)).toBeNull();
    late.fx.dispose();
  });

  it('a scene cut short before the breach breaks her out at once, with no blades', () => {
    const r = rig();
    r.aura(frozen);
    r.fx.update(0.3);
    let t = 0;
    while (t < E.webAt + 1) {
      r.aura(waking(t));
      r.fx.update(1 / 20);
      t += 1 / 20;
    }
    r.aura(null);
    let blades = false;
    for (let s = 0; s < E.end; s += 1 / 20) {
      r.fx.update(1 / 20);
      blades ||= visible(r.scene, 'smithHeartQuenchEntranceBlades');
    }
    expect(r.sent.filter((g) => g === QUENCH_BODY_GESTURES.emerge)).toHaveLength(1);
    expect(blades).toBe(false);
    r.fx.dispose();
  });

  it('a joiner mid-web starts there, frozen, and plays the breach when it comes', () => {
    const r = rig();
    r.aura(waking(E.webAt + 0.5));
    r.fx.update(0.3);
    r.fx.update(1 / 20);
    expect(r.sent[0]).toBe(QUENCH_BODY_GESTURES.frozen);
    let t = E.webAt + 0.55;
    while (t < E.breachAt + 0.5) {
      r.aura(waking(t));
      r.fx.update(1 / 20);
      t += 1 / 20;
    }
    expect(r.sent.filter((g) => g === QUENCH_BODY_GESTURES.emerge)).toHaveLength(1);
    expect(r.shakes).toHaveLength(1);
    r.fx.dispose();
  });

  it('under reduced motion the whole scene plays with no thud and no burst of light', () => {
    const r = rig({ reduced: true });
    const seen = play(r);
    expect(r.shakes).toHaveLength(0);
    expect(seen.has('smithHeartQuenchEntranceBurst')).toBe(false);
    // Every other beat still plays.
    for (const n of [
      'smithHeartQuenchEntranceWeb',
      'smithHeartQuenchEntranceGeyser',
      'smithHeartQuenchEntranceSlabs',
      'smithHeartQuenchEntranceShockEdge',
      'smithHeartQuenchEntranceBladeCracks',
      'smithHeartQuenchEntranceBlades',
    ])
      expect(seen.has(n), n).toBe(true);
    r.fx.dispose();
    // No shudder through the sheet, and the breach's additive light capped.
    const calm = rig({ reduced: true });
    const uniforms = (name: string) =>
      ((calm.scene.getObjectByName(name) as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;
    calm.aura(waking(E.breachAt - 0.3));
    calm.fx.update(0.3);
    calm.fx.update(1 / 20);
    expect(calm.fx.currentLook.tremble).toBeGreaterThan(0.5);
    expect(uniforms('smithHeartQuenchEntranceSheet').uTremble.value).toBe(0);
    let t = E.breachAt - 0.2;
    let under = 0;
    let geyser = 0;
    let edge = 0;
    while (t < E.breachAt + 0.6) {
      calm.aura(waking(t));
      calm.fx.update(1 / 20);
      t += 1 / 20;
      under = Math.max(under, uniforms('smithHeartQuenchEntranceUnder').uUnder.value);
      geyser = Math.max(
        geyser,
        uniforms('smithHeartQuenchEntranceGeyser').uAlpha.value +
          uniforms('smithHeartQuenchEntranceGeyserCore').uAlpha.value,
      );
      edge = Math.max(edge, uniforms('smithHeartQuenchEntranceShockEdge').uAlpha.value);
    }
    expect(under).toBeLessThanOrEqual(1);
    expect(geyser).toBeLessThanOrEqual(0.7);
    expect(edge).toBeLessThanOrEqual(0.5);
    calm.fx.dispose();
  });

  it('the low tier plays every beat with fewer chunks', () => {
    const original = getActiveGfxProfile();
    activateGfxProfile({ ...original, settings: { ...GFX, tier: 'low' } });
    try {
      const r = rig();
      const chunks = (
        r.scene.getObjectByName('smithHeartQuenchEntranceChunks') as THREE.InstancedMesh
      ).count;
      const seen = play(r);
      for (const n of [
        'smithHeartQuenchEntranceSheet',
        'smithHeartQuenchEntranceWeb',
        'smithHeartQuenchEntranceFrost',
        'smithHeartQuenchEntranceChunks',
        'smithHeartQuenchEntranceGeyser',
        'smithHeartQuenchEntranceSlabs',
        'smithHeartQuenchEntranceShockEdge',
        'smithHeartQuenchEntranceGeyserCore',
        'smithHeartQuenchEntranceBladeCracks',
        'smithHeartQuenchEntranceBlades',
        'smithHeartQuenchEntranceBurst',
      ])
        expect(seen.has(n), n).toBe(true);
      expect(r.shakes).toHaveLength(1);
      r.fx.dispose();
      activateGfxProfile(original);
      const full = rig();
      const fullChunks = (
        full.scene.getObjectByName('smithHeartQuenchEntranceChunks') as THREE.InstancedMesh
      ).count;
      expect(chunks).toBeLessThan(fullChunks);
      full.fx.dispose();
    } finally {
      activateGfxProfile(original);
    }
  });
});
