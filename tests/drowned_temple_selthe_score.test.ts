// Choirmother Selthe's Score (src/sim/encounters/drowned_temple/selthe_score.ts):
// at 60 and 30 percent she stops, sings a melody on the moon tiles round her
// pool, and the group steps on those tiles in that order before the verse ends.
// Answered, her voice breaks (a stun and a damage window); not answered,
// Discord rolls over the court. Driven through full Sim ticks in a real claimed
// Temple with a real party (tests/helpers/temple_fight.ts).

import { describe, expect, it } from 'vitest';
import { CHOIR_COURT, DROWNED_TEMPLE_FIELD } from '../src/sim/content/drowned_temple_layout';
import {
  MOON_TILE_MAX_PLACE,
  type MoonTileState,
  moonTileOf,
  moonTileSpots,
  moonTileTemplate,
  onMoonTile,
  SELTHE_BROKEN_VOICE,
  SELTHE_BROKEN_VOICE_EXPOSED,
  SELTHE_CHORUS_MARK,
  SELTHE_DISCORD,
  SELTHE_DROWNING_ARIA,
  SELTHE_FALSE_NOTE,
  SELTHE_ID,
  SELTHE_MERE_SURGE,
  SELTHE_SCORE,
  SELTHE_SCORE_ANSWER,
  SELTHE_SCORE_WARD,
  SELTHE_TILE_NOTE,
  SELTHE_TILE_SOUNDED,
  SELTHE_TUNING,
  SELTHE_VOICE_BREAKS,
  scoreAnswerSeconds,
  scoreMelodies,
  scoreMelody,
  scoreMelodySeconds,
  scoreNotesOf,
  TEMPLE_BOSS_CAST_SCHOOLS,
  TEMPLE_OBJECT_TEMPLATES,
} from '../src/sim/encounters/drowned_temple';
import { startAria } from '../src/sim/encounters/drowned_temple/selthe';
import { DT, type Entity, RUN_SPEED, type SeltheFightState } from '../src/sim/types';
import {
  aura,
  boss,
  engage,
  type Fight,
  fight,
  local,
  put,
  run,
  tick,
} from './helpers/temple_fight';

const T = SELTHE_TUNING;
const SPOT = { x: 0, z: 10 };

function state(b: Entity): SeltheFightState {
  const st = b.templeFight;
  if (st?.kind !== 'selthe') throw new Error('no selthe fight');
  return st;
}

/** A pulled Selthe with her timed kit held off, so a test reads the Score. */
function selthe(
  difficulty: 'normal' | 'heroic' = 'normal',
  extra = 2,
): { f: Fight; b: Entity; st: SeltheFightState } {
  const f = fight(difficulty, extra);
  const b = boss(f, SELTHE_ID);
  put(f, f.tank, SPOT.x, SPOT.z - 4);
  if (f.others[0]) put(f, f.others[0], -10, -6);
  if (f.others[1]) put(f, f.others[1], 10, -6);
  engage(f, b);
  run(f, 0.05);
  const st = state(b);
  hush(st);
  return { f, b, st };
}

function hush(st: SeltheFightState): void {
  st.chorusTimer = 999;
  st.soloTimer = 999;
  st.surgeTimer = 999;
  st.ariaTimer = 999;
}

/** Drop her to a health share and let the Score begin. */
function toShare(f: Fight, b: Entity, share: number): void {
  b.hp = Math.floor(b.maxHp * share);
  run(f, 0.1);
}

/** Tick until the answer opens. */
function sing(f: Fight, st: SeltheFightState): void {
  for (let i = 0; i < 400 && st.score?.phase === 'melody'; i++) tick(f);
  if (st.score?.phase !== 'answer') throw new Error('the answer never opened');
}

function tileObj(f: Fight, st: SeltheFightState, tile: number): Entity {
  return f.sim.ctx.entities.get(st.tiles[tile].objectId) as Entity;
}

function looks(f: Fight, st: SeltheFightState): { state: MoonTileState; place: number }[] {
  return st.tiles.map((_, i) => {
    const look = moonTileOf(tileObj(f, st, i).templateId);
    if (!look) throw new Error('not a tile');
    return { state: look.state, place: look.place };
  });
}

/** A spot off every tile (beside her pool). */
const OFF = { x: 3, z: 4 };

/** `p` walks off the tiles, then onto tile `tile`: one real step. */
function stepOn(f: Fight, st: SeltheFightState, p: Entity, tile: number): void {
  put(f, p, OFF.x, OFF.z);
  tick(f);
  put(f, p, st.tiles[tile].x, st.tiles[tile].z);
  tick(f);
}

/** A tile that is not part of the melody (five tiles, at most four notes). */
function spareTile(st: SeltheFightState): number {
  const order = st.score?.order ?? [];
  for (let i = 0; i < st.tiles.length; i++) if (!order.includes(i)) return i;
  throw new Error('no spare tile');
}

/** Every event of a tick, with the damage recorded as the harness does. */
function events(f: Fight): ReturnType<Fight['sim']['tick']> {
  for (const p of [f.tank, ...f.others]) if (p.hp < 1e5) p.hp = 1e6;
  const evs = f.sim.tick();
  for (const ev of evs)
    if (ev.type === 'damage')
      f.hits.push({
        targetId: ev.targetId,
        sourceId: ev.sourceId,
        amount: ev.amount,
        ability: ev.ability,
      });
  return evs;
}

function pathLength(spots: readonly { x: number; z: number }[], order: readonly number[]): number {
  let sum = 0;
  for (let i = 1; i < order.length; i++)
    sum += Math.hypot(
      spots[order[i]].x - spots[order[i - 1]].x,
      spots[order[i]].z - spots[order[i - 1]].z,
    );
  return sum;
}

