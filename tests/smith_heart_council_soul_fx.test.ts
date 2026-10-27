// Soul in the Stone's look (src/render/smith_heart_fx/council_soul_fx.ts, the
// soul pillar in council_pillars_fx.ts, the plan in council_fx_core.ts): the
// souls' colours told apart, a soul pillar's lit cracks, the Echo's shelter
// wedges never wider than the sim's cover, the slab's footprints off the
// sim's own reach, the song's look growing and capping with the sim's
// multiplier, and a smoke run over a fake world (every soul cue claimed, each
// soul pillar drawn with its sheath and pips, the moving slab followed).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TELEGRAPH_THREAT_COLORS } from '../src/render/floor_telegraph/telegraph_look_core';
import { CouncilFx } from '../src/render/smith_heart_fx/council_fx';
import {
  councilClaims,
  coverShadow,
  ECHO_SPEC,
  ROCK_FALL_SECONDS,
  rockFall,
  SHELTER_PAD,
  SLAB_BITE_PHASE,
  SLAB_CLAWS,
  SOUL_COLORS,
  shadowPoint,
  slabPull,
  slabReach,
  slabTalon,
  soakCountdown,
  songLook,
  songPulsesOf,
  soulPillarLook,
} from '../src/render/smith_heart_fx/council_fx_core';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_CUES,
  councilSoulTemplate,
  endlessSongMult,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart/council_ids';
