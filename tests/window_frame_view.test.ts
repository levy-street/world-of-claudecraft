import { describe, expect, it } from 'vitest';
import { buildWindowFrameModel, type WindowFrameDescriptor } from '../src/ui/window_frame_view';

// Pure-core tests for the reusable window-frame model. The core is DOM-free and
// carries i18n KEYS only (TranslationKey-typed, so a typo'd key is a compile
// error here, not a runtime t() throw). It maps a descriptor to a render model
// naming the structural nodes, their derived (instance-parameterized) ids, the
// aria wiring, and the shared grammar class names. Assertions pin exact
// strings, not truthiness, so an id derivation or aria regression fails here.

// A closable descriptor with tabs and a footer, the fully-featured shape. The
// keys are real catalog leaves (the TranslationKey type demands it); which leaf
// is irrelevant to the model, which never resolves them.
const full: WindowFrameDescriptor = {
  id: 'vendor-window',
  titleKey: 'itemUi.vendor.goodsTitle',
  closeLabelKey: 'itemUi.vendor.close',
  tabs: [
    { id: 'buy', labelKey: 'hudChrome.leaderboard.tabPlayers' },
    { id: 'sell', labelKey: 'hudChrome.leaderboard.tabGuilds' },
  ],
  footer: true,
};

describe('buildWindowFrameModel structure', () => {
  it('names the root dialog with the grammar class and derived title id', () => {
    const m = buildWindowFrameModel(full);
    expect(m.id).toBe('vendor-window');
    expect(m.role).toBe('dialog');
    expect(m.className).toBe('window-frame');
    expect(m.titleId).toBe('vendor-window-title');
    expect(m.labelledBy).toBe('vendor-window-title');
    expect(m.titleKey).toBe('itemUi.vendor.goodsTitle');
    expect(m.titlebarClassName).toBe('window-titlebar');
    expect(m.titleClassName).toBe('window-title');
    expect(m.bodyClassName).toBe('window-body');
  });

  it('derives every structural id from the descriptor id (instance-parameterized)', () => {
    const m = buildWindowFrameModel({
      id: 'social-panel',
      titleKey: 'hudChrome.townFocus.title',
      closeLabelKey: 'hudChrome.leaderboard.close',
    });
    expect(m.titleId).toBe('social-panel-title');
    expect(m.bodyId).toBe('social-panel-body');
    expect(m.close?.id).toBe('social-panel-close');
  });

  it('defaults aria-modal to false and reflects an explicit modal descriptor', () => {
    expect(buildWindowFrameModel(full).ariaModal).toBe(false);
    expect(buildWindowFrameModel({ ...full, modal: true }).ariaModal).toBe(true);
  });
});

describe('buildWindowFrameModel close control', () => {
  it('emits a close node with the descriptor label key by default', () => {
    const m = buildWindowFrameModel(full);
    expect(m.close).not.toBeNull();
    expect(m.close?.id).toBe('vendor-window-close');
    expect(m.close?.className).toBe('window-close');
    expect(m.close?.labelKey).toBe('itemUi.vendor.close');
  });

  it('omits the close node for a non-closable window', () => {
    const m = buildWindowFrameModel({
      id: 'rite-window',
      titleKey: 'hudChrome.corpseHarvest.title',
      closable: false,
    });
    expect(m.close).toBeNull();
  });
});

