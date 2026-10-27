// The Hammer Council's mythic prototype (src/sim/encounters/smith_heart/
// council_soul.ts and the COUNCIL_DIFFICULTY mythic row) over a REAL Sim claim:
// the dev switch, the stronger inheritances, the rock and Resonance that a
// living member always supplies, and Soul in the Stone: which pillar a soul
// takes, its immunity, the two things that strike its pips, its burst, the
// Echo of Wrath's cover, the Walking Slab, the Endless Song, two souls at
// once, the last kill and the wipe, normal and heroic untouched, determinism.

import { describe, expect, it } from 'vitest';
import {
  HAMMER_PIT,
  QUARRY_PILLAR_R,
  QUARRY_PILLAR_SPOTS,
} from '../src/sim/content/smith_heart_layout';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_DIFFICULTY,
  COUNCIL_NAMES,
  COUNCIL_SOUL_TEMPLATES,
  type CouncilFightState,
  type CouncilRole,
  councilPillarTemplate,
  councilRiseSpotSeconds,
  councilRiseSpotTemplate,
  councilScopeForDev,
  councilSoulOf,
  councilSoulTemplate,
  endlessSongMult,
  largestGroup,
  pillarBetween,
  soulHost,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { crackPillar } from '../src/sim/encounters/smith_heart/council_pillars';
import {
  COMBAT_WALL_SHAPES,
  combatWallsAt,
  wallAnchor,
} from '../src/sim/instances/combat_wall_state';
import type { Entity } from '../src/sim/types';
import { type CouncilFight, councilFight, hitsOf } from './helpers/council_fight';

const MID = { x: HAMMER_PIT.x, z: HAMMER_PIT.z };
const ROLES: CouncilRole[] = ['guardian', 'slabwright', 'singer'];

function quiet(st: CouncilFightState): void {
  st.weightTimer = 999;
  st.wakeTimer = 999;
  st.rockTimer = 999;
  st.boltTimer = 999;
  st.songTimer = 999;
  st.songDue = null;
  st.pulseTimer = 999;
  st.energy = 0;
}

type Fight = CouncilFight & { st: CouncilFightState };

/** Pull the council on `tier` (dev switch), clocks parked. */
function pulled(tier: 'normal' | 'heroic' | 'mythic' = 'mythic', n = 6, seed = 17): Fight {
  const f = councilFight(n, seed);
  if (tier !== 'normal') f.dev(`/dev heart council ${tier} on`);
  f.dev('/dev heart council pull');
  f.tick();
  const st = f.state();
  if (!st) throw new Error('the council did not pull');
  quiet(st);
  return { ...f, st };
}

function kill(f: Fight, role: CouncilRole): void {
  f.sim.ctx.handleDeath(f.bodies()[role] as Entity, f.players[0]);
  f.tick();
  // A fresh soul's own clocks run as they will; the mechanic clocks stay parked.
  quiet(f.st);
}

const souls = (f: CouncilFight) => f.pillars().filter((p) => p.soul !== null);
const column = (f: CouncilFight, k: number) => {
  const s = QUARRY_PILLAR_SPOTS[k];
  return f.pillars().find((p) => Math.hypot(f.local(p.e).x - s.x, f.local(p.e).z - s.z) < 0.5);
};
/** A spot `out` yards past column k's face, away from the Quarry's middle. */
const pastColumn = (k: number, out: number) => {
  const s = QUARRY_PILLAR_SPOTS[k];
  const d = Math.hypot(s.x - MID.x, s.z - MID.z);
  const ux = (s.x - MID.x) / d;
  const uz = (s.z - MID.z) / d;
  return { x: s.x + ux * (QUARRY_PILLAR_R + out), z: s.z + uz * (QUARRY_PILLAR_R + out) };
};
/** A spot `out` yards off column k's face, toward the Quarry's middle. */
const beforeColumn = (k: number, out: number) => {
  const s = QUARRY_PILLAR_SPOTS[k];
  const d = Math.hypot(s.x - MID.x, s.z - MID.z);
  const ux = (s.x - MID.x) / d;
  const uz = (s.z - MID.z) / d;
  return { x: s.x - ux * (QUARRY_PILLAR_R + out), z: s.z - uz * (QUARRY_PILLAR_R + out) };
};
function plant(f: CouncilFight, e: Entity, x: number, z: number): void {
  const w = f.world(x, z);
  e.pos.x = w.x;
  e.pos.z = w.z;
  e.pos.y = f.sim.ctx.groundPos(w.x, w.z).y;
  e.prevPos = { ...e.pos };
  f.sim.ctx.rebucket(e);
}
/** Crack every column but `keep` to its last piece, so a soul takes `keep`. */
function onlyWhole(f: CouncilFight, keep: number): void {
  for (let k = 0; k < QUARRY_PILLAR_SPOTS.length; k++) {
    const p = column(f, k);
    if (p && k !== keep) p.e.templateId = councilPillarTemplate(1, false);
  }
}
/** Park the players far from every column, toward the Pit Mouth. */
function parkRaid(f: CouncilFight, from = 1): void {
  f.players.slice(from).forEach((p, i) => {
    f.put(p, MID.x - 6 + i * 0.4, MID.z - 2);
  });
}

