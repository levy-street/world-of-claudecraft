// The Gorgebloom's Blender body in game (src/render/wildheart_basin/
// gorgebloom_model_core.ts and gorgebloom_fx_core.ts, src/render/characters/
// wildheart_creature_looks.ts, turn_in_place_core.ts and glow_pulse_core.ts):
// the shipped GLB carries every clip, bone anchor and glow map the look and the
// effects key on; the model draws at its authored size with its waterline on
// the pivot; every bar's contact frame lands on the bar's end; the effects
// leave the model's own anchors (the maw, the sacs, the lash's club) and stay
// inside the sim's numbers; the rooted body slews round playing Turn; its glow
// flares on gestures and dies with it.
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAST_CLIP_SYNC_SLACK, castClipSyncTime } from '../src/render/characters/anim_state';
import { applyEntityAnimOverrides } from '../src/render/characters/anim_state_entity_core';
import {
  glowPulseEnvelope,
  glowPulseLevel,
  glowPulseSpan,
  glowPulsesFor,
} from '../src/render/characters/glow_pulse_core';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import {
  createTurnInPlaceState,
  stepTurnInPlace,
  TURN_SNAP_DT,
  TURN_TAIL_SECONDS,
  wrapAngle,
} from '../src/render/characters/turn_in_place_core';
import {
  GORGEBLOOM_TURN_RATE,
  WILDHEART_GORGEBLOOM_LOOK,
} from '../src/render/characters/wildheart_creature_looks';
import {
  basinBossCastSpecs,
  bossBodyHeight,
} from '../src/render/wildheart_basin/basin_boss_fx_core';
import { GORGEBLOOM_ROOT_POOL } from '../src/render/wildheart_basin/basin_plan_core';
import { type ThornGrowth, thornGrowthInto } from '../src/render/wildheart_basin/basin_thorns_core';
import {
  bloomBarTrigger,
  bloomEventTrigger,
  bloomPlayOutSeconds,
  GORGE_RATE,
  GORGEBLOOM_GLOW,
  GORGEBLOOM_GULLET_GESTURE,
  GORGEBLOOM_ROAR_GESTURE,
  GORGEBLOOM_SACS_GESTURE,
  GORGEBLOOM_THROAT_GESTURE,
  gorgebloomBeats,
  LASH_WAVE_SPEED,
  lashImpactReach,
  lashWaveDelay,
  lashWaveStations,
  SEED_RAIN_RATE,
  SPIT_GLOB_DELAY,
  SPIT_RATE,
  VINE_LASH_RATE,
} from '../src/render/wildheart_basin/gorgebloom_fx_core';
import {
  GORGEBLOOM_CLIP,
  GORGEBLOOM_MODEL,
  GORGEBLOOM_SIM_SCALE,
  gorgebloomLookHeight,
  gorgebloomLookHover,
  gorgebloomModelScale,
  gorgebloomModelToWorld,
  KEY_LEAD,
} from '../src/render/wildheart_basin/gorgebloom_model_core';
import { GORGEBLOOM_DAIS, WILDHEART_HEIGHTS } from '../src/sim/content/wildheart_basin_layout';
import { DUNGEONS, MOBS } from '../src/sim/data';
import {
  BLOOM_GORGE,
  BLOOM_POLLINATE,
  BLOOM_SEED_RAIN,
  BLOOM_SPIT,
  BLOOM_TUNING,
  BLOOM_VINE_LASH,
  GORGEBLOOM_ID,
} from '../src/sim/encounters/wildheart_basin/ids';
import type { Entity } from '../src/sim/types';

const GLB = `public/${GORGEBLOOM_MODEL.url}`;

interface GlbNode {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}
interface GlbJson {
  animations: { name: string; samplers: { input: number }[] }[];
  accessors: { count: number; min?: number[]; max?: number[] }[];
  meshes: { name: string; primitives: { indices?: number }[] }[];
  nodes: GlbNode[];
  materials: { name: string; emissiveTexture?: unknown; emissiveFactor?: number[] }[];
  images?: { mimeType?: string; name?: string }[];
  extensionsUsed?: string[];
  skins: { joints: number[] }[];
}