describe('the moon tiles: an arc round the front of her pool', () => {
  const spots = moonTileSpots(SPOT.x, SPOT.z);

  it('stands five tiles on the open floor: inside the court, clear of her and the pillars', () => {
    expect(spots).toHaveLength(T.scoreTileCount);
    expect(T.scoreTileCount).toBe(5);
    for (const s of spots) {
      // On the court's floor with room to stand all round the tile.
      expect(Math.hypot(s.x - CHOIR_COURT.x, s.z - CHOIR_COURT.z)).toBeLessThan(
        CHOIR_COURT.r - T.scoreTileRadius - 2,
      );
      // The same distance from her, in front of her (never behind her body).
      expect(Math.hypot(s.x - SPOT.x, s.z - SPOT.z)).toBeCloseTo(T.scoreRingRadius, 6);
      expect(s.z).toBeLessThan(SPOT.z + 3);
      for (const prop of DROWNED_TEMPLE_FIELD.props ?? []) {
        const r = 'r' in prop && typeof prop.r === 'number' ? prop.r : 3;
        expect(Math.hypot(s.x - prop.x, s.z - prop.z)).toBeGreaterThan(
          T.scoreTileRadius + T.scoreTileLeave + r + 1,
        );
      }
    }
  });

  it('keeps the tiles apart: no straight run between two tiles crosses a third', () => {
    const reach = T.scoreTileRadius + T.scoreTileLeave;
    for (let a = 0; a < spots.length; a++)
      for (let b = a + 1; b < spots.length; b++) {
        expect(Math.hypot(spots[a].x - spots[b].x, spots[a].z - spots[b].z)).toBeGreaterThan(
          2 * reach + 2,
        );
        for (let c = 0; c < spots.length; c++) {
          if (c === a || c === b) continue;
          // Distance from tile c's centre to the segment a-b.
          const dx = spots[b].x - spots[a].x;
          const dz = spots[b].z - spots[a].z;
          const k = Math.max(
            0,
            Math.min(
              1,
              ((spots[c].x - spots[a].x) * dx + (spots[c].z - spots[a].z) * dz) /
                (dx * dx + dz * dz),
            ),
          );
          const d = Math.hypot(spots[a].x + dx * k - spots[c].x, spots[a].z + dz * k - spots[c].z);
          expect(d, `${a}-${b} past ${c}`).toBeGreaterThan(T.scoreTileRadius + 1);
        }
      }
  });

  it('a step is the way IN: the rim is wider on the way out', () => {
    const s = spots[2];
    expect(onMoonTile(s, s.x + T.scoreTileRadius - 0.01, s.z, false)).toBe(true);
    expect(onMoonTile(s, s.x + T.scoreTileRadius + 0.01, s.z, false)).toBe(false);
    // Already on it: still on it out to the leave rim.
    expect(onMoonTile(s, s.x + T.scoreTileRadius + T.scoreTileLeave - 0.01, s.z, true)).toBe(true);
    expect(onMoonTile(s, s.x + T.scoreTileRadius + T.scoreTileLeave + 0.01, s.z, true)).toBe(false);
  });

  it('a tile template carries its state and its place, and the renderer owns them all', () => {
    expect(moonTileOf(moonTileTemplate('dark'))).toEqual({ state: 'dark', place: 0 });
    expect(moonTileOf(moonTileTemplate('next', 3))).toEqual({ state: 'next', place: 3 });
    expect(moonTileOf(moonTileTemplate('done', MOON_TILE_MAX_PLACE))).toEqual({
      state: 'done',
      place: 4,
    });
    expect(moonTileOf('temple_chorus_echo')).toBeNull();
    expect(TEMPLE_OBJECT_TEMPLATES.has(moonTileTemplate('note', 1))).toBe(true);
    expect(TEMPLE_OBJECT_TEMPLATES.has(moonTileTemplate('sour'))).toBe(true);
    // The first literal the online client mirrors: a rename is a wire change.
    expect(moonTileTemplate('lit', 2)).toBe('temple_moon_tile_lit_2');
  });

  it('rises with the pull as five dormant tile objects, in tile order', () => {
    const { f, st } = selthe();
    expect(st.tiles).toHaveLength(5);
    st.tiles.forEach((tile, i) => {
      const obj = tileObj(f, st, i);
      expect(obj.templateId).toBe(moonTileTemplate('dark'));
      expect(obj.scale).toBe(T.scoreTileRadius);
      expect(local(f, obj).x).toBeCloseTo(spots[i].x, 4);
      expect(local(f, obj).z).toBeCloseTo(spots[i].z, 4);
      expect(tile.x).toBeCloseTo(spots[i].x, 4);
      expect(f.inst.objectIds).toContain(obj.id);
    });
  });
});

describe('the melody: hashed from a table, never rolled', () => {
  it('sings three notes then four, each a neighbour or one past it, one leap at most', () => {
    expect([...T.scoreNotes]).toEqual([3, 4]);
    expect([...T.scoreAt]).toEqual([0.6, 0.3]);
    for (const notes of T.scoreNotes) {
      const all = scoreMelodies(notes);
      // 26 melodies of three notes, 18 of four.
      expect(all.length).toBeGreaterThanOrEqual(18);
      const seen = new Set<string>();
      for (const m of all) {
        expect(m).toHaveLength(notes);
        expect(new Set(m).size).toBe(notes);
        let leaps = 0;
        for (let i = 1; i < m.length; i++) {
          const gap = Math.abs(m[i] - m[i - 1]);
          expect(gap).toBeGreaterThanOrEqual(1);
          expect(gap).toBeLessThanOrEqual(2);
          if (gap === 2) leaps++;
        }
        expect(leaps).toBeLessThanOrEqual(1);
        seen.add(m.join(','));
      }
      // No melody listed twice, and the table is not one shape: it starts on
      // every tile and runs both ways.
      expect(seen.size).toBe(all.length);
      expect(new Set(all.map((m) => m[0])).size).toBe(T.scoreTileCount);
      expect(all.some((m) => m[1] > m[0])).toBe(true);
      expect(all.some((m) => m[1] < m[0])).toBe(true);
    }
    expect(scoreMelodies(5)).toEqual([]);
  });

  it('picks by hash: the same hash gives the same melody, other hashes give others', () => {
    expect(scoreMelody(3, 12345)).toEqual(scoreMelody(3, 12345));
    const picks = new Set<string>();
    for (let h = 0; h < 200; h++) picks.add(scoreMelody(4, h * 2654435761).join(','));
    expect(picks.size).toBeGreaterThan(10);
    expect(scoreMelody(7, 1)).toEqual([]);
  });

  it('two fresh fights from the same seed sing the same two melodies', () => {
    const sung = (): number[][] => {
      const { f, b, st } = selthe();
      const out: number[][] = [];
      toShare(f, b, 0.59);
      out.push([...(st.score?.order ?? [])]);
      sing(f, st);
      f.sim.chat('/dev temple trigger scorewin', f.tank.id);
      for (const a of [SELTHE_BROKEN_VOICE, SELTHE_BROKEN_VOICE_EXPOSED])
        b.auras = b.auras.filter((x) => x.id !== a);
      toShare(f, b, 0.29);
      out.push([...(st.score?.order ?? [])]);
      return out;
    };
    const a = sung();
    expect(a[0]).toHaveLength(3);
    expect(a[1]).toHaveLength(4);
    expect(sung()).toEqual(a);
  }, 60_000);
});