describe('Hammer Council mythic: the switch', () => {
  it('is reached only by its dev line, and heroic and mythic switch each other off', () => {
    const f = councilFight(2);
    f.dev('/dev heart council pull');
    f.tick();
    const st = () => f.state() as CouncilFightState;
    expect(st().difficulty).toBe('normal');
    f.dev('/dev heart council mythic on');
    expect(st().difficulty).toBe('mythic');
    f.dev('/dev heart council heroic on');
    expect(st().difficulty).toBe('heroic');
    f.dev('/dev heart council mythic off');
    expect(st().difficulty).toBe('heroic');
    f.dev('/dev heart council mythic on');
    expect(st().difficulty).toBe('mythic');
    f.dev('/dev heart council heroic off');
    expect(st().difficulty).toBe('mythic');
    f.dev('/dev heart council mythic off');
    expect(st().difficulty).toBe('normal');
  });

  it('mythic is every heroic rule and more', () => {
    const h = COUNCIL_DIFFICULTY.heroic;
    const m = COUNCIL_DIFFICULTY.mythic;
    expect(m.wakeMarks).toBe(h.wakeMarks);
    expect(m.songAfterWrath).toBe(false);
    expect(m.pillarPulse).toBe(true);
    expect(m.damageMult).toBe(h.damageMult);
    expect(m.heirRiseWarn).toBe(1.5);
    expect(m.heirSongMarks).toBe(4);
    expect(m.heirFillSeconds).toBe(30);
    expect(m.rockOutlivesSlabwright && m.soulInTheStone).toBe(true);
    for (const tier of ['normal', 'heroic'] as const) {
      expect(COUNCIL_DIFFICULTY[tier].soulInTheStone).toBe(false);
      expect(COUNCIL_DIFFICULTY[tier].rockOutlivesSlabwright).toBe(false);
    }
  });

  it('every soul template is a round wall of its kind, and reads back', () => {
    for (const tid of COUNCIL_SOUL_TEMPLATES) {
      const soul = councilSoulOf(tid);
      expect(soul, tid).not.toBeNull();
      if (!soul) continue;
      expect(councilSoulTemplate(soul.role, soul.risen, soul.pips)).toBe(tid);
      const shape = COMBAT_WALL_SHAPES[tid];
      expect(shape?.round).toBe(true);
      expect(shape?.hw).toBe(soul.risen ? T.risenR : T.columnR);
    }
    expect(COUNCIL_SOUL_TEMPLATES.length).toBe(3 * 2 * T.soulPips);
    // Only the walking soul's wall anchors on a grid; every other wall is exact.
    expect(wallAnchor(councilSoulTemplate('slabwright', true, 2), 3.3)).toBe(3.5);
    expect(wallAnchor(councilSoulTemplate('guardian', true, 2), 3.3)).toBe(3.3);
    expect(wallAnchor('sh_council_pillar_2', 3.3)).toBe(3.3);
    // The heir's rise spot keeps its shipped id at 2 s and carries any other.
    expect(councilRiseSpotTemplate(2)).toBe('sh_council_rise_spot');
    expect(councilRiseSpotSeconds(councilRiseSpotTemplate(1.5))).toBe(1.5);
    expect(councilRiseSpotSeconds('sh_council_rise_spot')).toBe(2);
    expect(councilRiseSpotSeconds('sh_council_rubble')).toBeNull();
    expect(councilSoulOf('sh_council_soul_guardian_c_0')).toBeNull();
    expect(councilSoulOf('sh_council_pillar_2')).toBeNull();
  });
});

