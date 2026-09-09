// @vitest-environment happy-dom
//
// Behavioral pin for the corpse popup's harvest STATUS section painter
// (Intentional Gathering PR3, corpse-status-contract.md). The pure
// row/status decisions are unit-tested DOM-free in corpse_harvest_view; this
// locks the render contract renderCorpseHarvestPanel must not disturb: the
// preference summary + Change control, the one status line (benefit or
// denial), the Harvest button's disabled/tooltip wiring, and the
// commandPending override.

import { describe, expect, it, vi } from 'vitest';
import type { CorpseHarvestStatusViewModel } from '../src/ui/hud/loot/corpse_harvest_view';
import { componentLabel, renderCorpseHarvestPanel } from '../src/ui/hud/loot/corpse_harvest_window';

function view(over: Partial<CorpseHarvestStatusViewModel> = {}): CorpseHarvestStatusViewModel {
  return {
    kind: 'ready',
    preference: { kind: 'all' },
    denial: null,
    reservation: null,
    tierBonus: 0,
    resolvedComponentTags: [],
    availableMaterialItemIds: [],
    harvestDisabled: false,
    ...over,
  };
}

describe('renderCorpseHarvestPanel: shape', () => {
  it('appends one section with a title, a Change control, a status line, and Harvest', () => {
    const container = document.createElement('div');
    renderCorpseHarvestPanel(container, view(), false, {
      onChange: () => {},
      onHarvest: () => {},
      attachTooltip: () => {},
    });

    const section = container.querySelector('.corpse-harvest');
    expect(section).not.toBeNull();
    expect(section?.querySelector('.corpse-harvest-title')?.textContent).toBe(
      'Harvest preference: All materials',
    );
    expect(section?.querySelector('.corpse-harvest-change-btn')).not.toBeNull();
    expect(section?.querySelector('.corpse-harvest-hint')).not.toBeNull();
    expect(section?.querySelector('.corpse-harvest-btn')).not.toBeNull();
  });

  it('names the current material preference by its real display name, not the raw item id', () => {
    const container = document.createElement('div');
    renderCorpseHarvestPanel(
      container,
      view({ preference: { kind: 'material', itemId: 'rough_hide' } }),
      false,
      { onChange: () => {}, onHarvest: () => {}, attachTooltip: () => {} },
    );
    const title = container.querySelector('.corpse-harvest-title')?.textContent ?? '';
    expect(title).toContain('Harvest preference:');
    expect(title).not.toContain('rough_hide');
  });

  it('disables Harvest when the view says so, independent of the Change control', () => {
    const container = document.createElement('div');
    renderCorpseHarvestPanel(container, view({ harvestDisabled: true }), false, {
      onChange: () => {},
      onHarvest: () => {},
      attachTooltip: () => {},
    });
    expect(container.querySelector<HTMLButtonElement>('.corpse-harvest-btn')?.disabled).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('.corpse-harvest-change-btn')?.disabled,
    ).toBeFalsy();
  });

  it('exposes what Harvest does via the shared tooltip idiom, distinct from Take Loot', () => {
    const container = document.createElement('div');
    const attachTooltip = vi.fn();
    renderCorpseHarvestPanel(container, view(), false, {
      onChange: () => {},
      onHarvest: () => {},
      attachTooltip,
    });
    const btn = container.querySelector<HTMLButtonElement>('.corpse-harvest-btn');
    // No native title: the shared idiom covers hover, mobile long-press, and
    // keyboard focus, where a bare title attribute is hover-only.
    expect(btn?.title).toBe('');
    const call = attachTooltip.mock.calls.find(([target]) => target === btn);
    // Live placeholders resolved off the real HARVEST_CAST_SECONDS (1.5) and
    // HARVEST_PRIORITY_SECONDS (10) admission constants, never a hardcoded
    // duration; states the real rules rather than promising ONE material,
    // since All is a real preference choice too.
    expect(call?.[1]()).toBe(
      'Harvests with your current preference over 1.5 seconds. Requires a Field Kit. Each body can be harvested once. The killer and their party have priority for 10 seconds. Dropped loot stays available.',
    );
  });

  it('registers the tooltip exactly once per render', () => {
    const container = document.createElement('div');
    const attachTooltip = vi.fn();
    renderCorpseHarvestPanel(container, view(), false, {
      onChange: () => {},
      onHarvest: () => {},
      attachTooltip,
    });
    expect(
      attachTooltip.mock.calls.filter(
        ([target]) => target === container.querySelector('.corpse-harvest-btn'),
      ),
    ).toHaveLength(1);
  });
});

