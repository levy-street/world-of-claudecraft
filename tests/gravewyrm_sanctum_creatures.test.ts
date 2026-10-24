// The Gravewyrm Sanctum's creatures in game (src/render/gravewyrm_sanctum_fx/,
// src/render/characters/sanctum_creature_looks.ts): the Sledge Tusker's and its
// sledge's shipped GLBs carry the clips, meshes, bones and compression the
// look and the fx key on; the model's measured facts agree with the sim (its
// drawn size, the sledge's three bowls landing on the sim's three soulfire
// patch spots, the strikes' contact beats on their bars' ends); the sledge is
// dragged like a trailer and latched, tipped and re-hitched on the right
// states; every telegraph is the sim's own shape (the Tusk Sweep's cone past
// the body, the Trample lane's reach to a drop, the Cinder Breath, the toss
// ring's bar); every new creature stands clearly past a player; the story
// markers draw nothing; and a Glacier Splinter's Shatter ring fills on its own
// fuse.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import {
  SANCTUM_MOB_KEYS,
  SANCTUM_SLEDGE_TUSKER_LOOK,
  SPLINTER_SHATTERED_GESTURE,
  TUSKER_CHARGE_GESTURE,
  TUSKER_TRACES_GONE_GESTURE,
  TUSKER_TRACES_NODE,
  TUSKER_TRACES_ON_GESTURE,
  TUSKER_UNHITCH_GESTURE,
} from '../src/render/characters/sanctum_creature_looks';
import { burstDelayForRadius, burstRingFill } from '../src/render/death_burst_fx_core';
import { TELEGRAPH_THREAT_COLORS } from '../src/render/floor_telegraph/telegraph_look_core';
import {
  buildGateObject,
  gateObjectPlan,
  isStableObjectTransition,
} from '../src/render/gate_objects';
import {
  BLOCK_RELEASE,
  blockFlight,
  objectFill,
  patchPresence,
  rampGlsl,
  SANCTUM_DRAWN_HEIGHTS,
  SANCTUM_FX_MOBS,
  SOULFIRE_RAMP,
  sanctumDrawnHeight,
  sanctumObjectSpecs,
  sanctumTelegraphSpecs,
  shatterBuild,
  shockRingLook,
  stokePulse,
  tramplePaintLength,
  tuskerBodyRadius,
} from '../src/render/gravewyrm_sanctum_fx/sanctum_fx_core';
import {
  barLockedRate,
  bowlFlight,
  bowlOffsets,
  chargeClipRate,
  haulRate,
  KEY_LEAD,
  modelToWorld,
  nextSledgeState,
  rigidSledge,
  SLEDGE_MAX_SWING,
  SLEDGE_MODEL,
  SLEDGE_TIP,
  type SledgePose,
  sledgeTongue,
  sledgeToWorld,
  sweepClipRate,
  TUSKER_CLIP,
  TUSKER_DRAWN_SCALE,
  TUSKER_FOOTFALLS,
  TUSKER_MODEL,
  TUSKER_SIM_SCALE,
  type TuskerFoot,
  trailSledge,
  trampleClipRate,
  tuskerFootfallsBetween,
  tuskerLookHeight,
  tuskerModelScale,
  tuskerStride,
  worldToModel,
} from '../src/render/gravewyrm_sanctum_fx/tusker_model_core';
import { FIRE_FRAG, GHOST_RAMP } from '../src/render/hollow_crypt/crypt_fx_particles';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import {
  SANCTUM_DUNGEON,
  SANCTUM_SOULFIRE_PATCH,
  SANCTUM_TOSS_RING,
  SLEDGE_TUSKER_ID,
  sanctumStoryTemplate,
  TUSKER_ENRAGE,
  TUSKER_TRAMPLE,
  TUSKER_TUNING,
  TUSKER_TUSK_SWEEP,
} from '../src/sim/encounters/gravewyrm_sanctum/ids';
import { trampleReach } from '../src/sim/encounters/gravewyrm_sanctum/sledge_tusker';
import {
  SANCTUM_CINDER_BREATH,
  SANCTUM_GOAD,
  SANCTUM_WARMING_RITE,
} from '../src/sim/mob/trash_kit/sanctum_cast_ids';
import type { Entity } from '../src/sim/types';

