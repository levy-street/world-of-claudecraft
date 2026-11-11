// The Hammer Council's entrance on the client, "The quarry wakes"
// (render/smith_heart_fx/council_entrance_core.ts, council_entrance_fx.ts and
// its parts): the scene's clock read off the members' auras (a late joiner
// starts where the scene is, one that joins after sees them standing, a
// scene cut short breaks both out at once), every beat on its word of the
// two voiced lines (the thrum, the columns one by one, the cracks, the tear,
// the punch and its ring, the crystal ringing, the shatter, the orbit, the
// note's wave of light), the plans (the spur's slabs, the rubble, the
// shards, the orbit, the pebbles, the room's crystals), the entrance clips in
// their GLBs and the looks that bind them, and the painter over a fake world
// (both rigs' stances and dark through the gesture seam, the punch and the
// note once, the thuds, nothing replayed for a late joiner, every beat on the
// low tier, no thud and no flash and capped light under reduced motion).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createGlbIO } from '../scripts/anim/pose_blend.mjs';
import { SFX_FIXED_CATALOG_KEYS } from '../src/game/sfx_manifest.generated';
import {
  COUNCIL_ENTRANCE_CLIPS,
  COUNCIL_GUARDIAN_ENTRANCE_URL,
  COUNCIL_SINGER_ENTRANCE_URL,
  SMITH_HEART_BOSS_LOOKS,
} from '../src/render/characters/smith_heart_boss_looks';
import { activateGfxProfile, GFX, getActiveGfxProfile } from '../src/render/gfx';
import { CouncilEntranceFx } from '../src/render/smith_heart_fx';
import {
  AWAKE,
  COLUMN_ORDER,
  COUNCIL_AWAKEN_CLIP,
  COUNCIL_ENTRANCE,
  COUNCIL_ENTRANCE_DRIFT,
  COUNCIL_ENTRANCE_GESTURE_AT,
  COUNCIL_ENTRANCE_GESTURES,
  COUNCIL_ENTRANCE_LOW_SHARE,
  COUNCIL_ENTRANCE_SOUNDS,
  COUNCIL_INTRO_VOICE,
  COUNCIL_PAIR,
  COUNCIL_ROCK,
  COUNCIL_VEIN,
  CRYSTAL_SHARDS,
  chunkAt,
  columnLightAt,
  councilEntranceClock,
  councilEntranceFlash,
  councilEntranceLight,
  councilEntranceLook,
  councilEntrancePicks,
  councilEntranceShake,
  councilFacingShare,
  crossedCouncilBeat,
  crystalFlare,
  DORMANT,
  newFlyingStone,
  ORBIT_SHARDS,
  orbitShardAt,
  QUARRY_CRYSTALS,
  QUARRY_PEBBLES,
  REDUCED_LIGHT_CAP,
  ROCK_CHUNKS,
  ROCK_SLABS,
  shardAt,
  slabAt,
  stepCouncilEntranceTime,
  VEIN_PRISMS,
  VEIN_RINGS,
} from '../src/render/smith_heart_fx/council_entrance_core';
import { ENTRANCE_SECONDARY_LAYERS } from '../src/render/smith_heart_fx/entrance_budget_core';
import { SMITH_HEART_COUNCIL_FACING } from '../src/sim/content/smith_heart';
import {
  HAMMER_PIT,
  QUARRY_PILLAR_SPOTS,
  SMITH_HEART_BOSS_SPOTS,
} from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { COUNCIL_AURAS, COUNCIL_TEMPLATES } from '../src/sim/encounters/smith_heart/council_ids';
import {
  COUNCIL_INTRO,
  COUNCIL_INTRO_STAGES,
} from '../src/sim/encounters/smith_heart/council_intro_plan';
import type { Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const E = COUNCIL_ENTRANCE;
const G = COUNCIL_ENTRANCE_GESTURES;
const GA = COUNCIL_ENTRANCE_GESTURE_AT;
const waking = (t: number) => ({
  id: COUNCIL_AURAS.intro,
  value: COUNCIL_INTRO_STAGES.waking,
  remaining: COUNCIL_INTRO.seconds - t,
  duration: COUNCIL_INTRO.seconds,
});
const asleep = {
  id: COUNCIL_AURAS.intro,
  value: COUNCIL_INTRO_STAGES.dormant,
  remaining: 3600,
  duration: 3600,
};
/** The Pit Mouth, where the raid comes down (instance-local). */
const MOUTH = { x: -22, z: -172 };

describe('the clock', () => {
  it('reads dormant, waking with its time, or nothing off a member', () => {
    expect(councilEntranceClock([asleep]).stage).toBe('dormant');
    const w = councilEntranceClock([waking(4.5)]);
    expect(w.stage).toBe('waking');
    expect(w.t).toBeCloseTo(4.5, 6);
    expect(councilEntranceClock([]).stage).toBe('none');
    // The online mirror decodes a permanent aura's duration as Infinity.
    expect(
      councilEntranceClock([
        { id: COUNCIL_AURAS.intro, value: 0, remaining: 3600, duration: Number.POSITIVE_INFINITY },
      ]).stage,
    ).toBe('dormant');
  });

  it('runs smooth on the aura, never backward, snaps on a drift, breaks out at once when cut short, and a late joiner past it sees them standing', () => {
    const c = (t: number) => councilEntranceClock([waking(t)]);
    expect(stepCouncilEntranceTime(AWAKE, 0.05, councilEntranceClock([asleep]))).toBe(DORMANT);
    // First seen mid-scene: starts where it is.
    expect(stepCouncilEntranceTime(DORMANT, 0.05, c(6))).toBeCloseTo(6, 6);
    expect(stepCouncilEntranceTime(5, 0.05, c(5.05))).toBeCloseTo(5.05, 6);
    // Ahead of the aura: it waits (a late snapshot never replays a beat).
    expect(stepCouncilEntranceTime(5.4, 0.05, c(5))).toBe(5.4);
    // Far behind: it snaps forward.
    expect(stepCouncilEntranceTime(2, 0.05, c(2 + COUNCIL_ENTRANCE_DRIFT + 1))).toBeCloseTo(
      2 + COUNCIL_ENTRANCE_DRIFT + 1,
      6,
    );
    const none = councilEntranceClock([]);
    // A seen scene plays its tail after the hand-back, then awake.
    expect(stepCouncilEntranceTime(COUNCIL_INTRO.seconds, 0.05, none)).toBeCloseTo(
      COUNCIL_INTRO.seconds + 0.05,
      6,
    );
    expect(stepCouncilEntranceTime(E.end - 0.01, 0.05, none)).toBe(AWAKE);
    // Cut short (a forced pull) before the shatter: both break out now.
    expect(stepCouncilEntranceTime(3, 0.05, none)).toBe(E.shatterAt);
    // Never seen waking: awake.
    expect(stepCouncilEntranceTime(AWAKE, 0.05, none)).toBe(AWAKE);
    expect(stepCouncilEntranceTime(DORMANT, 0.05, none)).toBe(AWAKE);
  });

  it('a beat plays only for a scene seen crossing it', () => {
    expect(crossedCouncilBeat(4, 5, 4.5)).toBe(true);
    expect(crossedCouncilBeat(DORMANT, 5, 4.5)).toBe(false);
    expect(crossedCouncilBeat(5, 5.1, 4.5)).toBe(false);
  });
});

describe('the beats ride the voiced lines', () => {
  it('pins each beat to its word in the shipped clips, counted from the sim speak beats', () => {
    const g = COUNCIL_INTRO.guardianSpeakAt;
    const s = COUNCIL_INTRO.singerSpeakAt;
    const VG = COUNCIL_INTRO_VOICE.guardian;
    const VS = COUNCIL_INTRO_VOICE.singer;
    // The scene runs 10 to 14 s (the owner's brief).
    expect(COUNCIL_INTRO.seconds).toBeGreaterThanOrEqual(10);
    expect(COUNCIL_INTRO.seconds).toBeLessThanOrEqual(14);
    // The thrum and the columns lead; every column is lit before the tear.
    const lastColumn = Math.max(...QUARRY_PILLAR_SPOTS.map((_, i) => columnLightAt(i)));
    expect(lastColumn + E.columnClimb).toBeLessThan(E.tearAt);
    // The cracks race up while it says "Strangers in the Quarry.".
    expect(E.crackFrom).toBeLessThan(g + VG.strangers);
    expect(E.crackTo).toBeGreaterThan(g + VG.quarryEnd);
    // The tear in the breath between its two sentences.
    expect(E.tearAt).toBeGreaterThan(g + VG.quarryEnd);
    expect(E.tearAt).toBeLessThan(g + VG.hammer);
    // The punch on "flesh".
    expect(E.punchAt).toBeCloseTo(g + VG.flesh, 6);
    // Its clip is done before the Singer begins.
    expect(g + VG.end).toBeLessThan(s);
    // The crystal rings before her line; the shatter in her breath after
    // "Hear the seam sing?"; the note on "voices", inside the scene.
    expect(E.veinAt).toBeLessThan(s);
    expect(E.shatterAt).toBeGreaterThan(s + VS.singEnd);
    expect(E.shatterAt).toBeLessThan(s + VS.waited);
    expect(E.noteAt).toBeCloseTo(s + VS.voices, 6);
    expect(E.noteAt).toBeLessThan(COUNCIL_INTRO.seconds);
    // Each one-shot leaves its clip's lead before its moment, after the one
    // before it.
    expect(GA.guardianEmerge).toBeCloseTo(E.tearAt - COUNCIL_AWAKEN_CLIP.guardianBurst, 6);
    expect(GA.guardianPunch).toBeCloseTo(E.punchAt - COUNCIL_AWAKEN_CLIP.punchContact, 6);
    expect(GA.guardianPunch).toBeGreaterThan(GA.guardianEmerge + 1.6);
    expect(GA.singerEmerge).toBeCloseTo(E.shatterAt - COUNCIL_AWAKEN_CLIP.singerBurst, 6);
    expect(GA.singerNote).toBeGreaterThan(GA.singerEmerge + 1.6);
  });

  it('rings faster and faster up to the shatter (the rising note)', () => {
    expect(VEIN_RINGS.length).toBeGreaterThanOrEqual(5);
    expect(VEIN_RINGS[0]).toBe(E.veinAt);
    for (let i = 2; i < VEIN_RINGS.length; i++)
      expect(VEIN_RINGS[i] - VEIN_RINGS[i - 1]).toBeLessThanOrEqual(
        VEIN_RINGS[i - 1] - VEIN_RINGS[i - 2] + 1e-9,
      );
    expect(VEIN_RINGS[VEIN_RINGS.length - 1]).toBeLessThan(E.shatterAt);
  });

  it('every sound is a shipped council or raid sample on a beat inside the scene', () => {
    const keys = new Set<string>(SFX_FIXED_CATALOG_KEYS);
    for (const s of COUNCIL_ENTRANCE_SOUNDS) {
      expect(keys.has(s.key), s.key).toBe(true);
      expect(s.at).toBeGreaterThanOrEqual(0);
      expect(s.at).toBeLessThan(COUNCIL_INTRO.seconds);
    }
    const at = (key: string) =>
      COUNCIL_ENTRANCE_SOUNDS.filter((s) => s.key === key).map((s) => s.at);
    expect(at('heart_council_pillar_collapse')).toContain(E.tearAt);
    expect(at('heart_council_rush_impact')).toContain(E.punchAt);
    expect(at('heart_council_soul_burst')).toContain(E.shatterAt);
    expect(at('heart_council_song_pulse')).toContain(E.noteAt);
    // The rising note: each ring higher than the one before.
    const rates = COUNCIL_ENTRANCE_SOUNDS.filter((s) => s.key === 'heart_council_resonance').map(
      (s) => s.rate,
    );
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeGreaterThan(rates[i - 1]);
  });
});

describe('the look', () => {
  it('asleep: both held dark in the rock and the crystal, the ground still, the columns dark', () => {
    const L = councilEntranceLook(DORMANT);
    expect(L.active).toBe(true);
    expect(L.dormant).toBe(true);
    expect(L.guardianStance).toBe('dormant');
    expect(L.singerStance).toBe('dormant');
    expect(L.guardianDim && L.singerDim).toBe(true);
    expect(L.rock).toBe(1);
    expect(L.crystal).toBe(1);
    expect(L.crack).toBe(0);
    expect(L.thrum).toBe(0);
    expect(L.columnGlow.every((g) => g === 0)).toBe(true);
    // The faint glows: the light inside the rock, the crystal's.
    expect(L.core).toBeGreaterThan(0);
    expect(L.veinGlow).toBeGreaterThan(0);
    expect(L.veinGlow).toBeLessThan(0.4);
  });

  it('the thrum swells and the columns light one by one, the nearest the Pit Mouth first', () => {
    const early = councilEntranceLook(0.3);
    const full = councilEntranceLook(E.thrumFull + 0.2);
    expect(full.thrum).toBeGreaterThan(early.thrum);
    expect(full.thrum).toBeGreaterThan(0.6);
    expect(new Set(COLUMN_ORDER).size).toBe(QUARRY_PILLAR_SPOTS.length);
    const first = QUARRY_PILLAR_SPOTS[COLUMN_ORDER[0]];
    for (const c of QUARRY_PILLAR_SPOTS)
      expect(Math.hypot(first.x - MOUTH.x, first.z - MOUTH.z)).toBeLessThanOrEqual(
        Math.hypot(c.x - MOUTH.x, c.z - MOUTH.z) + 1e-9,
      );
    for (let k = 0; k < COLUMN_ORDER.length; k++) {
      const i = COLUMN_ORDER[k];
      const at = columnLightAt(i);
      expect(councilEntranceLook(at - 0.01).columnClimb[i]).toBe(0);
      expect(councilEntranceLook(at + E.columnClimb).columnClimb[i]).toBeCloseTo(1, 6);
      if (k + 1 < COLUMN_ORDER.length)
        expect(councilEntranceLook(at + 0.1).columnClimb[COLUMN_ORDER[k + 1]]).toBe(0);
    }
  });

  it('the cracks race up the rock to its crown, then it tears out', () => {
    const mid = councilEntranceLook((E.crackFrom + E.crackTo) / 2);
    expect(mid.crack).toBeGreaterThan(0.2);
    expect(mid.crack).toBeLessThan(1);
    expect(mid.rock).toBe(1);
    const before = councilEntranceLook(E.tearAt - 0.01);
    expect(before.crack).toBeCloseTo(1, 6);
    expect(before.core).toBeGreaterThan(mid.core);
    const torn = councilEntranceLook(E.tearAt + 0.05);
    expect(torn.rock).toBe(0);
    expect(torn.guardianStance).toBe('emerge');
    expect(torn.guardianDim).toBe(false);
    expect(torn.singerStance).toBe('dormant');
  });

  it('the punch: a ring of stone and dust from its fists out past the raid, the thrum ebbing after', () => {
    const at = (s: number) => councilEntranceLook(E.punchAt + s);
    expect(at(0.01).ringR).toBeLessThan(E.ringFrom + 3);
    expect(at(0.01).ring).toBeGreaterThan(0.9);
    // Past the Pit Mouth the raid comes down by.
    const mouth = Math.hypot(MOUTH.x - HAMMER_PIT.x, MOUTH.z - HAMMER_PIT.z);
    expect(at(E.ringFor * 0.95).ringR).toBeGreaterThan(mouth);
    expect(at(E.ringFor + 0.01).ring).toBe(0);
    expect(at(3).thrum).toBeLessThan(at(-0.5).thrum);
  });

  it('the crystal rings brighter to its shatter, she floats out with her shards gathering', () => {
    const quiet = councilEntranceLook(E.veinAt);
    const ringing = councilEntranceLook(E.shatterAt - 0.05);
    expect(ringing.veinGlow).toBeGreaterThan(quiet.veinGlow + 1);
    expect(ringing.tremble).toBeGreaterThan(0.9);
    const broke = councilEntranceLook(E.shatterAt + 0.02);
    expect(broke.crystal).toBe(0);
    expect(broke.singerStance).toBe('emerge');
    expect(broke.flash).toBeGreaterThan(0.2);
    expect(councilEntranceLook(E.shatterAt + 0.15 + E.orbitFor + 0.05).orbit).toBeCloseTo(1, 6);
  });

  it('the note: a wave of light out across the quarry, every crystal flaring as it passes', () => {
    const at = (s: number) => councilEntranceLook(E.noteAt + s);
    expect(at(0.05).wave).toBeGreaterThan(0.9);
    expect(at(E.waveFor * 0.98).waveR).toBeGreaterThan(60);
    // Done by the hand-back: no light over the fight's opening.
    expect(E.noteAt + E.waveFor).toBeLessThanOrEqual(COUNCIL_INTRO.seconds + 1e-9);
    // A crystal 30 yd off flares as the crest reaches it, not before.
    let before = 0;
    let peak = 0;
    for (let s = 0; s < E.waveFor; s += 0.02) {
      const L = at(s);
      const f = crystalFlare(L, 30);
      if (L.waveR < 20) before = Math.max(before, f);
      peak = Math.max(peak, f);
    }
    expect(before).toBe(0);
    expect(peak).toBeGreaterThan(1);
    // Every crystal in the room is within the wave's reach of her.
    const s = SMITH_HEART_BOSS_SPOTS.seamSinger;
    for (const k of QUARRY_CRYSTALS)
      expect(Math.hypot(k.x - s.x, k.z - s.z)).toBeLessThan(E.waveTo);
  });

  it('awake once the scene is over (the fight look)', () => {
    for (const t of [AWAKE, E.end + 0.1]) {
      const L = councilEntranceLook(t);
      expect(L.active).toBe(false);
      expect(L.guardianStance).toBe('stand');
      expect(L.singerStance).toBe('stand');
      expect(L.guardianDim || L.singerDim).toBe(false);
    }
  });

  it('reduced motion: no thud and no flash, the added light capped; the thud falls off with distance', () => {
    const L = councilEntranceLook(E.shatterAt + 0.05);
    expect(councilEntranceFlash(L, false)).toBeGreaterThan(0);
    expect(councilEntranceFlash(L, true)).toBe(0);
    expect(councilEntranceShake(E.shakePunch, 10, true)).toBe(0);
    expect(councilEntranceShake(E.shakePunch, 10, false)).toBeGreaterThan(
      councilEntranceShake(E.shakePunch, 60, false),
    );
    expect(councilEntranceShake(E.shakePunch, E.shakeReach, false)).toBe(0);
    expect(councilEntranceLight(2, true)).toBe(REDUCED_LIGHT_CAP);
    expect(councilEntranceLight(0.3, true)).toBe(0.3);
    expect(councilEntranceLight(2, false)).toBe(2);
  });

  it('is deterministic and allocation free in place', () => {
    const out = councilEntranceLook(5);
    const again = councilEntranceLook(7.3, out);
    expect(again).toBe(out);
    expect(JSON.stringify(councilEntranceLook(7.3))).toBe(JSON.stringify(again));
  });
});

describe('the plans', () => {
  it('the spur wraps the Guardian, its window at its chest toward the raid, and every slab flies out, lands and sinks', () => {
    const st = newFlyingStone();
    expect(ROCK_SLABS.length).toBeGreaterThan(25);
    for (const s of ROCK_SLABS) {
      const r = Math.hypot(s.x, s.z);
      expect(r).toBeGreaterThan(COUNCIL_ROCK.crownR * 0.85 * (1 - COUNCIL_ROCK.singerSide));
      expect(r).toBeLessThan(COUNCIL_ROCK.footR * 1.1);
      slabAt(s, -1, st);
      expect(st.x).toBe(s.x);
      slabAt(s, 1.2, st);
      expect(Math.hypot(st.x, st.z)).toBeGreaterThan(r);
      slabAt(s, 12, st);
      expect(st.landed).toBe(true);
      expect(st.size).toBeLessThan(1);
    }
    // No slab sits right in front of its chest (the window it shows through).
    const mid = COUNCIL_ROCK.height * 0.55;
    const front = ROCK_SLABS.filter(
      (s) => Math.abs(s.y - mid) < 1.6 && s.z > 0 && Math.abs(Math.atan2(s.x, s.z)) < 0.3,
    );
    expect(front).toHaveLength(0);
  });

  it('the rock and the vein grow with the bodies and stand clear of each other', () => {
    // The Guardian drawn some 14.7 yd, the Singer 11: the spur stands over its crouch, the
    // cocoon over hers.
    expect(COUNCIL_ROCK.height).toBeGreaterThan(14.7 * 0.75 + 4);
    expect(COUNCIL_VEIN.cocoonH).toBeGreaterThan(11 * 0.75 + 2);
    // The two stand 9.5 yd apart, each set piece facing the other: the spur's foot slabs and
    // the vein's prisms never meet (world axes, at the spawn facing).
    expect(COUNCIL_PAIR.apart).toBeCloseTo(Math.hypot(3, 9), 6);
    const f = SMITH_HEART_COUNCIL_FACING;
    const world = (x: number, z: number) => ({
      x: x * Math.cos(f) + z * Math.sin(f),
      z: -x * Math.sin(f) + z * Math.cos(f),
    });
    let prisms = Number.POSITIVE_INFINITY;
    let cocoon = Number.POSITIVE_INFINITY;
    const c = world(COUNCIL_VEIN.cocoonX, COUNCIL_VEIN.cocoonZ);
    for (const s of ROCK_SLABS) {
      if (s.y > COUNCIL_ROCK.height * 0.4) continue;
      const a = world(s.x, s.z);
      const reach = s.sz / 2;
      for (const pr of VEIN_PRISMS) {
        const b = world(pr.x, pr.z);
        const d = Math.hypot(COUNCIL_PAIR.dx + b.x - a.x, COUNCIL_PAIR.dz + b.z - a.z);
        prisms = Math.min(prisms, d - pr.r - reach);
      }
      const d = Math.hypot(COUNCIL_PAIR.dx + c.x - a.x, COUNCIL_PAIR.dz + c.z - a.z);
      cocoon = Math.min(cocoon, d - COUNCIL_VEIN.cocoonR - reach);
    }
    expect(prisms).toBeGreaterThan(0.3);
    // The cocoon at most leans on the spur's foot (the vein runs out of the quarry's rock).
    expect(cocoon).toBeGreaterThan(-1.5);
    // No prism grows toward the Guardian.
    for (const p of VEIN_PRISMS)
      expect(councilFacingShare(p.bearing, COUNCIL_PAIR.singerToGuardian)).toBeLessThan(0.5);
    // Her shards ring her body, not her feet.
    expect(ORBIT_SHARDS.r).toBeGreaterThan(COUNCIL_VEIN.cocoonR);
    expect(ORBIT_SHARDS.yHigh).toBeGreaterThan(11 * 0.75);
  });

  it('the rubble flies, lies a breath and is gone', () => {
    const st = newFlyingStone();
    for (const c of ROCK_CHUNKS) {
      expect(chunkAt(c, -1, st).size).toBe(0);
      expect(chunkAt(c, 0.3, st).size).toBeGreaterThan(0);
      expect(chunkAt(c, 6, st).size).toBe(0);
    }
  });

  it('the shards burst out, fall and fade; her orbit gathers, turns and flies out with the note', () => {
    const st = newFlyingStone();
    for (const c of CRYSTAL_SHARDS) {
      shardAt(c, 0.4, st);
      expect(st.size).toBeGreaterThan(0);
      expect(shardAt(c, 3, st).size).toBe(0);
    }
    const at = (orbit: number, fling: number, t: number) =>
      orbitShardAt(0, { orbit, orbitFling: fling, t }, newFlyingStone());
    const settled = at(1, -1, 12);
    expect(Math.hypot(settled.x, settled.z)).toBeLessThan(ORBIT_SHARDS.r * 1.2);
    expect(settled.size).toBe(1);
    const flung = at(1, 0.8, 13);
    expect(Math.hypot(flung.x, flung.z)).toBeGreaterThan(ORBIT_SHARDS.r * 4);
    expect(at(1, ORBIT_SHARDS.flingFor + 0.1, 14).size).toBe(0);
  });

  it('the pebbles lie on the pit floor off both set pieces; the low tier keeps a whole share', () => {
    for (const p of QUARRY_PEBBLES) {
      expect(Math.hypot(p.x, p.z)).toBeGreaterThan(COUNCIL_ROCK.footR);
      expect(Math.abs(p.x)).toBeLessThan(HAMMER_PIT.rx);
    }
    const low = councilEntrancePicks(QUARRY_PEBBLES.length, false);
    expect(low.length).toBe(Math.round(QUARRY_PEBBLES.length * COUNCIL_ENTRANCE_LOW_SHARE));
    expect(councilEntrancePicks(QUARRY_PEBBLES.length, true)).toHaveLength(QUARRY_PEBBLES.length);
    expect(new Set(low).size).toBe(low.length);
  });

  it('the room crystals are the quarry geodes and the five columns', () => {
    expect(QUARRY_CRYSTALS.length).toBeGreaterThanOrEqual(QUARRY_PILLAR_SPOTS.length + 3);
  });
});

describe('the entrance clips', () => {
  it('ship in their own GLBs (Dormant, held off Awaken frame 0), bound as each rig stances', async () => {
    const io = createGlbIO();
    for (const [url, base, key] of [
      [COUNCIL_GUARDIAN_ENTRANCE_URL, 'heart_slabwright', 'smith_heart_hammer_guardian'],
      [COUNCIL_SINGER_ENTRANCE_URL, 'heart_seam_singer', 'smith_heart_seam_singer'],
    ] as const) {
      const doc = await io.read(`public/${url}`);
      expect(
        doc
          .getRoot()
          .listAnimations()
          .map((a) => a.getName()),
      ).toEqual([...COUNCIL_ENTRANCE_CLIPS]);
      expect(doc.getRoot().listMeshes()).toHaveLength(0);
      // The base rig breaks out on its own Awaken, and has the punch's and
      // the note's clips.
      const rig = await io.read(`public/models/creatures/${base}.glb`);
      const clips = rig
        .getRoot()
        .listAnimations()
        .map((a) => a.getName());
      expect(clips).toContain('Awaken');
      expect(clips).toContain(key.includes('guardian') ? 'CastWake' : 'CastSong');
      // The dark pulse takes the rig's one material by name.
      const mats = rig
        .getRoot()
        .listMaterials()
        .map((m) => m.getName());
      const look = SMITH_HEART_BOSS_LOOKS[key];
      expect(look.animUrls).toContain(url);
      for (const m of look.glowPulses?.materials ?? []) expect(mats).toContain(m);
      expect(look.oneShotsHoldAttacks).toContain('Awaken');
    }
    const g = SMITH_HEART_BOSS_LOOKS.smith_heart_hammer_guardian;
    expect(g.phaseClips?.[G.guardianDormant]?.clips.idle).toBe('Dormant');
    expect(g.phaseClips?.[G.guardianDormant]?.clips.idleVariants).toEqual([]);
    expect(g.phaseClips?.[G.guardianEmerge]?.enter).toBe('Awaken');
    expect(g.phaseClips?.[G.guardianEmerge]?.clips).toBe(g.clips);
    expect(g.clips.attackByAbility?.[G.guardianPunch]).toBe('CastWake');
    const s = SMITH_HEART_BOSS_LOOKS.smith_heart_seam_singer;
    expect(s.phaseClips?.[G.singerDormant]?.clips.idle).toBe('Dormant');
    expect(s.phaseClips?.[G.singerEmerge]?.enter).toBe('Awaken');
    expect(s.clips.attackByAbility?.[G.singerNote]).toBe('CastSong');
    expect(s.clips.attackTimeScaleByAbility?.[G.singerNote]).toBe(COUNCIL_AWAKEN_CLIP.noteRate);
    for (const [look, dim] of [
      [g, G.guardianDim],
      [s, G.singerDim],
    ] as const) {
      const p = look.glowPulses?.pulses.find((x) => x.gesture === dim);
      expect(p?.shade).toBeGreaterThan(0);
      expect(p?.shade).toBeLessThan(0.6);
    }
  });
});

describe('CouncilEntranceFx over a fake world', () => {
  function rig(opts: { reduced?: boolean } = {}) {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    const entity = (id: number, kind: string, templateId: string, x: number, z: number) =>
      ({
        id,
        kind,
        templateId,
        name: templateId,
        pos: { x: o.x + x, y: 0, z: o.z + z },
        prevPos: { x: o.x + x, y: 0, z: o.z + z },
        facing: -1.6,
        scale: 3,
        hp: 100,
        maxHp: 100,
        dead: false,
        auras: [] as Entity['auras'],
      }) as unknown as Entity;
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', MOUTH.x + 8, MOUTH.z);
    const g = entity(2, 'mob', COUNCIL_TEMPLATES.guardian, HAMMER_PIT.x, HAMMER_PIT.z);
    const sp = SMITH_HEART_BOSS_SPOTS.seamSinger;
    const s = entity(3, 'mob', COUNCIL_TEMPLATES.singer, sp.x, sp.z);
    for (const e of [me, g, s]) entities.set(e.id, e);
    const world = {
      entities,
      player: me,
      playerId: me.id,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const scene = new THREE.Scene();
    const shakes: number[] = [];
    const sent: { id: number; g: string }[] = [];
    const fx = new CouncilEntranceFx(
      scene,
      () => 0,
      world,
      undefined,
      () => opts.reduced === true,
      (a) => shakes.push(a),
      (id, gesture) => sent.push({ id, g: gesture }),
    );
    const aura = (a: ReturnType<typeof waking> | typeof asleep | null) => {
      for (const b of [g, s]) {
        b.auras.length = 0;
        if (a) b.auras.push({ ...a } as unknown as Entity['auras'][number]);
      }
    };
    return { scene, fx, g, s, aura, shakes, sent };
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
  const NAMES = [
    'smithHeartCouncilEntranceSlabs',
    'smithHeartCouncilEntranceRubble',
    'smithHeartCouncilEntranceRockCore',
    'smithHeartCouncilEntranceDustWall',
    'smithHeartCouncilEntranceCrystal',
    'smithHeartCouncilEntranceRings',
    'smithHeartCouncilEntranceShards',
    'smithHeartCouncilEntranceOrbit',
    'smithHeartCouncilEntranceLightWave',
    'smithHeartCouncilEntranceColumns',
    'smithHeartCouncilEntranceFlares',
    'smithHeartCouncilEntrancePebbles',
    'smithHeartCouncilEntranceFlash',
    'smithHeartCouncilEntranceHerLight',
  ];
  /** Play from asleep to awake (from `from` seconds, the aura gone at
   *  `cut` when given), noting what showed. */
  function play(r: ReturnType<typeof rig>, from = 0, cut = Number.POSITIVE_INFINITY) {
    const seen = new Set<string>();
    if (from === 0) {
      r.aura(asleep);
      r.fx.update(0.3);
      r.fx.update(1 / 20);
      for (const n of NAMES) if (visible(r.scene, n)) seen.add(`asleep:${n}`);
    }
    const dt = 1 / 20;
    let t = from;
    while (t < Math.min(cut, COUNCIL_INTRO.seconds) - 1e-6) {
      r.aura(waking(t));
      r.fx.update(dt);
      t += dt;
      for (const n of NAMES) if (visible(r.scene, n)) seen.add(n);
    }
    r.aura(null);
    for (let k = 0; k < (E.end + 1) / dt && r.fx.currentLook.active; k++) {
      r.fx.update(dt);
      for (const n of NAMES) if (visible(r.scene, n)) seen.add(n);
    }
    return seen;
  }
  const count = (r: ReturnType<typeof rig>, g: string) => r.sent.filter((x) => x.g === g).length;

  it('plays the whole scene: both rigs asleep and dark, each breaking out once, the punch and the note once, the thuds, every piece, then awake', () => {
    const r = rig();
    const seen = play(r);
    // Asleep first: the rock and the crystal stand, the Dormant stances and
    // the dark re-sent while they sleep.
    expect(seen.has('asleep:smithHeartCouncilEntranceSlabs')).toBe(true);
    expect(seen.has('asleep:smithHeartCouncilEntranceCrystal')).toBe(true);
    expect(r.sent[0].g === G.guardianDormant || r.sent[0].g === G.singerDormant).toBe(true);
    expect(count(r, G.guardianDormant)).toBeGreaterThan(5);
    expect(count(r, G.singerDormant)).toBeGreaterThan(10);
    expect(count(r, G.guardianDim)).toBeGreaterThan(5);
    expect(count(r, G.singerDim)).toBeGreaterThan(10);
    for (const g of [G.guardianEmerge, G.singerEmerge, G.guardianPunch, G.singerNote])
      expect(count(r, g), g).toBe(1);
    // Each to its own body, in its order; no dark or sleep after its break.
    const idx = (g: string) => r.sent.findIndex((x) => x.g === g);
    expect(r.sent[idx(G.guardianEmerge)].id).toBe(r.g.id);
    expect(r.sent[idx(G.singerNote)].id).toBe(r.s.id);
    expect(idx(G.guardianEmerge)).toBeLessThan(idx(G.guardianPunch));
    expect(idx(G.guardianPunch)).toBeLessThan(idx(G.singerEmerge));
    expect(idx(G.singerEmerge)).toBeLessThan(idx(G.singerNote));
    const after = r.sent.slice(idx(G.guardianEmerge));
    expect(after.some((x) => x.g === G.guardianDim || x.g === G.guardianDormant)).toBe(false);
    const afterS = r.sent.slice(idx(G.singerEmerge));
    expect(afterS.some((x) => x.g === G.singerDim || x.g === G.singerDormant)).toBe(false);
    // The thuds: the tear, the punch (the heaviest), the shatter, and the
    // thrum's tremors.
    expect(Math.max(...r.shakes)).toBeGreaterThan(1);
    expect(r.shakes.length).toBeGreaterThan(5);
    for (const n of NAMES) expect(seen.has(n), n).toBe(true);
    expect(r.fx.currentLook.active).toBe(false);
    expect(visible(r.scene, 'smithHeartCouncilEntranceSlabs')).toBe(false);
    expect(visible(r.scene, 'smithHeartCouncilEntranceCrystal')).toBe(false);
    r.fx.dispose();
  });

  it('a joiner after the tear plays no Awaken for the Guardian and no thud for it; one after the scene sees both standing', () => {
    const r = rig();
    play(r, E.tearAt + 0.5);
    expect(count(r, G.guardianEmerge)).toBe(0);
    expect(count(r, G.guardianPunch)).toBe(1);
    expect(count(r, G.singerEmerge)).toBe(1);
    r.fx.dispose();
    const late = rig();
    late.aura(null);
    for (let i = 0; i < 40; i++) late.fx.update(1 / 20);
    expect(late.sent).toHaveLength(0);
    expect(late.fx.currentLook.active).toBe(false);
    late.fx.dispose();
  });

  it('a scene cut short before the shatter breaks both out at once (no punch, no note)', () => {
    const r = rig();
    const seen = play(r, 0, 3);
    expect(count(r, G.guardianEmerge)).toBe(1);
    expect(count(r, G.singerEmerge)).toBe(1);
    expect(count(r, G.guardianPunch)).toBe(0);
    expect(count(r, G.singerNote)).toBe(0);
    expect(r.fx.currentLook.active).toBe(false);
    expect(seen.has('smithHeartCouncilEntranceLightWave')).toBe(false);
    r.fx.dispose();
  });

  it('under reduced motion the whole scene plays with no thud and no flash, its light capped', () => {
    const r = rig({ reduced: true });
    const seen = play(r);
    expect(r.shakes).toHaveLength(0);
    expect(seen.has('smithHeartCouncilEntranceFlash')).toBe(false);
    for (const n of NAMES.filter((x) => x !== 'smithHeartCouncilEntranceFlash'))
      expect(seen.has(n), n).toBe(true);
    for (const g of [G.guardianEmerge, G.singerEmerge, G.guardianPunch, G.singerNote])
      expect(count(r, g), g).toBe(1);
    r.fx.dispose();
    const calm = rig({ reduced: true });
    const uniforms = (name: string) =>
      ((calm.scene.getObjectByName(name) as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;
    let t = E.shatterAt - 0.6;
    let vein = 0;
    calm.aura(waking(t));
    calm.fx.update(0.3);
    while (t < E.shatterAt - 0.02) {
      calm.aura(waking(t));
      calm.fx.update(1 / 20);
      t += 1 / 20;
      vein = Math.max(vein, uniforms('smithHeartCouncilEntranceCrystal').uGlow.value);
    }
    expect(vein).toBeLessThanOrEqual(REDUCED_LIGHT_CAP);
    calm.fx.dispose();
  });

  it('the low tier plays every beat with less rubble, fewer shards and pebbles', () => {
    const original = getActiveGfxProfile();
    const n = (r: ReturnType<typeof rig>, name: string) =>
      (r.scene.getObjectByName(name) as THREE.InstancedMesh).count;
    try {
      activateGfxProfile({ ...original, settings: { ...GFX, tier: 'low' } });
      const low = rig();
      const lowCounts = [
        'smithHeartCouncilEntranceRubble',
        'smithHeartCouncilEntranceShards',
        'smithHeartCouncilEntrancePebbles',
      ].map((x) => n(low, x));
      const slabs = n(low, 'smithHeartCouncilEntranceSlabs');
      const seen = play(low);
      // Every beat plays; the cosmetic doubles (entrance_budget_core.ts) never draw.
      for (const name of NAMES)
        expect(seen.has(name), name).toBe(!ENTRANCE_SECONDARY_LAYERS.council.includes(name));
      low.fx.dispose();
      activateGfxProfile(original);
      const full = rig();
      const fullCounts = [
        'smithHeartCouncilEntranceRubble',
        'smithHeartCouncilEntranceShards',
        'smithHeartCouncilEntrancePebbles',
      ].map((x) => n(full, x));
      for (let i = 0; i < 3; i++) expect(lowCounts[i]).toBeLessThan(fullCounts[i]);
      // The rock itself is never thinned.
      expect(n(full, 'smithHeartCouncilEntranceSlabs')).toBe(slabs);
      expect(slabs).toBe(ROCK_SLABS.length);
      full.fx.dispose();
    } finally {
      activateGfxProfile(original);
    }
  });
});