describe('the Score begins at 60 and 30 percent', () => {
  it('at 60 percent she stops, wards herself and opens the melody bar: three tiles', () => {
    const { f, b, st } = selthe();
    toShare(f, b, 0.61);
    expect(st.score).toBeNull();
    expect(b.damageImmune).toBeFalsy();
    toShare(f, b, 0.6);
    expect(st.score?.phase).toBe('melody');
    expect(st.score?.order).toHaveLength(3);
    expect(b.castingAbility).toBe(SELTHE_SCORE);
    expect(b.castTotal).toBeCloseTo(scoreMelodySeconds(3), 6);
    expect(b.channeling).toBe(false);
    // Never kicked.
    expect(TEMPLE_BOSS_CAST_SCHOOLS[SELTHE_SCORE]).toBeUndefined();
    expect(TEMPLE_BOSS_CAST_SCHOOLS[SELTHE_SCORE_ANSWER]).toBeUndefined();
    const ward = aura(b, SELTHE_SCORE_WARD);
    expect(ward?.stacks).toBe(3);
    expect(ward?.value2).toBe(0);
    expect(b.damageImmune).toBe(true);
  });

  it('she takes no damage while the Score runs (the group is not paid to ignore it)', () => {
    const { f, b, st } = selthe();
    toShare(f, b, 0.59);
    const hp = b.hp;
    f.sim.ctx.dealDamage(f.tank, b, 5000, false, 'physical', 'Test Strike', 'hit', true);
    expect(b.hp).toBe(hp);
    sing(f, st);
    f.sim.ctx.dealDamage(f.tank, b, 5000, false, 'physical', 'Test Strike', 'hit', true);
    expect(b.hp).toBe(hp);
  });

  it('the second Score comes at 30 percent with four tiles, and there is no third', () => {
    const { f, b, st } = selthe();
    toShare(f, b, 0.59);
    expect(st.scores).toBe(1);
    sing(f, st);
    run(f, scoreAnswerSeconds(0) + 0.2);
    expect(st.score).toBeNull();
    // Still above 30 percent: nothing more is owed.
    run(f, 1);
    expect(st.score).toBeNull();
    expect(st.scoreQueued).toBe(false);
    toShare(f, b, 0.3);
    expect(st.score?.order).toHaveLength(4);
    expect(b.castTotal).toBeCloseTo(scoreMelodySeconds(4), 6);
    expect(aura(b, SELTHE_SCORE_WARD)?.stacks).toBe(4);
    sing(f, st);
    expect(b.castTotal).toBe(scoreAnswerSeconds(1));
    run(f, scoreAnswerSeconds(1) + 0.2);
    toShare(f, b, 0.05);
    run(f, 2);
    expect(st.score).toBeNull();
    expect(st.scores).toBe(2);
  });

  it('an owed Score waits for her bar and her marks to end, and she starts nothing new', () => {
    const { f, b, st } = selthe();
    // An aria in flight and a Chorus mark on a player as she crosses 60 percent.
    expect(startAria(f.sim.ctx, f.inst, b, st)).toBe(true);
    f.sim.chat('/dev temple trigger chorus', f.tank.id);
    expect(st.marks).toHaveLength(1);
    st.surgeTimer = 0.5;
    toShare(f, b, 0.59);
    expect(st.scoreQueued).toBe(true);
    expect(st.score).toBeNull();
    expect(b.castingAbility).toBe(SELTHE_DROWNING_ARIA);
    // The surge that came due is NOT started while the Score is owed.
    const seen = new Set<string>();
    let began = -1;
    for (let t = 0; t < 8 && !st.score; t += DT) {
      tick(f);
      if (b.castingAbility) seen.add(b.castingAbility);
      began = t;
    }
    expect(seen.has(SELTHE_MERE_SURGE)).toBe(false);
    expect(st.score?.phase).toBe('melody');
    // It began when the aria and the mark had both ended (about 5 s), no later.
    expect(began).toBeGreaterThan(T.markSeconds - 0.5);
    expect(began).toBeLessThan(T.ariaChannel + 0.5);
    expect(st.marks).toHaveLength(0);
    for (const p of [f.tank, ...f.others]) expect(aura(p, SELTHE_CHORUS_MARK)).toBeUndefined();
  });
});

describe('the melody is shown one tile after another', () => {
  it('the second heroic melody rings four notes 0.75 s apart, each visible for 0.6 s', () => {
    const { f, b, st } = selthe('heroic');
    st.scores = 1;
    toShare(f, b, 0.29);
    expect(b.castTotal).toBeCloseTo(4.5, 6);
    const rang: number[] = [];
    const visible = new Map<number, number>();
    let ticks = 0;
    while (st.score?.phase === 'melody') {
      for (const ev of events(f))
        if (ev.type === 'spellfx' && ev.ability === SELTHE_TILE_NOTE) rang.push(ticks);
      for (const look of looks(f, st))
        if (look.state === 'note') visible.set(look.place, (visible.get(look.place) ?? 0) + 1);
      ticks++;
    }
    expect(rang).toHaveLength(4);
    for (let i = 1; i < rang.length; i++) expect((rang[i] - rang[i - 1]) * DT).toBe(0.75);
    expect([...visible.values()]).toEqual([12, 12, 12, 12]);
    expect(b.castTotal).toBe(16);
  });

  it('waits for a pending heroic echo before starting either melody', () => {
    for (const index of [0, 1]) {
      const { f, b, st } = selthe('heroic');
      st.scores = index;
      f.sim.chat('/dev temple trigger chorus', f.tank.id);
      run(f, T.markSeconds + 0.1);
      expect(st.echoes.length).toBeGreaterThan(0);
      toShare(f, b, index === 0 ? 0.59 : 0.29);
      expect(st.scoreQueued).toBe(true);
      expect(st.score).toBeNull();
      run(f, T.echoAfter + 0.1);
      expect(st.echoes).toHaveLength(0);
      expect(st.score?.phase).toBe('melody');
      const from = f.hits.length;
      sing(f, st);
      expect(f.hits.slice(from).filter((h) => h.ability === 'Echo')).toHaveLength(0);
    }
  });

  it('rings each tile in its turn, 1.2 s apart, and on normal leaves its place lit', () => {
    const { f, b, st } = selthe();
    toShare(f, b, 0.59);
    const sc = st.score;
    if (!sc) throw new Error('no score');
    const order = [...sc.order];
    const rang: { tile: number; at: number }[] = [];
    let t = 0.1;
    const noteLooks: string[] = [];
    while (st.score?.phase === 'melody') {
      for (const ev of events(f)) {
        if (ev.type !== 'spellfx' || ev.ability !== SELTHE_TILE_NOTE) continue;
        rang.push({ tile: st.tiles.findIndex((x) => x.objectId === ev.targetId), at: t });
      }
      t += DT;
      noteLooks.push(
        looks(f, st)
          .map((l) => `${l.state}${l.place}`)
          .join(' '),
      );
    }
    // The tiles rang in the melody's order, one at a time.
    expect(rang.map((r) => r.tile)).toEqual(order);
    expect(rang[0].at).toBeCloseTo(T.scoreIntro, 1);
    for (let i = 1; i < rang.length; i++)
      expect(rang[i].at - rang[i - 1].at).toBeCloseTo(T.scoreNoteEvery, 1);
    // Never two tiles ringing at once.
    for (const row of noteLooks) expect(row.split('note').length - 1).toBeLessThanOrEqual(1);
    // By the melody's end every tile of it shows its place (normal).
    const end = looks(f, st);
    order.forEach((tile, i) => {
      // The answer just opened: the first is called out, the rest stay lit.
      expect(end[tile]).toEqual({ state: i === 0 ? 'next' : 'lit', place: i + 1 });
    });
    for (let i = 0; i < st.tiles.length; i++)
      if (!order.includes(i)) expect(end[i]).toEqual({ state: 'dark', place: 0 });
    // The verse's clock is her channel bar.
    expect(b.castingAbility).toBe(SELTHE_SCORE_ANSWER);
    expect(b.channeling).toBe(true);
    expect(b.castTotal).toBe(scoreAnswerSeconds(0));
  });

  it('a ringing tile wears the note state with its place while it rings', () => {
    const { f, b, st } = selthe();
    toShare(f, b, 0.59);
    const order = [...(st.score?.order ?? [])];
    run(f, T.scoreIntro + 0.2);
    expect(looks(f, st)[order[0]]).toEqual({ state: 'note', place: 1 });
    run(f, T.scoreNoteEvery);
    expect(looks(f, st)[order[1]]).toEqual({ state: 'note', place: 2 });
    expect(looks(f, st)[order[0]]).toEqual({ state: 'lit', place: 1 });
  });
});

