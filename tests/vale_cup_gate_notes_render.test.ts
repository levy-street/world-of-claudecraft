// @vitest-environment jsdom
// Render-level pins for the Vale Cup gate notes (issue 2767, review round).
// The view suites prove the FLAGS arrive and the source guard pins the gates'
// shape, but only a real DOM render proves each gate points the right way (an
// inverted ternary keeps every substring in the file and survives both).
// Drives the real painters against jsdom: the window note must appear in the
// 1v1/2v2 brackets and vanish at 3v3+, and the briefing rules row must appear
// only for an unrated bout, with the copy branched practice vs backfill.
import { describe, expect, it } from 'vitest';
import { makeWriterFacet } from '../src/ui/painter_host';
import { ValeCupBriefing } from '../src/ui/vale_cup_briefing';
import { buildVcupBriefingView } from '../src/ui/vale_cup_briefing_view';
import { ValeCupWindow } from '../src/ui/vale_cup_window';
import type { CupInfo, IWorld } from '../src/world_api';

// jsdom ships no canvas 2D backend, and the briefing skeleton paints its kit
// icons through one (src/ui/icons.ts). Hand every 2d request an inert context
// whose methods no-op, so the icons paint into nothing and the DOM structure
// under test still builds.
const inertCtx = (): unknown =>
  new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'canvas') return { width: 0, height: 0 };
        if (prop === 'measureText') return () => ({ width: 0 });
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient')
          return () => ({ addColorStop: () => {} });
        if (prop === 'getImageData' || prop === 'createImageData')
          return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
        return () => {};
      },
      set() {
        return true;
      },
    },
  );
(HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = inertCtx;
(HTMLCanvasElement.prototype as unknown as { toDataURL: unknown }).toDataURL = () =>
  'data:image/png;base64,';

const QUEUE_SIZES = { 1: 2, 2: 0, 3: 5, 4: 0, 5: 1 };

function makeCupInfo(over: Partial<CupInfo> = {}): CupInfo {
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
    board: [],
    guildBoard: [],
    myGuild: null,
    guildStanding: { wins: 0, losses: 0 },
    practicing: [],
    ...over,
  } as unknown as CupInfo;
}

function makeMatch(
  over: Partial<NonNullable<CupInfo['match']>> = {},
): NonNullable<CupInfo['match']> {
  return {
    id: 9,
    phase: 'briefing',
    rated: true,
    practice: false,
    countdown: 0,
    timeLeft: 360,
    golden: false,
    scoreA: 0,
    scoreB: 0,
    nationA: 'vale',
    nationB: 'mirefen',
    awayPalette: false,
    mySide: 'A',
    myRole: 'allrounder',
    teamA: [
      {
        pid: 1,
        name: 'Me',
        role: 'allrounder',
        me: true,
        bot: false,
        ready: false,
        wins: 0,
        losses: 0,
        guild: '',
      },
    ],
    teamB: [
      {
        pid: 2,
        name: 'Rook',
        role: 'allrounder',
        me: false,
        bot: true,
        ready: true,
        wins: 0,
        losses: 0,
        guild: '',
      },
    ],
    ballId: 42,
    kickoffTeam: 'A',
    briefingLeft: 12,
    iAmReady: false,
    holderPid: null,
    bets: { open: false, poolA: 0, poolB: 0, count: 0, myStake: 0, mySide: null },
    origin: { x: 0, z: 0 },
    ...over,
  } as NonNullable<CupInfo['match']>;
}

// ---- Vale Cup window: the small-bracket role note tracks the bracket -------

function renderWindow(cupInfo: CupInfo): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  root.style.display = 'block';
  const world = {
    cupInfo,
    playerId: 1,
    partyInfo: null,
    vcupSetRole: () => {},
    vcupQueueJoin: () => {},
    vcupQueueLeave: () => {},
    vcupPracticeStart: () => {},
  } as unknown as IWorld;
  const win = new ValeCupWindow({
    root: () => root,
    world: () => world,
    closeOthers: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
  });
  win.setPracticeAvailable(true);
  win.render();
  return root;
}

describe('vale_cup_window painter: gate notes render with the right polarity', () => {
  it('shows the small-bracket role note in the default 1v1 bracket', () => {
    const root = renderWindow(makeCupInfo());
    const note = root.querySelector('#vcup-roles-smallnote');
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain('All-Rounder');
    // The roles group hands the note to screen readers via aria-describedby.
    expect(root.querySelector('.vcup-roles')?.getAttribute('aria-describedby')).toBe(
      'vcup-roles-smallnote',
    );
    root.remove();
  });

  it('hides the small-bracket role note while queued for 3v3', () => {
    // A queued entry pins the bracket selection, so the view renders bracket 3.
    const root = renderWindow(
      makeCupInfo({ queued: true, bracket: 3, position: 1, role: 'striker' }),
    );
    expect(root.querySelector('#vcup-roles-smallnote')).toBeNull();
    expect(root.querySelector('.vcup-roles')?.getAttribute('aria-describedby')).toBeNull();
    root.remove();
  });

  it('renders the practice unrated note beside the practice button, described by it', () => {
    const root = renderWindow(makeCupInfo());
    const btn = root.querySelector('.vcup-practice');
    const note = root.querySelector('#vcup-practice-unrated-note');
    expect(btn).not.toBeNull();
    expect(note?.textContent).toContain('unrated');
    expect(btn?.getAttribute('aria-describedby')).toBe(
      'vcup-practice-note vcup-practice-unrated-note',
    );
    root.remove();
  });
});

// ---- Vale Cup briefing: the unrated rules row tracks rated and practice ----

function renderBriefing(cupInfo: CupInfo): HTMLElement {
  const layer = document.createElement('div');
  document.body.appendChild(layer);
  const writers = makeWriterFacet(
    new Map(),
    new Map(),
    new Map(),
    new Map(),
    () => {},
    () => {},
  );
  const briefing = new ValeCupBriefing({
    layer: () => layer,
    writers,
    onReady: () => {},
  });
  briefing.update(buildVcupBriefingView(cupInfo));
  return layer;
}

describe('vale_cup_briefing painter: the unrated rules row renders with the right polarity', () => {
  it('adds no unrated row to a rated bout', () => {
    const layer = renderBriefing(makeCupInfo({ match: makeMatch() }));
    expect(layer.querySelector('#vcup-briefing')).not.toBeNull();
    expect(layer.querySelectorAll('.vcupb-unrated').length).toBe(0);
    layer.remove();
  });

  it('adds exactly one unrated row to a bot-backfilled bout, with the skill-deed copy', () => {
    const layer = renderBriefing(makeCupInfo({ match: makeMatch({ rated: false }) }));
    const rows = layer.querySelectorAll('.vcupb-unrated');
    expect(rows.length).toBe(1);
    // Backfill copy names the skill deeds (the debut deeds still credit).
    expect(rows[0].textContent).toContain('goals, saves, and clean sheets');
    layer.remove();
  });

  it('uses the blanket practice copy for a practice bout', () => {
    const layer = renderBriefing(
      makeCupInfo({ match: makeMatch({ rated: false, practice: true }) }),
    );
    const rows = layer.querySelectorAll('.vcupb-unrated');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('practice bout');
    expect(rows[0].textContent).toContain('Book of Deeds progress does not count');
    layer.remove();
  });
});
