// Arena seasons: the shared calendar, the authored season roster, and the sim's
// host-award grant lane.
//
// The calendar is the load-bearing piece: the server settles a season and the
// client renders its countdown off the SAME functions, so a boundary that
// disagrees between them would award a title in one window and display another.
// Every boundary here is pinned as a literal UTC instant rather than recomputed
// from the module's own constants, which is what makes the pins able to fail.
import { describe, expect, it } from 'vitest';
import {
  ARENA_PRESEASON,
  ARENA_SEASON_BRACKETS,
  ARENA_SEASON_EPOCH_MS,
  ARENA_SEASON_LENGTH_MONTHS,
  arenaSeasonEndMs,
  arenaSeasonIndexAt,
  arenaSeasonStartMs,
  arenaSeasonWindowAt,
  isArenaSeasonIndex,
  lastClosedArenaSeasonAt,
} from '../src/sim/arena_season';
import {
  ARENA_SEASON_COUNT,
  ARENA_SEASON_DEED_IDS,
  ARENA_SEASONS,
  arenaSeasonDef,
  arenaSeasonForDeedId,
} from '../src/sim/content/arena_seasons';
import { DEEDS } from '../src/sim/content/deeds';
import { grantArenaSeasonTitlesForDeeds, setActiveTitle } from '../src/sim/deeds';
import { type PlayerMeta, Sim } from '../src/sim/sim';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function makeSim(): Sim {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false, noPlayer: true });
}

function addChar(sim: Sim, name: string, opts?: { arenaSeasonTitles?: readonly string[] }) {
  const pid = sim.addPlayer('warrior', name, opts);
  return { pid, meta: sim.players.get(pid) as PlayerMeta, e: sim.entities.get(pid)! };
}

describe('the season calendar', () => {
  it('opens Season 1 at the pinned epoch and runs six calendar months', () => {
    expect(ARENA_SEASON_LENGTH_MONTHS).toBe(6);
    // The epoch is a maintainer knob, so it is pinned as an instant here: moving
    // it re-points every persisted season number and must be a conscious edit.
    expect(ARENA_SEASON_EPOCH_MS).toBe(Date.UTC(2026, 7, 1));
    expect(arenaSeasonStartMs(1)).toBe(Date.UTC(2026, 7, 1));
    expect(arenaSeasonEndMs(1)).toBe(Date.UTC(2027, 1, 1));
    expect(arenaSeasonStartMs(2)).toBe(Date.UTC(2027, 1, 1));
    // Calendar months, not a fixed millisecond stride: season 2 spans a
    // 28-day February and season 1 spans a 31-day August, so equal-length
    // arithmetic would drift the later boundaries off the first of the month.
    expect(arenaSeasonEndMs(2)).toBe(Date.UTC(2027, 7, 1));
    expect(arenaSeasonStartMs(ARENA_SEASON_COUNT)).toBe(Date.UTC(2031, 1, 1));
    expect(arenaSeasonEndMs(ARENA_SEASON_COUNT)).toBe(Date.UTC(2031, 7, 1));
  });

  it('a season closes exactly where the next one opens (no instant scored twice)', () => {
    const boundary = Date.UTC(2027, 1, 1);
    expect(arenaSeasonIndexAt(boundary - 1)).toBe(1);
    expect(arenaSeasonIndexAt(boundary)).toBe(2);
    expect(arenaSeasonEndMs(1)).toBe(arenaSeasonStartMs(2));
  });

  it('reports Preseason before the epoch and Season 1 from the epoch instant on', () => {
    expect(arenaSeasonIndexAt(ARENA_SEASON_EPOCH_MS - 1)).toBe(ARENA_PRESEASON);
    expect(arenaSeasonIndexAt(Date.UTC(2020, 0, 1))).toBe(ARENA_PRESEASON);
    expect(arenaSeasonIndexAt(ARENA_SEASON_EPOCH_MS)).toBe(1);
    expect(arenaSeasonIndexAt(ARENA_SEASON_EPOCH_MS + DAY)).toBe(1);
    // A non-finite clock reads as Preseason rather than NaN-indexing a season.
    expect(arenaSeasonIndexAt(Number.NaN)).toBe(ARENA_PRESEASON);
  });

  it('keeps counting past the authored roster (content, not the clock, runs out)', () => {
    const pastTheEnd = arenaSeasonStartMs(ARENA_SEASON_COUNT + 1);
    expect(arenaSeasonIndexAt(pastTheEnd)).toBe(ARENA_SEASON_COUNT + 1);
    expect(arenaSeasonDef(ARENA_SEASON_COUNT + 1)).toBeNull();
  });

  it('lastClosedArenaSeasonAt names the newest settleable season, and none before one closes', () => {
    expect(lastClosedArenaSeasonAt(ARENA_SEASON_EPOCH_MS)).toBe(0);
    expect(lastClosedArenaSeasonAt(arenaSeasonEndMs(1) - 1)).toBe(0);
    expect(lastClosedArenaSeasonAt(arenaSeasonEndMs(1))).toBe(1);
    expect(lastClosedArenaSeasonAt(arenaSeasonEndMs(3) + DAY)).toBe(3);
  });

  it('isArenaSeasonIndex accepts only whole seasons from 1 up', () => {
    expect(isArenaSeasonIndex(1)).toBe(true);
    expect(isArenaSeasonIndex(ARENA_PRESEASON)).toBe(false);
    expect(isArenaSeasonIndex(-3)).toBe(false);
    expect(isArenaSeasonIndex(1.5)).toBe(false);
    expect(isArenaSeasonIndex(Number.NaN)).toBe(false);
  });

  it('the window carries a clamped countdown and progress for the live season', () => {
    const start = arenaSeasonStartMs(2);
    const end = arenaSeasonEndMs(2);
    const atStart = arenaSeasonWindowAt(start);
    expect(atStart.index).toBe(2);
    expect(atStart.preseason).toBe(false);
    expect(atStart.remainingMs).toBe(end - start);
    expect(atStart.elapsedFrac).toBe(0);

    const nearEnd = arenaSeasonWindowAt(end - HOUR);
    expect(nearEnd.index).toBe(2);
    expect(nearEnd.remainingMs).toBe(HOUR);
    expect(nearEnd.elapsedFrac).toBeGreaterThan(0.99);
    expect(nearEnd.elapsedFrac).toBeLessThan(1);
  });

  it('the Preseason window counts down to the epoch instead of a negative span', () => {
    const w = arenaSeasonWindowAt(ARENA_SEASON_EPOCH_MS - 3 * DAY);
    expect(w.preseason).toBe(true);
    expect(w.index).toBe(ARENA_PRESEASON);
    expect(w.remainingMs).toBe(3 * DAY);
    expect(w.elapsedFrac).toBe(0);
  });

  it('settles only the two ranked brackets', () => {
    // Fiesta and Protect Yumi are unranked play (endArenaMatch never moves their
    // Elo), so they must never appear as a settleable bracket.
    expect([...ARENA_SEASON_BRACKETS]).toEqual(['1v1', '2v2']);
  });
});

