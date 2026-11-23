// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { TALENTS } from '../src/sim/content/talents';
import {
  boardApplicantHtml,
  boardListingHtml,
  boardMemberHtml,
  premadeBoardHtml,
} from '../src/ui/dungeon_board_chrome';
import type { FinderBoardPanelView, FinderListingRowView } from '../src/ui/dungeon_finder_view';
import { tTalent } from '../src/ui/talent_i18n';

const listing: FinderListingRowView = {
  id: 7,
  activityId: 'hollow_crypt_normal',
  dungeonId: 'hollow_crypt',
  difficulty: 'normal',
  kind: 'dungeon',
  leaderName: '<img src=x onerror=alert(1)>',
  tags: ['learning'],
  size: 2,
  capacity: 5,
  needed: { tank: 0, healer: 1, dps: 2 },
  members: [
    { cls: 'warrior', level: 20, role: 'tank' },
    { cls: 'priest', level: 20, role: null },
  ],
  mine: false,
  applied: false,
  canApply: true,
  applicationRole: 'dps',
  blocked: null,
  guildLocked: false,
};

function markup(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('premade board chrome', () => {
  it('masks another player note before escaping its HTML', () => {
    const root = markup(
      boardListingHtml(
        {
          ...listing,
          details: { purpose: 'clear', note: '<img src=x onerror=alert(1)> forbidden' },
        },
        (note) => note.replace('forbidden', '***'),
      ),
    );
    expect(root.querySelector('.expedition-note')?.textContent).toBe(
      '<img src=x onerror=alert(1)> ***',
    );
    expect(root.querySelector('.expedition-note img, [onerror]')).toBeNull();
  });
  it.each(['future_class', '__proto__', 'constructor'])(
    'renders unknown class %s with the shared fallback color',
    (value) => {
      const cls = value as import('../src/sim/types').PlayerClass;
      expect(() => boardMemberHtml({ pid: 42, name: 'Visitor', cls, level: 8 })).not.toThrow();
      expect(() =>
        boardApplicantHtml({ pid: 42, name: 'Visitor', cls, level: 8, roles: [], remaining: 30 }),
      ).not.toThrow();
      for (const html of [
        boardMemberHtml({ pid: 42, name: 'Visitor', cls, level: 8 }),
        boardApplicantHtml({ pid: 42, name: 'Visitor', cls, level: 8, roles: [], remaining: 30 }),
      ]) {
        expect(markup(html).firstElementChild?.getAttribute('style')).toBe('--class-color:#5fa8ff');
      }
    },
  );
  it('renders admitted members with canonical spec, class and actual role without applicant actions', () => {
    const spec = TALENTS.priest.specs.find((entry) => entry.role === 'dps')!;
    const root = markup(
      boardMemberHtml({
        pid: 9,
        name: '<b>Vesper</b>',
        cls: 'priest',
        level: 20,
        role: 'dps',
        spec: spec.id,
      }),
    );
    expect(root.querySelector('.df-app-name')?.textContent).toBe('<b>Vesper</b>');
    expect(root.querySelector('b')).toBeNull();
    expect(root.querySelector('.df-app-spec')?.textContent).toBe(
      tTalent({ kind: 'talentSpec', spec, field: 'name' }),
    );
    expect(root.querySelector('[data-combat-role="dps"]')).not.toBeNull();
    expect(root.querySelector('button')).toBeNull();
    expect(
      markup(boardMemberHtml({ pid: 9, name: 'Vesper', cls: 'priest', level: 20 })).querySelector(
        '[data-combat-role]',
      ),
    ).toBeNull();
  });
  it('shows the exact authored spec independently of the offered roles', () => {
    const spec = TALENTS.priest.specs.find((entry) => entry.role === 'dps')!;
    const root = markup(
      boardApplicantHtml({
        pid: 9,
        name: 'Vesper',
        cls: 'priest',
        level: 20,
        spec: spec.id,
        roles: ['healer', 'dps'],
      }),
    );
    expect(root.querySelector('.df-app-spec')?.textContent).toBe(
      tTalent({ kind: 'talentSpec', spec, field: 'name' }),
    );
    expect(root.querySelectorAll('.df-app-roles [data-combat-role]')).toHaveLength(2);
    expect(root.querySelector('.df-app-class')?.textContent).toContain('Priest');
    const unknown = markup(
      boardApplicantHtml({
        pid: 9,
        name: 'Vesper',
        cls: 'priest',
        level: 20,
        spec: '<script>fake</script>',
        roles: ['dps'],
      }),
    );
    expect(unknown.querySelector('script')).toBeNull();
    expect(unknown.querySelector('.df-app-spec')?.textContent).toBe('');
  });
  it('shows the real roster and only authoritative vacant roles without assuming a priest heals', () => {
    const root = markup(boardListingHtml(listing));
    const seats = root.querySelectorAll<HTMLElement>('.df-roster-seat');
    expect([...seats].map((seat) => seat.dataset.seatRole)).toEqual([
      'tank',
      'any',
      'healer',
      'dps',
      'dps',
    ]);
    expect(root.querySelectorAll('.is-empty')).toHaveLength(3);
    expect(root.querySelector('.df-listing-leader')?.textContent).toContain(listing.leaderName);
    expect(root.querySelector('[onerror]')).toBeNull();
    expect(root.querySelector('[data-role]')).toBeNull();
    expect(root.querySelector<HTMLButtonElement>('[data-apply="7"]')?.disabled).toBe(false);
  });

  it('preserves application eligibility, withdrawal and own-listing actions', () => {
    const blocked = markup(boardListingHtml({ ...listing, canApply: false }));
    expect(blocked.querySelector<HTMLButtonElement>('[data-apply]')?.disabled).toBe(true);
    const applied = markup(boardListingHtml({ ...listing, applied: true }));
    expect(applied.querySelector('[data-withdraw="7"][data-act="withdraw"]')).not.toBeNull();
    expect(applied.querySelector('[data-apply]')).toBeNull();
    expect(markup(boardListingHtml({ ...listing, mine: true })).querySelector('button')).toBeNull();
  });

  it('keeps applicant identity and both named actions safe with multiple selected roles', () => {
    const name = 'Anna <script>alert(1)</script> "';
    const root = markup(
      boardApplicantHtml({ pid: 8, name, cls: 'paladin', level: 20, roles: ['tank', 'healer'] }),
    );
    expect(root.querySelector('.df-app-name')?.textContent).toBe(name);
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('[data-appacc="8"]')?.getAttribute('aria-label')).toContain(name);
    expect(root.querySelector('[data-appdec="8"]')?.getAttribute('aria-label')).toContain(name);
    expect(root.querySelectorAll('.df-role-chip')).toHaveLength(2);
    expect(root.querySelector('[data-role]')).toBeNull();
  });

  it('keeps the leader inbox above open listings and uses a neutral seat for unrestricted roles', () => {
    const board: FinderBoardPanelView = {
      listings: [listing],
      myListing: { id: 7, activityId: listing.activityId, tags: [], applicants: [] },
      myApplicationListingId: null,
      canCreate: false,
      createGate: 'exists',
      createOptions: [],
      tags: [],
      guild: '',
      advert: null,
      partyMembers: [],
      difficultyOptions: [],
    };
    const root = markup(premadeBoardHtml(board, '<button data-act="create"></button>'));
    expect(root.querySelector('.df-board-own .df-applicants')).not.toBeNull();
    expect(root.querySelector('.df-board-hero img')?.getAttribute('src')).toBe(
      '/textures/loading/hollow-crypt-empty.webp',
    );
    expect(root.querySelector('.df-board-listings .df-listing')).not.toBeNull();
    expect(root.querySelector('[data-act="closelisting"]')).not.toBeNull();
    expect(root.querySelector('[data-act="create"]')).toBeNull();
    const neutral = markup(boardListingHtml({ ...listing, needed: null }));
    expect(
      [...neutral.querySelectorAll<HTMLElement>('.is-empty')].map((seat) => seat.dataset.seatRole),
    ).toEqual(['any', 'any', 'any']);
  });
});