/** A player's drawn height (the knight the delivery was measured against). */
const PLAYER = 2.6;

interface GlbJson {
  animations: { name: string; samplers: { input: number }[] }[];
  accessors: { min?: number[]; max?: number[] }[];
  meshes: { name: string }[];
  nodes: { name?: string; mesh?: number; children?: number[] }[];
  images?: { mimeType?: string }[];
  extensionsUsed?: string[];
  skins: { joints: number[] }[];
}

function glbJson(path: string): GlbJson {
  const buf = readFileSync(path);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.toString('utf8', 20, 20 + len)) as GlbJson;
}

function clipLength(json: GlbJson, name: string): number {
  const a = json.animations.find((x) => x.name === name);
  if (!a) return -1;
  let max = 0;
  for (const s of a.samplers) max = Math.max(max, json.accessors[s.input].max?.[0] ?? 0);
  return max;
}

describe('the shipped Sledge Tusker GLBs', () => {
  const beast = glbJson(`public/${TUSKER_MODEL.url}`);
  const sledge = glbJson(`public/${SLEDGE_MODEL.url}`);

  it('carries every clip the look and the fx name, at their authored lengths', () => {
    const want: Record<string, number> = {
      Idle: 4,
      Walk: TUSKER_MODEL.walkCycle,
      Run: TUSKER_MODEL.runCycle,
      Attack: 1.5,
      TuskSweep: 2.5,
      TrampleWindup: 2,
      Charge: TUSKER_CLIP.charge,
      Roar: TUSKER_CLIP.roar,
      Unhitch: TUSKER_CLIP.unhitch,
      Hit: 0.6,
      Death: 3.4,
    };
    // The beast's clips start on their first frame (30 fps, within half a frame).
    for (const [name, len] of Object.entries(want))
      expect(Math.abs(clipLength(beast, name) - len), name).toBeLessThan(1 / 60);
    // Its beats sit inside their clips; the gore lands on frame 18.
    expect(TUSKER_CLIP.attackHit).toBeCloseTo(17 / 30, 2);
    expect(clipLength(beast, 'TuskSweep')).toBeGreaterThan(TUSKER_CLIP.sweepEnd);
    expect(clipLength(beast, 'Death')).toBeGreaterThan(TUSKER_CLIP.deathHead);
    // The sledge's clips (the delivery's) key their first frame one 24 fps frame in.
    for (const [name, len] of Object.entries({ Idle: 2, Haul: SLEDGE_MODEL.haulCycle, Tip: 2.6 })) {
      expect(Math.abs(clipLength(sledge, name) - (len + KEY_LEAD)), name).toBeLessThan(1 / 24);
    }
  });

  it('keeps the trace chains a mesh of their own, and the sledge its bowl bones', () => {
    const named = (j: GlbJson) => new Set(j.nodes.map((n) => n.name));
    expect(beast.meshes.map((m) => m.name)).toEqual(['SledgeTusker', TUSKER_TRACES_NODE]);
    for (const bone of ['head', 'Hitch', 'neck', 'trunk.5', 'hand.l', 'foot.r', 'lantern'])
      expect(named(beast).has(bone), bone).toBe(true);
    for (let i = 1; i <= 3; i++) {
      expect(named(sledge).has(`Brazier${i}`)).toBe(true);
      expect(named(sledge).has(`BrazierFire${i}`)).toBe(true);
    }
    // Each fire anchor rides its own bowl (so a bowl moved onto its patch
    // carries its fire with it).
    for (let i = 1; i <= 3; i++) {
      const bowl = sledge.nodes.find((n) => n.name === `Brazier${i}`);
      const kids = (bowl?.children ?? []).map((c) => sledge.nodes[c].name);
      expect(kids).toContain(`BrazierFire${i}`);
    }
  });

  it('ships meshopt-compressed with every texture in KTX2', () => {
    for (const j of [beast, sledge]) {
      expect(j.extensionsUsed).toContain('EXT_meshopt_compression');
      expect(j.extensionsUsed).toContain('KHR_texture_basisu');
      expect((j.images ?? []).every((i) => i.mimeType === 'image/ktx2')).toBe(true);
    }
    expect(readFileSync(`public/${TUSKER_MODEL.url}`).length).toBeLessThan(3.5e6);
    expect(readFileSync(`public/${SLEDGE_MODEL.url}`).length).toBeLessThan(2e6);
  });
});

