// The Guardian of the Heat grown (pass 4 of 2026-11-06): a bigger body in a
// bigger wellspring with more shore round it for the raid's melee. Every reach
// measured from the well's middle follows its lip (HEAT_WELL_R), so the fight
// keeps its shape: the bands begin at the lip, Hearth Flare strikes 12 yd past
// it, the fist never lands in the fire, the shore points stay clear of it,
// the back lip still clears the altar-stone, melee reaches the body from the
// shore and the body's swing reaches them back. And the Hearthseeds are
// thrown: the throw's cue at once, each seed's landing cue seedFlight later
// on its own spot, the burst still on its fuse from the throw.

import { describe, expect, it } from 'vitest';
import { effectivePlayerAttackRange } from '../src/sim/combat/player_attack_reach';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { GIANT_ANVIL, HEARTH_WELL } from '../src/sim/content/smith_heart_layout';
import { HEAT_PULL_SPOT } from '../src/sim/dev/smith_heart_dev';
import {
  beyondFlare,
  HEAT_CUES,
  HEAT_GUARDIAN,
  HEAT_GUARDIAN_SCALE,
  HEAT_NAMES,
  HEAT_OBJECTS,
  HEAT_WELL_R,
  inBand,
  inHearthFloor,
  SHORE_POINTS,
  HEAT_TUNING as T,
  WELLKEEPER_SPOTS,
  WELLSPAWN_SPOTS,
  wellDistance,
  ZONE_BANDS,
} from '../src/sim/encounters/smith_heart';
import { fistSpot } from '../src/sim/encounters/smith_heart/heat_fist';
import { combatProfileForMob } from '../src/sim/mob_combat';
import { DT, MELEE_RANGE, type SimEvent } from '../src/sim/types';
import { heatFight } from './helpers/heat_fight';

const ticks = (s: number) => Math.round(s / DT);
const cuesOf = (ev: SimEvent[], id: string) =>
  ev.filter((e) => (e.type === 'spellfx' || e.type === 'spellfxAt') && e.ability === id);

describe('Guardian of the Heat: the grown wellspring', () => {
  it('takes its lip from HEAT_WELL_R, a third wider than the first pass, and a bigger body', () => {
    expect(HEARTH_WELL.r).toBe(HEAT_WELL_R);
    expect(HEAT_WELL_R).toBe(10.5);
    expect(HEAT_GUARDIAN_SCALE).toBe(4);
    const tpl = SMITH_HEART_MOBS[HEAT_GUARDIAN];
    expect(tpl.scale).toBe(HEAT_GUARDIAN_SCALE);
    expect(tpl.bodyRadius).toBe(HEAT_WELL_R);
  });

  it('keeps its back lip and its stumps clear of the altar-stone', () => {
    const backLip = HEARTH_WELL.x - HEARTH_WELL.r;
    const altarFace = GIANT_ANVIL.x + GIANT_ANVIL.hw;
    // The lip's basalt stumps stand about a yard past the lip.
    expect(backLip - 1).toBeGreaterThan(altarFace);
    // The whole pool and a melee ring round its front lie on the floor.
    for (let a = -90; a <= 90; a += 15) {
      const r = (a * Math.PI) / 180;
      const x = HEARTH_WELL.x + Math.sin(Math.PI / 2 + r) * (HEARTH_WELL.r + 5);
      const z = HEARTH_WELL.z + Math.cos(Math.PI / 2 + r) * (HEARTH_WELL.r + 5);
      expect(inHearthFloor(x, z)).toBe(true);
    }
  });

  it('measures every reach from the lip: the bands, Hearth Flare, the feeding', () => {
    expect(ZONE_BANDS[0][0]).toBe(HEAT_WELL_R);
    expect(ZONE_BANDS[0][1] - ZONE_BANDS[0][0]).toBe(11);
    expect(ZONE_BANDS[1][1] - ZONE_BANDS[1][0]).toBe(12);
    expect(ZONE_BANDS[1][0]).toBe(ZONE_BANDS[0][1]);
    expect(ZONE_BANDS[2][0]).toBe(ZONE_BANDS[1][1]);
    expect(T.flareReach).toBe(HEAT_WELL_R + 12);
    expect(T.spawnReach).toBe(HEAT_WELL_R + 1.5);
    // A melee standing on the shore just outside the lip: band 0, no Flare.
    const x = HEARTH_WELL.x + HEARTH_WELL.r + 1.5;
    expect(inBand(0, x, 0)).toBe(true);
    expect(beyondFlare(x, 0)).toBe(false);
    // The far band still reaches the floor's east end.
    expect(ZONE_BANDS[2][1]).toBeGreaterThan(wellDistance(-174, 0));
  });

  it('never drops the fist, a cinder or an add in the fire', () => {
    const inside = fistSpot({ x: HEARTH_WELL.x + 2, z: 1 });
    expect(wellDistance(inside.x, inside.z)).toBeCloseTo(HEARTH_WELL.r + 1, 6);
    expect(SHORE_POINTS.length).toBeGreaterThan(20);
    for (const p of SHORE_POINTS)
      expect(wellDistance(p.x, p.z)).toBeGreaterThanOrEqual(HEARTH_WELL.r + 4);
    for (const p of [...WELLSPAWN_SPOTS, ...WELLKEEPER_SPOTS]) {
      expect(inHearthFloor(p.x, p.z)).toBe(true);
      expect(wellDistance(p.x, p.z)).toBeGreaterThan(T.spawnReach + 4);
    }
  });

  it('sets a dev pull down on the shore, out of the fire, inside the reach', () => {
    const d = wellDistance(HEAT_PULL_SPOT.x, HEAT_PULL_SPOT.z);
    expect(d).toBeGreaterThan(HEARTH_WELL.r);
    expect(d).toBeLessThan(HEARTH_WELL.r + 3);
  });

  it('keeps the heroic adds walk to the lip about as long as the first pass', () => {
    // First pass: 39.2 yd from the east spots, 39.9 from the corner ones.
    for (const p of WELLSPAWN_SPOTS) {
      const walk = wellDistance(p.x, p.z) - T.spawnReach;
      expect(walk).toBeGreaterThan(36);
      expect(walk).toBeLessThan(42);
    }
  });

  it('lets melee strike the body from the shore and the body swing back at them', () => {
    const reach = effectivePlayerAttackRange(
      { kind: 'mob', templateId: HEAT_GUARDIAN },
      MELEE_RANGE,
    );
    // From the lip and three yards out onto the shore.
    expect(reach).toBe(HEAT_WELL_R + 3);
    const own = combatProfileForMob(HEAT_GUARDIAN, HEAT_GUARDIAN_SCALE).meleeRange;
    expect(own).toBeGreaterThanOrEqual(reach + 1);
  });
});