describe('her clocks stand still through the Score', () => {
  it('no mark, bar or bolt of hers runs, and nobody is hurt, from the first note to the end', () => {
    const { f, b, st } = selthe();
    // Everything about to come due.
    st.chorusTimer = 0.3;
    st.soloTimer = 0.4;
    st.surgeTimer = 0.5;
    st.ariaTimer = 0.6;
    st.boltTimer = 0.2;
    b.hp = Math.floor(b.maxHp * 0.59);
    tick(f);
    expect(st.score?.phase).toBe('melody');
    const frozen = [st.chorusTimer, st.soloTimer, st.surgeTimer, st.ariaTimer];
    const from = f.hits.length;
    const bars = new Set<string>();
    while (st.score) {
      tick(f);
      if (b.castingAbility) bars.add(b.castingAbility);
      if (st.score)
        expect([st.chorusTimer, st.soloTimer, st.surgeTimer, st.ariaTimer]).toEqual(frozen);
      expect(st.marks).toHaveLength(0);
    }
    expect([...bars].sort()).toEqual([SELTHE_SCORE, SELTHE_SCORE_ANSWER].sort());
    // The verse ran out (nobody stepped): the only damage is Discord itself.
    const hurt = f.hits.slice(from).filter((h) => h.sourceId === b.id);
    expect(new Set(hurt.map((h) => h.ability))).toEqual(new Set(['Discord']));
    // Afterwards her clocks take a breath before they run again.
    for (const timer of [st.chorusTimer, st.soloTimer, st.surgeTimer, st.ariaTimer])
      expect(timer).toBeGreaterThanOrEqual(2);
    expect(st.boltTimer).toBe(T.boltEvery);
  });
});