describe('the authored season roster', () => {
  it('plans ten seasons with unique, non-repeating titles', () => {
    expect(ARENA_SEASON_COUNT).toBe(10);
    expect(ARENA_SEASONS.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(ARENA_SEASONS[0].title).toBe('Warmaster');
    const titles = ARENA_SEASONS.map((s) => s.title);
    expect(new Set(titles).size).toBe(ARENA_SEASON_COUNT);
    expect(new Set(ARENA_SEASONS.map((s) => s.deedId)).size).toBe(ARENA_SEASON_COUNT);
    // Every later season is an epithet ON the inaugural title, which is what
    // makes the line read as one lineage rather than ten unrelated names.
    for (const s of ARENA_SEASONS) expect(s.title.endsWith('Warmaster')).toBe(true);
  });

  it('every season resolves to a zero-Renown feat whose title reward matches', () => {
    for (const season of ARENA_SEASONS) {
      const def = DEEDS[season.deedId];
      expect(def, season.deedId).toBeDefined();
      expect(def.category, season.deedId).toBe('feat');
      // Seasonal content is permanently missable once its window closes, which
      // docs/design/deeds.md rule 5 answers with a Feat, and rule 2 with 0 Renown.
      expect(def.feat, season.deedId).toBe(true);
      expect(def.renown, season.deedId).toBe(0);
      // `manual` because no per-character predicate can decide a realm-wide rank.
      expect(def.trigger, season.deedId).toEqual({ kind: 'manual' });
      expect(def.reward, season.deedId).toEqual({ kind: 'title', text: season.title });
      expect(def.desc, season.deedId).toContain(`Season ${season.index}`);
    }
  });

  it('indexes lookups both ways and refuses anything outside the roster', () => {
    expect(arenaSeasonDef(3)?.title).toBe('Malevolent Warmaster');
    expect(arenaSeasonDef(0)).toBeNull();
    expect(arenaSeasonDef(11)).toBeNull();
    expect(arenaSeasonForDeedId('feat_arena_season_3_malevolent')?.index).toBe(3);
    expect(arenaSeasonForDeedId('prog_veteran')).toBeNull();
    expect(ARENA_SEASON_DEED_IDS.size).toBe(ARENA_SEASON_COUNT);
    expect(ARENA_SEASON_DEED_IDS.has('feat_arena_season_1_warmaster')).toBe(true);
    expect(ARENA_SEASON_DEED_IDS.has('prog_veteran')).toBe(false);
  });
});

describe('the host award lane', () => {
  const SEASON_1 = 'feat_arena_season_1_warmaster';
  const SEASON_2 = 'feat_arena_season_2_glorious';

  it('grants the awarded season feats at join and makes the title selectable', () => {
    const sim = makeSim();
    const { meta, e } = addChar(sim, 'Champ', { arenaSeasonTitles: [SEASON_1] });
    expect(meta.deedsEarned.has(SEASON_1)).toBe(true);
    // Zero-Renown by design: winning a season must never move the Renown board.
    expect(meta.renown).toBe(0);
    // The whole point of the award: the title is now selectable and rides the
    // entity wire the nameplate/chat/target-frame read.
    setActiveTitle(meta, e, SEASON_1);
    expect(meta.activeTitle).toBe(SEASON_1);
    expect(e.title).toBe(SEASON_1);
  });

  it('is idempotent, so the server may re-pass the same awards on every login', () => {
    const sim = makeSim();
    const { meta } = addChar(sim, 'Champ', { arenaSeasonTitles: [SEASON_1] });
    const earnedAfterJoin = meta.deedsEarned.size;
    const earnDay = meta.deedsEarned.get(SEASON_1);
    // A replay grants nothing AND does not restamp the original earn day, which
    // is what the Renown board's completion-time tie-break reads.
    expect(grantArenaSeasonTitlesForDeeds(sim.ctx, meta, [SEASON_1, SEASON_1])).toBe(0);
    expect(meta.deedsEarned.size).toBe(earnedAfterJoin);
    expect(meta.deedsEarned.get(SEASON_1)).toBe(earnDay);
    // A SECOND season, however, still lands through the same call.
    expect(grantArenaSeasonTitlesForDeeds(sim.ctx, meta, [SEASON_2])).toBe(1);
    expect(meta.deedsEarned.size).toBe(earnedAfterJoin + 1);
  });

  it('accepts only roster ids, so a bad host row cannot mint an arbitrary deed', () => {
    const sim = makeSim();
    const { meta, e } = addChar(sim, 'Cheat', {
      arenaSeasonTitles: ['prog_veteran', 'dgn_nythraxis_deathless', 'not_a_deed'],
    });
    expect(meta.deedsEarned.has('prog_veteran')).toBe(false);
    expect(meta.deedsEarned.has('dgn_nythraxis_deathless')).toBe(false);
    expect(meta.deedsEarned.has('not_a_deed')).toBe(false);
    // And the rejected id cannot be worn either (the title validator is the
    // second gate: it refuses any deed the character has not earned).
    setActiveTitle(meta, e, 'prog_veteran');
    expect(meta.activeTitle).toBeNull();
  });

  it('grants a player who is already in the world (the settlement-at-the-boundary path)', () => {
    const sim = makeSim();
    const { pid, meta, e } = addChar(sim, 'Champ');
    expect(meta.deedsEarned.has(SEASON_1)).toBe(false);
    expect(sim.grantArenaSeasonTitles(pid, [SEASON_1])).toBe(1);
    expect(meta.deedsEarned.has(SEASON_1)).toBe(true);
    setActiveTitle(meta, e, SEASON_1);
    expect(e.title).toBe(SEASON_1);
    // Same two gates as the join lane: idempotent, and roster-only.
    expect(sim.grantArenaSeasonTitles(pid, [SEASON_1])).toBe(0);
    expect(sim.grantArenaSeasonTitles(pid, ['prog_veteran'])).toBe(0);
    expect(meta.deedsEarned.has('prog_veteran')).toBe(false);
    // An unknown pid is a silent no-op, never a throw into the caller's loop.
    expect(sim.grantArenaSeasonTitles(9999, [SEASON_2])).toBe(0);
  });

  it('grants nothing when the host passes no awards (the offline / unranked case)', () => {
    const sim = makeSim();
    const { meta } = addChar(sim, 'Nobody');
    for (const deedId of ARENA_SEASON_DEED_IDS) {
      expect(meta.deedsEarned.has(deedId), deedId).toBe(false);
    }
    expect(grantArenaSeasonTitlesForDeeds(sim.ctx, meta, undefined)).toBe(0);
    expect(grantArenaSeasonTitlesForDeeds(sim.ctx, meta, [])).toBe(0);
  });

  it('survives a save and reload with the title still worn', () => {
    const sim = makeSim();
    const { pid, meta, e } = addChar(sim, 'Champ', { arenaSeasonTitles: [SEASON_1] });
    setActiveTitle(meta, e, SEASON_1);
    const state = sim.serializeCharacter(pid);
    // Reload on a fresh world WITHOUT re-passing the award: the earned set rides
    // the character blob, so the title must not depend on the host repeating it.
    const next = makeSim();
    const reloadedPid = next.addPlayer('warrior', 'Champ', { state: state ?? undefined });
    const reloaded = next.players.get(reloadedPid) as PlayerMeta;
    expect(reloaded.deedsEarned.has(SEASON_1)).toBe(true);
    expect(reloaded.activeTitle).toBe(SEASON_1);
    expect(next.entities.get(reloadedPid)?.title).toBe(SEASON_1);
  });
});
