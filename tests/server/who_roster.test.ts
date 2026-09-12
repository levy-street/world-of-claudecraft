import { describe, expect, it } from 'vitest';
import {
  buildWhoRosterEntries,
  canShowInWho,
  filterWhoRows,
  normalizeWhoFilter,
  WHO_CHAT_LIMIT,
  WHO_FILTER_MAX,
  WHO_TAB_LIMIT,
  type WhoRosterRow,
  whoChatLines,
  whoFrame,
} from '../../server/who_roster';

// The /who roster's pure core (server/who_roster.ts): the visibility rule, the
// sanitizer, the filter, the two caps, and both projections. game.ts is a thin
// consumer; every rule a player can observe is pinned here without a GameServer.

function row(name: string, over: Partial<WhoRosterRow> = {}): WhoRosterRow {
  return { name, cls: 'warrior', level: 10, zone: 'Ashwood', status: 'online', guild: '', ...over };
}

function session(characterId: number, blocked: number[] = [], loaded = true) {
  return { characterId, blockListLoaded: loaded, blockedIds: new Set(blocked) };
}

describe('canShowInWho', () => {
  it('fails closed while the candidate block list is still loading', () => {
    expect(canShowInWho(session(1), session(2, [], false))).toBe(false);
  });
  it('hides a candidate the viewer blocked, and one who blocked the viewer', () => {
    expect(canShowInWho(session(1, [2]), session(2))).toBe(false);
    expect(canShowInWho(session(1), session(2, [1]))).toBe(false);
  });
  it('shows an unrelated player, and the viewer themselves', () => {
    expect(canShowInWho(session(1), session(2))).toBe(true);
    expect(canShowInWho(session(1, [2]), session(1, [2]))).toBe(true);
  });
});

describe('normalizeWhoFilter', () => {
  it('strips control chars and quotes, collapses whitespace, caps the length', () => {
    expect(normalizeWhoFilter('  Thornpeak   "Heights"  ')).toBe('Thornpeak Heights');
    expect(normalizeWhoFilter('Thorn\u0007peak')).toBe('Thornpeak');
    expect(normalizeWhoFilter('x'.repeat(80))).toHaveLength(WHO_FILTER_MAX);
    // The literal the client input's maxlength mirrors (src/ui/social_window.ts).
    expect(WHO_FILTER_MAX).toBe(32);
  });
  it('treats a non-string (a malformed frame field) as no filter', () => {
    expect(normalizeWhoFilter(undefined)).toBe('');
    expect(normalizeWhoFilter(42)).toBe('');
  });
});

describe('filterWhoRows', () => {
  const rows = [
    row('Aleron', { zone: 'Thornpeak Heights' }),
    row('Bryn', { guild: 'Moonwardens' }),
    row('Mira', { zone: 'Ashwood' }),
  ];
  it('matches a case-insensitive substring of the name, the zone, OR the guild', () => {
    expect(filterWhoRows(rows, 'ALE').map((r) => r.name)).toEqual(['Aleron']);
    expect(filterWhoRows(rows, 'peak').map((r) => r.name)).toEqual(['Aleron']);
    expect(filterWhoRows(rows, 'moonw').map((r) => r.name)).toEqual(['Bryn']);
  });
  it('returns the input itself for the empty filter (callers only read)', () => {
    expect(filterWhoRows(rows, '')).toBe(rows);
  });
});

describe('whoFrame (the Who tab projection)', () => {
  it('caps at WHO_TAB_LIMIT rows while reporting the uncapped total and echoing the filter', () => {
    const rows = Array.from({ length: WHO_TAB_LIMIT + 25 }, (_, i) =>
      row(`P${String(i).padStart(3, '0')}`),
    );
    const frame = whoFrame(rows, '');
    expect(frame.t).toBe('who');
    expect(frame.rows).toHaveLength(WHO_TAB_LIMIT);
    expect(frame.total).toBe(WHO_TAB_LIMIT + 25);
    expect(frame.limit).toBe(WHO_TAB_LIMIT);
    expect(whoFrame(rows, 'p00').filter).toBe('p00');
    // The cap is a wire contract, pinned to its literal (the constant-self-comparison trap).
    expect(WHO_TAB_LIMIT).toBe(200);
  });
  it('carries the guild on every row and never a position', () => {
    const frame = whoFrame([row('Bryn', { guild: 'Moonwardens' })], '');
    expect(frame.rows[0]).toEqual({
      name: 'Bryn',
      cls: 'warrior',
      level: 10,
      zone: 'Ashwood',
      status: 'online',
      guild: 'Moonwardens',
    });
  });
  it('raises the tab cap well past the classic chat dump', () => {
    expect(WHO_TAB_LIMIT).toBeGreaterThan(WHO_CHAT_LIMIT);
    expect(WHO_CHAT_LIMIT).toBe(50);
  });
});

describe('whoChatLines (the legacy chat projection, byte-identical to before)', () => {
  it('prints the header, one row per player, and the overflow line past WHO_CHAT_LIMIT', () => {
    const rows = Array.from({ length: WHO_CHAT_LIMIT + 3 }, (_, i) =>
      row(`P${String(i).padStart(3, '0')}`, { status: i === 0 ? 'combat' : 'online' }),
    );
    const lines = whoChatLines(rows, '', 'Ashenvale');
    expect(lines[0].text).toBe(`Who: ${WHO_CHAT_LIMIT + 3} players online on Ashenvale.`);
    expect(lines[1].text).toBe('P000 - level 10 warrior - Ashwood (combat)');
    expect(lines[2].text).toBe('P001 - level 10 warrior - Ashwood');
    expect(lines).toHaveLength(WHO_CHAT_LIMIT + 2);
    expect(lines[lines.length - 1].text).toBe('...and 3 more.');
    expect(lines.every((l) => l.type === 'log')).toBe(true);
    // The chat palette moved out of game.ts unchanged.
    expect(lines[0].color).toBe('#7fd4ff');
    expect(lines[1].color).toBe('#c9b27a');
    expect(lines[lines.length - 1].color).toBe('#998d6a');
  });
  it('quotes the filter in the singular header', () => {
    const lines = whoChatLines([row('Aleron')], 'ale', 'Ashenvale');
    expect(lines[0].text).toBe('Who: 1 player matching "ale" on Ashenvale.');
  });
});

describe('buildWhoRosterEntries (the per-tick memo build)', () => {
  it('describes each session once, skips the undescribable, and orders by name', () => {
    const a = session(1);
    const b = session(2);
    const c = session(3);
    const seen: number[] = [];
    const entries = buildWhoRosterEntries([a, b, c], (s) => {
      seen.push(s.characterId);
      if (s.characterId === 2) return null;
      return row(s.characterId === 1 ? 'Mira' : 'Aleron');
    });
    expect(seen).toEqual([1, 2, 3]);
    expect(entries.map((e) => e.row.name)).toEqual(['Aleron', 'Mira']);
    // the entry keeps the SAME session object (the visibility rule reads it live)
    expect(entries[1].session).toBe(a);
  });
});