describe('Hammer Council mythic: switched mid-fight, applied whole', () => {
  it('off mythic every live soul leaves its pillar: plain, whole, quiet, standing where it was', () => {
    const g = pulled();
    kill(g, 'guardian');
    kill(g, 'singer');
    g.tick(20 * 13); // the Echo's bar and the song's clock both running
    const held = souls(g);
    expect(held.map((p) => p.soul).sort()).toEqual(['guardian', 'singer']);
    const ids = held.map((p) => p.e.id);
    const at = held.map((p) => ({ ...p.e.pos }));
    const before = g.pillars().length;
    g.dev('/dev heart council mythic off');
    expect(g.st.difficulty).toBe('normal');
    expect(g.st.souls).toEqual([]);
    expect(souls(g)).toEqual([]);
    // The same pillars, still standing, plain and whole for their kind.
    expect(g.pillars().length).toBe(before);
    ids.forEach((id, i) => {
      const p = g.pillars().find((q) => q.e.id === id);
      expect(p, `pillar ${id}`).toBeDefined();
      if (!p) return;
      expect(p.soul).toBeNull();
      expect(p.integrity).toBe(p.risen ? T.risenIntegrity : T.columnIntegrity);
      expect(p.e.castingAbility).toBeNull();
      expect(p.e.auras.find((a) => a.id === COUNCIL_AURAS.endlessSong)).toBeUndefined();
      expect(Math.hypot(p.e.pos.x - at[i].x, p.e.pos.z - at[i].z)).toBeLessThan(1e-9);
    });
    // Nothing of mythic keeps running: no Echo, no song, no soul retaken.
    const ev = g.tick(20 * 25);
    expect(hitsOf(ev, COUNCIL_NAMES.echo).length).toBe(0);
    expect(hitsOf(ev, COUNCIL_NAMES.endlessSong).length).toBe(0);
    expect(souls(g)).toEqual([]);
    // And it held normal's rule: no pillar a soul's wall shape any more.
    const o = g.world(0, 0);
    for (const w of combatWallsAt(o.x, o.z)) expect(w.type).toBe('circle');
  });

  it('heroic on over mythic releases the souls the same way', () => {
    const g = pulled();
    kill(g, 'slabwright');
    expect(souls(g).length).toBe(1);
    g.dev('/dev heart council heroic on');
    expect(g.st.difficulty).toBe('heroic');
    expect(souls(g)).toEqual([]);
  });

  it('onto mythic every member already fallen takes its soul now, in the order they fell', () => {
    const g = pulled('normal');
    kill(g, 'singer');
    kill(g, 'guardian');
    expect(souls(g)).toEqual([]);
    g.dev('/dev heart council mythic on');
    expect(g.st.difficulty).toBe('mythic');
    expect(g.st.souls.map((q) => q.role)).toEqual(['singer', 'guardian']);
    expect(souls(g).length).toBe(2);
    // Whole mythic: the souls act and the rock outlives nobody yet.
    const ev = g.tick(20 * (T.echoFirst + T.echoCast + 0.5));
    expect(hitsOf(ev, COUNCIL_NAMES.endlessSong).length).toBeGreaterThan(0);
    // Off and on again: the released souls stand again, a burst one never.
    g.dev('/dev heart council soulpip 0');
    expect(g.st.soulsSpent.sort()).toEqual(['guardian', 'singer']);
    g.dev('/dev heart council mythic off');
    g.dev('/dev heart council mythic on');
    expect(souls(g)).toEqual([]);
  });
});

describe('Hammer Council mythic: the Walking Slab is cheap to move', () => {
  it('its collider republishes only as its half-yard anchor moves, never every tick', () => {
    const f = pulled(undefined, 6);
    onlyWhole(f, 0);
    kill(f, 'slabwright');
    const slab = souls(f)[0];
    expect(slab?.soul).toBe('slabwright');
    const s0 = QUARRY_PILLAR_SPOTS[0];
    const group = { x: s0.x + (MID.x - s0.x) * 0.6, z: s0.z + (MID.z - s0.z) * 0.6 };
    for (const p of f.players.slice(1)) f.put(p, group.x, group.z);
    const o = f.world(0, 0);
    let last = combatWallsAt(o.x, o.z);
    let publishes = 0;
    const start = { ...slab.e.pos };
    const ticks = 20 * 4;
    for (let i = 0; i < ticks; i++) {
      f.tick();
      const now = combatWallsAt(o.x, o.z);
      if (now !== last) publishes++;
      last = now;
    }
    const walked = Math.hypot(slab.e.pos.x - start.x, slab.e.pos.z - start.z);
    expect(walked).toBeGreaterThan(T.slabSpeed * 4 * 0.8);
    // About one publish per anchor step crossed on each axis (half a yard),
    // well under one a tick.
    expect(publishes).toBeLessThanOrEqual(Math.ceil((walked / 0.5) * 2) + 2);
    expect(publishes).toBeLessThan(ticks / 4);
    // The wall still stands within half an anchor step of the stone.
    const wall = last.find(
      (w) =>
        w.type === 'circle' &&
        Math.hypot(w.x - (slab.e.pos.x - o.x), w.z - (slab.e.pos.z - o.z)) < 0.36,
    );
    expect(wall).toBeDefined();
  });
});

describe('Hammer Council: normal and heroic never hold a soul', () => {
  for (const tier of ['normal', 'heroic'] as const) {
    it(`${tier}: every fall leaves the pillars plain and the rock gone with the Slabwright`, () => {
      const f = pulled(tier);
      kill(f, 'slabwright');
      expect(souls(f)).toEqual([]);
      f.dev('/dev heart council rock');
      f.tick(Math.ceil((T.rockCast + 0.2) * 20));
      expect(f.st.rock).toBeNull();
      kill(f, 'guardian');
      f.tick(20 * 10);
      expect(souls(f)).toEqual([]);
      expect(f.st.souls).toEqual([]);
      kill(f, 'singer');
      expect(souls(f)).toEqual([]);
      expect(f.state()?.finished).toBe(true);
    });
  }
});

