// @vitest-environment jsdom
// Pure-core pins for bag-hover -> tracker highlight targeting, plus the thin
// DOM helper driven against a fixture root (no live document globals).
import { describe, expect, it } from 'vitest';
import {
  BagQuestTrackerHighlight,
  trackerTitleSelector,
} from '../src/ui/bag_quest_tracker_highlight';
import {
  bagQuestTrackerHighlightId,
  QUEST_TRACKER_BAG_HOVER_CLASS,
} from '../src/ui/bag_quest_tracker_highlight_view';

describe('bag_quest_tracker_highlight_view: highlight id', () => {
  it('returns questId for quest stacks', () => {
    expect(bagQuestTrackerHighlightId({ kind: 'quest', questId: 'q_boars' })).toBe('q_boars');
  });

  it('returns null for non-quest kinds even with a questId', () => {
    expect(bagQuestTrackerHighlightId({ kind: 'junk', questId: 'q_boars' })).toBeNull();
    expect(bagQuestTrackerHighlightId({ kind: 'weapon', questId: 'q_boars' })).toBeNull();
  });

  it('returns null when questId is missing or empty', () => {
    expect(bagQuestTrackerHighlightId({ kind: 'quest' })).toBeNull();
    expect(bagQuestTrackerHighlightId({ kind: 'quest', questId: null })).toBeNull();
    expect(bagQuestTrackerHighlightId({ kind: 'quest', questId: '' })).toBeNull();
  });

  it('is case-sensitive on kind', () => {
    expect(bagQuestTrackerHighlightId({ kind: 'Quest', questId: 'q_boars' })).toBeNull();
  });

  it('exports the stable hover class name for CSS and the controller', () => {
    expect(QUEST_TRACKER_BAG_HOVER_CLASS).toBe('qt-bag-hover');
  });
});

describe('bag_quest_tracker_highlight: controller', () => {
  function fixture(questIds: string[]): {
    root: { querySelector: (sel: string) => HTMLElement | null };
    titles: Map<string, HTMLElement>;
  } {
    const titles = new Map<string, HTMLElement>();
    // Host parent so `#quest-tracker .qt-title` can match (querySelector on the
    // tracker node itself cannot select the tracker as an ancestor of its kids).
    const host = document.createElement('div');
    const tracker = document.createElement('div');
    tracker.id = 'quest-tracker';
    for (const id of questIds) {
      const title = document.createElement('div');
      title.className = 'qt-title';
      title.dataset.quest = id;
      tracker.appendChild(title);
      titles.set(id, title);
    }
    host.appendChild(tracker);
    const root = {
      querySelector: (sel: string) => host.querySelector(sel) as HTMLElement | null,
    };
    return { root, titles };
  }

  it('adds the hover class on the matching tracker title', () => {
    const { root, titles } = fixture(['q_boars', 'q_wolves']);
    const highlight = new BagQuestTrackerHighlight(root);
    highlight.set('q_boars');
    expect(titles.get('q_boars')!.classList.contains(QUEST_TRACKER_BAG_HOVER_CLASS)).toBe(true);
    expect(titles.get('q_wolves')!.classList.contains(QUEST_TRACKER_BAG_HOVER_CLASS)).toBe(false);
  });

  it('clears the previous highlight when switching quest ids', () => {
    const { root, titles } = fixture(['q_boars', 'q_wolves']);
    const highlight = new BagQuestTrackerHighlight(root);
    highlight.set('q_boars');
    highlight.set('q_wolves');
    expect(titles.get('q_boars')!.classList.contains(QUEST_TRACKER_BAG_HOVER_CLASS)).toBe(false);
    expect(titles.get('q_wolves')!.classList.contains(QUEST_TRACKER_BAG_HOVER_CLASS)).toBe(true);
  });

  it('clear removes the active class', () => {
    const { root, titles } = fixture(['q_boars']);
    const highlight = new BagQuestTrackerHighlight(root);
    highlight.set('q_boars');
    highlight.clear();
    expect(titles.get('q_boars')!.classList.contains(QUEST_TRACKER_BAG_HOVER_CLASS)).toBe(false);
  });

  it('set(null) and missing rows are no-ops that clear prior state', () => {
    const { root, titles } = fixture(['q_boars']);
    const highlight = new BagQuestTrackerHighlight(root);
    highlight.set('q_boars');
    highlight.set(null);
    expect(titles.get('q_boars')!.classList.contains(QUEST_TRACKER_BAG_HOVER_CLASS)).toBe(false);
    highlight.set('q_missing');
    expect(titles.get('q_boars')!.classList.contains(QUEST_TRACKER_BAG_HOVER_CLASS)).toBe(false);
  });

  it('builds a tracker title attribute selector', () => {
    expect(trackerTitleSelector('q_boars')).toBe('#quest-tracker .qt-title[data-quest="q_boars"]');
  });
});
