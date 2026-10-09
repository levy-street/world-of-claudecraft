// The Great Saurian's Blender body in game (src/render/wildheart_basin/
// saurian_model_core.ts, saurian_fx_core.ts, src/render/characters/
// wildheart_creature_looks.ts and gesture_mesh_toggles.ts): the shipped GLB
// carries the clips, meshes and compression the look keys on, the model's
// measured landmarks agree with the sim (its drawn height, the rider's
// landing spot behind its right flank), the footfalls follow the gait cycle,
// every body beat sits on its clip's contact frame, and the howdah's mesh
// latch hides on the break's schedule (sooner if the clip is cut).
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyMeshToggleAction,
  type MeshToggleDef,
  type MeshToggleState,
  meshToggleActions,
  meshToggleHidden,
  stepMeshToggle,
} from '../src/render/characters/gesture_mesh_toggles';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import {
  SAURIAN_HOWDAH_GONE_GESTURE,
  SAURIAN_HOWDAH_WHOLE_GESTURE,
} from '../src/render/characters/wildheart_creature_looks';
import { SAURIAN_DRAW } from '../src/render/wildheart_basin/basin_fx_core';
import {
  CROWN_LOOKS,
  crownShape,
  HOWDAH_PIECE_FALLS,
  howdahDeck,
  RIPPLE_LOOKS,
  rippleShape,
  saurianBeats,
  TAIL_SWEEP_SPAN,
  tailSprayReach,
  tailSweepAngle,
} from '../src/render/wildheart_basin/saurian_fx_core';
import {
  SAURIAN_CLIP,
  SAURIAN_FOOTFALLS,
  SAURIAN_MODEL,
  SAURIAN_SIM_SCALE,
  type SaurianFoot,
  saurianFootfallsBetween,
  saurianLookHeight,
  saurianModelScale,
  saurianModelToWorld,
  saurianStride,
} from '../src/render/wildheart_basin/saurian_model_core';
import { MOBS } from '../src/sim/data';
import {
  SAURIAN_ENRAGE,
  SAURIAN_HOWDAH_BREAK,
  SAURIAN_STOMP,
  SAURIAN_TAIL_SWIPE,
  SAURIAN_TUNING,
} from '../src/sim/encounters/wildheart_basin/ids';
import type { Entity } from '../src/sim/types';

const GLB = `public/${SAURIAN_MODEL.url}`;

interface GlbJson {
  animations: { name: string; samplers: { input: number }[] }[];
  accessors: { count: number; max?: number[] }[];
  meshes: { name: string; primitives: { indices?: number }[] }[];
  nodes: { name?: string; mesh?: number }[];
  images?: { mimeType?: string }[];
  extensionsUsed?: string[];
  skins: { joints: number[] }[];
}

function glbJson(path: string): GlbJson {
  const buf = readFileSync(path);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.toString('utf8', 20, 20 + len)) as GlbJson;
}

describe('the shipped GLB', () => {
  const json = glbJson(GLB);
  const clipLength = (name: string): number => {
    const a = json.animations.find((x) => x.name === name);
    if (!a) return 0;
    return Math.max(...a.samplers.map((s) => json.accessors[s.input].max?.[0] ?? 0));
  };

  it('carries every clip the look plays, as long as the contact frames need', () => {
    const def = VISUALS.wildheart_great_saurian;
    const named = [
      def.clips.idle,
      def.clips.walk,
      def.clips.run,
      def.clips.death,
      def.clips.cast,
      def.clips.flourish,
      ...def.clips.attack,
      ...(def.clips.hit ?? []),
      ...Object.values(def.clips.castByAbility ?? {}),
      ...Object.values(def.clips.attackByAbility ?? {}),
    ];
    for (const clip of named) expect(clipLength(clip ?? ''), clip).toBeGreaterThan(0.5);
    expect(clipLength('TailSwipe')).toBeGreaterThan(SAURIAN_CLIP.tailClub);
    expect(clipLength('Stomp')).toBeGreaterThan(SAURIAN_CLIP.stompJolt);
    expect(clipLength('HowdahBreak')).toBeGreaterThan(SAURIAN_CLIP.howdahGone);
    expect(clipLength('Death')).toBeGreaterThan(SAURIAN_CLIP.deathNeck);
    expect(clipLength('Enrage')).toBeGreaterThan(SAURIAN_CLIP.enrageStamps[1]);
  });

  it('keeps the howdah and the rider as their own mesh nodes', () => {
    const toggles = VISUALS.wildheart_great_saurian.meshToggles ?? [];
    expect(toggles).toHaveLength(1);
    const names = new Set(json.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name));
    for (const node of toggles[0].nodes) expect(names.has(node), node).toBe(true);
    expect(names.has('GreatSaurian')).toBe(true);
  });

  it('ships compressed, inside its budget', () => {
    expect(json.extensionsUsed).toEqual(
      expect.arrayContaining(['EXT_meshopt_compression', 'KHR_texture_basisu']),
    );
    expect((json.images ?? []).every((i) => i.mimeType === 'image/ktx2')).toBe(true);
    let tris = 0;
    for (const m of json.meshes)
      for (const p of m.primitives)
        if (p.indices !== undefined) tris += json.accessors[p.indices].count / 3;
    expect(tris).toBeGreaterThan(60_000);
    expect(tris).toBeLessThan(80_000);
    expect(statSync(GLB).size).toBeLessThan(4.5 * 1024 * 1024);
  });
});