describe('Soul in the Stone: the host', () => {
  it('takes the most intact pillar', () => {
    const f = pulled();
    onlyWhole(f, 3);
    kill(f, 'guardian');
    const s = souls(f);
    expect(s.length).toBe(1);
    expect(s[0].soul).toBe('guardian');
    expect(s[0].integrity).toBe(T.soulPips);
    expect(s[0].e.id).toBe(column(f, 3)?.e.id);
    expect(f.st.souls.map((q) => q.role)).toEqual(['guardian']);
  });

  it('on a tie, the one nearest the body (then the lower id)', () => {
    const f = pulled();
    // Two whole columns: the body lies by column 1.
    onlyWhole(f, 1);
    const c4 = column(f, 4);
    if (c4) c4.e.templateId = councilPillarTemplate(2, false);
    const near = beforeColumn(1, 3);
    plant(f, f.bodies().singer as Entity, near.x, near.z);
    kill(f, 'singer');
    expect(souls(f)[0]?.e.id).toBe(column(f, 1)?.e.id);
    // The pure pick: the same integrity and distance go to the lower id.
    const mk = (id: number, integrity: number, x: number) =>
      ({ e: { id, pos: { x, y: 0, z: 0 } }, integrity, risen: false, r: 2, soul: null }) as never;
    expect(soulHost([mk(9, 2, 5), mk(4, 2, -5), mk(2, 1, 0)], { x: 0, z: 0 })?.e.id).toBe(4);
    expect(soulHost([mk(9, 2, 5), mk(4, 2, 7)], { x: 0, z: 0 })?.e.id).toBe(9);
    expect(soulHost([mk(9, 1, 1), mk(4, 2, 30)], { x: 0, z: 0 })?.e.id).toBe(4);
  });

  it('with no pillar standing, a fresh one rises where the body lies', () => {
    const f = pulled();
    for (const p of f.pillars()) f.sim.ctx.dropEntity(p.e.id);
    f.inst.objectIds = f.inst.objectIds.filter((id) => f.sim.ctx.entities.has(id));
    parkRaid(f, 0);
    const at = { x: MID.x + 12, z: MID.z + 10 };
    plant(f, f.bodies().slabwright as Entity, at.x, at.z);
    kill(f, 'slabwright');
    const s = souls(f);
    expect(s.length).toBe(1);
    expect(s[0].risen).toBe(true);
    const l = f.local(s[0].e);
    expect(Math.hypot(l.x - at.x, l.z - at.z)).toBeLessThan(T.riseGap);
  });

  it('is never refused by the cap', () => {
    const f = pulled();
    // Fill the cap with risen pillars round the Quarry's middle.
    const sc = councilScopeForDev(f.sim.ctx, f.inst);
    if (!sc) throw new Error('scope');
    while (f.pillars().length < T.pillarCap) {
      f.st.wakeTimer = 0;
      f.dev('/dev heart council wake');
      f.tick(Math.ceil((T.wakeCast + T.wakeMarkSeconds + 0.5) * 20));
      quiet(f.st);
      f.players.forEach((p, i) => {
        const a = (i / f.players.length) * Math.PI * 2 + f.pillars().length;
        f.put(p, MID.x + Math.sin(a) * 15, MID.z + Math.cos(a) * 15);
      });
    }
    expect(f.pillars().length).toBe(T.pillarCap);
    kill(f, 'guardian');
    expect(souls(f).length).toBe(1);
    expect(f.pillars().length).toBe(T.pillarCap);
  });
});

