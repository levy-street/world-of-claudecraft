// @vitest-environment happy-dom

// The encounter journal window on a five-player dungeon page: the party-frames
// launcher names the dungeon, the boss list follows the route and the run,
// the page shows tips, trade-offs, the Heroic callout and tier marks, and the
// Dungeon Finder can open a page from outside the instance.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JournalRunInput } from '../src/ui/boss_journal/journal_view';
import { setLanguage } from '../src/ui/i18n';
import { RaidBossGuideModelController } from '../src/ui/raid_boss_guide_model_controller';
import { RaidBossGuideWindow } from '../src/ui/raid_boss_guide_window';

vi.mock('../src/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/icons')>()),
  iconDataUrl: (_kind: string, id: string) => `mock:${id}`,
}));

const SANCTUM = 'gravewyrm_sanctum';

describe('RaidBossGuideWindow on a dungeon page', () => {
  let root: HTMLDivElement;
  let fallback: HTMLButtonElement;
  let run: JournalRunInput | null;
  let guide: RaidBossGuideWindow;
  let mount: ReturnType<typeof vi.fn<RaidBossGuideModelController['mount']>>;

  beforeEach(() => {
    setLanguage('en');
    run = null;
    document.body.innerHTML =
      '<button id="fallback">Character</button><div id="raid-boss-guide-window"></div>';
    root = document.querySelector<HTMLDivElement>('#raid-boss-guide-window') as HTMLDivElement;
    fallback = document.querySelector<HTMLButtonElement>('#fallback') as HTMLButtonElement;
    const controller = new RaidBossGuideModelController(
      document,
      async () => {
        throw new Error('no viewer in tests');
      },
      () => false,
    );
    mount = vi.fn<RaidBossGuideModelController['mount']>();
    vi.spyOn(controller, 'mount').mockImplementation(mount);
    guide = new RaidBossGuideWindow(
      {
        root: () => root,
        closeOthers: vi.fn(),
        captureFocus: () => null,
        restoreFocus: (target) => target?.focus(),
        contextFallback: () => fallback,
        attachTooltip: vi.fn(),
        hideTooltip: vi.fn(),
        dungeonRun: () => run,
      },
      document,
      controller,
    );
  });

  afterEach(() => setLanguage('en'));

  it('names the dungeon on the launcher and lists its bosses in route order', () => {
    const button = guide.syncAvailability(SANCTUM);
    expect(button?.textContent).toBe('Boss Guide: Gravewyrm Sanctum');
    button?.click();
    expect(root.style.display).toBe('block');
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[data-boss]')];
    expect(tabs.map((tab) => tab.dataset.boss)).toEqual([
      'sledge_tusker',
      'korgath_the_bound',
      'grand_necromancer_velkhar',
      'korzul_the_gravewyrm',
    ]);
    expect(tabs[0].textContent).toContain('Miniboss');
    expect(tabs[3].textContent).toContain('Final boss');
    expect(root.querySelector('.rbg-boss-nav')?.getAttribute('aria-label')).toBe('Dungeon bosses');
    expect(root.querySelector('.rbg-subtitle')?.textContent).toBe(
      'Gravewyrm Sanctum | Sledge Tusker | Normal',
    );
  });

  it('shows Korgath role tips, the chains trade-off, and summaries without expanding', () => {
    guide.syncAvailability(SANCTUM);
    guide.button.click();
    root.querySelector<HTMLButtonElement>('[data-boss="korgath_the_bound"]')?.click();
    expect(root.querySelectorAll('.rbg-tip')).toHaveLength(3);
    const choice = root.querySelector('.rbg-choice');
    expect(choice?.textContent).toContain('How many chains do you break?');
    expect(choice?.querySelector('.rbg-choice-gain')?.textContent).toContain('20%');
    expect(choice?.querySelector('.rbg-choice-risk')?.textContent).toContain('Threshold Charge');
    const lockbound = root.querySelector('[data-mechanic="lockbound"]');
    expect(lockbound?.querySelector('.rbg-ability-summary')?.textContent).toContain('80%');
    expect(root.querySelector('.rbg-heroic')).toBeNull();
    expect(root.querySelector('[data-mechanic="re-rivet"]')).toBeNull();
    expect(mount).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ boss: 'korgath_the_bound' }),
    );
  });

  it('describes every dungeon mechanic toggle by its visible summary', () => {
    // The toggle's aria-label replaces its text as the accessible name, so the
    // summary reaches assistive tech through aria-describedby.
    guide.syncAvailability(SANCTUM);
    guide.button.click();
    root.querySelector<HTMLButtonElement>('[data-boss="korgath_the_bound"]')?.click();
    const toggles = [...root.querySelectorAll<HTMLButtonElement>('.rbg-ability-toggle')];
    expect(toggles.length).toBeGreaterThan(0);
    for (const toggle of toggles) {
      const id = toggle.getAttribute('aria-describedby');
      expect(id, toggle.dataset.mechanic).toBeTruthy();
      const summary = id ? document.getElementById(id) : null;
      expect(summary?.classList.contains('rbg-ability-summary'), toggle.dataset.mechanic).toBe(
        true,
      );
      expect(toggle.contains(summary)).toBe(true);
    }
    const lockbound = root.querySelector<HTMLButtonElement>('[data-mechanic="lockbound"]');
    const described = document.getElementById(lockbound?.getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toContain('80%');
  });

  it('marks heroic-only and changed mechanics and lists what Heroic changes', () => {
    guide.syncAvailability(SANCTUM);
    guide.button.click();
    root.querySelector<HTMLButtonElement>('[data-boss="korgath_the_bound"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-difficulty="heroic"]')?.click();
    expect(root.querySelector('.rbg-heroic')?.textContent).toContain('2.5 times');
    const rivet = root.querySelector('[data-mechanic="re-rivet"]');
    expect(rivet?.querySelector('.rbg-mark-heroicOnly')?.textContent).toBe('Heroic only');
    expect(rivet?.getAttribute('aria-label')).toContain('Interruptible');
    const strain = root.querySelector<HTMLButtonElement>('[data-mechanic="strain"]');
    expect(strain?.querySelector('.rbg-mark-heroicChanged')).not.toBeNull();
    strain?.click();
    const detail = root.querySelector('[data-detail="strain"]');
    expect(detail?.textContent).toContain('What to do:');
    expect(detail?.querySelector('.rbg-compare')?.textContent).toBe(
      'Normal 180 to 220 | Heroic 450 to 550',
    );
  });

  it('suggests the next standing boss, the run difficulty, and marks the defeated', () => {
    run = {
      dungeonId: SANCTUM,
      difficulty: 'heroic',
      bosses: [
        { mobId: 'korgath_the_bound', defeated: true },
        { mobId: 'grand_necromancer_velkhar', defeated: false },
        { mobId: 'korzul_the_gravewyrm', defeated: false },
      ],
    };
    guide.syncAvailability(SANCTUM);
    guide.button.click();
    const velkhar = root.querySelector('[data-boss="grand_necromancer_velkhar"]');
    expect(velkhar?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.rbg-subtitle')?.textContent).toContain('Heroic');
    const korgath = root.querySelector('[data-boss="korgath_the_bound"]');
    expect(korgath?.classList.contains('defeated')).toBe(true);
    expect(korgath?.getAttribute('aria-label')).toBe('View Korgath the Bound (defeated)');
  });

  it('opens from the Dungeon Finder outside the instance and stays open there', () => {
    expect(RaidBossGuideWindow.hasJournal(SANCTUM, 'korzul_the_gravewyrm')).toBe(true);
    expect(RaidBossGuideWindow.hasJournal(SANCTUM, 'some_trash')).toBe(false);
    expect(guide.syncAvailability(null)).toBeNull();
    expect(guide.openJournal(SANCTUM, 'korzul_the_gravewyrm', 'heroic')).toBe(true);
    expect(root.style.display).toBe('block');
    expect(
      root.querySelector('[data-boss="korzul_the_gravewyrm"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    // The party-frames sync keeps reporting no room guide: the finder page stays.
    expect(guide.syncAvailability(null)).toBeNull();
    expect(root.style.display).toBe('block');
    guide.close();
    expect(root.style.display).toBe('none');
    expect(guide.openJournal('no_such_dungeon')).toBe(false);
  });

  it('closes a room-opened page when the room loses its guide', () => {
    guide.syncAvailability(SANCTUM)?.click();
    expect(root.style.display).toBe('block');
    guide.syncAvailability(null);
    expect(root.style.display).toBe('none');
    expect(document.activeElement).toBe(fallback);
  });

  it('does nothing on a repeated identical sync, and repaints when a boss falls', () => {
    run = {
      dungeonId: SANCTUM,
      difficulty: 'normal',
      bosses: [
        { mobId: 'korgath_the_bound', defeated: false },
        { mobId: 'grand_necromancer_velkhar', defeated: false },
        { mobId: 'korzul_the_gravewyrm', defeated: false },
      ],
    };
    guide.syncAvailability(SANCTUM)?.click();
    const renders = vi.spyOn(guide, 'render');
    for (let i = 0; i < 5; i++) guide.syncAvailability(SANCTUM);
    expect(renders).not.toHaveBeenCalled();
    run = { ...run, bosses: run.bosses.map((b, i) => ({ ...b, defeated: i === 0 })) };
    guide.syncAvailability(SANCTUM);
    expect(renders).toHaveBeenCalledOnce();
    expect(
      root.querySelector('[data-boss="korgath_the_bound"]')?.classList.contains('defeated'),
    ).toBe(true);
  });

  it('returns a finder-opened page to the stable launcher and the run difficulty', () => {
    run = {
      dungeonId: SANCTUM,
      difficulty: 'normal',
      bosses: [{ mobId: 'korgath_the_bound', defeated: false }],
    };
    guide.syncAvailability(SANCTUM);
    guide.openJournal(SANCTUM, 'korzul_the_gravewyrm', 'heroic');
    expect(root.querySelector('.rbg-subtitle')?.textContent).toContain('Heroic');
    guide.close();
    expect(document.activeElement).toBe(fallback);
    guide.button.click();
    expect(root.querySelector('.rbg-subtitle')?.textContent).toContain('Normal');
  });
});
