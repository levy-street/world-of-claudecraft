// The Hammer Council's mythic prototype (src/sim/encounters/smith_heart/
// council_soul.ts and the COUNCIL_DIFFICULTY mythic row) over a REAL Sim claim:
// the dev switch, the stronger inheritances, the rock that a living member
// always supplies, and Soul in the Stone (two souls now, one per member):
// which pillar a soul takes, its immunity (the Wrath shatters every other
// pillar and leaves it), the one thing that strikes its pips (the rock), its
// burst, the Echo of Wrath's cover, the Endless Song, two souls at once (a dev
// line), the last kill and the wipe, normal and heroic untouched, determinism.

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
const ROLES: CouncilRole[] = ['guardian', 'singer'];

function quiet(st: CouncilFightState): void {
  st.weightTimer = 999;
  st.wakeTimer = 999;
  st.rockTimer = 999;
  st.boltTimer = 999;
  st.songTimer = 999;
  st.songDue = null;
  st.pulseTimer = 999;
  st.rushTimer = 999;
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
    expect(m.heirFillSeconds).toBe(30);
    expect(m.rockOutlivesSinger && m.soulInTheStone && m.missCollapse).toBe(true);
    for (const tier of ['normal', 'heroic'] as const) {
      expect(COUNCIL_DIFFICULTY[tier].soulInTheStone).toBe(false);
      expect(COUNCIL_DIFFICULTY[tier].rockOutlivesSinger).toBe(false);
      expect(COUNCIL_DIFFICULTY[tier].missCollapse).toBe(false);
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
    // Two souls (the Slabwright's Walking Slab left with it), two kinds, the pips.
    expect(COUNCIL_SOUL_TEMPLATES.length).toBe(2 * 2 * T.soulPips);
    expect(COUNCIL_SOUL_TEMPLATES.some((t) => t.includes('slabwright'))).toBe(false);
    // No soul walks any more: every soul wall is exact.
    expect(wallAnchor(councilSoulTemplate('guardian', true, 2), 3.3)).toBe(3.3);
    expect(wallAnchor(councilSoulTemplate('singer', false, 2), 3.3)).toBe(3.3);
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
    // The Singer still fights; a dev line puts her soul in a pillar too.
    g.dev('/dev heart council soul singer');
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
    kill(g, 'singer');
    expect(souls(g).length).toBe(1);
    g.dev('/dev heart council heroic on');
    expect(g.st.difficulty).toBe('heroic');
    expect(souls(g)).toEqual([]);
  });

  it('onto mythic every member already fallen takes its soul now, in the order they fell', () => {
    const g = pulled('normal');
    kill(g, 'singer');
    expect(souls(g)).toEqual([]);
    g.dev('/dev heart council mythic on');
    expect(g.st.difficulty).toBe('mythic');
    expect(g.st.souls.map((q) => q.role)).toEqual(['singer']);
    expect(souls(g).length).toBe(1);
    // Whole mythic: the soul acts.
    const ev = g.tick(20 * (T.songPulseFirst + 0.5));
    expect(hitsOf(ev, COUNCIL_NAMES.endlessSong).length).toBeGreaterThan(0);
    // Off and on again: the released soul stands again, a burst one never.
    g.dev('/dev heart council soulpip 0');
    expect(g.st.soulsSpent).toEqual(['singer']);
    g.dev('/dev heart council mythic off');
    g.dev('/dev heart council mythic on');
    expect(souls(g)).toEqual([]);
  });
});