describe("the Tusker drawn at the old body's height", () => {
  it('stands its hump as tall as the body it replaced, about three players', () => {
    expect(MOBS[SLEDGE_TUSKER_ID]?.scale).toBe(TUSKER_SIM_SCALE);
    // Reuben 2026-10-11: a remade boss keeps its height. The old body's hump
    // stood 7.76 yd; the new one is authored 7.44, so it is drawn a little over.
    const k = tuskerModelScale(TUSKER_SIM_SCALE);
    expect(k).toBeCloseTo(TUSKER_DRAWN_SCALE, 9);
    expect(TUSKER_MODEL.headTop * k).toBeCloseTo(7.76, 6);
    const drawn = tuskerLookHeight() * TUSKER_SIM_SCALE;
    expect(drawn).toBeCloseTo(TUSKER_MODEL.idleBoundsHeight * k, 6);
    expect(drawn / PLAYER).toBeGreaterThan(2.9);
    expect(SANCTUM_SLEDGE_TUSKER_LOOK.height).toBeCloseTo(tuskerLookHeight(), 9);
  });

  it('reaches past its sim body: the tusks out to the sweep and the flanks to its radius', () => {
    const body = MOBS[SLEDGE_TUSKER_ID]?.bodyRadius ?? 0;
    expect(body).toBe(tuskerBodyRadius());
    const k = tuskerModelScale(TUSKER_SIM_SCALE);
    // The drawn tusk tips stand inside the cone the sim tests (range + body)...
    expect(TUSKER_MODEL.tuskTip.z * k).toBeLessThan(TUSKER_TUNING.sweepRange + body);
    // ...and the coat is wider than the body radius' chord would leave bare.
    expect(TUSKER_MODEL.halfWidth * k).toBeLessThan(body);
  });

  it('lands each strike on its bar: the sweep crosses the cone and the head levels at the end', () => {
    expect(sweepClipRate() * TUSKER_TUNING.sweepCast).toBeCloseTo(TUSKER_CLIP.sweepCross, 9);
    expect(trampleClipRate() * TUSKER_TUNING.trampleCast).toBeCloseTo(TUSKER_CLIP.levelled, 9);
    // The charge runs one stride cycle over the 0.8 s run down the lane.
    expect(chargeClipRate() * TUSKER_TUNING.trampleRun).toBeCloseTo(TUSKER_CLIP.charge, 9);
    expect(barLockedRate(1, 0)).toBe(1);
    // Within a stride of its authored pace (never a sprint for a bar).
    expect(sweepClipRate()).toBeGreaterThan(0.9);
    expect(sweepClipRate()).toBeLessThan(1.3);
  });

  it('wires the bar-locked clips, the gestures and the traces latch into its look', () => {
    const def = SANCTUM_SLEDGE_TUSKER_LOOK;
    expect(def.castClipSync).toBe(true);
    expect(def.clips.castByAbility?.[TUSKER_TUSK_SWEEP]).toBe('TuskSweep');
    expect(def.clips.castByAbility?.[TUSKER_TRAMPLE]).toBe('TrampleWindup');
    expect(def.clips.castTimeScaleByAbility?.[TUSKER_TUSK_SWEEP]).toBeCloseTo(sweepClipRate(), 9);
    expect(def.clips.attackByAbility?.[TUSKER_UNHITCH_GESTURE]).toBe('Unhitch');
    expect(def.clips.attackByAbility?.[TUSKER_CHARGE_GESTURE]).toBe('Charge');
    expect(def.clips.attackByAbility?.[TUSKER_ENRAGE]).toBe('Roar');
    expect(def.oneShotsHoldAttacks).toEqual(['Unhitch', 'Charge', 'Roar']);
    const toggle = def.meshToggles?.[0];
    expect(toggle?.nodes).toEqual([TUSKER_TRACES_NODE]);
    expect(toggle?.hideAfter).toEqual({
      gesture: TUSKER_UNHITCH_GESTURE,
      seconds: TUSKER_CLIP.unhitch,
      clip: 'Unhitch',
    });
    expect(toggle?.hideNow).toBe(TUSKER_TRACES_GONE_GESTURE);
    expect(toggle?.showNow).toBe(TUSKER_TRACES_ON_GESTURE);
  });

  it('round-trips model space and world space', () => {
    const out = { x: 0, z: 0 };
    const back = { x: 0, z: 0 };
    for (const f of [0, 0.7, -2.4, Math.PI]) {
      modelToWorld({ x: 10, z: -4 }, f, 1.3, 2.5, -7, out);
      worldToModel({ x: 10, z: -4 }, f, 1.3, out.x, out.z, back);
      expect(back.x).toBeCloseTo(2.5, 9);
      expect(back.z).toBeCloseTo(-7, 9);
    }
    // Forward is (sin f, cos f); the model's +x is its left.
    modelToWorld({ x: 0, z: 0 }, 0, 1, 0, 5, out);
    expect(out).toEqual({ x: 0, z: 5 });
    modelToWorld({ x: 0, z: 0 }, 0, 1, 2, 0, out);
    expect(out.x).toBeCloseTo(2, 9);
  });

  it('touches each pad down once a cycle, in its gait order', () => {
    const feet: TuskerFoot[] = [];
    for (const gait of ['walk', 'run'] as const) {
      expect(tuskerFootfallsBetween(gait, 0.01, 1.01, feet)).toBe(4);
      expect(new Set(feet).size).toBe(4);
      const phases = TUSKER_FOOTFALLS[gait].map((f) => f.phase);
      expect([...phases].sort((a, b) => a - b)).toEqual(phases);
    }
    expect(tuskerFootfallsBetween('walk', 3, 3, feet)).toBe(0);
    // A cycle carries it ref x cycle at its drawn size.
    expect(tuskerStride('walk', TUSKER_SIM_SCALE)).toBeCloseTo(2.8 * 2.2 * TUSKER_DRAWN_SCALE, 9);
  });
});

