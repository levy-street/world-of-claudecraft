// @vitest-environment happy-dom
//
// The shared corpse-harvest preference picker (Intentional Gathering PR3):
// an APG radiogroup choice of All or a single material, reused unmodified by
// the Field Kit use, Professions, and corpse Change entrances. The outer
// dialog, its open/close, and its focus trap are the parent controller's;
// this covers only the content renderer's own behavior.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import {
  HARVEST_PREFERENCE_ALL,
  HARVEST_PREFERENCE_ALL_TOKEN,
  type HarvestPreference,
} from '../src/sim/professions/harvest_preference';
import { itemDisplayName } from '../src/ui/entity_i18n';
import {
  type HarvestPreferencePickerDeps,
  renderHarvestPreferencePicker,
} from '../src/ui/hud/professions/harvest_preference_picker';
import { buildHarvestPreferencePickerView } from '../src/ui/hud/professions/harvest_preference_view';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';

// The shipped materials, spelled as literals (harvest_preference.test.ts precedent):
// a content edit that changes what a picker offers should red here too.
const ALL_MATERIAL_IDS = [
  'rough_hide',
  'wolf_fang',
  'spider_silk',
  'venom_gland',
  'game_meat',
  'homespun_cloth',
  'sharp_claw',
  'curved_tusk',
  'mudfin_scale',
];

const material = (itemId: string): HarvestPreference => ({ kind: 'material', itemId });

function radioRows(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
}

function radioRowFor(container: HTMLElement, token: string): HTMLButtonElement {
  const found = radioRows(container).find((r) => r.dataset.token === token);
  if (!found) throw new Error(`no radio row for token ${token}`);
  return found;
}

function isChecked(button: HTMLButtonElement): boolean {
  return button.getAttribute('aria-checked') === 'true';
}

function actionButtons(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].filter(
    (b) => b.getAttribute('role') !== 'radio',
  );
}

function buttonByText(container: HTMLElement, text: RegExp): HTMLButtonElement {
  const found = actionButtons(container).find((b) => text.test(b.textContent ?? ''));
  if (!found) throw new Error(`no button matching ${text}`);
  return found;
}

