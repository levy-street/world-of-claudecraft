// @vitest-environment jsdom
//
// Spec-commit behavior of the talents window (the fix for the reworked window
// whose spec choice only ever STAGED and never committed):
//   - For ALL TEN classes (the overhauled 'warrior' included since the
//     2026-07-11 operator decision superseded the staged-edit-plus-Save rule;
//     see docs/prd/warrior-talents.md), an UNCOMMITTED spec panel's button reads
//     the selectSpec label and clicking it COMMITS through deps.commitSpec (Hud
//     wires it to IWorld.setSpec) before staging + jumping to the Choices tab.
//   - The ALREADY-COMMITTED spec keeps the navigation-only viewTalents button.
//   - The online wire: ClientWorld.setSpec sends the existing setSpec command.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The procedural icon compositor draws on a 2D canvas, which jsdom does not ship
// (no `canvas` package in this repo). The window only ever embeds the returned URL
// string, so a stub URL keeps the paint path real while skipping the raster work.
// talent_icons' talentIconDataUrl wraps this same import, so the rows tab is
// covered by the one mock too.
vi.mock('../src/ui/icons', () => ({
  iconDataUrl: () => 'data:,icon-stub',
}));

import { ClientWorld } from '../src/net/online';
import type { SavedLoadout, TalentAllocation } from '../src/sim/content/talents';
import { talentsFor } from '../src/sim/content/talents';
import { ALL_CLASSES, type PlayerClass } from '../src/sim/types';
import { t } from '../src/ui/i18n';
import { TalentsWindow, type TalentsWindowDeps } from '../src/ui/talents_window';

// Every class commits through the same button, the overhauled warrior included.
const COMMIT_CLASSES = ALL_CLASSES;

interface Harness {
  win: TalentsWindow;
  root: HTMLElement;
  commits: string[];
}

function makeHarness(cls: PlayerClass, committedSpec: string | null): Harness {
  const root = document.createElement('div');
  document.body.appendChild(root);
  let stage: TalentAllocation | null = null;
  const commits: string[] = [];
  const deps: TalentsWindowDeps = {
    itemIcon: () => '',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: () => {},
    root: () => root,
    hideTooltip: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    getStage: () => stage,
    setStage: (s) => {
      stage = s;
    },
    playerClass: () => cls,
    totalPoints: () => 6,
    currentAllocation: () => ({ spec: committedSpec, rows: {} }),
    activeLoadout: () => -1,
    loadouts: (): readonly SavedLoadout[] => [],
    abilityTooltip: () => null,
    rowPicks: () => [],
    playerLevel: () => 60,
    pickRow: () => {},
    commitSpec: (specId) => {
      commits.push(specId);
    },
    currentBar: () => [],
    saveLoadout: () => {},
    switchLoadout: () => {},
    deleteLoadout: () => {},
    applyLoadoutBar: () => {},
    inputDialog: () => {},
    confirmDialog: () => {},
    showError: () => {},
  };
  return { win: new TalentsWindow(deps), root, commits };
}