describe('buildWindowFrameModel tab rail', () => {
  it('builds a tablist with derived tab and panel ids labelled by the title', () => {
    const m = buildWindowFrameModel(full);
    expect(m.tablist).not.toBeNull();
    expect(m.tablist?.id).toBe('vendor-window-tabs');
    expect(m.tablist?.className).toBe('tab-rail');
    expect(m.tablist?.labelledBy).toBe('vendor-window-title');
    expect(m.tablist?.tabs.map((t) => t.tabId)).toEqual([
      'vendor-window-tab-buy',
      'vendor-window-tab-sell',
    ]);
    expect(m.tablist?.tabs.map((t) => t.panelId)).toEqual([
      'vendor-window-panel-buy',
      'vendor-window-panel-sell',
    ]);
    expect(m.tablist?.tabs.map((t) => t.labelKey)).toEqual([
      'hudChrome.leaderboard.tabPlayers',
      'hudChrome.leaderboard.tabGuilds',
    ]);
  });

  it('selects the first tab and a roving tabindex when no active id is given', () => {
    const m = buildWindowFrameModel(full);
    expect(m.tablist?.activeKey).toBe('buy');
    expect(m.tablist?.tabs.map((t) => t.selected)).toEqual([true, false]);
    expect(m.tablist?.tabs.map((t) => t.tabIndex)).toEqual([0, -1]);
  });

  it('selects the named active tab', () => {
    const m = buildWindowFrameModel(full, 'sell');
    expect(m.tablist?.activeKey).toBe('sell');
    expect(m.tablist?.tabs.map((t) => t.selected)).toEqual([false, true]);
    expect(m.tablist?.tabs.map((t) => t.tabIndex)).toEqual([-1, 0]);
  });

  it('falls back to the first tab when the active id is unknown', () => {
    const m = buildWindowFrameModel(full, 'ghost');
    expect(m.tablist?.activeKey).toBe('buy');
    expect(m.tablist?.tabs[0].selected).toBe(true);
  });

  it('emits no tablist for a window with no tabs', () => {
    const m = buildWindowFrameModel({
      id: 'loot-window',
      titleKey: 'hudChrome.dailyRewards.title',
      closeLabelKey: 'hudChrome.dailyRewards.close',
    });
    expect(m.tablist).toBeNull();
  });

  it('emits no tablist for an empty tabs array', () => {
    const m = buildWindowFrameModel({
      id: 'loot-window',
      titleKey: 'hudChrome.dailyRewards.title',
      closeLabelKey: 'hudChrome.dailyRewards.close',
      tabs: [],
    });
    expect(m.tablist).toBeNull();
  });
});

describe('buildWindowFrameModel body as tabpanel', () => {
  it('marks the body role tabpanel with the ACTIVE tab panel id when tabs exist', () => {
    const m = buildWindowFrameModel(full);
    expect(m.bodyRole).toBe('tabpanel');
    expect(m.bodyId).toBe('vendor-window-panel-buy');
    // The selected tab's aria-controls target is exactly the body id.
    expect(m.tablist?.tabs.find((t) => t.selected)?.panelId).toBe(m.bodyId);
    // The tabpanel is named by its ACTIVE tab (WAI-ARIA APG aria-labelledby).
    expect(m.bodyLabelledBy).toBe('vendor-window-tab-buy');
  });

  it('follows the named active tab: the body id is that tab panel id', () => {
    const m = buildWindowFrameModel(full, 'sell');
    expect(m.bodyRole).toBe('tabpanel');
    expect(m.bodyId).toBe('vendor-window-panel-sell');
    expect(m.tablist?.tabs.find((t) => t.selected)?.panelId).toBe('vendor-window-panel-sell');
    expect(m.bodyLabelledBy).toBe('vendor-window-tab-sell');
  });

  it('keeps a plain body (derived -body id, no role, no tab labelling) for a tab-less window', () => {
    const m = buildWindowFrameModel({
      id: 'loot-window',
      titleKey: 'hudChrome.dailyRewards.title',
      closeLabelKey: 'hudChrome.dailyRewards.close',
    });
    expect(m.bodyRole).toBeNull();
    expect(m.bodyId).toBe('loot-window-body');
    expect(m.bodyLabelledBy).toBeNull();
  });
});

describe('buildWindowFrameModel footer', () => {
  it('emits a footer node with a derived id when requested', () => {
    const m = buildWindowFrameModel(full);
    expect(m.footer).not.toBeNull();
    expect(m.footer?.id).toBe('vendor-window-footer');
    expect(m.footer?.className).toBe('window-footer');
  });

  it('omits the footer by default', () => {
    const m = buildWindowFrameModel({
      id: 'loot-window',
      titleKey: 'hudChrome.dailyRewards.title',
      closeLabelKey: 'hudChrome.dailyRewards.close',
    });
    expect(m.footer).toBeNull();
  });
});
