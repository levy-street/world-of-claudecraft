// Tests for the Vale Cup window pure core (vale_cup_window_view.ts):
//  - the offline-vs-live discriminator (the online-only-shape trap),
//  - bracket/nation/role resolution + commit while queued or matched,
//  - the queue affordance ladder (in-match / deserter / queued / idle + blocks),
//  - the live-match panel and winners board derivation,
//  - render-skip signature stability and text-independence,
//  - same-shape parity: a Sim-shaped stub (extra junk fields the core must
//    ignore) and a ClientWorld-mirror-shaped stub with the same logical data
//    render an identical view (tests/arena_window_view.test.ts pattern).
//
// DOM-free / i18n-free, so this Node suite drives the core directly; the DOM
// painter (vale_cup_window.ts) is covered by its source guard
// (tests/vale_cup_ui_guard.test.ts).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SportRole, VcBracket } from '../src/sim/types';
import {
  buildVcupView,
  VC_BRACKETS,
  type VcupView,
  type VcupViewInput,
} from '../src/ui/vale_cup_window_view';
import type { CupInfo, PartyInfo } from '../src/world_api';

const QUEUE_SIZES: Record<VcBracket, number> = { 1: 2, 2: 0, 3: 5, 4: 0, 5: 1 };

/** A CupInfo snapshot. `shape: 'sim'` carries extra junk fields the core must ignore. */
function makeCupInfo(shape: 'sim' | 'client', over: Partial<CupInfo> = {}): CupInfo {
  const junk = shape === 'sim' ? { _tick: 421, _dirtyQueue: true } : {};
  return {
    standing: { wins: 3, losses: 1, draws: 2 },
    queued: false,
    bracket: null,
    nation: null,
    role: null,
    position: 0,
    queueSizes: structuredClone(QUEUE_SIZES),
    deserterFor: 0,
    match: null,
    live: null,
    board: [
      { name: 'Hobb', wins: 9 },
      { name: 'Mera', wins: 4 },
    ],
    guildBoard: [{ name: 'Wheat Kings', wins: 5, losses: 2 }],
    myGuild: null,
    guildStanding: { wins: 0, losses: 0 },
    practicing: [],
    ...junk,
    ...over,
  } as unknown as CupInfo;
}

function makeMatch(
  over: Partial<NonNullable<CupInfo['match']>> = {},
): NonNullable<CupInfo['match']> {
  return {
    id: 7,
    phase: 'active',
    countdown: 0,
    timeLeft: 245,
    golden: false,
    scoreA: 1,
    scoreB: 2,
    nationA: 'vale',
    nationB: 'coliseum',
    awayPalette: false,
    team: 'A',
    teamA: [
      {
        pid: 1,
        name: 'Me',
        role: 'striker' as SportRole,
        me: true,
        bot: false,
        ready: false,
        wins: 0,
        losses: 0,
        guild: '',
      },
      {
        pid: 2,
        name: 'Pal',
        role: 'keeper' as SportRole,
        me: false,
        bot: false,
        ready: false,
        wins: 0,
        losses: 0,
        guild: '',
      },
    ],
    teamB: [
      {
        pid: 3,
        name: 'Foe',
        role: 'sweeper' as SportRole,
        me: false,
        bot: false,
        ready: false,
        wins: 0,
        losses: 0,
        guild: '',
      },
      {
        pid: 4,
        name: 'Bot',
        role: 'allrounder' as SportRole,
        me: false,
        bot: true,
        ready: false,
        wins: 0,
        losses: 0,
        guild: '',
      },
    ],
    ballId: 900,
    kickoffTeam: 'A',
    briefingLeft: 0,
    iAmReady: false,
    holderPid: null,
    bets: { open: false, poolA: 0, poolB: 0, count: 0, myStake: 0, mySide: null },
    origin: { x: 0, z: 0 },
    ...over,
  };
}

function input(over: Partial<VcupViewInput> = {}): VcupViewInput {
  return {
    info: makeCupInfo('sim'),
    selectedBracket: 1,
    selectedNation: null,
    selectedRole: 'allrounder',
    playerId: 1,
    party: null,
    practiceAvailable: false,
    enterAsGuild: false,
    ...over,
  };
}

function live(view: VcupView): Extract<VcupView, { kind: 'live' }> {
  if (view.kind !== 'live') throw new Error('expected a live view');
  return view;
}

const party = (pids: number[], leader: number): PartyInfo =>
  ({
    leader,
    raid: false,
    members: pids.map((pid) => ({ pid, name: `P${pid}`, cls: 'warrior', level: 10 })),
  }) as unknown as PartyInfo;