describe('the sledge', () => {
  it('hangs its tongue on the hitch ring, the sledge at its own size behind the grown beast', () => {
    expect(sledgeTongue()).toBeCloseTo(4.35, 9);
    // At the authored size its origin hangs 10.5 behind.
    expect(sledgeTongue() - TUSKER_MODEL.hitch.z).toBeCloseTo(SLEDGE_MODEL.behind, 9);
    const beast = { x: 3, z: 4 };
    const pose = rigidSledge(beast, Math.PI / 2, TUSKER_SIM_SCALE, { x: 0, z: 0, yaw: 0 });
    const k = tuskerModelScale(TUSKER_SIM_SCALE);
    const ring = modelToWorld(beast, Math.PI / 2, k, 0, TUSKER_MODEL.hitch.z, { x: 0, z: 0 });
    expect(ring.x - pose.x).toBeCloseTo(sledgeTongue(), 9);
    expect(pose.z).toBeCloseTo(4, 9);
    expect(pose.yaw).toBe(Math.PI / 2);
  });

  it('throws its three bowls onto the very spots the sim lights its soulfire patches', () => {
    // The sim lays the patches in the Tusker's own frame (left, forward); the
    // sledge's origin is 10.5 behind it, facing the same way.
    TUSKER_TUNING.patchSpots.forEach((spot, i) => {
      expect(SLEDGE_TIP.bowlRest[i].x).toBeCloseTo(spot.left, 6);
      expect(SLEDGE_TIP.bowlRest[i].z).toBeCloseTo(spot.fwd + SLEDGE_MODEL.behind, 6);
    });
    expect(SLEDGE_TIP.bowlRest.length).toBe(TUSKER_TUNING.patchSpots.length);
  });

  it('is dragged like a trailer: the tongue keeps its length and the bed straightens behind', () => {
    const beast = { x: 0, z: 0 };
    const pose: SledgePose = rigidSledge(beast, 0, TUSKER_SIM_SCALE, { x: 0, z: 0, yaw: 0 });
    // A quarter turn on the spot leaves the bed askew, never past its swing.
    trailSledge(pose, beast, Math.PI / 2, TUSKER_SIM_SCALE, 0);
    expect(Math.abs(pose.yaw - Math.PI / 2)).toBeLessThanOrEqual(SLEDGE_MAX_SWING + 1e-9);
    // Walking on along the new heading straightens it out.
    for (let i = 0; i < 400; i++) {
      beast.x += 0.135;
      trailSledge(pose, beast, Math.PI / 2, TUSKER_SIM_SCALE, 0.05);
    }
    expect(pose.yaw).toBeCloseTo(Math.PI / 2, 3);
    const k = tuskerModelScale(TUSKER_SIM_SCALE);
    const ring = modelToWorld(beast, Math.PI / 2, k, 0, TUSKER_MODEL.hitch.z, { x: 0, z: 0 });
    expect(Math.hypot(ring.x - pose.x, ring.z - pose.z)).toBeCloseTo(sledgeTongue(), 6);
    // At rest behind it, a dragged sledge stands where the rigid one hangs.
    const rigid = rigidSledge(beast, Math.PI / 2, TUSKER_SIM_SCALE, { x: 0, z: 0, yaw: 0 });
    expect(pose.x).toBeCloseTo(rigid.x, 2);
    expect(pose.z).toBeCloseTo(rigid.z, 2);
  });

  it('settles back in line with time even when the beast turns on the spot', () => {
    const beast = { x: 0, z: 0 };
    const pose = rigidSledge(beast, 0, TUSKER_SIM_SCALE, { x: 0, z: 0, yaw: 0 });
    for (let i = 0; i < 200; i++) trailSledge(pose, beast, 1, TUSKER_SIM_SCALE, 0.05);
    expect(pose.yaw).toBeCloseTo(1, 3);
  });

  it('unhitches at the pull, tips at the spill (or past half health, or dead), re-hitches on a reset', () => {
    const t = (o: Partial<{ dead: boolean; inCombat: boolean; hpShare: number }>) => ({
      dead: false,
      inCombat: false,
      hpShare: 1,
      ...o,
    });
    expect(nextSledgeState('hitched', t({}), false)).toBe('hitched');
    expect(nextSledgeState('hitched', t({ inCombat: true }), false)).toBe('dropped');
    expect(nextSledgeState('dropped', t({ inCombat: true, hpShare: 0.7 }), false)).toBe('dropped');
    expect(nextSledgeState('dropped', t({ inCombat: true, hpShare: 0.7 }), true)).toBe('tipped');
    expect(nextSledgeState('dropped', t({ inCombat: true, hpShare: 0.5 }), false)).toBe('tipped');
    expect(nextSledgeState('dropped', t({ dead: true, hpShare: 0 }), false)).toBe('tipped');
    expect(nextSledgeState('tipped', t({ inCombat: true, hpShare: 0.9 }), false)).toBe('tipped');
    // An evade back to full health off the fight: on the hook again.
    expect(nextSledgeState('tipped', t({ hpShare: 1 }), false)).toBe('hitched');
    expect(nextSledgeState('dropped', t({ hpShare: 1 }), false)).toBe('hitched');
    // Walking home hurt, it still stands where it was left.
    expect(nextSledgeState('dropped', t({ hpShare: 0.8 }), false)).toBe('dropped');
  });

  it('eases each thrown bowl onto its own patch, a halved spot included', () => {
    const pose: SledgePose = { x: 100, z: 50, yaw: 0.6 };
    const at = (sx: number, sz: number) => sledgeToWorld(pose, sx, sz, { x: 0, z: 0 });
    const r = SLEDGE_TIP.bowlRest;
    // Patch 0 exactly on its spot, patch 1 drawn in by half toward the sledge
    // (off the road's edge), patch 2 two yards off.
    const patches = [
      at(r[0].x, r[0].z),
      at(r[1].x / 2, r[1].z / 2),
      at(r[2].x + 1.2, r[2].z - 1.6),
    ];
    const off = bowlOffsets(pose, [patches[2], patches[0], patches[1]]);
    expect(off[0].x).toBeCloseTo(0, 6);
    expect(off[0].z).toBeCloseTo(0, 6);
    expect(off[1].x).toBeCloseTo(-r[1].x / 2, 6);
    expect(off[1].z).toBeCloseTo(-r[1].z / 2, 6);
    expect(off[2].x).toBeCloseTo(1.2, 6);
    expect(off[2].z).toBeCloseTo(-1.6, 6);
    // No patch in reach: the clip's own spot.
    expect(bowlOffsets(pose, [{ x: 1e4, z: 1e4 }])[0]).toEqual({ x: 0, z: 0 });
    // Each bowl eases on between the lurch and its landing.
    for (let i = 0; i < 3; i++) {
      expect(bowlFlight(0, i)).toBe(0);
      expect(bowlFlight(SLEDGE_TIP.bowlsLand[i], i)).toBe(1);
      expect(bowlFlight((SLEDGE_TIP.lurch + SLEDGE_TIP.bowlsLand[i]) / 2, i)).toBeCloseTo(0.5, 6);
    }
  });

  it('hauls in step with the walk and rests on its idle', () => {
    expect(haulRate(0, TUSKER_SIM_SCALE)).toBe(0);
    expect(
      haulRate(TUSKER_MODEL.walkRef * tuskerModelScale(TUSKER_SIM_SCALE), TUSKER_SIM_SCALE),
    ).toBeCloseTo(1, 9);
    expect(haulRate(50, TUSKER_SIM_SCALE)).toBe(2.2);
  });
});