function panelButtons(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('.ts-view-talents'));
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('spec commit: all ten classes', () => {
  it('covers every class, the overhauled warrior and warrior_classic included', () => {
    expect(COMMIT_CLASSES).toHaveLength(10);
    expect(COMMIT_CLASSES).toContain('warrior');
    expect(COMMIT_CLASSES).toContain('warrior_classic');
    for (const cls of COMMIT_CLASSES) {
      expect(talentsFor(cls), `${cls} must have authored specs`).not.toBeNull();
    }
  });

  for (const cls of COMMIT_CLASSES) {
    it(`${cls}: uncommitted specs render the selectSpec label and the click commits that spec`, () => {
      const { win, root, commits } = makeHarness(cls, null);
      win.open();
      const specs = talentsFor(cls)?.specs ?? [];
      const buttons = panelButtons(root);
      expect(buttons.length).toBe(specs.length);
      expect(buttons.length).toBeGreaterThan(0);
      for (const btn of buttons) {
        expect(btn.textContent).toBe(t('hudChrome.specPanel.selectSpec'));
      }
      buttons[0].click();
      expect(commits).toEqual([specs[0].id]);
      // The click still stages + jumps to the Choices tab, exactly as before.
      const rowsTab = root.querySelector('.tal-tab[data-tab="rows"]');
      expect(rowsTab?.classList.contains('active')).toBe(true);
    });
  }

  it('the already-committed spec keeps the navigation-only View talents button', () => {
    const specs = talentsFor('mage')?.specs ?? [];
    expect(specs.length).toBeGreaterThan(1);
    const committedId = specs[0].id;
    const { win, root, commits } = makeHarness('mage', committedId);
    win.open();
    const buttons = panelButtons(root);
    expect(buttons[0].textContent).toBe(t('hudChrome.specPanel.viewTalents'));
    for (const btn of buttons.slice(1)) {
      expect(btn.textContent).toBe(t('hudChrome.specPanel.selectSpec'));
    }
    buttons[0].click();
    // Navigation only: no commit fires for the spec that is already committed.
    expect(commits).toEqual([]);
    const rowsTab = root.querySelector('.tal-tab[data-tab="rows"]');
    expect(rowsTab?.classList.contains('active')).toBe(true);
  });
});

describe('spec commit: the overhauled warrior (the 2026-07-11 bug report)', () => {
  it('commits fury on the Select specialization click, so dual wield can unlock', () => {
    // The original exclusion left the warrior with NO committing control in
    // the window (the only path was a buried loadout Save), so a warrior
    // could never gain a spec, and canDualWield never saw 'fury'.
    const { win, root, commits } = makeHarness('warrior', null);
    win.open();
    const specs = talentsFor('warrior')?.specs ?? [];
    const furyIdx = specs.findIndex((s) => s.id === 'fury');
    expect(furyIdx).toBeGreaterThanOrEqual(0);
    const buttons = panelButtons(root);
    expect(buttons.length).toBe(specs.length);
    for (const btn of buttons) {
      expect(btn.textContent).toBe(t('hudChrome.specPanel.selectSpec'));
    }
    buttons[furyIdx].click();
    expect(commits).toEqual(['fury']);
    const rowsTab = root.querySelector('.tal-tab[data-tab="rows"]');
    expect(rowsTab?.classList.contains('active')).toBe(true);
  });

  it('the committed warrior spec reverts to the navigation-only View talents button', () => {
    const { win, root, commits } = makeHarness('warrior', 'fury');
    win.open();
    const specs = talentsFor('warrior')?.specs ?? [];
    const furyIdx = specs.findIndex((s) => s.id === 'fury');
    const buttons = panelButtons(root);
    expect(buttons[furyIdx].textContent).toBe(t('hudChrome.specPanel.viewTalents'));
    buttons[furyIdx].click();
    expect(commits).toEqual([]);
  });
});

// Build a ClientWorld without opening a socket (mirrors quest_link_wire.test.ts's
// bareClient): the online half of the commit path is a pure command send that the
// server re-validates (server/game.ts 'setSpec' -> Sim.setSpec).
function bareClient(): { world: ClientWorld; sent: Record<string, unknown>[] } {
  const world = Object.create(ClientWorld.prototype) as ClientWorld;
  const sent: Record<string, unknown>[] = [];
  const bag = world as unknown as Record<string, unknown>;
  bag.connected = true;
  bag.ws = { readyState: 1, send: (s: string) => sent.push(JSON.parse(s)) };
  return { world, sent };
}

describe('ClientWorld.setSpec online wire', () => {
  it('sends the existing setSpec command with the spec id', () => {
    const { world, sent } = bareClient();
    world.setSpec('frost');
    expect(sent).toEqual([{ t: 'cmd', cmd: 'setSpec', spec: 'frost' }]);
  });

  it('sends spec: null for a spec clear', () => {
    const { world, sent } = bareClient();
    world.setSpec(null);
    expect(sent).toEqual([{ t: 'cmd', cmd: 'setSpec', spec: null }]);
  });
});