describe('vale_cup_window_view: offline vs live', () => {
  it('renders the offline note when cupInfo is null (online mirror not synced)', () => {
    expect(buildVcupView(input({ info: null })).kind).toBe('offline');
  });

  it('renders the live panel from a snapshot', () => {
    const v = live(buildVcupView(input()));
    expect(v.brackets.map((b) => b.bracket)).toEqual([...VC_BRACKETS]);
    expect(v.standing).toEqual({ wins: 3, losses: 1, draws: 2 });
    expect(v.board).toEqual([
      { name: 'Hobb', wins: 9 },
      { name: 'Mera', wins: 4 },
    ]);
  });
});

describe('vale_cup_window_view: selections', () => {
  it('resolves the painter selection when idle and allows switching', () => {
    const v = live(buildVcupView(input({ selectedBracket: 3, selectedNation: 'moon' })));
    expect(v.bracket).toBe(3);
    expect(v.nation).toBe('moon');
    expect(v.canSwitchBracket).toBe(true);
    expect(v.commitSelections).toBe(false);
    expect(v.brackets.find((b) => b.bracket === 3)?.active).toBe(true);
    expect(v.brackets.find((b) => b.bracket === 3)?.waiting).toBe(5);
    expect(v.nations.find((n) => n.id === 'moon')?.selected).toBe(true);
  });

  it('pins and commits the queued bracket/nation/role over the local selection', () => {
    const info = makeCupInfo('sim', {
      queued: true,
      bracket: 2,
      nation: 'ogre',
      role: 'sweeper',
      position: 1,
    });
    const v = live(buildVcupView(input({ info, selectedBracket: 5, selectedNation: 'vale' })));
    expect(v.bracket).toBe(2);
    expect(v.nation).toBe('ogre');
    expect(v.role).toBe('sweeper');
    expect(v.commitSelections).toBe(true);
    expect(v.canSwitchBracket).toBe(false);
    expect(v.brackets.find((b) => b.bracket === 5)?.locked).toBe(true);
    // nation picks lock while queued; roles stay changeable in the queue
    expect(v.nations.every((n) => n.disabled)).toBe(true);
    expect(v.roles.every((r) => !r.disabled)).toBe(true);
  });

  it('offers every role in every bracket (a 1v1 keeper is allowed)', () => {
    const v = live(buildVcupView(input({ selectedBracket: 1 })));
    expect(v.roles.map((r) => r.id)).toEqual(['allrounder', 'striker', 'sweeper', 'keeper']);
    expect(v.roles.every((r) => !r.disabled)).toBe(true);
  });
});

describe('vale_cup_window_view: the queue affordance', () => {
  it('blocks the queue until a banner nation is picked', () => {
    const v = live(buildVcupView(input()));
    expect(v.action).toEqual({ kind: 'idle', queueDisabled: true, block: 'nation' });
  });

  it('unblocks once a nation is picked', () => {
    const v = live(buildVcupView(input({ selectedNation: 'vale' })));
    expect(v.action).toEqual({ kind: 'idle', queueDisabled: false, block: null });
  });

  it('blocks an oversize party for the bracket', () => {
    const v = live(
      buildVcupView(
        input({ selectedNation: 'vale', selectedBracket: 2, party: party([1, 2, 3], 1) }),
      ),
    );
    expect(v.action).toEqual({ kind: 'idle', queueDisabled: true, block: 'party-size' });
  });

  it('blocks a non-leader party member', () => {
    const v = live(
      buildVcupView(
        input({ selectedNation: 'vale', selectedBracket: 3, party: party([1, 2, 3], 2) }),
      ),
    );
    expect(v.action).toEqual({ kind: 'idle', queueDisabled: true, block: 'not-leader' });
  });

  it('shows the queued action with position + bracket queue size', () => {
    const info = makeCupInfo('sim', {
      queued: true,
      bracket: 3,
      nation: 'vale',
      role: 'striker',
      position: 2,
    });
    const v = live(buildVcupView(input({ info })));
    expect(v.action).toEqual({ kind: 'queued', bracket: 3, position: 2, queueSize: 5 });
  });

  it("shows the Groundskeeper's lockout (deserter) instead of the queue button", () => {
    const v = live(buildVcupView(input({ info: makeCupInfo('sim', { deserterFor: 42.4 }) })));
    expect(v.action).toEqual({ kind: 'deserter', seconds: 43 });
  });

  it('shows the in-match action while my match runs', () => {
    const v = live(buildVcupView(input({ info: makeCupInfo('sim', { match: makeMatch() }) })));
    expect(v.action).toEqual({ kind: 'in-match' });
    expect(v.bracket).toBe(2); // roster size pins the bracket
  });
});