describe('the Sanctum telegraphs are the sim own shapes', () => {
  const specs = sanctumTelegraphSpecs();

  it('paints the Tusk Sweep 10 yd past the body, 120 degrees, orange', () => {
    const s = specs[TUSKER_TUSK_SWEEP];
    expect(s.shape).toBe('cone');
    expect(s.range).toBe(TUSKER_TUNING.sweepRange + tuskerBodyRadius());
    expect(s.arcDeg).toBe(TUSKER_TUNING.sweepArcDeg);
    expect(s.color).toBe(TELEGRAPH_THREAT_COLORS.danger);
  });

  it('paints the Cinder Breath the template breathes', () => {
    const b = MOBS.sanctum_drakonid?.breathCone;
    expect(b?.castId).toBe(SANCTUM_CINDER_BREATH);
    expect(specs[SANCTUM_CINDER_BREATH]).toMatchObject({
      shape: 'cone',
      range: b?.range,
      arcDeg: b?.arcDeg,
      color: TELEGRAPH_THREAT_COLORS.danger,
    });
  });

  it('marks both kicks with the interrupt glyph', () => {
    for (const id of [SANCTUM_WARMING_RITE, SANCTUM_GOAD]) {
      expect(specs[id].shape).toBe('sigil');
      expect(specs[id].color).toBe(TELEGRAPH_THREAT_COLORS.interrupt);
    }
  });

  it('runs the Trample lane exactly as far as the sim measured it, from the instance origin', () => {
    const lane = specs[TUSKER_TRAMPLE];
    expect(lane.shape).toBe('lane');
    expect(lane.halfWidth).toBe(TUSKER_TUNING.trampleHalfWidth);
    const def = DUNGEONS[SANCTUM_DUNGEON];
    const o = instanceOrigin(def.index, 2);
    const body = tuskerBodyRadius();
    // Down the road's first leg and straight across it toward the crevasse.
    for (const [lx, lz, yaw] of [
      [-12, -164, Math.atan2(-24, 20)],
      [-26, -152, Math.atan2(24, -20)],
      [-20, -150, Math.PI / 2],
    ]) {
      const want = trampleReach(lx, lz, yaw, TUSKER_TUNING.trampleLength) + body;
      expect(tramplePaintLength(o.x + lx, o.z + lz, yaw)).toBeCloseTo(want, 9);
      expect(want).toBeLessThanOrEqual(TUSKER_TUNING.trampleLength + body);
    }
  });

  it('fills the toss ring over the Hauler bar and stands the soulfire for its life', () => {
    const objs = sanctumObjectSpecs();
    expect(objs[SANCTUM_TOSS_RING].fillSeconds).toBe(
      MOBS.ogre_sledge_hauler?.trashKit?.toss?.castTime,
    );
    expect(objs[SANCTUM_SOULFIRE_PATCH].fillSeconds).toBe(0);
    expect(objs[SANCTUM_SOULFIRE_PATCH].seconds).toBe(TUSKER_TUNING.patchSeconds);
    expect(objectFill(1, 2)).toBe(0.5);
    expect(objectFill(5, 0)).toBe(1);
    // A patch flares up, burns, and gutters over its last second (never out).
    expect(patchPresence(0, 10)).toBe(0);
    expect(patchPresence(5, 10)).toBe(1);
    expect(patchPresence(9.9, 10)).toBeGreaterThanOrEqual(0.25);
    expect(patchPresence(9.9, 10)).toBeLessThan(1);
  });

  it('times the cosmetic beats on the sim clocks', () => {
    // The block leaves the Hauler's hands late in the bar and lands at its end.
    expect(blockFlight(BLOCK_RELEASE - 0.01, 7)).toBeNull();
    expect(blockFlight(1, 7)).toEqual({ along: 1, lift: 0 });
    expect(blockFlight((1 + BLOCK_RELEASE) / 2, 7)?.lift).toBeCloseTo(7, 9);
    const brazier = stokePulse(0.45, 10);
    expect(brazier.radius).toBeGreaterThan(5);
    expect(stokePulse(5, 10).alpha).toBe(0);
    expect(shatterBuild(2, 2).glow).toBe(1);
    expect(shatterBuild(0, 2).glow).toBeLessThan(0.5);
    expect(shockRingLook(0, 6, 1).alpha).toBe(1);
    expect(shockRingLook(1, 6, 1).radius).toBeCloseTo(6 * 1.12, 9);
  });

  it('burns soulfire violet-green, never white', () => {
    const glsl = rampGlsl(SOULFIRE_RAMP, 'ghostRamp');
    expect(glsl.startsWith('vec3 ghostRamp(float h) {')).toBe(true);
    expect(glsl.split('mix(').length - 1).toBe(SOULFIRE_RAMP.length);
    for (const [, r, g, b] of SOULFIRE_RAMP) expect(Math.min(r, g, b)).toBeLessThan(0.85);
    // Its middle burns violet (blue over green), its top soul-green.
    const mid = SOULFIRE_RAMP[2];
    expect(mid[3]).toBeGreaterThan(mid[2]);
    const top = SOULFIRE_RAMP[SOULFIRE_RAMP.length - 1];
    expect(top[2]).toBeGreaterThan(top[1]);
    // The flame shader really swaps its ramp (a drift in the crypt's ramp text
    // would otherwise leave the soulfire silently ghost-green).
    expect(FIRE_FRAG).toContain(GHOST_RAMP);
    const soul = FIRE_FRAG.replace(GHOST_RAMP, glsl);
    expect(soul).not.toBe(FIRE_FRAG);
    expect(soul).toContain(glsl);
  });
});

