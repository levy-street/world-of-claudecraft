// @vitest-environment happy-dom

// The Adventure Journal window (src/ui/hud/journal/adventure_journal_window.ts):
// where it lands, how the list, tabs, difficulty and Mythic behave, the
// entry points (Shift+J through the collection dispatcher, the side rail and
// phone buttons, the book beside the target frame, the Dungeon Finder), the
// keyboard, and that an unchanged tick repaints nothing.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BIND_ACTIONS } from '../src/game/keybinds';
import { SMITH_HEART_DUNGEON } from '../src/sim/content/smith_heart';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  COUNCIL_GUARDIAN,
  COUNCIL_SEAM_SINGER,
} from '../src/sim/encounters/smith_heart/council_ids';
import { HEAT_GUARDIAN } from '../src/sim/encounters/smith_heart/heat_ids';
import { dispatchCollectionAction } from '../src/ui/collection_actions_core';
import {
  AdventureJournalWindow,
  type JournalWorld,
} from '../src/ui/hud/journal/adventure_journal_window';
import { journalInstance } from '../src/ui/hud/journal/journal_catalog';
import { setLanguage } from '../src/ui/i18n';
import { RaidBossGuideModelController } from '../src/ui/raid_boss_guide_model_controller';
import type { DungeonRunView, RaidRunView } from '../src/world_api/dungeons';

vi.mock('../src/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/icons')>()),
  iconDataUrl: (_kind: string, id: string) => `mock:${id}`,
}));

const xOf = (dungeonId: string) => instanceOrigin(DUNGEONS[dungeonId].index, 0).x;

interface FakeWorld extends JournalWorld {
  dungeonRun: DungeonRunView | null;
  raidRun: RaidRunView | null;
  player: { pos: { x: number }; targetId: number | null };
}

function raidRun(engaged: string | null, defeated: string[] = []): RaidRunView {
  return {
    dungeonId: SMITH_HEART_DUNGEON,
    difficulty: 'heroic',
    bosses: [
      COUNCIL_GUARDIAN,
      COUNCIL_SEAM_SINGER,
      'heart_breath_guardian',
      'heart_quench_guardian',
      HEAT_GUARDIAN,
      'heart_masterless_strength',
    ].map((mobId) => ({ mobId, defeated: defeated.includes(mobId), engaged: mobId === engaged })),
  };
}