describe('the answer: step ONTO the tiles in the order they rang', () => {
  function answering(difficulty: 'normal' | 'heroic' = 'normal') {
    const s = selthe(difficulty);
    toShare(s.f, s.b, 0.59);
    sing(s.f, s.st);
    const sc = s.st.score;
    if (!sc) throw new Error('no score');
    return { ...s, sc, order: [...sc.order] };
  }

  it('sounds each tile stepped in its turn, by any player, and calls the next one out', () => {
    const { f, st, sc, order } = answering();
    const steppers = [f.others[0], f.tank, f.others[1]];
    for (let i = 0; i < order.length - 1; i++) {
      const cuesBefore: number[] = [];
      put(f, steppers[i], OFF.x, OFF.z);
      tick(f);
      put(f, steppers[i], st.tiles[order[i]].x, st.tiles[order[i]].z);
      for (const ev of events(f))
        if (ev.type === 'spellfx' && ev.ability === SELTHE_TILE_SOUNDED)
          cuesBefore.push(ev.targetId);
      expect(cuesBefore).toEqual([st.tiles[order[i]].objectId]);
      expect(sc.progress).toBe(i + 1);
      const now = looks(f, st);
      expect(now[order[i]]).toEqual({ state: 'done', place: i + 1 });
      expect(now[order[i + 1]]).toEqual({ state: 'next', place: i + 2 });
    }
  });

  it('the last tile in time breaks her voice: stunned 4 s, 20 percent more damage for 10 s', () => {
    const { f, b, st, order } = answering();
    const broke: number[] = [];
    for (let i = 0; i < order.length; i++) {
      const runner = f.others[i % 2];
      put(f, runner, OFF.x, OFF.z);
      tick(f);
      put(f, runner, st.tiles[order[i]].x, st.tiles[order[i]].z);
      for (const ev of events(f))
        if (ev.type === 'spellfx' && ev.ability === SELTHE_VOICE_BREAKS) broke.push(ev.targetId);
    }
    expect(broke).toEqual([b.id]);
    expect(st.score).toBeNull();
    expect(b.castingAbility).toBeNull();
    expect(b.damageImmune).toBe(false);
    expect(aura(b, SELTHE_SCORE_WARD)).toBeUndefined();
    const stun = aura(b, SELTHE_BROKEN_VOICE);
    expect(stun?.kind).toBe('stun');
    expect(stun?.duration).toBe(4);
    expect(f.sim.ctx.isStunned(b)).toBe(true);
    const exposed = aura(b, SELTHE_BROKEN_VOICE_EXPOSED);
    expect(exposed?.kind).toBe('vulnerability');
    expect(exposed?.value).toBe(0.2);
    expect(exposed?.duration).toBe(10);
    // The sizes are Olen's Breached window.
    expect([T.brokenStun, T.brokenVulnSeconds, T.brokenVuln]).toEqual([4, 10, 0.2]);
    // The tiles go dormant again.
    for (const l of looks(f, st)) expect(l).toEqual({ state: 'dark', place: 0 });
    // She really takes a fifth more.
    const hp = b.hp;
    f.sim.ctx.dealDamage(f.tank, b, 1000, false, 'physical', 'Test Strike', 'hit', true);
    const taken = hp - b.hp;
    b.auras = b.auras.filter((a) => a.id !== SELTHE_BROKEN_VOICE_EXPOSED);
    const hp2 = b.hp;
    f.sim.ctx.dealDamage(f.tank, b, 1000, false, 'physical', 'Test Strike', 'hit', true);
    expect(taken).toBeCloseTo((hp2 - b.hp) * 1.2, -1);
  });

  it('while her voice is broken she is silent: no bolt, mark or bar for the 4 s', () => {
    const { f, b, st } = answering();
    f.sim.chat('/dev temple trigger scorewin', f.tank.id);
    // Her clocks took their breath as the Score closed.
    expect(st.chorusTimer).toBeGreaterThanOrEqual(2);
    st.chorusTimer = 0.2;
    st.surgeTimer = 0.2;
    st.boltTimer = 0.1;
    const from = f.hits.length;
    run(f, T.brokenStun - 0.2);
    expect(f.hits.slice(from).filter((h) => h.sourceId === b.id)).toHaveLength(0);
    expect(st.marks).toHaveLength(0);
    expect(b.castingAbility).toBeNull();
    // Frozen where they stood, not merely held off.
    expect([st.chorusTimer, st.surgeTimer, st.boltTimer]).toEqual([0.2, 0.2, 0.1]);
    // Then the fight goes on, still inside her window.
    run(f, 4);
    expect(aura(b, SELTHE_BROKEN_VOICE)).toBeUndefined();
    expect(aura(b, SELTHE_BROKEN_VOICE_EXPOSED)).toBeDefined();
    expect(st.marks.length + (b.castingAbility ? 1 : 0)).toBeGreaterThan(0);
  });

  it('standing on a tile is not a step: whoever was already on it must come in again', () => {
    const s = selthe();
    toShare(s.f, s.b, 0.59);
    const order = [...(s.st.score?.order ?? [])];
    // A player waits on the first tile all through the melody.
    const first = s.st.tiles[order[0]];
    while (s.st.score?.phase === 'melody') {
      put(s.f, s.f.others[0], first.x, first.z);
      tick(s.f);
    }
    const from = s.f.hits.length;
    run(s.f, 1, () => put(s.f, s.f.others[0], first.x, first.z));
    expect(s.st.score?.progress).toBe(0);
    expect(s.f.hits.slice(from).some((h) => h.ability === 'False Note')).toBe(false);
    // Off and on again: now it sounds.
    stepOn(s.f, s.st, s.f.others[0], order[0]);
    expect(s.st.score?.progress).toBe(1);
  });

  it('a body on the rim does not step it again and again', () => {
    const { f, st, sc } = answering();
    const spare = spareTile(st);
    const tile = st.tiles[spare];
    const from = f.hits.length;
    // In, then hovering just outside the tile's radius but inside its leave rim.
    put(f, f.others[1], tile.x, tile.z);
    tick(f);
    for (let i = 0; i < 20; i++) {
      const out = T.scoreTileRadius + (i % 2 === 0 ? 0.4 : -0.2);
      put(f, f.others[1], tile.x + out, tile.z);
      tick(f);
    }
    expect(f.hits.slice(from).filter((h) => h.ability === 'False Note')).toHaveLength(1);
    expect(sc.progress).toBe(0);
  });

  it('a wrong tile stings the stepper, sours the tile and sends the answer back to tile one', () => {
    const { f, b, st, sc, order } = answering();
    stepOn(f, st, f.others[0], order[0]);
    expect(sc.progress).toBe(1);
    const clock = sc.timer;
    // The third note's tile out of turn.
    const from = f.hits.length;
    put(f, f.others[1], OFF.x, OFF.z);
    tick(f);
    put(f, f.others[1], st.tiles[order[2]].x, st.tiles[order[2]].z);
    const soured: number[] = [];
    for (const ev of events(f))
      if (ev.type === 'spellfx' && ev.ability === SELTHE_FALSE_NOTE) soured.push(ev.targetId);
    expect(soured).toEqual([st.tiles[order[2]].objectId]);
    const stung = f.hits.slice(from).filter((h) => h.ability === 'False Note');
    expect(stung).toHaveLength(1);
    expect(stung[0].targetId).toBe(f.others[1].id);
    expect(stung[0].sourceId).toBe(b.id);
    expect(stung[0].amount).toBe(T.falseNoteDamage);
    expect(T.falseNoteDamage).toBe(40);
    // Back to the first tile; the clock ran on (two ticks), it did not reset.
    expect(sc.progress).toBe(0);
    expect(sc.timer).toBeCloseTo(clock - 2 * DT, 6);
    const now = looks(f, st);
    expect(now[order[2]]).toEqual({ state: 'sour', place: 0 });
    expect(now[order[0]]).toEqual({ state: 'next', place: 1 });
    // The sour look clears, and the tile shows its place again.
    put(f, f.others[1], OFF.x, OFF.z);
    run(f, T.scoreSourSeconds + 0.1);
    expect(looks(f, st)[order[2]]).toEqual({ state: 'lit', place: 3 });
    // The answer still works from the first tile.
    order.forEach((tile, i) => {
      stepOn(f, st, f.others[(i + 1) % 2], tile);
    });
    expect(aura(b, SELTHE_BROKEN_VOICE)).toBeDefined();
  });

  it('a tile that is not in the melody is wrong too; a tile already sounded is inert', () => {
    const { f, st, sc, order } = answering();
    stepOn(f, st, f.others[0], order[0]);
    stepOn(f, st, f.tank, order[1]);
    expect(sc.progress).toBe(2);
    // Back over the first tile: nothing happens.
    const from = f.hits.length;
    stepOn(f, st, f.others[1], order[0]);
    expect(sc.progress).toBe(2);
    expect(f.hits.slice(from).some((h) => h.ability === 'False Note')).toBe(false);
    // A tile outside the melody: a false note.
    stepOn(f, st, f.others[1], spareTile(st));
    expect(sc.progress).toBe(0);
    expect(f.hits.slice(from).filter((h) => h.ability === 'False Note')).toHaveLength(1);
  });

  it('two players stepping in the same tick are read in the kindest order', () => {
    const { f, st, sc, order } = answering();
    put(f, f.others[0], OFF.x, OFF.z);
    put(f, f.others[1], OFF.x, OFF.z + 1);
    tick(f);
    // The second note's stepper has the LOWER tile or id by chance or not: both land.
    put(f, f.others[0], st.tiles[order[1]].x, st.tiles[order[1]].z);
    put(f, f.others[1], st.tiles[order[0]].x, st.tiles[order[0]].z);
    const from = f.hits.length;
    tick(f);
    expect(sc.progress).toBe(2);
    expect(f.hits.slice(from).some((h) => h.ability === 'False Note')).toBe(false);
  });

  it.each(['normal', 'heroic'] as const)(
    'covering all five tiles cannot solve either %s melody',
    (difficulty) => {
      for (const index of [0, 1]) {
        const { f, b, st } = selthe(difficulty, 4);
        const players = [f.tank, ...f.others];
        for (const p of players) put(f, p, OFF.x, OFF.z);
        st.scores = index;
        toShare(f, b, index === 0 ? 0.59 : 0.29);
        sing(f, st);
        const from = f.hits.length;
        players.forEach((p, i) => {
          put(f, p, st.tiles[i].x, st.tiles[i].z);
        });
        tick(f);
        expect(st.score?.progress).toBe(0);
        expect(aura(b, SELTHE_BROKEN_VOICE)).toBeUndefined();
        expect(f.hits.slice(from).filter((h) => h.ability === 'False Note')).toHaveLength(
          index === 0 ? 2 : 1,
        );
        expect(b.damageImmune).toBe(true);
      }
    },
  );

  it('a wrong final-tick step resets once without punishing duplicate correct steps', () => {
    const { f, b, st } = selthe('normal', 4);
    toShare(f, b, 0.59);
    sing(f, st);
    const order = [...(st.score?.order ?? [])];
    for (const p of [f.tank, ...f.others]) put(f, p, OFF.x, OFF.z);
    tick(f);
    stepOn(f, st, f.tank, order[0]);
    const tiles = [order[1], order[2], spareTile(st), order[1]];
    const from = f.hits.length;
    f.others.forEach((p, i) => {
      put(f, p, st.tiles[tiles[i]].x, st.tiles[tiles[i]].z);
    });
    tick(f);
    expect(st.score?.progress).toBe(0);
    expect(aura(b, SELTHE_BROKEN_VOICE)).toBeUndefined();
    expect(
      f.hits
        .slice(from)
        .filter((h) => h.ability === 'False Note')
        .map((h) => h.targetId),
    ).toEqual([f.others[2].id]);
    order.forEach((tile, i) => {
      stepOn(f, st, i % 2 ? f.others[0] : f.tank, tile);
    });
    expect(aura(b, SELTHE_BROKEN_VOICE)).toBeDefined();
  });
});