describe('the Sanctum creatures stand clearly past a player', () => {
  it('maps every new template to a Sanctum look', () => {
    for (const [mob, key] of Object.entries(SANCTUM_MOB_KEYS)) {
      expect(MOBS[mob], mob).toBeDefined();
      expect(VISUALS[key], key).toBeDefined();
      expect(visualKeyFor({ kind: 'mob', templateId: mob } as Entity)).toBe(key);
    }
    for (const mob of SANCTUM_FX_MOBS) expect(SANCTUM_MOB_KEYS[mob], mob).toBeDefined();
  });

  it('draws every creature (the brazier prop aside) at least a head past a player', () => {
    for (const [mob, drawn] of Object.entries(SANCTUM_DRAWN_HEIGHTS)) {
      const def = VISUALS[SANCTUM_MOB_KEYS[mob]];
      const scale = MOBS[mob]?.scale ?? 1;
      expect(def.height * scale, mob).toBeCloseTo(drawn, 6);
      expect(sanctumDrawnHeight(mob, scale)).toBeCloseTo(drawn, 9);
      if (mob === 'soul_brazier') continue;
      expect(drawn, mob).toBeGreaterThan(PLAYER * 1.2);
    }
  });

  it('hides a Glacier Splinter whole once it shatters', () => {
    const def = VISUALS.sanctum_glacier_splinter;
    expect(def.meshToggles).toEqual([{ nodes: ['*'], hideNow: SPLINTER_SHATTERED_GESTURE }]);
  });
});

