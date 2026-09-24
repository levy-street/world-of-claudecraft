import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { SimEvent } from '../src/sim/types';
import { applyQuestEventPresentation } from '../src/ui/hud/quest/quest_event_router';
import { WORLD_QUEST_BANNER_MS } from '../src/ui/hud/quest/world_quest_banner_view';
import { HUD_LOG } from '../src/ui/hud_tones';
import { HOARD_GOBLIN_BANNER_MS } from '../src/ui/quest_event_view';
import { worldQuestDisplayName } from '../src/ui/world_quest_view';

const playUi = vi.hoisted(() => vi.fn());
vi.mock('../src/game/sfx', () => ({ sfx: { playUi } }));

function fakeHud() {
  return {
    log: vi.fn(),
    questBanner: { show: vi.fn() },
    showBanner: vi.fn(),
    questDialog: { refresh: vi.fn() },
    worldQuestPuzzleWindow: { applyEventPresentation: vi.fn() },
    treasureMapWindow: { open: vi.fn(), refresh: vi.fn() },
  };
}

describe('quest event router', () => {
  it('routes a quest event through its channels and reports it handled', () => {
    const hud = fakeHud();
    const ev = { type: 'questAccepted', questId: 'q_test' } as SimEvent;
    expect(applyQuestEventPresentation(hud, ev)).toBe(true);
    expect(playUi).toHaveBeenLastCalledWith('quest_accept');
    expect(hud.questDialog.refresh).toHaveBeenCalledOnce();
    expect(hud.worldQuestPuzzleWindow.applyEventPresentation).toHaveBeenCalledOnce();
    expect(hud.log).not.toHaveBeenCalled();
    expect(hud.showBanner).not.toHaveBeenCalled();
  });

  it('leaves a non-quest event to the HUD switch untouched', () => {
    const hud = fakeHud();
    playUi.mockClear();
    const ev = { type: 'damage', sourceId: 1, targetId: 2, amount: 3 } as unknown as SimEvent;
    expect(applyQuestEventPresentation(hud, ev)).toBe(false);
    expect(playUi).not.toHaveBeenCalled();
    expect(hud.worldQuestPuzzleWindow.applyEventPresentation).not.toHaveBeenCalled();
  });

  it('shows the goblin warning as a dressed banner and explains the rule in the chat', () => {
    const hud = fakeHud();
    const ev = { type: 'hoardGoblinSighted', escapeSec: 20, idleSec: 120 } as SimEvent;
    expect(applyQuestEventPresentation(hud, ev)).toBe(true);
    expect(hud.showBanner).toHaveBeenCalledWith(
      'A goblin thief appears!',
      true,
      '/ui/mobs/hoard_coinsack_scurrier.webp',
      'default',
      'Kill it before it escapes with the gold!',
      HOARD_GOBLIN_BANNER_MS,
    );
    expect(HOARD_GOBLIN_BANNER_MS).toBeGreaterThan(2600);
    const line = hud.log.mock.calls[0]?.[0] as string;
    expect(line).toContain('20-second escape bar');
    expect(line).toContain('after 2 minutes');
    // A late arrival hears the time left, rounded up to a whole minute.
    const late = fakeHud();
    applyQuestEventPresentation(late, { ...ev, idleSec: 30 } as SimEvent);
    expect(late.log.mock.calls[0]?.[0]).toContain('after 1 minutes');
    expect(playUi).toHaveBeenLastCalledWith('quest_ready');
  });

  it('queues the world quest entry plate through the full banner call', () => {
    const hud = fakeHud();
    const ev = { type: 'worldQuestStarted', questId: 'wq_eastbrook_bandits' } as SimEvent;
    expect(applyQuestEventPresentation(hud, ev)).toBe(true);
    const title = worldQuestDisplayName('wq_eastbrook_bandits');
    expect(hud.showBanner).toHaveBeenCalledTimes(1);
    expect(hud.showBanner).toHaveBeenCalledWith(
      title,
      true,
      undefined,
      'worldQuest',
      'World Quest',
      WORLD_QUEST_BANNER_MS,
      null,
      'deed',
    );
    expect(hud.log).toHaveBeenCalledWith(`World quest started: ${title}`, HUD_LOG.PROGRESS);
  });

  it('keeps an undressed banner on the plain call', () => {
    const hud = fakeHud();
    applyQuestEventPresentation(hud, { type: 'treasureVaultOpened', rarity: 'rare' } as SimEvent);
    expect(hud.showBanner).toHaveBeenCalledWith(
      'The ground gives way. A buried hoard lies open before you.',
    );
  });

  it('logs progress on the progress tone', () => {
    expect(HUD_LOG.PROGRESS).toBeTruthy();
  });

  it('stays welded to the private Hud members it drives', () => {
    const hudSource = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    for (const anchor of [
      "private readonly questBanner = new QuestProgressBanner($('#quest-banner'));",
      'private readonly questDialog: QuestDialogController;',
      'private readonly worldQuestPuzzleWindow = new WorldQuestPuzzleWindow({',
      '  log(\n    // A string body, or a caller-assembled NODE body',
      '  showBanner(\n    text: string,',
      'if (applyQuestEventPresentation(this, ev)) continue;',
    ]) {
      expect(hudSource, anchor).toContain(anchor);
    }
  });
});