describe('Hammer Council: normal and heroic never hold a soul', () => {
  for (const tier of ['normal', 'heroic'] as const) {
    it(`${tier}: every fall leaves the pillars plain and the rock gone with the Singer`, () => {
      const f = pulled(tier);
      kill(f, 'singer');
      expect(souls(f)).toEqual([]);
      f.dev('/dev heart council rock');
      f.tick(Math.ceil((T.rockCast + 0.2) * 20));
      expect(f.st.rock).toBeNull();
      f.tick(20 * 10);
      expect(souls(f)).toEqual([]);
      expect(f.st.souls).toEqual([]);
      kill(f, 'guardian');
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
      ({
        e: { id, pos: { x, y: 0, z: 0 } },
        integrity,
        risen: false,
        r: 2,
        soul: null,
        cursed: false,
      }) as never;
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
    plant(f, f.bodies().singer as Entity, at.x, at.z);
    kill(f, 'singer');
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
  it('nothing but its own rules cracks it: no Wrath cover, the Wrath leaves it standing, no pulse, no crack', () => {
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
    // The Wrath shatters every other pillar; the soul pillar alone stands whole.
    expect(souls(f)[0]?.integrity).toBe(T.soulPips);
    expect(f.pillars().filter((p) => p.soul === null).length).toBe(0);
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

  it('Resonance (a spread) never strikes a pip, however long its carrier stands by it', () => {
    const f = pulled();
    onlyWhole(f, 2);
    kill(f, 'guardian');
    f.st.souls[0].timer = 999;
    parkRaid(f, 1);
    f.dev('/dev heart council resonance 1');
    const marked = f.sim.ctx.entities.get(f.st.resonance[0].playerId) as Entity;
    const at = beforeColumn(2, 1.5);
    f.put(marked, at.x, at.z);
    f.tick(20 * (T.resonanceSeconds + 1));
    expect(souls(f)[0]?.integrity).toBe(T.soulPips);
  });

  it('at 0 it bursts into rubble, its behaviour stops, the survivor keeps every stack', () => {
    const f = pulled();
    onlyWhole(f, 1);
    kill(f, 'guardian');
    const pillarId = souls(f)[0]?.e.id;
    f.dev('/dev heart council soulpip 1');
    expect(souls(f)[0]?.integrity).toBe(1);
    f.st.souls[0].timer = 999;
    parkRaid(f, 1);
    f.dev('/dev heart council rock');
    f.tick(Math.ceil((T.rockCast + 0.2) * 20));
    const rock = f.st.rock;
    expect(rock).not.toBeNull();
    if (!rock) return;
    const marked = f.sim.ctx.entities.get(rock.playerId) as Entity;
    const at = beforeColumn(1, T.soulRockReach - 1);
    f.put(marked, at.x, at.z);
    const ev = f.tick(Math.ceil(T.rockMarkSeconds * 20) + 2);
    expect(souls(f)).toEqual([]);
    expect(f.sim.ctx.entities.has(pillarId as number)).toBe(false);
    expect(f.st.souls).toEqual([]);
    expect(f.st.rubble.length).toBeGreaterThanOrEqual(1);
    expect(ev.some((e) => e.type === 'spellfxAt' && e.ability === 'heart_council_soul_burst')).toBe(
      true,
    );
    // No Echo ever again; the stacks and the Wrath's heir stay.
    const ev2 = f.tick(20 * (T.echoEvery + T.echoCast + 1));
    expect(hitsOf(ev2, COUNCIL_NAMES.echo).length).toBe(0);
    expect(f.bodies().singer?.auras.find((a) => a.id === COUNCIL_AURAS.memory)?.stacks).toBe(1);
    quiet(f.st);
    f.st.energy = T.energyMax;
    f.tick(2);
    expect(f.bodies().singer?.castingAbility).toBe(COUNCIL_CASTS.wrath);
    expect(f.bodies().singer?.castTotal).toBe(T.heirWrathCast);
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
  it('two souls (a dev line) take two pillars; the last kill crumbles them all', () => {
    const f = pulled();
    kill(f, 'guardian');
    f.dev('/dev heart council soul singer');
    const s = souls(f);
    expect(s.map((p) => p.soul).sort()).toEqual(['guardian', 'singer']);
    expect(new Set(s.map((p) => p.e.id)).size).toBe(2);
    kill(f, 'singer');
    expect(souls(f)).toEqual([]);
    expect(f.state()?.finished).toBe(true);
    expect(f.pillars().some((p) => p.risen)).toBe(false);
  });

  it('a wipe stands the five columns whole again, every soul gone', () => {
    const f = pulled();
    kill(f, 'guardian');
    f.dev('/dev heart council soul singer');
    expect(souls(f).length).toBe(2);
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

describe('Hammer Council mythic: the rock never stops', () => {
  const supplies = (f: Fight) => {
    for (const r of ROLES) f.st.gaps[r] = 0;
    f.dev('/dev heart council rock');
    f.tick(Math.ceil((T.rockCast + 0.2) * 20));
    expect(f.st.rock).not.toBeNull();
    f.tick(Math.ceil(T.rockMarkSeconds * 20) + 2);
    quiet(f.st);
  };
  for (const order of [
    ['guardian', 'singer'],
    ['singer', 'guardian'],
  ] as CouncilRole[][]) {
    it(`order ${order.join(' > ')}: the survivor drops the rock, the last kill finishes`, () => {
      const f = pulled(undefined, 8);
      kill(f, order[0]);
      supplies(f);
      kill(f, order[1]);
      expect(f.state()?.finished).toBe(true);
    });
  }

  it('the stronger inheritances: 1.5 s rises and a 30 s fill', () => {
    const f = pulled(undefined, 8);
    kill(f, 'singer');
    f.st.lastFloorAt = null;
    f.st.wakeTimer = 0;
    f.tick();
    expect(f.st.riseSpots.length).toBeGreaterThan(0);
    expect(f.st.riseSpots[0].remaining).toBeCloseTo(1.5, 5);
    const spot = f.sim.ctx.entities.get(f.st.riseSpots[0].objectId);
    expect(councilRiseSpotSeconds(spot?.templateId ?? '')).toBe(1.5);
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
      f.sim.ctx.handleDeath(f.bodies().singer as Entity, f.players[0]);
      ev = ev.concat(f.tick(20 * 45));
      const st = f.state();
      return JSON.stringify({
        casts: st?.casts,
        souls: st?.souls.map((q) => [q.role, q.pulses]),
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