describe('the Sanctum encounter objects', () => {
  const at = (templateId: string) => ({
    templateId,
    dungeonId: SANCTUM_DUNGEON,
    pos: { x: 0, z: 0 },
  });

  it('gives every story marker, ring and patch an empty anchor (no body, no plate)', () => {
    for (const t of [
      sanctumStoryTemplate(0),
      sanctumStoryTemplate(8),
      SANCTUM_TOSS_RING,
      SANCTUM_SOULFIRE_PATCH,
    ]) {
      const plan = gateObjectPlan(at(t));
      expect(plan, t).toEqual({ encounterAnchor: true, height: 2 });
      if (!plan) continue;
      const body = buildGateObject(plan);
      let meshes = 0;
      body.traverse((o) => {
        if ((o as { isMesh?: boolean }).isMesh) meshes++;
      });
      expect(meshes, t).toBe(0);
    }
  });

  it('rebuilds a story marker view on each crack step, so the face memory sees it', () => {
    // The empty anchor's rebuild is what reports the step (gate_objects.ts ->
    // gravewyrm_sanctum/sanctum_story_core.ts); a stable swap would hide it.
    expect(isStableObjectTransition(sanctumStoryTemplate(0), sanctumStoryTemplate(1))).toBe(false);
    expect(isStableObjectTransition(sanctumStoryTemplate(5), sanctumStoryTemplate(8))).toBe(false);
    expect(isStableObjectTransition(sanctumStoryTemplate(1), SANCTUM_TOSS_RING)).toBe(false);
  });
});