describe('renderCorpseHarvestPanel: status line', () => {
  it('shows the checking sentence while the query has not settled', () => {
    const container = document.createElement('div');
    renderCorpseHarvestPanel(container, view({ kind: 'checking', harvestDisabled: true }), false, {
      onChange: () => {},
      onHarvest: () => {},
      attachTooltip: () => {},
    });
    expect(container.querySelector('.corpse-harvest-hint')?.textContent).toBe(
      'Checking harvest status...',
    );
  });

  it('shows the unavailable sentence on a settled null answer', () => {
    const container = document.createElement('div');
    renderCorpseHarvestPanel(
      container,
      view({ kind: 'unavailable', harvestDisabled: true }),
      false,
      { onChange: () => {}, onHarvest: () => {}, attachTooltip: () => {} },
    );
    expect(container.querySelector('.corpse-harvest-hint')?.textContent).toBe(
      'Harvest status is not available right now.',
    );
  });

  it('states the All-materials spread benefit when nothing refuses', () => {
    const container = document.createElement('div');
    renderCorpseHarvestPanel(container, view({ preference: { kind: 'all' } }), false, {
      onChange: () => {},
      onHarvest: () => {},
      attachTooltip: () => {},
    });
    // Never a quantity/specimen promise: names which materials are targeted,
    // not how much of any one of them lands.
    expect(container.querySelector('.corpse-harvest-hint')?.textContent).toBe(
      'Gathers every available material from this body.',
    );
  });

  it('states the focused material, and adds the real tier shift when it is nonzero (never a quantity promise)', () => {
    const noBonus = document.createElement('div');
    renderCorpseHarvestPanel(
      noBonus,
      view({ preference: { kind: 'material', itemId: 'rough_hide' }, tierBonus: 0 }),
      false,
      { onChange: () => {}, onHarvest: () => {}, attachTooltip: () => {} },
    );
    const plain = noBonus.querySelector('.corpse-harvest-hint')?.textContent ?? '';
    expect(plain).toContain('Focuses the harvest on');
    expect(plain).not.toContain('tier');

    const withBonus = document.createElement('div');
    renderCorpseHarvestPanel(
      withBonus,
      view({ preference: { kind: 'material', itemId: 'rough_hide' }, tierBonus: 2 }),
      false,
      { onChange: () => {}, onHarvest: () => {}, attachTooltip: () => {} },
    );
    const bonus = withBonus.querySelector('.corpse-harvest-hint')?.textContent ?? '';
    expect(bonus).toContain('+2 tier over All materials');
    expect(bonus).not.toMatch(/\bx\d/); // never a quantity/specimen shape
  });

  it('names the reservation holder, distinguishing self from another player', () => {
    const other = document.createElement('div');
    renderCorpseHarvestPanel(
      other,
      view({
        denial: 'reserved',
        reservation: { name: 'Rival', self: false },
        harvestDisabled: true,
      }),
      false,
      { onChange: () => {}, onHarvest: () => {}, attachTooltip: () => {} },
    );
    expect(other.querySelector('.corpse-harvest-hint')?.textContent).toBe(
      'Rival is harvesting this body.',
    );

    const self = document.createElement('div');
    renderCorpseHarvestPanel(
      self,
      view({ denial: 'reserved', reservation: { name: 'Me', self: true }, harvestDisabled: true }),
      false,
      { onChange: () => {}, onHarvest: () => {}, attachTooltip: () => {} },
    );
    expect(self.querySelector('.corpse-harvest-hint')?.textContent).toBe(
      'You are already harvesting this body.',
    );
  });

  it('falls back to a generic reservation sentence when the holder cannot be named (no blank subject)', () => {
    const missingReservation = document.createElement('div');
    renderCorpseHarvestPanel(
      missingReservation,
      view({ denial: 'reserved', reservation: null, harvestDisabled: true }),
      false,
      { onChange: () => {}, onHarvest: () => {}, attachTooltip: () => {} },
    );
    expect(missingReservation.querySelector('.corpse-harvest-hint')?.textContent).toBe(
      'Another player is harvesting this body.',
    );

    const blankName = document.createElement('div');
    renderCorpseHarvestPanel(
      blankName,
      view({ denial: 'reserved', reservation: { name: '', self: false }, harvestDisabled: true }),
      false,
      { onChange: () => {}, onHarvest: () => {}, attachTooltip: () => {} },
    );
    const line = blankName.querySelector('.corpse-harvest-hint')?.textContent ?? '';
    expect(line).toBe('Another player is harvesting this body.');
    expect(line.startsWith(' ')).toBe(false);
  });

  it('names the unavailable material and lists what the body DOES offer, honestly (no retargeting)', () => {
    const container = document.createElement('div');
    renderCorpseHarvestPanel(
      container,
      view({
        preference: { kind: 'material', itemId: 'rough_hide' },
        denial: 'material_unavailable',
        availableMaterialItemIds: ['linen_cloth'],
        harvestDisabled: true,
      }),
      false,
      { onChange: () => {}, onHarvest: () => {}, attachTooltip: () => {} },
    );
    const line = container.querySelector('.corpse-harvest-hint')?.textContent ?? '';
    expect(line).toContain('is not on this body');
    expect(line).toContain('Available:');
    expect(line).not.toContain('rough_hide');
  });

  it('joins two or more available materials as a locale-aware conjunction list, not a bare comma join', () => {
    const container = document.createElement('div');
    renderCorpseHarvestPanel(
      container,
      view({
        preference: { kind: 'material', itemId: 'rough_hide' },
        denial: 'material_unavailable',
        availableMaterialItemIds: ['linen_cloth', 'wolf_fang'],
        harvestDisabled: true,
      }),
      false,
      { onChange: () => {}, onHarvest: () => {}, attachTooltip: () => {} },
    );
    const line = container.querySelector('.corpse-harvest-hint')?.textContent ?? '';
    // formatList's English conjunction ("A and B"), never a raw comma-joined
    // fragment (which formatList's per-locale separator/conjunction data
    // would otherwise diverge from silently).
    expect(line).toMatch(/ and /);
  });

  it('drops the "Available" clause when this body offers nothing at all', () => {
    const container = document.createElement('div');
    renderCorpseHarvestPanel(
      container,
      view({
        preference: { kind: 'material', itemId: 'rough_hide' },
        denial: 'material_unavailable',
        availableMaterialItemIds: [],
        harvestDisabled: true,
      }),
      false,
      { onChange: () => {}, onHarvest: () => {}, attachTooltip: () => {} },
    );
    const line = container.querySelector('.corpse-harvest-hint')?.textContent ?? '';
    expect(line).toContain('is not on this body');
    expect(line).not.toContain('Available:');
  });

  it('reads every other denial through a stable, non-empty status line', () => {
    const reasons = [
      'malformed_input',
      'actor_dead',
      'actor_in_combat',
      'actor_busy',
      'corpse_invalid',
      'wrong_world',
      'out_of_range',
      'no_field_kit',
      'already_harvested',
      'priority_protected',
      'corpse_expiring',
      'preference_malformed',
      'nothing_to_harvest',
      'bags_full',
    ] as const;
    for (const denial of reasons) {
      const container = document.createElement('div');
      renderCorpseHarvestPanel(container, view({ denial, harvestDisabled: true }), false, {
        onChange: () => {},
        onHarvest: () => {},
        attachTooltip: () => {},
      });
      const line = container.querySelector('.corpse-harvest-hint')?.textContent ?? '';
      expect(line.length, denial).toBeGreaterThan(0);
    }
  });
});

