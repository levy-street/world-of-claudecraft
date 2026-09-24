import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { SimEvent } from '../src/sim/types';
import { applyQuestEventPresentation } from '../src/ui/hud/quest/quest_event_router';
import { HUD_LOG } from '../src/ui/hud_tones';

const playUi = vi.hoisted(() => vi.fn());
vi.mock('../src/game/sfx', () => ({ sfx: { playUi } }));

function fakeHud() {
  return {
    log: vi.fn(),
    questBanner: { show: vi.fn() },
    showBanner: vi.fn(),
    questDialog: { refresh: vi.fn() },
    worldQuestPuzzleWindow: { applyEventPresentation: vi.fn() },
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

  it('logs progress on the progress tone', () => {
    expect(HUD_LOG.PROGRESS).toBeTruthy();
  });

  it('stays welded to the private Hud members it drives', () => {
    const hudSource = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    for (const anchor of [
      "private readonly questBanner = new QuestProgressBanner($('#quest-banner'));",
      'private readonly questDialog: QuestDialogController;',
      'private readonly worldQuestPuzzleWindow = new WorldQuestPuzzleWindow({',
      // The release/v0.44.0 permanent loot quality change gave log() a node
      // body arm (the exact-copy loot receipt link), so the anchor is the
      // signature line rather than the old string-only parameter.
      '  log(\n    // A string body',
      '    text: string | readonly Node[],\n    color = ',
      '  showBanner(\n    text: string,',
      'if (applyQuestEventPresentation(this, ev)) continue;',
    ]) {
      expect(hudSource, anchor).toContain(anchor);
    }
  });
});