describe('Soul in the Stone: the pips', () => {
  it('nothing but its own rules cracks it: no Wrath cover, no pulse, no crack', () => {
    const f = pulled();
    onlyWhole(f, 0);
    kill(f, 'singer');
    const soul = souls(f)[0];
    expect(soul?.soul).toBe('singer');
    if (!soul) return;
    // Hold the song (its pulses are not under test here).
    const rec = f.st.souls[0];
    rec.timer = 999;
    const sc = councilScopeForDev(f.sim.ctx, f.inst);
    if (!sc) throw new Error('scope');
    expect(crackPillar(f.sim.ctx, f.inst, f.st, soul)).toBe(false);
    // A player hidden behind the soul pillar alone: the Wrath finds them.
    const [tank, hidden] = f.players;
    const g = f.bodies().guardian as Entity;
    const at = beforeColumn(0, 9);
    plant(f, g, at.x, at.z);
    const behind = pastColumn(0, 2);
    f.put(hidden, behind.x, behind.z);
    f.put(tank, at.x + 2, at.z);
    parkRaid(f, 2);
    f.st.pulseTimer = T.pulseEvery;
    f.dev('/dev heart council wrath');
    const ev = f.tick(Math.ceil(T.wrathCast * 20) + 2);
    expect(hitsOf(ev, COUNCIL_NAMES.wrath, hidden.id).length).toBe(1);
    expect(souls(f)[0]?.integrity).toBe(T.soulPips);
    // Mythic's pillar pulse passes it by.
    expect(hitsOf(ev, COUNCIL_NAMES.pulse, hidden.id).length).toBe(0);
  });

  it('a Falling Rock within 6 yd strikes one pip', () => {
    const f = pulled();
    onlyWhole(f, 2);
    kill(f, 'guardian');
    f.st.souls[0].timer = 999;
    parkRaid(f, 1);
    f.dev('/dev heart council rock');
    f.tick(Math.ceil((T.rockCast + 0.2) * 20));
    const rock = f.st.rock;
    expect(rock).not.toBeNull();
    if (!rock) return;
    const marked = f.sim.ctx.entities.get(rock.playerId) as Entity;
    const at = beforeColumn(2, T.soulRockReach - 1);
    f.put(marked, at.x, at.z);
    f.tick(Math.ceil(T.rockMarkSeconds * 20) + 2);
    expect(souls(f)[0]?.integrity).toBe(T.soulPips - 1);
  });

  it('a Resonance carrier by it for 3 s strikes one pip, and the 3 s start again', () => {
    const f = pulled();
    onlyWhole(f, 2);
    kill(f, 'guardian');
    f.st.souls[0].timer = 999;
    parkRaid(f, 1);
    f.dev('/dev heart council resonance 1');
    const r = f.st.resonance[0];
    const marked = f.sim.ctx.entities.get(r.playerId) as Entity;
    const at = beforeColumn(2, 1.5);
    f.put(marked, at.x, at.z);
    f.tick(Math.ceil(T.soulResonanceSeconds * 20) - 4);
    expect(souls(f)[0]?.integrity).toBe(T.soulPips);
    f.tick(6);
    expect(souls(f)[0]?.integrity).toBe(T.soulPips - 1);
    f.tick(Math.ceil(T.soulResonanceSeconds * 20) - 6);
    expect(souls(f)[0]?.integrity).toBe(T.soulPips - 1);
    f.tick(8);
    expect(souls(f)[0]?.integrity).toBe(T.soulPips - 2);
  });

  it("by the Seam Singer's soul, Resonance strikes twice as fast", () => {
    const f = pulled();
    onlyWhole(f, 2);
    kill(f, 'singer');
    f.st.souls[0].timer = 999;
    parkRaid(f, 1);
    f.dev('/dev heart council resonance 1');
    const marked = f.sim.ctx.entities.get(f.st.resonance[0].playerId) as Entity;
    const at = beforeColumn(2, 1.5);
    f.put(marked, at.x, at.z);
    f.tick(Math.ceil(T.singerSoulResonanceSeconds * 20) + 2);
    expect(souls(f)[0]?.integrity).toBe(T.soulPips - 1);
    expect(T.singerSoulResonanceSeconds * 2).toBe(T.soulResonanceSeconds);
  });

  it('at 0 it bursts into rubble, its behaviour stops, the survivors keep every stack', () => {
    const f = pulled();
    onlyWhole(f, 1);
    kill(f, 'guardian');
    const pillarId = souls(f)[0]?.e.id;
    f.dev('/dev heart council soulpip 1');
    expect(souls(f)[0]?.integrity).toBe(1);
    f.dev('/dev heart council resonance 1');
    const marked = f.sim.ctx.entities.get(f.st.resonance[0].playerId) as Entity;
    const at = beforeColumn(1, 1.5);
    f.put(marked, at.x, at.z);
    f.st.souls[0].timer = 999;
    const ev = f.tick(Math.ceil(T.soulResonanceSeconds * 20) + 2);
    expect(souls(f)).toEqual([]);
    expect(f.sim.ctx.entities.has(pillarId as number)).toBe(false);
    expect(f.st.souls).toEqual([]);
    expect(f.st.rubble.length).toBe(1);
    expect(ev.some((e) => e.type === 'spellfxAt' && e.ability === 'heart_council_soul_burst')).toBe(
      true,
    );
    // No Echo ever again; the stacks and the Wrath's heir stay.
    const ev2 = f.tick(20 * (T.echoEvery + T.echoCast + 1));
    expect(hitsOf(ev2, COUNCIL_NAMES.echo).length).toBe(0);
    for (const r of ['slabwright', 'singer'] as const) {
      expect(f.bodies()[r]?.auras.find((a) => a.id === COUNCIL_AURAS.memory)?.stacks).toBe(1);
    }
    f.st.energy = T.energyMax;
    f.tick(2);
    const heir = (['slabwright', 'singer'] as const)
      .map((r) => f.bodies()[r])
      .find((b) => b?.castingAbility === COUNCIL_CASTS.wrath);
    expect(heir?.castTotal).toBe(T.heirWrathCast);
  });
});