describe('renderCorpseHarvestPanel: commandPending', () => {
  it('overrides the status line and disables Harvest independent of the view, while Change stays live', () => {
    const container = document.createElement('div');
    renderCorpseHarvestPanel(container, view({ harvestDisabled: false }), true, {
      onChange: () => {},
      onHarvest: () => {},
      attachTooltip: () => {},
    });
    expect(container.querySelector('.corpse-harvest-hint')?.textContent).toBe(
      'Starting harvest...',
    );
    expect(container.querySelector<HTMLButtonElement>('.corpse-harvest-btn')?.disabled).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('.corpse-harvest-change-btn')?.disabled,
    ).toBeFalsy();
  });
});

describe('renderCorpseHarvestPanel: dispatch', () => {
  it('Change fires with no arguments and never touches Harvest', () => {
    const container = document.createElement('div');
    const onChange = vi.fn();
    const onHarvest = vi.fn();
    renderCorpseHarvestPanel(container, view(), false, {
      onChange,
      onHarvest,
      attachTooltip: () => {},
    });
    container.querySelector<HTMLButtonElement>('.corpse-harvest-change-btn')?.click();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onHarvest).not.toHaveBeenCalled();
  });

  it('Harvest fires on click only when enabled; a disabled button dispatches nothing', () => {
    const enabled = document.createElement('div');
    const onHarvest = vi.fn();
    renderCorpseHarvestPanel(enabled, view({ harvestDisabled: false }), false, {
      onChange: () => {},
      onHarvest,
      attachTooltip: () => {},
    });
    enabled.querySelector<HTMLButtonElement>('.corpse-harvest-btn')?.click();
    expect(onHarvest).toHaveBeenCalledTimes(1);

    const disabled = document.createElement('div');
    const onHarvestDisabled = vi.fn();
    renderCorpseHarvestPanel(disabled, view({ harvestDisabled: true }), false, {
      onChange: () => {},
      onHarvest: onHarvestDisabled,
      attachTooltip: () => {},
    });
    disabled.querySelector<HTMLButtonElement>('.corpse-harvest-btn')?.click();
    expect(onHarvestDisabled).not.toHaveBeenCalled();
  });
});

// Preserved unchanged by the Intentional Gathering PR3 harvest-status rework:
// Town Focus (src/ui/town_focus_window.ts) still reads the sibling
// `hudChrome.corpseHarvest.components.*` keys directly via componentLabel's
// own key map, pinned by tests/town_focus_i18n.test.ts against the real set
// of componentTags used across mob content.
describe('componentLabel: preserved for Town Focus and its i18n pin', () => {
  it('resolves a real label for a known component tag', () => {
    expect(componentLabel('hide')).toBe('Hide');
  });

  it('falls back to the raw tag for an unmapped one, never throwing', () => {
    expect(componentLabel('not_a_real_tag')).toBe('not_a_real_tag');
  });
});