describe('the look and the model agree with the sim', () => {
  it('maps the template to the Blender body at its drawn size', () => {
    expect(visualKeyFor({ kind: 'mob', templateId: 'great_saurian' } as unknown as Entity)).toBe(
      'wildheart_great_saurian',
    );
    expect(MOBS.great_saurian.scale).toBe(SAURIAN_SIM_SCALE);
    const def = VISUALS.wildheart_great_saurian;
    expect(def.url).toBe(SAURIAN_MODEL.url);
    expect(def.height).toBeCloseTo(saurianLookHeight(), 6);
    // The head stands 13 to 15 yd over the ford: five players, never toy-like.
    const head = SAURIAN_MODEL.headTop * saurianModelScale(SAURIAN_SIM_SCALE);
    expect(head).toBeGreaterThan(13);
    expect(head).toBeLessThan(15.5);
    expect(SAURIAN_DRAW.height * SAURIAN_SIM_SCALE).toBeCloseTo(head, 6);
  });

  it('plays both strikes at 1x as play-outs, and the set pieces off their gestures', () => {
    const c = VISUALS.wildheart_great_saurian.clips;
    expect(c.castByAbility?.[SAURIAN_TAIL_SWIPE]).toBe('TailSwipe');
    expect(c.castByAbility?.[SAURIAN_STOMP]).toBe('Stomp');
    expect(c.castTimeScaleByAbility?.[SAURIAN_TAIL_SWIPE]).toBe(1);
    expect(c.castTimeScaleByAbility?.[SAURIAN_STOMP]).toBe(1);
    expect(c.castPlayOut).toEqual(expect.arrayContaining(['TailSwipe', 'Stomp']));
    expect(c.attackByAbility?.[SAURIAN_HOWDAH_BREAK]).toBe('HowdahBreak');
    expect(c.attackByAbility?.[SAURIAN_ENRAGE]).toBe('Enrage');
    // The tail crosses the cone's middle on the bar's last frame; the forefeet
    // slam on the Stomp's.
    expect(SAURIAN_CLIP.tailHit).toBe(SAURIAN_TUNING.tailCast);
    expect(SAURIAN_CLIP.stompSlam).toBe(SAURIAN_TUNING.stompCast);
    expect(VISUALS.wildheart_great_saurian.oneShotsHoldAttacks).toEqual(
      expect.arrayContaining(['HowdahBreak', 'Enrage']),
    );
  });

  it("lands the sim's rider where the clip drops its own", () => {
    expect(SAURIAN_CLIP.riderLands).toBe(SAURIAN_TUNING.riderLandDelay);
    const k = saurianModelScale(SAURIAN_SIM_SCALE);
    // The model's right is -x, behind is -z.
    expect(-SAURIAN_MODEL.riderLand.x * k).toBeCloseTo(SAURIAN_TUNING.riderLandRight, 0);
    expect(-SAURIAN_MODEL.riderLand.z * k).toBeCloseTo(SAURIAN_TUNING.riderLandBack, 0);
    expect(Math.abs(-SAURIAN_MODEL.riderLand.x * k - SAURIAN_TUNING.riderLandRight)).toBeLessThan(
      0.3,
    );
    expect(Math.abs(-SAURIAN_MODEL.riderLand.z * k - SAURIAN_TUNING.riderLandBack)).toBeLessThan(
      0.3,
    );
  });

  it('turns model space into the world the way the sim faces (its left is +x)', () => {
    const out = { x: 0, z: 0 };
    const k = saurianModelScale(SAURIAN_SIM_SCALE);
    // Facing 0 looks down +z: forward is +z, its left +x.
    saurianModelToWorld({ x: 0, z: 0 }, 0, SAURIAN_SIM_SCALE, 0, 1, out);
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.z).toBeCloseTo(k, 6);
    saurianModelToWorld({ x: 0, z: 0 }, 0, SAURIAN_SIM_SCALE, 1, 0, out);
    expect(out.x).toBeCloseTo(k, 6);
    // Facing a quarter turn (+x): its right (model -x) is the sim's right, +z.
    saurianModelToWorld({ x: 10, z: 5 }, Math.PI / 2, SAURIAN_SIM_SCALE, -1, 0, out);
    expect(out.x).toBeCloseTo(10, 6);
    expect(out.z).toBeCloseTo(5 + k, 6);
  });

  it('keeps the tail spray inside the cone the sim tests', () => {
    const reach = tailSprayReach(SAURIAN_SIM_SCALE);
    expect(reach.to).toBeLessThanOrEqual(SAURIAN_TUNING.tailRange);
    expect(reach.from).toBeGreaterThan(0);
    const half = (SAURIAN_TUNING.tailArcDeg * Math.PI) / 360;
    // Its left edge first, its right edge last, through the middle.
    expect(tailSweepAngle(0)).toBeCloseTo(half, 6);
    expect(tailSweepAngle(TAIL_SWEEP_SPAN / 2)).toBeCloseTo(0, 6);
    expect(tailSweepAngle(TAIL_SWEEP_SPAN)).toBeCloseTo(-half, 6);
  });
});