describe("Soul in the Stone: the Guardian's Echo of Wrath", () => {
  it('spares the hidden, strikes the exposed, cracks the shield; a soul pillar shields nobody', () => {
    const f = pulled(undefined, 5);
    onlyWhole(f, 0);
    kill(f, 'guardian');
    const echo = souls(f)[0];
    expect(echo?.soul).toBe('guardian');
    if (!echo) return;
    // A second soul in column 1 (it shields nobody either).
    const c1 = column(f, 1);
    if (c1) c1.e.templateId = councilPillarTemplate(2, false);
    f.dev('/dev heart council soul singer');
    const song = souls(f).find((p) => p.soul === 'singer');
    expect(song?.e.id).toBe(c1?.e.id);
    const songRec = f.st.souls.find((q) => q.role === 'singer');
    if (songRec) songRec.timer = 999;
    const [, hidden, exposed, behindSoul, tank] = f.players;
    const e0 = f.local(echo.e);
    // Hidden: past column 4 as seen from the soul pillar.
    const c3 = QUARRY_PILLAR_SPOTS[4];
    const away = (c: { x: number; z: number }, out: number) => {
      const d = Math.hypot(c.x - e0.x, c.z - e0.z);
      return {
        x: c.x + ((c.x - e0.x) / d) * (QUARRY_PILLAR_R + out),
        z: c.z + ((c.z - e0.z) / d) * (QUARRY_PILLAR_R + out),
      };
    };
    const h = away(c3, 2);
    f.put(hidden, h.x, h.z);
    const b = away(QUARRY_PILLAR_SPOTS[1], 2);
    f.put(behindSoul, b.x, b.z);
    f.put(exposed, MID.x, MID.z - 4);
    f.put(tank, MID.x + 3, MID.z + 2);
    const pillars = f.pillars();
    expect(pillarBetween(pillars, echo.e.pos, hidden.pos)?.e.id).toBe(column(f, 4)?.e.id);
    expect(pillarBetween(pillars, echo.e.pos, behindSoul.pos)?.e.id).toBe(c1?.e.id);
    const c3Before = column(f, 4)?.integrity ?? 0;
    // The Echo comes due now.
    f.st.souls.find((q) => q.role === 'guardian')!.timer = 0.01;
    let ev = f.tick(2);
    expect(echo.e.castingAbility).toBe(COUNCIL_CASTS.echo);
    expect(echo.e.castTotal).toBe(T.echoCast);
    ev = ev.concat(f.tick(Math.ceil(T.echoCast * 20) + 2));
    expect(hitsOf(ev, COUNCIL_NAMES.echo, hidden.id).length).toBe(0);
    expect(hitsOf(ev, COUNCIL_NAMES.echo, exposed.id).length).toBe(1);
    expect(hitsOf(ev, COUNCIL_NAMES.echo, behindSoul.id).length).toBe(1);
    const c3After = column(f, 4);
    expect(c3After ? c3After.integrity : 0).toBe(c3Before - 1);
    expect(souls(f).find((p) => p.soul === 'singer')?.integrity).toBe(T.soulPips);
    // About 60 percent of a Wrath (mythic's damage and one Memory stack).
    const [hit] = hitsOf(ev, COUNCIL_NAMES.echo, exposed.id);
    expect(hit).toBeGreaterThanOrEqual(Math.floor(T.wrathMin * T.echoShare * 1.25));
    expect(hit).toBeLessThanOrEqual(Math.ceil(T.wrathMax * T.echoShare * 1.25 * 1.15) + 1);
    expect(echo.e.castingAbility).toBeNull();
  });
});