describe('the verse runs out: Discord', () => {
  it('hits everyone in the court for 150 to 170 frost, opens no window, and names its cue', () => {
    const { f, b, st } = selthe();
    toShare(f, b, 0.59);
    sing(f, st);
    const from = f.hits.length;
    const discord: number[] = [];
    for (let t = 0; t < scoreAnswerSeconds(0) + 0.2; t += DT)
      for (const ev of events(f))
        if (ev.type === 'spellfx' && ev.ability === SELTHE_DISCORD) discord.push(ev.targetId);
    expect(discord).toEqual([b.id]);
    const hits = f.hits.slice(from).filter((h) => h.ability === 'Discord');
    expect(hits.map((h) => h.targetId).sort()).toEqual(
      [f.tank, ...f.others].map((p) => p.id).sort(),
    );
    for (const h of hits) {
      expect(h.amount).toBeGreaterThanOrEqual(T.discordMin);
      expect(h.amount).toBeLessThanOrEqual(T.discordMax);
    }
    expect([T.discordMin, T.discordMax]).toEqual([150, 170]);
    expect(aura(b, SELTHE_BROKEN_VOICE)).toBeUndefined();
    expect(aura(b, SELTHE_BROKEN_VOICE_EXPOSED)).toBeUndefined();
    expect(aura(b, SELTHE_SCORE_WARD)).toBeUndefined();
    expect(b.damageImmune).toBe(false);
    expect(f.sim.ctx.isStunned(b)).toBe(false);
    for (const l of looks(f, st)) expect(l).toEqual({ state: 'dark', place: 0 });
  });

  it('is paid for by the retired Sea-Song, and on normal it hurts without wiping', () => {
    // Nine Sea-Songs of 40 over her planned 90 s: 360 frost a player.
    const seaSong = 9 * 40;
    const discord = (T.discordMin + T.discordMax) / 2;
    expect(2 * discord + T.falseNoteDamage).toBe(seaSong);
    // Beside a Solo, well under a lone Chorus.
    expect(T.discordMax).toBeLessThanOrEqual(T.soloDamage + 20);
    expect(T.discordMax).toBeLessThan(T.chorusTotal / 2);
    // A real level-16 cloth wearer with NO gear at all (the floor of what a
    // group brings) keeps most of a health bar through it.
    const f = fight('normal', 0, false);
    const pid = f.sim.addPlayer('mage', 'Clothwader');
    f.sim.chat('/dev level 16', pid);
    const cloth = f.sim.ctx.entities.get(pid) as Entity;
    expect(cloth.level).toBe(16);
    expect(T.discordMax).toBeLessThan(cloth.maxHp * 0.6);
  });

  it('a player outside the court is not hit', () => {
    const { f, b, st } = selthe();
    toShare(f, b, 0.59);
    sing(f, st);
    const from = f.hits.length;
    run(f, scoreAnswerSeconds(0) + 0.2, () => put(f, f.others[1], 0, -80));
    const hit = f.hits.slice(from).filter((h) => h.ability === 'Discord');
    expect(hit.map((h) => h.targetId)).not.toContain(f.others[1].id);
    expect(hit.length).toBe(2);
  });
});