describe('AdventureJournalWindow', () => {
  let root: HTMLDivElement;
  let world: FakeWorld;
  let journal: AdventureJournalWindow;
  let unreleased: boolean;
  let targetTemplate: string | null;

  beforeEach(() => {
    setLanguage('en');
    unreleased = true;
    targetTemplate = null;
    document.body.innerHTML =
      '<button id="mm-journal"></button><button id="mobile-journal"></button>' +
      '<div id="target-frame"><button id="tf-journal"></button></div>' +
      '<div id="adventure-journal-window"></div>';
    root = document.getElementById('adventure-journal-window') as HTMLDivElement;
    world = {
      dungeonRun: null,
      raidRun: null,
      player: { pos: { x: 0 }, targetId: null },
      entities: {
        get: (id: number) =>
          id === 7 && targetTemplate ? { templateId: targetTemplate } : undefined,
      },
    };
    const controller = new RaidBossGuideModelController(
      document,
      async () => {
        throw new Error('no viewer in tests');
      },
      () => false,
    );
    vi.spyOn(controller, 'mount').mockImplementation(() => {});
    journal = new AdventureJournalWindow(
      {
        root: () => root,
        closeOthers: vi.fn(),
        captureFocus: () => null,
        restoreFocus: (target) => target?.focus(),
        hideTooltip: vi.fn(),
        attachTooltip: vi.fn(),
        itemIcon: () => '<img class="icon" alt="">',
        itemTooltip: () => '',
        world: () => world,
        showUnreleased: () => unreleased,
      },
      document,
      controller,
    );
  });

  afterEach(() => setLanguage('en'));

  const selected = () => root.querySelector<HTMLElement>('.aj-boss.active')?.dataset.boss;
  const tier = () => root.querySelector<HTMLElement>('.rbg-segmented .active')?.dataset.difficulty;
  const tiers = () =>
    [...root.querySelectorAll<HTMLElement>('.rbg-segmented [data-difficulty]')].map(
      (b) => b.dataset.difficulty,
    );

  it('is bound to Shift+J through the rebindable keybinds and the collection dispatcher', () => {
    expect(BIND_ACTIONS.find((a) => a.id === 'adventureJournal')?.defaults).toEqual(['Shift+KeyJ']);
    const host = { toggleAdventureJournal: vi.fn() };
    expect(dispatchCollectionAction('adventureJournal', host as never)).toBe(true);
    expect(host.toggleAdventureJournal).toHaveBeenCalledTimes(1);
  });

  it('opens from the side rail and the phone button, and toggles closed', () => {
    document.getElementById('mm-journal')?.click();
    expect(journal.isOpen).toBe(true);
    expect(root.querySelector('#aj-title')?.textContent).toBe('Adventure Journal');
    document.getElementById('mm-journal')?.click();
    expect(journal.isOpen).toBe(false);
    document.getElementById('mobile-journal')?.click();
    expect(journal.isOpen).toBe(true);
  });

  it('lands inside a raid on the engaged boss, on the run difficulty', () => {
    world.player.pos.x = xOf(SMITH_HEART_DUNGEON);
    world.raidRun = raidRun(HEAT_GUARDIAN, [COUNCIL_GUARDIAN, COUNCIL_SEAM_SINGER]);
    journal.toggle();
    expect(selected()).toBe(HEAT_GUARDIAN);
    expect(tier()).toBe('heroic');
    expect(
      root
        .querySelector('.aj-instance.current')
        ?.querySelector('[data-instance]')
        ?.getAttribute('data-instance'),
    ).toBe(SMITH_HEART_DUNGEON);
    expect(root.querySelector('.aj-chip-engaged')?.textContent).toContain('In combat');
  });

  it('lands on the next boss standing when nothing is engaged', () => {
    world.player.pos.x = xOf(SMITH_HEART_DUNGEON);
    world.raidRun = raidRun(null, [COUNCIL_GUARDIAN, COUNCIL_SEAM_SINGER]);
    journal.toggle();
    expect(selected()).toBe('heart_breath_guardian');
    expect(
      root.querySelector(`[data-boss="${COUNCIL_GUARDIAN}"]`)?.classList.contains('defeated'),
    ).toBe(true);
  });

  it('lands in a dungeon on its next boss from IWorld.dungeonRun', () => {
    const sanctum = journalInstance('gravewyrm_sanctum')!;
    const [first, second] = sanctum.source.bossKeys;
    world.player.pos.x = xOf('gravewyrm_sanctum');
    world.dungeonRun = {
      dungeonId: 'gravewyrm_sanctum',
      difficulty: 'normal',
      bosses: sanctum.source.bossKeys.map((mobId) => ({ mobId, defeated: mobId === first })),
    };
    journal.toggle();
    expect(selected()).toBe(second);
    // A dungeon offers no Mythic tab (the game has no Mythic dungeons).
    expect(tiers()).toEqual(['normal', 'heroic']);
  });

  it("shows Mythic's Coming soon panel on the raid, with a way back to the live tiers", () => {
    journal.openJournal(SMITH_HEART_DUNGEON, HEAT_GUARDIAN, 'normal');
    expect(tiers()).toEqual(['normal', 'heroic', 'mythic']);
    root.querySelector<HTMLButtonElement>('.rbg-segmented [data-difficulty="mythic"]')?.click();
    expect(root.querySelector('.aj-soon h3')?.textContent).toBe('Coming soon');
    expect(root.querySelector('.aj-tabs')).toBeNull();
    expect(root.querySelector('[data-mechanic]')).toBeNull();
    root.querySelector<HTMLButtonElement>('.aj-soon [data-difficulty="heroic"]')?.click();
    expect(tier()).toBe('heroic');
    expect(root.querySelector('.aj-soon')).toBeNull();
  });

  it('prints the live per-tier numbers: Normal and Heroic differ where the tuning does', () => {
    journal.openJournal(SMITH_HEART_DUNGEON, HEAT_GUARDIAN, 'normal');
    const view = journalInstance(SMITH_HEART_DUNGEON)!.source.view(HEAT_GUARDIAN, 'normal');
    const heroic = journalInstance(SMITH_HEART_DUNGEON)!.source.view(HEAT_GUARDIAN, 'heroic');
    const changed = view.phases
      .flatMap((p) => p.mechanics)
      .find((m) => {
        const h = heroic.phases.flatMap((p) => p.mechanics).find((x) => x.id === m.id);
        return (
          m.values?.min !== undefined &&
          h?.values?.min !== undefined &&
          h.values.min !== m.values.min
        );
      });
    expect(changed, 'a mechanic whose damage moves with the tier').toBeTruthy();
    const text = (id: string) =>
      root.querySelector(`[data-ability="${id}"] .rbg-ability-summary`)?.textContent ?? '';
    const id = changed?.id ?? '';
    const normalText = text(id);
    expect(normalText).toContain(String(changed?.values?.min));
    root.querySelector<HTMLButtonElement>('.rbg-segmented [data-difficulty="heroic"]')?.click();
    const heroicMin = heroic.phases.flatMap((p) => p.mechanics).find((m) => m.id === id)
      ?.values?.min;
    expect(text(id)).not.toBe(normalText);
    expect(text(id).replace(/,/g, '')).toContain(String(heroicMin));
  });

  it('collapses phases and expands abilities, with the role tags on each line', () => {
    journal.openJournal(SMITH_HEART_DUNGEON, HEAT_GUARDIAN, 'normal');
    const phase = root.querySelector<HTMLButtonElement>('[data-phase-toggle]')!;
    expect(phase.getAttribute('aria-expanded')).toBe('true');
    const firstMechanic = root.querySelector<HTMLButtonElement>('[data-mechanic]')!;
    const id = firstMechanic.dataset.mechanic!;
    firstMechanic.click();
    expect(root.querySelector(`[data-mechanic="${id}"]`)?.getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(root.querySelector(`[data-detail="${id}"]`)?.textContent).toContain('What to do:');
    expect(root.querySelectorAll('.rbg-badge-role').length).toBeGreaterThan(0);
    root.querySelector<HTMLButtonElement>('[data-phase-toggle]')?.click();
    expect(root.querySelector('[data-phase-toggle]')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows Strategy by role with links into Abilities, and the Loot tab', () => {
    journal.openJournal(SMITH_HEART_DUNGEON, HEAT_GUARDIAN, 'heroic');
    root.querySelector<HTMLButtonElement>('[data-tab="overview"]')?.click();
    expect(root.querySelector('#aj-strategy-title')?.textContent).toBe('Strategy by role');
    expect(root.querySelectorAll('.aj-role-card')).toHaveLength(3);
    expect(root.querySelector('.rbg-heroic')).not.toBeNull();
    const link = root.querySelector<HTMLButtonElement>('[data-jump]')!;
    const target = link.dataset.jump;
    link.click();
    expect(root.querySelector('.aj-tab.active')?.getAttribute('data-tab')).toBe('abilities');
    expect(root.querySelector(`[data-mechanic="${target}"]`)?.getAttribute('aria-expanded')).toBe(
      'true',
    );
    root.querySelector<HTMLButtonElement>('[data-tab="loot"]')?.click();
    expect(root.querySelector('.aj-loot-empty')?.textContent).toContain('drops no items on Heroic');
  });

  it('lists real drops with their chances on a dungeon boss', () => {
    const sanctum = journalInstance('gravewyrm_sanctum')!;
    const final = sanctum.source.bossKeys.at(-1)!;
    journal.openJournal('gravewyrm_sanctum', final, 'normal');
    root.querySelector<HTMLButtonElement>('[data-tab="loot"]')?.click();
    const rows = root.querySelectorAll('.aj-loot-row');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].textContent).toMatch(/chance|Guaranteed/);
  });

  it('steps to the previous and next boss and shows a council with both members', () => {
    journal.openJournal(SMITH_HEART_DUNGEON, COUNCIL_SEAM_SINGER, 'normal');
    expect(selected()).toBe(COUNCIL_GUARDIAN);
    expect(root.querySelectorAll('.aj-council-member')).toHaveLength(2);
    expect(root.querySelector<HTMLButtonElement>('[data-step="-1"]')?.disabled).toBe(true);
    root.querySelector<HTMLButtonElement>('[data-step="1"]')?.click();
    expect(selected()).toBe('heart_breath_guardian');
  });

  it('hides the dev-gated raid from the list unless dev tools are on', () => {
    unreleased = false;
    journal.toggle();
    expect(root.querySelector(`[data-instance="${SMITH_HEART_DUNGEON}"]`)).toBeNull();
    expect(journal.covers(HEAT_GUARDIAN)).toBe(false);
    // Standing inside it shows it anyway.
    world.player.pos.x = xOf(SMITH_HEART_DUNGEON);
    expect(journal.covers(HEAT_GUARDIAN)).toBe(true);
  });

  it('opens straight on the target from the book beside the target frame', () => {
    expect(journal.covers('heart_quench_guardian')).toBe(true);
    expect(journal.covers('not_a_boss')).toBe(false);
    targetTemplate = 'heart_quench_guardian';
    world.player.targetId = 7;
    document.getElementById('tf-journal')?.click();
    expect(journal.isOpen).toBe(true);
    expect(selected()).toBe('heart_quench_guardian');
  });

  it('opens a dungeon page from the Dungeon Finder', () => {
    expect(AdventureJournalWindow.prototype.openJournal).toBeTypeOf('function');
    expect(journal.openJournal('gravewyrm_sanctum', 'korzul_the_gravewyrm', 'heroic')).toBe(true);
    expect(selected()).toBe('korzul_the_gravewyrm');
    expect(tier()).toBe('heroic');
    expect(journal.openJournal('no_such_dungeon')).toBe(false);
  });

  it('walks the list with the arrow keys and folds an instance with Left', () => {
    journal.openJournal('gravewyrm_sanctum', 'korzul_the_gravewyrm', 'normal');
    const nav = root.querySelector<HTMLElement>('.aj-nav')!;
    const items = () => [...nav.querySelectorAll<HTMLElement>('[data-nav-item]')];
    items()[0].focus();
    items()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items()[1]);
    const toggle = nav.querySelector<HTMLElement>('[data-instance="gravewyrm_sanctum"]')!;
    toggle.focus();
    toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(
      root.querySelector('[data-instance="gravewyrm_sanctum"]')?.getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('opens and closes the phone drawer with Browse, and picking a boss closes it', () => {
    journal.openJournal(SMITH_HEART_DUNGEON, HEAT_GUARDIAN, 'normal');
    root.querySelector<HTMLButtonElement>('[data-browse]')?.click();
    expect(root.querySelector('.aj-shell')?.classList.contains('aj-nav-open')).toBe(true);
    expect(root.querySelector('[data-browse]')?.getAttribute('aria-expanded')).toBe('true');
    root.querySelector<HTMLButtonElement>(`[data-boss="heart_quench_guardian"]`)?.click();
    expect(root.querySelector('.aj-shell')?.classList.contains('aj-nav-open')).toBe(false);
  });

  it('does nothing on an unchanged tick and repaints when a boss falls', () => {
    world.player.pos.x = xOf(SMITH_HEART_DUNGEON);
    world.raidRun = raidRun(null);
    journal.toggle();
    const page = root.querySelector('.aj-page');
    for (let i = 0; i < 5; i++) journal.syncRun();
    expect(root.querySelector('.aj-page')).toBe(page);
    world.raidRun = raidRun(null, [COUNCIL_GUARDIAN, COUNCIL_SEAM_SINGER]);
    journal.syncRun();
    expect(root.querySelector('.aj-page')).not.toBe(page);
    expect(
      root.querySelector(`[data-boss="${COUNCIL_GUARDIAN}"]`)?.classList.contains('defeated'),
    ).toBe(true);
    journal.close();
    const closed = root.innerHTML;
    world.raidRun = raidRun(HEAT_GUARDIAN);
    journal.syncRun();
    expect(root.innerHTML).toBe(closed);
  });
});

describe('the old party-frames guide button is gone', () => {
  it('has no opener in the party frames, the HUD or either entry document', () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
    expect(read('src/ui/party_frames_painter.ts')).not.toContain('setGuideControl');
    expect(read('src/ui/hud.ts')).not.toMatch(
      /setGuideControl|raidBossGuideWindow|party-boss-guide/,
    );
    for (const entry of ['index.html', 'play.html']) {
      const html = read(entry);
      expect(html).not.toContain('raid-boss-guide-window');
      expect(html).toContain('id="adventure-journal-window"');
      expect(html).toContain('id="mm-journal"');
      expect(html).toContain('id="mobile-journal"');
      expect(html).toContain('id="tf-journal"');
    }
  });
});