describe('Guardian of the Heat: the thrown Hearthseeds', () => {
  it('throws at once, lands each seed seedFlight later on its spot, bursts on its fuse', () => {
    const f = heatFight(3, 31);
    expect(f.dev('/dev heart heat pull')).toBe(true);
    f.tick(2);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.fistTimer = 999;
    st.flareTimer = 999;
    st.seedTimer = 999;
    st.zoneTimer = 999;
    st.cinderTimer = 999;
    const spots = f.players.map((p) => f.local(p));
    f.dev('/dev heart heat seeds');
    // The seeds' footprints show at once, where each player stood.
    const seeds = f.objects(HEAT_OBJECTS.seedPrefix);
    expect(seeds.length).toBe(3);
    expect(T.seedFlight).toBeGreaterThan(1);
    expect(T.seedFlight).toBeLessThan(T.seedLife / 2);
    // In flight: nothing has landed yet.
    const flying = f.tick(ticks(T.seedFlight) - 2);
    expect(cuesOf(flying, HEAT_CUES.seed)).toEqual([]);
    const landing = f.tick(4);
    const lands = cuesOf(landing, HEAT_CUES.seed);
    expect(lands.length).toBe(3);
    const o = f.world(0, 0);
    for (const spot of spots)
      expect(
        lands.some(
          (e) =>
            e.type === 'spellfxAt' &&
            Math.abs(e.x - o.x - spot.x) < 1e-6 &&
            Math.abs(e.z - o.z - spot.z) < 1e-6,
        ),
      ).toBe(true);
    // Each seed lands once, however long it lies there.
    const rest = f.tick(ticks(1));
    expect(cuesOf(rest, HEAT_CUES.seed)).toEqual([]);
    // The burst keeps its time from the throw.
    const before = f.tick(ticks(T.seedLife - T.seedFlight - 1) - 4);
    expect(cuesOf(before, HEAT_CUES.seedBurst)).toEqual([]);
    const burst = f.tick(4);
    expect(cuesOf(burst, HEAT_CUES.seedBurst).length).toBe(3);
    expect(burst.some((e) => e.type === 'damage' && e.ability === HEAT_NAMES.seed)).toBe(true);
  });

  it('cues the throw on the guardian the moment the seeds are hurled', () => {
    const f = heatFight(2, 7);
    expect(f.dev('/dev heart heat pull')).toBe(true);
    f.tick(2);
    f.dev('/dev heart heat phase 2');
    const s2 = f.state();
    if (!s2) throw new Error('no fight');
    s2.seedTimer = 0.05;
    s2.fistTimer = 999;
    s2.zoneTimer = 999;
    s2.cinderTimer = 999;
    const ev = f.tick(ticks(0.5));
    const throws = cuesOf(ev, HEAT_CUES.seedThrow);
    expect(throws.length).toBe(1);
    const t = throws[0];
    expect(t.type === 'spellfx' && t.sourceId).toBe(f.boss().id);
    expect(f.objects(HEAT_OBJECTS.seedPrefix).length).toBe(2);
  });
});