describe('a death burst ring fills on its own mob fuse', () => {
  it("reads a Glacier Splinter's Shatter fuse off its own template", () => {
    const splinter = MOBS.glacier_splinter?.trashKit?.deathBurst;
    expect(splinter?.delay).toBe(2);
    expect(burstDelayForRadius(splinter?.radius ?? 0, MOBS.glacier_splinter?.name)).toBe(
      splinter?.delay,
    );
    // A ring with no name still reads off the nearest delayed burst's radius.
    expect(burstDelayForRadius(splinter?.radius ?? 0)).toBe(splinter?.delay);
    // The Rime Whelp's Hoarfrost Pop goes off at once: it paints no ring, so
    // it never steers a ring's fuse (a ring that names it still reads the
    // nearest DELAYED burst, never a zero fuse).
    // (Read at the Splinter's radius: the Barnacle Crawler's Brine Burst is a
    // delayed trash-kit burst too now, nearer a 3 yd ring.)
    expect(MOBS.rime_whelp?.trashKit?.deathBurst?.delay).toBe(0);
    expect(burstDelayForRadius(splinter?.radius ?? 0, MOBS.rime_whelp?.name)).toBe(splinter?.delay);
    expect(burstDelayForRadius(3, MOBS.rime_whelp?.name)).toBeGreaterThan(0);
  });

  it('fills the ring from empty to full over its fuse, clamped', () => {
    expect(burstRingFill(0, 2)).toBe(0);
    expect(burstRingFill(1, 2)).toBe(0.5);
    expect(burstRingFill(2, 2)).toBe(1);
    expect(burstRingFill(5, 2)).toBe(1);
    expect(burstRingFill(-1, 2)).toBe(0);
    // A zero fuse is a standing ring: full at once.
    expect(burstRingFill(0, 0)).toBe(1);
  });
});
