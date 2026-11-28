// The Adventure Journal's personal layer (src/ui/hud/journal/journal_progress_view.ts
// and journal_progress_html.ts): kills per difficulty read off IWorld.bossKills,
// and the lockout read off IWorld.raidLockouts with the sim's own lockout ids and
// boundaries. The rooms each instance locks, the counts a council page reads,
// the saved summary and the list's Defeated all come from here.
import { beforeEach, describe, expect, it } from 'vitest';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { SMITH_HEART_DUNGEON } from '../src/sim/content/smith_heart';
import {
  COUNCIL_GUARDIAN,
  COUNCIL_SEAM_SINGER,
} from '../src/sim/encounters/smith_heart/council_ids';
import { IGNIVAR_RAID_ARENA_ID } from '../src/sim/ignivar_raid_ids';
import {
  type JournalInstance,
  journalInstance,
  journalPageBodies,
} from '../src/ui/hud/journal/journal_catalog';
import { buildJournalNav } from '../src/ui/hud/journal/journal_nav_view';
import { progressHtml, savedChipHtml } from '../src/ui/hud/journal/journal_progress_html';
import {
  journalLockoutId,
  journalLockRooms,
  journalPageKills,
  journalPageProgress,
  journalSavedPages,
} from '../src/ui/hud/journal/journal_progress_view';
import { setLanguage } from '../src/ui/i18n';
import { NYTHRAXIS_BOSS_ARENA_ID } from '../src/ui/raid_boss_guide_view';

const NOW = Date.UTC(2026, 10, 27, 12, 0, 0);
const DAY = 86_400_000;

function instance(id: string): JournalInstance {
  const found = journalInstance(id);
  if (!found) throw new Error(id);
  return found;
}

const crucible = () => instance(IGNIVAR_RAID_ARENA_ID);
const nythraxis = () => instance(NYTHRAXIS_BOSS_ARENA_ID);
const heart = () => instance(SMITH_HEART_DUNGEON);
const crypt = () => instance('hollow_crypt');

function councilKey(): string {
  const source = heart().source;
  const key = source.bossKeys.find((k) => journalPageBodies(source, k).length > 1);
  if (!key) throw new Error('no council page');
  return key;
}

beforeEach(() => setLanguage('en'));

describe('journal progress: the rooms the sim locks', () => {
  it('reads the Crucible as two weekly rooms, one per boss page', () => {
    const rooms = journalLockRooms(crucible());
    expect(rooms.map((r) => r.room).sort()).toEqual([
      'ignivar_inner_crucible',
      'ignivar_raid_arena',
    ]);
    expect(rooms.every((r) => r.boundary === 'weekly')).toBe(true);
    for (const room of rooms) {
      const bodies = journalPageBodies(crucible().source, room.bossKey);
      expect(bodies).toContain(HEROIC_DUNGEON_TUNING[room.room].finalBossId);
    }
    expect(new Set(rooms.map((r) => r.bossKey)).size).toBe(2);
  });

  it('reads Nythraxis as one daily room and a dungeon as its final boss page', () => {
    expect(journalLockRooms(nythraxis())).toEqual([
      { room: NYTHRAXIS_BOSS_ARENA_ID, bossKey: 'nythraxis', boundary: 'daily' },
    ]);
    const cryptRooms = journalLockRooms(crypt());
    expect(cryptRooms).toHaveLength(1);
    expect(cryptRooms[0].boundary).toBe('daily');
    expect(journalPageBodies(crypt().source, cryptRooms[0].bossKey)).toContain(
      HEROIC_DUNGEON_TUNING.hollow_crypt.finalBossId,
    );
  });

  it('reads the Smith Heart as five weekly boss locks, one per page, the council as one', () => {
    const rooms = journalLockRooms(heart());
    expect(rooms.map((r) => r.room)).toEqual([
      `smith_heart:${COUNCIL_GUARDIAN}`,
      'smith_heart:heart_breath_guardian',
      'smith_heart:heart_quench_guardian',
      'smith_heart:heart_heat_guardian',
      'smith_heart:heart_masterless_strength',
    ]);
    expect(rooms.map((r) => r.bossKey)).toEqual([...heart().source.bossKeys]);
    expect(rooms[0].bossKey).toBe(councilKey());
    expect(rooms.every((r) => r.boundary === 'weekly')).toBe(true);
  });

  it('uses the sim lockout ids: raid rooms on both tiers, dungeons on Heroic only', () => {
    expect(journalLockoutId('ignivar_raid_arena', 'normal')).toBe('ignivar_raid_arena');
    expect(journalLockoutId('ignivar_raid_arena', 'heroic')).toBe('ignivar_raid_arena:heroic');
    expect(journalLockoutId('hollow_crypt', 'normal')).toBeNull();
    expect(journalLockoutId('hollow_crypt', 'heroic')).toBe('hollow_crypt:heroic');
    expect(journalLockoutId('ignivar_raid_arena', 'mythic')).toBeNull();
    // A per-boss raid's boss locks on both tiers, apart; Mythic is not run yet.
    const council = `smith_heart:${COUNCIL_GUARDIAN}`;
    expect(journalLockoutId(council, 'normal')).toBe(council);
    expect(journalLockoutId(council, 'heroic')).toBe(`${council}:heroic`);
    expect(journalLockoutId(council, 'mythic')).toBeNull();
  });
});