function glbJson(path: string): GlbJson {
  const buf = readFileSync(path);
  return JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12))) as GlbJson;
}

const json = glbJson(GLB);

function clipLength(name: string): number {
  const a = json.animations.find((x) => x.name === name);
  if (!a) return 0;
  return Math.max(...a.samplers.map((s) => json.accessors[s.input].max?.[0] ?? 0));
}

type V3 = [number, number, number];
type Q = [number, number, number, number];
function qmul(a: Q, b: Q): Q {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
function qrot(q: Q, v: V3): V3 {
  const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [p[0], p[1], p[2]];
}

/** A node's rest position in model space (its head), from the node TRS chain. */
function restWorld(name: string): V3 {
  const parent = new Map<number, number>();
  json.nodes.forEach((n, i) => {
    for (const c of n.children ?? []) parent.set(c, i);
  });
  const chain: number[] = [];
  let i: number | undefined = json.nodes.findIndex((n) => n.name === name);
  while (i !== undefined) {
    chain.unshift(i);
    i = parent.get(i);
  }
  let p: V3 = [0, 0, 0];
  let q: Q = [0, 0, 0, 1];
  for (const i of chain) {
    const n = json.nodes[i];
    const t = (n.translation ?? [0, 0, 0]) as V3;
    const r = qrot(q, t);
    p = [p[0] + r[0], p[1] + r[1], p[2] + r[2]];
    q = qmul(q, (n.rotation ?? [0, 0, 0, 1]) as Q);
  }
  return p;
}

const key = (templateId: string) => visualKeyFor({ kind: 'mob', templateId } as unknown as Entity);

describe('the shipped GLB', () => {
  it('carries every clip the look plays, long enough for its contact frames', () => {
    const c = WILDHEART_GORGEBLOOM_LOOK.clips;
    for (const clip of [
      c.idle,
      c.walk,
      c.run,
      c.turn,
      c.death,
      c.cast,
      c.flourish,
      ...c.attack,
      ...(c.hit ?? []),
      ...Object.values(c.castByAbility ?? {}),
      ...Object.values(c.attackByAbility ?? {}),
    ])
      expect(clipLength(clip ?? ''), clip).toBeGreaterThan(0.5);
    const C = GORGEBLOOM_CLIP;
    expect(clipLength('SeedRain')).toBeCloseTo(C.seedLength, 2);
    expect(clipLength('VineLash')).toBeCloseTo(C.lashLength, 2);
    expect(clipLength('Gorge')).toBeCloseTo(C.gorgeLength, 2);
    expect(clipLength('Pollinate')).toBeCloseTo(C.pollinateLength, 2);
    expect(clipLength('Death')).toBeCloseTo(C.deathLength, 2);
    expect(clipLength('Death')).toBeGreaterThan(C.deathRest);
    expect(clipLength('BloomSpit')).toBeGreaterThan(C.spitGlob);
    expect(clipLength('Roar')).toBeGreaterThan(C.roarPeak);
  });

  it('keys every clip from one frame in (the lead every beat carries)', () => {
    for (const a of json.animations) {
      const first = Math.min(...a.samplers.map((s) => json.accessors[s.input].min?.[0] ?? 0));
      expect(first, a.name).toBeCloseTo(KEY_LEAD, 4);
    }
  });

  it('keeps the effect anchors as bones, where the notes measured them', () => {
    const names = new Set(json.nodes.map((n) => n.name));
    for (const bone of ['MawAnchor', 'LashTip', 'Sac_FL', 'Sac_FR', 'Sac_BL', 'Sac_BR', 'Jaw'])
      expect(names.has(bone), bone).toBe(true);
    for (let i = 1; i <= 6; i++) expect(names.has(`R_Vine${i}`)).toBe(true);
    const maw = restWorld('MawAnchor');
    expect(maw[0]).toBeCloseTo(GORGEBLOOM_MODEL.maw.x, 1);
    expect(maw[1]).toBeCloseTo(GORGEBLOOM_MODEL.maw.y, 1);
    expect(maw[2]).toBeCloseTo(GORGEBLOOM_MODEL.maw.z, 1);
    const tip = restWorld('LashTip');
    expect(tip[0]).toBeCloseTo(GORGEBLOOM_MODEL.lashTip.x, 1);
    expect(tip[1]).toBeCloseTo(GORGEBLOOM_MODEL.lashTip.y, 1);
    expect(tip[2]).toBeCloseTo(GORGEBLOOM_MODEL.lashTip.z, 1);
    // The lash vine is the RIGHT one (-x); the sacs' tails stand out past
    // their heads, the front pair ahead and the back pair behind.
    expect(tip[0]).toBeLessThan(0);
    for (const [bone, sac] of [
      ['Sac_FL', GORGEBLOOM_MODEL.sacs[0]],
      ['Sac_FR', GORGEBLOOM_MODEL.sacs[1]],
      ['Sac_BL', GORGEBLOOM_MODEL.sacs[2]],
      ['Sac_BR', GORGEBLOOM_MODEL.sacs[3]],
    ] as const) {
      const head = restWorld(bone);
      expect(Math.sign(head[0]), bone).toBe(Math.sign(sac.x));
      expect(Math.sign(head[2]), bone).toBe(Math.sign(sac.z));
      expect(Math.abs(sac.x), bone).toBeGreaterThan(Math.abs(head[0]));
    }
  });

  it('one skinned body, its glow map on the one material, compressed inside its budget', () => {
    expect(json.skins).toHaveLength(1);
    expect(json.skins[0].joints).toHaveLength(52);
    expect(json.materials).toHaveLength(1);
    expect(json.materials[0].name).toBe('GorgebloomBody');
    expect(json.materials[0].emissiveTexture).toBeDefined();
    expect((json.images ?? []).some((i) => i.name?.includes('glow'))).toBe(true);
    expect(json.extensionsUsed).toEqual(
      expect.arrayContaining(['EXT_meshopt_compression', 'KHR_texture_basisu']),
    );
    expect((json.images ?? []).every((i) => i.mimeType === 'image/ktx2')).toBe(true);
    let tris = 0;
    for (const m of json.meshes)
      for (const p of m.primitives)
        if (p.indices !== undefined) tris += json.accessors[p.indices].count / 3;
    expect(tris).toBe(50_318);
    expect(statSync(GLB).size).toBeLessThan(3.2 * 1024 * 1024);
  });
});

describe('the look and the model agree with the sim', () => {
  it('maps the template to its Blender body, drawn at its authored size', () => {
    expect(key(GORGEBLOOM_ID)).toBe('wildheart_gorgebloom');
    expect(MOBS.the_gorgebloom.scale).toBe(GORGEBLOOM_SIM_SCALE);
    const def = VISUALS.wildheart_gorgebloom;
    expect(def).toBe(WILDHEART_GORGEBLOOM_LOOK);
    expect(def.url).toBe(GORGEBLOOM_MODEL.url);
    expect(def.height).toBeCloseTo(gorgebloomLookHeight(), 6);
    // One model yard per game yard: the bounds (roots to the raised petal) at
    // its 2.8, the waterline on the pivot.
    const k = GORGEBLOOM_SIM_SCALE;
    expect(def.height * k).toBeCloseTo(GORGEBLOOM_MODEL.idleTop - GORGEBLOOM_MODEL.idleMin, 6);
    expect((def.hover ?? 0) * k).toBeCloseTo(GORGEBLOOM_MODEL.idleMin, 6);
    expect(gorgebloomLookHover()).toBeLessThan(0);
    expect(gorgebloomModelScale(k)).toBe(1);
    // A three-storey house beside a 2.6 yd player, never toy-like.
    expect(bossBodyHeight(GORGEBLOOM_ID, k)).toBeCloseTo(GORGEBLOOM_MODEL.idleTop, 6);
    expect(GORGEBLOOM_MODEL.idleTop).toBeGreaterThan(13);
    // The sim's body radius sits inside its root crown (melee reaches the roots).
    expect(MOBS.the_gorgebloom.bodyRadius ?? 0).toBeLessThanOrEqual(GORGEBLOOM_MODEL.rootCrown);
    expect(def.clickRadius).toBeGreaterThanOrEqual(4);
  });

  it('plays each bar from its start at the rate that lands its strike on the bar end', () => {
    const c = WILDHEART_GORGEBLOOM_LOOK.clips;
    const C = GORGEBLOOM_CLIP;
    const bars: [string, string, number, number, number][] = [
      [BLOOM_SEED_RAIN, 'SeedRain', BLOOM_TUNING.seedCast, C.seedSpit, SEED_RAIN_RATE],
      [BLOOM_VINE_LASH, 'VineLash', BLOOM_TUNING.lashCast, C.lashSlam, VINE_LASH_RATE],
      [BLOOM_GORGE, 'Gorge', BLOOM_TUNING.gorgeCast, C.gorgeBite, GORGE_RATE],
    ];
    for (const [id, clip, bar, beat, rate] of bars) {
      expect(c.castByAbility?.[id]).toBe(clip);
      expect(c.castTimeScaleByAbility?.[id]).toBeCloseTo(rate, 9);
      // bar seconds at that rate reach exactly the contact frame.
      expect(bar * rate).toBeCloseTo(beat, 9);
      expect(c.castPlayOut).toContain(clip);
      // The clip outlives its contact frame: a play-out after the bar.
      expect(bloomPlayOutSeconds(id)).toBeGreaterThan(0.5);
    }
    expect(WILDHEART_GORGEBLOOM_LOOK.castPlayOutHoldsAttacks).toBe(true);
  });

  it('plays Pollinate, Bloom Spit and the roar as gestures, held against auto-attacks', () => {
    const c = WILDHEART_GORGEBLOOM_LOOK.clips;
    expect(c.attackByAbility?.[BLOOM_POLLINATE]).toBe('Pollinate');
    expect(c.attackByAbility?.[BLOOM_SPIT]).toBe('BloomSpit');
    expect(c.attackByAbility?.[GORGEBLOOM_ROAR_GESTURE]).toBe('Roar');
    expect(c.attackTimeScaleByAbility?.[BLOOM_SPIT]).toBe(SPIT_RATE);
    expect(WILDHEART_GORGEBLOOM_LOOK.oneShotsHoldAttacks).toEqual(
      expect.arrayContaining(['Pollinate', 'BloomSpit', 'Roar']),
    );
    // The glob leaves the maw on the quick clip's own frame.
    expect(SPIT_GLOB_DELAY * SPIT_RATE).toBeCloseTo(GORGEBLOOM_CLIP.spitGlob, 9);
    expect(SPIT_GLOB_DELAY).toBeLessThan(0.4);
  });

  it('turns in place with its Turn loop, never walks', () => {
    const def = WILDHEART_GORGEBLOOM_LOOK;
    expect(def.clips.turn).toBe('Turn');
    expect(def.turnRate).toBe(GORGEBLOOM_TURN_RATE);
    expect(MOBS.the_gorgebloom.moveSpeed).toBe(0);
    // A quarter turn comes round inside a second; a full about-face in the
    // 1.5 s of a Vine Lash bar.
    expect(Math.PI / 2 / GORGEBLOOM_TURN_RATE).toBeLessThan(1);
    expect(Math.PI / GORGEBLOOM_TURN_RATE).toBeLessThanOrEqual(BLOOM_TUNING.lashCast + 0.1);
  });

  it('stands its waterline on the root pool over its dais', () => {
    const spawn = DUNGEONS.wildheart_basin?.spawns.find((s) => s.mobId === GORGEBLOOM_ID);
    expect(spawn).toBeDefined();
    expect(spawn?.x).toBe(GORGEBLOOM_DAIS.x);
    expect(spawn?.z).toBe(GORGEBLOOM_DAIS.z);
    expect(GORGEBLOOM_ROOT_POOL.x).toBe(GORGEBLOOM_DAIS.x);
    expect(GORGEBLOOM_ROOT_POOL.z).toBe(GORGEBLOOM_DAIS.z);
    expect(GORGEBLOOM_ROOT_POOL.r).toBeLessThan(GORGEBLOOM_DAIS.r);
    const top = WILDHEART_HEIGHTS.fallsTerrace + GORGEBLOOM_DAIS.rise;
    expect(GORGEBLOOM_ROOT_POOL.y).toBeGreaterThan(top);
    expect(GORGEBLOOM_ROOT_POOL.y).toBeLessThan(top + 0.2);
  });
});

describe('the effects leave the model', () => {
  const at = (p: { x: number; y: number; z: number }, facing = 0) =>
    gorgebloomModelToWorld({ x: 0, y: 0, z: 0 }, facing, GORGEBLOOM_SIM_SCALE, p, {
      x: 0,
      y: 0,
      z: 0,
    });

  it('turns model space into the world the way the sim faces (its left is +x)', () => {
    const p = at({ x: 1, y: 2, z: 3 });
    expect(p).toEqual({ x: 1, y: 2, z: 3 });
    // Facing +x (a quarter turn): forward is +x, its left (model +x) is -z.
    const q = at({ x: 1, y: 0, z: 3 }, Math.PI / 2);
    expect(q.x).toBeCloseTo(3, 9);
    expect(q.z).toBeCloseTo(-1, 9);
  });

  it('spits the seeds from high in the maw, aimed up and out', () => {
    const C = GORGEBLOOM_CLIP;
    expect(C.seedMaw.y).toBeGreaterThan(GORGEBLOOM_MODEL.maw.y);
    expect(C.seedMaw.y).toBeLessThan(GORGEBLOOM_MODEL.idleTop);
    expect(C.spitMaw.z).toBeGreaterThan(0);
    // The bite closes over a tank standing at the sim's melee reach.
    expect(C.gorgeBiteMaw.z).toBeGreaterThan((MOBS.the_gorgebloom.bodyRadius ?? 0) - 0.5);
    expect(C.gorgeBiteMaw.y).toBeLessThan(C.gorgeGapeMaw.y);
  });

  it("slams the club on the lane's centre line, then the thorn wave runs the rest of it", () => {
    const C = GORGEBLOOM_CLIP;
    expect(Math.abs(C.lashTipImpact.x)).toBeLessThan(BLOOM_TUNING.lashHalfWidth);
    const reach = lashImpactReach(GORGEBLOOM_SIM_SCALE);
    expect(reach).toBeCloseTo(8.74, 6);
    const stations = lashWaveStations(GORGEBLOOM_SIM_SCALE, []);
    expect(stations.length).toBeGreaterThanOrEqual(7);
    expect(stations[0]).toBeGreaterThan(reach);
    expect(stations[stations.length - 1]).toBeLessThanOrEqual(BLOOM_TUNING.lashLength);
    expect(stations[stations.length - 1]).toBeGreaterThan(BLOOM_TUNING.lashLength - 3);
    for (let i = 1; i < stations.length; i++)
      expect(stations[i]).toBeGreaterThanOrEqual(stations[i - 1]);
    // The front races the lane out fast (a crack, not a crawl).
    const last = lashWaveDelay(BLOOM_TUNING.lashLength, GORGEBLOOM_SIM_SCALE);
    expect(last).toBeCloseTo((BLOOM_TUNING.lashLength - reach) / LASH_WAVE_SPEED, 9);
    expect(last).toBeLessThan(0.5);
    const wave = gorgebloomBeats('lashSlam').filter((b) => b.kind === 'lashWave');
    expect(wave).toHaveLength(stations.length);
    expect(gorgebloomBeats('lashSlam')[0]).toEqual({ kind: 'lashSlam', at: 0 });
  });

  it('every beat sits on its clip frame', () => {
    const C = GORGEBLOOM_CLIP;
    const beat = (t: Parameters<typeof gorgebloomBeats>[0], kind: string) =>
      gorgebloomBeats(t).find((b) => b.kind === kind)?.at;
    expect(beat('seedSpit', 'seedSpit')).toBe(0);
    expect(beat('pollinate', 'pollenBurst')).toBe(C.pollinateBurst);
    expect(beat('pollinate', 'pollenReach') ?? 0).toBeGreaterThan(C.pollinateBurst);
    expect(beat('lashBar', 'lashRear')).toBeCloseTo(C.lashHigh / VINE_LASH_RATE, 9);
    expect(beat('lashBar', 'lashRear') ?? 9).toBeLessThan(BLOOM_TUNING.lashCast);
    expect(beat('gorgeBar', 'gorgeDrool')).toBeCloseTo(C.gorgeGape / GORGE_RATE, 9);
    const shakes = gorgebloomBeats('gorgeBite').filter((b) => b.kind === 'gorgeShake');
    expect(shakes.map((b) => b.at)).toEqual(
      C.gorgeShakes.map((s) => (s - C.gorgeBite) / GORGE_RATE),
    );
    expect(beat('spit', 'spitFlash')).toBe(SPIT_GLOB_DELAY);
    expect(beat('roar', 'roarPeak')).toBe(C.roarPeak);
    const death = gorgebloomBeats('death');
    expect(death.find((b) => b.kind === 'deathSplash')?.at).toBe(C.deathSplash);
    for (const b of death.filter((d) => d.kind === 'deathPetals')) {
      expect(b.at).toBeGreaterThanOrEqual(C.deathWilt);
      expect(b.at).toBeLessThan(C.deathSplash);
    }
    for (const b of death.filter((d) => d.kind === 'deathSink')) {
      expect(b.at).toBeGreaterThan(C.deathSplash);
      expect(b.at).toBeLessThan(C.deathLength);
    }
  });

  it('routes its own spellfx and bars to body beats, nothing else', () => {
    expect(bloomEventTrigger(BLOOM_SEED_RAIN)).toBe('seedSpit');
    expect(bloomEventTrigger(BLOOM_POLLINATE)).toBe('pollinate');
    expect(bloomEventTrigger(BLOOM_VINE_LASH)).toBe('lashSlam');
    expect(bloomEventTrigger(BLOOM_GORGE)).toBe('gorgeBite');
    expect(bloomEventTrigger(BLOOM_SPIT)).toBe('spit');
    expect(bloomEventTrigger('wildheart_seedpod_stomp')).toBeNull();
    expect(bloomBarTrigger(BLOOM_SEED_RAIN)).toBe('seedBar');
    expect(bloomBarTrigger(BLOOM_VINE_LASH)).toBe('lashBar');
    expect(bloomBarTrigger(BLOOM_GORGE)).toBe('gorgeBar');
    expect(bloomBarTrigger(null)).toBeNull();
    expect(bloomPlayOutSeconds(null)).toBe(0);
  });

  it('the Seed Rain sigil turns round the roots, outside the bulb', () => {
    const spec = basinBossCastSpecs()[BLOOM_SEED_RAIN];
    expect(spec.shape).toBe('charge');
    expect(spec.range).toBeGreaterThan(GORGEBLOOM_MODEL.bulbRadius);
  });

  it('thorns tear up fast, stand, then sink away', () => {
    const g: ThornGrowth = { grow: 0, sink: 0, alive: false };
    expect(thornGrowthInto(0, g).grow).toBe(0);
    expect(thornGrowthInto(0.1, g).grow).toBeGreaterThan(0.8);
    expect(thornGrowthInto(0.3, g)).toEqual({ grow: 1, sink: 0, alive: true });
    const sinking = thornGrowthInto(1, g);
    expect(sinking.alive).toBe(true);
    expect(sinking.sink).toBeGreaterThan(0);
    expect(thornGrowthInto(5, g).alive).toBe(false);
  });
});

describe('the glow of its gullet and sacs', () => {
  it('the bars stoke the gullet to its peak on the strike, then it cools', () => {
    const [i] = glowPulsesFor(GORGEBLOOM_GLOW, GORGEBLOOM_GULLET_GESTURE, []);
    const p = GORGEBLOOM_GLOW.pulses[i];
    expect(glowPulseEnvelope(p, 0)).toBe(0);
    expect(glowPulseEnvelope(p, p.rise)).toBe(1);
    // At its peak on a 1.5 s bar's strike.
    expect(Math.abs(p.rise - BLOOM_TUNING.seedCast)).toBeLessThan(0.1);
    expect(glowPulseEnvelope(p, glowPulseSpan(p) + 0.01)).toBe(0);
    const ages = GORGEBLOOM_GLOW.pulses.map((_, k) => (k === i ? p.rise : -1));
    expect(glowPulseLevel(GORGEBLOOM_GLOW, ages, -1)).toBeCloseTo(p.peak, 9);
  });

  it('the sacs blaze on the burst frame; every gesture it sends has a pulse', () => {
    const [s] = glowPulsesFor(GORGEBLOOM_GLOW, GORGEBLOOM_SACS_GESTURE, []);
    const sacs = GORGEBLOOM_GLOW.pulses[s];
    expect((sacs.delay ?? 0) + sacs.rise).toBeCloseTo(GORGEBLOOM_CLIP.pollinateBurst, 9);
    for (const g of [GORGEBLOOM_THROAT_GESTURE, GORGEBLOOM_ROAR_GESTURE])
      expect(glowPulsesFor(GORGEBLOOM_GLOW, g, []).length, g).toBe(1);
    expect(glowPulsesFor(GORGEBLOOM_GLOW, 'unrelated', [])).toEqual([]);
  });

  it('overlapping pulses add their excess; the death puts it out for good', () => {
    const ages = GORGEBLOOM_GLOW.pulses.map((p) => (p.delay ?? 0) + p.rise);
    const all = glowPulseLevel(GORGEBLOOM_GLOW, ages, -1);
    const sum = 1 + GORGEBLOOM_GLOW.pulses.reduce((a, p) => a + (p.peak - 1), 0);
    expect(all).toBeCloseTo(sum, 9);
    const idle = GORGEBLOOM_GLOW.pulses.map(() => -1);
    expect(glowPulseLevel(GORGEBLOOM_GLOW, idle, -1)).toBe(1);
    expect(glowPulseLevel(GORGEBLOOM_GLOW, idle, 0)).toBe(1);
    const fade = GORGEBLOOM_GLOW.deathFade ?? 0;
    expect(glowPulseLevel(GORGEBLOOM_GLOW, idle, fade / 2)).toBeCloseTo(0.25, 9);
    expect(glowPulseLevel(GORGEBLOOM_GLOW, idle, fade)).toBe(0);
    expect(glowPulseLevel(GORGEBLOOM_GLOW, ages, fade * 3)).toBe(0);
    // Dark before the head hits the water.
    expect(fade).toBeLessThan(GORGEBLOOM_CLIP.deathSplash);
  });
});

describe('turning in place', () => {
  it('seeds on the first frame, then slews at its rate toward the sim facing', () => {
    const st = createTurnInPlaceState();
    stepTurnInPlace(st, 0.5, 0.016, 2);
    expect(st.yaw).toBe(0.5);
    expect(st.turning).toBe(false);
    expect(st.lag).toBe(0);
    // The sim snaps a quarter turn: the drawn heading lags and comes round.
    stepTurnInPlace(st, 0.5 + Math.PI / 2, 0.1, 2);
    expect(st.yaw).toBeCloseTo(0.7, 9);
    expect(st.lag).toBeCloseTo(0.2 - Math.PI / 2, 9);
    expect(st.turning).toBe(true);
    for (let i = 0; i < 60; i++) stepTurnInPlace(st, 0.5 + Math.PI / 2, 0.05, 2);
    expect(st.lag).toBeCloseTo(0, 3);
  });

  it('eases out at the end and holds the loop a short tail after', () => {
    const st = createTurnInPlaceState();
    stepTurnInPlace(st, 0, 0.016, 2);
    stepTurnInPlace(st, 0.1, 0.05, 2);
    // Within the last stretch it moves slower than the full rate.
    expect(st.yaw).toBeLessThan(0.1);
    expect(st.yaw).toBeLessThan(2 * 0.05);
    let frames = 0;
    while (st.turning && frames < 200) {
      stepTurnInPlace(st, 0.1, 0.02, 2);
      frames++;
    }
    expect(frames * 0.02).toBeGreaterThanOrEqual(TURN_TAIL_SECONDS - 0.02);
    expect(st.turning).toBe(false);
  });

  it('takes the short way round across the seam', () => {
    const st = createTurnInPlaceState();
    stepTurnInPlace(st, Math.PI - 0.1, 0.016, 2);
    stepTurnInPlace(st, -Math.PI + 0.1, 0.05, 2);
    // It crossed pi (0.2 rad the short way), never swung back through zero.
    expect(Math.abs(wrapAngle(st.yaw - Math.PI))).toBeLessThan(0.11);
  });

  it('a long hitch snaps; without a rate it follows and still flags the turn', () => {
    const st = createTurnInPlaceState();
    stepTurnInPlace(st, 0, 0.016, 2);
    stepTurnInPlace(st, 2, TURN_SNAP_DT + 0.1, 2);
    expect(st.yaw).toBe(2);
    expect(st.lag).toBe(0);
    const free = createTurnInPlaceState();
    stepTurnInPlace(free, 0, 0.016, 0);
    stepTurnInPlace(free, 0.4, 0.016, 0);
    expect(free.lag).toBe(0);
    expect(free.turning).toBe(true);
    stepTurnInPlace(free, 0.4, TURN_TAIL_SECONDS + 0.01, 0);
    expect(free.turning).toBe(false);
  });
});

describe('a bar-locked strike clip (VisualDef.castClipSync)', () => {
  it('both lashing bodies opt in', () => {
    expect(WILDHEART_GORGEBLOOM_LOOK.castClipSync).toBe(true);
    expect(VISUALS.wildheart_vine_lasher.castClipSync).toBe(true);
  });

  it('pulls a clip that entered late onto the bar, leaves a clip in step alone', () => {
    // Entered 0.6 s late behind a swing: jump to the bar's time at its rate.
    expect(castClipSyncTime(0.1, 0.7, SEED_RAIN_RATE, 2.625)).toBeCloseTo(0.7 * SEED_RAIN_RATE, 9);
    // In step (inside the slack): untouched.
    expect(castClipSyncTime(0.75, 0.7, 1, 2.625)).toBeNull();
    expect(castClipSyncTime(0.7 + CAST_CLIP_SYNC_SLACK * 0.9, 0.7, 1, 2.625)).toBeNull();
    // On the bar's end the clip stands on its contact frame.
    expect(castClipSyncTime(0, BLOOM_TUNING.seedCast, SEED_RAIN_RATE, 2.625)).toBeCloseTo(
      GORGEBLOOM_CLIP.seedSpit,
      9,
    );
    // Never past the clip's end; no bar, no pull.
    expect(castClipSyncTime(0, 9, 1, 2)).toBeLessThan(2);
    expect(castClipSyncTime(0, undefined, 1, 2)).toBeNull();
  });

  it("reads the bar's elapsed time off the entity, and none without a bar", () => {
    const st = {} as Parameters<typeof applyEntityAnimOverrides>[0];
    const facts = {
      aggroTargetId: null,
      castingAbility: BLOOM_GORGE,
      castTotal: 1.5,
      castRemaining: 0.4,
    };
    applyEntityAnimOverrides(st, facts, false);
    expect(st.castElapsed).toBeCloseTo(1.1, 9);
    applyEntityAnimOverrides(st, { ...facts, castingAbility: null }, false);
    expect(st.castElapsed).toBeUndefined();
  });
});

describe('the glow on a pooled rig', () => {
  it('a rig handed to a new entity drops its pulses and its death fade', async () => {
    const { GlowPulse } = await import('../src/render/characters/glow_pulse');
    const glow = new GlowPulse(GORGEBLOOM_GLOW);
    expect(glow.handle(GORGEBLOOM_GULLET_GESTURE)).toBe(true);
    expect(glow.step(0.1, false)).toBe(true);
    expect(glow.active).toBe(true);
    // Reset reports the clones were mounted, and nothing runs after it.
    expect(glow.reset()).toBe(true);
    expect(glow.active).toBe(false);
    expect(glow.step(0.1, false)).toBe(false);
    // A dead rig keeps its dark clones mounted until it is reused.
    glow.step(0.1, true);
    expect(glow.active).toBe(true);
    expect(glow.reset()).toBe(true);
    expect(glow.step(0.1, false)).toBe(false);
    expect(glow.handle('unrelated')).toBe(false);
  });
});