function press(button: HTMLButtonElement, key: string): void {
  button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

interface RenderArgs {
  preference: HarvestPreference | null;
  componentTags?: readonly string[];
}

function render(
  container: HTMLElement,
  args: RenderArgs,
  deps: Partial<HarvestPreferencePickerDeps> = {},
): HarvestPreferencePickerDeps {
  const full: HarvestPreferencePickerDeps = {
    onDraftChange: deps.onDraftChange ?? vi.fn(),
    onCommit: deps.onCommit ?? vi.fn(),
    onDismiss: deps.onDismiss ?? vi.fn(),
  };
  renderHarvestPreferencePicker(container, args, full);
  return full;
}

describe('harvest preference picker: pure view core', () => {
  it('the general catalog is All plus every catalog material, deduplicated', () => {
    const view = buildHarvestPreferencePickerView(HARVEST_PREFERENCE_ALL);
    expect(view.rows[0]).toMatchObject({ token: HARVEST_PREFERENCE_ALL_TOKEN, itemId: null });
    const itemIds = view.rows.slice(1).map((r) => r.itemId);
    expect(new Set(itemIds)).toEqual(new Set(ALL_MATERIAL_IDS));
    expect(itemIds).toHaveLength(ALL_MATERIAL_IDS.length);
  });

  it("a corpse picker offers only that body's materials, tusk and horn deduped to curved_tusk", () => {
    const view = buildHarvestPreferencePickerView(HARVEST_PREFERENCE_ALL, ['horn', 'tusk']);
    expect(view.rows).toHaveLength(2); // All + one curved_tusk row
    expect(view.rows[1].itemId).toBe('curved_tusk');
  });

  it('preselects All', () => {
    const view = buildHarvestPreferencePickerView(HARVEST_PREFERENCE_ALL, ['hide']);
    expect(view.selectedToken).toBe(HARVEST_PREFERENCE_ALL_TOKEN);
    expect(view.currentUnavailableItemId).toBeNull();
  });

  it('preselects a saved material that is offered here', () => {
    const view = buildHarvestPreferencePickerView(material('rough_hide'), ['hide']);
    expect(view.selectedToken).toBe('rough_hide');
    expect(view.currentUnavailableItemId).toBeNull();
  });

  it('a saved material this corpse does not carry: no preselect, reported as unavailable', () => {
    const view = buildHarvestPreferencePickerView(material('curved_tusk'), ['hide']);
    expect(view.selectedToken).toBeNull();
    expect(view.currentUnavailableItemId).toBe('curved_tusk');
  });

  it('a saved material no longer in the catalog at all: no preselect, reported as unavailable', () => {
    const view = buildHarvestPreferencePickerView(material('discontinued_material'), ['hide']);
    expect(view.selectedToken).toBeNull();
    expect(view.currentUnavailableItemId).toBe('discontinued_material');
  });

  it('malformed (null) preference: no preselect, and it is not reported as an unavailable material', () => {
    const view = buildHarvestPreferencePickerView(null, ['hide']);
    expect(view.selectedToken).toBeNull();
    expect(view.currentUnavailableItemId).toBeNull();
  });
});

describe('harvest preference picker: painter behavior', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders an APG radiogroup labelled by the visible title, one row per option, with exactly one tab stop', () => {
    render(container, { preference: HARVEST_PREFERENCE_ALL, componentTags: ['hide'] });
    const group = container.querySelector('[role="radiogroup"]');
    expect(group).toBeTruthy();
    const labelledBy = group?.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(container.querySelector(`#${labelledBy}`)?.textContent).toBe(
      t('hudChrome.harvestPreference.title'),
    );
    const rows = radioRows(container);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    expect(actionButtons(container)).toHaveLength(2);
  });

  it('labels a material row with itemDisplayName, never the raw internal id', () => {
    render(container, { preference: HARVEST_PREFERENCE_ALL, componentTags: ['hide'] });
    const row = radioRowFor(container, 'rough_hide');
    expect(row.textContent).toBe(itemDisplayName(ITEMS.rough_hide));
    expect(row.textContent).not.toContain('rough_hide');
  });

  it('a known material missing from this corpse shows its localized name, not the raw id', () => {
    render(container, { preference: material('curved_tusk'), componentTags: ['hide'] });
    expect(radioRows(container).some(isChecked)).toBe(false);
    expect(container.textContent).toContain(itemDisplayName(ITEMS.curved_tusk));
    expect(container.textContent).not.toContain('curved_tusk');
  });

  it('an unknown/retired id shows the generic unavailable-material text, never the raw id', () => {
    render(container, { preference: material('discontinued_material'), componentTags: ['hide'] });
    expect(container.textContent).toContain(t('hudChrome.harvestPreference.unknownMaterial'));
    expect(container.textContent).not.toContain('discontinued_material');
  });

  it('a hostile unknown id injects no element and is never echoed verbatim', () => {
    const hostileId = '<img src=x onerror=alert(1)>';
    expect(() =>
      render(container, { preference: material(hostileId), componentTags: ['hide'] }),
    ).not.toThrow();
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('onerror');
    expect(container.textContent).toContain(t('hudChrome.harvestPreference.unknownMaterial'));
  });

  it('a retired id shaped like "constructor" resolves no inherited ITEMS member: no throw, generic unavailable text, no auto-All', () => {
    expect(() =>
      render(container, { preference: material('constructor'), componentTags: ['hide'] }),
    ).not.toThrow();
    expect(isChecked(radioRowFor(container, HARVEST_PREFERENCE_ALL_TOKEN))).toBe(false);
    expect(radioRows(container).some(isChecked)).toBe(false);
    expect(container.textContent).toContain(t('hudChrome.harvestPreference.unknownMaterial'));
    expect(container.textContent).not.toContain('constructor');
  });

  it('a retired id shaped like "__proto__" resolves no inherited ITEMS member: no throw, generic unavailable text, no auto-All', () => {
    expect(() =>
      render(container, { preference: material('__proto__'), componentTags: ['hide'] }),
    ).not.toThrow();
    expect(isChecked(radioRowFor(container, HARVEST_PREFERENCE_ALL_TOKEN))).toBe(false);
    expect(radioRows(container).some(isChecked)).toBe(false);
    expect(container.textContent).toContain(t('hudChrome.harvestPreference.unknownMaterial'));
    expect(container.textContent).not.toContain('__proto__');
  });

  it('preselects the All row via a real aria-checked native indicator', () => {
    render(container, { preference: HARVEST_PREFERENCE_ALL, componentTags: ['hide'] });
    expect(isChecked(radioRowFor(container, HARVEST_PREFERENCE_ALL_TOKEN))).toBe(true);
    expect(isChecked(radioRowFor(container, 'rough_hide'))).toBe(false);
  });

  it('a malformed (null) preference visibly asks for a choice: the first option is the tab stop but stays unchecked, and Apply is disabled', () => {
    render(container, { preference: null, componentTags: ['hide'] });
    const rows = radioRows(container);
    expect(rows.every((r) => !isChecked(r))).toBe(true);
    expect(rows[0].tabIndex).toBe(0);
    expect(isChecked(rows[0])).toBe(false);
    const hint = container.querySelector<HTMLElement>('.harvest-preference-hint');
    expect(hint?.hidden).toBe(false);
    expect(buttonByText(container, /apply/i).disabled).toBe(true);
  });

  it('every focusable control carries a data-focus-key: rows by token, Apply, and Cancel', () => {
    render(container, { preference: HARVEST_PREFERENCE_ALL, componentTags: ['hide'] });
    expect(radioRowFor(container, HARVEST_PREFERENCE_ALL_TOKEN).dataset.focusKey).toBe(
      `radio:${HARVEST_PREFERENCE_ALL_TOKEN}`,
    );
    expect(radioRowFor(container, 'rough_hide').dataset.focusKey).toBe('radio:rough_hide');
    expect(buttonByText(container, /apply/i).dataset.focusKey).toBe('apply');
    expect(buttonByText(container, /cancel/i).dataset.focusKey).toBe('cancel');
  });

  it('clicking a row reports the new token via onDraftChange, never onCommit/onDismiss', () => {
    const onDraftChange = vi.fn();
    render(
      container,
      { preference: HARVEST_PREFERENCE_ALL, componentTags: ['hide'] },
      { onDraftChange },
    );
    radioRowFor(container, 'rough_hide').click();
    expect(onDraftChange).toHaveBeenCalledTimes(1);
    expect(onDraftChange).toHaveBeenCalledWith('rough_hide');
    expect(container.querySelector<HTMLElement>('.harvest-preference-hint')?.hidden).toBe(true);
  });

  it('a roving key landing reports the new token via onDraftChange', () => {
    const onDraftChange = vi.fn();
    render(
      container,
      { preference: HARVEST_PREFERENCE_ALL, componentTags: ['hide'] },
      { onDraftChange },
    );
    press(radioRowFor(container, HARVEST_PREFERENCE_ALL_TOKEN), 'ArrowDown');
    expect(onDraftChange).toHaveBeenCalledWith('rough_hide');
    expect(container.querySelector<HTMLElement>('.harvest-preference-hint')?.hidden).toBe(true);
  });

  it('a row from a superseded render cannot move the draft or report onDraftChange (the ownership guard extends to rows)', () => {
    const first = render(
      container,
      { preference: HARVEST_PREFERENCE_ALL, componentTags: ['hide'] },
      { onDraftChange: vi.fn() },
    );
    const staleRow = radioRowFor(container, 'rough_hide');
    render(container, { preference: material('rough_hide'), componentTags: ['hide'] });
    staleRow.click();
    expect(first.onDraftChange).not.toHaveBeenCalled();
  });

  it('clicking a different row changes the draft but never calls onCommit or onDismiss', () => {
    const deps = render(container, { preference: HARVEST_PREFERENCE_ALL, componentTags: ['hide'] });
    radioRowFor(container, 'rough_hide').click();
    radioRowFor(container, HARVEST_PREFERENCE_ALL_TOKEN).click();
    expect(deps.onCommit).not.toHaveBeenCalled();
    expect(deps.onDismiss).not.toHaveBeenCalled();
  });

  it('ArrowDown/ArrowUp move the roving tab stop and the draft selection, and never call onCommit', () => {
    const deps = render(container, { preference: HARVEST_PREFERENCE_ALL, componentTags: ['hide'] });
    const allRow = radioRowFor(container, HARVEST_PREFERENCE_ALL_TOKEN);
    const hideRow = radioRowFor(container, 'rough_hide');

    press(allRow, 'ArrowDown');
    expect(isChecked(hideRow)).toBe(true);
    expect(isChecked(allRow)).toBe(false);
    expect(hideRow.tabIndex).toBe(0);
    expect(allRow.tabIndex).toBe(-1);
    expect(radioRows(container).filter((r) => r.tabIndex === 0)).toHaveLength(1);

    press(hideRow, 'ArrowUp');
    expect(isChecked(allRow)).toBe(true);
    expect(isChecked(hideRow)).toBe(false);
    expect(allRow.tabIndex).toBe(0);

    expect(deps.onCommit).not.toHaveBeenCalled();
    expect(deps.onDismiss).not.toHaveBeenCalled();
  });

  it('Home/End land on the first/last row without calling onCommit', () => {
    const deps = render(container, {
      preference: HARVEST_PREFERENCE_ALL,
      componentTags: ['horn', 'tusk'],
    });
    const allRow = radioRowFor(container, HARVEST_PREFERENCE_ALL_TOKEN);
    const tuskRow = radioRowFor(container, 'curved_tusk');

    press(allRow, 'End');
    expect(isChecked(tuskRow)).toBe(true);
    expect(tuskRow.tabIndex).toBe(0);

    press(tuskRow, 'Home');
    expect(isChecked(allRow)).toBe(true);
    expect(allRow.tabIndex).toBe(0);

    expect(deps.onCommit).not.toHaveBeenCalled();
  });

  it('Apply sends exactly one canonical token for the current draft, and never dismisses', () => {
    const deps = render(container, { preference: HARVEST_PREFERENCE_ALL, componentTags: ['hide'] });
    radioRowFor(container, 'rough_hide').click();
    buttonByText(container, /apply/i).click();
    expect(deps.onCommit).toHaveBeenCalledTimes(1);
    expect(deps.onCommit).toHaveBeenCalledWith('rough_hide');
    expect(deps.onDismiss).not.toHaveBeenCalled();
  });

  it('Apply on the untouched All draft sends the All token', () => {
    const deps = render(container, { preference: HARVEST_PREFERENCE_ALL, componentTags: ['hide'] });
    buttonByText(container, /apply/i).click();
    expect(deps.onCommit).toHaveBeenCalledWith(HARVEST_PREFERENCE_ALL_TOKEN);
  });

  it('Cancel dismisses without ever committing, draft changes included', () => {
    const deps = render(container, { preference: HARVEST_PREFERENCE_ALL, componentTags: ['hide'] });
    radioRowFor(container, 'rough_hide').click();
    buttonByText(container, /cancel/i).click();
    expect(deps.onCommit).not.toHaveBeenCalled();
    expect(deps.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('after Apply, the same rendered instance is terminal: neither Apply nor Cancel fires again', () => {
    const deps = render(container, { preference: HARVEST_PREFERENCE_ALL, componentTags: ['hide'] });
    const apply = buttonByText(container, /apply/i);
    const cancel = buttonByText(container, /cancel/i);
    apply.click();
    expect(deps.onCommit).toHaveBeenCalledTimes(1);
    apply.click();
    cancel.click();
    expect(deps.onCommit).toHaveBeenCalledTimes(1);
    expect(deps.onDismiss).not.toHaveBeenCalled();
  });

  it('after Cancel, the same rendered instance is terminal: Apply can no longer commit', () => {
    const deps = render(container, { preference: HARVEST_PREFERENCE_ALL, componentTags: ['hide'] });
    const apply = buttonByText(container, /apply/i);
    const cancel = buttonByText(container, /cancel/i);
    cancel.click();
    expect(deps.onDismiss).toHaveBeenCalledTimes(1);
    apply.click();
    expect(deps.onCommit).not.toHaveBeenCalled();
    cancel.click();
    expect(deps.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('a retained Apply/Cancel is inert once the outer popup removes the whole rendered subtree without rerendering (Escape/close)', () => {
    const deps = render(container, { preference: HARVEST_PREFERENCE_ALL, componentTags: ['hide'] });
    const apply = buttonByText(container, /apply/i);
    const cancel = buttonByText(container, /cancel/i);
    container.querySelector('.harvest-preference')?.remove();
    apply.click();
    cancel.click();
    expect(deps.onCommit).not.toHaveBeenCalled();
    expect(deps.onDismiss).not.toHaveBeenCalled();
  });

  it('re-rendering into the same container replaces the prior controls, and a retained OLD Apply element is now inert', () => {
    const first = render(container, {
      preference: HARVEST_PREFERENCE_ALL,
      componentTags: ['hide'],
    });
    const oldApply = buttonByText(container, /apply/i);
    const second = render(container, {
      preference: material('rough_hide'),
      componentTags: ['hide'],
    });

    expect(radioRows(container)).toHaveLength(2);
    expect(actionButtons(container)).toHaveLength(2);

    // The stale element is detached but still a live JS object with its old
    // listener; clicking it directly must not resurrect the old callback.
    oldApply.click();
    expect(first.onCommit).not.toHaveBeenCalled();
    expect(second.onCommit).not.toHaveBeenCalled();

    buttonByText(container, /apply/i).click();
    expect(second.onCommit).toHaveBeenCalledTimes(1);
    expect(first.onCommit).not.toHaveBeenCalled();
  });

  it('two containers rendered at once keep independent draft state', () => {
    const containerB = document.createElement('div');
    document.body.appendChild(containerB);
    try {
      render(container, { preference: HARVEST_PREFERENCE_ALL, componentTags: ['hide'] });
      render(containerB, { preference: HARVEST_PREFERENCE_ALL, componentTags: ['hide'] });

      radioRowFor(container, 'rough_hide').click();

      expect(isChecked(radioRowFor(container, 'rough_hide'))).toBe(true);
      expect(isChecked(radioRowFor(container, HARVEST_PREFERENCE_ALL_TOKEN))).toBe(false);
      // Container B's draft is untouched by container A's change.
      expect(isChecked(radioRowFor(containerB, HARVEST_PREFERENCE_ALL_TOKEN))).toBe(true);
      expect(isChecked(radioRowFor(containerB, 'rough_hide'))).toBe(false);
    } finally {
      containerB.remove();
    }
  });
});

describe('harvest preference picker: locale behavior', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    setLanguage('en');
  });

  it("renders the active locale's real item names, not English, once loaded", async () => {
    await ensureLocaleLoaded('es');
    setLanguage('es');
    render(container, { preference: HARVEST_PREFERENCE_ALL, componentTags: ['hide'] });
    const row = radioRowFor(container, 'rough_hide');
    expect(row.textContent).toBe(itemDisplayName(ITEMS.rough_hide));
    expect(row.textContent).not.toBe('Rough Hide');
  });
});