describe('heroic: the tiles go dark and the group must remember', () => {
  it('shows each tile only while it rings, hides the whole answer, and still marks what is sounded', () => {
    const { f, b, st } = selthe('heroic');
    toShare(f, b, 0.59);
    const sc = st.score;
    if (!sc) throw new Error('no score');
    expect(sc.hidden).toBe(true);
    expect(aura(b, SELTHE_SCORE_WARD)?.value2).toBe(1);
    const order = [...sc.order];
    const seen = new Set<string>();
    while (st.score?.phase === 'melody') {
      tick(f);
      for (const l of looks(f, st)) seen.add(l.state);
    }
    // Only the ringing note was ever shown.
    expect([...seen].sort()).toEqual(['dark', 'note']);
    for (const l of looks(f, st)) expect(l).toEqual({ state: 'dark', place: 0 });
    // The first right step shows as sounded; the rest stay dark.
    stepOn(f, st, f.others[0], order[0]);
    const now = looks(f, st);
    expect(now[order[0]]).toEqual({ state: 'done', place: 1 });
    for (let i = 0; i < now.length; i++)
      if (i !== order[0]) expect(now[i]).toEqual({ state: 'dark', place: 0 });
    // A wrong step still sours and resets, and stings at the heroic factor.
    const from = f.hits.length;
    stepOn(f, st, f.others[1], spareTile(st));
    expect(sc.progress).toBe(0);
    const sting = f.hits.slice(from).find((h) => h.ability === 'False Note');
    expect(sting?.amount).toBe(Math.round(T.falseNoteDamage * (b.mechanicDamageMult ?? 1)));
    expect(b.mechanicDamageMult).toBeGreaterThan(1);
    // The same melody rule and the same clock as normal.
    expect(order).toHaveLength(3);
    expect(b.castTotal).toBe(scoreAnswerSeconds(0));
  });

  it('heroic Discord rides the mechanic factor like her other mechanics', () => {
    const { f, b, st } = selthe('heroic');
    toShare(f, b, 0.59);
    sing(f, st);
    const from = f.hits.length;
    run(f, scoreAnswerSeconds(0) + 0.2);
    const mult = b.mechanicDamageMult ?? 1;
    const hits = f.hits.slice(from).filter((h) => h.ability === 'Discord');
    expect(hits).toHaveLength(3);
    for (const h of hits) {
      expect(h.amount).toBeGreaterThanOrEqual(Math.round(T.discordMin * mult) - 1);
      expect(h.amount).toBeLessThanOrEqual(Math.round(T.discordMax * mult) + 1);
    }
  });
});

describe('the reach proof: one player can answer alone, a small group easily', () => {
  const spots = moonTileSpots(SPOT.x, SPOT.z);

  /** The farthest a court player can stand from a tile. */
  function worstApproach(tile: number): number {
    return CHOIR_COURT.r + Math.hypot(spots[tile].x - CHOIR_COURT.x, spots[tile].z - CHOIR_COURT.z);
  }

  it('by arithmetic: every melody, run alone from the worst spot in the court, with a quarter to spare', () => {
    T.scoreNotes.forEach((notes, index) => {
      let worst = 0;
      for (const m of scoreMelodies(notes))
        worst = Math.max(worst, worstApproach(m[0]) + pathLength(spots, m));
      const seconds = worst / RUN_SPEED;
      expect(seconds * 1.25, `score ${index}`).toBeLessThanOrEqual(scoreAnswerSeconds(index));
      expect(scoreNotesOf(index)).toBe(notes);
    });
    // The numbers written beside the tuning.
    const leg = (a: number, b: number) =>
      Math.hypot(spots[a].x - spots[b].x, spots[a].z - spots[b].z);
    expect(leg(0, 1)).toBeCloseTo(11.0, 1);
    expect(leg(0, 2)).toBeCloseTo(19.9, 1);
    expect(worstApproach(0)).toBeCloseTo(43.7, 1);
    expect(RUN_SPEED).toBe(7);
    expect([...T.scoreAnswer]).toEqual([14, 16]);
  });

  /** A player walks at run speed toward a spot, through the real colliders. */
  function walk(f: Fight, p: Entity, to: { x: number; z: number }): number {
    const at = local(f, p);
    const dx = to.x - at.x;
    const dz = to.z - at.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) return 0;
    const step = Math.min(d, RUN_SPEED * DT);
    const want = { x: f.ox + at.x + (dx / d) * step, z: f.oz + at.z + (dz / d) * step };
    const got = f.sim.ctx.resolvePlayerMove(p.pos.x, p.pos.z, want.x, want.z, 0.5, p);
    put(f, p, got.x - f.ox, got.z - f.oz);
    return d - step;
  }

  /** Answer a running Score with `runners`, sharing the tiles round robin:
   *  each waits a step outside its tile and walks in when its turn comes.
   *  Returns the seconds the answer took, or -1 when the verse ran out. */
  function answer(f: Fight, b: Entity, st: SeltheFightState, runners: Entity[]): number {
    const sc = st.score;
    if (sc?.phase !== 'answer') throw new Error('not answering');
    const order = [...sc.order];
    const start = sc.timer;
    for (let guard = 0; guard < 2000 && st.score; guard++) {
      const now = st.score.progress;
      runners.forEach((p, j) => {
        // This runner's next tile: the first of its own notes still to sound.
        let mine = -1;
        for (let k = now; k < order.length; k++)
          if (k % runners.length === j) {
            mine = k;
            break;
          }
        if (mine < 0) return;
        const tile = spots[order[mine]];
        if (mine === now) {
          walk(f, p, tile);
          return;
        }
        // Not its turn yet: wait just outside the tile, on her side of the arc.
        const out = T.scoreTileRadius + T.scoreTileLeave + 1;
        const k = out / Math.hypot(SPOT.x - tile.x, SPOT.z - tile.z);
        walk(f, p, { x: tile.x + (SPOT.x - tile.x) * k, z: tile.z + (SPOT.z - tile.z) * k });
      });
      tick(f);
    }
    return aura(b, SELTHE_BROKEN_VOICE) ? start - (sc.timer - 0) : -1;
  }

  /** The court spot farthest from tile `tile` (the far rim). */
  function farFrom(tile: number): { x: number; z: number } {
    const dx = CHOIR_COURT.x - spots[tile].x;
    const dz = CHOIR_COURT.z - spots[tile].z;
    const d = Math.hypot(dx, dz);
    const r = CHOIR_COURT.r - 1;
    return { x: CHOIR_COURT.x + (dx / d) * r, z: CHOIR_COURT.z + (dz / d) * r };
  }

  it('in the sim: a lone player starting on the far rim answers both Scores at run speed', () => {
    const f = fight('normal', 0);
    const b = boss(f, SELTHE_ID);
    put(f, f.tank, SPOT.x, SPOT.z - 4);
    engage(f, b);
    run(f, 0.05);
    const st = state(b);
    hush(st);
    const used: number[] = [];
    for (const share of [0.59, 0.29]) {
      b.auras = b.auras.filter(
        (a) => a.id !== SELTHE_BROKEN_VOICE && a.id !== SELTHE_BROKEN_VOICE_EXPOSED,
      );
      toShare(f, b, share);
      const first = st.score?.order[0] ?? 0;
      // The worst case: the whole melody spent standing on the far rim.
      const far = farFrom(first);
      while (st.score?.phase === 'melody') {
        put(f, f.tank, far.x, far.z);
        tick(f);
      }
      const took = answer(f, b, st, [f.tank]);
      expect(took, `score at ${share}`).toBeGreaterThan(0);
      used.push(took);
    }
    // Inside each clock with room to spare.
    expect(used[0]).toBeLessThan(scoreAnswerSeconds(0) * 0.85);
    expect(used[1]).toBeLessThan(scoreAnswerSeconds(1) * 0.85);
  }, 60_000);

  it('in the sim: two and three players sharing the tiles finish far sooner', () => {
    for (const extra of [1, 2]) {
      const f = fight('normal', extra);
      const b = boss(f, SELTHE_ID);
      put(f, f.tank, SPOT.x, SPOT.z - 4);
      for (const [i, p] of f.others.entries()) put(f, p, i === 0 ? -10 : 10, -6);
      engage(f, b);
      run(f, 0.05);
      const st = state(b);
      hush(st);
      // The second Score (four tiles), as if the first were already sung.
      st.scores = 1;
      toShare(f, b, 0.29);
      expect(st.score?.order).toHaveLength(4);
      sing(f, st);
      const took = answer(f, b, st, [f.tank, ...f.others]);
      expect(took, `${extra + 1} players`).toBeGreaterThan(0);
      expect(took).toBeLessThan(scoreAnswerSeconds(1) * 0.6);
    }
  }, 60_000);
});