describe('the footfalls follow the gait', () => {
  it('one cycle crosses all four feet, in the clip order', () => {
    const out: SaurianFoot[] = [];
    expect(saurianFootfallsBetween('walk', 0.001, 1.001, out)).toBe(4);
    expect(out).toEqual(['leftFore', 'rightHind', 'rightFore', 'leftHind']);
    expect(saurianFootfallsBetween('run', 0.45, 0.55, out)).toBe(1);
    expect(out).toEqual(['rightHind']);
    expect(saurianFootfallsBetween('walk', 0.3, 0.3, out)).toBe(0);
  });

  it('never floods the ford after a long hitch', () => {
    const out: SaurianFoot[] = [];
    expect(saurianFootfallsBetween('walk', 0, 40, out)).toBeLessThanOrEqual(5);
  });

  it('strides the patrol at its clip rate', () => {
    const k = saurianModelScale(SAURIAN_SIM_SCALE);
    expect(saurianStride('walk', SAURIAN_SIM_SCALE)).toBeCloseTo(
      SAURIAN_MODEL.walkRef * SAURIAN_MODEL.walkCycle * k,
      6,
    );
    const def = VISUALS.wildheart_great_saurian;
    // The 0.35 patrol pace of a 6 moveSpeed wades near 1x.
    const pace = (MOBS.great_saurian.moveSpeed ?? 6) * 0.35;
    const rate = pace / (def.walkRef ?? 1);
    expect(rate).toBeGreaterThan(0.8);
    expect(rate).toBeLessThan(1.4);
    for (const gait of ['walk', 'run'] as const) {
      const phases = SAURIAN_FOOTFALLS[gait].map((f) => f.phase);
      expect(phases.every((p) => p >= 0 && p < 1)).toBe(true);
    }
  });
});