describe('journal progress: kills', () => {
  it('reads a council page under the member the tally keys it on', () => {
    const tally = { [COUNCIL_GUARDIAN]: 4, [`${COUNCIL_GUARDIAN}:heroic`]: 1 };
    expect(journalPageKills(heart(), councilKey(), 'normal', tally)).toBe(4);
    expect(journalPageKills(heart(), councilKey(), 'heroic', tally)).toBe(1);
    expect(journalPageKills(heart(), councilKey(), 'mythic', tally)).toBe(0);
    // A council page reads the highest of its bodies' counts, whichever member
    // the tally keyed the kills under.
    expect(journalPageKills(heart(), councilKey(), 'normal', { [COUNCIL_SEAM_SINGER]: 2 })).toBe(2);
  });

  it('lists a cell per tier the instance offers, Mythic as coming soon', () => {
    const progress = journalPageProgress(
      heart(),
      councilKey(),
      'heroic',
      { [COUNCIL_GUARDIAN]: 12, [`${COUNCIL_GUARDIAN}:heroic`]: 3 },
      [],
      NOW,
    );
    expect(progress.kills).toEqual([
      { tier: 'normal', count: 12, selected: false },
      { tier: 'heroic', count: 3, selected: true },
      { tier: 'mythic', count: null, selected: false },
    ]);
    expect(progress.lockout).toBeNull();
    expect(progress.pageSaved).toBeNull();
    // An instance without Mythic shows two cells.
    expect(
      journalPageProgress(crypt(), crypt().source.bossKeys[0], 'normal', {}, [], NOW).kills,
    ).toHaveLength(2);
  });
});