describe('a wipe or an evade resets the whole Score', () => {
  function wipe(f: Fight, b: Entity): void {
    for (const p of [f.tank, ...f.others]) put(f, p, 0, -230);
    b.inCombat = false;
    b.aggroTargetId = null;
    b.aiState = 'evade';
  }

  it('mid-melody and mid-answer: the tiles sink, the ward and the bar go, and the next pull starts clean', () => {
    for (const when of ['melody', 'answer'] as const) {
      const { f, b, st } = selthe();
      toShare(f, b, 0.59);
      if (when === 'answer') sing(f, st);
      const tileIds = st.tiles.map((x) => x.objectId);
      wipe(f, b);
      run(f, 0.1);
      expect(b.templeFight, when).toBeUndefined();
      expect(b.castingAbility).toBeNull();
      expect(b.damageImmune).toBe(false);
      expect(aura(b, SELTHE_SCORE_WARD)).toBeUndefined();
      for (const id of tileIds) {
        expect(f.sim.ctx.entities.has(id)).toBe(false);
        expect(f.inst.objectIds).not.toContain(id);
      }
      // Pulled again: the tiles rise anew and the first Score is owed again.
      put(f, f.tank, SPOT.x, SPOT.z - 4);
      b.aiState = 'idle';
      engage(f, b);
      run(f, 0.1);
      const again = state(b);
      hush(again);
      expect(again.tiles).toHaveLength(5);
      expect(again.scores).toBe(0);
      toShare(f, b, 0.59);
      expect(again.score?.order).toHaveLength(3);
    }
  }, 60_000);

  it('a wipe inside her broken-voice window clears the window too', () => {
    const { f, b, st } = selthe();
    toShare(f, b, 0.59);
    f.sim.chat('/dev temple trigger scorewin', f.tank.id);
    expect(aura(b, SELTHE_BROKEN_VOICE_EXPOSED)).toBeDefined();
    expect(st.score).toBeNull();
    wipe(f, b);
    run(f, 0.1);
    expect(aura(b, SELTHE_BROKEN_VOICE)).toBeUndefined();
    expect(aura(b, SELTHE_BROKEN_VOICE_EXPOSED)).toBeUndefined();
  });

  it('her death drops the tiles', () => {
    const { f, b, st } = selthe();
    const tileIds = st.tiles.map((x) => x.objectId);
    f.sim.ctx.handleDeath(b, f.tank);
    run(f, 0.2);
    for (const id of tileIds) expect(f.sim.ctx.entities.has(id)).toBe(false);
  });
});

describe('the Score dev triggers', () => {
  it('score and score2 start the first and the second Score from their melodies', () => {
    const { f, b, st } = selthe();
    f.sim.chat('/dev temple trigger score', f.tank.id);
    expect(st.score?.order).toHaveLength(3);
    expect(b.castingAbility).toBe(SELTHE_SCORE);
    f.sim.chat('/dev temple trigger score2', f.tank.id);
    expect(st.score?.order).toHaveLength(4);
    expect(st.score?.phase).toBe('melody');
    expect(b.castTotal).toBeCloseTo(scoreMelodySeconds(4), 6);
    // A mark trigger is refused while the Score runs.
    f.sim.chat('/dev temple trigger chorus', f.tank.id);
    expect(st.marks).toHaveLength(0);
  });

  it('scorewin breaks her voice and scorefail brings Discord, with or without a Score running', () => {
    const win = selthe();
    win.f.sim.chat('/dev temple trigger scorewin', win.f.tank.id);
    expect(aura(win.b, SELTHE_BROKEN_VOICE)).toBeDefined();
    expect(win.st.score).toBeNull();
    expect(win.st.scores).toBe(1);
    // Again at once: the window is cleared and the second Score is answered.
    win.f.sim.chat('/dev temple trigger scorewin', win.f.tank.id);
    expect(win.st.scores).toBe(2);
    expect(aura(win.b, SELTHE_BROKEN_VOICE_EXPOSED)?.remaining).toBeCloseTo(10, 1);

    const fail = selthe();
    fail.f.sim.chat('/dev temple trigger score', fail.f.tank.id);
    const from = fail.f.hits.length;
    fail.f.sim.chat('/dev temple trigger scorefail', fail.f.tank.id);
    for (const ev of fail.f.sim.drainEvents())
      if (ev.type === 'damage')
        fail.f.hits.push({
          targetId: ev.targetId,
          sourceId: ev.sourceId,
          amount: ev.amount,
          ability: ev.ability,
        });
    expect(fail.f.hits.slice(from).filter((h) => h.ability === 'Discord')).toHaveLength(3);
    expect(aura(fail.b, SELTHE_BROKEN_VOICE)).toBeUndefined();
    expect(fail.st.score).toBeNull();
  }, 60_000);
});