describe('vale_cup_window_view: live panel + practice', () => {
  it('derives the live-match panel with a split clock and the away-palette flag', () => {
    const info = makeCupInfo('sim', {
      live: {
        id: 9,
        bracket: 3,
        clock: 125,
        scoreA: 2,
        scoreB: 2,
        nationA: 'moon',
        nationB: 'moon',
      },
    });
    const v = live(buildVcupView(input({ info })));
    expect(v.live).toEqual({
      nationA: 'moon',
      nationB: 'moon',
      awayPalette: true,
      scoreA: 2,
      scoreB: 2,
      bracket: 3,
      minutes: 2,
      seconds: 5,
      mine: false,
    });
  });

  it('marks the live match as mine when its id matches my match', () => {
    const info = makeCupInfo('sim', {
      match: makeMatch({ id: 9 }),
      live: {
        id: 9,
        bracket: 2,
        clock: 10,
        scoreA: 0,
        scoreB: 0,
        nationA: 'vale',
        nationB: 'ogre',
      },
    });
    expect(live(buildVcupView(input({ info }))).live?.mine).toBe(true);
  });

  it('offers practice only when available, idle, and unqueued', () => {
    expect(live(buildVcupView(input({ practiceAvailable: true }))).practice).toBe(true);
    expect(live(buildVcupView(input({ practiceAvailable: false }))).practice).toBe(false);
    const queued = makeCupInfo('sim', { queued: true, bracket: 1, nation: 'vale', position: 1 });
    expect(live(buildVcupView(input({ info: queued, practiceAvailable: true }))).practice).toBe(
      false,
    );
    const matched = makeCupInfo('sim', { match: makeMatch() });
    expect(live(buildVcupView(input({ info: matched, practiceAvailable: true }))).practice).toBe(
      false,
    );
  });
});

describe('vale_cup_window_view: render-skip signature', () => {
  it('is stable for identical input and moves when the data moves', () => {
    const a = live(buildVcupView(input()));
    const b = live(buildVcupView(input()));
    expect(a.sig).toBe(b.sig);
    const c = live(
      buildVcupView(
        input({ info: makeCupInfo('sim', { standing: { wins: 4, losses: 1, draws: 2 } }) }),
      ),
    );
    expect(c.sig).not.toBe(a.sig);
  });

  it('moves once per live-clock second (whole seconds only)', () => {
    const at = (clock: number) =>
      live(
        buildVcupView(
          input({
            info: makeCupInfo('sim', {
              live: {
                id: 1,
                bracket: 1,
                clock,
                scoreA: 0,
                scoreB: 0,
                nationA: 'vale',
                nationB: 'ogre',
              },
            }),
          }),
        ),
      ).sig;
    expect(at(10.2)).toBe(at(10.8));
    expect(at(10.2)).not.toBe(at(11.0));
  });

  it('is text-independent (raw ids and player names, never t() output)', () => {
    // The core is i18n-free by construction (no t import), so the sig can only
    // carry raw ids/numbers plus verbatim player names; a language switch can
    // never move it, which is what lets relocalize() force exactly one rebuild.
    const v = live(buildVcupView(input({ selectedNation: 'copperdig' })));
    expect(v.sig).toContain('copperdig');
    expect(v.sig).toContain('Hobb'); // board data (names splice verbatim)
    const src = readFileSync(new URL('../src/ui/vale_cup_window_view.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from '\.\/i18n'/);
  });
});

describe('vale_cup_window_view: Sim-shape vs ClientWorld-shape parity', () => {
  it('renders an identical view from both stub shapes', () => {
    const over: Partial<CupInfo> = {
      queued: true,
      bracket: 4 as VcBracket,
      nation: 'choir',
      role: 'keeper',
      position: 3,
      live: {
        id: 2,
        bracket: 4,
        clock: 61,
        scoreA: 1,
        scoreB: 0,
        nationA: 'choir',
        nationB: 'vale',
      },
    };
    const sim = buildVcupView(input({ info: makeCupInfo('sim', over) }));
    const client = buildVcupView(input({ info: makeCupInfo('client', over) }));
    expect(sim).toEqual(client);
  });

  it('is deterministic for the same input object', () => {
    const shared = input();
    expect(buildVcupView(shared)).toEqual(buildVcupView(shared));
  });
});