import { pillarBetween } from '../src/sim/encounters/smith_heart/council_pillars';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe('council_fx_core: Soul in the Stone', () => {
  it("gives each soul its own hue, none of them a mark's", () => {
    const hexes = Object.values(SOUL_COLORS).map((c) => c.hex);
    expect(new Set(hexes).size).toBe(3);
    for (const h of hexes) {
      expect(h).not.toBe(TELEGRAPH_THREAT_COLORS.control);
      expect(h).not.toBe(0xffc94a);
    }
  });

  it('lights a soul pillar wider as it loses pips, brighter as it charges', () => {
    const whole = { ...soulPillarLook(3, 0, 0) };
    const last = { ...soulPillarLook(1, 0, 0) };
    const charged = { ...soulPillarLook(3, 0, 1) };
    expect(last.crack).toBeGreaterThan(whole.crack);
    expect(whole.crack).toBeGreaterThan(0.5);
    expect(charged.glow).toBeGreaterThan(whole.glow);
    expect(charged.heat).toBeGreaterThan(whole.heat);
    const out = { crack: 0, heat: 0, glow: 0 };
    expect(soulPillarLook(2, 1, 0.5, out)).toBe(out);
  });

  it('the Walking Slab reaches, bites and hauls; still, it rests', () => {
    expect(SLAB_CLAWS.filter((c) => c.ahead).length).toBe(2);
    const at = (p: number, d = 1) => ({ ...slabPull(p, d) });
    // The front claws reach up and out, then dig in once they have bitten.
    expect(at(0.3).front).toBeGreaterThan(0.2);
    expect(at(SLAB_BITE_PHASE + 0.05).front).toBeLessThan(0);
    // The haul: the column surges ahead and rocks forward mid-pull.
    expect(at(0.75).lurch).toBeGreaterThan(at(0.2).lurch);
    expect(at(0.75).rock).toBeGreaterThan(0);
    // One pull is a cycle.
    expect(at(1.3).front).toBeCloseTo(at(0.3).front);
    for (const p of [0, 0.3, 0.6, 0.9]) {
      const still = at(p, 0);
      expect(
        Math.abs(still.front) + Math.abs(still.rear) + Math.abs(still.rock) + Math.abs(still.lurch),
      ).toBe(0);
    }
    const t = slabTalon(10, 20, 0, 0, 1);
    expect(t.x).toBeCloseTo(10);
    expect(t.z).toBeGreaterThan(25);
  });

  it('the soak counts down and its rock hangs over it for the whole mark', () => {
    const start = soakCountdown(T.rockMarkSeconds, T.rockMarkSeconds);
    const late = soakCountdown(0.2, T.rockMarkSeconds);
    expect(start.left).toBe(1);
    expect(late.left).toBeLessThan(0.1);
    expect(late.shadow).toBeGreaterThan(start.shadow);
    expect(late.beacon).toBeGreaterThan(start.beacon);
    // Continuous where it starts to drop.
    expect(rockFall(ROCK_FALL_SECONDS + 1e-4).height).toBeCloseTo(
      rockFall(ROCK_FALL_SECONDS).height,
      2,
    );
  });

  it("draws the Echo's and the Wrath's real shadow, never wider than the sim's cover", () => {
    expect(ECHO_SPEC.radius).toBe(T.echoRadius);
    expect(ECHO_SPEC.color).toBe(TELEGRAPH_THREAT_COLORS.lethal);
    const sh = { sx: 0, sz: 0, px: 0, pz: 0, r: 0, reach: 0, yaw: 0, half: 0 };
    const pt = { x: 0, z: 0 };
    // The Echo: the sim's cover is pillarBetween (wall radius plus a breath).
    const R = T.columnR;
    const w = coverShadow(0, 0, 0, 20, R + SHELTER_PAD.echo, T.echoRadius, sh);
    expect(w).not.toBeNull();
    if (!w) return;
    expect(w.yaw).toBeCloseTo(0);
    const pillar = [{ e: { pos: { x: 0, z: 20 } }, r: R }];
    let widest = 0;
    for (const across of [0, 0.02, 0.25, 0.5, 0.75, 0.98, 1])
      for (const along of [0, 0.01, 0.2, 0.6, 0.98]) {
        shadowPoint(w, across, along, pt);
        expect(pillarBetween(pillar, { x: 0, z: 0 }, pt), `${across} ${along}`).not.toBeNull();
        if (along === 0) widest = Math.max(widest, Math.abs(pt.x));
      }
    // The real shadow starts as wide as the pillar (never a needle from its
    // centre), and widens with the distance.
    shadowPoint(w, 0, 0, pt);
    const footHalf = Math.abs(pt.x);
    shadowPoint(w, 0, 0.98, pt);
    expect(Math.abs(pt.x)).toBeGreaterThan(footHalf + 1);
    expect(widest).toBeGreaterThan(R * 0.9);
    // Mountain's Wrath: the sight line against the wall itself.
    const v = coverShadow(0, 0, 0, 20, R + SHELTER_PAD.wrath, T.wrathRadius, sh);
    expect(v).not.toBeNull();
    if (!v) return;
    for (const across of [0, 0.5, 1])
      for (const along of [0, 0.5, 0.98]) {
        shadowPoint(v, across, along, pt);
        // Distance from the pillar's centre to the sight segment.
        const t = Math.max(0, Math.min(1, (20 * pt.z) / (pt.x * pt.x + pt.z * pt.z)));
        const d = Math.hypot(pt.x * t, pt.z * t - 20);
        expect(d, `${across} ${along}`).toBeLessThan(R);
      }
    expect(coverShadow(0, 0, 0, 60, R, T.echoRadius, sh)).toBeNull();
    expect(coverShadow(0, 0, 0, 1, R, T.echoRadius, sh)).toBeNull();
  });

  it("reads the slab's footprints and the song's growth off the sim", () => {
    expect(slabReach(T.risenR)).toEqual({
      crush: T.risenR + T.slabCrushReach,
      grind: T.risenR + T.slabGrindReach,
    });
    expect(songLook(0).mult).toBe(1);
    expect(songLook(0).rings).toBe(1);
    expect(songLook(500).mult).toBe(endlessSongMult(500));
    expect(songLook(500).rings).toBe(4);
    expect(songLook(10).bright).toBeGreaterThan(songLook(0).bright);
    // The pulse count reads back off the aura's multiplier (the wire drops a
    // stack count of one; the value always rides).
    for (const n of [0, 1, 2, 7, 25]) expect(songPulsesOf(endlessSongMult(n))).toBe(n);
  });

  it('claims every soul cue', () => {
    for (const id of [
      COUNCIL_CUES.soulTake,
      COUNCIL_CUES.soulPip,
      COUNCIL_CUES.soulBurst,
      COUNCIL_CUES.echoBlast,
      COUNCIL_CUES.songPulse,
      COUNCIL_CUES.slabCrush,
    ])
      expect(councilClaims(id), id).toBe(true);
  });
});