describe('the body beats sit on the contact frames', () => {
  it('stomp, tail, howdah, enrage, death', () => {
    expect(saurianBeats('stomp').map((b) => b.kind)).toEqual(['stompSlam', 'stompJolt']);
    expect(saurianBeats('stomp')[0].at).toBe(0);
    expect(saurianBeats('tail')[0].at).toBeCloseTo(SAURIAN_CLIP.tailClub - SAURIAN_CLIP.tailHit, 6);
    const howdah = saurianBeats('howdah');
    expect(howdah.find((b) => b.kind === 'howdahBurst')?.at).toBe(SAURIAN_CLIP.howdahBurst);
    const debris = howdah.filter((b) => b.kind === 'debrisSplash');
    expect(debris).toHaveLength(HOWDAH_PIECE_FALLS.length);
    for (const d of debris) {
      expect(d.at).toBeGreaterThanOrEqual(1.4);
      expect(d.at).toBeLessThanOrEqual(1.9 + 1e-9);
    }
    expect(saurianBeats('enrage').map((b) => b.at)).toEqual([...SAURIAN_CLIP.enrageStamps]);
    const death = saurianBeats('death');
    expect(death[0].at).toBe(SAURIAN_CLIP.deathBody);
    expect(death.some((b) => b.kind === 'deathNeck' && b.at === SAURIAN_CLIP.deathNeck)).toBe(true);
    // It rolls onto its LEFT (+x) side.
    expect(death.every((b) => (b.mx ?? 0) > 0)).toBe(true);
  });

  it('bursts the howdah off its deck, high on its back', () => {
    const deck = howdahDeck(SAURIAN_SIM_SCALE);
    expect(deck.up).toBeGreaterThan(9);
    expect(deck.up).toBeLessThan(SAURIAN_DRAW.height * SAURIAN_SIM_SCALE);
  });

  it('every crown and ripple grows from small and fades out by its end', () => {
    for (const spec of Object.values(CROWN_LOOKS)) {
      expect(crownShape(spec, 0).radius).toBeCloseTo(spec.r0, 6);
      expect(crownShape(spec, spec.life).alpha).toBe(0);
      expect(crownShape(spec, spec.life * 0.4).height).toBeGreaterThan(spec.height * 0.5);
    }
    for (const spec of Object.values(RIPPLE_LOOKS)) {
      expect(rippleShape(spec, 0).radius).toBeLessThan(spec.reach * 0.2);
      expect(rippleShape(spec, spec.life).alpha).toBe(0);
    }
    // The Stomp's water wall races to the ring's edge.
    expect(CROWN_LOOKS.stompWall.r1).toBe(SAURIAN_TUNING.stompRadius);
  });
});

describe('the howdah mesh latch', () => {
  const def: MeshToggleDef = {
    nodes: ['GreatSaurianHowdah', 'GreatSaurianRider'],
    hideAfter: {
      gesture: SAURIAN_HOWDAH_BREAK,
      seconds: SAURIAN_CLIP.howdahGone,
      clip: 'HowdahBreak',
    },
    hideNow: SAURIAN_HOWDAH_GONE_GESTURE,
    showNow: SAURIAN_HOWDAH_WHOLE_GESTURE,
  };
  const fresh = (): MeshToggleState => ({ shown: true, hideIn: null, clipSeen: false });

  it('the break plays its clip and hides the howdah once the clip has thrown it', () => {
    expect(meshToggleActions([def], SAURIAN_HOWDAH_BREAK)).toEqual([[0, 'schedule']]);
    const st = fresh();
    applyMeshToggleAction(def, st, 'schedule');
    expect(stepMeshToggle(def, st, 1, 'HowdahBreak')).toBe(false);
    expect(st.shown).toBe(true);
    expect(stepMeshToggle(def, st, SAURIAN_CLIP.howdahGone, 'HowdahBreak')).toBe(true);
    expect(st.shown).toBe(false);
  });

  it('a bar cutting the clip short hides it at once (never snapped back on its back)', () => {
    const st = fresh();
    applyMeshToggleAction(def, st, 'schedule');
    stepMeshToggle(def, st, 0.05, 'HowdahBreak');
    expect(stepMeshToggle(def, st, 0.05, 'Stomp')).toBe(true);
    expect(st.shown).toBe(false);
  });

  it('gone and whole are immediate and idempotent', () => {
    const st = fresh();
    applyMeshToggleAction(def, st, 'hide');
    applyMeshToggleAction(def, st, 'hide');
    expect(st.shown).toBe(false);
    // A second break gesture after it is gone schedules nothing.
    applyMeshToggleAction(def, st, 'schedule');
    expect(st.hideIn).toBeNull();
    applyMeshToggleAction(def, st, 'show');
    expect(st.shown).toBe(true);
    expect(meshToggleActions([def], 'unrelated')).toEqual([]);
  });
});

describe('what the toggles hide (the far mesh and shadow proxy follow it)', () => {
  const part: MeshToggleDef = { nodes: ['GreatSaurianHowdah'], hideNow: 'gone' };
  const whole: MeshToggleDef = { nodes: ['*'], hideNow: 'vanish' };
  const shown = (): MeshToggleState => ({ shown: true, hideIn: null, clipSeen: false });

  it('none, a part (keep the rig articulated) or the whole model (hide the bakes too)', () => {
    expect(meshToggleHidden([part, whole], [shown(), shown()])).toBe('none');
    const a = shown();
    applyMeshToggleAction(part, a, 'hide');
    expect(meshToggleHidden([part, whole], [a, shown()])).toBe('partial');
    const b = shown();
    applyMeshToggleAction(whole, b, 'hide');
    expect(meshToggleHidden([part, whole], [a, b])).toBe('whole');
  });
});