describe("Soul in the Stone: the Slabwright's Walking Slab", () => {
  it('picks the largest group (roster order on a tie)', () => {
    const at = (id: number, x: number, z: number) =>
      ({ id, dead: false, pos: { x, y: 0, z } }) as Entity;
    const g = largestGroup([at(1, 0, 0), at(2, 30, 0), at(3, 31, 0), at(4, 32, 0)]);
    expect(g?.x).toBeCloseTo(31);
    expect(largestGroup([at(1, 0, 0), at(2, 30, 0)])?.x).toBe(0);
  });

  it('drags itself toward the group with its wall, crushes and throws who is under it', () => {
    const f = pulled(undefined, 6);
    onlyWhole(f, 0);
    kill(f, 'slabwright');
    const slab = souls(f)[0];
    expect(slab?.soul).toBe('slabwright');
    if (!slab) return;
    const s0 = QUARRY_PILLAR_SPOTS[0];
    const ux = (MID.x - s0.x) / 24;
    const uz = (MID.z - s0.z) / 24;
    // Four together toward the Quarry's middle, one alone far away.
    const group = { x: s0.x + ux * 14, z: s0.z + uz * 14 };
    const [tank, a, b, c, d, lone] = f.players;
    for (const p of [a, b, c, d]) f.put(p, group.x, group.z);
    f.put(lone, MID.x - 20, MID.z - 10);
    f.put(tank, MID.x - 18, MID.z - 12);
    const dist = () => {
      const l = f.local(slab.e);
      return Math.hypot(l.x - group.x, l.z - group.z);
    };
    const before = dist();
    f.tick(20 * 3);
    const moved = before - dist();
    expect(moved).toBeGreaterThan(T.slabSpeed * 3 * 0.85);
    expect(moved).toBeLessThan(T.slabSpeed * 3 * 1.05);
    // Its wall walks with it.
    const o = f.world(0, 0);
    const wall = combatWallsAt(o.x, o.z).find(
      (w) =>
        w.type === 'circle' &&
        // On its half-yard anchor grid (wallAnchor), both worlds alike.
        Math.hypot(w.x - (slab.e.pos.x - o.x), w.z - (slab.e.pos.z - o.z)) < 0.36,
    );
    expect(wall).toBeDefined();
    // Under it: struck hard and thrown back; near it: the grind.
    const front = {
      x: f.local(slab.e).x + ux * (slab.r + 0.6),
      z: f.local(slab.e).z + uz * (slab.r + 0.6),
    };
    f.put(a, front.x, front.z);
    const ev = f.tick(20 * 2);
    expect(hitsOf(ev, COUNCIL_NAMES.slab, a.id).length).toBeGreaterThanOrEqual(1);
    expect(hitsOf(ev, COUNCIL_NAMES.grind).length).toBeGreaterThanOrEqual(1);
    const face = Math.hypot(a.pos.x - slab.e.pos.x, a.pos.z - slab.e.pos.z) - slab.r;
    expect(face).toBeGreaterThan(T.slabCrushReach);
    expect(hitsOf(ev, COUNCIL_NAMES.slab, lone.id).length).toBe(0);
  });
});

describe("Soul in the Stone: the Seam Singer's Endless Song", () => {
  it('grows by 12 percent a pulse and caps at 4 times the first', () => {
    expect(endlessSongMult(0)).toBe(1);
    expect(endlessSongMult(1)).toBeCloseTo(1.12);
    expect(endlessSongMult(10)).toBeCloseTo(2.2);
    expect(endlessSongMult(25)).toBe(T.songPulseCap);
    expect(endlessSongMult(500)).toBe(T.songPulseCap);
    const f = pulled();
    onlyWhole(f, 4);
    kill(f, 'singer');
    const song = souls(f)[0];
    expect(song?.soul).toBe('singer');
    if (!song) return;
    const p = f.players[3];
    let ev = f.tick(Math.ceil((T.songPulseFirst + 0.1) * 20));
    const first = hitsOf(ev, COUNCIL_NAMES.endlessSong, p.id);
    expect(first.length).toBe(1);
    // Every player in the Quarry hears it.
    for (const q of f.players) expect(hitsOf(ev, COUNCIL_NAMES.endlessSong, q.id).length).toBe(1);
    ev = f.tick(Math.ceil(T.songPulseEvery * 20) * 5);
    const later = hitsOf(ev, COUNCIL_NAMES.endlessSong, p.id);
    expect(later.length).toBe(5);
    expect(later[4]).toBeGreaterThan(first[0]);
    const aura = song.e.auras.find((a) => a.id === COUNCIL_AURAS.endlessSong);
    expect(aura?.stacks).toBe(6);
    expect(aura?.value).toBeCloseTo(endlessSongMult(6));
    // Capped: a song a hundred pulses on is no louder than one thirty on.
    f.st.souls[0].pulses = 100;
    ev = f.tick(Math.ceil(T.songPulseEvery * 20));
    const [capped] = hitsOf(ev, COUNCIL_NAMES.endlessSong, p.id);
    expect(capped).toBeLessThanOrEqual(
      Math.ceil(T.songPulseMax * T.songPulseCap * 1.25 * 1.15) + 1,
    );
    expect(capped).toBeGreaterThanOrEqual(Math.floor(T.songPulseMin * T.songPulseCap * 1.25));
    expect(song.e.castingAbility).toBe(COUNCIL_CASTS.endlessSong);
  });
});