describe('CouncilFx: soul pillars over a fake world', () => {
  const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
  function entity(id: number, kind: Entity['kind'], templateId: string, x: number, z: number) {
    return {
      id,
      kind,
      templateId,
      name: templateId,
      pos: { x: o.x + x, y: 0, z: o.z + z },
      prevPos: { x: o.x + x, y: 0, z: o.z + z },
      facing: 0,
      scale: 1,
      hp: 100,
      maxHp: 100,
      dead: false,
      auras: [] as Entity['auras'],
      castingAbility: null as string | null,
      castTargetId: null,
      castRemaining: 0,
      castTotal: 0,
      resourceType: null,
      resource: 0,
      maxResource: 0,
    } as unknown as Entity;
  }

  it('draws each soul, follows the slab, claims and plays every soul moment', () => {
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', 8, -160);
    const dead = entity(5, 'mob', 'heart_hammer_guardian', 6, -168);
    dead.dead = true;
    const echo = entity(10, 'object', councilSoulTemplate('guardian', false, 3), 16, -147);
    const slab = entity(11, 'object', councilSoulTemplate('slabwright', true, 2), -6, -170);
    const song = entity(12, 'object', councilSoulTemplate('singer', false, 1), -12, -183);
    const plain = entity(13, 'object', 'sh_council_pillar_2', -11, -155);
    for (const e of [me, dead, echo, slab, song, plain]) entities.set(e.id, e);
    echo.castingAbility = COUNCIL_CASTS.echo;
    echo.castTotal = T.echoCast;
    echo.castRemaining = 1.5;
    song.castingAbility = COUNCIL_CASTS.endlessSong;
    song.castTotal = T.songPulseEvery;
    song.castRemaining = 1;
    song.auras.push({
      id: COUNCIL_AURAS.endlessSong,
      name: 'Endless Song',
      kind: 'buff_dmg_done',
      remaining: 3600,
      duration: 3600,
      value: endlessSongMult(4),
      stacks: 4,
      sourceId: song.id,
      school: 'nature',
    } as Entity['auras'][number]);
    const world = { entities, player: me, playerId: me.id } as unknown as IWorld;
    const scene = new THREE.Scene();
    const fx = new CouncilFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      () => {},
    );
    for (let i = 0; i < 6; i++) fx.update(1 / 30);
    const root = scene.getObjectByName('smith-heart-council-fx');
    const shown = (name: string) => {
      let n = 0;
      root?.traverse((c) => {
        if (c.name !== name) return;
        for (let q: THREE.Object3D | null = c; q; q = q.parent) if (!q.visible) return;
        n++;
      });
      return n;
    };
    expect(shown('smithHeartCouncilPillar')).toBe(4);
    expect(shown('smithHeartPillarPips')).toBe(4);
    expect(shown('smithHeartSoulGlow')).toBe(3);
    expect(shown('smithHeartSongFloor')).toBe(1);
    expect(shown('smithHeartSongClock')).toBe(1);
    // The Echo's real shadow behind the one soulless pillar in its reach.
    expect(shown('smithHeartShelter:echo')).toBe(1);
    // The slab walks: its drawn stone follows it.
    const holderAt = () => {
      let x = Number.NaN;
      root?.traverse((c) => {
        if (
          c.name === 'smithHeartCouncilPillar' &&
          c.visible &&
          Math.abs(c.position.z - slab.pos.z) < 6
        )
          if (Math.abs(c.position.x - (o.x - 6)) < 6) x = c.position.x;
      });
      return x;
    };
    const x0 = holderAt();
    slab.pos.x += 2;
    for (let i = 0; i < 30; i++) fx.update(1 / 30);
    expect(holderAt() - x0).toBeGreaterThan(1.5);
    const ev = (ability: string, sourceId: number, targetId = sourceId): SimEvent =>
      ({
        type: 'spellfx',
        sourceId,
        targetId,
        school: 'physical',
        fx: 'nova',
        ability,
      }) as SimEvent;
    expect(fx.handleEvent(ev(COUNCIL_CUES.soulTake, dead.id, echo.id))).toBe(true);
    expect(fx.handleEvent(ev(COUNCIL_CUES.soulPip, slab.id))).toBe(true);
    expect(fx.handleEvent(ev(COUNCIL_CUES.echoBlast, echo.id))).toBe(true);
    expect(fx.handleEvent(ev(COUNCIL_CUES.songPulse, song.id))).toBe(true);
    expect(fx.handleEvent(ev(COUNCIL_CUES.slabCrush, slab.id, me.id))).toBe(true);
    for (let i = 0; i < 90; i++) fx.update(1 / 30);
    // The song's soul bursts: its stone goes, the others stand.
    entities.delete(song.id);
    const burst = {
      type: 'spellfxAt',
      x: song.pos.x,
      z: song.pos.z,
      school: 'physical',
      fx: 'burst',
      ability: COUNCIL_CUES.soulBurst,
      radius: T.columnR,
    } as SimEvent;
    expect(fx.handleEvent(burst)).toBe(true);
    for (let i = 0; i < 120; i++) fx.update(1 / 30);
    expect(shown('smithHeartSoulGlow')).toBe(2);
    expect(shown('smithHeartSongFloor')).toBe(0);
    fx.dispose();
  });
});