describe('journal progress: lockouts', () => {
  it('summarizes the saved rooms of the tier being read, the page and the reset', () => {
    const rooms = journalLockRooms(crucible());
    const arena = rooms.find((r) => r.room === 'ignivar_raid_arena');
    const inner = rooms.find((r) => r.room === 'ignivar_inner_crucible');
    if (!arena || !inner) throw new Error('rooms');
    const lockouts = [
      { id: 'ignivar_raid_arena:heroic', msRemaining: 2 * DAY },
      { id: 'hollow_crypt:heroic', msRemaining: DAY },
    ];
    const onArena = journalPageProgress(crucible(), arena.bossKey, 'heroic', {}, lockouts, NOW);
    expect(onArena.lockout).toEqual({
      saved: 1,
      total: 2,
      boundary: 'weekly',
      msRemaining: 2 * DAY,
      resetAtMs: NOW + 2 * DAY,
    });
    expect(onArena.pageSaved).toBe('weekly');
    // The other boss of the same instance is not saved itself.
    expect(
      journalPageProgress(crucible(), inner.bossKey, 'heroic', {}, lockouts, NOW).pageSaved,
    ).toBeNull();
    // Normal is a separate lock: nothing saved there.
    const normal = journalPageProgress(crucible(), arena.bossKey, 'normal', {}, lockouts, NOW);
    expect(normal.lockout).toBeNull();
    expect(normal.pageSaved).toBeNull();
    // An expired row never counts.
    expect(
      journalPageProgress(
        crucible(),
        arena.bossKey,
        'heroic',
        {},
        [{ id: 'ignivar_raid_arena:heroic', msRemaining: 0 }],
        NOW,
      ).lockout,
    ).toBeNull();
  });

  it('reads the Smith Heart per boss: N of 5 saved, the page itself, each tier apart', () => {
    const council = `smith_heart:${COUNCIL_GUARDIAN}`;
    const lockouts = [
      { id: council, msRemaining: 3 * DAY },
      { id: 'smith_heart:heart_breath_guardian', msRemaining: 3 * DAY },
      { id: 'smith_heart:heart_heat_guardian', msRemaining: 3 * DAY },
      { id: 'smith_heart:heart_quench_guardian:heroic', msRemaining: 3 * DAY },
      { id: 'ignivar_raid_arena', msRemaining: DAY },
    ];
    const onCouncil = journalPageProgress(heart(), councilKey(), 'normal', {}, lockouts, NOW);
    expect(onCouncil.lockout).toEqual({
      saved: 3,
      total: 5,
      boundary: 'weekly',
      msRemaining: 3 * DAY,
      resetAtMs: NOW + 3 * DAY,
    });
    expect(onCouncil.pageSaved).toBe('weekly');
    const finalKey = heart().source.bossKeys[4];
    expect(
      journalPageProgress(heart(), finalKey, 'normal', {}, lockouts, NOW).pageSaved,
    ).toBeNull();
    // Heroic is its own lock: only the Quench is saved there.
    const heroic = journalPageProgress(heart(), councilKey(), 'heroic', {}, lockouts, NOW);
    expect(heroic.lockout?.saved).toBe(1);
    expect(heroic.pageSaved).toBeNull();
    expect([...journalSavedPages(heart(), 'normal', lockouts)]).toEqual([
      heart().source.bossKeys[0],
      heart().source.bossKeys[1],
      heart().source.bossKeys[3],
    ]);
    expect([...journalSavedPages(heart(), 'heroic', lockouts)]).toEqual([
      heart().source.bossKeys[2],
    ]);
    // The list marks the three saved pages Defeated.
    const saved = new Map([[SMITH_HEART_DUNGEON, journalSavedPages(heart(), 'normal', lockouts)]]);
    const nav = buildJournalNav([heart()], null, new Set(), null, null, saved);
    expect(nav[0].instances[0].bosses.map((b) => b.defeated)).toEqual([
      true,
      true,
      false,
      true,
      false,
    ]);
    expect(nav[0].instances[0].defeatedCount).toBe(3);
    // The header line reads the five.
    expect(progressHtml(onCouncil)).toContain('Saved on Normal: 3 of 5 bosses');
    expect(savedChipHtml(onCouncil.pageSaved)).toContain('Defeated this week');
  });

  it('marks the saved pages Defeated in the list, on the tier being read only', () => {
    const lockouts = [{ id: `${NYTHRAXIS_BOSS_ARENA_ID}`, msRemaining: DAY }];
    expect([...journalSavedPages(nythraxis(), 'normal', lockouts)]).toEqual(['nythraxis']);
    expect(journalSavedPages(nythraxis(), 'heroic', lockouts).size).toBe(0);
    const saved = new Map([
      [NYTHRAXIS_BOSS_ARENA_ID, journalSavedPages(nythraxis(), 'normal', lockouts)],
    ]);
    const nav = buildJournalNav([nythraxis()], null, new Set(), null, null, saved);
    expect(nav[0].instances[0].bosses[0].defeated).toBe(true);
    expect(nav[0].instances[0].defeatedCount).toBe(1);
    expect(
      buildJournalNav([nythraxis()], null, new Set(), null, null)[0].instances[0].bosses[0]
        .defeated,
    ).toBe(false);
  });
});

describe('journal progress: markup', () => {
  it('prints the counts, the selected tier, Mythic coming soon and the lockout line', () => {
    const html = progressHtml({
      kills: [
        { tier: 'normal', count: 1234, selected: false },
        { tier: 'heroic', count: 0, selected: true },
        { tier: 'mythic', count: null, selected: false },
      ],
      lockout: {
        saved: 1,
        total: 2,
        boundary: 'weekly',
        msRemaining: 2 * DAY + 4 * 3_600_000,
        resetAtMs: NOW + 2 * DAY,
      },
      pageSaved: 'weekly',
    });
    expect(html).toContain('Your kills');
    expect(html).toContain('aria-label="Your progress on this boss"');
    expect(html).toContain('<span class="visually-hidden">Normal kills: 1,234</span>');
    expect(html).not.toContain('title=');
    expect(html).toContain('<b class="aj-kill-count" aria-hidden="true">1,234</b>');
    expect(html).toMatch(/class="aj-kill selected none"/);
    expect(html).toContain('Coming soon');
    expect(html).toContain('Saved on Heroic: 1 of 2 bosses');
    expect(html).toContain('Resets in 2d 4h, ');
    expect(html).not.toMatch(/[–—]/);
  });

  it('says Saved on its own for a one-room instance and nothing when not saved', () => {
    const base = {
      kills: [{ tier: 'heroic' as const, count: 2, selected: true }],
      pageSaved: null,
    };
    const one = progressHtml({
      ...base,
      lockout: { saved: 1, total: 1, boundary: 'daily', msRemaining: 3_600_000, resetAtMs: NOW },
    });
    expect(one).toContain('Saved on Heroic<');
    expect(one).not.toContain(' of ');
    expect(progressHtml({ ...base, lockout: null })).not.toContain('aj-lockout');
  });

  it('labels the saved chip by the room boundary', () => {
    expect(savedChipHtml('weekly')).toContain('Defeated this week');
    expect(savedChipHtml('daily')).toContain('Defeated today');
    expect(savedChipHtml(null)).toBe('');
  });
});