describe('Soul in the Stone: many souls, the end, the wipe', () => {
  it('a second fall takes a second pillar; the last crumbles them all', () => {
    const f = pulled();
    kill(f, 'guardian');
    kill(f, 'singer');
    const s = souls(f);
    expect(s.map((p) => p.soul).sort()).toEqual(['guardian', 'singer']);
    expect(new Set(s.map((p) => p.e.id)).size).toBe(2);
    kill(f, 'slabwright');
    expect(souls(f)).toEqual([]);
    expect(f.state()?.finished).toBe(true);
    expect(f.pillars().some((p) => p.risen)).toBe(false);
  });

  it('a wipe stands the five columns whole again, every soul gone', () => {
    const f = pulled();
    kill(f, 'guardian');
    kill(f, 'slabwright');
    expect(souls(f).length).toBe(2);
    // Let the slab walk off its socket first.
    f.tick(20 * 4);
    for (const p of f.players) f.sim.ctx.handleDeath(p, null);
    for (let i = 0; i < 20 * 60 && f.state(); i++) f.sim.tick();
    expect(f.state()).toBeNull();
    expect(f.pillars().length).toBe(5);
    expect(f.pillars().every((p) => p.soul === null && !p.risen && p.integrity === 2)).toBe(true);
    expect(f.pillars().every((p) => p.e.castingAbility === null && p.e.auras.length === 0)).toBe(
      true,
    );
  });
});

describe('Hammer Council mythic: the rock and Resonance never stop', () => {
  const orders: CouncilRole[][] = [
    ['guardian', 'slabwright', 'singer'],
    ['guardian', 'singer', 'slabwright'],
    ['slabwright', 'guardian', 'singer'],
    ['slabwright', 'singer', 'guardian'],
    ['singer', 'guardian', 'slabwright'],
    ['singer', 'slabwright', 'guardian'],
  ];
  const supplies = (f: Fight) => {
    // Falling Rock: a living member drops it.
    for (const r of ROLES) f.st.gaps[r] = 0;
    f.dev('/dev heart council rock');
    f.tick(Math.ceil((T.rockCast + 0.2) * 20));
    expect(f.st.rock).not.toBeNull();
    f.tick(Math.ceil(T.rockMarkSeconds * 20) + 2);
    quiet(f.st);
    // Resonance: a living member sings it.
    f.st.resonance = [];
    f.dev('/dev heart council song');
    f.tick(Math.ceil(T.songCast * 20) + 2);
    expect(f.st.resonance.length).toBeGreaterThan(0);
    quiet(f.st);
  };
  for (const order of orders) {
    it(`order ${order.join(' > ')}`, () => {
      const f = pulled(undefined, 8);
      kill(f, order[0]);
      supplies(f);
      kill(f, order[1]);
      supplies(f);
      kill(f, order[2]);
      expect(f.state()?.finished).toBe(true);
    });
  }

  it('the stronger inheritances: 1.5 s rises, the song on four, a 30 s fill', () => {
    const f = pulled(undefined, 8);
    kill(f, 'slabwright');
    f.st.wakeTimer = 0;
    f.tick();
    expect(f.st.riseSpots.length).toBeGreaterThan(0);
    expect(f.st.riseSpots[0].remaining).toBeCloseTo(1.5, 5);
    // The spot's template carries the shorter warning to every client.
    const spot = f.sim.ctx.entities.get(f.st.riseSpots[0].objectId);
    expect(councilRiseSpotSeconds(spot?.templateId ?? '')).toBe(1.5);
    quiet(f.st);
    kill(f, 'singer');
    f.st.resonance = [];
    f.dev('/dev heart council song');
    f.tick(Math.ceil(T.songCast * 20) + 2);
    expect(f.st.resonance.length).toBe(4);
    const g = pulled(undefined, 4);
    kill(g, 'guardian');
    g.st.energy = 0;
    g.tick(20 * 15);
    expect(g.st.energy).toBeGreaterThan(48);
    expect(g.st.energy).toBeLessThan(52);
  });
});

describe('Hammer Council mythic: determinism', () => {
  it('the same seed and the same raid fight the same mythic fight', () => {
    const run = () => {
      const f = councilFight(6, 41);
      f.dev('/dev heart council mythic on');
      f.dev('/dev heart council pull');
      let ev = f.tick(20 * 30);
      f.sim.ctx.handleDeath(f.bodies().slabwright as Entity, f.players[0]);
      ev = ev.concat(f.tick(20 * 25));
      f.sim.ctx.handleDeath(f.bodies().singer as Entity, f.players[0]);
      ev = ev.concat(f.tick(20 * 25));
      const st = f.state();
      return JSON.stringify({
        casts: st?.casts,
        souls: st?.souls.map((q) => [q.role, q.pulses, q.goal]),
        pillars: f.pillars().map((p) => [p.e.templateId, Math.round(p.e.pos.x * 10)]),
        hits: ev
          .filter((e) => e.type === 'damage')
          .map((e) => [(e as { ability?: string }).ability, (e as { amount?: number }).amount])
          .slice(0, 600),
      });
    };
    expect(run()).toBe(run());
  });
});
